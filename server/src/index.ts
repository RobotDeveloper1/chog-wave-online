import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { BUILD_VERSION, GAME_NAME, GENESIS_SUPPLY, SECTORS, isAddress, warmDps, type ChogSource, type DuelMsg, type Placement, type SectorId } from '@chog/shared';
import { CFG, chainConfigured } from './config.ts';
import { Auth } from './auth.ts';
import { ledger } from './ledger.ts';
import { ownership } from './owners.ts';
import { holdingsView, sourceFor } from './wallet.ts';
import { World, fosterSource, type Player } from './world.ts';

const world = new World();
const auth = new Auth(ownership);
const sse = new Set<WebSocket>();

/**
 * The client is a different origin (Vite on :5173, this on :8787) and its sign-in
 * posts JSON with an `authorization` header, which is not a CORS-simple request:
 * without an answered preflight every auth call dies in the browser before it
 * reaches a handler. Nothing here uses cookies — the session is a bearer token —
 * so `*` costs nothing.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '600',
} as const;

const json = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, {
    'content-type': 'application/json',
    ...CORS,
  });
  res.end(JSON.stringify(body));
};

/** An address is 42 characters and a signature 132; past this something is wrong. */
const MAX_BODY = 8192;

/**
 * Read a small JSON body and answer the request itself when it is not. Returning
 * null means "already responded" — the caller must not write a second response.
 */
async function bodyOf(req: import('node:http').IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const bearerOf = (req: import('node:http').IncomingMessage): string => {
  const header = req.headers.authorization ?? '';
  return /^Bearer\s+/i.test(header) ? header.slice(header.search(/\s/) + 1).trim() : '';
};

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.warn('[http]', (err as Error).message);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  });
});

async function handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (url.pathname === '/health') {
    return json(res, 200, { ok: true, game: GAME_NAME, build: BUILD_VERSION, feed: world.feedMode, describe: world.snapshot().feed.describe });
  }
  if (url.pathname === '/api/world') return json(res, 200, world.snapshot());
  if (url.pathname === '/api/leaderboard') return json(res, 200, world.saves.leaderboard());

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write(`event: hello\ndata: ${JSON.stringify(world.snapshot().sectors)}\n\n`);
    const off = world.onSignal((sig) => res.write(`event: signal\ndata: ${JSON.stringify(sig)}\n\n`));
    req.on('close', off);
    return;
  }

  // ── wallet sign-in ────────────────────────────────────────────────────────────
  // Two steps because a signature has to prove control of the address, not just
  // knowledge of it: the server issues a nonce, the wallet signs it, and `verify`
  // recovers the signer with EIP-191. Anything that lets a caller claim an address
  // without signing hands out other people's Chogs.
  if (url.pathname === '/api/auth/nonce' && req.method === 'POST') {
    const body = await bodyOf(req);
    if (!body || !isAddress(body.address)) {
      return json(res, 400, { ok: false, reason: 'need a 0x address' });
    }
    return json(res, 200, { ok: true, ...auth.nonce(body.address) });
  }

  if (url.pathname === '/api/auth/verify' && req.method === 'POST') {
    const body = await bodyOf(req);
    if (!body || !isAddress(body.address) || typeof body.signature !== 'string') {
      return json(res, 400, { ok: false, reason: 'need address and signature' });
    }
    const r = await auth.verify(body.address, body.signature);
    return r.ok
      ? json(res, 200, { ok: true, session: r.token, address: r.address })
      : json(res, 401, { ok: false, reason: r.reason });
  }

  if (url.pathname === '/api/auth/session' && req.method === 'GET') {
    const address = auth.addressFor(bearerOf(req));
    return address
      ? json(res, 200, { ok: true, address })
      : json(res, 401, { ok: false, reason: 'session expired' });
  }

  if (url.pathname === '/api/auth/signout' && req.method === 'POST') {
    auth.signOut(bearerOf(req));
    return json(res, 200, { ok: true });
  }

  // Session-authenticated on purpose: this is a map of who holds which Chog, and as
  // a public endpoint it would be a free enumerator of the whole collection.
  if (url.pathname === '/api/auth/holdings' && req.method === 'GET') {
    const address = auth.addressFor(bearerOf(req));
    if (!address) return json(res, 401, { ok: false, reason: 'sign in first' });
    return json(res, 200, { ok: true, ...holdingsView(address) });
  }

  if (url.pathname === '/api/dev/surge' && req.method === 'POST') {
    world.surge(Number(url.searchParams.get('n') ?? 8));
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/dev/heat' && req.method === 'POST') {
    world.setHeat(Number(url.searchParams.get('m') ?? 1));
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/dev/fill' && req.method === 'POST') {
    // The demo lever for the headline mechanic: Chog Genesis sells ~0.48 times an
    // hour, so a judge (or a 3-minute video) cannot wait on the market.
    const n = Math.min(6, Number(url.searchParams.get('n') ?? 1));
    const mon = Number(url.searchParams.get('mon') ?? 12_000);
    const tokenId = Number(url.searchParams.get('tokenId') ?? 1);
    const opened = world.simulateSale(mon, tokenId, n);
    return json(res, 200, { ok: true, simulated: opened, sectors: world.sectors });
  }
  if (url.pathname === '/api/dev/reset' && req.method === 'POST') {
    world.reset();
    return json(res, 200, { ok: true });
  }

  // A player only ever needs two or three atlases — their own and their co-op
  // partners' — so these stream from disk instead of being bundled with the
  // client. The id is matched against ^\d+$ before it touches the filesystem.
  const sprite = url.pathname.match(/^\/chogs\/(\d{1,4})\.png$/);
  if (sprite) {
    const file = join(process.cwd(), CFG.spritesDir, `${sprite[1]}.png`);
    if (!existsSync(file)) return json(res, 404, { error: 'no atlas' });
    res.writeHead(200, {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400',
      'access-control-allow-origin': '*',
    });
    return createReadStream(file).pipe(res);
  }
  // The collection's own art: the illustration the market shows for a token. It sits on disk next
  // to the atlases and nothing served it, so every plate that wanted a face had none to show. The
  // id is matched against ^\d+$ and the extension is whitelisted before it touches the filesystem.
  const art = url.pathname.match(/^\/art\/(\d{1,4})\.(png|webp)$/);
  if (art) {
    const file = join(process.cwd(), '.data', 'art', `${art[1]}.${art[2]}`);
    if (!existsSync(file)) return json(res, 404, { error: 'no art' });
    res.writeHead(200, {
      'content-type': art[2] === 'webp' ? 'image/webp' : 'image/png',
      'cache-control': 'public, max-age=86400',
      'access-control-allow-origin': '*',
    });
    return createReadStream(file).pipe(res);
  }
  if (url.pathname === '/chogs/index.json') {
    const file = join(process.cwd(), CFG.spritesDir, 'index.json');
    if (!existsSync(file)) return json(res, 200, { tokens: [] });
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    return createReadStream(file).pipe(res);
  }

  json(res, 404, { error: 'not found' });
}

const wss = new WebSocketServer({ server, path: '/ws' });

/**
 * Keepalive. Without it a connection that dies without a close frame — wifi
 * drop, laptop sleep, a judge closing the tab on a phone — stays in the world
 * forever. That is not cosmetic: boss HP scales with the number of players in
 * the sector, so ghosts silently inflate every fight. Observed live as a storm
 * boss at 115500 hp with nobody in the room.
 */
const HEARTBEAT_MS = 15_000;
const alive = new WeakMap<WebSocket, boolean>();

const heartbeat = setInterval(() => {
  for (const sock of wss.clients) {
    if (alive.get(sock) === false) {
      sock.terminate();
      continue;
    }
    alive.set(sock, false);
    try {
      sock.ping();
    } catch {
      sock.terminate();
    }
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

const you = (p: Player) => ({
  id: p.id,
  tokenId: p.tokenId,
  sector: p.sector,
  build: p.build,
  save: p.save,
  traitsSource: p.traitsSource,
  attributes: p.attributes ?? {},
  level: p.level,
});

/** playerId -> socket, so a party or trade notice reaches the right peers. */
const sockets = new Map<string, import('ws').WebSocket>();

function sendTo(id: string, payload: unknown): void {
  const sock = sockets.get(id);
  if (sock && sock.readyState === 1) sock.send(JSON.stringify(payload));
}

wss.on('connection', (sock) => {
  let me: string | null = null;
  let offSnapshot: (() => void) | null = null;
  let offChat: (() => void) | null = null;
  let offPush: (() => void) | null = null;
  alive.set(sock, true);
  sock.on('pong', () => alive.set(sock, true));

  /** A join that will not be honoured, said plainly enough for the client to go back. */
  const reject = (reason: string): void => {
    if (sock.readyState === 1) sock.send(JSON.stringify({ t: 'rejected', reason }));
  };

  sock.on('message', (raw) => {
    // The join path awaits the chain, and an unhandled rejection takes the process
    // down with every other player's connection. Reported, never fatal.
    onMessage(raw).catch((err) => console.warn('[ws]', (err as Error).message));
  });

  async function onMessage(raw: import('ws').RawData) {
    let msg: {
      t: string;
      tokenId?: number;
      session?: string;
      sector?: SectorId;
      placements?: Placement[];
      laser?: boolean;
      action?: string;
      col?: number;
      channel?: string;
      text?: string;
      to?: string;
      kind?: string;
      data?: unknown;
      with?: string;
      giving?: string[];
      wanting?: string[];
      tradeId?: string;
    };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.t === 'join') {
      const sector = SECTORS.includes(msg.sector ?? 'ashflat') ? (msg.sector as SectorId) : 'ashflat';
      const wallet = auth.addressFor(msg.session ?? '');
      const claimed = msg.tokenId === undefined || msg.tokenId === null ? null : Number(msg.tokenId);

      /**
       * Nothing is built, and nothing is torn down, until the claim has been
       * checked. The old path took whatever tokenId arrived and handed it a player
       * with `transferCount: 0, daysHeld: 0` — so anyone could play anyone's Chog,
       * and a holder got a *weaker* build than the one their own provenance
       * deserved for asking honestly.
       */
      let source: ChogSource;
      if (claimed === null) {
        // Foster Chog: the no-NFT path stays open, the floor is ~5,260 MON.
        source = fosterSource();
      } else {
        const inCollection = Number.isInteger(claimed) && claimed >= 1 && claimed <= GENESIS_SUPPLY;
        if (!inCollection) return reject('no such chog');
        // DEV_TOKENS is the recorder's lever: a chosen token on screen with no
        // wallet, because a demo cannot wait on — or afford — a real purchase.
        const demo = CFG.devTokens && !wallet;
        if (wallet) {
          // A refusal is confirmed against the chain: the index is boot-plus-stream,
          // so a Chog that sold while this server was down would otherwise deny the
          // person standing in front of it with the right wallet.
          if (!(await auth.mayPlay(wallet, claimed))) return reject('that chog is not in this wallet');
        } else if (!demo) {
          return reject('sign in with a wallet first');
        }
        source = sourceFor(claimed, wallet);
      }

      // A second join on the same socket (sector switch, page-level re-join) used
      // to overwrite `me` and orphan the previous player: it stayed in the world
      // forever, so ghost Chogs piled up on screen. It is also now the last thing
      // that happens, so a refused join cannot evict a player already in the room.
      if (me) world.leave(me);
      const p = world.join(`${sock.url ?? ''}${Math.random().toString(36).slice(2, 8)}`, source, sector, wallet);
      me = p.id;
      sockets.set(p.id, sock);
      world.onProfile(p.id, (v) => {
        if (sock.readyState === 1) sock.send(JSON.stringify({ t: 'profile', profile: v }));
      });
      // Things that happen to this player alone: a place found, a wave caught.
      offPush?.();
      offPush = world.onPush(p.id, (m) => {
        if (sock.readyState === 1) sock.send(JSON.stringify(m));
      });
      // Chat. It was written, stored and then never delivered to anyone; a street with
      // nobody able to talk in it is not an MMO. Global and system lines reach everybody,
      // sector lines the district, local lines the instance.
      offChat?.();
      const mine = p.id;
      offChat = world.onChat((line) => {
        const self = world.players.get(mine);
        if (!self || sock.readyState !== 1) return;
        // a party line or a whisper goes only to the people it names; everything else is the city's
        const { rcpt, ...shown } = line;
        const ok = rcpt ? rcpt.includes(mine) : true;
        if (ok) sock.send(JSON.stringify({ t: 'chat', ...shown }));
      });
      // Each connection gets its own room's view rather than the whole world, so
      // a crowded sector splits across instances instead of flooding every socket.
      offSnapshot?.();
      offSnapshot = world.onSnapshot(p.id, (snap) => {
        if (sock.readyState === 1) {
          sock.send(JSON.stringify({ t: 'world', players: snap.players, sectors: snap.sectors, room: snap.room, anomalies: snap.anomalies, market: snap.market }));
        }
      });
      sock.send(JSON.stringify({
        t: 'welcome',
        you: you(p),
        world: world.snapshot(p.id),
        // What the server actually honoured. The client asked for a tokenId; this is
        // the answer to whether it got it, and as what.
        signin: { address: wallet, as: claimed === null ? 'foster' : wallet ? 'holder' : 'demo' },
      }));
      // The progression view goes out with the welcome, so the lower screen has
      // something to draw before the player's first clear.
      world.notifyProfile(p.id);
      return;
    }

    if (!me) return;

    if (msg.t === 'move') {
      const m = JSON.parse(String(raw));
      world.move(me, { x: m.x, y: m.y, vx: m.vx, facing: m.facing, heading: m.heading, anim: m.anim, hp: m.hp, place: m.place === 'room' ? 'room' : m.place === 'street' ? 'street' : undefined });
    } else if (msg.t === 'switch') {
      // Sector change without rebuilding the player, so progression and the
      // laser charge survive the trip.
      // there is one city: a request to be anywhere else is not a request the world can honour
      const want = (msg.sector ?? 'ashflat') as SectorId;
      if (!SECTORS.includes(want)) return;
      const p = world.switchSector(me, want);
      if (p) {
        // Sector change moves rooms, so rebind the stream before re-sending.
        offSnapshot?.();
        offSnapshot = world.onSnapshot(p.id, (snap) => {
          if (sock.readyState === 1) {
            sock.send(JSON.stringify({ t: 'world', players: snap.players, sectors: snap.sectors, room: snap.room, anomalies: snap.anomalies, market: snap.market }));
          }
        });
        sock.send(JSON.stringify({ t: 'welcome', you: you(p), world: world.snapshot(p.id) }));
      }
    } else if (msg.t === 'fire') {
      const res = world.fire(me, (msg.sector ?? 'ashflat') as SectorId, msg.placements ?? [], Boolean(msg.laser));
      sock.send(JSON.stringify({ t: 'hit', ...res }));
    } else if (msg.t === 'laser') {
      const res = world.fire(me, (msg.sector ?? 'ashflat') as SectorId, [], true);
      sock.send(JSON.stringify({ t: 'hit', ...res }));
    } else if (msg.t === 'loop') {
      // Progression, shop, quests, album, Data Areas and the war board, all keyed to
      // this socket's player. The reply carries what happened; the profile is pushed
      // separately so a level-up mid-fight still reaches the terminal.
      const m = JSON.parse(String(raw)) as Parameters<typeof world.loop>[1] & { t: string };
      const res = world.loop(me, m);
      sendTo(me, { t: 'loop', action: m.action, ...res });
    } else if (msg.t === 'battle') {
      // The client asks to stand on the field; the server decides whether the
      // anomaly is even there and who else is on the same instance with it.
      if (msg.action === 'enter') {
        const session = world.enterBattle(me);
        if (!session) {
          sendTo(me, { t: 'chat', id: 'system', name: '', channel: 'system', text: 'no anomaly in this sector to enter', ts: Date.now() });
        } else {
          const snap = session.snapshot();
          sendTo(me, { t: 'field', ...snap });
        }
      } else if (msg.action === 'move') {
        world.battleMove(me, Number(msg.col ?? 1));
      } else {
        world.leaveBattle(me);
      }
    } else if (msg.t === 'duel') {
      // The duel: the client says what it wants to do, the server answers with the field. The
      // reply is always a push on this socket, so there is nothing to await here.
      world.duel(me, JSON.parse(String(raw)) as DuelMsg);
    } else if (msg.t === 'chat') {
      const r = world.say(me, String(msg.channel ?? 'global'), String(msg.text ?? ''), msg.to === undefined ? undefined : String(msg.to));
      if (!r.ok) sock.send(JSON.stringify({ t: 'chat', id: me, name: '', channel: 'system', text: `not sent: ${r.reason}`, ts: Date.now() }));
    } else if (msg.t === 'link' || msg.t === 'party') {
      // "link" is the old name for asking someone to join; both go through the invitation
      const m = JSON.parse(String(raw)) as { action?: string; with?: string };
      world.partyAction(me, msg.t === 'link' ? { action: 'invite', with: String(msg.with ?? '') } : m);
    } else if (msg.t === 'unlink') {
      world.leaveParty(me);
    } else if (msg.t === 'rtc') {
      const m = JSON.parse(String(raw)) as { to?: string; kind?: string; data?: unknown };
      world.relayRtc(me, m);
    } else if (msg.t === 'trade') {
      const t = msg;
      if (t.action === 'offer' && t.with) {
        const offer = world.social.offer(me, t.with, t.giving ?? [], t.wanting ?? []);
        sendTo(t.with, { t: 'trade', action: 'incoming', tradeId: offer.id, from: me, to: t.with, giving: offer.giving, wanting: offer.wanting });
      } else if (t.action === 'accept' && t.tradeId) {
        const holdings = Object.fromEntries([...world.players.values()].map((pl) => [pl.id, pl.save.chips]));
        const r = world.social.accept(t.tradeId, me, holdings);
        if (!r.ok) {
          sendTo(me, { t: 'trade', action: 'refused', tradeId: t.tradeId, from: me, to: '', giving: [], wanting: [], reason: r.reason });
        } else {
          world.swapCards(r.swap.to, me, r.swap.give, r.swap.take);
          sendTo(r.swap.to, { t: 'trade', action: 'accepted', tradeId: t.tradeId, from: me, to: r.swap.to, giving: r.swap.take, wanting: r.swap.give });
        }
      } else if (t.action === 'cancel' && t.tradeId) {
        const offer = world.social.trades.get(t.tradeId);
        world.social.cancel(t.tradeId);
        if (offer) sendTo(offer.from === me ? offer.to : offer.from, { t: 'trade', action: 'cancelled', tradeId: t.tradeId, from: me, to: '', giving: [], wanting: [] });
      }
    } else if (msg.t === 'leave') {
      sockets.delete(me);
      world.leaveParty(me);
      world.leaveBattle(me);
      world.leave(me);
      me = null;
    }
  }

  sock.on('close', () => {
    offSnapshot?.();
    offSnapshot = null;
    offChat?.();
    offChat = null;
    offPush?.();
    offPush = null;
    if (me) {
      sockets.delete(me);
      world.leaveParty(me);
      world.leaveBattle(me);
    }
    if (me) world.leave(me);
  });
});

world.onSignal((sig) => {
  const payload = JSON.stringify({ t: 'signal', signal: sig });
  for (const c of wss.clients) if (c.readyState === 1) c.send(payload);
  for (const c of sse) if (c.readyState === 1) c.send(payload);
});

/**
 * Difficulty is priced by a Monte Carlo over the real loop, and map generation reads that price.
 * Paying it here, before the port opens, keeps the first player to ask for a Data Area from being
 * the one who pays for it. The curve is printed because a number nobody can see is a claim.
 */
const pricedAt = performance.now();
const priced = warmDps();
const byBand: Record<string, string[]> = {};
for (const p of priced) (byBand[p.band] ??= []).push(`lv${p.level}:${p.dps}`);
console.log(`difficulty priced in ${Math.round(performance.now() - pricedAt)}ms — ` + Object.entries(byBand).map(([b, v]) => `${b} dps ${v.join(' ')}`).join('  |  '));

server.listen(CFG.port, () => {
  console.log(`chog-wave server :${CFG.port}  build ${BUILD_VERSION}  feed=${world.feedMode}`);  const r = world.start();
  if (r instanceof Promise) r.catch((e) => console.error('feed start failed:', (e as Error).message));

  /**
   * The contract has no ERC721Enumerable, so "what does this wallet hold" is only
   * answerable after a read of all 1,969 owners, and "how provenanced is this Chog"
   * only after a replay of its Transfer history. Both are chain reads that take
   * seconds and minutes respectively, and neither may hold up the first connection:
   * a wallet that signs in mid-scan gets `ready: false` and a spinner rather than a
   * confident "you own nothing".
   */
  if (chainConfigured()) {
    ownership
      .scan((done) => console.log(`[owners] ${done}/${GENESIS_SUPPLY}`))
      .catch((e) => console.warn('[owners] scan failed:', (e as Error).message));
  }
  ledger
    .backfill((done, total) => {
      if (done === total || done % 100 === 0) console.log(`[provenance] ${done}/${total} windows`);
    })
    .catch((e) => console.warn('[provenance] backfill failed:', (e as Error).message));

  const prune = setInterval(() => auth.prune(), 60_000);
  prune.unref?.();
});

process.on('SIGINT', () => {
  clearInterval(heartbeat);
  world.stop();
  // The provenance pass is minutes of chain reading; the debounced write may still
  // be pending, and losing it means re-running the whole scan on the next boot.
  ledger.flush();
  server.close();
  process.exit(0);
});
