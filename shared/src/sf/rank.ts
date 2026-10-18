/**
 * The RankStats Level.
 *
 * Star Force grades the fight, not the kill: how fast you deleted it, whether you were hit,
 * whether you read the wind-ups and struck into them, how deep your element chain ran. The grade
 * then decides what it drops, which is the single cleanest loop in the series — you are not paid
 * for winning, you are paid for winning *well*, and the same boss is worth farming forever
 * because a clean run and a scrappy run are different loot.
 *
 * That is the mechanic an MMO needs most and usually does not have: it makes a boss you have
 * killed fifty times still worth killing fifty-one times.
 */

export interface RankStats {
  /** Hits landed inside the anomaly's wind-up. The skill the whole grade hangs on. */
  counters: number;
  /** Times the anomaly actually connected. Star Force calls each one an "aback". */
  abacks: number;
  /** Volleys stepped out of. */
  dodges: number;
  /** The deepest element chain run in one program. */
  maxChain: number;
  /** Bonus cards earned off counters — they are paid in cards, and this is the count. */
  bonus: number;
  /** Files stepped across. Star Force pays you +1 for fighting in two files or fewer. */
  steps: number;
}

export const emptyRank = (): RankStats => ({ counters: 0, abacks: 0, dodges: 0, maxChain: 0, bonus: 0, steps: 0 });

/** Delete times, fastest first, and what each band is worth. */
const TIME_BANDS: readonly { under: number; points: number }[] = [
  { under: 20, points: 4 },
  { under: 40, points: 3 },
  { under: 70, points: 2 },
  { under: 110, points: 1 },
  { under: 180, points: 0 },
];

export const RANK_MAX = 15;

/**
 * The grade, 1..15.
 *
 * Counters are the spine: each one is a point, because a counter is the fight's whole skill
 * expression — you saw the wind-up, you committed a card into it, and you were not hit. A clean
 * fast run with four counters is a 12, which is S. A slow run where you ate six volleys is a 2,
 * which is a D and a worse drop.
 */
export function rankLevel(b: RankStats, seconds: number): number {
  let n = 1;
  // The counter is the whole point of the grade.
  n += Math.min(5, b.counters);
  // Speed: a delete under twenty seconds is worth more than anything else on this list.
  const band = TIME_BANDS.find((t) => seconds < t.under);
  n += band ? band.points : -1;
  // Being hit is the tax. Three abacks costs you a whole counter.
  n -= Math.floor(b.abacks / 3);
  // Standing still is its own skill: a fight you read without moving has been read.
  if (b.steps <= 2) n += 1;
  // A chain four deep is a deck built on purpose.
  if (b.maxChain >= 4) n += 1;
  return Math.max(1, Math.min(RANK_MAX, n));
}

export type Rank = 'D' | 'C' | 'B' | 'A' | 'S' | 'SS';

/** The letter on the results plate. S is where the good table starts. */
export function rankOf(level: number): Rank {
  if (level >= 13) return 'SS';
  if (level >= 10) return 'S';
  if (level >= 8) return 'A';
  if (level >= 6) return 'B';
  if (level >= 4) return 'C';
  return 'D';
}

/**
 * What the grade does to the drop: how many rolls the tile pays, and the chance each one is the
 * rare table rather than the common one. An S run is not "more loot", it is *better loot*, which
 * is the difference between a grind and a farm.
 */
export function dropFor(level: number): { rolls: number; rareChance: number } {
  const r = rankOf(level);
  const table: Record<Rank, { rolls: number; rareChance: number }> = {
    D: { rolls: 1, rareChance: 0.02 },
    C: { rolls: 1, rareChance: 0.06 },
    B: { rolls: 2, rareChance: 0.12 },
    A: { rolls: 2, rareChance: 0.22 },
    S: { rolls: 3, rareChance: 0.38 },
    SS: { rolls: 4, rareChance: 0.55 },
  };
  return table[r];
}

/** One line under the letter: what the run did to earn it. */
export function rankRead(b: RankStats, seconds: number): string {
  const bits: string[] = [];
  if (b.counters) bits.push(`${b.counters} counter${b.counters > 1 ? 's' : ''}`);
  if (!b.abacks) bits.push('untouched');
  else if (b.abacks >= 3) bits.push(`${b.abacks} abacks`);
  if (b.maxChain >= 4) bits.push(`chain ${b.maxChain}`);
  if (seconds < 40) bits.push(`${Math.round(seconds)}s`);
  return bits.length ? bits.join(' · ') : 'deleted';
}
