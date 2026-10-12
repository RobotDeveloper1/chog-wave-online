import { clampStat } from './stats.ts';

/**
 * The clocks.
 *
 * Everything on this page answers one question: **how long does the player get to read it?**
 * Star Force is a game about reading a wind-up and stepping out of it, so the warning is the
 * difficulty dial and nothing else on the field comes close to mattering as much.
 *
 * Three things shorten it.
 *
 *   1. **The phase.** A dying boss swings sooner. Always has; it is the only escalation that
 *      costs nothing to understand.
 *   2. **The level gap** — the enemy's level minus the mean level of the bodies standing on it.
 *      This is the axis the *player* controls, and it is why raising a Chog matters on the field
 *      rather than only on the damage chart: walking into content six levels above you is a
 *      fight you cannot read, and six below is one you walk through.
 *   3. **The depth** of the fight: a dungeon's difficulty, 1..6. This is what makes a tier-4
 *      core more than an Ember Foundry with a longer health bar.
 *
 * `MIN_TELEGRAPH_MS` is a design decision, not a tuning knob. A human reads a panel flash in
 * about a quarter of a second, so under ~300 ms the dodge stops being a decision and becomes a
 * coin flip. The game gets brutal right up to that line and never past it.
 */

/** The gauge a fresh Chog waits on before the Custom Screen opens, before stats and gear. */
export const GAUGE_MS = 7000;
/** How full the gauge already is when you step onto the field. */
export const FIRST_READY = 0.45;

/**
 * The longest the Custom Screen may hold a player out of the fight.
 *
 * The screen is a safe room — nothing lands on you while you are in it — so it has to be a room
 * you can be pushed out of, or the answer to every hard fight is to stand in the menu.
 */
export const CUSTOM_HOLD_MS = 8000;

/** After a defeat, how long before the same fight lets you back on. */
export const DEFEAT_LOCKOUT_MS = 8000;
/** Training Sim clears that still pay in a day; past it the sim is practice only. */
export const TRAIN_PAYS_PER_DAY = 3;

/** The floor. Below this the dodge is a coin flip, not a read. */
export const MIN_TELEGRAPH_MS = 300;
/** The rest between attacks never goes below this either, or nobody gets a program off. */
export const MIN_QUIET_MS = 900;

/** What a STUN card buys on the boss's own clock, and the most one turn can bank. */
export const STUN_MS = 700;
export const STUN_CAP_MS = 1500;
/** What share of a DRAIN card's damage comes back to the body that fired it. */
export const DRAIN_HEAL = 0.15;

/** How much warning an over-levelled walk-in gets back, at most. */
const TELEGRAPH_MAX_SCALE = 1.5;
/** What one level of gap costs the enemy in reading time. */
const PER_LEVEL = 0.06;
/** What one step of dungeon difficulty costs. */
const PER_DEPTH = 0.1;

/** A panel flash read in this much time is a certainty; it takes this long to be always dodgeable. */
const REACT_MS = 250;
const READABLE_MS = 1500;

export type DuelTier = 'glitch' | 'anomaly' | 'storm' | 'node' | 'train';

export interface VolleyClock {
  /** How long the panels are marked before the attack lands. */
  telegraph: number;
  /** Quiet time between an attack and the next warning. */
  gap: number;
}

/**
 * The two numbers that decide whether a fight is fair.
 *
 * `levelGap` is measured against the **mean** level of the bodies on the field, not the highest:
 * four Chogs cannot carry one level-2 walker through a window it never had.
 */
export function volleyClock(args: {
  phase: number;
  training?: boolean;
  levelGap?: number;
  difficulty?: number;
}): VolleyClock {
  const gap = Math.max(-8, Math.min(16, Math.round(args.levelGap ?? 0)));
  const depth = Math.max(1, Math.min(6, Math.round(args.difficulty ?? 1)));
  const scale = Math.min(TELEGRAPH_MAX_SCALE, 1 / (1 + PER_LEVEL * gap + PER_DEPTH * (depth - 1)));
  const p = Math.max(1, Math.min(4, Math.round(args.phase)));
  return {
    telegraph: Math.max(
      MIN_TELEGRAPH_MS,
      Math.round((1100 - (p - 1) * 120) * scale * (args.training ? 1.5 : 1)),
    ),
    gap: Math.max(MIN_QUIET_MS, Math.round((3600 - (p - 1) * 450) * scale * (args.training ? 1.35 : 1))),
  };
}

/** The warning an even match on the shallowest fight gets at this phase — the ruler. */
export const baseTelegraphMs = (phase: number, training = false): number =>
  volleyClock({ phase, training }).telegraph;

/**
 * What share of an attack a player can be expected to step out of, given only the warning.
 *
 * About the *window* and nothing else: this is the shape of the curve, and the skill bands in
 * `loop.ts` supply the player who rides on top of it.
 */
export function readRate(windowMs: number): number {
  return Math.max(0, Math.min(1, (windowMs - REACT_MS) / (READABLE_MS - REACT_MS)));
}

/**
 * How much of the field's integrity a fight takes when it is read this well, as a multiple of
 * the even-match case. 1 at gap 0 on its own depth, and it only moves when a player walks in
 * under-levelled — which is the whole point of the gap.
 */
export function dodgeExposure(windowMs: number): number {
  const ref = readRate(baseTelegraphMs(2));
  return Math.round(((1 - readRate(windowMs)) / (1 - ref)) * 100) / 100;
}

/**
 * What one attack takes from the integrity of whoever it lands on, before the map's own tuning.
 *
 * This is the *shape* of an attack — how it grows across the four phases and what the archetype
 * does on top. `power` (below) is how hard this particular enemy is tuned, and it comes from the
 * map.
 */
export function volleyDamage(phase: number, tier: DuelTier, archetype?: string): number {
  const base = 8 + Math.max(1, Math.min(4, Math.round(phase))) * 5;
  const k =
    tier === 'storm' ? 1.3 : tier === 'anomaly' ? 1.1 : tier === 'train' ? 0.4 : tier === 'node' ? 0.9 : 0.85;
  return Math.max(3, Math.round(base * k * (archetype === 'baron' ? 1.5 : 1)));
}

/** The size a session divides an enemy's declared `power` by to recover its per-phase bite. */
export const volleyAnchor = (tier: DuelTier): number => volleyDamage(2, tier);

/**
 * What the thing standing on the field actually hits with.
 *
 * A session that ignored `power` would deal the same damage to a level-2 Chog and a level-26
 * one, which is how a dungeon ends up deadly at one end of the ladder and decorative at the
 * other while the table behind it never changed.
 */
export function enemyVolleyDamage(phase: number, tier: DuelTier, power: number | undefined, archetype?: string): number {
  const flat = volleyDamage(phase, tier, archetype);
  if (!power) return flat;
  return Math.max(1, Math.round(flat * (power / volleyAnchor(tier))));
}

/** Milliseconds from an empty gauge to a Custom Screen. Gauge 10 fills in about 60% of the time. */
export function gaugeMsFor(args: { gauge?: number; training?: boolean } = {}): number {
  const g = clampStat(args.gauge ?? 1);
  const ms = GAUGE_MS * (1 - (g - 1) * 0.044);
  return Math.round(args.training ? ms * 0.7 : ms);
}

/**
 * What a loose anomaly on the street is cut for. The wave runs 0..120 and dungeons run LV 2..26,
 * so the two halves of the ladder share one ruler: a city at full storm asks as much of a Chog as
 * the deepest dungeon room, and a quiet one is where a level-2 walk-in learns to read a panel.
 */
export const waveBossLevel = (wave: number): number => 2 + Math.round((Math.max(0, Math.min(120, wave)) / 120) * 24);

/** The same wave as the 1..6 depth the volley clock wants. */
export const waveDifficulty = (wave: number): number => 1 + Math.min(5, Math.floor(Math.max(0, wave) / 25));
