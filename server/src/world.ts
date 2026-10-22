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
  HOUSE_SPAWN,
  type HouseLayout,
  starterCard,
  SECTORS,
  VOLUME_WINDOW_MS,
  CARDS,
  CARD_BY_ID,
  isTraitCard,
  wagerPayout,
  MAX_WAGER,
  WITHDRAW_DAILY_MAX,
  type ChogBuild,
  type DropView,
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
  type ItemId,
  type Tier,
  type WaveEvent,
  type WorldSnapshot,
  keysOfSource,
  arrivalFor,
  boardSideFor,
  cityOf,
  lineLayout,
  campOf,
  allMobSpawns,
  archetypeForEncounter,
  encounterGate,
  chaseStep,
  type ChaseAnchor,
  mobAt,
  mobFacing,
  mobSpawns,
  type MobSpawn,
  walkable,
  ENCOUNTER_BY_ID,
  REGION_BY_ID,
  REGION_IDS,
  regionGate,
  encounterBudget,
  quirkOf,
  type RegionId,
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
import type { DepositFact } from './chain.ts';
import { traits } from './meta.ts';
import { Profiles, VAULT_KEY, type GrantResult, type LevelUp, type RefundLine } from './profiles.ts';
import { SaveStore, levelOf, normalizeKey, type SaveRow } from './save.ts';
import { PayoutProcessor, createViemSender, type PayoutEvent } from './payouts.ts';
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

/**
 * Where a player may stand in one region of the Line.
 *
 * The same shared function the client builds the terrain from (shared/src/line/layout.ts), for
 * the reason the comment above gives: the moment the two sides derive the walkable rectangle
 * separately, a player is walking through a wall that only one of them can see.
 */
export const boundsOfRegion = (region: RegionId) => lineLayout(region).bounds;
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
  /**
   * The save this body writes to: the wallet when signed in, `token:<id>` for a
   * visitor without one. Set once at join — a body never changes owners mid-life.
   */
  saveKey: string;
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
  place: 'street' | 'room' | 'line' | 'house';
  /**
   * Which region of the Line the player is walking, when place is 'line'.
   *
   * The Line is **not** a sector. Sectors (shflat | oltgrid | hollow) are the city
   * districts and they carry the Wave Index, the anomaly bosses and the market hooks; the Line
   * carries a different axis � six biomes walked in order � and bolting it on to SectorId would
   * mean every place that reads a sector had to learn to mean two different things by 0.
   */
  region: RegionId | null;
  /** Whose house this player is standing in, when place is 'house'. */
  houseOf: string | null;
  /** Where the street position was when the player stepped through a door. */
  street: { x: number; y: number };
  /**
   * Where the player stood in the Line when they last left it.
   *
   * Separate from street because the regions are not all at the origin: one parked slot would
   * drop you into the middle of Ash Pine when you came back out of it. This is the same
   * anti-teleport guard move() already applies to a door, extended to the six places a door
   * can now be.
   */
  lineAt: Record<string, { x: number; y: number }>;
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
    // The cap flag, not the borrowed traits: `deriveBuild` needs to know this is a foster so it
    // can hold the shape under FOSTER_SHARE_CAP. Token #1 keeps its own extremes untouched.
    foster: true,
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
    cards: grants.flatMap((g) => g.cards),
    items: grants.flatMap((g) => g.items),
    refunded: grants.flatMap((g) => g.refunded),
    level: levels.length ? { from: levels[0]!.from, to: levels.at(-1)!.to, unlocks: [...new Set(levels.flatMap((l) => l.unlocks))] } : null,
  };
}

/**
 * A piece of loot on the street.
 *
 * Loot used to land straight in the bag: you won and a menu was quietly fuller. That is a receipt.
 * A drop is the same payout with a body — it falls where you stood, it burns in its rarity colour,
 * and you walk over to take it. `owner` is why the street can be shared without the loot being:
 * everyone sees the pile, only the player it fell for can pick it up.
 */
interface Drop {
  id: string;
  owner: string;
  sector: SectorId;
  /** The Line region it fell in, or null for the city street. Regions share coordinates. */
  region: RegionId | null;
  x: number;
  z: number;
  kind: 'card' | 'item' | 'wav';
  /** The card id or item id. Absent on a money drop. */
  key?: string;
  /** For a money drop: how many WAV this pile is worth. */
  amount?: number;
  name: string;
  element?: Element;
  klass?: 'S' | 'M' | 'G';
  rarity: 'common' | 'rare' | 'epic';
  /** When it fell, so the sweep can age it without a timer per drop. */
  bornAt: number;
  /**
   * Pickup is the grant. Line loot falls unpaid (the clear marked it, the dirt pays it);
   * dungeon/fold/anomaly loot falls already paid, and its pile is the receipt. The take
   * path grants only this side — granting both would double-pay every dungeon.
   */
  deferred: boolean;
}

/** How long loot waits on the street. Long enough to finish a fight, short enough to not litter. */
const DROP_TTL_MS = 90_000;
/** How close a body has to be to take a pile it owns. */
const DROP_TAKE_RANGE = 2.2;
/** How far from the body a pile scatters, so three drops are three things and not one. */
const DROP_SCATTER = 1.15;

export class World {
  readonly sectors = createSectors();
  readonly saves = new SaveStore();
  /** XP, WAV, quests, album and the live Data Area run, all server-decided. */
  readonly profiles = new Profiles(this.saves);
  /** Automatic $CHOG payouts. Null without a vault and a hot key (manual queue then). */
  private payouts: PayoutProcessor | null = null;
  /** The weekly Tribe War ledger. */
  readonly war = new War(this.saves);
  readonly players = new Map<string, Player>();
  readonly rooms = new Map<string, Room>();
  /** One live field per room. The server, not the client, decides if a card lands. */
  readonly sessions = new Map<string, BattleSession>();
  /** playerId -> the bout waiting for their boots, read once by `duelEnter`. */
  private pendingPvp = new Map<string, { key: string; brawl: { rivalId: string; rivalName: string; challengerName: string; challengerId: string; challengerKey: string; rivalKey: string; wager: number } }>();
  /**
   * Loot lying on the street. Keyed by drop id, and owned: the street is shared, the loot is not.
   * Bounded by the TTL sweep in `broadcast`, so a busy server cannot grow this forever.
   */
  private drops = new Map<string, Drop>();
  private dropSerial = 0;
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
      (d) => this.creditDeposits(d),
    );
    this.refundStrandedEscrow();
    if (CFG.vault && CFG.hotKey) {
      this.payouts = new PayoutProcessor(this.saves, this.profiles, createViemSender(), (e) => this.onPayout(e));
      void this.payouts.recover().then(() => this.payouts?.pump());
      setInterval(() => {
        void this.payouts?.pump();
      }, 15_000);
    }
  }

  /**
   * Real $CHOG arriving at the vault. Every Transfer is recorded by tx hash before
   * anything is credited, so a re-polled window or a restart can never pay twice.
   * Dust (under one whole $CHOG) is recorded but not credited: balances are integers.
   */
  creditDeposits(facts: DepositFact[]): void {
    for (const f of facts) {
      if (this.saves.depositSeen(f.txHash)) continue;
      this.saves.depositPut(f.txHash, f.from, f.amount, f.block);
      const whole = Math.floor(f.amount);
      if (whole < 1) continue;
      this.profiles.addChog(f.from, whole);
      for (const p of this.players.values()) {
        if ((p.wallet ?? '').toLowerCase() === f.from) {
          this.pushTo(p.id, { t: 'chog', deposit: { amount: whole, tx: f.txHash } });
          this.notifyProfile(p.id);
        }
      }
    }
  }

  /**
   * Stakes left in escrow by a dead process come straight back: both sides were
   * deducted at accept, neither was paid, so the only honest settle is a refund.
   * Runs before the first connection, so no bout can settle mid-refund.
   */
  /**
   * A payout settled. Done carries the tx hash; failed already refunded the
   * ledger, so all that is left is telling the owner what happened.
   */
  private onPayout(e: PayoutEvent): void {
    for (const p of this.players.values()) {
      if ((p.wallet ?? '').toLowerCase() !== e.wallet) continue;
      this.pushTo(p.id, { t: 'chog', withdraw: { amount: e.amount, ok: e.ok, tx: e.tx || null, note: e.note || null } });
      this.notifyProfile(p.id);
    }
  }

  private refundStrandedEscrow(): void {
    const stranded = this.saves.escrowAll();
    for (const e of stranded) {
      this.profiles.addChog(e.challenger, e.wager);
      this.profiles.addChog(e.rival, e.wager);
      this.saves.escrowDel(e.key);
    }
    if (stranded.length) console.log('[escrow] refunded ' + stranded.length + ' stranded bout(s)');
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
      // One poisoned stage must not take the process — and every other player's
      // connection — down with it. Each stage is guarded, so a throw costs one
      // tick of one system, and the log names the stage that threw.
      try {
        this.emit(tick(this.sectors, now, dt, this.players.size));
      } catch (err) {
        console.error('[loop:season]', err);
      }
      try {
        this.stepSessions(Math.round(dt * 1000));
      } catch (err) {
        console.error('[loop:duel]', err);
      }
      try {
        this.sweepDrops();
      } catch (err) {
        console.error('[loop:drops]', err);
      }
      try {
        this.broadcast();
      } catch (err) {
        console.error('[loop:cast]', err);
      }
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
    return SF.applySteps(SF.duelStatsOf({ loadout: p.build.loadout, level: p.level, attrs: p.build.attrs }), SF.partySteps(seats, p.id));
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
    const doc = this.profiles.doc(p.saveKey);
    const hp = session.hpOf(p.id);
    if (!doc.run || !hp || doc.area?.id !== session.spec.areaId || doc.run.at !== session.spec.nodeId) return;
    doc.run = { ...doc.run, hp: Math.max(0, hp.hp), maxHp: hp.maxHp, failed: doc.run.failed || lost || hp.hp <= 0 };
    this.saves.writeProgress(p.saveKey, doc);
  }

  /**
   * Advance every live field, and tell the people standing on it what happened.
   *
   * Sessions are keyed by room, so a fight is scoped to the instance that started it while
   * the sector boss it damages stays shared — two instances of Voltgrid card the same
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
      if (session.brawl && session.size < 2 && Date.now() - session.createdAt > 60_000) {
        // The second pair never stepped on: dissolve the field, stakes home.
        for (const p of [...this.players.values()].filter((q) => session.has(q.id))) {
          p.inBattle = false;
          this.pushDuelEnd(p, session, { won: false, reason: 'gone' });
        }
        this.endBrawl(session, null, false, true);
        this.sessions.delete(key);
        this.lastTick.delete(key);
        continue;
      }
      const members = [...this.players.values()].filter((p) => session.has(p.id));
      this.refreshFieldParty(session);
      const { events, cleared, downed, expired, gone, signals } = session.step(dtMs, this.sectors);
      this.emit(signals);

      for (const e of events) {
        const owner = 'owner' in e && e.owner ? this.players.get(e.owner) : undefined;
        if (!owner) continue;
        if (e.type === 'hit' && e.damage > 0) {
          const chain = e.chain;
          owner.bestProgram = Math.max(owner.bestProgram, e.damage);
          this.profiles.best(owner.saveKey, e.damage, chain);
          this.trackFightQuests(owner.id, this.quest(owner.id, [{ type: 'damage', amount: Math.max(1, Math.round(e.damage / 500)) }, ...(chain ? [{ type: 'chainRun' as const, amount: chain }] : [])]));
        } else if (e.type === 'dodge') {
          this.profiles.countFor(owner.saveKey, 'dodges');
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
        if (p) this.profiles.countFor(p.saveKey, 'deaths');
      }

      // Only a body nobody picked up pays for the run: out of the fight, and off the anomaly.
      // PvP decides itself: the engine named a winner (or a draw), so settle the pot and
      // tell both plates. Nothing below applies — no lockouts, no loot, no wipes.
      if (session.state.pvp && session.state.over) {
        this.settlePvp(session, members);
        this.sessions.delete(key);
        this.lastTick.delete(key);
        continue;
      }
      for (const id of expired) {
        const p = this.players.get(id);
        if (!p) continue;
        p.inBattle = false;
        this.syncRunHp(p, session, true);
        this.downedUntil.set(id, now + SF.DEFEAT_LOCKOUT_MS);
        this.pushDuelEnd(p, session, { won: false, reason: 'wiped' });
        // Out of the corpse session: staying in it bricks the next ambush check while
        // the downed lockout covers the refight, so the loss is a pause, not a trap.
        this.duelLeave(id, 'wiped');
        if (session.brawl) this.endBrawl(session, session.state.winnerId);
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
        if (session.brawl) this.endBrawl(session, null, false, true);
        this.sessions.delete(key);
        this.lastTick.delete(key);
        continue;
      }
      if (!cleared) continue;

      for (const p of members) p.inBattle = false;
      /*
       * A Line encounter is checked FIRST, and the order is the whole fix.
       *
       * `lineEngage` builds its session with `node: true` — it is a node-shaped fight, reusing
       * `battle.ts` and the whole `sf/` machinery — so it lands in the `nodeFight` arm below. That
       * arm pays a DUNGEON run: it reads `spec.nodeId`, checks the player's own `doc.run.at`, and
       * refuses the kill when the two disagree. On the Line there is no run at all, so `valid` is
       * false, `kill` comes back null, and the arm pushes `won: false, reason: 'wiped'` — which is
       * "you killed the mob and you lost", plus a defeat lockout for good measure.
       *
       * So the discriminator cannot be `nodeFight`; it is `encounterId`, which only a Line session
       * carries. Checked before the node arm, and paying nothing here: `line.clear` is the claim,
       * and the server re-checks the session, the gate and the win before `lineCleared` pays and
       * `killLineMob` drops the purse.
       */
      if (session.spec.encounterId) {
        for (const p of members) {
          // The win is spent by `line.clear`, which arrives when the plate closes — after
          // this same step deletes the session. Bank the right to claim it here, so the
          // claim checks the win and not the corpse's session.
          // The body dies HERE, not at the claim: `pushDuelEnd` releases every mark, so a
          // kill left for `line.clear` would find no body — live, every win paid purse 0
          // and the mob stood straight back up. The purse and the ground it falls on are
          // banked with the claim, and `line.clear` spends them instead of re-killing.
          const kill = this.killLineMob(session.spec.encounterId, p.id);
          this.lineClaims.set(p.id, { encounterId: session.spec.encounterId, at: now, kill: { wav: kill.wav, x: kill.x, z: kill.z } });
          // Breath starts at the win, not the claim: the plate closes seconds later,
          // and a winner who steps first must not reopen a duel with no grace.
          this.duelGrace.set(p.id, now + 5000);
          this.pushDuelEnd(p, session, {
            won: true,
            reason: 'cleared',
            // The Line pays in loot on the ground like a fold does, and `line.clear` is what
            // actually spawns it — this flag is what keeps the two paths telling the same story.
            lootOnGround: true,
          });
        }
      } else if (session.nodeFight) {
        const nodeId = session.spec.nodeId;
        // The field decided the node died; only now does the run get paid, and only for the
        // player who owns this fold.
        for (const p of members) {
          if (!session.has(p.id)) continue;
          this.syncRunHp(p, session);
          const doc = this.profiles.doc(p.saveKey);
          const valid = doc.area?.id === session.spec.areaId && doc.run?.at === nodeId && !!doc.run && !doc.run.failed;
          // The kill is *issued* here, for the tile this field mirrors, and `area.kill` will not pay
          // without it. A body that walked off mid-fight stands on a different node, so its own arm
          // is refused and its run stays as it left it.
          const questsBefore = new Set(this.profiles.view(p.saveKey, p.sector, this.volume.mon, p.build, p.tokenId).quests.filter((q) => q.done).map((q) => q.id));
          const kill = valid && nodeId && this.profiles.armNode(p.saveKey, nodeId)
            ? this.loop(p.id, { action: 'area.kill' }) as unknown as KillReceipt
            : null;
          this.trackFightQuests(p.id, this.profiles.view(p.saveKey, p.sector, this.volume.mon, p.build, p.tokenId).quests.filter((q) => q.done && !questsBefore.has(q.id)).map((q) => q.id));
          // What the tile paid is answered by the kill itself, so the plate can show it: a body whose
          // arm was refused gets nothing, which is exactly true rather than a number guessed at.
          const receipts = [kill?.grant, kill?.cleared?.grant].filter((g): g is GrantResult => !!g);
          const paid = receipts.length ? mergeGrants(receipts) : null;
          this.pushDuelEnd(p, session, {
            won: !!kill?.ok,
            reason: kill?.ok ? 'cleared' : 'wiped',
            ...(paid ? { grant: paid, level: paid.level } : {}),
            ...(kill?.cleared ? { first: kill.cleared.first } : {}),
            // A fold room pays in loot and gets a body for it.
            lootOnGround: true,
          });
        }
      } else if (session.training) {
        for (const p of members) {
          if (!session.has(p.id)) continue;
          const res = this.profiles.onTrain(p.saveKey);
          this.trackFightQuests(p.id, this.quest(p.id, res.events));
          let grant = res.grant;
          if (res.first) {
            // a common card of the Chog's own tribe that it does not hold: the first thing to put in a deck
            const card = starterCard(p.build, this.saves.get(p.saveKey).cards);
            if (card) grant = mergeGrants([grant, this.profiles.grant(p.saveKey, { cards: [card] })]);
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
    r: { won: boolean; reason: DuelEndMsg['reason']; grant?: { xp: number; wav: number; cards: string[]; items: string[]; refunded?: RefundLine[] }; first?: boolean; level?: LevelUp | null; quests?: string[]; lootOnGround?: boolean },
  ): void {
    if (r.reason === 'wiped') this.downedUntil.set(p.id, Date.now() + SF.DEFEAT_LOCKOUT_MS);
    // A wipe that keeps its mark bricks the body the same way a leave does; the downed
    // lockout already covers the refight, this only frees the mob for everyone else.
    this.releaseLineBodies(p.id);
    const outcome = session.outcomeOf(p.id);
    const seconds = session.secondsOf(p.id);
    const rank = outcome?.rank ?? SF.emptyRank();
    const grade = outcome?.level ?? SF.rankLevel(rank, seconds);
    const msg: DuelEndMsg = {
      t: 'duel', kind: 'end', won: r.won, reason: r.reason, pvp: session.state.pvp || undefined,
      name: session.state.pvp && session.brawl ? `${session.brawl.challengerName} vs ${session.brawl.rivalName}` : session.spec.name || SF.ARCHETYPES[session.archetype].name,
      seconds,
      rank: { level: grade, letter: outcome?.letter ?? SF.rankOf(grade), counters: rank.counters, abacks: rank.abacks, read: SF.rankRead(rank, seconds) },
      drop: outcome?.drop ?? SF.dropFor(grade),
      wave: outcome?.wave ?? 0,
      cards: r.grant?.cards ?? [],
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
    p.save = this.saves.get(p.saveKey);
    this.notifyProfile(p.id);
    // The payout, made physical: what the fight just paid falls on the street where you stood.
    // Called after the profile push so the bag and the pile agree even if the client reads either.
    //
    // Only the fights that are *about* loot. Training is a practice room: it hands out a card to
    // teach the loop and then it is over, so a pile sitting on the street afterwards is a pile the
    // player will walk over expecting a dungeon reward and receive the starter card instead. An
    // anomaly and a fold both pay in loot and both get bodies for it.
    if (r.won && r.lootOnGround) this.spawnDrops(p, r.grant?.cards ?? [], r.grant?.items ?? [], r.grant?.wav ?? 0);
  }

  // ------------------------------------------------------------------ loot on the ground

  /**
   * Put the payout on the street, scattered around the body that earned it.
   *
   * The scatter is deterministic per index rather than random: three cards should sit as three
   * readable piles, and a random angle clusters them into one indistinguishable heap often enough
   * to be worth the two lines it costs to avoid.
   */
  private spawnDrops(p: Player, cards: readonly string[], items: readonly string[], wav = 0, atOverride?: { x: number; y: number } | { x: number; z: number }, regionOverride?: RegionId | null, deferred = false): void {
    const at = (p.place === 'room' || p.place === 'house') ? p.street : { x: p.x, y: p.y };
    const base = atOverride ? ('z' in atOverride ? { x: atOverride.x, y: atOverride.z } : { x: atOverride.x, y: atOverride.y }) : at;
    const region = regionOverride !== undefined ? regionOverride : (p.place === 'line' ? p.region : null);
    let i = 0;
    const place = (kind: 'card' | 'item', key: string): void => {
      const angle = (i * 2.399) % (Math.PI * 2);
      const radius = DROP_SCATTER * (0.6 + 0.4 * ((i % 3) / 2));
      i += 1;
      const id = `d${++this.dropSerial}`;
      if (kind === 'card') {
        const c = CARD_BY_ID.get(key);
        if (!c) return;
        const klass = SF.cardClass(c);
        this.drops.set(id, {
          id, owner: p.id, sector: p.sector, region,
          x: base.x + Math.cos(angle) * radius, z: base.y + Math.sin(angle) * radius,
          kind: 'card', key, name: c.name, element: c.element, deferred,
          klass: klass === 'standard' ? 'S' : klass === 'mega' ? 'M' : 'G',
          rarity: klass === 'standard' ? 'common' : klass === 'mega' ? 'rare' : 'epic',
          bornAt: Date.now(),
        });
        return;
      }
      const item = key ? (ITEMS as Record<string, { name: string }>)[key] : undefined;
      if (!item) return;
      this.drops.set(id, {
        id, owner: p.id, sector: p.sector, region,
        x: base.x + Math.cos(angle) * radius, z: base.y + Math.sin(angle) * radius,
        kind: 'item', key, name: item.name, deferred,
        rarity: 'common',
        bornAt: Date.now(),
      });
    };
    for (const c of cards) place('card', c);
    for (const it of items) place('item', it);
    // Money is loot too, and it was the one part of the payout with nothing to look at. A chest
    // that paid 400 WAV used to be a line in a log; now it is a pile on the ground that has to be
    // walked to and clicked, which is the only reason any of the rest of this reads as a reward.
    if (wav > 0) this.placeMoney(p, base, wav, region, deferred);
    if (i > 0 || wav > 0) this.pushDrops(p.id);
  }

  /**
   * A pile of WAV on the ground.
   *
   * Money was the one part of a payout with nothing to look at: a chest worth 400 WAV used to be a
   * single line in a log. It now lands with the cards, in its own green, and is taken the same way —
   * a reward you cannot see is a number, and a number is not why anybody cleared a fold. The amount
   * is not granted here and never is: `grantLoot` already paid it, and paying it twice on pickup is
   * exactly the duplicate the bag quietly buys back.
   */
  private placeMoney(p: Player, at: { x: number; y: number }, wav: number, region?: RegionId | null, deferred = false): void {
    const angle = Math.PI * 0.75;
    const id = `d${++this.dropSerial}`;
    this.drops.set(id, {
      id, owner: p.id, sector: p.sector, region: region !== undefined ? region : (p.place === 'line' ? p.region : null),
      x: at.x + Math.cos(angle) * 0.5, z: at.y + Math.sin(angle) * 0.5,
      kind: 'wav', name: `${wav.toLocaleString()} WAV`, amount: wav, deferred,
      rarity: 'common', bornAt: Date.now(),
    });
  }

  /** The drops this player can see: their own, where they are standing, still alive. */
  private dropsFor(id: string): DropView[] {
    const p = this.players.get(id);
    if (!p) return [];
    const now = Date.now();
    const here = p.place === 'line' ? p.region : null;
    const out: DropView[] = [];
    for (const d of this.drops.values()) {
      if (d.owner !== id || d.sector !== p.sector) continue;
      if ((d.region ?? null) !== here) continue;
      const ttl = d.kind === 'card' && d.deferred ? -1 : Math.max(0, Math.round((DROP_TTL_MS - (now - d.bornAt)) / 1000));
      if (!(d.kind === 'card' && d.deferred) && ttl <= 0) continue;
      out.push({
        id: d.id, x: d.x, z: d.z, kind: d.kind, name: d.name,
        ...(d.key ? { key: d.key } : {}),
        ...(d.amount ? { amount: d.amount } : {}),
        ...(d.element ? { element: d.element } : {}),
        ...(d.klass ? { klass: d.klass } : {}),
        rarity: d.rarity, ttl, owner: d.owner,
      });
    }
    return out;
  }

  private pushDrops(id: string): void {
    this.pushTo(id, { t: 'drops', drops: this.dropsFor(id) });
  }

  /**
   * Take a pile.
   *
   * Ownership and distance are checked here and nowhere else: the client is allowed to say *which*
   * pile, never that it may have it.
   *
   * Take a pile. On the deferred side (Line loot) the pile PAYS here: nothing was granted
   * when it fell, so pickup is the grant. Everywhere else the pile is the receipt of a payout
   * the kill already made, and take is only the ceremony. Ownership and distance were checked
   * above; this only moves the loot.
   */
  private takeDrop(p: Player, dropId: string): { ok: boolean; reason?: string; name?: string } {
    const d = this.drops.get(dropId);
    if (!d || d.owner !== p.id) return { ok: false, reason: 'not yours' };
    if ((d.region ?? null) !== (p.place === 'line' ? p.region : null)) return { ok: false, reason: 'too far' };
    const age = Date.now() - d.bornAt;
    if (!(d.kind === 'card' && d.deferred) && age > DROP_TTL_MS) { this.drops.delete(dropId); this.pushDrops(p.id); return { ok: false, reason: 'the street took it back' }; }
    const at = (p.place === 'room' || p.place === 'house') ? p.street : { x: p.x, y: p.y };
    if (Math.hypot(at.x - d.x, at.y - d.z) > DROP_TAKE_RANGE) return { ok: false, reason: 'too far' };

    this.drops.delete(dropId);
    // Only the deferred side pays here. Dungeon/fold/anomaly piles were granted at the kill;
    // their take is the ceremony the old comment describes, and granting again would double-pay.
    if (d.deferred) {
      if (d.kind === 'wav' && d.amount) this.profiles.grant(p.saveKey, { wav: d.amount });
      else if (d.kind === 'item' && d.key) this.profiles.grant(p.saveKey, { items: { [d.key]: 1 } as never });
      else if (d.kind === 'card' && d.key) {
        this.profiles.giveCards(p.saveKey, [d.key]);
        this.profiles.unoweCard(p.saveKey, d.key);
      }
    }
    this.notifyProfile(p.id);
    this.pushDrops(p.id);
    return { ok: true, name: d.name };
  }

  /** Age the street. Runs on the broadcast beat, so expiry needs no timer of its own. */
  private sweepDrops(): void {
    if (!this.drops.size) return;
    const now = Date.now();
    const gone = new Set<string>();
    for (const [id, d] of this.drops) {
      if ((d.kind === 'card' && d.deferred) || now - d.bornAt <= DROP_TTL_MS) continue;
      this.drops.delete(id);
      gone.add(d.owner);
    }
    // Only the owners whose pile expired need a fresh list.
    for (const owner of gone) if (this.players.has(owner)) this.pushDrops(owner);
  }

  private rollLoot(drop: { rolls: number; rareChance: number }): string[] {
    const common = CARDS.filter((c) => SF.cardClass(c) === 'standard');
    const rare = CARDS.filter((c) => SF.cardClass(c) !== 'standard');
    return Array.from({ length: drop.rolls }, () => {
      const pool = Math.random() < drop.rareChance && rare.length ? rare : common;
      return pool[Math.floor(Math.random() * pool.length)]!.id;
    });
  }

// ---------------------------------------------------------------------------
  // The Line
  // ---------------------------------------------------------------------------

  /**
   * Park wherever the player is standing before a place change, keyed by the place they are
   * leaving. A single `street` slot was enough when there was a street and six rooms; there are
   * now nine places and they do not share a coordinate frame, so this is a map.
   */
private park(p: Player, leaving: Player['place']): void {
    if (leaving === 'street') p.street = { x: p.x, y: p.y };
    else if (leaving === 'line' && p.region) p.lineAt[p.region] = { x: p.x, y: p.y };
    // A room is 16x12 at the origin: there is nothing to park, because there is nowhere else in
    // it to come back to.
  }

  /**
   * The furthest region this token has earned the right to stand in.
   *
   * Regions open in order, so this is "the next one whose predecessor's warden is down" — never
   * a value the client names for itself. Returning to a region you have already cleared puts
   * you back there rather than at the frontier, because the frontier is not where a player who
   * wants to go farm Ash Pine belongs.
   */
  private openestRegion(p: Player): RegionId {
    const line = this.profiles.doc(p.saveKey).line;
    let best: RegionId = REGION_IDS[0]!;
    for (const r of REGION_IDS) if (regionGate(line, r).open) best = r;
    if (p.region && REGION_IDS.indexOf(p.region) > REGION_IDS.indexOf(best)) return p.region;
    return best;
  }

  /**
   * Move a player into a region of the Line, or out of it back to the street.
   *
   * The only sanctioned way across: `move()` will not honour a client's own idea of where a
   * region is, and `regionGate` — the same function `lineCleared` uses — is what says whether
   * this one is earned. `from` is true when nobody asked (arriving from the city, or walking in
   * from the previous region), in which case the frontier is chosen instead of a named region.
   *
   * The maps tab calls this with `from: false` and a named region, and gets the same refusal
   * text a sealed region prints on the tab, because it is the same gate.
   */
  travel(id: string, region: RegionId | null, from = false): { ok: boolean; reason?: string; region?: RegionId } {
    const p = this.players.get(id);
    if (!p) return { ok: false, reason: 'no such player' };
    this.duelLeave(id);
    if (region === null) {
      this.park(p, 'line');
      p.place = 'street';
      p.region = null;
      // Off the road you land by the quest board. `park` still saves (rooms remember doors),
      // but trips come home: the road and the folds end at the board, computed the same way
      // on both sides, so nothing is sent.
      const back = boardSideFor(cityOf(p.sector));
      p.x = back.x; p.y = back.z;
      p.street = { x: p.x, y: p.y };
      p.at = Date.now();
      return { ok: true };
    }
    const line = this.profiles.doc(p.saveKey).line;
    const want = from ? this.openestRegion(p) : region;
    const gate = regionGate(line, want);
    if (!gate.open) return { ok: false, reason: gate.reason };
    this.park(p, p.place);
    const layout = lineLayout(want);
    const back = p.lineAt[want];
    p.place = 'line';
    p.region = want;
    p.x = back?.x ?? layout.spawn.x;
    p.y = back?.y ?? layout.spawn.z;
    p.at = Date.now();
    p.inPoi.clear();
    this.quest(id, [{ type: 'lineTravel', target: want }]);
    return { ok: true, region: want };
  }

  /** Everyone currently walking one region. Regions are not rooms, so this is its own set. */
  private playersOnLine(region: RegionId): string[] {
    const out: string[] = [];
    for (const p of this.players.values()) if (p.place === 'line' && p.region === region) out.push(p.id);
    return out;
  }

  /**
   * The mobs, as the server sees them: alive, fighting, dead, or waiting to stand back up.
   *
   * Keyed by mob id, not by region, because a player who walks out and back in should find the
   * same fight they left — and because a warden that stays dead has to stay dead in exactly one
   * place rather than in a per-region set that gets rebuilt on every arrival.
   */
  private lineMobs = new Map<string, { deadAt: number; inFight: string | null; home?: { x: number; z: number }; chase?: ChaseAnchor | null }>();
  /** Last sealed-touch toast per player: contact explains itself, but not every step. */
  private sealedToastAt = new Map<string, number>();
  /** No re-engage until this timestamp: leaving a fight buys breath, not another fight. */
  private duelGrace = new Map<string, number>();
  /** Wins the field already announced, remembered until the claim arrives: the tick reaps a
   * finished session in the step that ends it, and the plate closes seconds later. */
  private lineClaims = new Map<string, { encounterId: string; at: number; kill: { wav: number; x: number; z: number } }>();

  /**
   * Walk into a live mob and the fight starts by itself.
   *
   * Three guards, each of which is a different way this could be exploited or annoyed:
   *
   *  - **already in a fight** — walking the field mid-duel does not open a second one, which is
   *    how a player would otherwise stack two wardens;
   *  - **dead or respawning** — a mob that was beaten stays down for `respawnS`, and a warden
   *    stays down forever because it is a gate;
   *  - **already cleared** — the first body banks the encounter; the second body of the same
   *    drift is the same fight again, and it still opens (for the repeat purse), but a *cleared
   *    warden's* region has moved on and there is nothing to start.
   */
  private checkLineMobs(id: string, p: Player): void {
    if (!p.region) return;
    if (this.sessionOf(id)) return;
    const now = Date.now();
    for (const m of mobSpawns(p.region)) {
      if (!this.mobStanding(m, now)) continue;
      const spawn = this.mobSpawn(m);
      const at = this.mobStep(spawn, now, { x: p.x, z: p.y });
      if (Math.hypot(p.x - at.x, p.y - at.z) > m.reach) continue;
      const res = this.lineEngage(id, p, m.encounterId, m.id);
      if (res.ok) {
        this.pushTo(id, {
          t: 'line',
          kind: 'ambush',
          encounterId: m.encounterId,
          mob: m.id,
          name: m.name,
        });
        return;
      }
      if (!res.reason || res.reason.startsWith('catch your breath')) continue;
      // Contact with a sealed mob explains itself instead of dying quietly: the figure
      // visibly came over, so silence reads as a broken ambush.
      const last = this.sealedToastAt.get(id) ?? 0;
      if (now - last > 6000) {
        this.sealedToastAt.set(id, now);
        this.pushTo(id, { t: 'line', kind: 'sealed', encounterId: m.encounterId, reason: res.reason });
      }
    }
    // No second trigger at the marker. A duel used to start for standing on a site even
    // with every body out on patrol, which read as bumping into something invisible:
    // contact is the bodies' job now (inside the aggro radius they come over on their
    // own), and the marker's job is the E prompt, which asks out loud.
  }

  /** Mark the mob dead when its fight is won, and pay the repeat purse when the cards are banked. */
  private killLineMob(encounterId: string, winnerId: string): { wav: number; items: string[]; x: number; z: number } {
    const now = Date.now();
    let wav = 0;
    const items: string[] = [];
    let x = 0;
    let z = 0;
    let placed = false;
    for (const [mobId, state] of this.lineMobs) {
      if (!state.inFight) continue;
      const [enc] = mobId.split('.').slice(0, 2).join('.').split('.');
      void enc;
      const spawn = allMobSpawns().find((m) => m.id === mobId);
      if (!spawn || spawn.encounterId !== encounterId) continue;
      const prev = this.lineMobs.get(mobId);
      this.lineMobs.set(mobId, { deadAt: now, inFight: null, ...(prev?.home ? { home: prev.home } : {}), chase: null });
      // The purse is the mob's, not the region's, so it pays on every kill — first or repeat. The
      // `cleared` check only decides whether the REPEAT bonus is also owed, and that bonus is
      // granted by `lineCleared` rather than dropped, so nothing here can double-pay.
      wav += spawn.repeatWav;
      // The pile falls where the body fell, not where the winner stood: the first killed body
      // of this encounter anchors the scatter, so loot waits on the road where the fight was.
      if (!placed) {
        // The pile falls where the body visibly fell — which, with aggro, is breathing
        // down the winner, not out on its patrol.
        const w = this.players.get(winnerId);
        const eff = this.mobSpawn(spawn);
        const at = w ? this.mobStep(eff, now, { x: w.x, z: w.y }) : mobAt(eff, now);
        x = at.x;
        z = at.z;
        placed = true;
      }
    }
    // The drift stands down with the marked body: mates watched their fight end and go
    // back to patrol. Swept here, after the pile anchor, because anchoring steps the
    // corpse and the step re-arms its chase.
    for (const [mateId, mateState] of this.lineMobs) {
      if (!mateState.chase) continue;
      const mateSpawn = allMobSpawns().find((m) => m.id === mateId);
      if (mateSpawn && mateSpawn.encounterId === encounterId) this.lineMobs.set(mateId, { ...mateState, chase: null });
    }
    // No marked body (a fight started by E on the site rather than by walking into a mob):
    // fall back to the winner's own feet, which is where the old code always dropped.
    if (!placed) {
      const winner = this.players.get(winnerId);
      if (winner) {
        x = winner.x;
        z = winner.y;
      }
    }
    return { wav, items, x, z };
  }

  /**
   * Every body in a region, where it is right now and whether it is standing.
   *
   * Positions are mobAt's pure function of the clock, so the client draws the same walk the
   * server's proximity check walks into � and a dead mob reports live: false rather than
   * vanishing, because the corpse fading out is the only feedback a win has on the field.
   */
  /** The spawn a mob walks from right now: printed, or relocated by its last respawn. */
  /**
   * One step of a mob's pursuit, persisted: position, facing and the anchor to keep.
   * Every reader of a mob's position — the ambush check, the snapshot, the drop —
   * goes through here, so all of them walk the same chase.
   */
  private mobStep(spawn: MobSpawn, now: number, foe: { x: number; z: number } | null): { x: number; z: number; facing: number } {
    const st = this.lineMobs.get(spawn.id);
    const r = chaseStep(st?.chase ?? null, spawn, now, foe);
    if (st) this.lineMobs.set(spawn.id, { ...st, chase: r.anchor });
    else if (r.anchor) this.lineMobs.set(spawn.id, { deadAt: 0, inFight: null, chase: r.anchor });
    return r;
  }

  /** The spawn a mob walks from right now: printed, or relocated by its last respawn. */
  private mobSpawn(m: MobSpawn): MobSpawn {
    const home = this.lineMobs.get(m.id)?.home;
    return home ? { ...m, home } : m;
  }

  /**
   * Liveness with lazy respawn: a body whose timer elapsed stands back up at a new
   * walkable home near its site, so the road never runs out of bodies. Wardens
   * (`respawnS: 0`) stay crossed — a gate that was crossed stays crossed.
   */
  private mobStanding(m: MobSpawn, now: number): boolean {
    const state = this.lineMobs.get(m.id);
    if (!state) return true;
    if (state.inFight) return true;
    if (state.deadAt <= 0) return true;
    if (m.respawnS <= 0) return false;
    if (now - state.deadAt < m.respawnS * 1000) return false;
    const site = lineLayout(m.region).encounters.find((e) => e.id === m.encounterId);
    const cx = site?.x ?? m.home.x;
    const cz = site?.z ?? m.home.z;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.random() * 8;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (walkable(m.region, x, z)) {
        this.lineMobs.set(m.id, { deadAt: 0, inFight: null, home: { x, z }, chase: null });
        return true;
      }
    }
    this.lineMobs.set(m.id, { deadAt: 0, inFight: null, chase: null });
    return true;
  }

  private mobsFor(region: RegionId | null) {
    if (!region) return [];
    const now = Date.now();
    const foes = [...this.players.values()].filter(
      (q) => q.region === region && q.place === 'line',
    );
    return mobSpawns(region).map((m) => {
      // Standing first: it performs the lazy respawn, and the spawn below must read the
      // relocated home, not the dead one.
      const alive = this.mobStanding(m, now);
      const spawn = this.mobSpawn(m);
      const patrol = mobAt(spawn, now);
      let foe: { x: number; z: number } | null = null;
      let best = Infinity;
      for (const q of foes) {
        const d = Math.hypot(q.x - patrol.x, q.y - patrol.z);
        if (d < best) { best = d; foe = { x: q.x, z: q.y }; }
      }
      const at = this.mobStep(spawn, now, foe);
      return {
        id: m.id, encounterId: m.encounterId, region: m.region, kind: m.kind, name: m.name, element: m.element,
        archetype: m.archetype, tier: m.tier, home: { x: +spawn.home.x.toFixed(1), z: +spawn.home.z.toFixed(1) }, roam: m.roam,
        x: +at.x.toFixed(1), z: +at.z.toFixed(1), alive,
        // The facing has to be on the wire. The client places the figure at exactly the position and
        // yaw the server reported — it does not predict, because a figure that drifted would be a
        // figure the player swings at and misses — and a missing yaw arrives as `undefined`, which
        // three.js turns into a NaN rotation, which is a mob that silently does not render at all.
        // Derived from the walk itself, so bodies turn into the foe they chase, else down the patrol.
        facing: +at.facing.toFixed(3),
      };
    });
  }

  /**
   * The site the player is standing in, if any — the server's own answer, never the client's.
   *
   * This is the check the whole encounter system rests on. A client can send `line.enter` naming
   * any encounter it likes; what the server asks is whether the player is standing on the thing.
   */
  siteUnder(p: Player, reach = 9): string | null {
    if (p.place !== 'line' || !p.region) return null;
    return lineLayout(p.region).siteAt(p.x, p.y, reach)?.id ?? null;
  }

  /**
   * The body of an encounter the player is closest to right now.
   *
   * A fight started by walking into a mob names its body; a fight started by pressing E on the
   * site names only the site — but the purse hangs off the BODY (`killLineMob` walks `lineMobs`
   * looking for `inFight`), so an E-started fight without a marked body dropped nothing at all.
   * Marking the nearest body of the site here makes both paths pay the same purse at the same
   * place: where the mob stood, not where the winner stood.
   */
  private nearestLineMob(p: Player, encounterId: string): string | undefined {
    if (!p.region) return undefined;
    const now = Date.now();
    let best: string | undefined;
    let bestD = Infinity;
    for (const m of mobSpawns(p.region)) {
      if (m.encounterId !== encounterId) continue;
      // Standing is the respawn's own verdict — which also performs the lazy stand-up — and
      // the distance is walked from the relocated home, not the printed one.
      if (!this.mobStanding(m, now)) continue;
      const at = this.mobStep(this.mobSpawn(m), now, { x: p.x, z: p.y });
      const d = Math.hypot(p.x - at.x, p.y - at.z);
      if (d < bestD) {
        bestD = d;
        best = m.id;
      }
    }
    return best;
  }

  /**
   * Start the fight at a site on the Line.
   *
   * Drifts are `node` fights and wardens are the region's gate — the same two shapes the dungeon
   * uses, so `battle.ts` and the whole `sf/` session machinery are reused rather than forked.
   * The health comes from `line/budget.ts`, which derives it from the cards the region hands out
   * *before* this site, so moving a card between two encounters re-tunes both fights without
   * anyone touching a difficulty number.
   *
   * A cleared site still opens: the road never runs out of fights, and the repeat pays
   * the purse while the cards land once (`line.clear` splits the two). Only the gate refuses —
   * a sealed region, a skipped predecessor — and it says which.
   */
  private lineEngage(id: string, p: Player, encounterId: string, mobId?: string): { ok: boolean; reason?: string } {
    const line = this.profiles.doc(p.saveKey).line;
    if (!p.region) return { ok: false, reason: 'you are not on the Line' };
    const gate = encounterGate(line, encounterId);
    if (!gate.open) return { ok: false, reason: gate.reason };
    const def = ENCOUNTER_BY_ID.get(encounterId);
    const budget = encounterBudget(encounterId);
    if (!def || !budget) return { ok: false, reason: 'no such encounter' };
    const grace = (this.duelGrace.get(id) ?? 0) - Date.now();
    if (grace > 0) return { ok: false, reason: `catch your breath — ${Math.ceil(grace / 1000)}s` };

    // Keyed per encounter, not per player, so a party that walks into the same drift fights the
    // same thing and its reward is shared once by `partyRewardScale`, not once per body.
    const key = `line:${encounterId}`;
    let session = this.sessions.get(key);
    if (!session) {
      const warden = def.kind === 'warden';
      const duelTier = duelTierOf(warden ? 'boss' : 'node', def.tier);
      // Tolls fights run one step deeper and carry the encounter's own bite: the first map
      // is a tutorial that still hits back. Everywhere else the table plays as priced.
      const quirk = quirkOf(encounterId);
      const spicy = quirk.powerK && quirk.powerK !== 1 ? Math.round(SF.volleyAnchor(duelTier) * quirk.powerK) : 0;
      session = new BattleSession(key, p.sector, {
        name: warden ? REGION_BY_ID.get(def.region)!.boss.name : def.name,
        hp: budget.hp,
        maxHp: budget.hp,
        element: def.element as Element,
        // The map mob and the duel are one thing: both read `archetypeForEncounter`.
        archetype: archetypeForEncounter(encounterId),
        node: true,
        encounterId,
        region: def.region,
        partyHp: warden ? 'boss' : 'node',
        tier: duelTier,
        level: Math.max(2, def.tier * 4),
        difficulty: Math.min(6, def.tier + (def.region === 'tolls' ? 1 : 0)),
        ...(spicy ? { power: spicy } : {}),
      });
      this.sessions.set(key, session);
    }
    // The encounter id travels with the join: a fight that starts at a patrolling body
    // is nowhere near its site, and re-deriving it from the boots is what used to refuse
    // every ambush while still marking the mob — an ambush push with no session behind it,
    // and a body bricked in `inFight` forever. A refused join marks nothing.
    const entered = this.duelEnter(id, 'line', encounterId);
    if (!entered.ok) return entered;
    /*
     * Mark the mob, and mark it HERE rather than in the caller.
     *
     * `killLineMob` walks `lineMobs` looking for `inFight`, and only `checkLineMobs` used to set it
     * — so an ambush dropped its purse and a fight started by pressing E on the site dropped
     * nothing at all, because the loop found no body to kill. Whichever way a fight starts, the
     * mob that is now being fought has to be the one that pays.
     */
    // The mark keeps the relocated home: a body that respawned walks from its new
    // ground, and wiping it here would teleport the figure back to the printed site the
    // instant the fight opens.
    if (mobId) {
      const prev = this.lineMobs.get(mobId);
      this.lineMobs.set(mobId, { deadAt: 0, inFight: id, ...(prev?.home ? { home: prev.home } : {}), ...(prev?.chase ? { chase: prev.chase } : {}) });
    }
    return { ok: true };
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
      kind?: 'card' | 'item' | 'furniture';
      stockId?: string;
      itemId?: string;
      questId?: string;
      nodeId?: string;
      dungeonId?: string;
      tier?: number;
      damage?: number;
      /**  amounts (withdraw). Re-checked against the ledger, never trusted. */
      amount?: number;
      npcId?: string;
      waveId?: string;
      door?: string;
      cards?: string[];
      flag?: string;
      dropId?: string;
      /** Which region of the Line the maps tab asked for. */
      region?: string;
      /** Which encounter of a region. Re-checked against the player's own position. */
      encounterId?: string;
      /** Which of the 3 dealt draft cards the player picked. */
      card?: string;
      /** House calls: who, what piece, where, which way, which uid. */
      with?: string;
      fid?: string;
      x?: number;
      z?: number;
      rot?: number;
      uid?: string;
    },
  ): { ok: boolean; reason?: string; [k: string]: unknown } {
    const p = this.players.get(id);
    if (!p) return { ok: false, reason: 'not connected' };
    const volume = this.volume.mon;

    switch (msg.action) {
      case 'profile':
        return { ok: true, profile: this.profileFor(id) };

      case 'drops':
        // Re-ask for the street's loot: what a client does on reconnect, and what makes a
        // missed push self-healing instead of a pile that exists only in the server's head.
        this.pushDrops(id);
        return { ok: true, drops: this.dropsFor(id) };

      case 'take':
        return msg.dropId ? this.takeDrop(p, msg.dropId) : { ok: false, reason: 'which pile?' };

      case 'shop':
        return { ok: true, shops: this.profiles.shops(p.saveKey, p.sector, volume), wav: this.profiles.doc(p.saveKey).bag.wav };

      case 'buy': {
        if (!msg.stockId || !msg.kind) return { ok: false, reason: 'missing line' };
        const res = this.profiles.buy(p.saveKey, p.sector, msg.kind, msg.stockId, volume, Date.now(), p.build.library);
        p.save = this.saves.get(p.saveKey);
        this.notifyProfile(id);
        if (res.ok && res.line) this.announce(`${p.build.callsign} bought ${res.line.name}`, p.sector);
        return { ...res, save: p.save };
      }

      case 'sell': {
        if (!msg.stockId) return { ok: false, reason: 'missing card' };
        const res = this.profiles.sell(p.saveKey, msg.stockId, [p.build.signature]);
        p.save = this.saves.get(p.saveKey);
        this.notifyProfile(id);
        return res;
      }

      case 'use': {
        if (!msg.itemId) return { ok: false, reason: 'missing item' };
        const res = this.profiles.use(p.saveKey, msg.itemId as never);
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

      case 'house.get': {
        const { layout, owned } = this.profiles.houseOf(p.saveKey);
        return { ok: true, layout, owned };
      }
      case 'house.enter':
        return this.houseEnter(id, p, p.saveKey);
      case 'house.leave':
        return this.houseLeave(p);
      case 'house.place': {
        if (p.place !== 'house' || p.houseOf !== p.saveKey) return { ok: false, reason: 'only the host arranges the room' };
        if (!msg.fid || typeof msg.x !== 'number' || typeof msg.z !== 'number') return { ok: false, reason: 'missing piece' };
        const uid = Date.now().toString(36) + Math.floor(Math.random() * 36 * 36 * 36).toString(36);
        const res = this.profiles.housePlace(p.saveKey, String(msg.fid), msg.x, msg.z, Math.floor(Number(msg.rot ?? 0)), uid);
        if (res.ok && res.layout) this.pushHouse(p.saveKey, res.layout);
        return res;
      }
      case 'house.pickup': {
        if (p.place !== 'house' || p.houseOf !== p.saveKey) return { ok: false, reason: 'only the host arranges the room' };
        if (!msg.uid) return { ok: false, reason: 'which piece?' };
        const res = this.profiles.housePickup(p.saveKey, String(msg.uid));
        if (res.ok && res.layout) this.pushHouse(p.saveKey, res.layout);
        return res;
      }
      case 'house.rotate': {
        if (p.place !== 'house' || p.houseOf !== p.saveKey) return { ok: false, reason: 'only the host arranges the room' };
        if (!msg.uid) return { ok: false, reason: 'which piece?' };
        const res = this.profiles.houseRotate(p.saveKey, String(msg.uid));
        if (res.ok && res.layout) this.pushHouse(p.saveKey, res.layout);
        return res;
      }
      case 'house.invite': {
        const other = msg.with ? this.players.get(String(msg.with)) : undefined;
        if (!other) return { ok: false, reason: 'that player is gone' };
        const r = this.social.inviteHome(id, other.id);
        if (!r.ok) return { ok: false, reason: r.reason };
        this.pushTo(other.id, { t: 'house', invite: { from: id, name: p.build.callsign } });
        return { ok: true };
      }
      case 'house.accept': {
        if (p.inBattle) return { ok: false, reason: 'finish your fight first' };
        const r = this.social.acceptHomeInvite(id);
        if (!r.ok || !r.from) return { ok: false, reason: r.reason };
        const host = this.players.get(r.from);
        if (!host) return { ok: false, reason: 'your host is gone' };
        const entered = this.houseEnter(id, p, host.saveKey);
        if (!entered.ok) return entered;
        this.pushTo(host.id, { t: 'house', notice: p.build.callsign + ' came over' });
        return entered;
      }
      case 'house.decline': {
        const from = this.social.declineHomeInvite(id);
        if (from) {
          const host = this.players.get(from);
          if (host) this.pushTo(host.id, { t: 'house', notice: p.build.callsign + ' declined' });
        }
        return { ok: true };
      }
      case 'door.enter':
        return msg.door ? this.enterDoor(p, msg.door) : { ok: false, reason: 'which door?' };

      case 'wave.collect':
        return msg.waveId ? this.catchWave(p, msg.waveId) : { ok: false, reason: 'which wave?' };

      // ---- Real $CHOG ------------------------------------------------------
      // Deposits arrive on their own (the chain poll credits the vault's inbox);
      // withdrawals queue for the payout pump (hot wallet) — or the operator, with no hot key.

      case 'chog.deposit':
        return { ok: true, vault: CFG.vault || null, balance: this.profiles.chogOf(p.saveKey) };

      case 'chog.withdraw': {
        if (!p.wallet) return { ok: false, reason: 'link a wallet first' };
        const amount = Math.floor(Number(msg.amount ?? 0));
        if (!Number.isFinite(amount) || amount < 1) return { ok: false, reason: 'name a real amount' };
        const today = Date.now() - (Date.now() % 86_400_000);
        if (this.saves.withdrawDailyTotal(p.wallet.toLowerCase(), today) + amount > WITHDRAW_DAILY_MAX) {
          return { ok: false, reason: `daily payout cap is ${WITHDRAW_DAILY_MAX} $CHOG` };
        }
        const w = p.wallet.toLowerCase();
        // Provenance: only what a wallet deposited can ever leave. The starting
        // grant and paper winnings are play money — without this, every fresh
        // wallet could withdraw 1000 real $CHOG it never put in.
        const deposited = this.saves.depositedBy(w);
        const alreadyOut = this.saves.withdrawDailyTotal(w, 0);
        if (amount > deposited - alreadyOut) {
          return { ok: false, reason: 'only deposited $CHOG can leave — the starting grant is play money' };
        }
        if (!this.profiles.addChog(p.saveKey, -amount)) return { ok: false, reason: 'insufficient $CHOG' };
        const req = this.saves.withdrawReqPut(p.wallet.toLowerCase(), amount, String(p.saveKey));
        void this.payouts?.pump();
        this.notifyProfile(id);
        return { ok: true, request: req, amount, note: this.payouts ? 'payout queued — automatic' : 'queued for manual payout from the vault' };
      }

      case 'area.open': {
        // A fold is data, not a door: it opens from the menu wherever you are standing. Walking to
        // the Fold Gate is how you find it the first time, not a toll the server collects every run.
        const dungeonId = String(msg.dungeonId ?? '');
        const guide = this.foldGuide(p, dungeonId);
        // Either this Chog opens a fold of its own, or it walks the one its party is already inside.
        const res = guide
          ? this.profiles.attachFold(p.saveKey, guide, this.fieldHpOf(p))
          : this.profiles.openDungeon(p.saveKey, dungeonId, this.fieldHpOf(p));
        if (res.ok) this.announce(`${p.build.callsign} went into ${res.area?.name}${guide ? ' after their party' : ''}`, p.sector);
        this.notifyProfile(id);
        if (res.ok && res.area) this.boardFold(p, res.area);
        return res;
      }

      case 'area.step': {
        if (!msg.nodeId) return { ok: false, reason: 'missing node' };
        if (this.sessionOf(id)?.nodeFight) return { ok: false, reason: 'leave or finish the current fight first' };
        const doc = this.profiles.doc(p.saveKey);
        if (!doc.run || doc.run.done || doc.run.failed) return { ok: false, reason: 'no active dungeon run' };
        if (this.profiles.areaEnemy(p.saveKey) && !doc.run.cleared.includes(doc.run.at)) return { ok: false, reason: 'clear the current room before moving on' };
        const res = this.profiles.stepArea(p.saveKey, msg.nodeId);
        this.notifyProfile(id);
        // The client now decides when to engage after seeing the enemy band.
        return res;
      }

      case 'area.engage': {
        const enemy = this.profiles.areaEnemy(p.saveKey);
        if (!enemy) return { ok: false, reason: 'nothing to fight here' };
        if (this.sessionOf(id)?.nodeFight) return { ok: false, reason: 'already fighting' };
        return this.duelEnter(id, 'node');
      }

      case 'area.kill': {
        // The field issued this: `armNode` is the server's own signature on a kill, and `clearCurrent`
        // refuses a tile without one, so a client cannot claim a room it never fought. The payout is
        // then read off the bodies still standing on that field — a four-person pull pays as one.
        const field = this.sessionOf(id);
        const doc = this.profiles.doc(p.saveKey);
        if (!field?.nodeFight || field.state.result !== 'win' || field.spec.areaId !== doc.area?.id || field.spec.nodeId !== doc.run?.at || doc.run?.failed) return { ok: false, reason: 'the current field has not been cleared' };
        const bodies = [...this.players.values()].filter((x) => field.has(x.id));
        const scale = bodies.length > 0 ? partyRewardScale(bodies.length, ownersOf(bodies)) : 1;
        const res = this.profiles.clearCurrent(p.saveKey, 0, scale, p.build);
        // The room's own grant is what usually moves the needle, so its level-up is said here instead
        // of only being folded into the cached number a banner reads off later.
        if (res.ok && res.grant) this.noteLevel(p, res.grant.level);
        const levelNow = this.profiles.level(p.saveKey);
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

      case 'area.draft': {
        // Take 1 of the 3 the last combat node dealt. The options were server-dealt and the
        // pick is validated inside `takeDraft`, so naming a card you were never offered buys
        // nothing — and a duplicate is bought back by the counter through the normal grant path.
        const card = typeof msg.card === 'string' ? msg.card : '';
        const res = this.profiles.takeDraft(p.saveKey, card);
        this.notifyProfile(id);
        // The sheet repaints off the reply, so the run rides along like area.step.
        return { ...res, run: this.profiles.doc(p.saveKey).run };
      }

      case 'area.shrine': {
        // Thin the deck at a shrine rest. Ownership and the signature guard live in
        // `shrineRemove`, so the message names a card and the server decides.
        const card = typeof msg.card === 'string' ? msg.card : '';
        const res = this.profiles.shrineRemove(p.saveKey, card, [p.build.signature]);
        this.notifyProfile(id);
        // The sheet repaints off the reply, so the run rides along like area.step.
        return { ...res, run: this.profiles.doc(p.saveKey).run };
      }

      case 'area.close':
        this.duelLeave(id);
        const shut = this.profiles.closeArea(p.saveKey);
        // Out of a fold you land by the quest board — unless the fold was opened from the road,
        // in which case there is a region to go back to and the client restores it instead.
        if (p.place !== 'line') {
          const home = boardSideFor(cityOf(p.sector));
          p.x = home.x; p.y = home.z; p.street = { x: p.x, y: p.y }; p.at = Date.now();
        }
        return shut;

case 'area.state': {
        const view = this.profiles.areaView(p.saveKey);
        return { ok: true, ...view, enemy: this.profiles.areaEnemy(p.saveKey) };
      }

      // ---- The Line ------------------------------------------------------------
      // Four actions and one invariant: **the server never believes a client about where it
      // is standing.** `line.state` is a report, `line.travel` is a request the gate decides,
      // `line.enter` asks the layout whether the player is on the site, and `line.clear` asks
      // the session whether the fight was actually won. None of them reads a position from the
      // message.

      case 'line.state': {
        const view = this.profiles.lineView(p.saveKey, this.mobsFor(p.region));
        return {
          ok: true,
          ...view,
          /** Where the maps tab should put the highlight: the region you are standing in, or the frontier. */
          at: p.region ?? this.openestRegion(p),
          onTheLine: p.place === 'line',
        };
      }

      case 'line.travel': {
        const want = msg.region ? (REGION_IDS as readonly string[]).includes(msg.region) ? (msg.region as RegionId) : null : null;
        if (msg.region && !want) return { ok: false, reason: 'no such region' };
        const res = this.travel(id, want);
        if (!res.ok) return res;
        if (want) this.announce(`${p.build.callsign} took the road to ${REGION_BY_ID.get(res.region!)!.name}`, p.sector);
        this.notifyProfile(id);
        return { ...res, state: this.profiles.lineView(p.saveKey) };
      }

      case 'line.enter': {
        const s = this.siteUnder(p);
        if (!s) return { ok: false, reason: 'nothing here to fight' };
        // The client's `encounterId` is never compared to anything on its own: the id came from
        // the layout, and the layout is the same object the terrain was drawn from.
        if (msg.encounterId && msg.encounterId !== s) {
          return { ok: false, reason: 'that is not what you are standing on' };
        }
        const site = lineLayout(p.region!).encounters.find((e) => e.id === s);
        if (!site) return { ok: false, reason: 'no such site' };
        return this.lineEngage(id, p, site.id, this.nearestLineMob(p, site.id));
      }

      case 'line.talk': {
        // The trailhead scout talks to anyone standing at the campfire — no quest, no gate,
        // just the road rules. Proximity is re-checked here, never trusted from the client.
        if (p.place !== 'line' || !p.region) return { ok: false, reason: 'you are not on the Line' };
        const scout = campOf(p.region).npc;
        if (Math.hypot(p.x - scout.x, p.y - scout.z) > 5) return { ok: false, reason: 'too far away' };
        return {
          ok: true,
          talk: {
            npc: { id: 'line-scout', name: scout.name, role: 'guide', tribe: 'prism' },
            pages: [
              'New boots. The board sent word — travel papers and everything. I am the scout they posted here: I watch the road, I do not walk it.',
              'The rules out here: walk into a rust mite and the fight starts by itself. Win and the Line pays a card on the spot, plus a purse on the ground where the body fell — walk over and take it before it fades.',
              'This camp is safe ground — nothing starts a fight within shouting distance of the fire. The big one at the far north is the warden: beat it and the region is yours. The board will want to hear about that.',
            ],
            options: [{ id: 'close', label: 'Back to the road', primary: true }],
          },
        };
      }

      case 'line.clear': {
        // The win has to be the field's, not the message's: either the live session says
        // so, or the field said so when it ended and the claim was banked for this. The
        // tick deletes a finished session in the step that announces it, so checking the
        // session alone read as "no fight here" for every honest win.
        const field = this.sessionOf(id);
        const spec = field?.spec;
        const pending = this.lineClaims.get(id);
        const claimed =
          !!pending && pending.encounterId === msg.encounterId && Date.now() - pending.at < 10 * 60_000;
        if ((!field || spec?.encounterId !== msg.encounterId) && !claimed) {
          if (pending?.encounterId === msg.encounterId) this.lineClaims.delete(id);
          return { ok: false, reason: 'no fight here to have won' };
        }
        if (field && spec?.encounterId === msg.encounterId && field.state.result !== 'win') {
          return { ok: false, reason: 'the fight is not over' };
        }
        // A repeat pays the purse, not the cards: the road never runs out of fights, but a
        // card is progression and lands once. Without this the clear below answers "already
        // cleared" to an honest second win and the purse never falls.
        const banked = this.profiles.lineCleared(p.saveKey, [msg.encounterId!], p.build, true);
        const res = !banked.ok && banked.reason === 'already cleared'
          ? { ok: true as const, cards: [] as string[] }
          : banked;
        if (!res.ok) return res;
        const bankedKill = claimed ? pending?.kill : undefined;
        if (claimed) this.lineClaims.delete(id);
        // The mob goes down with the fight, and what it was carrying lands on the ground next to
        // the winner. First clears pay their named cards into the deck; repeats pay the purse
        // the spawn table printed, in WAV on the dirt, because a cleared region has to stay worth
        // walking. Wardens respawn never — `respawnS: 0` — so a gate that was crossed stays crossed.
        // A reaped win already killed its body on the tick and banked the purse; killing
        // again would find no mark and pay 0 at the winner's feet. A live session kills now.
        const kill = bankedKill ?? this.killLineMob(msg.encounterId!, id);
        /*
         * What lands on the ground: everything the mob was carrying.
         *
         * First clears drop their named cards on the dirt next to the purse: `lineCleared`
         * marked them cleared but granted nothing (deferred), so these piles are the only
         * copies and `take` is the grant. Cards do not expire — a card is progression, not
         * litter — and the profile remembers them as owed, so a restart re-plants them at
         * the owner’s boots on join. Repeats pay only the purse, as before.
         */
        if (res.ok && res.cards?.length) this.profiles.oweCards(p.saveKey, res.cards);
        this.spawnDrops(p, res.ok ? res.cards ?? [] : [], [], kill.wav, { x: kill.x, y: kill.z }, p.region, true);
        // A banked fight is over for the banker: staying in the corpse session would brick
        // the next ambush check and reopen a finished duel on E. Party members keep theirs.
        this.duelLeave(id);
        // The banker walks free with a breath on every path: a reaped win has no live
        // session left for `duelLeave` to grant it from, and without it the next step
        // re-opens a neighbour's duel before the plate has closed.
        this.duelGrace.set(id, Date.now() + 5000);
        this.quest(id, [{ type: 'lineClear', target: msg.encounterId! }]);
        this.notifyProfile(id);
        return { ...res, state: this.profiles.lineView(p.saveKey), repeatWav: kill.wav };
      }

      case 'deck.save': {
        // The deck is validated against the rules and the player's own collection; a client
        // that sends a card it does not hold is told which one.
        const res = this.profiles.setDeck(p.saveKey, p.build, msg.cards ?? []);
        if (res.ok) {
          // "Equip" is a real act: a deck that fields a card the player collected, not the born set.
          const born = new Set(p.build.library);
          if ((msg.cards ?? []).some((c) => !born.has(c))) this.quest(id, [{ type: 'equip' }]);
        }
        this.notifyProfile(id);
        return res;
      }

      case 'deck.auto': {
        const cards = this.profiles.autoDeck(p.saveKey, p.build);
        this.notifyProfile(id);
        return { ok: true, cards };
      }

      case 'deck.reset':
        this.profiles.resetDeck(p.saveKey);
        this.notifyProfile(id);
        return { ok: true };

      case 'flag.set': {
        // The guide's memory: the welcome was shown, a tip was read. Idempotent, and keyed from
        // a short allow-list so a client cannot fill the save with junk.
        const key = String(msg.flag ?? '');
        if (!/^[a-z0-9:_-]{1,40}$/.test(key)) return { ok: false, reason: 'bad flag' };
        this.profiles.setFlag(p.saveKey, key);
        this.notifyProfile(id);
        return { ok: true };
      }

      case 'war':
        return { ok: true, war: this.war.view(), mine: this.war.of(p.tokenId) };

      case 'ranks':
        return { ok: true, ranks: this.ranksView(p.saveKey) };

      case 'album':
        return { ok: true, album: this.profiles.albumView(p.saveKey) };

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
    const { ready, offers, pending } = this.profiles.talk(p.saveKey, npcId);
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
    const res = this.profiles.accept(p.saveKey, questId, npcId);
    if (!res.ok || !res.def) return { ok: false, reason: res.reason };
    this.notifyProfile(p.id);
    return { ok: true, name: res.def.name };
  }

  private turnInQuest(p: Player, questId: string, npcId: string): { ok: boolean; reason?: string; [k: string]: unknown } {
    const a = this.anchorOf(p.sector, npcId);
    if (!a || !this.near(p, a)) return { ok: false, reason: 'too far away' };
    const res = this.profiles.turnIn(p.saveKey, questId, npcId);
    if (!res.ok || !res.def) return { ok: false, reason: res.reason };
    p.save = this.saves.get(p.saveKey);
    const levelNow = this.profiles.level(p.saveKey);
    if (levelNow !== p.level) p.level = levelNow;
    this.announce(`${p.build.callsign} closed ${res.name}`, p.sector);
    const lv = res.reward?.level;
    if (lv) this.announce(`${p.build.callsign} reached LV ${lv.to}${lv.unlocks.length ? ` — ${lv.unlocks.join(', ')}` : ''}`, p.sector);
    this.notifyProfile(p.id);
    return { ok: true, name: res.name, wav: res.reward?.wav ?? 0, xp: res.reward?.xp ?? 0, level: lv?.to ?? null, items: res.reward?.items ?? [], thanks: res.def.thanks ?? '' };
  }

  /** Stepping through a door: an objective like "go into the Card Shop" is this. */
  /**
   * Step through your own door, or a host's on an accepted invitation. The street
   * (or the road) is parked like any other door, the boots land on the welcome
   * mat, and the room comes back in the answer so the client draws it at once.
   */
  private houseEnter(id: string, p: Player, of: string): { ok: boolean; reason?: string; layout?: HouseLayout; of?: string; owned?: Record<string, number> } {
    if (p.inBattle) return { ok: false, reason: 'finish your fight first' };
    this.park(p, p.place);
    p.place = 'house';
    p.houseOf = of;
    p.x = HOUSE_SPAWN.x;
    p.y = HOUSE_SPAWN.z;
    p.at = Date.now();
    void id;
    const { layout, owned } = this.profiles.houseOf(of);
    return of === p.saveKey ? { ok: true, layout, of, owned } : { ok: true, layout, of };
  }

  /** Back out the door: the parked street position is where the boots land. */
  private houseLeave(p: Player): { ok: boolean; reason?: string } {
    if (p.place !== 'house') return { ok: false, reason: 'you are not inside a house' };
    const back = p.street;
    if (back) {
      p.x = back.x;
      p.y = back.y;
    }
    p.place = 'street';
    p.houseOf = null;
    p.at = Date.now();
    return { ok: true };
  }

  /** Everyone standing in one host's room, for the room's own snapshots. */
  private playersInHouse(of: string): string[] {
    const out: string[] = [];
    for (const p of this.players.values()) if (p.place === 'house' && p.houseOf === of) out.push(p.id);
    return out;
  }

  /** The room changed under its roof: everyone inside draws it again. */
  private pushHouse(of: string, layout: HouseLayout): void {
    for (const pid of this.playersInHouse(of)) this.pushTo(pid, { t: 'house', layout, of });
  }

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
    const res = this.profiles.collectWave(p.saveKey, { id: a.id, element: (a.sub ?? 'wave') as Element }, { sector: p.sector, tribe: p.tribe, heat });
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
        const found = this.profiles.discover(p.saveKey, a.id);
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
    const at = (p.place === 'room' || p.place === 'house') ? p.street : { x: p.x, y: p.y };
    return Math.hypot(at.x - gate.x, at.y - gate.z) <= (gate.radius ?? 3) + 8;
  }

  /** The integrity a fold run starts on — the same bar the field will spend, gear and all. */
  private fieldHpOf(p: Player): number {
    return SF.duelStatsOf({ loadout: p.build.loadout, level: p.level, attrs: p.build.attrs }).hp;
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
      const doc = this.profiles.doc(q.saveKey);
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
      if (this.profiles.doc(q.saveKey).area?.id === area.id) continue;
      if (q.sector !== host.sector || !this.atFoldGate(q)) {
        this.pushTo(pid, { t: 'dungeon', kind: 'refused', name: area.name, reason: 'stand at the same Fold Gate as your party' });
        continue;
      }
      const res = this.profiles.attachFold(q.saveKey, area, this.fieldHpOf(q));
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
  duelEnter(
    id: string,
    mode: 'anomaly' | 'train' | 'node' | 'line' | 'pvp' = 'anomaly',
    encounterId?: string,
  ): { ok: boolean; reason?: string } {
    const p = this.players.get(id);
    if (!p) return { ok: false, reason: 'not connected' };
    const active = this.sessionOf(id);
    if (active) {
      // Rejoining the fight you are already in is not a second fight: walking into a
      // drift ambushes you, and pressing E on its site reopens the duel instead of
      // scolding you. Anything else still has to wait its turn — and a rejoin is still
      // an entry, so the recovering and the finished stay out like everyone else.
      if (mode === 'line' && encounterId && active.spec?.encounterId === encounterId) {
        const wait = (this.downedUntil.get(id) ?? 0) - Date.now();
        if (wait > 0) return { ok: false, reason: `still recovering — ${Math.ceil(wait / 1000)}s` };
        if (active.state.over) return { ok: false, reason: 'that fight is over — step out and back in' };
        this.pushDuelStart(p);
        return { ok: true };
      }
      if (active.nodeFight !== (mode === 'node') || active.training !== (mode === 'train') || active.state.pvp !== (mode === 'pvp')) return { ok: false, reason: 'leave the current field first' };
      this.pushDuelStart(p);
      return { ok: true };
    }
    const wait = (this.downedUntil.get(id) ?? 0) - Date.now();
    if (wait > 0) return { ok: false, reason: `still recovering — ${Math.ceil(wait / 1000)}s` };

    const stats = SF.duelStatsOf({ loadout: p.build.loadout, level: p.level, attrs: p.build.attrs });
    let hp = stats.hp;
    let maxHp = hp;
    let session: BattleSession;

    const doc = this.profiles.doc(p.saveKey);
    const candidate = this.profiles.areaEnemy(p.saveKey);
    const node = candidate && doc.run && doc.run.hp > 0 && !doc.run.done && !doc.run.failed && !doc.run.cleared.includes(candidate.id) ? candidate : null;
    if (mode === 'node' && !node) return { ok: false, reason: 'no uncleared room under you' };
    if (mode !== 'node' && doc.run && !doc.run.done && !doc.run.failed) return { ok: false, reason: 'leave the dungeon before entering the station' };
    if (mode === 'node' && node) {
      // It spends the run's own integrity, not a fresh bar, and the field is keyed on the *map* as
      // well as the tile: a party walking the host's mirrored layout meets one monster here, not four,
      // and that single field is what decides how big the monster had better be.
      const run = this.profiles.doc(p.saveKey).run;
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
} else if (mode === 'line') {
      // The Line's fight was built and stored by `lineEngage`, keyed on the encounter rather
      // than on the player, so a party that walks into the same drift shares one boss. The
      // caller names the encounter because the fight can start at a patrolling body, and a
      // body on patrol is not standing on its site. Both callers proved the position already
      // (`line.enter` stood on the site, `checkLineMobs` touched the body) — this branch only
      // has to find the field.
      const region = p.region;
      const site = encounterId ?? (region ? this.siteUnder(p) : null);
      if (!region || !site) return { ok: false, reason: 'nothing here to fight' };
      const found = this.sessions.get(`line:${site}`);
      if (!found) return { ok: false, reason: 'nothing here to fight' };
      session = found;
    } else {
      const station = this.stationOf(p.sector);
      if (mode !== 'pvp' && (!station || !this.near(p, station, 7))) return { ok: false, reason: 'step up to the Wave Station first' };
      if (mode === 'train') {
        const key = `train:${id}`;
        const boss = SF.trainingBoss(p.level, p.build.loadout.element);
        session = new BattleSession(key, p.sector, { ...boss, maxHp: boss.hp, training: true, tier: 'train' });
        this.sessions.set(key, session);
      } else if (mode === 'pvp') {
        // The bout the acceptor agreed to: stored by `pvpAction`, and a duel
        // nobody challenged for is refused the same way a room nobody stood in is.
        const bout = this.pendingPvp.get(id);
        if (!bout) return { ok: false, reason: 'no bout waiting' };
        this.pendingPvp.delete(id);
        const key = bout.key;
        const found = this.sessions.get(key);
        if (found && (found.state.over || found.size >= 2)) return { ok: false, reason: 'the bout is over — or full' };
        session = found ?? new BattleSession(key, p.sector, {
          name: 'PVP',
          hp: 1,
          maxHp: 1,
          element: p.build.loadout.element,
          pvp: true,
          tier: 'glitch',
          level: p.level,
          brawl: bout.brawl,
        });
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
      deck: this.profiles.deckFor(p.saveKey, p.build),
      // The basic attack, priced off this token's own attributes. Carried on the body rather than
      // looked up per deal so two Chogs in one party press different buttons and hit for
      // different damage — the gap a common and a Legendary open, and the only gap that exists
      // while the deck is still too small to fill a hand. `sf/loadout.ts basicMight`.
      basic: SF.basicCard(p.build.loadout.element, p.build.basicMight),
      level: p.level,
      ...(session.nodeFight ? { hp, maxHp } : {}),
    };
    session.join({ id, name: p.build.callsign, tribe: p.tribe, wallet: p.wallet }, spec);
    if (!session.has(id)) return { ok: false, reason: 'this field has already lost your body' };
    this.fightQuests.set(id, new Set());
    this.refreshFieldParty(session);
    p.inBattle = true;
    this.pushDuelStart(p);
    // PvP: the boots already on the field started faceless — their starts went out before this
    // body stepped on. Hand each the newcomer's doc now, so no rival waits on a rival that
    // will never be announced.
    if (session.state.pvp) {
      for (const b of session.state.players) {
        if (b.id === id) continue;
        this.pushTo(b.id, { t: 'duel', kind: 'rival', rival: this.rivalDocOf(p) });
      }
    }
    return { ok: true };
  }

  /** The doc the other Chog builds its rival model from: token, name, tribe, traits. */
  private rivalDocOf(p: Player): { tokenId: number; name: string; element: Element; traits: Record<string, string> } {
    return { tokenId: p.tokenId, name: p.build.callsign, element: p.tribe, traits: p.attributes ?? {} };
  }

  private pushDuelStart(p: Player): void {
    const s = this.sessionOf(p.id);
    if (!s) return;
    const body = s.bodyOf(p.id);
    if (!body) return;
    const rivalId = s.state.pvp ? s.state.players.find((b) => b.id !== p.id)?.id : undefined;
    const rivalPlayer = rivalId ? this.players.get(rivalId) ?? null : null;
    const pool = SF.ARCHETYPES[s.archetype].pool;
    this.pushTo(p.id, {
      t: 'duel', kind: 'start', view: s.view(p.id), place: s.state.place,
      ...(rivalPlayer ? { rival: this.rivalDocOf(rivalPlayer) } : {}),
      caps: SF.capsOf(body),
      moves: s.state.pvp ? [] : pool.map((id) => SF.MOVES[id]!).filter((move, i) => i === 0 || move.depth <= s.difficulty).map(({ id, name, read }) => ({ id, name, read })),
    });
  }

  /** Step off the field. Leaving mid-fight is allowed and costs nothing but the fight. */
  /** Free every body this player had marked: a finished fight leaves no mark behind. */
  private releaseLineBodies(id: string): void {
    const freed: string[] = [];
    for (const [mobId, state] of this.lineMobs) {
      // The release keeps the relocated home: a body that respawned must not teleport
      // back to the printed site because somebody walked out of the duel.
      if (state.inFight === id) {
        // Walking out disperses the attacker: it despawns — the respawn timer refills
        // the road — instead of chasing through the grace for a second ambush.
        // Wardens never despawn: respawnS 0 is a gate, and leaving must not brick it.
        const spawn = allMobSpawns().find((m) => m.id === mobId);
        const standing = !spawn || spawn.respawnS <= 0;
        this.lineMobs.set(mobId, { deadAt: standing ? state.deadAt : Date.now(), inFight: null, ...(state.home ? { home: state.home } : {}), chase: null });
        if (spawn) freed.push(spawn.encounterId);
      }
    }
    // The freed drift stands down with its marked body.
    for (const [mateId, mateState] of this.lineMobs) {
      if (!mateState.chase) continue;
      const mateSpawn = allMobSpawns().find((m) => m.id === mateId);
      if (mateSpawn && freed.includes(mateSpawn.encounterId)) {
        this.lineMobs.set(mateId, { ...mateState, chase: null });
      }
    }
  }

  duelLeave(id: string, reason: 'left' | 'wiped' = 'left'): void {
    const p = this.players.get(id);
    if (!p) return;
    const s = this.sessionOf(id);
    if (s) this.syncRunHp(p, s, reason === 'wiped');
    s?.leave(id);
    if (s) this.refreshFieldParty(s);
    p.inBattle = false;
    if (!s) return;
    // Walking out unmarks the body — a mob bricked in `inFight` neither ambushes nor
    // respawns, which reads as a road that died with the duel. And the field grants a
    // breath: without it the next step re-opens the same duel, forever. No session, no
    // breath: travel calls here on every trip, and a trip is not a fight.
    this.releaseLineBodies(id);
    this.duelGrace.set(id, Date.now() + 5000);
    for (const [key, sess] of this.sessions) {
      if (sess.empty) {
        this.sessions.delete(key);
        this.lastTick.delete(key);
      }
    }
    // A fold the player walks out of mid-fight is not cleared; the node simply stays.
    if (s && reason === 'left') this.pushDuelEnd(p, s, { won: false, reason: 'left' });
    if (s?.brawl && reason === 'left') {
      // Walking out hands the bout to whoever is still on the field — or refunds it if
      // nobody is, because a pot cannot strand on an empty room. The survivor gets the
      // end screen, not just the pot toast: a win that never closes the field reads as
      // the duel hanging, and the winner's only way out was abandoning their own win.
      const survivor = [...this.players.values()].find((q) => q.id !== id && s.has(q.id)) ?? null;
      if (survivor) {
        survivor.inBattle = false;
        s.leave(survivor.id);
        this.pushDuelEnd(survivor, s, { won: true, reason: 'cleared' });
        this.announce(survivor.build.callsign + ' won the bout by walkover', s.sector);
      }
      this.refreshFieldParty(s);
      this.endBrawl(s, survivor?.id ?? null, true);
    }
  }

  /** The Link ward: a storm cannot be hurt alone. `consume` is false when only peeking. */
  wardedFor(id: string, consume = true): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    const session = this.sessionOf(id);
    if (!session || session.duelTier !== 'storm') return false;
    if (!this.social.shieldHeld(id, session.occupiedCols())) return false;
    if (!consume) return !this.profiles.has(p.saveKey, 'ward');
    // A Portable Ward is the money answer to the friendship answer: it drops the shield for
    // one program, and only the server knows it was spent.
    if (this.profiles.consume(p.saveKey, 'ward')) {
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
    const r = this.duelEnter(id, this.profiles.areaEnemy(p.saveKey) ? 'node' : 'anomaly');
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
        const doc = this.profiles.doc(p.saveKey);
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
        // A dealt hand is readable from the join but pickable only inside the screen: the charge is
        // what opens it, and a client that claims otherwise gets a refusal it can show the player.
        const check =
          body.hand && body.handOpen && Number.isInteger(msg.cell)
            ? SF.canPick(body.hand, msg.cell!, SF.capsOf(body))
            : { ok: false, reason: body.hand && !body.handOpen ? ('closed' as const) : ('empty' as const) };
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
    this.profiles.countFor(p.saveKey, 'chats');
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

  /**
   * The conversation about brawls. A challenge is an invitation to step on: both
   * sides fight, live, on opposite halves. Whoever it concerns is told.
   */
  pvpAction(id: string, msg: { action?: string; with?: string; wager?: number }): void {
    const me = this.players.get(id);
    if (!me) return;
    const other = msg.with ? this.players.get(String(msg.with)) : undefined;
    switch (msg.action) {
      case 'challenge': {
        if (!other) return void this.pushTo(id, { t: 'pvp', refused: 'that player is gone' });
        if (me.inBattle) return void this.pushTo(id, { t: 'pvp', refused: 'finish your fight first' });
        const bid = Math.floor(Number(msg.wager ?? 0));
        if (!Number.isFinite(bid)) return void this.pushTo(id, { t: 'pvp', refused: 'name a real amount' });
        if (bid > 0 && this.profiles.chogOf(me.saveKey) < bid) {
          return void this.pushTo(id, { t: 'pvp', refused: 'you cannot cover that' });
        }
        const wager = Math.max(0, Math.min(MAX_WAGER, bid));
        const r = this.social.challenge(id, other.id, wager);
        if (!r.ok) return void this.pushTo(id, { t: 'pvp', refused: r.reason });
        this.pushTo(other.id, { t: 'pvp', challenge: { from: id, name: me.build.callsign, wager } });
        this.pushTo(id, { t: 'pvp', notice: wager > 0 ? `challenged ${other.build.callsign} for ${wager} $CHOG` : `challenged ${other.build.callsign}` });
        return;
      }
      case 'accept': {
        const r = this.social.acceptChallenge(id);
        if (!r.ok || !r.from) return void this.pushTo(id, { t: 'pvp', refused: r.reason });
        const from = this.players.get(r.from);
        if (!from) return void this.pushTo(id, { t: 'pvp', refused: 'they left' });
        if (me.inBattle) return void this.pushTo(id, { t: 'pvp', refused: 'finish your fight first' });
        if (from.inBattle) {
          this.pushTo(from.id, { t: 'pvp', notice: `${me.build.callsign} accepted, but you are already fighting` });
          return void this.pushTo(id, { t: 'pvp', refused: 'they are already fighting' });
        }
        const wager = r.wager ?? 0;
        if (wager > 0) {
          if (this.profiles.chogOf(from.saveKey) < wager) {
            this.pushTo(from.id, { t: 'pvp', refused: 'you cannot cover that anymore' });
            return void this.pushTo(id, { t: 'pvp', refused: 'they cannot cover it anymore' });
          }
          if (this.profiles.chogOf(me.saveKey) < wager) {
            return void this.pushTo(id, { t: 'pvp', refused: 'you cannot cover that' });
          }
          // Both stakes leave now, into the fight itself: a disconnect mid-brawl
          // can never strand a half-locked pot.
          this.profiles.addChog(from.saveKey, -wager);
          if (!this.profiles.addChog(me.saveKey, -wager)) {
            this.profiles.addChog(from.saveKey, wager);
            return void this.pushTo(id, { t: 'pvp', refused: 'you cannot cover that' });
          }
        }


        // Both boots step on: the challenger builds the field, the acceptor joins it, and the
        // only gap left is the piloting. Either door failing refunds both stakes on the spot.
        const bout = { rivalId: id, rivalName: me.build.callsign, challengerName: from.build.callsign, challengerId: from.id, challengerKey: from.saveKey, rivalKey: me.saveKey, wager };
        const key = `pvp:${from.id}:${id}`;
        this.pendingPvp.set(from.id, { key, brawl: bout });
        this.pendingPvp.set(id, { key, brawl: bout });
        const entered = this.duelEnter(from.id, 'pvp');
        const joined = entered.ok ? this.duelEnter(id, 'pvp') : entered;
        if (!joined.ok) {
          this.pendingPvp.delete(from.id);
          this.pendingPvp.delete(id);
          const stuck = this.sessions.get(key);
          if (stuck) {
            this.pushDuelEnd(from, stuck, { won: false, reason: 'gone' });
            from.inBattle = false;
            this.sessions.delete(key);
            this.lastTick.delete(key);
          }
          if (wager > 0) {
            this.profiles.addChog(from.saveKey, wager);
            this.profiles.addChog(me.saveKey, wager);
          }
          this.pushTo(from.id, { t: 'pvp', refused: joined.reason });
          return void this.pushTo(id, { t: 'pvp', refused: joined.reason });
        }
        // The bout is real now: both stakes are deducted and the field exists, so
        // the pot is written down. If the process dies mid-brawl, the boot refunds it.
        if (wager > 0) this.saves.escrowPut(key, from.saveKey, me.saveKey, wager);
        this.pushTo(id, { t: 'pvp', notice: wager > 0 ? `${from.build.callsign} stepped in for ${wager} $CHOG a side — the bout is on` : `${from.build.callsign} stepped in — the bout is on` });
        this.pushTo(from.id, { t: 'pvp', notice: `${me.build.callsign} accepted — the bout is on` });
        return;
      }
      case 'decline': {
        const from = this.social.declineChallenge(id);
        if (from) this.pushTo(from, { t: 'pvp', declined: me.build.callsign });
        this.pushTo(id, { t: 'pvp', notice: 'challenge declined' });
        return;
      }
    }
  }

  /**
   * Close out a brawl exactly once: both sides hear how it ended, and a locked pot pays
   * the field's winner minus the team's cut. Win, wipe and walkout all land here, so the
   * `told` flag is what keeps one fight from telling its story — or paying its pot — twice.
   * A field that vanished refunds both stakes instead: money cannot strand on a fight
   * that never happened.
   */
  /**
   * The RANKS boards with live names: whoever is standing on the street shows their
   * callsign, everyone else their token number. Names are not stored anywhere.
   */
  /**
   * Settle a decided bout: both plates hear it, the pot pays the body still standing,
   * and a draw sends both stakes home. Called once, from the tick that sees `over`.
   */
  private settlePvp(session: BattleSession, members: Player[]): void {
    const winner = session.state.winnerId;
    for (const p of members) {
      p.inBattle = false;
      this.pushDuelEnd(p, session, { won: !!winner && p.id === winner, reason: winner ? 'cleared' : 'draw' });
    }
    if (winner) {
      const name = session.state.players.find((b) => b.id === winner)?.name ?? session.brawl?.challengerName ?? 'somebody';
      this.announce(`${name} won the bout`, session.sector);
    }
    this.endBrawl(session, winner);
  }

  private ranksView(you: string): import('@chog/shared').RanksView {
    const view = this.profiles.ranks();
    view.you = you;
    const names = new Map<string, string>();
    for (const q of this.players.values()) names.set(q.saveKey, q.build.callsign);
    for (const board of [view.level, view.pvp, view.chog, view.line]) {
      for (const row of board) {
        const live = names.get(row.key);
        if (live) row.name = live;
      }
    }
    return view;
  }

  private endBrawl(session: BattleSession, winnerId: string | null, fled = false, refund = false): void {
    const b = session.brawl;
    if (!b || b.told) return;
    b.told = true;
    // The pot pays or refunds below either way, so the escrow row dies here, on
    // the one path every settle funnels through.
    if (b.wager > 0) {
      for (const [k, s] of this.sessions) {
        if (s === session) {
          this.saves.escrowDel(k);
          break;
        }
      }
    }
    if (refund || !winnerId) {
      // The field fell apart, the second pair never came, or both went down together:
      // both stakes go home, and the boards hear nothing — a draw is not a loss.
      if (b.wager > 0) {
        this.profiles.addChog(b.challengerKey, b.wager);
        this.profiles.addChog(b.rivalKey, b.wager);
      }
      const story = refund ? 'the field fell apart — stakes returned' : 'a draw — stakes returned';
      for (const pid of [b.challengerId, b.rivalId]) {
        this.pushTo(pid, { t: 'pvp', result: { story, winnerId: null, refunded: b.wager > 0 ? b.wager : 0 } });
        this.notifyProfile(pid);
      }
      return;
    }
    const wonChallenger = winnerId === b.challengerId;
    const pay = b.wager > 0 ? wagerPayout(b.wager) : null;
    if (pay) {
      this.profiles.addChog(wonChallenger ? b.challengerKey : b.rivalKey, pay.prize);
      this.profiles.addChog(VAULT_KEY, pay.rake);
    }
    this.profiles.recordBrawl(b.challengerKey, wonChallenger);
    this.profiles.recordBrawl(b.rivalKey, !wonChallenger);
    const purse = pay ? ` (+${pay.prize} $CHOG)` : '';
    const loser = wonChallenger ? b.rivalName : b.challengerName;
    const winner = wonChallenger ? b.challengerName : b.rivalName;
    const money = pay ? { prize: pay.prize, rake: pay.rake } : {};
    const rival = this.players.get(b.rivalId);
    if (rival) {
      const mine = winnerId === b.rivalId ? `you beat ${b.challengerName}${purse}` : fled ? `you fled ${b.challengerName}${purse}` : `${b.challengerName} beat you${purse}`;
      this.pushTo(rival.id, { t: 'pvp', result: { story: mine, winnerId, ...money } });
      this.notifyProfile(rival.id);
    }
    const champ = this.players.get(b.challengerId);
    if (champ) {
      const mine = winnerId === b.challengerId ? `you beat ${b.rivalName}${purse}` : fled ? `you fled ${b.rivalName}${purse}` : `${b.rivalName} beat you${purse}`;
      this.pushTo(champ.id, { t: 'pvp', result: { story: mine, winnerId, ...money } });
      this.notifyProfile(champ.id);
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

  /**
   * Everyone connected, with what they are doing. Derived, never stored — and
   * rebuilt at most once a second, because it is O(everyone) and the snapshot
   * runs at 20Hz. A join or a leave changes the headcount, so those rebuild
   * immediately; only the doing flickers, a second late at most.
   */
  private rosterAt = 0;
  private rosterCached: Presence[] = [];
  roster(): Presence[] {
    const now = Date.now();
    if (now - this.rosterAt > 1000 || this.rosterCached.length !== this.players.size) {
      this.rosterAt = now;
      this.rosterCached = [...this.players.values()].map((p) =>
        this.social.presence(p, this.sessions.get(p.room) && p.inBattle ? 'battle' : p.inBattle ? 'trading' : p.place === 'house' ? 'idle' : 'street'),
      );
    }
    return this.rosterCached;
  }

  /**
   * Offer a trade: cards and items, to anyone standing on the street. Everything the
   * server can check is checked here — real ids, the offerer holding what they promise,
   * no signature on the table — so a bad offer is refused, not mailed.
   */
  tradeOffer(fromId: string, toId: string, giving: unknown, wanting: unknown, givingItems: unknown, wantingItems: unknown): { ok: boolean; reason?: string; offer?: TradeOffer } {
    const a = this.players.get(fromId);
    const b = this.players.get(toId);
    if (!a || !b) return { ok: false, reason: 'that player is gone' };
    if (fromId === toId) return { ok: false, reason: 'you cannot trade with yourself' };
    const cards = (v: unknown): string[] | null => {
      if (!Array.isArray(v)) return null;
      const ids = v.filter((x): x is string => typeof x === 'string');
      if (ids.length !== v.length || !ids.every((id) => CARD_BY_ID.has(id))) return null;
      return ids;
    };
    const items = (v: unknown): string[] | null => {
      if (!Array.isArray(v)) return null;
      const ids = v.filter((x): x is string => typeof x === 'string');
      if (ids.length !== v.length || !ids.every((id) => id in ITEMS)) return null;
      return ids;
    };
    const counts = (ids: string[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
      return m;
    };
    const give = cards(giving);
    const want = cards(wanting);
    const giveItems = items(givingItems);
    const wantItems = items(wantingItems);
    if (!give || !want || !giveItems || !wantItems) return { ok: false, reason: 'that offer names things that do not exist' };
    if (!give.length && !want.length && !giveItems.length && !wantItems.length) return { ok: false, reason: 'an empty offer trades nothing' };
    if (!give.every((c) => a.save.cards.includes(c))) return { ok: false, reason: 'you no longer hold it' };
    const bag = this.profiles.doc(a.saveKey).bag.items as Record<string, number>;
    for (const [id, n] of counts(giveItems)) {
      if ((bag[id] ?? 0) < n) return { ok: false, reason: 'you no longer hold it' };
    }
    if (give.includes(a.build.signature)) return { ok: false, reason: 'your signature card cannot be traded' };
    if (want.includes(b.build.signature)) return { ok: false, reason: 'their signature card cannot be traded' };
    if (want.some((c) => a.save.cards.includes(c))) return { ok: false, reason: 'you already hold one of those' };
    if (give.some((c) => b.save.cards.includes(c))) return { ok: false, reason: 'they already hold one of those' };
    const trait = (id: string): boolean => {
      const c = CARD_BY_ID.get(id);
      return c !== undefined && isTraitCard(c);
    };
    if (give.some(trait) || want.some(trait)) return { ok: false, reason: 'trait cards cannot be traded' };
    const offer = this.social.offer(fromId, toId, give, want, giveItems, wantItems);
    return { ok: true, offer };
  }

  /**
   * Answer a trade: re-check everything the offer promised — both sides still hold it,
   * no signature crossed the table since — and only then move a single card or item.
   */
  tradeAccept(byId: string, tradeId: string): { ok: boolean; reason?: string; swap?: { to: string; give: string[]; take: string[]; giveItems: string[]; takeItems: string[] } } {
    const t = this.social.trades.get(tradeId);
    if (!t) return { ok: false, reason: 'gone' };
    if (t.to !== byId) return { ok: false, reason: 'not yours' };
    const from = this.players.get(t.from);
    const by = this.players.get(byId);
    if (!from || !by) return { ok: false, reason: 'that player is gone' };
    if (t.giving.includes(from.build.signature) || t.wanting.includes(by.build.signature)) {
      return { ok: false, reason: 'a signature card cannot be traded' };
    }
    const trait = (id: string): boolean => {
      const c = CARD_BY_ID.get(id);
      return c !== undefined && isTraitCard(c);
    };
    if (t.giving.some(trait) || t.wanting.some(trait)) return { ok: false, reason: 'trait cards cannot be traded' };
    const holdings = Object.fromEntries([...this.players.values()].map((pl) => [pl.id, pl.save.cards]));
    const itemHoldings = Object.fromEntries([...this.players.values()].map((pl) => [pl.id, { ...(this.profiles.doc(pl.saveKey).bag.items as Record<string, number>) }]));
    const r = this.social.accept(tradeId, byId, holdings, itemHoldings);
    if (!r.ok) return r;
    if (r.swap.give.some((c) => from.save.cards.includes(c)) || r.swap.take.some((c) => by.save.cards.includes(c))) {
      return { ok: false, reason: 'someone already holds one of those' };
    }
    // The swapper refuses signatures too, but a refusal with the reason beats a swap
    // that silently does nothing — which is what the old route reported as accepted.
    if (!this.swapCards(r.swap.to, byId, r.swap.give, r.swap.take, r.swap.giveItems, r.swap.takeItems)) {
      return { ok: false, reason: 'the trade fizzled' };
    }
    return { ok: true, swap: r.swap };
  }

  /**
   * Move cards and items between two players in one pass.
   *
   * Both sides are written from the same read, so a card cannot end up in two
   * decks. The Social layer already proved both parties still hold what they
   * promised; this is the only place the transfer actually happens.
   */
  swapCards(from: string, to: string, give: string[], take: string[], giveItems: string[] = [], takeItems: string[] = []): boolean {
    const a = this.players.get(from);
    const b = this.players.get(to);
    if (!a || !b) return false;
    // A Chog's own signature card leaves with the token, not with a trade. Without
    // this, holding the NFT would be a temporary loan.
    if (take.includes(a.build.signature) || give.includes(b.build.signature)) return false;
    const mine = a.save.cards;
    const theirs = b.save.cards;
    if (!take.every((c) => mine.includes(c)) || !give.every((c) => theirs.includes(c))) return false;
    if ((giveItems.length || takeItems.length) && !this.profiles.moveItems(a.saveKey, b.saveKey, takeItems, giveItems)) return false;
    a.save.cards = [...mine.filter((c) => !take.includes(c)), ...give];
    b.save.cards = [...theirs.filter((c) => !give.includes(c)), ...take];
    this.saves.setChips(a.saveKey, a.save.cards);
    this.saves.setChips(b.saveKey, b.save.cards);
    this.saves.chapter(a.saveKey, 'trade', `traded ${[...take, ...takeItems].join('+') || 'nothing'} for ${[...give, ...giveItems].join('+') || 'nothing'}`);
    this.saves.chapter(b.saveKey, 'trade', `traded ${[...give, ...giveItems].join('+') || 'nothing'} for ${[...take, ...takeItems].join('+') || 'nothing'}`);
    for (const [x, other] of [[a, b], [b, a]] as [Player, Player][]) {
      this.profiles.countFor(x.saveKey, 'trades');
      this.quest(x.id, [{ type: 'trade' }]);
      // Cards are also collection entries: a trade is a sighting for both sides.
      this.profiles.sight(x.saveKey, keysOfSource(other.attributes));
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
          if (p.sector === s.sector) p.save = this.saves.recordRout(p.saveKey);
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
      ? [...(me.place === 'line' && me.region ? this.playersOnLine(me.region) : me.place === 'house' && me.houseOf != null ? this.playersInHouse(me.houseOf) : this.rooms.get(me.room)?.players ?? [])]
          .map((id) => this.players.get(id))
          .filter((p): p is Player => !!p)
      : [...this.players.values()];
    // Whoever is inside a building is not on the street, whatever their room coordinates say.
// On the Line, a player is visible to the other people in the *same region* — not to the whole
    // world. The six regions are 420 units across and far apart, so showing a Tolls Chog to
    // someone standing in the Static Line would be showing them a stranger walking on the other
    // side of the world.
    const forRegion = me?.region ?? null;
    const forSector = me?.sector;
    const onStreet = visible.filter((p) => (p.place === 'street' && p.sector === forSector) || (p.place === 'line' && p.region === forRegion) || (me?.place === 'house' && p.place === 'house' && p.houseOf === me.houseOf));
    return {
      sectors: this.sectors,
      players: onStreet.map(({ build, save: _s, wallet: _w, saveKey: _sk, room: _r, street: _st, lineAt: _la, at: _at, inPoi: _ip, place: _pl, houseOf: _h, ...rest }) => ({ ...rest, name: build.callsign })),
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
      // A room snapshot is drawn from its own doorstep: housemates do not share the
      // street-room view, so each of them gets a snapshot computed as themselves.
      listener(p.place === 'house' ? this.snapshot(p.id) : (byRoom.get(p.room) ?? this.snapshot(p.id)));
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
    // Lowercased: chain addresses arrive checksummed and log topics lowercase, and the
    // save key has to be one string. The only live wallet save is already lowercase.
    const saveKey = normalizeKey(wallet ? wallet.toLowerCase() : source.tokenId);
    const room = this.assignRoom(sector);
    // Arrive beside the district's quest board, with a little scatter so a crowd logging in
    // does not stand in one place.
    const arrival = boardSideFor(cityOf(sector));
    const p: Player = {
      id,
      tokenId: source.tokenId,
      wallet: wallet ?? null,
      saveKey,
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
      save: this.saves.get(saveKey),
      inBattle: false,
      tribe: build.loadout.element,
      traitsSource: known.source,
      attributes: source.attributes ?? {},
      level: this.profiles.level(saveKey),
      place: 'street',
      region: null,
      houseOf: null,
      lineAt: {},
      street: { x: 0, y: 0 },
      at: Date.now(),
      inPoi: new Set(),
    };
    p.street = { x: p.x, y: p.y };
    this.players.set(id, p);
    room.players.add(id);

    // Owning the token fills its own entries; that is the floor of the Album, and the
    // reason a holder starts ahead of anybody who does not.
    this.profiles.sight(p.saveKey, keysOfSource(source.attributes));
    this.profiles.ensureBounties(p.saveKey, [...SECTORS]);
    p.level = this.profiles.level(p.saveKey);
    // Everyone already in the room just met a new Chog, and the newcomer met them.
    for (const other of room.players) {
      const op = this.players.get(other);
      if (!op || op.id === id) continue;
      if (this.profiles.sight(op.saveKey, keysOfSource(p.attributes)).added.length) this.notifyProfile(op.id);
      if (this.profiles.sight(p.saveKey, keysOfSource(op.attributes)).added.length) this.notifyProfile(p.id);
    }
    this.profiles.questEvents(p.saveKey, [{ type: 'visit', sector }]);
    // Loot outlives the process only on paper: a restart empties the drops map, so cards
    // still owed come back as piles at the owner’s boots. Anything with a live pile already
    // is left exactly where it fell.
    this.replantOwed(id, p);

    return p;
  }

  /** Re-drop owed Line cards that have no live pile. See `oweCards`. */
  private replantOwed(id: string, p: Player): void {
    const owed = this.profiles.owedCardsOf(p.saveKey);
    if (!owed.length) return;
    const live = new Set(
      [...this.drops.values()].filter((d) => d.owner === id && d.kind === 'card').map((d) => d.key),
    );
    const missing = owed.filter((c) => !live.has(c));
    if (missing.length) this.spawnDrops(p, missing, [], 0, { x: p.x, y: p.y }, p.place === 'line' ? p.region : undefined, true);
  }

  /** Register the socket that receives this player's progression pushes. */
  onProfile(id: string, fn: (v: ProfileView) => void): () => void {
    this.profileSends.set(id, fn);
    return () => this.profileSends.delete(id);
  }

  profileFor(id: string): ProfileView | null {
    const p = this.players.get(id);
    if (!p) return null;
    return this.profiles.view(p.saveKey, p.sector, this.volume.mon, p.build, p.tokenId);
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
    const done = this.profiles.questEvents(p.saveKey, evs);
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
    this.duelGrace.delete(id);
    this.lineClaims.delete(id);
    this.sealedToastAt.delete(id);
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
    p.houseOf = null;
    p.street = { x: p.x, y: p.y };
    p.at = Date.now();
    p.inPoi = new Set();
    // Visiting is an objective, and changing district is how you meet new Chogs.
    this.quest(id, [{ type: 'visit', sector }]);
    for (const other of room.players) {
      const op = this.players.get(other);
      if (!op || op.id === id) continue;
      if (this.profiles.sight(op.saveKey, keysOfSource(p.attributes)).added.length) this.notifyProfile(op.id);
      if (this.profiles.sight(p.saveKey, keysOfSource(op.attributes)).added.length) this.notifyProfile(p.id);
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
if ((patch.place === 'room' || patch.place === 'street' || patch.place === 'line' || patch.place === 'house') && patch.place !== p.place) {
      // Into the Line, and back out of it. The per-region parking is what stops a round trip
      // through Ash Pine from dropping you into the middle of Tolls — the two are different
      // coordinate systems that share a plane, so one parked slot is not enough.
      if (patch.place === 'line') {
        const region = p.region;
        if (region) this.park(p, patch.place);
        else this.travel(id, this.openestRegion(p), true);
      } else if (patch.place === 'room' || patch.place === 'house') {
        // A house is entered through its own door (enter, or an accepted invitation),
        // which sets the host first: a bare patch naming 'house' with no host is a
        // forged key and opens nothing.
        if (patch.place === 'house' && p.houseOf == null) return;
        this.park(p, 'street');
        p.place = patch.place;
        p.at = now;
      } else {
        const back = p.place === 'line' ? p.lineAt[p.region ?? ''] : p.street;
        if (back) {
          p.x = back.x;
          p.y = back.y;
        }
        p.place = 'street';
        p.houseOf = null;
      }
      p.at = now;
      return;
    }
    if (typeof patch.x === 'number' && Number.isFinite(patch.x) && typeof patch.y === 'number' && Number.isFinite(patch.y)) {
      const b = p.place === 'room' || p.place === 'house' ? ROOM : p.place === 'line' && p.region ? boundsOfRegion(p.region) : boundsOf(p.sector);
      let nx = Math.max(b.x0, Math.min(b.x1, patch.x));
      let ny = Math.max(b.z0, Math.min(b.z1, patch.y));
      if (p.place === 'street' || p.place === 'line') {
        // Speed is checked against the last position the server accepted, not the `vx` the
        // client reports: a client that asks to be 40 units away is walked there at run
        // speed, which is also why a quest step cannot be satisfied by teleporting to it, and
        // also why an encounter cannot be reached by sending a message rather than walking.
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
    // On the Line, walking into a mob starts the fight — automatically, with no key and no menu.
    // This is the same shape as `checkPois`: the server re-derives "is the player standing on
    // the thing" from its own accepted position, so a forged message cannot start a fight from
    // across the region.
    if (p.place === 'line') this.checkLineMobs(id, p);
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
      w.save = this.saves.recordClear(w.saveKey, tier, sector.peakWave, []);
      const reward = this.profiles.onClear({ saveKey: w.saveKey, tier, sector: sector.sector, damage: own.bestOf(w.id), scale });
      const grant = mergeGrants([reward.grant, this.profiles.grant(w.saveKey, { cards: cards })]);
      this.war.add({ tokenId: w.tokenId, tribe: w.tribe, sector: sector.sector, points: this.profiles.warPoints({ tier, scale, hotSector: hot, sector: sector.sector, volumeMon: this.volume.mon }), clear: true });
      if (party.length > 1) this.profiles.countFor(w.saveKey, 'links');
      this.trackFightQuests(w.id, this.quest(w.id, [...reward.events, ...(party.length > 1 ? [{ type: 'link' as const }] : [])]));
      this.noteLevel(w, grant.level);
      w.save = this.saves.get(w.saveKey);
      this.emit([{ type: 'reward', sector: sector.sector, tokenId: w.tokenId, tier, cards: grant.cards, kills: w.save.kills, level: w.level }]);
      w.inBattle = false;
      this.pushDuelEnd(w, own, { won: true, reason: 'cleared', grant, level: grant.level, lootOnGround: true });
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
