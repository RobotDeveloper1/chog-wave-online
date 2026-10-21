import { anyCard } from '../cards.ts';
import { ENCOUNTERS, ENCOUNTER_BY_ID, REGIONS, type EncounterKind, type RegionId } from './index.ts';
import { distOrder } from './mobs.ts';
import { quirkOf } from './quirks.ts';
import { CHAIN_STEPS, CHAIN_MAX } from '../sf/element.ts';
import { cardClass } from '../sf/card.ts';

/**
 * What an encounter costs, derived from the deck the player is holding when they reach it.
 *
 * This is the number `docs/THE-LINE.md` §4.3 left open, and it decides whether the first hour is
 * tense or trivial. A fresh Chog holds one card and a basic attack worth **9 to 16 might**
 * (`sf/loadout.ts basicMight`, measured across the 493 tokens in `.data/metadata`). Everything
 * here is expressed in units of *that*, never in absolute damage, because an absolute number is
 * one the attribute formula can invalidate overnight.
 *
 * **The HP is computed, not tabulated.** The first version of this file carried a hand-written
 * `RING_BASE` table and it was wrong by more than an order of magnitude in both directions. The
 * second version computed from the mean held might — and was wrong by half an order of magnitude
 * the other way, because its "screen" was six copies of the player's best card, a screen nobody
 * can legally play: a fresh Chog takes three picks a screen, owns one copy of each card, and the
 * element lock forbids mixing. Fights ran five to ten times longer than the `SCREENS` table
 * promised, and every landed volley in those extra screens made the mobs feel overtuned when the
 * HP was the thing out of tune.
 *
 * So the budget prices a screen a player can actually play:
 *
 *  - **what the player holds on arrival** is everything the gated road proves: every unlock from
 *    the regions before this one (the warden key proves them) plus this region's encounters
 *    before this one (the sequential gate in `encounterGate` proves them);
 *  - **a screen is what that deck's best element does in one Hand**: each same-element
 *    group chained in order — at most one Mega and one Giga, the base caps — with the basic
 *    attack filling the picks the deck cannot, and the strongest group winning;
 *  - and the kind sets how many screens the fight should last.
 *
 * The consequence is the point of the whole design: **the reward is the difficulty.** Take a
 * card out of a region and the region's fights get longer; add one and they get shorter, without
 * anybody touching a difficulty slider. The model assumes neutral matchups and an on-tribe
 * player; an off-tribe player loses the filler chain, which reads as a slightly longer fight,
 * not a wall — every region keeps every starter at a neutral-or-better average.
 */

/** How many screens a fight of each kind should last, at the deck the player arrives with.
 * Regions 2 and up play this table straight; region 1 breathes (see `screensFor`). */
export const SCREENS: Record<EncounterKind, number> = {
  /** The bread. Two screens of the basic attack is the tutorial's whole promise. */
  drift: 1.8,
  /** Where the region starts asking for a second card. */
  post: 3.4,
  /** The gate. Out of reach until the region has given up most of what it holds. */
  warden: 6.5,
};

/**
 * The tutorial breathes: region 1 fights cost fewer screens while the player is
 * still learning the verbs — one charge cycle for a drift instead of two, four
 * basics instead of six. The reward is still the difficulty (HP still prices from
 * the arrival deck); the first map just asks for fewer screens of it.
 */
const TUTORIAL_SCREENS: Record<EncounterKind, number> = { drift: 1.2, post: 2.6, warden: 5 };

export function screensFor(kind: EncounterKind, regionN: number): number {
  return regionN <= 1 ? TUTORIAL_SCREENS[kind] : SCREENS[kind];
}

/** The median fresh Chog's basic attack. Measured, not chosen: sf/loadout.ts basicMight across
 * the 493 tokens in .data/metadata gives 9..16 with a median of 12.
 */
export const BASIC_MIGHT = 12;

/** The panel. Three rows, two columns. */
export const SCREEN_CELLS = 6;

/**
 * How many cards a Hand takes in each region. Slots grow one per eight levels
 * (`sf/loadout.ts STEPS.slots`), and region *n* is levels *(n-1)*4+2..n*4+1, so the first two
 * regions play three-card screens and the last plays five — six is a level-26 privilege the
 * budget does not assume.
 */
export function slotsForRegion(n: number): number {
  const table = [3, 3, 4, 4, 5, 5];
  return table[Math.max(1, Math.min(6, Math.round(n))) - 1]!;
}

const mightOf = (id: string): number => {
  const c = anyCard(id);
  return c ? c.power * Math.max(1, c.hits) : 0;
};

/**
 * Every card the road proves on arrival at index `i` of `region`: all unlocks from the regions
 * before it, then this region's encounters before `i`. Both halves are facts, not assumptions —
 * the warden key gates regions; inside a region, `i` is the distance rank, so the road
 * prices the natural grind — nearer sites cleared first — while wanderers arrive
 * over- or under-held by their own route.
 */
function heldOnArrival(region: RegionId, i: number): string[] {
  const n = REGIONS.find((r) => r.id === region)?.n ?? 1;
  const before = ENCOUNTERS.filter((e) => (REGIONS.find((r) => r.id === e.region)?.n ?? 7) < n);
  const mine = distOrder(region).slice(0, Math.max(0, i)).flatMap((id) => ENCOUNTER_BY_ID.get(id)?.unlocks ?? []);
  const heldBefore = before.flatMap((e) => [...e.unlocks]);
  return [...new Set([...heldBefore, ...mine])];
}

/**
 * What one screen of this player's deck is worth on arrival: the best element's picks,
 * chained, with basics filling the rest.
 *
 * With nothing held this is chained basics, which is the honest reading of "one card": the
 * first drift of the first region is fought entirely with the basic attack.
 */
export function screenMight(region: RegionId, index: number): number {
  const n = REGIONS.find((r) => r.id === region)?.n ?? 1;
  const picks = slotsForRegion(n);
  const held = heldOnArrival(region, index);
  const groups = new Map<string, { might: number; cls: string }[]>();
  for (const id of held) {
    const c = anyCard(id);
    if (!c || mightOf(id) <= 0) continue;
    const g = groups.get(c.element) ?? [];
    g.push({ might: mightOf(id), cls: cardClass(c) });
    groups.set(c.element, g);
  }
  // The player runs their best element, not their longest group: two megas beat four
  // weaks, and the lock makes the screen single-element anyway. A new card can only raise a
  // group's value, so the budget grows monotonically as the road is walked.
  let best = 0;
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => b.might - a.might);
    // The base class caps: one Mega and one Giga a screen, whatever the deck holds.
    const line: number[] = [];
    let mega = false;
    let gigad = false;
    for (const c of sorted) {
      if (line.length >= picks) break;
      if (c.cls === 'mega') {
        if (mega) continue;
        mega = true;
      }
      if (c.cls === 'giga') {
        if (gigad) continue;
        gigad = true;
      }
      line.push(c.might);
    }
    // Picks the deck cannot fill are basics, not blanks.
    while (line.length < picks) line.push(BASIC_MIGHT);
    let total = 0;
    for (let i = 0; i < picks; i++) {
      total += line[i]! * CHAIN_STEPS[Math.min(i, CHAIN_MAX)]!;
    }
    best = Math.max(best, total);
  }
  if (!groups.size) {
    let total = 0;
    for (let i = 0; i < picks; i++) total += BASIC_MIGHT * CHAIN_STEPS[Math.min(i, CHAIN_MAX)]!;
    best = total;
  }
  return Math.round(best);
}

export interface EncounterBudget {
  /** What one screen of the arrival deck is worth, for the report and the tooltip. */
  screenMight: number;
  screens: number;
  hp: number;
  band: string;
}

/** The budget for one encounter. Null for an id the Line does not hold. */
export function encounterBudget(encounterId: string): EncounterBudget | null {
  const e = ENCOUNTER_BY_ID.get(encounterId);
  if (!e) return null;

  const index = distOrder(e.region).indexOf(e.id);
  const sm = screenMight(e.region, Math.max(0, index));
  const n = REGIONS.find((r) => r.id === e.region)?.n ?? 1;
  const screens = screensFor(e.kind, n);
  const hpK = quirkOf(e.id).hpK ?? 1;
  return { screenMight: sm, screens, hp: Math.round(screens * sm * hpK), band: `${e.region}-${e.kind}` };
}

/** What a basics-only screen is worth in this region: chained basics over the region's slots. */
function basicsScreen(region: RegionId): number {
  const n = REGIONS.find((r) => r.id === region)?.n ?? 1;
  const picks = slotsForRegion(n);
  let total = 0;
  for (let i = 0; i < picks; i++) total += BASIC_MIGHT * CHAIN_STEPS[Math.min(i, CHAIN_MAX)]!;
  return Math.round(total);
}

/**
 * How many screens a fight takes **with no cards at all** — the tutorial's own yardstick.
 *
 * Every drift in the Line has to be beatable this way, including the ones in region six, because
 * a player is never sent backwards: if they reach a fight they can fight. This is the assertion
 * that says the Line never sends a player somewhere they cannot survive.
 */
export function screensForBasicsOnly(encounterId: string): number | null {
  const e = ENCOUNTER_BY_ID.get(encounterId);
  const b = encounterBudget(encounterId);
  if (!e || !b) return null;
  return Math.round((b.hp / basicsScreen(e.region)) * 10) / 10;
}

/**
 * How many screens it takes with the arrival deck — the number the pacing report should agree
 * with. This echoes `SCREENS` by construction now (the HP is priced from the same screen), and
 * is kept as the report's hook rather than as an independent check: the independence lives in
 * `screensForBasicsOnly`.
 */
export function screensForRegionDeck(encounterId: string): number | null {
  const b = encounterBudget(encounterId);
  if (!b || b.screenMight <= 0) return null;
  return Math.round((b.hp / b.screenMight) * 10) / 10;
}
