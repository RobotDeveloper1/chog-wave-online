import type { Element } from '../types.ts';
import {
  FIRST_PLAYER_LANE,
  HITSTUN_MS,
  LANES,
  MIN_COLS,
  PVP_HALF,
  PVP_LANES,
  SHOT_FLIGHT_MS,
  bossPhase,
  clampFile,
  coverFiles,
  makeBoss,
  makeField,
  nextShotId,
  phaseOf,
  reaches,
  widen,
  type FieldEvent,
  type Hazard,
  type Shot,
  type WaveField,
} from './field.ts';
import {
  ARCHETYPES,
  archetypeOf,
  mirroredPanels,
  movePanels,
  pickMove,
  type Archetype,
  type BossMove,
} from './boss.ts';
import { battleCard, type BattleCard } from './card.ts';
import { chainMultiplier, matchup, stepChain, NULL_ELEMENT } from './element.ts';
import {
  BARRIER_CAP,
  BURN_EVERY_MS,
  BURN_SHARE,
  BURN_TICKS,
  FIRST_READY,
  FREEZE_MS,
  FREEZE_SLOW,
  MIN_TELEGRAPH_MS,
  MIN_QUIET_MS,
  STUN_CAP_MS,
  STUN_MS,
  HAND_HOLD_MS,
  REOPEN_MS,
  DEFEAT_LOCKOUT_MS,
  enemyVolleyDamage,
  chargeMsFor,
  volleyClock,
  type DuelTier,
} from './clock.ts';
import {
  canPick,
  clear,
  drawHand,
  emptyHand,
  pick as pickCell,
  preview,
  undo,
  view as customView,
  type Caps,
  type HandState,
} from './hand.ts';
import {
  aggroScore,
  canRevive,
  crossLink,
  chargeScale,
  DOWN_GRACE_MS,
  REVIVE_HOLD_MS,
  revivedHp,
  type Volley,
} from './party.ts';
import { ARMOUR_CAP, attackScale, clampPct, type DuelStats } from './stats.ts';
import { basicCardFor } from './loadout.ts';
import { quirkOf } from '../line/quirks.ts';
import { rankLevel, dropFor, emptyRank, rankOf, type RankStats, type Rank } from './rank.ts';
import type { BossView, DuelView, HazardView, Place, PlayerView, YouView } from './view.ts';

/**
 * The duel.
 *
 * One state machine, pure, run only on the server. It owns the field, the bodies, the clocks and
 * the tally, and it answers exactly one question every tick: **what happened?** The client says
 * what it wants (step here, take that card, fire) and is told what the field decided. Nothing
 * here reads a number the client sent about damage, and nothing here trusts a card the Hand
 * Screen would have refused.
 *
 * The shape of a fight is a loop of four beats:
 *
 *   1. **The charge fills.** You dodge — stepping off marked panels hurries the next Hand.
 *   2. **The screen opens.** Six candidates, one element, one Mega, no duplicates. You build a
 *      program in the order it will fire.
 *   3. **The cards go out**, one at a time, aiming by the file you are standing on.
 *   4. **The anomaly winds up.** Panels flash. You step off them — or you fire *into* them, and
 *      the hit is a counter: double damage, and it pays you a card for the next screen.
 *
 * Beat 4 is the whole game. Everything else on this page exists to make that one decision
 * legible and expensive.
 */

/** Milliseconds between two cards of the same program. Long enough to watch each one land. */
export const PROGRAM_STAGGER_MS = 220;
/** A clean dodge is worth this much Charge. Combat is cards and dodging now —
 *  there is no neutral gun to fall back on, so the time between Hands has a
 *  job: get out of the marked panels and the next Hand comes sooner. */
export const DODGE_CHARGE_MS = 700;

/**
 * Grace a *real* dodge earns. Stepping OFF a panel that is currently marked — the one moment you
 * actually had to move — buys a short invulnerability window, so the animation you asked for is
 * the one that saves you. It cannot be farmed: it only fires while a marked panel was underfoot,
 * so waiting out a quiet stretch or pace-walking across an empty field grants nothing.
 */
export const DODGE_IFRAME_MS = 220;

/** What a crit does. Doubling is legible in a way that +73% is not. */
export const CRIT_MULTIPLIER = 2;
/** What a Chog wearing its own Skin's element takes from that element. */
export const RESIST_TAKEN = 0.75;

export type StepDir = 'left' | 'right' | 'back' | 'forward';

export interface DuelBody {
  /** Stable id for this body on the field. */
  id: string;
  /** Wallet-distinct owner, so a party of four alts cannot multiply a payout. */
  owner: string;
  name: string;
  tribe: Element;
  level: number;
  stats: DuelStats;
  hp: number;
  maxHp: number;
  file: number;
  lane: number;
  /** PvP side: 0 holds the near half, 1 the far. Always 0 outside PvP. */
  side: 0 | 1;
  /** The cards this body owns, as ids. Repeats make a card likelier to be drawn. */
  deck: string[];
  /**
   * The element's basic attack, with this token's own numbers already substituted into it.
   *
   * This is what fills a hand the deck is too small to fill, and it is carried on the body
   * rather than looked up per deal because the number is the token's: two Chogs in the same party
   * press different buttons and hit for different damage, and that gap is the whole of what the
   * NFT is worth before the Line has given you anything to press instead. See
   * sf/loadout.ts basicMight and docs/THE-LINE.md �4.3.
   */
  basic: BattleCard;
  /** Which Chog filled this seat — one of the 1,969. */
  tokenId: number;
  /** The Mouth trait: how hard the anomaly comes for this body. Negative is sneakier. */
  aggro: number;
  /** The Skin trait: the element this Chog shrugs off. */
  resist: Element | null;

  /** Non-null while this body has a hand dealt — which is from the moment it joins the field. */
  hand: HandState | null;
  /**
   * The body's own dice for dealing hands. The session's stream drives the boss, and tests rig it;
   * spending it on a deal at join would shift every wind-up the boss ever makes, so the hand keeps
   * a stream of its own, seeded from who the body is.
   */
  handRand: () => number;
  /**
   * Whether the body is *inside* the Hand right now. The hand is dealt at join so the
   * panel has something to show from the first frame, but the screen is a safe room and picking is
   * a committed act, so both of those wait for the charge — this flag is the difference.
   */
  handOpen: boolean;
  /** Milliseconds the screen has been open. It is a safe room you can be pushed out of. */
  handMs: number;
  /** Milliseconds of Hand Charge banked, and how long a full fill takes. */
  charge: number;
  chargeMs: number;
  /** Whether this battle's one Giga has been spent. */
  gigaSpent: boolean;
  /** Tribe On: the element lock is lifted. */
  transformed: boolean;

  /** The program going out, one card at a time. */
  program: { cards: BattleCard[]; at: number; timer: number } | null;

  /** The element chain: how deep the current run is, and which element it is a run of. */
  chain: number;
  lastElement: Element | null;
  /** Cards paid by counters, waiting for the next screen. */
  bonus: string[];

  down: boolean;
  /** Milliseconds before the run loses this body. */
  downLeft: number;
  /** The cover hold this body is running for somebody else. */
  hold: { target: string; ms: number } | null;
  /** Milliseconds of invulnerability after taking a hit. */
  invuln: number;
  /** BARRIER charges: each eats one landed hit, then it is gone. */
  barrier: number;
  /**
   * Status from a rival's program, PvP only. Stun locks the hand shut, freeze slows the
   * charge to a crawl, burn ticks away on its own clock. The body can always still step:
   * being locked out of firing is the punishment, being unable to move would be the burial.
   */
  stun: number;
  freeze: number;
  burn: { ticks: number; damage: number; acc: number } | null;

  rank: RankStats;
  /** Wave drained (or, on a void card, pushed up) by the cards this body fired. */
  waveDrained: number;
  /** The last link this body resonated with, for the HUD. */
  link: { tag: string | null; mult: number } | null;
}

export interface BossSpec {
  name: string;
  archetype: Archetype;
  tier: DuelTier;
  /** The anomaly's level, which is what the reading window is measured against. */
  level: number;
  /** The map's own tuning for how hard this thing hits. */
  power?: number;
  /** 1..6. How far up the ladder this fight is: it decides how many words the boss knows. */
  difficulty: number;
  training: boolean;
  node: boolean;
  /** A BREAK card has stripped the archetype's armour for the rest of the fight. */
  guardBroken: boolean;
  /** Milliseconds of freeze owed to STUN cards. */
  stun: number;
  /** A BURN card's leftover: ticks to go, damage a tick, time banked toward the next. */
  burn: { ticks: number; damage: number; acc: number } | null;
  /** Milliseconds of FREEZE left: the whole clock runs slow while this lasts. */
  freeze: number;
  /** Milliseconds until the next wind-up. */
  next: number;
  /** The encounter quirk, when the fight is one — null everywhere else. */
  quirk: string | null;
  /** What the boss remembers, handed back to `pickMove` every volley. */
  lastMove: string | null;
  streak: number;
  volleys: number;
}

export interface DuelSession {
  id: string;
  place: Place;
  field: WaveField;
  boss: BossSpec;
  players: DuelBody[];
  /** Milliseconds since the anomaly last repositioned. */
  bossClock: number;
  /** Milliseconds this fight has run. */
  elapsed: number;
  /** Recent landing hits, for the cross-link. */
  recent: Volley[];
  /** The Link ward: nothing lands until two banded bodies stand on neighbouring files. */
  warded: boolean;
  /** The last program's files, so a Mirror can answer with them. */
  lastProgram: { id: string; files: number[] } | null;
  /** Total wave bled off the district by this fight. Negative when void was used. */
  wave: number;
  over: boolean;
  result: 'win' | 'loss' | null;
  /** PvP: both bodies are players, and programs raise hazards on the rival. */
  pvp: boolean;
  /** PvP decision: the body still standing, or null for a draw — and always null outside PvP. */
  winnerId: string | null;
  events: FieldEvent[];
  rand: () => number;
}

// ---------------------------------------------------------------------------
// Opening a field
// ---------------------------------------------------------------------------

export interface OpenArgs {
  id: string;
  place: Place;
  boss: {
    name: string;
    archetype?: string;
    element?: Element;
    hp: number;
    level: number;
    power?: number;
    tier?: DuelTier;
    /** 1..6. Defaults to 1. */
    difficulty?: number;
    training?: boolean;
    node?: boolean;
    /** The encounter quirk id, when the fight is one. */
    quirk?: string;
    /** PvP: no boss clock, no boss hunt — the two bodies are the whole fight. */
    pvp?: boolean;
  };
  /** The Link ward is up. */
  warded?: boolean;
  rand?: () => number;
}

export function openSession(args: OpenArgs): DuelSession {
  const info = ARCHETYPES[archetypeOf(args.boss.archetype)] ?? ARCHETYPES.glitch;
  const cols = MIN_COLS;
  const file = Math.floor(cols / 2);
  const boss = makeBoss({
    hp: Math.max(1, Math.round(args.boss.hp)),
    element: args.boss.element ?? info.element,
    file,
    cols,
  });
  const field = makeField(boss, cols, args.boss.pvp ? PVP_LANES : LANES);

  // A FRONT walls a file off for the whole fight. Never its own file — that would make it
  // unhittable by anything but a Sword, which is not a wall, it is a wall with teeth.
  // A quirk can wall a file too: the reaper's fence holds one the way a FRONT does.
  const quirkWalls = quirkOf(args.boss.quirk).walls ?? false;
  if ((info.walls || quirkWalls) && cols > 2) {
    const side = (args.rand ?? Math.random)() < 0.5 ? -1 : 1;
    let blocked = clampFile(file + side, cols);
    if (blocked === file) blocked = clampFile(file - side, cols);
    if (blocked !== file) field.blocked = blocked;
  }

  const difficulty = Math.max(1, Math.min(6, Math.round(args.boss.difficulty ?? 1)));
  const clock = volleyClock({ phase: 1, training: args.boss.training, difficulty });

  return {
    id: args.id,
    place: args.place,
    field,
    boss: {
      name: args.boss.name,
      archetype: archetypeOf(args.boss.archetype),
      tier: args.boss.tier ?? 'glitch',
      level: args.boss.level,
      ...(args.boss.power ? { power: args.boss.power } : {}),
      difficulty,
      training: !!args.boss.training,
      node: !!args.boss.node,
      guardBroken: false,
      stun: 0,
      burn: null,
      freeze: 0,
      next: Math.round(clock.gap * FIRST_READY * (quirkOf(args.boss.quirk).clock?.gapK ?? 1)),
      quirk: args.boss.quirk ?? null,
      lastMove: null,
      streak: 0,
      volleys: 0,
    },
    players: [],
    bossClock: 0,
    elapsed: 0,
    recent: [],
    warded: !!args.warded,
    lastProgram: null,
    wave: 0,
    over: false,
    result: null,
    pvp: !!args.boss.pvp,
    winnerId: null,
    events: [],
    rand: args.rand ?? Math.random,
  };
}

export interface JoinArgs {
  id: string;
  owner: string;
  name: string;
  tribe: Element;
  level: number;
  stats: DuelStats;
  deck?: readonly string[];
  /**
   * The element's basic attack for this seat, number already substituted from the token's
   * attributes. Omitted means a neutral mid-range Chog, which is what a test that never set out
   * to measure the gap between a common and a Legendary should get.
   */
  basic?: BattleCard;
  /** Which Chog this is. One seat, one token. */
  tokenId?: number;
  /** The Mouth trait's aggro. Omitted is neutral. */
  aggro?: number;
  /** The Skin trait's resist. */
  resist?: Element;
  /** Tribe On is already running. */
  transformed?: boolean;
}

/**
 * Put a body on the field.
 *
 * The floor widens to the widest Chog standing on it, and only ever widens — so a body already
 * standing at file 2 is still at file 2 when a bigger Chog arrives. Dodging room *is*
 * progression, and it is the reason a bigger Chog is not simply a bigger number.
 */
export function addBody(s: DuelSession, a: JoinArgs): DuelBody {
  const side: 0 | 1 = s.pvp && s.players.length % 2 === 1 ? 1 : 0;
  widen(s.field, a.stats.cols);
  const chargeMs = chargeMsFor({ charge: a.stats.charge, training: s.boss.training });
  const body: DuelBody = {
    id: a.id,
    owner: a.owner,
    name: a.name,
    tribe: a.tribe,
    level: Math.max(1, Math.round(a.level)),
    stats: a.stats,
    hp: a.stats.hp,
    maxHp: a.stats.hp,
    file: clampFile(Math.floor(s.field.cols / 2), s.field.cols),
    lane: side === 1 ? 0 : s.field.lanes - 1,
    side,
    deck: [...(a.deck ?? [])],
    basic: a.basic ?? basicCardFor(a.tribe, { PWR: 4, SPD: 4 }),
    tokenId: a.tokenId ?? 0,
    aggro: a.aggro ?? 0,
    resist: a.resist ?? null,
    hand: null,
    handOpen: false,
    handMs: 0,
    handRand: handDice(s, a.id),
    charge: Math.round(chargeMs * FIRST_READY),
    chargeMs,
    gigaSpent: false,
    transformed: !!a.transformed,
    program: null,
    chain: 0,
    lastElement: null,
    bonus: [],
    down: false,
    downLeft: 0,
    hold: null,
    invuln: 0,
    barrier: 0,
    stun: 0,
    freeze: 0,
    burn: null,
    rank: emptyRank(),
    waveDrained: 0,
    link: null,
  };
  s.players.push(body);
  // The hand is dealt on arrival, not when the charge fills: the panel is a readout of what you
  // hold, and a fight that opens on an empty panel opens on nothing to plan with.
  dealHand(s, body);
  return body;
}

export function removeBody(s: DuelSession, id: string): void {
  s.players = s.players.filter((p) => p.id !== id);
  if (!s.players.length && !s.over) {
    s.over = true;
    s.result = 'loss';
  }
}

// ---------------------------------------------------------------------------
// Small reads
// ---------------------------------------------------------------------------

const byId = (s: DuelSession, id: string): DuelBody | null => s.players.find((p) => p.id === id) ?? null;

export const capsOf = (b: DuelBody): Caps => ({
  slots: b.stats.slots,
  mega: b.stats.megaCap,
  giga: b.stats.gigaCap,
});

/** A body may act when it is standing, out of the menu and not mid-program. */
export const canAct = (b: DuelBody): boolean => !b.down && !b.handOpen && b.program === null;

/** Frozen: in the menu or firing a program. The client greys out movement on this. */
export const isFrozen = (b: DuelBody): boolean => b.handOpen || b.program !== null;

/**
 * The level the reading window is measured against: the **mean** level of the bodies standing
 * on the field, not the highest. Four Chogs cannot carry one level-2 walker through a window it
 * never had.
 */
export function meanLevel(s: DuelSession): number {
  if (!s.players.length) return 1;
  return s.players.reduce((n, p) => n + p.level, 0) / s.players.length;
}

/** How much of every card this anomaly is eating. A Sword ignores it; a Break strips it. */
export function guardOf(s: DuelSession): number {
  if (s.boss.guardBroken) return 0;
  return ARCHETYPES[s.boss.archetype]?.guard ?? 0;
}

const emit = (s: DuelSession, e: FieldEvent): void => {
  s.events.push(e);
};

/** Take the events since the last flush. The server sends these and then forgets them. */
export function drainEvents(s: DuelSession): FieldEvent[] {
  const out = s.events;
  s.events = [];
  return out;
}

// ---------------------------------------------------------------------------
// The player's verbs
// ---------------------------------------------------------------------------

/**
 * Step one panel.
 *
 * Two axes, because the field is a grid and some attacks are answered by stepping *back* rather
 * than sideways: a BEAM owns the whole row under your feet, and the only answer is the far lane.
 */
/**
 * The lanes a side owns. PvE keeps the old 3/2 split (the boss patterns are tuned
 * against it); PvP splits the six lanes 3/3, so both bodies dodge in the same room.
 */
const halfLo = (s: DuelSession, side: 0 | 1): number =>
  s.pvp ? (side === 1 ? 0 : PVP_HALF) : FIRST_PLAYER_LANE;
const halfHi = (s: DuelSession, side: 0 | 1): number =>
  s.pvp ? (side === 1 ? PVP_HALF - 1 : s.field.lanes - 1) : LANES - 1;
export function step(s: DuelSession, id: string, dir: StepDir): boolean {
  const b = byId(s, id);
  // A program in flight still locks the boots; an open screen does not. Stepping out of
  // the safe room closes it — the dealt hand stays on the table, the shield does not
  // follow, and the charge drops to a short beat short of full (`REOPEN_MS`) instead of
  // zero. Zero punished the dodge itself: the screen still cannot snap straight back open,
  // but stepping off a telegraph no longer forfeits the whole calm you just earned.
  // Firing stays locked by `canAct` wherever pulling a trigger is concerned; this only
  // ever opens the body, never the trigger.
  if (!b || b.down || b.program !== null) return false;
  if (b.handOpen) {
    b.handOpen = false;
    b.handMs = 0;
    b.charge = Math.max(0, b.chargeMs - REOPEN_MS);
  }
  const wasFile = b.file;
  const wasLane = b.lane;
  if (dir === 'left') b.file = clampFile(b.file - 1, s.field.cols);
  else if (dir === 'right') b.file = clampFile(b.file + 1, s.field.cols);
  else if (dir === 'back') b.lane = Math.max(halfLo(s, b.side), b.lane - 1);
  else b.lane = Math.min(halfHi(s, b.side), b.lane + 1);
  if (b.file === wasFile && b.lane === wasLane) return false;
  // A dodge out of live danger earns a beat of grace: stepping off a panel that is marked right
  // now starts a short invulnerability window, so the read forgives the animation instead of
  // charging you for it. Only a genuine escape triggers it — a marked panel has to have been under.
  const marked = (file: number, lane: number): boolean =>
    s.field.hazards.some((h) => h.panels.some((p) => p.file === file && p.lane === lane));
  if (marked(wasFile, wasLane) && !marked(b.file, b.lane)) {
    b.invuln = Math.max(b.invuln, DODGE_IFRAME_MS);
  }
  // A body holding a cover hold lets go of it the moment it moves.
  b.hold = null;
  b.rank.steps += 1;
  return true;
}

export function pickCard(s: DuelSession, id: string, cell: number): boolean {
  const b = byId(s, id);
  if (!b || !b.hand || !b.handOpen) return false;
  if (!canPick(b.hand, cell, capsOf(b)).ok) return false;
  b.hand = pickCell(b.hand, cell, capsOf(b)).state;
  return true;
}

export const undoCard = (s: DuelSession, id: string): void => {
  const b = byId(s, id);
  if (b?.hand && b.handOpen) b.hand = undo(b.hand);
};

export const clearCards = (s: DuelSession, id: string): void => {
  const b = byId(s, id);
  if (b?.hand && b.handOpen) b.hand = clear(b.hand);
};

/**
 * Close the screen and send the program.
 *
 * The order you took the cards in is the order they fire in, and that is a decision: cards land
 * staggered, so the card you took first is the one in the air when the anomaly starts its next
 * wind-up — which is how you earn a counter.
 */
export function execute(s: DuelSession, id: string): boolean {
  const b = byId(s, id);
  if (!b || !b.hand || !b.handOpen) return false;
  const cards = preview(b.hand, capsOf(b)).cards;
  if (cards.some((c) => c.cls === 'giga')) b.gigaSpent = true;
  b.hand = null;
  b.handOpen = false;
  b.handMs = 0;
  b.charge = 0;
  b.hold = null;
  // The next hand is dealt before the panel repaints, so the screen never shows an empty table:
  // what you are looking at is always what you will fire next.
  dealHand(s, b);
  if (cards.length) {
    if (s.pvp) pvpProgram(s, b, cards);
    else b.program = { cards, at: 0, timer: 0 };
    s.lastProgram = { id: b.id, files: [] };
  }
  emit(s, { type: 'hand', owner: b.id, open: false });
  return true;
}



/** Start or stop running a cover hold for a downed partner. */
export function setCover(s: DuelSession, id: string, target: string | null): void {
  const b = byId(s, id);
  if (!b) return;
  if (target === null) {
    b.hold = null;
    return;
  }
  const t = byId(s, target);
  if (!t || !canRevive({
    partySize: s.players.length,
    downed: { file: t.file, alive: !t.down },
    rescuer: { file: b.file, alive: !b.down },
  }).ok) return;
  b.hold = { target, ms: 0 };
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

  /**
   * What a card would hit for, decided the same way `fireCard` decides it — element,
   * chain, counter, class, guard — so a screen can preview a program without inventing
   * damage the server would contradict. Crit stays out: it is rolled on the landing,
   * which is the one number a preview is not allowed to know.
   *
   * `linkMult` and `guard` are read off the view, not recomputed: the link is whatever
   * band is resonating now, and the guard is whatever the anomaly is eating now.
   */
  export function previewDamage(
    card: Pick<BattleCard, 'might' | 'kind' | 'element'>,
    st: {
      chain: number;
      lastElement: Element | null;
      attack: number;
      bossElement: Element;
      counter: boolean;
      linkMult: number;
      guard: number;
    },
  ): { element: Element; run: number; damage: number } {
    // A CHAIN card is whatever element you are already running, the same rule as fireCard.
    const element = card.kind === 'chain' && st.lastElement !== null ? st.lastElement : card.element;
    const run = stepChain(st.chain, st.lastElement, element);
    const guardFactor = card.kind === 'sword' || card.kind === 'break' ? 1 : 1 - st.guard;
    return {
      element,
      run,
      damage: Math.max(
        1,
        Math.round(
          card.might *
            attackScale(st.attack) *
            matchup(element, st.bossElement) *
            chainMultiplier(run) *
            (st.counter ? 2 : 1) *
            st.linkMult *
            guardFactor,
        ),
      ),
    };
  }

  /**
   * Put one card in the air.
   *
   * How hard it hits is `previewDamage` — the one formula, so the screen and the field
   * cannot disagree. What the flight still has to decide is the only honest question
   * left — is the anomaly standing on a file this card covers?
   */
  function fireCard(s: DuelSession, b: DuelBody, c: BattleCard): void {
    // A CHAIN card is whatever element you are already running, which is the whole point of it.
    const element = c.kind === 'chain' && b.lastElement !== null ? b.lastElement : c.element;
    const run = stepChain(b.chain, b.lastElement, element);
    const counter = s.field.hazards.length > 0;
  const link = crossLink({
    self: { id: b.id, element, file: b.file },
    now: s.elapsed,
    recent: s.recent,
    party: s.players.map((p) => p.id),
  });
  const damage = previewDamage(c, {
    chain: b.chain,
    lastElement: b.lastElement,
    attack: b.stats.attack,
    bossElement: s.field.boss.element,
    counter: s.field.hazards.length > 0,
    linkMult: link.mult,
    guard: guardOf(s),
  }).damage;

  const files = coverFiles(c.shape, b.file, s.field.cols);
  const shot: Shot = {
    id: nextShotId(),
    owner: b.id,
    cardId: c.id,
    element,
    cls: c.cls,
    kind: c.kind,
    files,
    damage,
    counter,
    t: 0,
    travel: SHOT_FLIGHT_MS,
  };
  s.field.shots.push(shot);

  b.chain = run;
  b.lastElement = element;
  b.rank.maxChain = Math.max(b.rank.maxChain, run);
  b.link = { tag: link.tag, mult: link.mult };
  b.waveDrained += c.waveDrain;
  s.wave += c.waveDrain;

  if (s.lastProgram?.id === b.id) {
    s.lastProgram.files = [...new Set([...s.lastProgram.files, ...files])];
  }

  emit(s, {
    type: 'shot-fired',
    owner: b.id,
    cardId: c.id,
    files,
    damage,
    counter,
    cls: c.cls,
    kind: c.kind,
    element,
  });
}

/** Everything the flight decided, resolved in one place. */
function landShot(s: DuelSession, shot: Shot): void {
  const b = byId(s, shot.owner);
  const boss = s.field.boss;
  if (s.field.blocked !== null && shot.files.includes(s.field.blocked) && shot.kind !== 'sword') {
    emit(s, { type: 'blocked', owner: shot.owner, cardId: shot.cardId, file: s.field.blocked });
    return;
  }
  if (!reaches(shot, boss, s.field.blocked)) {
    emit(s, { type: 'miss', owner: shot.owner, cardId: shot.cardId, files: shot.files });
    return;
  }

  // A crit is rolled here, on the landing, because it is the one number on the field a player
  // is allowed to be lucky about — and it has to be the server that decides they were.
  const crit = !!b && b.stats.crit > 0 && s.rand() * 100 < b.stats.crit;
  const damage = crit ? Math.round(shot.damage * CRIT_MULTIPLIER) : shot.damage;

  emit(s, {
    type: 'hit',
    owner: shot.owner,
    cardId: shot.cardId,
    damage,
    counter: shot.counter,
    weak: matchup(shot.element, boss.element),
    chain: b?.chain ?? 0,
    element: shot.element,
    cls: shot.cls,
    kind: shot.kind,
  });

  s.recent.push({ id: shot.owner, element: shot.element, file: b?.file ?? 0, at: s.elapsed });
  hurtBoss(s, damage);
  if (!b || s.over) return;

  // A counter is the fight's whole skill expression: you read the wind-up, committed a card
  // into it, and it paid you twice — once in damage and once in cards.
  if (shot.counter) {
    b.rank.counters += 1;
    if (b.deck.length) {
      b.bonus.push(b.deck[Math.floor(s.rand() * b.deck.length) % b.deck.length]!);
      b.rank.bonus += 1;
      emit(s, { type: 'bonus-card', owner: b.id });
    }
  }
  if (shot.kind === 'drain') {
    const heal = Math.max(1, Math.round(damage * b.stats.drain));
    b.hp = Math.min(b.maxHp, b.hp + heal);
    emit(s, { type: 'drain', owner: b.id, amount: heal });
  }
  if (shot.kind === 'stun') {
    const add = Math.min(STUN_MS, STUN_CAP_MS - s.boss.stun);
    if (add > 0) {
      s.boss.stun += add;
      emit(s, { type: 'stun', owner: b.id, ms: add });
    }
  }
  if (shot.kind === 'burn') {
    const tick = Math.max(1, Math.round(damage * BURN_SHARE));
    s.boss.burn = { ticks: BURN_TICKS, damage: tick, acc: 0 };
    emit(s, { type: 'burn', owner: b.id, ticks: BURN_TICKS, damage: tick });
  }
  if (shot.kind === 'freeze') {
    s.boss.freeze = FREEZE_MS;
    emit(s, { type: 'freeze', owner: b.id, ms: FREEZE_MS });
  }
  if (shot.kind === 'barrier') {
    const before = b.barrier;
    b.barrier = Math.min(BARRIER_CAP, b.barrier + 1);
    if (b.barrier !== before) emit(s, { type: 'barrier', owner: b.id, charges: b.barrier });
  }
  if (shot.kind === 'break') {
    if (!s.boss.guardBroken) {
      s.boss.guardBroken = true;
      emit(s, { type: 'guard-break', owner: b.id });
    }
    // A Break shoves the anomaly onto the file it was fired from, which is a reposition the
    // rest of the party can aim at.
    const to = clampFile(b.file, s.field.cols);
    if (boss.file !== to) {
      boss.file = to;
      emit(s, { type: 'knock', owner: b.id, file: to });
    }
  }
}

function hurtBoss(s: DuelSession, amount: number): void {
  if (s.over) return;
  const boss = s.field.boss;
  const before = bossPhase(boss);
  boss.hp = Math.max(0, boss.hp - amount);
  const after = bossPhase(boss);
  if (after !== before) emit(s, { type: 'phase', phase: after });
  if (boss.hp <= 0) {
    emit(s, { type: 'boss-down' });
    s.over = true;
    s.result = 'win';
  }
}

// ---------------------------------------------------------------------------
// The anomaly's turn
// ---------------------------------------------------------------------------

/**
 * The body the anomaly is aiming at.
 *
 * Closest first, but aggro overrides proximity: a Chog with a loud Mouth is the one the boss
 * singles out even from across the floor. That is the tank mechanic, and it lives on the token —
 * so bringing a loud Chog to a party is a real thing you chose to do.
 */
function nearest(s: DuelSession): DuelBody | null {
  const alive = s.players.filter((p) => !p.down);
  if (!alive.length) return null;
  const score = (p: DuelBody): number => aggroScore(p.aggro, Math.abs(p.file - s.field.boss.file));
  return alive.reduce((a, b) => (score(b) > score(a) ? b : a));
}

function clockOf(s: DuelSession): { telegraph: number; gap: number } {
  return volleyClock({
    phase: bossPhase(s.field.boss),
    training: s.boss.training,
    levelGap: s.boss.level - meanLevel(s),
    difficulty: s.boss.difficulty,
  });
}

function raiseHazard(s: DuelSession, move: BossMove, panels: ReturnType<typeof movePanels>, tell: number, owner: string | null = null, drain = 0): void {
  const files = [...new Set(panels.map((p) => p.file))];
  const ms = Math.max(MIN_TELEGRAPH_MS, Math.round(clockOf(s).telegraph * tell * (quirkOf(s.boss.quirk).clock?.tellK ?? 1)));
  const damage = enemyVolleyDamage(
    bossPhase(s.field.boss),
    s.boss.tier,
    s.boss.power,
    s.boss.archetype,
    s.boss.level - meanLevel(s),
  );
  const on = s.players
    .filter((p) => !p.down && !p.handOpen && panels.some((n) => n.file === p.file && n.lane === p.lane))
    .map((p) => p.id);
  const hazard: Hazard = {
    panels,
    files,
    left: ms,
    total: ms,
    move: move.id,
    label: move.name,
    damage,
    on,
    owner,
    drain,
    stunMs: 0,
    freezeMs: 0,
    burn: null,
    barrier: false,
  };
  s.field.hazards = [...s.field.hazards.filter((h) => h.owner !== owner), hazard];
  s.boss.next = ms;
  emit(s, {
    type: 'telegraph',
    panels,
    files,
    ms,
    move: move.id,
    label: move.name,
    damage,
    atFile: s.field.boss.file,
  });
}

/** How long a rival's program stays marked before it lands. Flat: the read is the game. */
export const PVP_TELEGRAPH_MS = 900;
/** A downed body in PvP is decided fast: no revive is coming, so no wake is held. */
export const PVP_DOWN_MS = 1500;

/**
 * A program in PvP: no boss to shoot, so the cards become a warning on the rival's row.
 *
 * Same formula as a shot (`previewDamage` — the screen and the field still cannot disagree),
 * but the matchup is read against the rival's tribe, the chain runs across the program's own
 * cards, and the whole thing lands as one hazard on the files the cards cover, on the lane
 * the rival is standing on. Dodge the file or the lane; standing in it is consent.
 *
 * Firing into a live warning is still a counter — double damage and a bonus card — and a
 * DRAIN card still pays its share when the warning lands. Status rides along too, and lands
 * with the hit: STUN locks the rival's hand shut, FREEZE slows their charge to a crawl,
 * BURN ticks away, and a BARRIER card arms the shooter when the warning connects. No card
 * in the collection says BREAK or SWORD, so those stay damage-only by absence, not by rule.
 */
function pvpProgram(s: DuelSession, b: DuelBody, cards: BattleCard[]): void {
  const rival = s.players.find((p) => p.id !== b.id && !p.down) ?? s.players.find((p) => p.id !== b.id);
  if (!rival || !cards.length) return;
  const counter = s.field.hazards.some((h) => h.owner !== b.id);
  let damage = 0;
  let drain = 0;
  let stunMs = 0;
  let freezeMs = 0;
  let burn = false;
  let barrier = false;
  const files = new Set<number>();
  for (const c of cards) {
    const pre = previewDamage(c, {
      chain: b.chain,
      lastElement: b.lastElement,
      attack: b.stats.attack,
      bossElement: rival.tribe,
      counter,
      linkMult: 1,
      guard: 0,
    });
    damage += pre.damage;
    b.chain = pre.run;
    b.lastElement = pre.element;
    b.rank.maxChain = Math.max(b.rank.maxChain, pre.run);
    if (c.kind === 'drain') drain = Math.max(drain, b.stats.drain);
    if (c.kind === 'stun') stunMs = Math.max(stunMs, STUN_MS);
    if (c.kind === 'freeze') freezeMs = Math.max(freezeMs, FREEZE_MS);
    if (c.kind === 'burn') burn = true;
    if (c.kind === 'barrier') barrier = true;
    for (const f of coverFiles(c.shape, b.file, s.field.cols)) files.add(f);
    b.waveDrained += c.waveDrain;
    s.wave += c.waveDrain;
  }
  b.link = { tag: null, mult: 1 };
  if (counter) {
    b.rank.counters += 1;
    if (b.deck.length) {
      b.bonus.push(b.deck[Math.floor(s.rand() * b.deck.length) % b.deck.length]!);
      b.rank.bonus += 1;
      emit(s, { type: 'bonus-card', owner: b.id });
    }
  }
  const list = [...files].sort((x, y) => x - y);
  const panels = list.map((file) => ({ file, lane: rival.lane }));
  const ms = PVP_TELEGRAPH_MS;
  const lead = cards[0]!;
  const on = !rival.down && !rival.handOpen && list.includes(rival.file) ? [rival.id] : [];
  s.field.hazards = [...s.field.hazards.filter((h) => h.owner !== b.id), {
    panels, files: list, left: ms, total: ms, move: 'pvp-program', label: lead.name,
    damage: Math.max(1, damage), on, owner: b.id, drain,
    stunMs, freezeMs,
    burn: burn ? { ticks: BURN_TICKS, damage: Math.max(1, Math.round(damage * BURN_SHARE)) } : null,
    barrier,
  }];
  emit(s, {
    type: 'telegraph',
    panels,
    files: list,
    ms,
    move: 'pvp-program',
    label: lead.name,
    damage: Math.max(1, damage),
    atFile: b.file,
  });
}

function telegraph(s: DuelSession): void {
  const target = nearest(s);
  const move = pickMove(s.boss.archetype, bossPhase(s.field.boss), s.boss.difficulty, s.rand, {
    lastMove: s.boss.lastMove, streak: s.boss.streak, volleys: s.boss.volleys, quirk: s.boss.quirk,
  });
  s.boss.streak = move.id === s.boss.lastMove ? s.boss.streak + 1 : 1;
  s.boss.lastMove = move.id;
  s.boss.volleys += 1;
  const panels = movePanels(move, {
    cols: s.field.cols,
    bossFile: s.field.boss.file,
    youFile: target?.file ?? s.field.boss.file,
  });
  raiseHazard(s, move, panels, move.tell);
}

/**
 * A Mirror throws your own last program back at you, which is a move of its own: the files you
 * fired down are the files it marks, so the escape is to dodge the way you aimed, and the fight
 * teaches you what you just did.
 */
function mirrorSting(s: DuelSession): void {
  const files = s.lastProgram?.files ?? [];
  if (!files.length || s.field.hazards.length || s.over) return;
  const panels = mirroredPanels(files, s.field.cols);
  if (!panels.length) return;
  raiseHazard(
    s,
    { id: 'mirror', name: 'MIRROR', spread: 'you', reach: 'both', tell: 0.8, from: 1, depth: 1, read: '' },
    panels,
    0.8,
  );
}

/** True when the Link ward is satisfied: two bodies on neighbouring files. */
function wardOpen(s: DuelSession): boolean {
  if (!s.warded) return true;
  const up = s.players.filter((p) => !p.down);
  return up.some((a) => up.some((b) => b.id !== a.id && Math.abs(b.file - a.file) === 1));
}

function resolveStrike(s: DuelSession, h: Hazard): void {
  emit(s, { type: 'strike', panels: h.panels, files: h.files, move: h.move, label: h.label });
  const open = wardOpen(s);
  for (const p of s.players) {
    if (p.down || p.id === h.owner) continue;
    const marked = h.panels.some((n) => n.file === p.file && n.lane === p.lane);
    if (marked && p.barrier > 0) {
      p.barrier -= 1;
      emit(s, { type: 'ward', owner: p.id, left: p.barrier });
      continue;
    }
    if (!marked) {
      if (h.on.includes(p.id)) {
        p.rank.dodges += 1;
        p.charge = Math.min(p.chargeMs, p.charge + DODGE_CHARGE_MS);
        emit(s, { type: 'dodge', owner: p.id, file: p.file });
      }
      continue;
    }
    // The Hand is a safe room. That is why it has a time limit — and why merely holding a
    // dealt hand, which every body does from the moment it joins, grants nothing.
    if (p.handOpen || p.invuln > 0 || !open) {
      if (h.on.includes(p.id)) {
        p.rank.dodges += 1;
        p.charge = Math.min(p.chargeMs, p.charge + DODGE_CHARGE_MS);
        emit(s, { type: 'dodge', owner: p.id, file: p.file });
      }
      continue;
    }
    // Armour and the Skin resist are the two things on a token that say "no" to a number the
    // map already solved. Both are spent here, where the hit lands, and nowhere else.
    const damage = Math.max(
      1,
      Math.round(
        h.damage *
          (1 - clampPct(p.stats.armour, ARMOUR_CAP)) *
          (p.resist !== null && p.resist === s.field.boss.element ? RESIST_TAKEN : 1),
      ),
    );
    p.hp = Math.max(0, p.hp - damage);
    if (h.owner && h.drain > 0) {
      const attacker = byId(s, h.owner);
      if (attacker && !attacker.down) {
        const heal = Math.max(1, Math.round(damage * h.drain));
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
        emit(s, { type: 'drain', owner: attacker.id, amount: heal });
      }
    }
    p.invuln = HITSTUN_MS;
    p.rank.abacks += 1;
    p.hold = null;
    emit(s, { type: 'took-hit', owner: p.id, damage, file: p.file });
    // Status lands with the hit — on whoever is still standing in it, never on a dodge
    // and never on a body that just went down. Boss volleys carry none of this.
    if (p.hp > 0) {
      if (h.stunMs > 0) {
        const add = Math.min(h.stunMs, STUN_CAP_MS - p.stun);
        if (add > 0) {
          p.stun += add;
          emit(s, { type: 'stun', owner: h.owner ?? p.id, ms: add, target: p.id });
        }
      }
      if (h.freezeMs > 0) {
        p.freeze = Math.max(p.freeze, h.freezeMs);
        emit(s, { type: 'freeze', owner: h.owner ?? p.id, ms: h.freezeMs, target: p.id });
      }
      if (h.burn) {
        p.burn = { ticks: h.burn.ticks, damage: h.burn.damage, acc: 0 };
        emit(s, { type: 'burn', owner: h.owner ?? p.id, ticks: h.burn.ticks, damage: h.burn.damage, target: p.id });
      }
      if (h.barrier && h.owner) {
        const attacker = byId(s, h.owner);
        if (attacker && !attacker.down && attacker.barrier < BARRIER_CAP) {
          attacker.barrier += 1;
          emit(s, { type: 'barrier', owner: attacker.id, charges: attacker.barrier });
        }
      }
    }
    if (p.hp <= 0) down(s, p);
  }
  s.field.hazards = s.field.hazards.filter((x) => x !== h);
  if (!s.pvp) s.boss.next = Math.max(MIN_QUIET_MS, Math.round(clockOf(s).gap * (quirkOf(s.boss.quirk).clock?.gapK ?? 1)));
  if (!s.pvp) drift(s);
}

/**
 * The anomaly steps after every attack, one file toward whoever is closest.
 *
 * A boss that sat still would be solved once — you would learn the file and never move again.
 * One step per volley is slow enough to read and fast enough to matter: aiming stays a live
 * decision for the whole fight rather than a fact you established in the first five seconds.
 */
function drift(s: DuelSession): void {
  // A mite never stands where it stood: a random file, every volley. A tollkeeper is a
  // gate and holds its file. Everything else steps toward whoever is closest.
  if (s.boss.archetype === 'tollkeeper') return;
  if (s.boss.archetype === 'mite') {
    s.field.boss.file = Math.floor(s.rand() * s.field.cols);
    return;
  }
  const target = nearest(s);
  if (!target) return;
  const cur = s.field.boss.file;
  if (cur === target.file) return;
  const dir = target.file > cur ? 1 : -1;
  s.field.boss.file = clampFile(cur + dir, s.field.cols);
}

function down(s: DuelSession, p: DuelBody): void {
  p.down = true;
  p.downLeft = s.pvp ? PVP_DOWN_MS : DOWN_GRACE_MS;
  p.hand = null;
  p.handOpen = false;
  p.program = null;
  p.hold = null;
  // Going down ends every ailment too: the stand-up is a clean slate, not a burning one.
  p.stun = 0;
  p.freeze = 0;
  p.burn = null;
  // Going down costs the run its element chain: you do not get to keep a run you did not finish.
  p.chain = 0;
  p.lastElement = null;
  emit(s, { type: 'down', owner: p.id, left: p.downLeft });
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

/**
 * Advance the field.
 *
 * `dt` is milliseconds of real server time. Everything here is a countdown, and the order
 * matters: shots land before the anomaly strikes, and the strike sets the next wind-up, so a
 * fight cannot stack two warnings inside one tick.
 */
export function tick(s: DuelSession, dt: number): void {
  if (s.over) return;
  const ms = Math.max(0, Math.min(500, dt));
  s.elapsed += ms;

  // Shots in the air.
  const still: Shot[] = [];
  for (const shot of s.field.shots) {
    shot.t += ms;
    if (shot.t >= shot.travel) landShot(s, shot);
    else still.push(shot);
  }
  s.field.shots = still;

  // Most anomalies hunt rather than holding one file: they walk toward the nearest body to line
  // up its next attack, and flinches off a file that is being fired at. That is the "dodge or
  // strike" the fight needs — a boss that never moves is a boss you solve once.
  // Mites skitter instead — a random step, never the hunt — and the tollkeeper holds its
  // file: a gate does not chase, and it does not flinch either.
  if (!s.over) {
    if (!s.pvp) s.bossClock += ms;
    if (s.bossClock >= 700) {
      s.bossClock = 0;
      const target = nearest(s);
      if (target) {
        const incoming = s.field.shots.some((shot) => shot.files.includes(s.field.boss.file));
        const away = target.file >= s.field.boss.file ? -1 : 1;
        const chase = Math.sign(target.file - s.field.boss.file);
        let step = incoming && s.rand() < 0.5 ? away : chase;
        if (s.boss.archetype === 'tollkeeper') step = 0;
        if (s.boss.archetype === 'mite') {
          step = s.rand() < 0.5 ? -1 : 1;
          if (s.field.boss.file === 0 && step < 0) step = 1;
          if (s.field.boss.file === s.field.cols - 1 && step > 0) step = -1;
        }
        if (step !== 0) s.field.boss.file = clampFile(s.field.boss.file + step, s.field.cols);
      }
    }
  }

  // A BURN drips on the boss's own clock, wind-up or no wind-up.
  const burn = s.boss.burn;
  if (burn && burn.ticks > 0 && !s.over) {
    burn.acc += ms;
    while (burn.acc >= BURN_EVERY_MS && burn.ticks > 0 && !s.over) {
      burn.acc -= BURN_EVERY_MS;
      burn.ticks -= 1;
      hurtBoss(s, burn.damage);
      emit(s, { type: 'burn-tick', damage: burn.damage, left: burn.ticks });
    }
    if (burn.ticks <= 0) s.boss.burn = null;
  }
  // The anomaly's clock. A STUN freezes both the wind-up and the swing itself;
  // a FREEZE runs them both slow instead.
  if (s.boss.freeze > 0) s.boss.freeze = Math.max(0, s.boss.freeze - ms);
  const pace = s.boss.freeze > 0 ? FREEZE_SLOW : 1;
  if (s.boss.stun > 0) s.boss.stun = Math.max(0, s.boss.stun - ms);
  if (s.field.hazards.length) {
    if (s.boss.stun <= 0) {
      for (const h of [...s.field.hazards]) {
        h.left -= ms * pace;
        if (h.left <= 0 && !s.over) resolveStrike(s, h);
      }
    }
  } else if (!s.pvp && s.boss.stun <= 0 && !s.over) {
    s.boss.next -= ms * pace;
    if (s.boss.next <= 0) telegraph(s);
  }

  if (s.over) return;

  for (const p of s.players) {
    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - ms);
    // Status clocks run on server time like everything else. Burn can finish a body.
    if (p.stun > 0) p.stun = Math.max(0, p.stun - ms);
    if (p.freeze > 0) p.freeze = Math.max(0, p.freeze - ms);
    const bodyBurn = p.burn;
    if (bodyBurn && !p.down) {
      bodyBurn.acc += ms;
      while (bodyBurn.acc >= BURN_EVERY_MS && bodyBurn.ticks > 0 && !s.over) {
        bodyBurn.acc -= BURN_EVERY_MS;
        bodyBurn.ticks -= 1;
        p.hp = Math.max(0, p.hp - bodyBurn.damage);
        emit(s, { type: 'burn-tick', damage: bodyBurn.damage, left: bodyBurn.ticks, target: p.id });
        if (p.hp <= 0) down(s, p);
      }
      if (bodyBurn.ticks <= 0) p.burn = null;
    }

    if (p.down) {
      p.downLeft -= ms;
      if (p.downLeft <= 0) {
        emit(s, { type: 'lost', owner: p.id });
        s.players = s.players.filter((x) => x.id !== p.id);
        if (s.pvp && !s.over) {
          // One KO decides it: the body still up takes the fight, and two bodies down
          // together is a draw — the pot goes home with whoever brought it.
          const rival = s.players.find((x) => !x.down) ?? null;
          if (rival) {
            s.winnerId = rival.id;
            s.over = true;
            s.result = 'win';
          } else {
            s.winnerId = null;
            s.over = true;
            s.result = 'loss';
          }
        }
        if (!s.pvp && !s.players.length) {
          s.over = true;
          s.result = 'loss';
        }
      }
      continue;
    }


    // A program goes out one card at a time, and you cannot move while it does.
    if (p.program) {
      p.program.timer -= ms;
      if (p.program.timer <= 0) {
        const c = p.program.cards[p.program.at];
        if (c) fireCard(s, p, c);
        p.program.at += 1;
        p.program.timer = PROGRAM_STAGGER_MS;
        if (p.program.at >= p.program.cards.length) {
          p.program = null;
          // A Mirror answers the program, not the card.
          if (ARCHETYPES[s.boss.archetype]?.mirrors) mirrorSting(s);
        }
      }
      continue;
    }

    if (p.handOpen) {
      p.handMs += ms;
      // The screen is a safe room, so it is a room you can be pushed out of. Otherwise the
      // answer to every hard fight is to stand in the menu.
      if (p.handMs >= HAND_HOLD_MS) execute(s, p.id);
      continue;
    }

    // The charge fills while you fight — but not while a strike is in the air. The telegraph window
    // is for reading the board and stepping off it; a Hand that opened itself in the middle of one
    // would turn every wind-up into a free miss, which is the whole reason the safe room has a
    // time limit instead of a trigger. Holding cover for a downed partner costs the same time:
    // the rescuer has stopped shooting, and the charge is what says so.
    if (!s.field.hazards.some((h) => h.owner !== p.id) && !p.hold && p.stun <= 0) {
      // Freeze does not stop the charge, it just makes it crawl.
      p.charge += ms * (p.freeze > 0 ? FREEZE_SLOW : 1);
      if (p.charge >= p.chargeMs) openHand(s, p);
    }
  }

  // A cover hold only survives while the rescuer is standing next to the body and not firing.
  for (const p of s.players) {
    if (!p.hold) continue;
    const t = byId(s, p.hold.target);
    const ok = t
      ? canRevive({
          partySize: s.players.length,
          downed: { file: t.file, alive: !t.down },
          rescuer: { file: p.file, alive: !p.down },
        }).ok
      : false;
    if (!ok || p.program || p.handOpen) {
      p.hold = null;
      continue;
    }
    p.hold.ms += ms;
    if (p.hold.ms >= REVIVE_HOLD_MS && t) {
      t.hp = revivedHp(t.maxHp);
      t.down = false;
      t.downLeft = 0;
      t.invuln = HITSTUN_MS;
      emit(s, { type: 'revived', owner: t.id, by: p.id });
      p.hold = null;
    }
  }

  const cutoff = s.elapsed - 4000;
  if (s.recent.length > 64) s.recent = s.recent.filter((v) => v.at >= cutoff);
}

/** Deal the six. Cards paid by counters go in face-up and first: the reward for reading a wind-up is
 * that the card you were paid is one you get to see while you plan. */
function dealHand(s: DuelSession, p: DuelBody): void {
  p.hand = {
    ...emptyHand(p.transformed),
    cells: drawHand(p.deck, p.handRand, { bonus: p.bonus, basic: p.basic }),
    gigaSpent: p.gigaSpent,
  };
  p.bonus = [];
}

/** A small deterministic dice of a body's own, so dealing never spends the boss's stream. */
function handDice(s: DuelSession, id: string): () => number {
  let h = 2166136261 ^ s.players.length;
  for (const ch of `${s.id}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Step into the Hand. The hand is already on the table; this is what turns it into a safe
 * room and starts the clock that pushes you back out of it.
 */
export function openHand(s: DuelSession, p: DuelBody): void {
  if (p.handOpen || p.down || p.program || p.stun > 0) return;
  if (!p.hand) dealHand(s, p);
  p.handOpen = true;
  p.handMs = 0;
  emit(s, { type: 'hand', owner: p.id, open: true });
}

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

export interface BodyOutcome {
  id: string;
  owner: string;
  name: string;
  rank: RankStats;
  /** The grade, 1..15, and the letter on the plate. */
  level: number;
  letter: Rank;
  /** What the grade pays: how many rolls, and the chance each is the rare table. */
  drop: { rolls: number; rareChance: number };
  /** Wave bled off the district. Negative when this body ran void cards. */
  wave: number;
  survived: boolean;
}

export interface DuelOutcome {
  result: 'win' | 'loss' | null;
  seconds: number;
  bodies: BodyOutcome[];
  /** Milliseconds before this fight lets the same body back on, after a loss. */
  /** PvP: the body still standing, or null for a draw — and always null outside PvP. */
  winnerId: string | null;
  lockoutMs: number;
}

/**
 * How the fight is graded.
 *
 * Star Force grades the *fight*, not the kill: how fast you deleted it, whether you were hit,
 * whether you read the wind-ups and struck into them, how deep your element chain ran. The
 * grade then decides what it drops — which is the mechanic an MMO needs most and usually does
 * not have, because it makes a boss you have killed fifty times still worth killing fifty-one.
 */
export function outcome(s: DuelSession): DuelOutcome {
  const seconds = s.elapsed / 1000;
  return {
    result: s.result,
    winnerId: s.pvp ? s.winnerId : null,
    seconds,
    lockoutMs: !s.pvp && s.result === 'loss' ? DEFEAT_LOCKOUT_MS : 0,
    bodies: s.players.map((p) => {
      const level = rankLevel(p.rank, seconds);
      return {
        id: p.id,
        owner: p.owner,
        name: p.name,
        rank: { ...p.rank },
        level,
        letter: rankOf(level),
        drop: dropFor(level),
        wave: Math.round(p.waveDrained),
        survived: !p.down,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// What the client is told
// ---------------------------------------------------------------------------

function bossView(s: DuelSession): BossView {
  const b = s.field.boss;
  return {
    name: s.boss.name,
    archetype: s.boss.archetype,
    element: b.element,
    hp: b.hp,
    maxHp: b.maxHp,
    file: b.file,
    lane: b.lane,
    phase: bossPhase(b),
    guard: guardOf(s),
    burn: s.boss.burn ? { ticks: s.boss.burn.ticks, damage: s.boss.burn.damage } : null,
    freezeMs: Math.max(0, Math.round(s.boss.freeze)),
    stunMs: Math.max(0, Math.round(s.boss.stun)),
    blocked: s.field.blocked,
    lanes: s.field.lanes,
    cols: s.field.cols,
    node: s.boss.node,
    training: s.boss.training,
    tier: s.boss.tier,
  };
}

/**
 * The rival, wearing the boss plate.
 *
 * The client draws one plate for "the thing across the field" whether it is an anomaly or
 * another Chog, so in PvP the boss view is the rival body: its name, health and file, with
 * the lane mirrored into the viewer's half. No phases, no guard, no burn — a Chog is none
 * of those things, and the plate says RIVAL so nobody reads it as one.
 */
function rivalView(s: DuelSession, rival: DuelBody | null, mirror: (lane: number) => number): BossView {
  if (!rival) return { ...bossView(s), name: 'RIVAL', archetype: 'rival', hp: 0 };
  return {
    name: rival.name,
    archetype: 'rival',
    element: rival.tribe,
    hp: rival.hp,
    maxHp: rival.maxHp,
    file: rival.file,
    lane: mirror(rival.lane),
    phase: phaseOf(rival.hp, rival.maxHp),
    guard: 0,
    burn: rival.burn ? { ticks: rival.burn.ticks, damage: rival.burn.damage } : null,
    freezeMs: Math.max(0, Math.round(rival.freeze)),
    stunMs: Math.max(0, Math.round(rival.stun)),
    blocked: null,
    lanes: s.field.lanes,
    cols: s.field.cols,
    node: false,
    training: false,
    tier: 'pvp',
  };
}

function playerView(s: DuelSession, p: DuelBody): PlayerView {
  return {
    id: p.id,
    tokenId: p.tokenId,
    name: p.name,
    tribe: p.tribe,
    hp: p.hp,
    maxHp: p.maxHp,
    file: p.file,
    lane: p.lane,
    chain: p.chain,
    lastElement: p.lastElement,
    shielded: p.handOpen,
    down: p.down,
    downLeft: Math.max(0, Math.round(p.downLeft)),
    reviving: p.hold ? { target: p.hold.target, fraction: p.hold.ms / REVIVE_HOLD_MS } : null,
    frozen: isFrozen(p),
    stunMs: Math.max(0, Math.round(p.stun)),
    chillMs: Math.max(0, Math.round(p.freeze)),
    burn: p.burn ? { ticks: p.burn.ticks, damage: p.burn.damage } : null,
    barrier: p.barrier,
    side: p.side,
  };
}

function hazardView(h: Hazard | null): HazardView | null {
  if (!h) return null;
  return {
    panels: h.panels,
    files: h.files,
    left: Math.max(0, Math.round(h.left)),
    total: h.total,
    move: h.move,
    label: h.label,
    damage: h.damage,
  };
}

function youView(s: DuelSession, p: DuelBody): YouView {
  const pv = playerView(s, p);
  const hand = p.hand;
  const pre = hand ? preview(hand, capsOf(p)) : null;
  const reviveTarget = p.hold ? byId(s, p.hold.target) : null;
  const level = rankLevel(p.rank, s.elapsed / 1000);
  return {
    ...pv,
    stats: p.stats,
    hand: hand
      ? {
          cells: customView(hand, capsOf(p)),
          /** Dealt is not open: the hand is on the table from the join, the safe room is not. */
          open: p.handOpen,
          lock: pre?.lock ?? null,
          left: pre?.left ?? 0,
          top: pre?.top ?? 'standard',
          might: pre?.might ?? 0,
          gigaSpent: hand.gigaSpent,
        }
      : null,
    readyIn: Math.max(0, Math.round(p.chargeMs - p.charge)),
    chargeMs: p.chargeMs,
    dodge: { iframeMs: Math.max(0, Math.round(p.invuln)), graceMs: DODGE_IFRAME_MS },
    revive: p.hold
      ? {
          target: p.hold.target,
          name: reviveTarget?.name ?? '',
          fraction: p.hold.ms / REVIVE_HOLD_MS,
          ms: Math.round(p.hold.ms),
        }
      : null,
    link: p.link,
    bonus: p.bonus.length,
    rank: {
      level,
      letter: rankOf(level),
      counters: p.rank.counters,
      abacks: p.rank.abacks,
    },
    drop: dropFor(level),
  };
}

/**
 * The snapshot the client draws from.
 *
 * It is told everything and asserts nothing: no number on this page is one the client is
 * invited to recompute, and no number the client sent was used to make it.
 */
export function viewOf(s: DuelSession, youId?: string): DuelView {
  const you = youId ? byId(s, youId) : null;
  // Both screens read self-near, rival-far: side 1 sees every lane mirrored.
  const mirror = you && s.pvp && you.side === 1 ? (lane: number): number => s.field.lanes - 1 - lane : (lane: number): number => lane;
  const rival = s.pvp && you ? (s.players.find((p) => p.id !== you.id) ?? null) : null;
  const owners = new Set(s.players.map((p) => p.owner));
  // Each screen shows its own incoming warning; the floor may hold two.
  const incoming = hazardView(s.field.hazards.find((h) => h.owner !== you?.id) ?? null);
  const hazard = incoming ? { ...incoming, panels: incoming.panels.map((p) => ({ file: p.file, lane: mirror(p.lane) })) } : null;
  return {
    session: s.id,
    pvp: s.pvp,
    place: s.place,
    boss: s.pvp ? rivalView(s, rival, mirror) : bossView(s),
    players: s.players.map((p) => { const v = playerView(s, p); return { ...v, lane: mirror(v.lane) }; }),
    you: you ? { ...youView(s, you), lane: mirror(you.lane) } : null,
    hazard,
    elapsed: Math.round(s.elapsed / 100) / 10,
    party: { bodies: s.players.length, owners: owners.size, bands: Math.max(0, s.players.length - 1) },
    warded: s.warded,
  };
}

/** A card id the catalogue knows, for callers that want to validate a program themselves. */
export const cardOf = (id: string): BattleCard | null => battleCard(id);
