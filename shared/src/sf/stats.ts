/**
 * The numbers a Chog fights with.
 *
 * The stat screen is deliberately short because the *cards* are the content. Attack
 * is the one that matters, and it matters for one reason: **it multiplies every card**.
 * So a Chog with a high Attack is not a Chog with bigger numbers, it is a
 * Chog whose deck hits harder.
 *
 * Everything here is derived on the server from the token (traits, tier, mint age, level) and
 * handed to the field when the Chog steps on. Nothing on this list is spent by the client.
 */

export interface DuelStats {
  /** Field integrity: what the anomaly's attacks are spent from. */
  hp: number;
  /** 1..10. Multiplies card damage and the charge shot. */
  attack: number;
  /** 1..10. How fast the Hand Charge fills. */
  charge: number;
  /** How many cards may be taken in one Hand. 3 at first, 6 at the top. */
  slots: number;
  /** How many files wide this Chog's floor is. Dodging room is progression. */
  cols: number;
  /** MEGA cards allowed per turn. One is the base; the Tier trait buys more. */
  megaCap: number;
  /** GIGA cards allowed per turn. The deck only ever holds one. */
  gigaCap: number;
  /**
   * Share of incoming damage absorbed, 0..ARMOUR_CAP. Granted by the Head trait's guard value,
   * which is where a Chog's hat stops being cosmetic.
   */
  armour: number;
  /** Percent chance a card lands for double, 0..CRIT_CAP. Head trait, and the Mouth trait bends it. */
  crit: number;
  /**
   * Share of a DRAIN card's damage returned as integrity. Every Chog starts with
   * `DRAIN_HEAL`; the Head and Mouth traits push it up.
   */
  drain: number;
  /** Percent off a full Hand Charge fill, from the Mouth trait. Negative is slower. */
  chargePct: number;
}

export const STAT_CAP = 10;

export const DEFAULT_STATS: DuelStats = {
  hp: 240,
  attack: 1,
  charge: 1,
  slots: 3,
  cols: 3,
  megaCap: 1,
  gigaCap: 1,
  armour: 0,
  crit: 0,
  // Matches DRAIN_HEAL in clock.ts. stats.ts cannot import it — clock.ts reads clampStat from
  // here — so the two are pinned together by a test instead.
  drain: 0.15,
  chargePct: 0,
};

/** The most armour a Chog can wear. Past this a hit stops being an event. */
export const ARMOUR_CAP = 0.6;
export const CRIT_CAP = 100;

export const clampStat = (n: number): number => Math.max(1, Math.min(STAT_CAP, Math.round(n)));
/** Percentages are not stats: they do not cap at 10 and they are allowed to be 0. */
export const clampPct = (n: number, cap: number): number => Math.max(0, Math.min(cap, n));

/**
 * What one point of Attack is worth.
 *
 * Deliberately smaller than a card's own spread: Attack multiplies every card without ever
 * letting a stat out-scale the deck. Ten points is +81%, which is
 * a lot of money for a lot of grinding and still less than one good card.
 */
export const ATTACK_STEP = 0.09;
export const attackScale = (attack: number): number => 1 + (clampStat(attack) - 1) * ATTACK_STEP;

/** Apply a token's trait step without mutating the base build. */
export const withTraits = (s: DuelStats, patch: Partial<DuelStats>): DuelStats => ({ ...s, ...patch });
