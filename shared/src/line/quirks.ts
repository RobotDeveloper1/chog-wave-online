/**
 * One twist per Tolls encounter.
 *
 * The first map fields three kits — mite, walker, tollkeeper — and seven fights. The kits
 * carry the identity (the vocabulary, the movement, the shape of the fight) and the quirks
 * carry the surprise: one small, legible deviation each, so no two walks up the farm track
 * play the same even when the animal does.
 *
 * A quirk is data, not code. The session reads it in four places — the clock (`clockOf`),
 * the pick (`pickMove`, via the quirk id), the step (`drift`, via the archetype), and the
 * budget (`encounterBudget`, for `hpK`) — and everywhere else the fight is the kit. Numbers
 * stay multipliers so the budget's promise survives: the reward is still the difficulty,
 * seasoned.
 *
 * Tolls-only on purpose. Later regions earn their own tables when their kits land; a quirk
 * id that is not on this table resolves to `{}` and the fight plays straight.
 */

export interface QuirkClock {
  /** Multiplier on the quiet between attacks. Below 1 is relentless. */
  gapK: number;
  /** Multiplier on the warning itself. Below 1 reads shorter. */
  tellK: number;
}

export interface Quirk {
  clock?: QuirkClock;
  /** Multiplier on the bite, against the fight's own anchor. */
  powerK?: number;
  /** Multiplier on the budget's HP. */
  hpK?: number;
  /** Walls one file for the whole fight, the way a FRONT does. */
  walls?: boolean;
  /** After STOP LOSS, runs FRONTRUN down where you fled. */
  bloodscent?: boolean;
  /** Past half health, every other volley is aimed at you. */
  cornered?: boolean;
  /** Every fourth volley is the TOLL, on the count. */
  toll?: boolean;
}

const QUIRKS: Record<string, Quirk> = {
  // Soot imps, cornered past half: every other volley comes at you personally.



  'tolls.1': { powerK: 1.2, cornered: true },
  // The first thing on the Line that hunts: cut, then run where you fled.
  'tolls.2': { powerK: 1.15, bloodscent: true },
  // Cinder mites, skittish but weak: a quicker clock on a softer bite.



  'tolls.3': { powerK: 1, clock: { gapK: 0.95, tellK: 0.9 } },

  // Young swarm: soft, slow, and honest HP. The tutorial fight, and the only one
  // that hits *under* the line — everything after it is at the line or above.
  // No hpK: the first fight lasts exactly its 1.2 promised screens, and a median
  // starter who dodges nothing still walks out with ~20 HP.
  'tolls.4': { powerK: 0.7, clock: { gapK: 1.2, tellK: 1.15 } },
  // The fence holds a file. What you anchored there is gone for the fight.
  'tolls.5': { powerK: 1.2, walls: true },
  // The weighbridge: slow, heavy, and it does not move for you.
  'tolls.6': { hpK: 1.3, powerK: 1.15, clock: { gapK: 1.15, tellK: 1 } },
  // Exact change, every fourth volley, on the count. Step back a lane.
  'tolls.7': { powerK: 1.25, toll: true },
};

/** The twist for one encounter, or `{}` when the fight plays straight. */
export function quirkOf(encounterId: string | null | undefined): Quirk {
  if (!encounterId) return {};
  return QUIRKS[encounterId] ?? {};
}

/** True when this encounter has a named twist at all. */
export function hasQuirk(encounterId: string | null | undefined): boolean {
  return !!encounterId && encounterId in QUIRKS;
}
