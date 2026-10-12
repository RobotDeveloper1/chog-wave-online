import {
  SF,
  type PartyMsg,
  classify,
  createSectors,
  deriveBuild,
  duelTierOf,
  ingest,
  openAnomaly,
  partyRewardScale,
  tick,
  volumeOf,
  hotSector,
  starterCard,
  SECTORS,
  VOLUME_WINDOW_MS,
  CHIPS,
  type ChogBuild,
  type DuelEndMsg,
  type DuelMsg,
  type MarketTick,
  type ChogSource,
  type Placement,
  type SaleFact,
  type SectorId,
  type SectorSignal,
  type SectorState,
  ITEMS,
  xpForQuest,
  type Tier,
  type WaveEvent,
  type WorldSnapshot,
  keysOfSource,
  arrivalFor,
  cityOf,
  npcOf,
  poiOf,
  type Anchor,
  type DataArea,
  type Element,
  type ProfileView,
  type QuestDef,
  type TalkView,
} from '@chog/shared';
import { BattleSession, type JoinSpec, type SessionEvent } from './battle.ts';
import { CFG } from './config.ts';
import { createFeed, type Feed } from './feed.ts';
import { traits } from './meta.ts';
import { Profiles, type GrantResult, type LevelUp, type RefundLine } from './profiles.ts';
import { SaveStore, levelOf, type SaveRow } from './save.ts';
import { Social, type Presence, type TradeOffer } from './social.ts';
import { War } from './war.ts';

/**
 * A room is congestion relief, not a separate world. The Wave Index and its boss
 * live on the *sector*, so every instance of Voltgrid is fighting the same
 * anomaly with the same HP pool — which is the whole co-op promise, and it costs
 * nothing extra because the sector state was already shared.
 */
export const ROOM_CAP = 24;
/**
 * Where a player may stand is the city plan's own walkable rectangle — the same function
 * the client builds the district from — so the server and the world a player sees cannot
 * drift apart. (They once did: the server clamped to a 32-unit-deep strip while the client
 * drew yards and alleys 45 units deep, and everyone walking into one appeared to stand in
 * a wall to everybody else.)
 */
export const boundsOf = (sector: SectorId) => cityOf(sector).bounds;
/** A shop or a hall is a 16 × 12 room with its own coordinates; nothing in it is on the street. */
const ROOM = { x0: -9, x1: 9, z0: -7, z1: 7 };
/** The fastest a Chog runs (12.5 u/s) plus slack for a hitch, per second of real time. */
export const MAX_SPEED = 17;
const ANIMS = new Set(['idle', 'walk', 'run', 'attack', 'hit']);
/** How often the aggregate trading level is re-measured and pushed into the index. */
const VOLUME_PULSE_MS = 10_000;

let volumeTimer: ReturnType<typeof setInterval> | null = null;

export interface Room {
  id: string;
  sector: SectorId;
  players: Set<string>;
}

/** A line of chat as the world keeps and delivers it: `rcpt` is who may hear it, when not everyone. */
export interface ChatLineData {
  id: string;
  name: string;
  channel: string;
  text: string;
  ts: number;
  tribe?: string;
  to?: string;
  rcpt?: string[];
}

const CHAT_WINDOW_MS = 10_000;
const CHAT_BURST = 6;

export interface Player {
  id: string;
  tokenId: number;
  /**
   * The wallet the Chog was proven to be in at join, or null for a foster/demo visitor.
   *
   * Kept because the party reward scale turns on *distinct humans*, and a head count is trivially
   * farmed by one person opening four tabs. Nobody else can answer that question: the socket layer
   * signs the wallet in, and it used to stop there.
   */
  wallet: string | null;
  sector: SectorId;
  room: string;
  x: number;
  y: number;
  vx: number;
  facing: 1 | -1;
  /** The angle the Chog faces on the plane, in radians. */
  heading: number;
  anim: string;
  hp: number;
  laserCharge: number;
  /** Best server-scored program so far; the laser scales off it. */
  bestProgram: number;
  build: ChogBuild;
  save: SaveRow;
  /** Set while the client is standing on the battle field. */
  inBattle: boolean;
  /** The element this Chog was born wearing, which is who it fights for in the War. */
  tribe: Element;
  /** Whether the traits came from the collection's metadata or from the id. */
  traitsSource: 'real' | 'predicted';
  /** Kept because the Album is built from raw trait values, not from the loadout. */
  attributes: Record<string, string>;
  /** Kept on the player so the roster can show it without a per-row profile read. */
  level: number;
  /** On the street, or inside a building. Nobody sees you from the street while you are in a room. */
  place: 'street' | 'room';
  /** Where the street position was when the player stepped through a door. */
  street: { x: number; y: number };
  /** When the last position was accepted, for the speed check. */
  at: number;
  /** Points of interest the player is standing in, so entering one fires once. */
  inPoi: Set<string>;
}

/** Fallback identity when a visitor holds no Chog — capped, temporary, clearly labelled. */
export function fosterSource(): ChogSource {
  // A foster wears token #1's traits, so the chog on the street is the showcase
  // one -- MCGA cap, Yellow 143 Jersey, BTC Glass, Pink skin -- instead of a
  // random predicted set. The identity token itself stays a unique 900k+ id, so
  // the save, the party and the war ledger never collide with the real #1.
  const one = traits.for(1);
  return {
    tokenId: 900_000 + Math.floor(Math.random() * 99_999),
    transferCount: 0,
    daysHeld: 0,
    attributes: one.attributes,
  };
}

/**
 * How many separate people are in a group, which is the only question `partyRewardScale` cannot
 * ask itself. Four Chogs in one wallet are one player, and the alt tax is what stops a single
 * account farming the party bonus — so this has to read the signed wallet, not the token.
 *
 * A wallet-less visitor (a Foster or demo Chog) counts as a person of their own. It cannot be
 * shown to be an alt, and the alternative is to tax the one party a player without an NFT can be in.
 */
function ownersOf(group: readonly Player[]): number {
  return new Set(group.map((p) => p.wallet ?? `unverified:${p.id}`)).size;
}

/**
 * What `area.kill` answers with. It is typed here because a closed dungeon core pays on two
 * separate receipts — the room's own drop, then the first-clear bonus — and the end-of-fight plate
 * can only show one total.
 */
interface KillReceipt {
  ok: boolean;
  grant?: GrantResult;
  cleared?: { first: boolean; grant?: GrantResult };
}

function mergeGrants(grants: GrantResult[]): GrantResult {
  const levels = grants.map((g) => g.level).filter((l): l is LevelUp => !!l);
  return {
    xp: grants.reduce((n, g) => n + g.xp, 0),
    wav: grants.reduce((n, g) => n + g.wav, 0),
    chips: grants.flatMap((g) => g.chips),
    items: grants.flatMap((g) => g.items),
    refunded: grants.flatMap((g) => g.refunded),
    level: levels.length ? { from: levels[0]!.from, to: levels.at(-1)!.to, unlocks: [...new Set(levels.flatMap((l) => l.unlocks))] } : null,
  };
}

export class World {
  readonly sectors = createSectors();
  readonly saves = new SaveStore();
  /** XP, WAV, quests, album and the live Data Area run, all server-decided. */
  readonly profiles = new Profiles(this.saves);
  /** The weekly Tribe War ledger. */
  readonly war = new War(this.saves);
  readonly players = new Map<string, Player>();
  readonly rooms = new Map<string, Room>();
  /** One live field per room. The server, not the client, decides if a card lands. */
  readonly sessions = new Map<string, BattleSession>();
  private sessionEvents = new Set<(ev: SessionEvent) => void>();
  /** Chat lines the street scrolls. Bounded so uptime cannot grow it. */
  private chatLog: ChatLineData[] = [];
  private feed: Feed;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = Date.now();
  private listeners = new Map<string, (s: WorldSnapshot) => void>();
  /**
   * Progression changes are pushed to the one socket that owns them rather than
   * riding the world snapshot, which would ship a bag and a quest log 20 times a
   * second to everybody.
   */
  private profileSends = new Map<string, (v: ProfileView) => void>();
  /** Things that happen *to* one player and are not part of the world: a place found, a wave caught. */
  private pushSends = new Map<string, (m: Record<string, unknown>) => void>();
  private signals = new Set<(s: SectorSignal) => void>();
  /** Recent priced sales, kept so archetypes can see a burst rather than one fill. */
  private fills: SaleFact[] = [];
  /** Last measured collection-wide trading level, surfaced in the snapshot. */
  private volume = volumeOf([]);
  /** Priced trades the street billboard scrolls. Bounded, newest last. */
  private ticks: MarketTick[] = [];

  /** Recent priced events, for the ticker a player sees when they log in. */
  private recent: { sector: SectorId; label: string; ts: number; cause: string }[] = [];

  constructor() {
    this.feed = createFeed(
      (evs) => this.push(evs),
      (f) => this.onFills(f),
    );
  }

  get feedMode() {
    return this.feed.mode;
  }

  start(): void | Promise<void> {
    this.last = Date.now();
    const loop = () => {
      const now = Date.now();
      const dt = (now - this.last) / 1000;
      this.last = now;
      this.emit(tick(this.sectors, now, dt, this.players.size));
      this.stepSessions(Math.round(dt * 1000));
      this.broadcast();
      this.timer = setTimeout(loop, CFG.broadcastMs);
    };
    loop();
    // The collection's trading level, not any one sale, is what raises the tide.
    volumeTimer = setInterval(() => this.marketPulse(), VOLUME_PULSE_MS);
    return this.feed.start();
  }

  /**
   * Split the rolling window's MON across the sectors that produced it and feed
   * each share into its own Wave Index. At the floor the market merely holds the
   * world steady; only genuinely heavy buy/sell pushes it up.
   */
  private marketPulse(): void {
    const now = Date.now();
    this.fills = this.fills.filter((f) => now - f.ts < VOLUME_WINDOW_MS);
    const v = volumeOf(this.fills);
    if (!v.trades) return;
    this.push(
      SECTORS.map((sector) => ({
        kind: 'market-volume' as const,
        sector,
        amount: v.bySector[sector],
        block: 0,
        ts: now,
      })),
    );
    this.volume = v;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (volumeTimer) clearInterval(volumeTimer);
    this.feed.stop();
    this.saves.close();
  }

  /** Event tally by kind, surfaced in the snapshot so "is this the real chain?"
   * is answerable from the client without reading server logs. */
  readonly seen: Record<string, number> = {};

  onSession(fn: (ev: SessionEvent) => void): () => void {
    this.sessionEvents.add(fn);
    return () => this.sessionEvents.delete(fn);
  }

  /** A downed player may not step back onto a field for a few seconds. */
  private downedUntil = new Map<string, number>();
  /** When each field last pushed a plain state tick, so a quiet field is not chatty. */
  private lastTick = new Map<string, number>();
  private rewardedBosses = new Set<string>();
  private fightQuests = new Map<string, Set<string>>();

  private trackFightQuests(id: string, done: string[]): void {
    const quests = this.fightQuests.get(id) ?? new Set<string>();
    for (const quest of done) quests.add(quest);
    this.fightQuests.set(id, quests);
  }

  private fieldStatsOf(p: Player, session: BattleSession): SF.DuelStats {
    const seats = this.social.withMe(p.id)
      .filter((id) => id === p.id || session.has(id))
      .map((id) => this.players.get(id))
      .filter((q): q is Player => !!q)
      .map((q) => SF.seatOf({ id: q.id, owner: q.wallet ?? `unverified:${q.id}`, tokenId: q.tokenId, name: q.build.callsign, loadout: q.build.loadout, level: q.level }));
    return SF.applySteps(SF.duelStatsOf({ loadout: p.build.loadout, level: p.level }), SF.partySteps(seats, p.id));
  }

  private refreshFieldParty(session: BattleSession): void {
    for (const body of session.state.players) {
      const p = this.players.get(body.id);
      if (p) session.setStats(p.id, this.fieldStatsOf(p, session));
    }
  }

  private refreshParties(): void {
    for (const s of this.sessions.values()) this.refreshFieldParty(s);
  }

  /** Persist the integrity actually left, including departures and lost bodies. No client HP. */
  private syncRunHp(p: Player, session: BattleSession, lost = false): void {
    if (!session.nodeFight) return;
    const doc = this.profiles.doc(p.tokenId);
    const hp = session.hpOf(p.id);
    if (!doc.run || !hp || doc.area?.id !== session.spec.areaId || doc.run.at !== session.spec.nodeId) return;
    doc.run = { ...doc.run, hp: Math.max(0, hp.hp), maxHp: hp.maxHp, failed: doc.run.failed || lost || hp.hp <= 0 };
    this.saves.writeProgress(p.tokenId, doc);
  }

  /**
   * Advance every live field, and tell the people standing on it what happened.
   *
   * Sessions are keyed by room, so a fight is scoped to the instance that started it while
   * the sector boss it damages stays shared — two instances of Voltgrid chip the same
   * anomaly, which is the whole point of an MMO world that is not a lobby per player.
   * A node or a Training Sim is keyed to one player and touches nothing shared.
   */
  stepSessions(dtMs: number): void {
    if (!this.sessions.size) return;
    const now = Date.now();
    for (const [key, session] of [...this.sessions]) {
      if (this.sessions.get(key) !== session) continue;
      if (session.empty) {
        this.sessions.delete(key);
        this.lastTick.delete(key);
        continue;
      }
      // Who is on the field *before* the step: a body the volley downs stays on the roster and has
      // to be told, and so does the partner whose grace ran out inside it.
      const members = [...this.players.values()].filter((p) => session.has(p.id));
      this.refreshFieldParty(session);
      const { events, cleared, downed, expired, gone, signals } = session.step(dtMs, this.sectors);
      this.emit(signals);

      for (const e of events) {
        const owner = 'owner' in e ? this.players.get(e.owner) : undefined;
        if (!owner) continue;
        if ((e.type === 'hit' || e.type === 'buster') && e.damage > 0) {
          const chain = e.type === 'hit' ? e.chain : 0;
          owner.bestProgram = Math.max(owner.bestProgram, e.damage);
          this.profiles.best(owner.tokenId, e.damage, chain);
          this.trackFightQuests(owner.id, this.quest(owner.id, [{ type: 'damage', amount: Math.max(1, Math.round(e.damage / 500)) }, ...(chain ? [{ type: 'chainRun' as const, amount: chain }] : [])]));
          if (e.type === 'buster' && e.charged) this.trackFightQuests(owner.id, this.quest(owner.id, this.profiles.onLaser(owner.tokenId)));
        } else if (e.type === 'dodge') {
          this.profiles.countFor(owner.tokenId, 'dodges');
          this.trackFightQuests(owner.id, this.quest(owner.id, [{ type: 'dodge' }]));
        }
      }

      const last = this.lastTick.get(key) ?? 0;
      if (events.length || now - last > 180) {
        this.lastTick.set(key, now);
        const snapshot = session.snapshot();
        for (const listener of this.sessionEvents) listener({ ...snapshot, events });
        for (const p of members) this.pushTo(p.id, { t: 'duel', kind: 'tick', view: session.view(p.id), events });
      }

      /**
       * Down is not defeat. The body keeps its seat on the field, in the party and on the tick
       * stream, because the whole point is that somebody can still reach it.
       */
      for (const id of downed) {
        const p = this.players.get(id);
        if (p) this.profiles.countFor(p.tokenId, 'deaths');
      }

      // Only a body nobody picked up pays for the run: out of the fight, and off the anomaly.
      for (const id of expired) {
        const p = this.players.get(id);
        if (!p) continue;
        p.inBattle = false;
        this.syncRunHp(p, session, true);
        this.downedUntil.set(id, now + SF.DEFEAT_LOCKOUT_MS);
        this.pushDuelEnd(p, session, { won: false, reason: 'wiped' });
      }
      if (expired.length) this.refreshFieldParty(session);

      if (gone && !cleared) {
        // The shared anomaly is no longer there: another instance deleted it, or it ravaged the district.
        for (const p of members) {
          if (!session.has(p.id)) continue;
          p.inBattle = false;
          this.syncRunHp(p, session);
          this.pushDuelEnd(p, session, { won: false, reason: 'gone' });
        }
        this.sessions.delete(key);
        this.lastTick.delete(key);
        continue;
      }
      if (!cleared) continue;

      for (const p of members) p.inBattle = false;
      if (session.nodeFight) {
        const nodeId = session.spec.nodeId;
        // The field decided the node died; only now does the run get paid, and only for the
        // player who owns this fold.
        for (const p of members) {
          if (!session.has(p.id)) continue;
          this.syncRunHp(p, session);
          const doc = this.profiles.doc(p.tokenId);
          const valid = doc.area?.id === session.spec.areaId && doc.run?.at === nodeId && !!doc.run && !doc.run.failed;
          // The kill is *issued* here, for the tile this field mirrors, and `area.kill` will not pay
          // without it. A body that walked off mid-fight stands on a different node, so its own arm
          // is refused and its run stays as it left it.
          const questsBefore = new Set(this.profiles.view(p.tokenId, p.sector, this.volume.mon, p.build).quests.filter((q) => q.done).map((q) => q.id));
          const kill = valid && nodeId && this.profiles.armNode(p.tokenId, nodeId)
            ? this.loop(p.id, { action: 'area.kill' }) as unknown as KillReceipt
            : null;
          this.trackFightQuests(p.id, this.profiles.view(p.tokenId, p.sector, this.volume.mon, p.build).quests.filter((q) => q.done && !questsBefore.has(q.id)).map((q) => q.id));
          // What the tile paid is answered by the kill itself, so the plate can show it: a body whose
          // arm was refused gets nothing, which is exactly true rather than a number guessed at.
          const receipts = [kill?.grant, kill?.cleared?.grant].filter((g): g is GrantResult => !!g);
          const paid = receipts.length ? mergeGrants(receipts) : null;
          this.pushDuelEnd(p, session, {
            won: !!kill?.ok,
            reason: kill?.ok ? 'cleared' : 'wiped',
            ...(paid ? { grant: paid, level: paid.level } : {}),
            ...(kill?.cleared ? { first: kill.cleared.first } : {}),
          });
        }
      } else if (session.training) {
        for (const p of members) {
          if (!session.has(p.id)) continue;
          const res = this.profiles.onTrain(p.tokenId);
          this.trackFightQuests(p.id, this.quest(p.id, res.events));
          let grant = res.grant;
          if (res.first) {
            // a common card of the Chog's own tribe that it does not hold: the first thing to put in a folder
            const card = starterCard(p.build, this.saves.get(p.tokenId).chips);
            if (card) grant = mergeGrants([grant, this.profiles.grant(p.tokenId, { chips: [card] })]);
          }
          const lv = this.noteLevel(p, grant.level);
          this.pushDuelEnd(p, session, { won: true, reason: 'cleared', grant, first: res.first, level: lv });
          this.notifyProfile(p.id);
        }
      } else {
        const s = this.sectors.find((x) => x.sector === session.sector);
        if (s) this.grantLoot(s, session);
        // All rooms mirrored this exact anomaly. End each once, even if another room landed last.
        for (const [otherKey, other] of [...this.sessions]) {
          if (other === session || other.nodeFight || other.training || other.bossIdentity !== session.bossIdentity) continue;
          this.sessions.delete(otherKey);
          this.lastTick.delete(otherKey);
        }
      }
      this.sessions.delete(key);
      this.lastTick.delete(key);
    }
  }

  /** Keep the player's cached level in step with a grant, and say it on the street. */
  private noteLevel(p: Player, level: { from: number; to: number; unlocks: string[] } | null): { from: number; to: number; unlocks: string[] } | null {
    if (!level) return null;
    p.level = level.to;
    this.announce(`${p.build.callsign} reached LV ${level.to}${level.unlocks.length ? ` — ${level.unlocks.join(', ')}` : ''}`, p.sector);
    return level;
  }

  /** What a fight paid, in the shape the end-of-duel screen draws. */
  private pushDuelEnd(
    p: Player,
    session: BattleSession,
    r: { won: boolean; reason: DuelEndMsg['reason']; grant?: { xp: number; wav: number; chips: string[]; items: string[]; refunded?: RefundLine[] }; first?: boolean; level?: LevelUp | null; quests?: string[] },
  ): void {
    if (r.reason === 'wiped') this.downedUntil.set(p.id, Date.now() + SF.DEFEAT_LOCKOUT_MS);
    const outcome = session.outcomeOf(p.id);
    const seconds = session.secondsOf(p.id);
    const busting = outcome?.busting ?? SF.emptyBusting();
    const grade = outcome?.level ?? SF.bustingLevel(busting, seconds);
    const msg: DuelEndMsg = {
      t: 'duel', kind: 'end', won: r.won, reason: r.reason,
      name: session.spec.name || SF.ARCHETYPES[session.archetype].name,
      seconds,
      busting: { level: grade, rank: outcome?.rank ?? SF.rankOf(grade), counters: busting.counters, abacks: busting.abacks, read: SF.bustingRead(busting, seconds) },
      drop: outcome?.drop ?? SF.dropFor(grade),
      wave: outcome?.wave ?? 0,
      chips: r.grant?.chips ?? [],
      items: r.grant?.items ?? [],
      lockoutMs: r.reason === 'wiped' ? SF.DEFEAT_LOCKOUT_MS : 0,
      quests: [...new Set([...(this.fightQuests.get(p.id) ?? []), ...(r.quests ?? [])])],
    };
    // Keep economy receipts on the wire while the protocol-owner type extension is pending.
    this.pushTo(p.id, {
      ...msg, tier: String(session.duelTier), xp: r.grant?.xp ?? 0, wav: r.grant?.wav ?? 0,
      refunded: r.grant?.refunded ?? [], level: r.level ?? null,
      ...(r.first !== undefined ? { first: r.first } : {}),
    });
    this.fightQuests.delete(p.id);
    p.save = this.saves.get(p.tokenId);
    this.notifyProfile(p.id);
  }

  private rollLoot(drop: { rolls: number; rareChance: number }): string[] {
    const common = CHIPS.filter((c) => SF.cardClass(c) === 'standard');
    const rare = CHIPS.filter((c) => SF.cardClass(c) !== 'standard');
    return Array.from({ length: drop.rolls }, () => {
      const pool = Math.random() < drop.rareChance && rare.length ? rare : common;
      return pool[Math.floor(Math.random() * pool.length)]!.id;
    });
  }

  /**
   * The progression/economy surface, reached over the player's own socket so it is
   * keyed to an authenticated session rather than a query string. Every branch here
   * returns a small payload and pushes an updated profile, which means the client
   * never has to guess what a purchase or a level cost — it is told.
   */
  loop(
    id: string,
    msg: {
      action: string;
      kind?: 'chip' | 'item';
      stockId?: string;
      itemId?: string;
      questId?: string;
      nodeId?: string;
      dungeonId?: string;
      tier?: number;
      damage?: number;
      npcId?: string;
      waveId?: string;
      door?: string;
      cards?: string[];
      flag?: string;
    },
  ): { ok: boolean; reason?: string; [k: string]: unknown } {
    const p = this.players.get(id);
    if (!p) return { ok: false, reason: 'not connected' };
    const volume = this.volume.mon;

    switch (msg.action) {
      case 'profile':
        return { ok: true, profile: this.profileFor(id) };

      case 'shop':
        return { ok: true, shops: this.profiles.shops(p.tokenId, p.sector, volume), wav: this.profiles.doc(p.tokenId).bag.wav };

      case 'buy': {
        if (!msg.stockId || !msg.kind) return { ok: false, reason: 'missing line' };
        const res = this.profiles.buy(p.tokenId, p.sector, msg.kind, msg.stockId, volume, Date.now(), p.build.library);
        p.save = this.saves.get(p.tokenId);
        this.notifyProfile(id);
        if (res.ok && res.line) this.announce(`${p.build.callsign} bought ${res.line.name}`, p.sector);
        return { ...res, save: p.save };
      }

      case 'sell': {
        if (!msg.stockId) return { ok: false, reason: 'missing card' };
        const res = this.profiles.sell(p.tokenId, msg.stockId, [p.build.signature]);
        p.save = this.saves.get(p.tokenId);
        this.notifyProfile(id);
        return res;
      }

      case 'use': {
        if (!msg.itemId) return { ok: false, reason: 'missing item' };
        const res = this.profiles.use(p.tokenId, msg.itemId as never);
        // A field heal lands on the session this player is actually standing in.
        if (res.ok && res.effect?.heal) {
          const healed = this.sessionOf(id)?.heal(id, res.effect.heal) ?? 0;
          if (healed > 0) this.pushTo(id, { t: 'duel', kind: 'tick', view: this.sessionOf(id)!.view(id), events: [{ type: 'drain', owner: id, amount: healed }] });
        }
        this.notifyProfile(id);
        return res;
      }

      case 'turn':
        // Quests are handed in *to a person*, standing in front of them. A button that paid
        // from anywhere would make the person pointless.
        return { ok: false, reason: 'report it in person — the quest log says to whom' };

      case 'npc.talk':
        return msg.npcId ? this.talk(p, msg.npcId) : { ok: false, reason: 'talk to whom?' };

      case 'quest.accept':
        return msg.questId && msg.npcId ? this.acceptQuest(p, msg.questId, msg.npcId) : { ok: false, reason: 'missing quest' };

      case 'quest.turnin':
        return msg.questId && msg.npcId ? this.turnInQuest(p, msg.questId, msg.npcId) : { ok: false, reason: 'missing quest' };

      case 'door.enter':
        return msg.door ? this.enterDoor(p, msg.door) : { ok: false, reason: 'which door?' };

      case 'wave.collect':
        return msg.waveId ? this.catchWave(p, msg.waveId) : { ok: false, reason: 'which wave?' };

      case 'area.open': {
        // A fold is data, not a door: it opens from the menu wherever you are standing. Walking to
        // the Fold Gate is how you find it the first time, not a toll the server collects every run.
        const dungeonId = String(msg.dungeonId ?? '');
        const guide = this.foldGuide(p, dungeonId);
        // Either this Chog opens a fold of its own, or it walks the one its party is already inside.
        const res = guide
          ? this.profiles.attachFold(p.tokenId, guide, this.fieldHpOf(p))
          : this.profiles.openDungeon(p.tokenId, dungeonId, this.fieldHpOf(p));
        if (res.ok) this.announce(`${p.build.callsign} went into ${res.area?.name}${guide ? ' after their party' : ''}`, p.sector);
        this.notifyProfile(id);
        if (res.ok && res.area) this.boardFold(p, res.area);
        return res;
      }

      case 'area.step': {
        if (!msg.nodeId) return { ok: false, reason: 'missing node' };
        if (this.sessionOf(id)?.nodeFight) return { ok: false, reason: 'leave or finish the current fight first' };
        const doc = this.profiles.doc(p.tokenId);
        if (!doc.run || doc.run.done || doc.run.failed) return { ok: false, reason: 'no active dungeon run' };
        if (this.profiles.areaEnemy(p.tokenId) && !doc.run.cleared.includes(doc.run.at)) return { ok: false, reason: 'clear the current room before moving on' };
        const res = this.profiles.stepArea(p.tokenId, msg.nodeId);
        this.notifyProfile(id);
        // The client now decides when to engage after seeing the enemy band.
        return res;
      }

      case 'area.engage': {
        const enemy = this.profiles.areaEnemy(p.tokenId);
        if (!enemy) return { ok: false, reason: 'nothing to fight here' };
        if (this.sessionOf(id)?.nodeFight) return { ok: false, reason: 'already fighting' };
        return this.duelEnter(id, 'node');
      }

      case 'area.kill': {
        // The field issued this: `armNode` is the server's own signature on a kill, and `clearCurrent`
        // refuses a tile without one, so a client cannot claim a room it never fought. The payout is
        // then read off the bodies still standing on that field — a four-person pull pays as one.
        const field = this.sessionOf(id);
        const doc = this.profiles.doc(p.tokenId);
        if (!field?.nodeFight || field.state.result !== 'win' || field.spec.areaId !== doc.area?.id || field.spec.nodeId !== doc.run?.at || doc.run?.failed) return { ok: false, reason: 'the current field has not been cleared' };
        const bodies = [...this.players.values()].filter((x) => field.has(x.id));
        const scale = bodies.length > 0 ? partyRewardScale(bodies.length, ownersOf(bodies)) : 1;
        const res = this.profiles.clearCurrent(p.tokenId, 0, scale);
        // The room's own grant is what usually moves the needle, so its level-up is said here instead
        // of only being folded into the cached number a banner reads off later.
        if (res.ok && res.grant) this.noteLevel(p, res.grant.level);
        const levelNow = this.profiles.level(p.tokenId);
        if (levelNow !== p.level) p.level = levelNow;
        if (res.ok && res.cleared) {
          const { def, first, grant } = res.cleared;
          this.announce(`${p.build.callsign} cleared ${def.name}${first ? ` — ${def.firstClear.title}` : ''}`, p.sector);
          this.pushTo(id, { t: 'dungeon', kind: 'cleared', id: def.id, name: def.name, first, title: def.firstClear.title, xp: grant?.xp ?? 0, wav: grant?.wav ?? 0, items: grant?.items ?? [] });
          if (grant) this.noteLevel(p, grant.level);
        }
        if (res.ok && res.outcome && res.outcome.kind === 'boss') {
          this.announce(`${p.build.callsign} closed the fold`, p.sector);
          this.war.add({
            tokenId: p.tokenId,
            tribe: p.tribe,
            sector: p.sector,
            points: this.profiles.warPoints({
              tier: 'anomaly',
              scale,
              hotSector: hotSector(this.volume),
              sector: p.sector,
              volumeMon: this.volume.mon,
            }) * 0.6,
            clear: true,
          });
        }
        this.notifyProfile(id);
        return res;
      }

      case 'area.close':
        this.duelLeave(id);
        return this.profiles.closeArea(p.tokenId);

      case 'area.state': {
        const view = this.profiles.areaView(p.tokenId);
        return { ok: true, ...view, enemy: this.profiles.areaEnemy(p.tokenId) };
      }

      case 'folder.save': {
        // The folder is validated against the rules and the player's own collection; a client
        // that sends a card it does not hold is told which one.
        const res = this.profiles.setFolder(p.tokenId, p.build, msg.cards ?? []);
        if (res.ok) {
          // "Equip" is a real act: a folder that fields a card the player collected, not the born set.
          const born = new Set(p.build.library);
          if ((msg.cards ?? []).some((c) => !born.has(c))) this.quest(id, [{ type: 'equip' }]);
        }
        this.notifyProfile(id);
        return res;
      }

      case 'folder.auto': {
        const cards = this.profiles.autoFolder(p.tokenId, p.build);
        this.notifyProfile(id);
        return { ok: true, cards };
      }

      case 'folder.reset':
        this.profiles.resetFolder(p.tokenId);
        this.notifyProfile(id);
        return { ok: true };

      case 'flag.set': {
        // The guide's memory: the welcome was shown, a tip was read. Idempotent, and keyed from
        // a short allow-list so a client cannot fill the save with junk.
        const key = String(msg.flag ?? '');
        if (!/^[a-z0-9:_-]{1,40}$/.test(key)) return { ok: false, reason: 'bad flag' };
        this.profiles.setFlag(p.tokenId, key);
        this.notifyProfile(id);
        return { ok: true };
      }

      case 'war':
        return { ok: true, war: this.war.view(), mine: this.war.of(p.tokenId) };

      case 'album':
        return { ok: true, album: this.profiles.albumView(p.tokenId) };

      default:
        return { ok: false, reason: `unknown action ${msg.action}` };
    }
  }

  // ---------------------------------------------------------------------------
  // The street: people, places, doors and waves
  //
  // Every one of these asks "is the player really there?" against the position the server
  // itself accepted, using the same plan the client built the city from. A forged message
  // can say it is talking to the Operator; it cannot make the Operator be next to it.
  // ---------------------------------------------------------------------------

  private anchorOf(sector: SectorId, id: string): Anchor | undefined {
    return cityOf(sector).anchors.find((a) => a.id === id);
  }

  private near(p: Player, a: Anchor, slack = 3.2): boolean {
    return p.place === 'street' && Math.hypot(p.x - a.x, p.y - a.z) <= (a.radius ?? 3) + slack;
  }

  /** Register the socket that receives things that happen to this one player. */
  onPush(id: string, fn: (m: Record<string, unknown>) => void): () => void {
    this.pushSends.set(id, fn);
    return () => this.pushSends.delete(id);
  }

  private pushTo(id: string, m: Record<string, unknown>): void {
    this.pushSends.get(id)?.(m);
  }

  private rewardLines(q: QuestDef): string[] {
    const out = [`+${q.reward.wav} WAV`, `+${xpForQuest(q.stars)} XP`];
    for (const [item, n] of Object.entries(q.reward.items ?? {})) out.push(`+${n} ${(ITEMS as Record<string, { name: string }>)[item]?.name ?? item}`);
    return out;
  }

  /**
   * Talk to someone. Talking is itself progress — an objective that says "talk to X" is
   * this — so the event is fed *before* the dialogue is built, which means a quest that
   * the conversation just completed is handed in in the same breath.
   */
  private talk(p: Player, npcId: string): { ok: boolean; reason?: string; talk?: TalkView } {
    const hit = npcOf(npcId);
    if (!hit || hit.sector !== p.sector) return { ok: false, reason: 'nobody by that name here' };
    const a = this.anchorOf(p.sector, npcId);
    if (!a || !this.near(p, a)) return { ok: false, reason: 'too far away to talk' };
    const npc = hit.npc;
    this.quest(p.id, [{ type: 'talk', target: npcId }]);
    const { ready, offers, pending } = this.profiles.talk(p.tokenId, npcId);
    const pages: string[] = [];
    const options: TalkView['options'] = [];
    let rewards: string[] | undefined;
    if (ready.length) {
      pages.push(...(ready[0]!.thanks ?? 'That is all of it. Well done.').split('\n\n'));
      rewards = this.rewardLines(ready[0]!);
      for (const r of ready.slice(0, 3)) options.push({ id: `turnin:${r.id}`, label: `Report: ${r.name}`, primary: true });
    } else if (offers.length) {
      const q = offers[0]!;
      pages.push(npc.line, ...q.text.split('\n\n'));
      rewards = this.rewardLines(q);
      options.push({ id: `accept:${q.id}`, label: `Accept: ${q.name}`, primary: true });
    } else if (pending.length) {
      pages.push(pending[0]!.doing || 'Come back when it is done.');
    } else {
      pages.push(npc.line);
    }
    if (npc.role === 'shop') options.push({ id: 'shop', label: 'Open the shop' });
    options.push({ id: 'close', label: ready.length || offers.length ? 'Not now' : 'Goodbye' });
    return { ok: true, talk: { npc: { id: npcId, name: npc.name, role: npc.role ?? 'lore', tribe: npc.tribe }, pages, options, ...(rewards ? { rewards } : {}) } };
  }

  private acceptQuest(p: Player, questId: string, npcId: string): { ok: boolean; reason?: string; name?: string } {
    const a = this.anchorOf(p.sector, npcId);
    if (!a || !this.near(p, a)) return { ok: false, reason: 'too far away' };
    const res = this.profiles.accept(p.tokenId, questId, npcId);
    if (!res.ok || !res.def) return { ok: false, reason: res.reason };
    this.notifyProfile(p.id);
    return { ok: true, name: res.def.name };
  }

  private turnInQuest(p: Player, questId: string, npcId: string): { ok: boolean; reason?: string; [k: string]: unknown } {
    const a = this.anchorOf(p.sector, npcId);
    if (!a || !this.near(p, a)) return { ok: false, reason: 'too far away' };
    const res = this.profiles.turnIn(p.tokenId, questId, npcId);
    if (!res.ok || !res.def) return { ok: false, reason: res.reason };
    p.save = this.saves.get(p.tokenId);
    const levelNow = this.profiles.level(p.tokenId);
    if (levelNow !== p.level) p.level = levelNow;
    this.announce(`${p.build.callsign} closed ${res.name}`, p.sector);
    const lv = res.reward?.level;
    if (lv) this.announce(`${p.build.callsign} reached LV ${lv.to}${lv.unlocks.length ? ` — ${lv.unlocks.join(', ')}` : ''}`, p.sector);
    this.notifyProfile(p.id);
    return { ok: true, name: res.name, wav: res.reward?.wav ?? 0, xp: res.reward?.xp ?? 0, level: lv?.to ?? null, items: res.reward?.items ?? [], thanks: res.def.thanks ?? '' };
  }

  /** Stepping through a door: an objective like "go into the Chip Shop" is this. */
  private enterDoor(p: Player, kind: string): { ok: boolean; reason?: string } {
    const door = cityOf(p.sector).anchors.find((a) => (a.kind === 'door' || a.kind === 'fold') && a.sub === kind && this.near(p, a, 5));
    if (!door) return { ok: false, reason: 'no such door here' };
    this.quest(p.id, [{ type: 'enter', target: kind }]);
    return { ok: true };
  }

  /** Catch a Mystery Wave. Once a day per token; what it pays is rolled, never asserted. */
  private catchWave(p: Player, waveId: string): { ok: boolean; reason?: string; [k: string]: unknown } {
    const a = this.anchorOf(p.sector, waveId);
    if (!a || a.kind !== 'wave') return { ok: false, reason: 'no such wave' };
    if (!this.near(p, a, 0.9)) return { ok: false, reason: 'too far to catch it' };
    const heat = this.sectors.find((s) => s.sector === p.sector)?.wave ?? 0;
    const res = this.profiles.collectWave(p.tokenId, { id: a.id, element: (a.sub ?? 'wave') as Element }, { sector: p.sector, tribe: p.tribe, heat });
    if (!res.ok || !res.roll) return { ok: false, reason: res.reason };
    this.quest(p.id, [{ type: 'collect' }]);
    this.notifyProfile(p.id);
    return { ok: true, wav: res.roll.wav, xp: res.roll.xp, items: res.roll.items, match: res.roll.match, element: a.sub };
  }

  /** Standing in a point of interest: a quest objective, and the first time, a discovery. */
  private checkPois(p: Player): void {
    for (const a of cityOf(p.sector).anchors) {
      if (a.kind !== 'poi') continue;
      const d = Math.hypot(p.x - a.x, p.y - a.z);
      const r = a.radius ?? 5;
      if (d <= r && !p.inPoi.has(a.id)) {
        p.inPoi.add(a.id);
        this.quest(p.id, [{ type: 'reach', target: a.id }]);
        const found = this.profiles.discover(p.tokenId, a.id);
        if (found?.first) {
          this.pushTo(p.id, { t: 'found', id: a.id, name: found.name, text: found.text, xp: found.xp, kind: poiOf(a.id)?.poi.kind ?? 'landmark' });
          this.notifyProfile(p.id);
        }
      } else if (d > r + 2.5) p.inPoi.delete(a.id);
    }
  }

  // ---------------------------------------------------------------------------
  // The duel
  //
  // One conversation, always initiated by the client and always answered with the whole
  // field. The client says what it wants to do; the server says what happened.
  // ---------------------------------------------------------------------------

  /** The field this player is standing on, wherever it is kept. */
  sessionOf(id: string): BattleSession | null {
    for (const s of this.sessions.values()) if (s.has(id)) return s;
    return null;
  }

  /** Standing at the Fold Gate: on the street beside it, or in the room behind the door. */
  private atFoldGate(p: Player): boolean {
    const gate = cityOf(p.sector).anchors.find((a) => a.kind === 'fold');
    if (!gate) return false;
    const at = p.place === 'room' ? p.street : { x: p.x, y: p.y };
    return Math.hypot(at.x - gate.x, at.y - gate.z) <= (gate.radius ?? 3) + 8;
  }

  /** The integrity a fold run starts on — the same bar the field will spend, gear and all. */
  private fieldHpOf(p: Player): number {
    return SF.duelStatsOf({ loadout: p.build.loadout, level: p.level }).hp;
  }

  /**
   * A party member already walking this dungeon, whose map the rest of the party should follow.
   *
   * Nobody presses the door at the same instant. Without this, the second person through it gets a
   * map generated from their own token and the party silently splits into two private folds that
   * happen to look alike.
   */
  private foldGuide(p: Player, dungeonId: string): DataArea | null {
    for (const pid of this.social.withMe(p.id)) {
      if (pid === p.id) continue;
      const q = this.players.get(pid);
      if (!q || q.sector !== p.sector) continue;
      const doc = this.profiles.doc(q.tokenId);
      const area = doc.area;
      if (area?.dungeonId === dungeonId && area && doc.run && !doc.run.done && !doc.run.failed) return area;
    }
    return null;
  }

  /**
   * Bring the party into the fold that was just opened. The map is generated from the token that
   * opened it, so four people in one dungeon can only mean the server mirroring that layout into
   * each of their saves: the same `area.id`, which is what keys a fight, and each their own run —
   * own integrity, own route, own share of the payout.
   *
   * Every member still passes through their own doors. The dungeon has to be unlocked for *their*
   * Chog and they have to be standing at the same gate, and one who fails either is told why rather
   * than quietly left on the street.
   */
  private boardFold(host: Player, area: DataArea): void {
    let aboard = 1;
    for (const pid of this.social.withMe(host.id)) {
      if (pid === host.id) continue;
      const q = this.players.get(pid);
      if (!q) continue;
      // Already on this very map is not a refusal: they came in behind somebody else's open.
      if (this.profiles.doc(q.tokenId).area?.id === area.id) continue;
      if (q.sector !== host.sector || !this.atFoldGate(q)) {
        this.pushTo(pid, { t: 'dungeon', kind: 'refused', name: area.name, reason: 'stand at the same Fold Gate as your party' });
        continue;
      }
      const res = this.profiles.attachFold(q.tokenId, area, this.fieldHpOf(q));
      if (!res.ok) {
        this.pushTo(pid, { t: 'dungeon', kind: 'refused', name: area.name, reason: res.reason ?? 'the fold will not take you' });
        continue;
      }
      this.notifyProfile(pid);
      this.pushTo(pid, { t: 'dungeon', kind: 'entered', name: area.name, host: host.build.callsign });
      aboard++;
    }
    if (aboard > 1) this.announce(`${aboard} went into ${area.name} together`, host.sector);
  }

  /** The door that leads to this district's Wave Station, where fights are begun. */
  private stationOf(sector: SectorId): Anchor | undefined {
    return cityOf(sector).anchors.find((a) => a.kind === 'door' && a.sub === 'station');
  }

  /**
   * Step onto a field. A fold node is wherever the fold put you; the sector's anomaly and the
   * Training Sim both begin at the Wave Station, so a forged message cannot start a fight from
   * the other side of the city.
   */
  duelEnter(id: string, mode: 'anomaly' | 'train' | 'node' = 'anomaly'): { ok: boolean; reason?: string } {
    const p = this.players.get(id);
    if (!p) return { ok: false, reason: 'not connected' };
    const active = this.sessionOf(id);
    if (active) {
      if (active.nodeFight !== (mode === 'node') || active.training !== (mode === 'train')) return { ok: false, reason: 'leave the current field first' };
      this.pushDuelStart(p);
      return { ok: true };
    }
    const wait = (this.downedUntil.get(id) ?? 0) - Date.now();
    if (wait > 0) return { ok: false, reason: `still recovering — ${Math.ceil(wait / 1000)}s` };

    const stats = SF.duelStatsOf({ loadout: p.build.loadout, level: p.level });
    let hp = stats.hp;
    let maxHp = hp;
    let session: BattleSession;

    const doc = this.profiles.doc(p.tokenId);
    const candidate = this.profiles.areaEnemy(p.tokenId);
    const node = candidate && doc.run && doc.run.hp > 0 && !doc.run.done && !doc.run.failed && !doc.run.cleared.includes(candidate.id) ? candidate : null;
    if (mode === 'node' && !node) return { ok: false, reason: 'no uncleared room under you' };
    if (mode !== 'node' && doc.run && !doc.run.done && !doc.run.failed) return { ok: false, reason: 'leave the dungeon before entering the station' };
    if (mode === 'node' && node) {
      // It spends the run's own integrity, not a fresh bar, and the field is keyed on the *map* as
      // well as the tile: a party walking the host's mirrored layout meets one monster here, not four,
      // and that single field is what decides how big the monster had better be.
      const run = this.profiles.doc(p.tokenId).run;
      if (run) {
        hp = Math.max(1, run.hp);
        maxHp = Math.max(hp, run.maxHp);
      }
      const key = `area:${node.areaId}:${node.id}`;
      // The node's own budget decides both its health and its bite, and the bite is anchored on the
      // volley table for *that* kind of fight — a tier-3 core hits like an anomaly, not like trash.
      const duel = duelTierOf(node.kind === 'boss' ? 'boss' : node.kind === 'elite' ? 'elite' : 'node', node.tier);
      let existing = this.sessions.get(key);
      if (!existing) {
        existing = new BattleSession(key, p.sector, {
          name: node.name,
          hp: node.hp,
          maxHp: node.hp,
          element: node.element as Element,
          archetype: node.archetype,
          power: node.power,
          node: true,
          nodeId: node.id,
          areaId: node.areaId,
          dungeonId: doc.area?.dungeonId ?? node.areaId,
          partyHp: node.kind === 'boss' ? 'boss' : 'node',
          tier: duel,
          level: node.level,
          difficulty: node.difficulty,
        });
        this.sessions.set(key, existing);
      }
      session = existing;
    } else {
      const station = this.stationOf(p.sector);
      if (!station || !this.near(p, station, 7)) return { ok: false, reason: 'step up to the Wave Station first' };
      if (mode === 'train') {
        const key = `train:${id}`;
        const boss = SF.trainingBoss(p.level, p.build.loadout.element);
        session = new BattleSession(key, p.sector, { ...boss, maxHp: boss.hp, training: true, tier: 'train' });
        this.sessions.set(key, session);
      } else {
        const sector = this.sectors.find((s) => s.sector === p.sector);
        if (!sector?.boss) return { ok: false, reason: 'the wave is quiet — nothing to pulse into' };
        let existing = this.sessions.get(p.room);
        if (existing && (!existing.matchesBoss(sector.boss) || existing.state.over)) {
          for (const other of this.players.values()) {
            if (!existing.has(other.id)) continue;
            other.inBattle = false;
            this.pushDuelEnd(other, existing, { won: false, reason: 'gone' });
          }
          this.sessions.delete(p.room);
          existing = undefined;
        }
        if (!existing) {
          const arch = SF.archetypeOf(sector.boss.archetype);
          existing = new BattleSession(p.room, p.sector, {
            name: sector.boss.archetype ? SF.ARCHETYPES[arch].name : `${sector.boss.tier.toUpperCase()} ANOMALY`,
            hp: sector.boss.hp,
            maxHp: sector.boss.maxHp,
            element: SF.ARCHETYPES[arch].element,
            ...(sector.boss.archetype ? { archetype: sector.boss.archetype } : {}),
            tier: sector.boss.tier,
            source: sector.boss,
            // The wave is the street's own difficulty dial: how high it has run decides both how much
            // of a warning you get and what level of Chog it is cut for.
            level: SF.waveBossLevel(sector.wave),
            difficulty: SF.waveDifficulty(sector.wave),
          });
          this.sessions.set(p.room, existing);
        }
        session = existing;
      }
    }

    const spec: JoinSpec = {
      stats: this.fieldStatsOf(p, session),
      tokenId: p.tokenId,
      aggro: p.build.loadout.voice.aggro ?? 0,
      resist: p.build.loadout.resist,
      folder: this.profiles.folderFor(p.tokenId, p.build),
      level: p.level,
      ...(session.nodeFight ? { hp, maxHp } : {}),
    };
    session.join({ id, name: p.build.callsign, tribe: p.tribe, wallet: p.wallet }, spec);
    if (!session.has(id)) return { ok: false, reason: 'this field has already lost your body' };
    this.fightQuests.set(id, new Set());
    this.refreshFieldParty(session);
    p.inBattle = true;
    this.pushDuelStart(p);
    return { ok: true };
  }

  private pushDuelStart(p: Player): void {
    const s = this.sessionOf(p.id);
    if (!s) return;
    const body = s.bodyOf(p.id);
    if (!body) return;
    const pool = SF.ARCHETYPES[s.archetype].pool;
    this.pushTo(p.id, {
      t: 'duel', kind: 'start', view: s.view(p.id), place: s.state.place,
      caps: SF.capsOf(body),
      moves: pool.map((id) => SF.MOVES[id]!).filter((move, i) => i === 0 || move.depth <= s.difficulty).map(({ id, name, read }) => ({ id, name, read })),
    });
  }

  /** Step off the field. Leaving mid-fight is allowed and costs nothing but the fight. */
  duelLeave(id: string, reason: 'left' | 'wiped' = 'left'): void {
    const p = this.players.get(id);
    if (!p) return;
    const s = this.sessionOf(id);
    if (s) this.syncRunHp(p, s, reason === 'wiped');
    s?.leave(id);
    if (s) this.refreshFieldParty(s);
    p.inBattle = false;
    for (const [key, sess] of this.sessions) {
      if (sess.empty) {
        this.sessions.delete(key);
        this.lastTick.delete(key);
      }
    }
    // A fold the player walks out of mid-fight is not cleared; the node simply stays.
    if (s && reason === 'left') this.pushDuelEnd(p, s, { won: false, reason: 'left' });
  }

  /** The Link ward: a storm cannot be hurt alone. `consume` is false when only peeking. */
  wardedFor(id: string, consume = true): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    const session = this.sessionOf(id);
    if (!session || session.duelTier !== 'storm') return false;
    if (!this.social.shieldHeld(id, session.occupiedCols())) return false;
    if (!consume) return !this.profiles.has(p.tokenId, 'ward');
    // A Portable Ward is the money answer to the friendship answer: it drops the shield for
    // one program, and only the server knows it was spent.
    if (this.profiles.consume(p.tokenId, 'ward')) {
      this.announce(`${p.build.callsign} burned a portable ward`, p.sector);
      return false;
    }
    return true;
  }

  battleOf(id: string): BattleSession | null {
    return this.sessionOf(id);
  }

  /** Legacy single-purpose entry points, kept so the older client and the co-op check still work. */
  enterBattle(id: string): BattleSession | null {
    const p = this.players.get(id);
    if (!p) return null;
    const r = this.duelEnter(id, this.profiles.areaEnemy(p.tokenId) ? 'node' : 'anomaly');
    return r.ok ? this.sessionOf(id) : null;
  }

  leaveBattle(id: string): void {
    this.duelLeave(id, 'left');
  }

  battleMove(id: string, col: number): void {
    this.pushTo(id, { t: 'duel', kind: 'refused', reason: 'legacy file movement is disabled; use step' });
  }

  /** Only SF verbs are reachable; placements and absolute file movement are not commands. */
  duel(id: string, msg: DuelMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    const reply = (m: Record<string, unknown>): void => this.pushTo(id, { t: 'duel', ...m });
    if ('placements' in msg || 'queue' in msg || 'col' in msg) return reply({ kind: 'refused', reason: 'legacy placements are disabled' });
    if (msg.action === 'enter') {
      if (msg.mode === 'room') {
        const doc = this.profiles.doc(p.tokenId);
        if (!doc.area || !doc.run || doc.run.failed || doc.run.done || msg.dungeonId !== (doc.area.dungeonId ?? doc.area.id) || msg.roomId !== doc.run.at) {
          return reply({ kind: 'refused', reason: 'walk to that room through the dungeon first' });
        }
      } else if (msg.dungeonId !== undefined || msg.roomId !== undefined) {
        return reply({ kind: 'refused', reason: 'room IDs are only valid inside your current dungeon' });
      }
      const r = this.duelEnter(id, msg.mode === 'room' ? 'node' : msg.mode === 'train' ? 'train' : 'anomaly');
      if (!r.ok) reply({ kind: 'refused', reason: r.reason ?? 'refused' });
      return;
    }
    if (msg.action === 'leave') return this.duelLeave(id);
    const session = this.sessionOf(id);
    const body = session?.bodyOf(id);
    if (!session || !body || session.state.over) return reply({ kind: 'refused', reason: 'not on an active field' });
    const s = session.state;
    switch (msg.action) {
      case 'step':
        if (!['left', 'right', 'back', 'forward'].includes(String(msg.dir))) return reply({ kind: 'refused', reason: 'invalid step' });
        SF.step(s, id, msg.dir!);
        break;
      case 'pick': {
        // A dealt hand is readable from the join but pickable only inside the screen: the gauge is
        // what opens it, and a client that claims otherwise gets a refusal it can show the player.
        const check =
          body.custom && body.customOpen && Number.isInteger(msg.cell)
            ? SF.canPick(body.custom, msg.cell!, SF.capsOf(body))
            : { ok: false, reason: body.custom && !body.customOpen ? ('closed' as const) : ('empty' as const) };
        const ok = check.ok && SF.pickCard(s, id, msg.cell!);
        // Tapping a card fires it: there is no separate Execute step to take.
        if (ok) SF.execute(s, id);
        reply({ kind: 'pick', ok, ...(!ok ? { reason: check.reason } : {}) });
        break;
      }
      case 'undo': SF.undoCard(s, id); break;
      case 'clear': SF.clearCards(s, id); break;
      case 'execute':
        reply({ kind: 'program', ok: SF.execute(s, id) });
        break;
      case 'buster':
        if (typeof msg.down !== 'boolean') return reply({ kind: 'refused', reason: 'buster needs a press or release' });
        if (msg.down) SF.pressBuster(s, id);
        else SF.releaseBuster(s, id);
        reply({ kind: 'buster', ok: SF.canAct(body) });
        break;
      case 'cover': {
        if (msg.with !== null && typeof msg.with !== 'string') return reply({ kind: 'cover', ok: false, reason: 'not-down' });
        const target = msg.with === null ? null : session.bodyOf(msg.with!);
        if (msg.with !== null && !target) return reply({ kind: 'cover', ok: false, reason: 'not-down' });
        const check = target ? SF.canRevive({ partySize: s.players.length, downed: { file: target.file, alive: !target.down }, rescuer: { file: body.file, alive: !body.down } }) : { ok: true };
        if (check.ok) SF.setCover(s, id, msg.with!);
        reply({ kind: 'cover', ok: check.ok, ...(check.reason ? { reason: check.reason } : {}), ...(target && check.ok ? { target: target.id } : {}) });
        break;
      }
      default: return reply({ kind: 'refused', reason: 'unsupported duel action' });
    }
    reply({ kind: 'tick', view: session.view(id), events: [] });
  }

  /**
   * Chat. Three channels: the city (everyone, and kept so a rejoin does not land in silence), the
   * party (its members only) and a whisper (one person, and the sender). A player may say six
   * things in ten seconds; the seventh is told to slow down rather than silently dropped.
   */
  say(id: string, channel: string, text: string, to?: string): { ok: boolean; reason?: string } {
    const p = this.players.get(id);
    if (!p) return { ok: false };
    const clean = String(text).slice(0, 160).replace(/[\x00-\x1f]/g, '');
    if (!clean.trim()) return { ok: false };
    const now = Date.now();
    const recent = (this.chatTimes.get(id) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_BURST) return { ok: false, reason: 'slow down a little' };

    let rcpt: string[] | undefined;
    let toName: string | undefined;
    let ch = 'global';
    if (channel === 'party') {
      const party = this.social.partyOf(id);
      if (!party) return { ok: false, reason: 'you are not in a party — invite someone from the PARTY page' };
      ch = 'party';
      rcpt = [...party.members];
    } else if (channel === 'whisper') {
      const wanted = String(to ?? '').trim().toLowerCase();
      const bare = wanted.replace(/^#/, '');
      const target = wanted ? [...this.players.values()].find((o) => o.id !== id && (o.build.callsign.toLowerCase() === wanted || o.id === to || String(o.tokenId) === bare)) : undefined;
      if (!target) return { ok: false, reason: wanted ? `nobody here is called ${to}` : 'whisper to whom?' };
      ch = 'whisper';
      rcpt = [id, target.id];
      toName = target.build.callsign;
    }
    recent.push(now);
    this.chatTimes.set(id, recent);

    const line: ChatLineData = { id, name: p.build.callsign, channel: ch, text: clean, ts: now, tribe: p.tribe, ...(toName ? { to: toName } : {}), ...(rcpt ? { rcpt } : {}) };
    if (ch === 'global') {
      this.chatLog.push(line);
      if (this.chatLog.length > 60) this.chatLog.splice(0, this.chatLog.length - 60);
    }
    this.emitChat(line);
    this.profiles.countFor(p.tokenId, 'chats');
    this.quest(id, [{ type: 'chat' }]);
    return { ok: true };
  }

  private readonly chatTimes = new Map<string, number[]>();

  /** A line from the street itself, used by quests, level-ups and war turns. */
  announce(text: string, sector?: SectorId): void {
    const line: ChatLineData = { id: 'system', name: 'WAVE', channel: 'system', text: String(text).slice(0, 160), ts: Date.now() };
    this.chatLog.push(line);
    if (this.chatLog.length > 60) this.chatLog.splice(0, this.chatLog.length - 60);
    this.emitChat(line);
  }

  private emitChat(line: ChatLineData): void {
    this.chatListeners.forEach((fn) => fn(line));
  }

  readonly social = new Social();
  private chatListeners = new Set<(l: ChatLineData) => void>();

  onChat(fn: (l: ChatLineData) => void): () => void {
    this.chatListeners.add(fn);
    return () => this.chatListeners.delete(fn);
  }

  history(limit = 20) {
    return this.chatLog.slice(-limit);
  }

  // ---------------------------------------------------------------------------
  // The party
  // ---------------------------------------------------------------------------

  /** A party as its members see it: leader first, with who they are and how far along. */
  partyView(id: string): PartyMsg {
    const party = this.social.partyOf(id);
    const members = (party?.members ?? [])
      .map((m) => this.players.get(m))
      .filter((p): p is Player => !!p)
      .map((p) => ({ id: p.id, name: p.build.callsign, tribe: p.tribe, sector: p.sector, level: p.level, hp: Math.round(p.hp) }));
    return { t: 'party', members, leader: party?.members[0] ?? '', warded: true };
  }

  /** Tell everyone in a party (or the one player who just left it) how it stands now. */
  private pushParty(ids: Iterable<string>, extra: Partial<PartyMsg> = {}): void {
    for (const m of ids) this.pushTo(m, { ...this.partyView(m), ...extra });
  }

  /**
   * The conversation about parties. The client asks (invite, accept, decline, leave, kick) and the
   * server decides; whoever it concerns is told, and the roster goes out to the whole party, so
   * nobody's screen can disagree about who is in it.
   */
  partyAction(id: string, msg: { action?: string; with?: string }): void {
    const me = this.players.get(id);
    if (!me) return;
    const other = msg.with ? this.players.get(String(msg.with)) : undefined;
    switch (msg.action) {
      case 'invite': {
        if (!other) return void this.pushTo(id, { ...this.partyView(id), refused: 'that player is gone' });
        const r = this.social.invite(id, other.id);
        if (!r.ok) return void this.pushTo(id, { ...this.partyView(id), refused: r.reason });
        this.pushTo(other.id, { ...this.partyView(other.id), invite: { from: id, name: me.build.callsign } });
        this.pushTo(id, { ...this.partyView(id), notice: `invited ${other.build.callsign}` });
        return;
      }
      case 'accept': {
        const r = this.social.acceptInvite(id);
        if (!r.ok || !r.party) return void this.pushTo(id, { ...this.partyView(id), refused: r.reason });
        const joined = me.build.callsign;
        this.refreshParties();
        this.pushParty(r.party.members, { notice: `${joined} joined the party` });
        return;
      }
      case 'decline': {
        const from = this.social.declineInvite(id);
        if (from) this.pushTo(from, { ...this.partyView(from), notice: `${me.build.callsign} declined` });
        this.pushTo(id, { ...this.partyView(id) });
        return;
      }
      case 'leave':
        this.leaveParty(id);
        return;
      case 'kick': {
        if (!other) return;
        const r = this.social.kick(id, other.id);
        if (!r.ok) return void this.pushTo(id, { ...this.partyView(id), refused: r.reason });
        this.refreshParties();
        this.pushTo(other.id, { ...this.partyView(other.id), notice: 'you were removed from the party' });
        this.pushParty(this.social.withMe(id), { notice: `${other.build.callsign} was removed` });
        return;
      }
    }
  }

  /** Step out of a party (or drop out of it by closing the page) and tell whoever is left. */
  leaveParty(id: string): void {
    const before = this.social.partyOf(id);
    const left = this.players.get(id);
    const rest = before?.members.filter((m) => m !== id) ?? [];
    this.social.unlink(id);
    this.refreshParties();
    this.pushTo(id, { ...this.partyView(id), notice: before ? 'you left the party' : '' });
    if (rest.length) this.pushParty(this.social.partyOf(rest[0]!)?.members ?? rest, left ? { notice: `${left.build.callsign} left the party` } : {});
  }

  /**
   * Voice is peer to peer; the server only carries the introductions (offer, answer, ICE) between
   * two members of the same party. It never reads them and refuses to pass them to anyone else, so
   * a stranger cannot be dialled and a party cannot be listened in on from outside.
   */
  relayRtc(id: string, msg: { to?: string; kind?: string; data?: unknown }): void {
    const to = String(msg.to ?? '');
    if (!to || to === id || !this.social.withMe(id).includes(to)) return;
    const kind = String(msg.kind ?? '');
    if (!['hello', 'offer', 'answer', 'ice', 'bye'].includes(kind)) return;
    this.pushTo(to, { t: 'rtc', from: id, kind, data: msg.data ?? null });
  }

  /** Everyone connected, with what they are doing. Derived, never stored. */
  roster(): Presence[] {
    return [...this.players.values()].map((p) =>
      this.social.presence(p, this.sessions.get(p.room) && p.inBattle ? 'battle' : p.inBattle ? 'trading' : 'street'),
    );
  }

  /**
   * Move cards between two players in one pass.
   *
   * Both sides are written from the same read, so a card cannot end up in two
   * folders. The Social layer already proved both parties still hold what they
   * promised; this is the only place the transfer actually happens.
   */
  swapCards(from: string, to: string, give: string[], take: string[]): boolean {
    const a = this.players.get(from);
    const b = this.players.get(to);
    if (!a || !b) return false;
    // A Chog's own signature card leaves with the token, not with a trade. Without
    // this, holding the NFT would be a temporary loan.
    if (take.includes(a.build.signature) || give.includes(b.build.signature)) return false;
    const mine = a.save.chips;
    const theirs = b.save.chips;
    if (!take.every((c) => mine.includes(c)) || !give.every((c) => theirs.includes(c))) return false;
    a.save.chips = [...mine.filter((c) => !take.includes(c)), ...give];
    b.save.chips = [...theirs.filter((c) => !give.includes(c)), ...take];
    this.saves.setChips(a.tokenId, a.save.chips);
    this.saves.setChips(b.tokenId, b.save.chips);
    this.saves.chapter(a.tokenId, 'trade', `traded ${take.join('+') || 'nothing'} for ${give.join('+') || 'nothing'}`);
    this.saves.chapter(b.tokenId, 'trade', `traded ${give.join('+') || 'nothing'} for ${take.join('+') || 'nothing'}`);
    for (const [x, other] of [[a, b], [b, a]] as [Player, Player][]) {
      this.profiles.countFor(x.tokenId, 'trades');
      this.quest(x.id, [{ type: 'trade' }]);
      // Cards are also collection entries: a trade is a sighting for both sides.
      this.profiles.sight(x.tokenId, keysOfSource(other.attributes));
      this.notifyProfile(x.id);
    }
    return true;
  }

  /** Weekly tribe standings, counted from who is online and what they have done. */
  tribeTally(): { tribe: string; score: number; members: number }[] {
    const byTribe = new Map<string, { score: number; members: number }>();
    for (const p of this.players.values()) {
      const t = p.build.loadout.element;
      const cur = byTribe.get(t) ?? { score: 0, members: 0 };
      cur.score += p.save.kills;
      cur.members += 1;
      byTribe.set(t, cur);
    }
    return this.social
      .tally(new Map([...byTribe.entries()].map(([k, v]) => [k as never, v.score])) as never)
      .map((r) => ({ ...r, members: byTribe.get(r.tribe)?.members ?? 0 }));
  }

  private push(evs: WaveEvent[]): void {
    for (const e of evs) this.seen[e.kind] = (this.seen[e.kind] ?? 0) + 1;
    this.emit(ingest(this.sectors, evs, Date.now()));
  }

  private emit(sigs: SectorSignal[]): void {
    for (const s of sigs) {
      for (const l of this.signals) l(s);
      if (s.type === 'ravaged') {
        for (const p of this.players.values()) {
          if (p.sector === s.sector) p.save = this.saves.recordRout(p.tokenId);
        }
      }
    }
  }

  /**
   * Priced sales open anomalies. The window is deliberately short — one minute —
   * because a Front is "three sales in eighteen seconds", and feeding the
   * classifier a whole afternoon would turn every historical whale into a live
   * event the moment the server booted.
   */
  private onFills(fills: SaleFact[]): void {
    const now = Date.now();
    this.fills = [...this.fills, ...fills].filter((f) => now - f.ts < 60_000);
    if (!fills.length) return;
    for (const trigger of classify(this.fills)) {
      const sigs = openAnomaly(
        this.sectors,
        trigger.sector,
        trigger.archetype,
        trigger.hp,
        trigger.cause,
        now,
        trigger.label,
      );
      for (const f of fills) {
        this.ticks.push({
          tokenId: f.tokenId,
          mon: Math.round(f.mon),
          ts: f.ts,
          tx: `${f.txHash.slice(0, 6)}…${f.txHash.slice(-4)}`,
        });
      }
      if (this.ticks.length > 24) this.ticks.splice(0, this.ticks.length - 24);
      this.emit(sigs);
      this.recent.push({
        sector: trigger.sector,
        label: trigger.label,
        ts: now,
        cause: trigger.cause[0]?.txHash ?? '',
      });
      if (this.recent.length > 40) this.recent.splice(0, this.recent.length - 40);
      // Standing in the sector when the floor moves is an objective, and the reason
      // players camp a district instead of a boss.
      for (const p of this.players.values()) {
        if (p.sector !== trigger.sector) continue;
        this.quest(p.id, [{ type: 'witnessSale', sector: trigger.sector, amount: fills.length }]);
      }
      console.log(`[anomaly] ${trigger.sector} ${trigger.label}`);
    }
  }

  /** The event log the bottom screen scrolls. Bounded so a long uptime cannot grow it. */
  recentAnomalies(limit = 8): { sector: SectorId; label: string; ts: number; cause: string }[] {
    return this.recent.slice(-limit);
  }

  surge(n?: number): void {
    this.feed.surge(n);
  }

  /**
   * Open an anomaly from a sale that did not happen, for demos and for the test
   * suite. The txHash is deliberately not a hex string so nothing downstream can
   * render it as a linkable transaction.
   */
  simulateSale(mon = 12_000, tokenId = 1, count = 1): number {
    const now = Date.now();
    const fills: SaleFact[] = Array.from({ length: count }, (_, i) => ({
      txHash: `simulated:${now.toString(36)}:${i}`,
      block: 0,
      ts: now,
      tokenId: tokenId + i,
      mon,
      seller: '0x' + 's'.repeat(40),
      buyer: '0x' + 'b'.repeat(40),
    }));
    this.onFills(fills);
    return fills.length;
  }

  setHeat(m: number): void {
    this.feed.setHeat(m);
  }

  /**
   * Puts the world back to a filmable state: waves at zero and no post-clear
   * lockout. The 90s lockout is right for players but means a second take of the
   * demo video shows nothing, and the integration suite needs a known start.
   */
  reset(): void {
    for (const s of this.sectors) {
      s.wave = 0;
      s.peakWave = 0;
      s.tier = 'normal';
      s.boss = null;
      s.lockoutUntil = 0;
    }
  }

  onSignal(fn: (s: SectorSignal) => void): () => void {
    this.signals.add(fn);
    return () => this.signals.delete(fn);
  }

  onSnapshot(playerId: string, fn: (s: WorldSnapshot) => void): () => void {
    this.listeners.set(playerId, fn);
    return () => this.listeners.delete(playerId);
  }

  /**
   * What one player is allowed to see: their own room's players, plus the whole
   * world's sector state. The Wave Index is global on purpose — knowing that
   * Voltgrid is at 95 while you stand in Ashflat is what makes you travel there.
   */
  snapshot(forPlayerId?: string): WorldSnapshot {
    const me = forPlayerId ? this.players.get(forPlayerId) : undefined;
    const visible = me
      ? [...(this.rooms.get(me.room)?.players ?? [])]
          .map((id) => this.players.get(id))
          .filter((p): p is Player => !!p)
      : [...this.players.values()];
    // Whoever is inside a building is not on the street, whatever their room coordinates say.
    const onStreet = visible.filter((p) => p.place === 'street');
    return {
      sectors: this.sectors,
      players: onStreet.map(({ build, save: _s, room: _r, street: _st, at: _at, inPoi: _ip, place: _pl, ...rest }) => ({ ...rest, name: build.callsign })),
      feed: { mode: this.feed.mode, describe: this.feed.describe(), seen: { ...this.seen } },
      room: me?.room,
      anomalies: this.recentAnomalies(),
      market: [...this.ticks],
      roster: this.roster(),
      tribes: this.tribeTally(),
      chat: this.chatLog.slice(-14).map(({ name, channel, text, ts }) => ({ name, channel, text, ts })),
      ts: Date.now(),
    };
  }

  private broadcast(): void {
    const byRoom = new Map<string, WorldSnapshot>();
    for (const room of this.rooms.values()) {
      byRoom.set(room.id, this.snapshot([...room.players][0]));
    }
    for (const [playerId, listener] of this.listeners) {
      const p = this.players.get(playerId);
      if (!p) continue;
      listener(byRoom.get(p.room) ?? this.snapshot(p.id));
    }
  }

  /** Least crowded open room in a sector, or a new instance once they are full. */
  private assignRoom(sector: SectorId): Room {
    let best: Room | null = null;
    for (const room of this.rooms.values()) {
      if (room.sector !== sector) continue;
      if (room.players.size < ROOM_CAP && (!best || room.players.size < best.players.size)) best = room;
    }
    if (best) return best;
    const instance = [...this.rooms.values()].filter((r) => r.sector === sector).length + 1;
    const room: Room = { id: `${sector}#${instance}`, sector, players: new Set() };
    this.rooms.set(room.id, room);
    return room;
  }

  /**
   * Admit a player. Two things happen here that did not before a real trait index
   * existed: the Chog's attributes come from the collection's own metadata (or are
   * predicted from its id, labelled as such), so `deriveBuild` finally has traits to
   * read — and the token's birth element decides which Tribe it fights for.
   *
   * Joining is also the Album's sighting event: the newcomer's traits are folded into
   * every observer's log, which is the mechanic that makes walking a crowded street
   * worth doing.
   */
  join(id: string, source: ChogSource, sector: SectorId, wallet: string | null = null): Player {
    const known = traits.for(source.tokenId);
    if (!source.attributes || !Object.keys(source.attributes).length) {
      source = { ...source, attributes: known.attributes };
    }
    const build = deriveBuild(source);
    const room = this.assignRoom(sector);
    // Arrive at the district's own spawn, with a little scatter so a crowd logging in
    // does not stand in one place.
    const arrival = arrivalFor(cityOf(sector), null);
    const p: Player = {
      id,
      tokenId: source.tokenId,
      wallet: wallet ?? null,
      sector,
      room: room.id,
      x: arrival.x + (Math.random() - 0.5) * 5,
      y: arrival.z + (Math.random() - 0.5) * 5,
      vx: 0,
      facing: 1,
      heading: Math.PI,
      anim: 'idle',
      hp: 100,
      laserCharge: 0,
      bestProgram: 0,
      build,
      save: this.saves.get(source.tokenId),
      inBattle: false,
      tribe: build.loadout.element,
      traitsSource: known.source,
      attributes: source.attributes ?? {},
      level: this.profiles.level(source.tokenId),
      place: 'street',
      street: { x: 0, y: 0 },
      at: Date.now(),
      inPoi: new Set(),
    };
    p.street = { x: p.x, y: p.y };
    this.players.set(id, p);
    room.players.add(id);

    // Owning the token fills its own entries; that is the floor of the Album, and the
    // reason a holder starts ahead of anybody who does not.
    this.profiles.sight(p.tokenId, keysOfSource(source.attributes));
    this.profiles.ensureBounties(p.tokenId, [...SECTORS]);
    p.level = this.profiles.level(p.tokenId);
    // Everyone already in the room just met a new Chog, and the newcomer met them.
    for (const other of room.players) {
      const op = this.players.get(other);
      if (!op || op.id === id) continue;
      if (this.profiles.sight(op.tokenId, keysOfSource(p.attributes)).added.length) this.notifyProfile(op.id);
      if (this.profiles.sight(p.tokenId, keysOfSource(op.attributes)).added.length) this.notifyProfile(p.id);
    }
    this.profiles.questEvents(p.tokenId, [{ type: 'visit', sector }]);
    return p;
  }

  /** Register the socket that receives this player's progression pushes. */
  onProfile(id: string, fn: (v: ProfileView) => void): () => void {
    this.profileSends.set(id, fn);
    return () => this.profileSends.delete(id);
  }

  profileFor(id: string): ProfileView | null {
    const p = this.players.get(id);
    if (!p) return null;
    return this.profiles.view(p.tokenId, p.sector, this.volume.mon, p.build);
  }

  notifyProfile(id: string): void {
    const send = this.profileSends.get(id);
    const view = this.profileFor(id);
    if (send && view) send(view);
  }

  /** Feed game events into a player's quests and push the log if anything changed. */
  private quest(id: string, evs: Parameters<Profiles['questEvents']>[1]): string[] {
    const p = this.players.get(id);
    if (!p) return [];
    const done = this.profiles.questEvents(p.tokenId, evs);
    if (p.inBattle && done.length) this.trackFightQuests(id, done);
    if (done.length) {
      this.announce(`objective complete — report to ${done.join(' / ')}`, p.sector);
      this.notifyProfile(id);
    }
    return done;
  }

  leave(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.duelLeave(id);
    this.leaveParty(id);
    this.chatTimes.delete(id);
    this.downedUntil.delete(id);
    this.fightQuests.delete(id);
    this.pushSends.delete(id);
    this.players.delete(id);
    this.listeners.delete(id);
    // The profile sender is per-socket, so a reconnect without this would leave a
    // closed socket in the map and a stale closure pushing to nothing.
    this.profileSends.delete(id);
    const room = this.rooms.get(p.room);
    if (room) {
      room.players.delete(id);
      // Empty instances are dropped rather than kept as holes: the instance number
      // is reused, so a server that churns players does not accumulate rooms.
      if (!room.players.size) this.rooms.delete(room.id);
    }
  }

  /**
   * Moving between sectors without going through join. Re-joining built a fresh
   * Player, which silently wiped the laser charge mid-fight — the co-op check
   * caught it because switching sectors is how you chase a boss.
   */
  switchSector(id: string, sector: SectorId): Player | null {
    const p = this.players.get(id);
    if (!p || p.sector === sector) return p ?? null;
    this.duelLeave(id);
    const from = this.rooms.get(p.room);
    if (from) {
      from.players.delete(id);
      if (!from.players.size) this.rooms.delete(from.id);
    }
    const room = this.assignRoom(sector);
    room.players.add(id);
    const came = p.sector;
    p.sector = sector;
    p.room = room.id;
    // Crossing a gate puts you just inside the matching gate of the next district. The
    // client computes the same point from the same plan, so nothing is sent.
    const arrival = arrivalFor(cityOf(sector), came);
    p.x = arrival.x;
    p.y = arrival.z;
    p.place = 'street';
    p.street = { x: p.x, y: p.y };
    p.at = Date.now();
    p.inPoi = new Set();
    // Visiting is an objective, and changing district is how you meet new Chogs.
    this.quest(id, [{ type: 'visit', sector }]);
    for (const other of room.players) {
      const op = this.players.get(other);
      if (!op || op.id === id) continue;
      if (this.profiles.sight(op.tokenId, keysOfSource(p.attributes)).added.length) this.notifyProfile(op.id);
      if (this.profiles.sight(p.tokenId, keysOfSource(op.attributes)).added.length) this.notifyProfile(p.id);
    }
    return p;
  }

  /**
   * The client proposes a position; the server decides whether it is possible.
   *
   * This used to be a bare Object.assign, which meant any client could teleport,
   * claim 4000 hp, or set an animation the renderer does not have. Speed is
   * clamped against the last accepted position rather than trusting `vx`, because
   * `vx` is also client-supplied.
   */
  move(id: string, patch: Partial<Pick<Player, 'x' | 'y' | 'vx' | 'facing' | 'heading' | 'anim' | 'hp' | 'place'>>): void {
    const p = this.players.get(id);
    if (!p) return;
    const now = Date.now();
    // Stepping through a door swaps coordinate systems. The street position is parked
    // and restored, so a round trip through the shop cannot be used to teleport.
    if ((patch.place === 'room' || patch.place === 'street') && patch.place !== p.place) {
      if (patch.place === 'room') p.street = { x: p.x, y: p.y };
      else {
        p.x = p.street.x;
        p.y = p.street.y;
      }
      p.place = patch.place;
      p.at = now;
      return;
    }
    if (typeof patch.x === 'number' && Number.isFinite(patch.x) && typeof patch.y === 'number' && Number.isFinite(patch.y)) {
      const b = p.place === 'room' ? ROOM : boundsOf(p.sector);
      let nx = Math.max(b.x0, Math.min(b.x1, patch.x));
      let ny = Math.max(b.z0, Math.min(b.z1, patch.y));
      if (p.place === 'street') {
        // Speed is checked against the last position the server accepted, not the `vx` the
        // client reports: a client that asks to be 40 units away is walked there at run
        // speed, which is also why a quest step cannot be satisfied by teleporting to it.
        const dt = Math.max(0.05, Math.min(1, (now - p.at) / 1000));
        const reach = MAX_SPEED * dt + 2.5;
        const dx = nx - p.x;
        const dz = ny - p.y;
        const d = Math.hypot(dx, dz);
        if (d > reach) {
          nx = p.x + (dx / d) * reach;
          ny = p.y + (dz / d) * reach;
        }
      }
      p.x = nx;
      p.y = ny;
      p.at = now;
    }
    if (typeof patch.vx === 'number' && Number.isFinite(patch.vx)) {
      p.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, patch.vx));
    }
    if (patch.facing === 1 || patch.facing === -1) p.facing = patch.facing;
    if (typeof patch.heading === 'number' && Number.isFinite(patch.heading)) {
      p.heading = ((patch.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    }
    if (typeof patch.anim === 'string' && ANIMS.has(patch.anim)) p.anim = patch.anim;
    if (typeof patch.hp === 'number' && Number.isFinite(patch.hp)) {
      p.hp = Math.max(0, Math.min(100, patch.hp));
    }
    if (p.place === 'street') this.checkPois(p);
  }

  /** Legacy fire/laser packets never score placements or touch a sector. */
  fire(
    id: string,
    sector: SectorId,
    placements: Placement[],
    laser = false,
  ): { damage: number; multiplier: number; charge: number; laser: boolean; reason?: string } | null {
    const p = this.players.get(id);
    if (!p) return null;
    return { damage: 0, multiplier: 1, charge: 0, laser, reason: 'legacy combat is disabled; enter a duel and use SF actions' };
  }

  /**
   * Everyone in the sector who has landed a program shares the reward, which is
   * what makes bringing a friend worth doing. Idling in a sector to farm loot
   * does not qualify.
   *
   * This is also the moment the whole loop pays: XP, WAV, the Tribe War, quest
   * objectives and the level banner all resolve here, from numbers the server measured.
   */
  private grantLoot(sector: SectorState, session: BattleSession): void {
    const identity = session.bossIdentity;
    if (!identity || this.rewardedBosses.has(identity)) return;
    this.rewardedBosses.add(identity);
    const fields = [...this.sessions.values()].filter((s) => !s.nodeFight && !s.training && s.bossIdentity === identity);
    for (const field of fields) {
      field.state.over = true;
      field.state.result = 'win';
      field.field.boss.hp = 0;
    }
    const group = [...this.players.values()].filter((p) => fields.some((s) => s.has(p.id) && s.damageOf(p.id) > 0));
    const paidTokens = new Set<number>();
    const hot = hotSector(this.volume);
    for (const w of group) {
      const own = fields.find((s) => s.has(w.id))!;
      const outcome = own.outcomeOf(w.id);
      if (!outcome || paidTokens.has(w.tokenId)) {
        w.inBattle = false;
        this.pushDuelEnd(w, own, { won: true, reason: 'cleared' });
        continue;
      }
      paidTokens.add(w.tokenId);
      const party = group.filter((p) => this.social.withMe(w.id).includes(p.id) && own.has(p.id));
      const scale = partyRewardScale(party.length, ownersOf(party));
      const cards = this.rollLoot(outcome.drop);
      const tier = own.bossTier;
      // Profile grants own card capacity and duplicate buybacks; SaveStore only records the clear.
      w.save = this.saves.recordClear(w.tokenId, tier, sector.peakWave, []);
      const reward = this.profiles.onClear({ tokenId: w.tokenId, tier, sector: sector.sector, damage: own.bestOf(w.id), scale });
      const grant = mergeGrants([reward.grant, this.profiles.grant(w.tokenId, { chips: cards })]);
      this.war.add({ tokenId: w.tokenId, tribe: w.tribe, sector: sector.sector, points: this.profiles.warPoints({ tier, scale, hotSector: hot, sector: sector.sector, volumeMon: this.volume.mon }), clear: true });
      if (party.length > 1) this.profiles.countFor(w.tokenId, 'links');
      this.trackFightQuests(w.id, this.quest(w.id, [...reward.events, ...(party.length > 1 ? [{ type: 'link' as const }] : [])]));
      this.noteLevel(w, grant.level);
      w.save = this.saves.get(w.tokenId);
      this.emit([{ type: 'reward', sector: sector.sector, tokenId: w.tokenId, tier, chips: grant.chips, kills: w.save.kills, level: w.level }]);
      w.inBattle = false;
      this.pushDuelEnd(w, own, { won: true, reason: 'cleared', grant, level: grant.level });
    }
    // A spectator still gets a results plate, but never a reward for an earlier boss's damage.
    for (const own of fields) {
      for (const w of this.players.values()) {
        if (!own.has(w.id) || group.includes(w)) continue;
        w.inBattle = false;
        this.pushDuelEnd(w, own, { won: true, reason: 'cleared' });
      }
    }
  }

  levelOf(tokenId: number): number {
    return levelOf(this.saves.get(tokenId).kills);
  }
}
