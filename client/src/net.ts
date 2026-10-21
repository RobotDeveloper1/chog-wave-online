import { SERVER_HTTP, SERVER_WS } from './config.ts';
import type { Placement, SaveView, SectorId, SectorState, WorldSnapshot, ChogBuild, ProfileView } from '@chog/shared';

type Handler = (msg: any) => void;

export interface Self {
  id: string;
  tokenId: number;
  sector: SectorId;
  build: ChogBuild;
  save: SaveView;
  traitsSource: 'real' | 'predicted';
  /** The raw trait values the world read for this token, real or predicted. */
  attributes: Record<string, string>;
  level: number;
}

/**
 * What the server said about the Chog that was asked for.
 *
 * A refusal carries the server's own words because the reasons are the server's
 * policy — an unowned token, a signed-out session, a collection id out of range —
 * and a client that re-lists them has to be updated every time the policy is.
 */
export type JoinVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Thin reconnecting WS wrapper. Movement is fire-and-forget; only `fire` expects
 * a verdict, because the server re-scores the grid and owns all damage.
 */
export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private queue: string[] = [];
  private attempts = 0;
  /** The join this socket is playing, kept so a reconnect re-plays the same Chog. */
  private requested: { tokenId?: number | null; session?: string | null } = {};
  connected = false;
  me: Self | null = null;
  world: WorldSnapshot | null = null;
  /**
   * Pushed by the server whenever progression changes, so the terminal never has to
   * guess what a purchase or a level cost — it is told.
   */
  profile: ProfileView | null = null;

  on(t: string, fn: Handler): () => void {
    if (!this.handlers.has(t)) this.handlers.set(t, new Set());
    this.handlers.get(t)!.add(fn);
    return () => this.handlers.get(t)!.delete(fn);
  }

  connect(tokenId?: number | null, session?: string | null): void {
    const ws = new WebSocket(SERVER_WS);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.attempts = 0;
      this.join(tokenId, session);
      for (const q of this.queue.splice(0)) ws.send(q);
    };
    ws.onclose = () => {
      this.connected = false;
      this.emit('disconnect', {});
      // A dropped socket re-plays the join it was given, session and all: the world
      // the player walked back into has to be the same world they were in.
      setTimeout(() => this.connect(this.requested.tokenId, this.requested.session), Math.min(8000, 400 * 2 ** this.attempts++));
    };
    ws.onmessage = (ev) => {
      let msg: { t: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === 'welcome') this.me = (msg as unknown as { you: Self }).you;
      if (msg.t === 'profile') this.profile = (msg as unknown as { profile: ProfileView }).profile;
      if (msg.t === 'world') this.world = msg as unknown as WorldSnapshot;
      this.emit(msg.t, msg);
    };
  }

  private emit(t: string, msg: unknown): void {
    for (const fn of this.handlers.get(t) ?? []) fn(msg);
  }

  private join(tokenId?: number | null, session?: string | null): void {
    this.requested = { tokenId, session };
    this.send('join', { tokenId: tokenId ?? null, session: session ?? null, sector: 'ashflat' });
  }

  /**
   * Ask the world for a Chog and wait to be told yes or no.
   *
   * `connect` is fire-and-forget, which suits movement and does not suit a join: the
   * picker cannot close until the server has confirmed the tokenId, since ownership
   * is checked against the chain and an honest-looking grid can still be refused.
   * The timeout is the third outcome — a socket that never answers is a dead server,
   * not a refused Chog, and saying "the server did not answer" keeps those apart.
   */
  enter(tokenId: number | null, session: string | null, timeoutMs = 8000): Promise<JoinVerdict> {
    return new Promise<JoinVerdict>((resolve) => {
      let settled = false;
      const settle = (verdict: JoinVerdict): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        offWelcome();
        offRejected();
        resolve(verdict);
      };
      const offWelcome = this.on('welcome', () => settle({ ok: true }));
      const offRejected = this.on('rejected', (msg) => settle({ ok: false, reason: String(msg?.reason ?? 'the server refused this chog') }));
      const timer = setTimeout(() => settle({ ok: false, reason: 'the server did not answer' }), timeoutMs);
      if (this.connected) this.join(tokenId, session);
      else this.connect(tokenId, session);
    });
  }

  send(t: string, body: Record<string, unknown>): void {
    const payload = JSON.stringify({ t, ...body });
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(payload);
    else if (t !== 'move') this.queue.push(payload);
  }

  /** Sector change that keeps the player — re-joining would reset the field. */
  switchSector(sector: SectorId): void {
    if (!this.me) return;
    this.me = { ...this.me, sector };
    this.send('switch', { sector });
  }

  move(patch: Record<string, unknown>): void {
    this.send('move', patch);
  }

  fire(sector: SectorId, placements: Placement[]): void {
    this.send('fire', { sector, placements });
  }


  sectors(): SectorState[] {
    return this.world?.sectors ?? [];
  }

  /** Pulled rather than pushed: it changes on a clear, not on a tick. */
  async leaderboard(): Promise<{ key: string; name: string; kills: number; streak: number }[]> {
    try {
      const r = await fetch(`${SERVER_HTTP}/api/leaderboard`);
      return (await r.json()) as { key: string; name: string; kills: number; streak: number }[];
    } catch {
      return [];
    }
  }

  /**
   * The progression surface: shop, bag, quests, album, data areas and the war board
   * all go through one envelope, keyed to this socket's player rather than a query
   * string, so nothing here needs a separate auth step.
   */
  loop(action: string, body: Record<string, unknown> = {}): void {
    this.send('loop', { action, ...body });
  }

  sector(id: SectorId): SectorState | undefined {
    return this.sectors().find((s) => s.sector === id);
  }
}

export const net = new Net();
