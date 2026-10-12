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
import { folderShape } from '../traits.ts';
import type { ChogLoadout, Element } from '../types.ts';

/**
 * What a Chog is, on the field.
 *
 * This is the page that answers "why does the NFT matter". Everything a Chog fights with comes
 * from the token it arrived on: its Head trait is a step, its Mouth trait is a set of
 * percentages, its Tier is how many Mega and Giga cards it may carry, its Body is the shape of
 * its folder, its Skin is an element it shrugs off, and its Aura is the element it fights under.
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
 * Deliberately uneven. Attack climbs fast because Attack is the stat that makes the Buster a
 * weapon between Custom Screens. Slots and files climb slowest because they change *how the
 * board works* rather than how hard you hit — six files is not a bigger number, it is a fight
 * you can actually move around in, and it has to be earned late.
 */
const STEPS = {
  attack: 4,
  gauge: 5,
  rapid: 6,
  charge: 6,
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
    rapid: clampStat(1 + at(lvl, STEPS.rapid)),
    charge: clampStat(1 + at(lvl, STEPS.charge)),
    gauge: clampStat(1 + at(lvl, STEPS.gauge)),
    slots: Math.min(6, DEFAULT_STATS.slots + at(lvl, STEPS.slots)),
    cols: Math.min(6, DEFAULT_STATS.cols + at(lvl, STEPS.cols)),
    // The Tier trait: how many Mega and Giga cards this Chog's folder may hold.
    megaCap: loadout.megaCap,
    gigaCap: loadout.gigaCap,
    armour: 0,
    crit: 0,
    drain: DEFAULT_STATS.drain,
    gaugePct: 0,
  };

  // The Head trait: one step, on you.
  const withGear = GEAR_STEPS[loadout.gear].apply(base);
  // The Mouth trait: percentages, on you.
  return {
    ...withGear,
    crit: clampPct(withGear.crit + voice.crit, CRIT_CAP),
    drain: clampPct(withGear.drain + voice.drain, 1),
    armour: clampPct(withGear.armour, ARMOUR_CAP),
    gaugePct: withGear.gaugePct + voice.gaugePct,
  };
}

/**
 * How many copies of a card this Chog's folder may hold, from its Body trait.
 *
 * This is why a folder is not a deck: five copies of Emberpaw is *five Emberpaws*, and the
 * Custom Screen draws from the folder with repeats, so a Body that permits copies is a Chog
 * that can actually run an element four deep.
 */
export const copiesFor = (loadout: ChogLoadout): number => folderShape(loadout.profile).copies;

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
