import type { ItemId } from './economy.ts';
import type { Element } from './types.ts';

/**
 * The dungeons: the whole of the world outside the city.
 *
 * There is one city and there are six dungeons, and a Chog's career is the walk between them.
 * Each dungeon belongs to one element — its rooms, its elites and its boss all lean that way,
 * so a Chog's own tribe and its weakness decide how the run feels before a card is played — and
 * each opens at a level *and* only once the one before it has been cleared, so the order is
 * the story. They are pure data on purpose: the progression ladder, the quests, the server
 * that opens a run and the menu that lists them all read this one table.
 */

export type BossArchetype = 'spark' | 'baron' | 'front' | 'mirror' | 'surge';

export interface DungeonDef {
  id: string;
  /** 1..6: the order they open in. */
  n: number;
  name: string;
  /** What it is made of: the element its enemies lean toward and its boss is. */
  element: Element;
  /** The level it opens at (and the dungeon before it must have been cleared too). */
  level: number;
  /** Difficulty band: enemy health, how rich the caches are, how deep the card pool goes. */
  tier: number;
  /** Depth of the map: the number of rooms between the mouth and the boss. */
  rows: number;
  /** One line for the list, and a paragraph for the page. */
  tagline: string;
  blurb: string;
  boss: { name: string; archetype: BossArchetype };
  /** What the first clear pays on top of the rooms, and the title it earns. */
  firstClear: { xp: number; wav: number; items?: Partial<Record<ItemId, number>>; title: string };
}

export const DUNGEONS: readonly DungeonDef[] = [
  {
    id: 'd-ember',
    n: 1,
    name: 'EMBER FOUNDRY',
    element: 'burn',
    level: 2,
    tier: 1,
    rows: 4,
    tagline: 'a furnace the Index forgot to switch off',
    blurb: 'Under the Foldgate Yard the old foundry is still running: every belt, every press, every guard. Nothing in it knows the day is over. Short, hot and forgiving — the place to learn what a fold is.',
    boss: { name: 'FOUNDRY WARDEN', archetype: 'baron' },
    firstClear: { xp: 60, wav: 120, items: { pack: 1, med: 1 }, title: 'Foundry Breaker' },
  },
  {
    id: 'd-frost',
    n: 2,
    name: 'FROST ARCHIVE',
    element: 'frost',
    level: 5,
    tier: 2,
    rows: 5,
    tagline: 'cold storage for every card nobody sold',
    blurb: 'Where the Index keeps what the market left unsold. The shelves are glass, the aisles are walls that rise and fall, and the Librarian does not like anything being taken down.',
    boss: { name: 'RIME LIBRARIAN', archetype: 'front' },
    firstClear: { xp: 90, wav: 180, items: { pack: 1, repair: 1 }, title: 'Archive Reader' },
  },
  {
    id: 'd-volt',
    n: 3,
    name: 'RELAY SPIRE',
    element: 'volt',
    level: 8,
    tier: 2,
    rows: 5,
    tagline: 'a tower of packets, all of them late',
    blurb: 'A mast of relays folded into a stairwell. Everything in it arrives before it was sent, and the volleys come in sweeps — stand still and the Spire will find you.',
    boss: { name: 'PACKET KING', archetype: 'surge' },
    firstClear: { xp: 130, wav: 260, items: { pack: 1, amp: 1 }, title: 'Spire Runner' },
  },
  {
    id: 'd-wave',
    n: 4,
    name: 'SUNKEN RESERVOIR',
    element: 'wave',
    level: 12,
    tier: 3,
    rows: 5,
    tagline: 'the Index drains here, and the water remembers',
    blurb: 'A reservoir under the canal that fills with whatever the wave washes down. The current copies what you do and gives it back a moment later — mind your own files.',
    boss: { name: 'UNDERTOW MOTHER', archetype: 'mirror' },
    firstClear: { xp: 180, wav: 360, items: { pack: 2, ward: 1 }, title: 'Tide Walker' },
  },
  {
    id: 'd-prism',
    n: 5,
    name: 'PRISM VAULT',
    element: 'prism',
    level: 18,
    tier: 3,
    rows: 6,
    tagline: 'every Chog ever sighted, refracted',
    blurb: 'A vault of mirrored halls in which the whole collection is kept, one reflection at a time. Fast, bright and merciless: the Twin fires before you have finished reading the warning.',
    boss: { name: 'SPECTRUM TWIN', archetype: 'spark' },
    firstClear: { xp: 260, wav: 520, items: { pack: 2, amp: 1 }, title: 'Vault Breaker' },
  },
  {
    id: 'd-void',
    n: 6,
    name: 'THE STORM CORE',
    element: 'void',
    level: 26,
    tier: 4,
    rows: 6,
    tagline: 'the centre of the Index, where the wave begins',
    blurb: 'The last fold, and the oldest: the place every trade in the city ends up. There is no trick to it. It is the deepest map the Index has, and the hardest thing in it is the Index.',
    boss: { name: 'THE INDEX', archetype: 'baron' },
    firstClear: { xp: 400, wav: 900, items: { pack: 3, repair: 2, ward: 1 }, title: 'Core Keeper' },
  },
];

export const DUNGEON_BY_ID: ReadonlyMap<string, DungeonDef> = new Map(DUNGEONS.map((d) => [d.id, d]));
