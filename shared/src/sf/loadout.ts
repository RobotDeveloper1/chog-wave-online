import {
  ARMOUR_CAP,
  CRIT_CAP,
  DEFAULT_STATS,
  STAT_CAP,
  clampPct,
  clampStat,
  type DuelStats,
} from './stats.ts';
import { GEAR_STEPS, voiceStats, type PartySeat } from './party.ts';
import { deckShape } from '../traits.ts';
import { BASIC_IDS, card } from '../cards.ts';
import { ofCard, type BattleCard } from './card.ts';
import type { ChogLoadout, Element } from '../types.ts';

/**
 * What a Chog is, on the field.
 *
 * This is the page that answers "why does the NFT matter". Everything a Chog fights with comes
 * from the token it arrived on: its Head trait is a step, its Mouth trait is a set of
 * percentages, its Tier is how many Mega and Giga cards it may carry, its Body is the shape of
 * its deck, its Skin is an element it shrugs off, and its Aura is the element it fights under.
 * Strip the token out and there is no build left — which is the whole argument.
 *
 * Persistent level comes from the MMO progression ledger. Combat normalizes that level onto
 * its 2..26 ladder; the XP, quest and dungeon unlock systems remain authoritative.
 */

export const LEVEL_FLOOR = 2;
export const LEVEL_CEIL = 26;

/** What one level is worth in field integrity. A level-26 Chog survives four times as much. */
export const HP_PER_LEVEL = 22;

/**
 * How every stat grows across the ladder.
 *
 * Deliberately uneven. Attack climbs fast because Attack multiplies every card.
 * Slots and files climb slowest because they change *how the
 * board works* rather than how hard you hit — six files is not a bigger number, it is a fight
 * you can actually move around in, and it has to be earned late.
 */
const STEPS = {
  attack: 4,
  charge: 5,
  slots: 8,
  cols: 8,
} as const;

const at = (level: number, per: number): number =>
  Math.floor((clampLevel(level) - LEVEL_FLOOR) / per);

export const clampLevel = (n: number): number =>
  Math.max(LEVEL_FLOOR, Math.min(LEVEL_CEIL, Math.round(n)));

export const hpFor = (level: number): number =>
  DEFAULT_STATS.hp + (clampLevel(level) - LEVEL_FLOOR) * HP_PER_LEVEL;

/**
 * The 1..6 difficulty a Chog of this level should be walking into.
 *
 * This is the progression dial, and it is the only place the ladder's difficulty is decided: at
 * level 2 you are in a fold that teaches two words, at level 26 you are in a core that speaks
 * all ten. Being under it is not a wall, it is a reading window you cannot read — which is a
 * far more honest reason to lose than a number.
 */
export function trainingBoss(level: number, element: Element) {
  return { name: 'TRAINING SIM', archetype: 'dummy', element,
    hp: Math.round(hpFor(level) * 2.5), level: clampLevel(level), difficulty: 1 };
}

export const depthFor = (level: number): number =>
  Math.max(1, Math.min(6, 1 + Math.floor((clampLevel(level) - LEVEL_FLOOR) / 4)));

export interface LoadoutInput {
  loadout: ChogLoadout;
  level: number;
}

/**
 * The stats a Chog fights with, straight off its traits.
 *
 * Your own Head trait applies to *you*, on top of whatever the party is granting — that is the
 * difference between the trait that builds you and the trait that builds us.
 */
export function duelStatsOf({ loadout, level }: LoadoutInput): DuelStats {
  const lvl = clampLevel(level);
  const voice = voiceStats(loadout.voice);
  const base: DuelStats = {
    hp: hpFor(lvl),
    attack: clampStat(1 + at(lvl, STEPS.attack)),
    charge: clampStat(1 + at(lvl, STEPS.charge)),
    slots: Math.min(6, DEFAULT_STATS.slots + at(lvl, STEPS.slots)),
    cols: Math.min(6, DEFAULT_STATS.cols + at(lvl, STEPS.cols)),
    // The Tier trait: how many Mega and Giga cards this Chog's deck may hold.
    megaCap: loadout.megaCap,
    gigaCap: loadout.gigaCap,
    armour: 0,
    crit: 0,
    drain: DEFAULT_STATS.drain,
    chargePct: 0,
  };

  // The Head trait: one step, on you.
  const withGear = GEAR_STEPS[loadout.gear].apply(base);
  // The Mouth trait: percentages, on you.
  return {
    ...withGear,
    crit: clampPct(withGear.crit + voice.crit, CRIT_CAP),
    drain: clampPct(withGear.drain + voice.drain, 1),
    armour: clampPct(withGear.armour, ARMOUR_CAP),
    chargePct: withGear.chargePct + voice.chargePct,
  };
}

/**
 * The basic attack, and the one place the NFT's own numbers decide how hard you hit.
 *
 * A Chog used to be born holding 24–34 cards, so the first hour of a run had nothing to want and
 * no moment where the token's own quality was felt. Now the deck is found on the Line
 * (`line.ts`) and the hand's empty cells are filled with this. Which means the basic attack is
 * the *first* thing a new player owns, and therefore the first thing that proves what their token
 * is worth.
 *
* PWR carries it and SPD trims it, which is why a sharp token and a heavy one are different
 * builds and neither is strictly better. Measured across the 493 tokens in `.data/metadata`:
 * **might 9 → 16, median 12, a 1.40× spread at p90/p10 and 1.78× at max/min**. That is the whole
 * gap between the bottom and the top of the collection in the first hour — and after the first
 * region it stops mattering, because by then you are firing cards that do not read your attributes
 * at all. That is the honest shape for invariant 3: **owning one helps you, it does not play for
 * you**, and it helps you exactly where you have nothing else.
 *
 * A foster Chog's profile is capped before the budget is filled (`FOSTER_SHARE_CAP`), so it lands
 * at the low end. That is what not owning one costs, and it is a third of your damage for an hour
 * rather than a locked screen forever.
 *
 * The absolute band is low on purpose and is the one number here that is not yet closed against
 * anything: a region's drift HP has to be priced against 9–16, not against 33–45 as this file
 * originally guessed. That reconciliation belongs with the encounter budgets in slice 3.
 */
/**
 * What a foster token gives up on the basic attack, against the held token it stands in for.
 * A quarter, which puts it near the bottom of the real collection's spread and makes "free costs you
 * a quarter of your damage for an hour" true rather than aspirational.
 */
export const FOSTER_BASIC_SHARE = 0.75;

export const BASIC_BASE = 6;
export const BASIC_PWR = 0.9;
export const BASIC_SPD = 0.25;

export function basicMight(attrs: { PWR: number; SPD: number }): number {
  return Math.max(1, Math.round(BASIC_BASE + attrs.PWR * BASIC_PWR + attrs.SPD * BASIC_SPD));
}

/**
 * The basic attack as a card, with the number already substituted.
 *
 * The catalogue value is `power: 1` because the real figure belongs to the token and not to the
 * card. Substituting here — rather than at the moment of damage — is what keeps the client's
 * damage preview and the server's `fireCard` reading the same value: both go through `view()`,
 * which ships the substituted card, so there is no second number to disagree about.
 */
/**
 * The basic attack as a card, with the token's own number already substituted.
 *
 * Takes the might rather than the attributes, because the number is decided in deriveBuild � where
 * the uncapped profile still exists and the foster ceiling could be applied � and this file has no
 * business re-deriving it.
 *
 * Substituting here, rather than at the moment of damage, is what keeps the client's damage
 * preview and the server's ireCard reading the same value: both go through iew(), which ships
 * the substituted card, so there is no second number to disagree about.
 */
export function basicCard(element: Element, might: number): BattleCard {
  const base = ofCard(card(BASIC_IDS[element] ?? 'basic_burn'));
  const power = Math.max(1, Math.round(might));
  return { ...base, power, might: power * base.hits };
}

/** Convenience for callers that only have attributes � tests, and any seat with no build. */
export const basicCardFor = (element: Element, attrs: { PWR: number; SPD: number }): BattleCard =>
  basicCard(element, basicMight(attrs));

/** The element this Chog fights under, and the one it shrugs off. */
export const elementsOf = (loadout: ChogLoadout): { tribe: Element; resist: Element | null } => ({
  tribe: loadout.element,
  resist: loadout.resist,
});

export interface SeatInput {
  id: string;
  owner: string;
  tokenId: number;
  name: string;
  loadout: ChogLoadout;
  level: number;
  /** Tribe On is running for this Chog. */
  transformed?: boolean;
}

/** One seat in the party, filled by one Chog. */
export function seatOf({ id, owner, tokenId, name, loadout, level, transformed }: SeatInput): PartySeat {
  return {
    id,
    owner,
    tokenId,
    name,
    element: loadout.element,
    level: clampLevel(level),
    gear: loadout.gear,
    voice: loadout.voice,
    ...(loadout.resist ? { resist: loadout.resist } : {}),
    ...(transformed ? { transformed: true } : {}),
  };
}

/**
 * The one-line the inspect panel shows: what this Chog is, and where it came from.
 *
 * `loadout.why` already carries the per-trait reasons; this adds the numbers they produced, so
 * a player can see the chain from "Mon Cap" to "+10% armour" without reading the source.
 */
export function readStats(s: DuelStats): string[] {
  const out = [`${s.hp} integrity`, `attack ${s.attack}/${STAT_CAP}`, `${s.cols} files`];
  if (s.armour > 0) out.push(`${Math.round(s.armour * 100)}% armour`);
  if (s.crit > 0) out.push(`${Math.round(s.crit)}% crit`);
  if (s.drain !== DEFAULT_STATS.drain) out.push(`${Math.round(s.drain * 100)}% drain`);
  if (s.megaCap > 1) out.push(`${s.megaCap} mega`);
  if (s.gigaCap > 0) out.push(`${s.gigaCap} giga`);
  return out;
}
