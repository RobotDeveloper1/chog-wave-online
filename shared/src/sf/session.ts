import type { Element } from '../types.ts';
import {
  FIRST_PLAYER_LANE,
  HITSTUN_MS,
  LANES,
  MIN_COLS,
  SHOT_FLIGHT_MS,
  bossPhase,
  clampFile,
  coverFiles,
  makeBoss,
  makeField,
  nextShotId,
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
  FIRST_READY,
  MIN_TELEGRAPH_MS,
  STUN_CAP_MS,
  STUN_MS,
  CUSTOM_HOLD_MS,
  DEFEAT_LOCKOUT_MS,
  enemyVolleyDamage,
  gaugeMsFor,
  volleyClock,
  type DuelTier,
} from './clock.ts';
import {
  canPick,
  clear,
  drawHand,
  emptyCustom,
  pick as pickCell,
  preview,
  undo,
  view as customView,
  type Caps,
  type CustomState,
} from './custom.ts';
import {
  busterDamage,
  canFire,
  chargeMs,
  emptyBuster,
  isCharged,
  rapidCooldown,
  type BusterState,
} from './buster.ts';
import {
  aggroScore,
  canRevive,
  crossLink,
  gaugeScale,
  DOWN_GRACE_MS,
  REVIVE_HOLD_MS,
  revivedHp,
  type Volley,
} from './party.ts';
import { ARMOUR_CAP, attackScale, clampPct, type DuelStats } from './stats.ts';
import { bustingLevel, dropFor, emptyBusting, rankOf, type Busting, type Rank } from './busting.ts';
import type { BossView, DuelView, HazardView, Place, PlayerView, YouView } from './view.ts';

/**
 * The duel.
 *
 * One state machine, pure, run only on the server. It owns the field, the bodies, the clocks and
 * the tally, and it answers exactly one question every tick: **what happened?** The client says
 * what it wants (step here, take that card, fire) and is told what the field decided. Nothing
 * here reads a number the client sent about damage, and nothing here trusts a card the Custom
 * Screen would have refused.
 *
 * The shape of a fight is a loop of four beats:
 *
 *   1. **The gauge fills.** You fight with the Buster — tap, or hold for a shot worth ten taps.
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
  /** The cards this body owns, as ids. Repeats make a card likelier to be drawn. */
  folder: string[];
  /** Which Chog filled this seat — one of the 1,969. */
  tokenId: number;
  /** The Mouth trait: how hard the anomaly comes for this body. Negative is sneakier. */
  aggro: number;
  /** The Skin trait: the element this Chog shrugs off. */
  resist: Element | null;

  /** Non-null while this body has a hand dealt — which is from the moment it joins the field. */
  custom: CustomState | null;
  /**
   * The body's own dice for dealing hands. The session's stream drives the boss, and tests rig it;
   * spending it on a deal at join would shift every wind-up the boss ever makes, so the hand keeps
   * a stream of its own, seeded from who the body is.
   */
  handRand: () => number;
  /**
   * Whether the body is *inside* the Custom Screen right now. The hand is dealt at join so the
   * panel has something to show from the first frame, but the screen is a safe room and picking is
   * a committed act, so both of those wait for the gauge — this flag is the difference.
   */
  customOpen: boolean;
  /** Milliseconds the screen has been open. It is a safe room you can be pushed out of. */
  customMs: number;
  /** Milliseconds of Custom Gauge banked, and how long a full fill takes. */
  gauge: number;
  gaugeMs: number;
  /** Whether this battle's one Giga has been spent. */
  gigaSpent: boolean;
  /** Tribe On: the element lock is lifted. */
  transformed: boolean;

  buster: BusterState;
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

  busting: Busting;
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
  /** Milliseconds until the next wind-up. */
  next: number;
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
  const field = makeField(boss, cols);

  // A FRONT walls a file off for the whole fight. Never its own file — that would make it
  // unhittable by anything but a Sword, which is not a wall, it is a wall with teeth.
  if (info.walls && cols > 2) {
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
      next: Math.round(clock.gap * FIRST_READY),
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
  folder?: readonly string[];
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
  widen(s.field, a.stats.cols);
  const gaugeMs = gaugeMsFor({ gauge: a.stats.gauge, training: s.boss.training });
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
    lane: LANES - 1,
    folder: [...(a.folder ?? [])],
    tokenId: a.tokenId ?? 0,
    aggro: a.aggro ?? 0,
    resist: a.resist ?? null,
    custom: null,
    customOpen: false,
    customMs: 0,
    handRand: handDice(s, a.id),
    gauge: Math.round(gaugeMs * FIRST_READY),
    gaugeMs,
    gigaSpent: false,
    transformed: !!a.transformed,
    buster: emptyBuster(),
    program: null,
    chain: 0,
    lastElement: null,
    bonus: [],
    down: false,
    downLeft: 0,
    hold: null,
    invuln: 0,
    busting: emptyBusting(),
    waveDrained: 0,
    link: null,
  };
  s.players.push(body);
  // The hand is dealt on arrival, not when the gauge fills: the panel is a readout of what you
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
export const canAct = (b: DuelBody): boolean => !b.down && !b.customOpen && b.program === null;

/** Frozen: in the menu or firing a program. The client greys out movement on this. */
export const isFrozen = (b: DuelBody): boolean => b.customOpen || b.program !== null;

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
export function step(s: DuelSession, id: string, dir: StepDir): boolean {
  const b = byId(s, id);
  if (!b || !canAct(b)) return false;
  const wasFile = b.file;
  const wasLane = b.lane;
  if (dir === 'left') b.file = clampFile(b.file - 1, s.field.cols);
  else if (dir === 'right') b.file = clampFile(b.file + 1, s.field.cols);
  else if (dir === 'back') b.lane = Math.max(FIRST_PLAYER_LANE, b.lane - 1);
  else b.lane = Math.min(LANES - 1, b.lane + 1);
  if (b.file === wasFile && b.lane === wasLane) return false;
  // A body holding a cover hold lets go of it the moment it moves.
  b.hold = null;
  b.busting.steps += 1;
  return true;
}

export function pickCard(s: DuelSession, id: string, cell: number): boolean {
  const b = byId(s, id);
  if (!b || !b.custom || !b.customOpen) return false;
  if (!canPick(b.custom, cell, capsOf(b)).ok) return false;
  b.custom = pickCell(b.custom, cell, capsOf(b)).state;
  return true;
}

export const undoCard = (s: DuelSession, id: string): void => {
  const b = byId(s, id);
  if (b?.custom && b.customOpen) b.custom = undo(b.custom);
};

export const clearCards = (s: DuelSession, id: string): void => {
  const b = byId(s, id);
  if (b?.custom && b.customOpen) b.custom = clear(b.custom);
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
  if (!b || !b.custom || !b.customOpen) return false;
  const cards = preview(b.custom, capsOf(b)).cards;
  if (cards.some((c) => c.cls === 'giga')) b.gigaSpent = true;
  b.custom = null;
  b.customOpen = false;
  b.customMs = 0;
  b.gauge = 0;
  b.hold = null;
  // The next hand is dealt before the panel repaints, so the screen never shows an empty table:
  // what you are looking at is always what you will fire next.
  dealHand(s, b);
  b.buster.pressed = false;
  b.buster.held = 0;
  if (cards.length) {
    b.program = { cards, at: 0, timer: 0 };
    s.lastProgram = { id: b.id, files: [] };
  }
  emit(s, { type: 'custom', owner: b.id, open: false });
  return true;
}

/** Hold the Buster. It fires on release, not on press, and holding past full is free. */
export const pressBuster = (s: DuelSession, id: string): void => {
  const b = byId(s, id);
  if (!b || !canAct(b) || s.over || b.buster.pressed) return;
  if (!canFire(b.buster)) return;
  b.hold = null;
  b.buster.pressed = true;
  b.buster.held = 0;
};

/**
 * Let go. A hold past `MIN_CHARGE_MS` is a charge worth ten taps; anything shorter was a tap.
 *
 * The Buster is the neutral tool and it deliberately stands outside the element chain — it
 * neither extends a run nor breaks one — and it does not counter. If it did, the answer to
 * every wind-up would be to stop using cards.
 */
export function releaseBuster(s: DuelSession, id: string): void {
  const b = byId(s, id);
  if (!b) return;
  const pressed = b.buster.pressed;
  const held = b.buster.held;
  b.buster.pressed = false;
  b.buster.held = 0;
  if (!pressed || !canAct(b) || !canFire(b.buster) || s.over) return;
  b.hold = null;
  const charged = isCharged(held, b.stats.charge);
  const damage = busterDamage(charged, b.stats.attack);
  b.buster.cooldown = rapidCooldown(b.stats.rapid);
  // It hits the file you are standing on and nowhere else, and a wall still eats it: the Sword
  // is the card that goes through, and that is what makes the Sword a card.
  const blocked = s.field.blocked !== null && s.field.blocked === b.file;
  if (blocked || s.field.boss.file !== b.file || s.over) {
    emit(s, { type: 'buster', owner: b.id, damage: 0, charged });
    return;
  }
  emit(s, { type: 'buster', owner: b.id, damage, charged });
  hurtBoss(s, damage);
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
 * Put one card in the air.
 *
 * Everything about how hard it hits is decided **here**, at fire time, and never recomputed on
 * landing: element, chain, counter, class, guard. A number the client computed and the server
 * then contradicted is the one lie a player cannot forgive. What the flight still has to decide
 * is the only honest question left — is the anomaly standing on a file this card covers?
 */
function fireCard(s: DuelSession, b: DuelBody, c: BattleCard): void {
  // A CHAIN card is whatever element you are already running, which is the whole point of it.
  const element = c.kind === 'chain' && b.lastElement !== null ? b.lastElement : c.element;
  const run = stepChain(b.chain, b.lastElement, element);
  const weak = matchup(element, s.field.boss.element);
  const counter = s.field.hazard !== null;
  const link = crossLink({
    self: { id: b.id, element, file: b.file },
    now: s.elapsed,
    recent: s.recent,
    party: s.players.map((p) => p.id),
  });
  const guard = c.kind === 'sword' || c.kind === 'break' ? 1 : 1 - guardOf(s);

  const damage = Math.max(
    1,
    Math.round(
      c.might *
        attackScale(b.stats.attack) *
        weak *
        chainMultiplier(run) *
        (counter ? 2 : 1) *
        link.mult *
        guard,
    ),
  );

  const files = coverFiles(c.shape, b.file, s.field.cols);
  const shot: Shot = {
    id: nextShotId(),
    owner: b.id,
    chipId: c.id,
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
  b.busting.maxChain = Math.max(b.busting.maxChain, run);
  b.link = { tag: link.tag, mult: link.mult };
  b.waveDrained += c.waveDrain;
  s.wave += c.waveDrain;

  if (s.lastProgram?.id === b.id) {
    s.lastProgram.files = [...new Set([...s.lastProgram.files, ...files])];
  }

  emit(s, {
    type: 'shot-fired',
    owner: b.id,
    chipId: c.id,
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
    emit(s, { type: 'blocked', owner: shot.owner, chipId: shot.chipId, file: s.field.blocked });
    return;
  }
  if (!reaches(shot, boss, s.field.blocked)) {
    emit(s, { type: 'miss', owner: shot.owner, chipId: shot.chipId, files: shot.files });
    return;
  }

  // A crit is rolled here, on the landing, because it is the one number on the field a player
  // is allowed to be lucky about — and it has to be the server that decides they were.
  const crit = !!b && b.stats.crit > 0 && s.rand() * 100 < b.stats.crit;
  const damage = crit ? Math.round(shot.damage * CRIT_MULTIPLIER) : shot.damage;

  emit(s, {
    type: 'hit',
    owner: shot.owner,
    chipId: shot.chipId,
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
    b.busting.counters += 1;
    if (b.folder.length) {
      b.bonus.push(b.folder[Math.floor(s.rand() * b.folder.length) % b.folder.length]!);
      b.busting.bonus += 1;
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

function raiseHazard(s: DuelSession, move: BossMove, panels: ReturnType<typeof movePanels>, tell: number): void {
  const files = [...new Set(panels.map((p) => p.file))];
  const ms = Math.max(MIN_TELEGRAPH_MS, Math.round(clockOf(s).telegraph * tell));
  const damage = enemyVolleyDamage(
    bossPhase(s.field.boss),
    s.boss.tier,
    s.boss.power,
    s.boss.archetype,
  );
  const on = s.players
    .filter((p) => !p.down && !p.customOpen && panels.some((n) => n.file === p.file && n.lane === p.lane))
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
  };
  s.field.hazard = hazard;
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

function telegraph(s: DuelSession): void {
  const target = nearest(s);
  const move = pickMove(s.boss.archetype, bossPhase(s.field.boss), s.boss.difficulty, s.rand);
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
  if (!files.length || s.field.hazard || s.over) return;
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
    if (p.down) continue;
    const marked = h.panels.some((n) => n.file === p.file && n.lane === p.lane);
    if (!marked) {
      if (h.on.includes(p.id)) {
        p.busting.dodges += 1;
        emit(s, { type: 'dodge', owner: p.id, file: p.file });
      }
      continue;
    }
    // The Custom Screen is a safe room. That is why it has a time limit — and why merely holding a
    // dealt hand, which every body does from the moment it joins, grants nothing.
    if (p.customOpen || p.invuln > 0 || !open) {
      if (h.on.includes(p.id)) {
        p.busting.dodges += 1;
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
    p.invuln = HITSTUN_MS;
    p.busting.abacks += 1;
    p.hold = null;
    emit(s, { type: 'took-hit', owner: p.id, damage, file: p.file });
    if (p.hp <= 0) down(s, p);
  }
  s.field.hazard = null;
  s.boss.next = clockOf(s).gap;
  drift(s);
}

/**
 * The anomaly steps after every attack, one file toward whoever is closest.
 *
 * A boss that sat still would be solved once — you would learn the file and never move again.
 * One step per volley is slow enough to read and fast enough to matter: aiming stays a live
 * decision for the whole fight rather than a fact you established in the first five seconds.
 */
function drift(s: DuelSession): void {
  const target = nearest(s);
  if (!target) return;
  const cur = s.field.boss.file;
  if (cur === target.file) return;
  const dir = target.file > cur ? 1 : -1;
  s.field.boss.file = clampFile(cur + dir, s.field.cols);
}

function down(s: DuelSession, p: DuelBody): void {
  p.down = true;
  p.downLeft = DOWN_GRACE_MS;
  p.custom = null;
  p.customOpen = false;
  p.program = null;
  p.hold = null;
  p.buster.pressed = false;
  p.buster.held = 0;
  // Going down costs the run its element chain: you do not get to keep a run you did not finish.
  p.chain = 0;
  p.lastElement = null;
  emit(s, { type: 'down', owner: p.id, left: DOWN_GRACE_MS });
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

  // The anomaly hunts rather than holding one file: it walks toward the nearest body to line
  // up its next attack, and flinches off a file that is being fired at. That is the "dodge or
  // strike" the fight needs — a boss that never moves is a boss you solve once.
  if (!s.over) {
    s.bossClock += ms;
    if (s.bossClock >= 700) {
      s.bossClock = 0;
      const target = nearest(s);
      if (target) {
        const incoming = s.field.shots.some((shot) => shot.files.includes(s.field.boss.file));
        const away = target.file >= s.field.boss.file ? -1 : 1;
        const chase = Math.sign(target.file - s.field.boss.file);
        const step = incoming && s.rand() < 0.5 ? away : chase;
        if (step !== 0) s.field.boss.file = clampFile(s.field.boss.file + step, s.field.cols);
      }
    }
  }

  // The anomaly's clock. A STUN freezes both the wind-up and the swing itself.
  if (s.boss.stun > 0) s.boss.stun = Math.max(0, s.boss.stun - ms);
  if (s.field.hazard) {
    if (s.boss.stun <= 0) {
      s.field.hazard.left -= ms;
      if (s.field.hazard.left <= 0) resolveStrike(s, s.field.hazard);
    }
  } else if (s.boss.stun <= 0 && !s.over) {
    s.boss.next -= ms;
    if (s.boss.next <= 0) telegraph(s);
  }

  if (s.over) return;

  for (const p of s.players) {
    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - ms);

    if (p.down) {
      p.downLeft -= ms;
      if (p.downLeft <= 0) {
        emit(s, { type: 'lost', owner: p.id });
        s.players = s.players.filter((x) => x.id !== p.id);
        if (!s.players.length) {
          s.over = true;
          s.result = 'loss';
        }
      }
      continue;
    }

    if (p.buster.cooldown > 0) p.buster.cooldown = Math.max(0, p.buster.cooldown - ms);
    if (p.buster.pressed) p.buster.held += ms;

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

    if (p.customOpen) {
      p.customMs += ms;
      // The screen is a safe room, so it is a room you can be pushed out of. Otherwise the
      // answer to every hard fight is to stand in the menu.
      if (p.customMs >= CUSTOM_HOLD_MS) execute(s, p.id);
      continue;
    }

    // The gauge fills while you fight, which is what the Buster is for.
    p.gauge += ms;
    if (p.gauge >= p.gaugeMs) openCustom(s, p);
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
    if (!ok || p.program || p.customOpen) {
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
  p.custom = {
    ...emptyCustom(p.transformed),
    hand: drawHand(p.folder, p.handRand, { bonus: p.bonus }),
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
 * Step into the Custom Screen. The hand is already on the table; this is what turns it into a safe
 * room and starts the clock that pushes you back out of it.
 */
export function openCustom(s: DuelSession, p: DuelBody): void {
  if (p.customOpen || p.down || p.program) return;
  if (!p.custom) dealHand(s, p);
  p.customOpen = true;
  p.customMs = 0;
  p.buster.held = 0;
  p.buster.pressed = false;
  emit(s, { type: 'custom', owner: p.id, open: true });
}

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

export interface BodyOutcome {
  id: string;
  owner: string;
  name: string;
  busting: Busting;
  /** The grade, 1..15, and the letter on the plate. */
  level: number;
  rank: Rank;
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
    seconds,
    lockoutMs: s.result === 'loss' ? DEFEAT_LOCKOUT_MS : 0,
    bodies: s.players.map((p) => {
      const level = bustingLevel(p.busting, seconds);
      return {
        id: p.id,
        owner: p.owner,
        name: p.name,
        busting: { ...p.busting },
        level,
        rank: rankOf(level),
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
    blocked: s.field.blocked,
    cols: s.field.cols,
    node: s.boss.node,
    training: s.boss.training,
    tier: s.boss.tier,
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
    shielded: p.customOpen,
    down: p.down,
    downLeft: Math.max(0, Math.round(p.downLeft)),
    reviving: p.hold ? { target: p.hold.target, fraction: p.hold.ms / REVIVE_HOLD_MS } : null,
    frozen: isFrozen(p),
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
  const custom = p.custom;
  const pre = custom ? preview(custom, capsOf(p)) : null;
  const reviveTarget = p.hold ? byId(s, p.hold.target) : null;
  const level = bustingLevel(p.busting, s.elapsed / 1000);
  return {
    ...pv,
    stats: p.stats,
    custom: custom
      ? {
          cells: customView(custom, capsOf(p)),
          /** Dealt is not open: the hand is on the table from the join, the safe room is not. */
          open: p.customOpen,
          lock: pre?.lock ?? null,
          left: pre?.left ?? 0,
          top: pre?.top ?? 'standard',
          might: pre?.might ?? 0,
          gigaSpent: custom.gigaSpent,
        }
      : null,
    readyIn: Math.max(0, Math.round(p.gaugeMs - p.gauge)),
    gaugeMs: p.gaugeMs,
    buster: {
      held: Math.round(p.buster.held),
      ready: canFire(p.buster),
      chargeMs: chargeMs(p.stats.charge),
    },
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
    busting: {
      level,
      rank: rankOf(level),
      counters: p.busting.counters,
      abacks: p.busting.abacks,
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
  const owners = new Set(s.players.map((p) => p.owner));
  return {
    session: s.id,
    place: s.place,
    boss: bossView(s),
    players: s.players.map((p) => playerView(s, p)),
    you: you ? youView(s, you) : null,
    hazard: hazardView(s.field.hazard),
    elapsed: Math.round(s.elapsed / 100) / 10,
    party: { bodies: s.players.length, owners: owners.size, bands: Math.max(0, s.players.length - 1) },
    warded: s.warded,
  };
}

/** A card id the catalogue knows, for callers that want to validate a program themselves. */
export const cardOf = (id: string): BattleCard | null => battleCard(id);
