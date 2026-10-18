import type { Element } from '../types.ts';

/**
 * The element chart.
 *
 * Mega Man Star Force does not use a table of matchups, it uses a **cycle**: Heat burns Wood,
 * Wood grounds Elec, Elec shocks Aqua, Aqua douses Heat. One rule to remember, and every
 * element has exactly one thing it beats and one thing it loses to. Chog's six elements are
 * folded onto that shape:
 *
 *     burn (HEAT) → wave (WOOD) → volt (ELEC) → frost (AQUA) → burn
 *
 * The two that sit outside the cycle are the two that are not elements in the usual sense:
 *
 *   - **prism** is NULL — Star Force's non-elemental. It is never super effective and never
 *     resisted, which is a real cost and a real gift: it is also the one element a Hand
 *     Screen will let you pick into *any* element lock.
 *   - **void** is the anti-signal. It has the highest base power in the set and it is the only
 *     thing that hurts prism for double, but every void card pushes the district's Wave Index
 *     *up* instead of bleeding it off. Power here is bought with the city's weather.
 */

/** Star Force's own names, for the readouts. Chog's ids stay what they are. */
export const SF_NAMES: Record<Element, string> = {
  burn: 'HEAT',
  wave: 'WOOD',
  volt: 'ELEC',
  frost: 'AQUA',
  prism: 'NULL',
  void: 'VOID',
};

/** What each element beats, walking the cycle. */
const BEATS: Partial<Record<Element, Element>> = {
  burn: 'wave',
  wave: 'volt',
  volt: 'frost',
  frost: 'burn',
};

/** What beats each element: the same cycle read backwards. */
const LOSES_TO: Partial<Record<Element, Element>> = {
  wave: 'burn',
  volt: 'wave',
  frost: 'volt',
  burn: 'frost',
};

/** Non-elemental: neutral everywhere, and pickable into any element lock. */
export const NULL_ELEMENT: Element = 'prism';
/** The anti-element: premium power, and it is the only thing that doubles into NULL. */
export const VOID_ELEMENT: Element = 'void';

export const SUPER_EFFECTIVE = 2;
export const RESISTED = 0.5;
export const NEUTRAL = 1;

/** True for the four elements that form the cycle. */
export function isCycleElement(e: Element): boolean {
  return e in BEATS;
}

/** Star Force's non-elemental: safe everywhere, and the Hand's wildcard. */
export function isNull(e: Element): boolean {
  return e === NULL_ELEMENT;
}

/** The damage multiplier one element deals into another: 2, 1 or 0.5. */
export function matchup(attack: Element, defend: Element): number {
  if (attack === VOID_ELEMENT) return defend === NULL_ELEMENT ? SUPER_EFFECTIVE : NEUTRAL;
  if (attack === NULL_ELEMENT) return NEUTRAL;
  if (BEATS[attack] === defend) return SUPER_EFFECTIVE;
  if (LOSES_TO[attack] === defend) return RESISTED;
  return NEUTRAL;
}

/** The element this one is strong against, or null for the two outside the cycle. */
export function beats(e: Element): Element | null {
  return BEATS[e] ?? null;
}

/** The element this one is weak to, or null for the two outside the cycle. */
export function weakTo(e: Element): Element | null {
  return LOSES_TO[e] ?? null;
}

/** One line for a tooltip: what this element does to that one. */
export function matchupLabel(attack: Element, defend: Element): string {
  const m = matchup(attack, defend);
  if (m > 1) return 'SUPER EFFECTIVE';
  if (m < 1) return 'RESISTED';
  return '';
}

// ---------------------------------------------------------------------------
// The element chain
// ---------------------------------------------------------------------------

/**
 * Running the same element back to back pays.
 *
 * This is what makes a Chog's deck matter after the character is drawn: a Chog whose deck
 * is 60% one element can actually run that element four deep and be paid for the coherence,
 * while a scattered deck cannot. Without it, elements are cosmetics and the deck is free to
 * be random.
 */
export const CHAIN_STEPS = [1, 1.15, 1.3, 1.45, 1.6] as const;
export const CHAIN_MAX = CHAIN_STEPS.length - 1;

export function chainMultiplier(run: number): number {
  return CHAIN_STEPS[Math.max(0, Math.min(CHAIN_MAX, Math.round(run)))]!;
}

/**
 * Advance the meter. The first card of a run scores nothing — a chain is a reward for repeating
 * an element, so it starts paying on the second one and breaks the moment a different element
 * lands.
 */
export function stepChain(run: number, last: Element | null, next: Element): number {
  if (last === null) return 0;
  if (next === last) return Math.min(CHAIN_MAX, run + 1);
  return 0;
}
