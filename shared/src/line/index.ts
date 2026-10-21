import type { BossArchetype } from '../dungeonData.ts';
import type { Element } from '../types.ts';

/**
 * The Line: the open world outside the city, and the whole of the card progression.
 *
 * A Chog used to be born holding 24–34 cards (`folderSlots` in formula.ts, fed by
 * `buildFolder` in derive.ts). That left the first hour of a run with nothing to want and
 * nothing to decide: the deck was full before you took a step. So the deck was moved out
 * of the token and into the world. You start with **one** card — your signature — and your
 * element's basic attack. Everything else is somewhere on the Line, and every encounter
 * unlocks its named cards, permanently, on first clear: drifts pay one, the first clear
 * pays two, deep posts pay two, and wardens pay a spike for the next region plus a keepsake.
 *
 * The NFT did not get weaker, it got a different job. `derive.ts` still decides the six
 * attributes, and the basic attack is priced off them (`basicMight` in sf/loadout.ts), so
 * on bare attributes a rare clean-provenance token out-damages a flipped common by ~36%.
 * That is the first hour. After you have a hand the gap narrows to the PWR slice of
 * Attack (`attackFromPwr` in sf/loadout.ts, at most +18%), which is the honest shape
 * for "owning one helps you, it does not play for you".
 *
 * **Fixed tables, no RNG.** Every unlock is named here. A reward a player can aim at is a
 * reward; a reward rolled from a bag is a slot machine, and the `dungeonData.ts` comment
 * that replaced bag-rolls with a fixed table was right the first time.
 *
 * Pure. The server decides which encounters exist and refuses a clear it cannot prove;
 * the client renders the same tables and computes nothing.
 */

export type RegionId = 'tolls' | 'ashpine' | 'marsh' | 'relay' | 'causeway' | 'static';

export type EncounterKind = 'drift' | 'post' | 'warden';

export interface EncounterDef {
  /** `region.n` — drifts are 1-4, posts 5-6, the warden is 7. */
  id: string;
  region: RegionId;
  kind: EncounterKind;
  name: string;
  /** What the enemies lean toward, which is also what the encounter's cards speak. */
  element: Element;
  /** 1..6, priced against `loop.ts nodeBudget` so a region's fights scale with its order. */
  tier: number;
  /** Cards this encounter unlocks, permanently, on first clear. */
  unlocks: readonly string[];
  /** Drift packs are walked into, not fought. Posts and wardens are real duels. */
  duel: boolean;
}

export interface RegionDef {
  id: RegionId;
  /** 1..6, the order they open in. */
  n: number;
  name: string;
  element: Element;
  tagline: string;
  blurb: string;
  boss: { name: string; archetype: BossArchetype };
  /** What the first warden clear pays, over and above the rooms. */
  firstClear: { xp: number; wav: number; title: string };
  encounters: readonly EncounterDef[];
}

type Row = readonly [string, Element, readonly string[]];

function region(
  id: RegionId,
  n: number,
  name: string,
  element: Element,
  tagline: string,
  blurb: string,
  boss: RegionDef['boss'],
  firstClear: RegionDef['firstClear'],
  rows: readonly Row[],
): RegionDef {
  const encounters: EncounterDef[] = rows.map(([name_, el, unlocks], i) => {
    const k: EncounterKind = i < 4 ? 'drift' : i < 6 ? 'post' : 'warden';
    return {
      id: `${id}.${i + 1}`,
      region: id,
      kind: k,
      name: name_,
      element: el,
      tier: n,
      unlocks,
      duel: k !== 'drift',
    };
  });
  return { id, n, name, element, tagline, blurb, boss, firstClear, encounters };
}

/**
 * The six regions, in order. Each is four drifts, two posts and a warden; each warden
 * opens the next. The cards are assigned so a region teaches its element before the
 * region's one fusion card is on the table, and so the six GA fusions are spread across
 * the second half of the Line instead of all waiting at the end.
 */
export const REGIONS: readonly RegionDef[] = [
  region(
    'tolls', 1, 'TOLLS', 'burn',
    'the last farmed strip before the road gives up',
    'Dry wheat and rusted fence, an hour before a dusk that never quite arrives. Everything out here is small and mean and easy to kill, which is exactly why it is the first place anyone walks.',
    { name: 'TOLLKEEPER', archetype: 'tollkeeper' },
    { xp: 70, wav: 140, title: 'Toll Runner' },
    [
      ['Soot imps', 'burn', ['staticnip']],
      ['Chaff walkers', 'burn', ['v_bubblegum']],
      ['Cinder mites', 'burn', ['lucky_coin']],
      ['Rust mites', 'burn', ['undertow', 'rimeclaw']],
      ['The reaper\'s fence', 'volt', ['refract']],
      ['The weighbridge', 'frost', ['nullfur']],
      ['Tollkeeper', 'burn', ['magmachog']],
    ],
  ),
  region(
    'ashpine', 2, 'ASH PINE', 'volt',
    'a forest that has been burning for a long time',
    'Black pines under a fall of ash that has not stopped in eleven years. The needles are warm. The wardens at the treeline have been paid, in ash, to keep you off the road.',
    { name: 'FIRST FLAME', archetype: 'baron' },
    { xp: 120, wav: 260, title: 'Ash Walker' },
    [
      ['Ash bats', 'volt', ['cigar_steady']],
      ['Needle crawlers', 'burn', ['v_lipbite']],
      ['Sap ghosts', 'wave', ['fwog_buddy']],
      ['Char hounds', 'volt', ['v_normsmile']],
      ['The burnt stand', 'burn', ['emberpaw']],
      ['The signal tree', 'volt', ['v_flatline']],
      ['First Flame', 'burn', ['ga_cinderfall']],
    ],
  ),
  region(
    'marsh', 3, 'GLASS MARSH', 'frost',
    'where the Index kept what it could not sell',
    'Standing water with no wind in it, so the whole marsh reads as one mirror until you move. The pylons are drowned to the second joint. The Librarian has been cataloguing, and everything in here is catalogued.',
    { name: 'RIME LIBRARIAN', archetype: 'front' },
    { xp: 180, wav: 380, title: 'Glass Reader' },
    [
      ['Mirror minnows', 'wave', ['v_puke']],
      ['Reed husks', 'frost', ['v_clownlaugh']],
      ['Flatline waders', 'frost', ['splashback']],
      ['Glasswing drift', 'prism', ['b_origin']],
      ['The reading room', 'frost', ['v_goldtooth']],
      ['The drowned stacks', 'frost', ['switchblade', 'ga_moltenmirror']],
      ['Rime Librarian', 'frost', ['hoarbar', 'ga_hollowwinter']],
    ],
  ),
  region(
    'relay', 4, 'RELAY FLATS', 'volt',
    'a broadcast site that never stopped transmitting',
    'A flat plain of antenna bones and cable runs with a storm parked over it that will not leave. Everything out here repeats itself. The volleys come in sweeps, and standing still is how the Spire finds you.',
    { name: 'PACKET KING', archetype: 'surge' },
    { xp: 240, wav: 500, title: 'Relay Runner' },
    [
      ['Arc fleas', 'volt', ['stormchomp']],
      ['Repeater crows', 'wave', ['v_worried']],
      ['Packet wolves', 'volt', ['cinderfang']],
      ['Out-of-band crawlers', 'void', ['v_smile']],
      ['The quiet mast', 'volt', ['v_rainfall']],
      ['The dead repeater', 'volt', ['v_drool', 'ga_staticbloom']],
      ['Packet King', 'volt', ['sb_signal', 'ga_arccathedral']],
    ],
  ),
  region(
    'causeway', 5, 'CAUSEWAY', 'wave',
    'the old trade route, flooded',
    'A highway under eighteen centimetres of water, long enough that the far end is a rumour. The current copies what you do and hands it back a moment later. Mind your own files.',
    { name: 'UNDERTOW MOTHER', archetype: 'mirror' },
    { xp: 320, wav: 680, title: 'Tide Walker' },
    [
      ['Drift minnows', 'wave', ['pepe_curse']],
      ['Toll divers', 'frost', ['v_btccoin']],
      ['Current riders', 'wave', ['hot_heart']],
      ['Median weeds', 'wave', ['green_candle']],
      ['The median strip', 'wave', ['v_grit']],
      ['The drowned interchange', 'prism', ['v_wo', 'ga_quietdeath']],
      ['Undertow Mother', 'wave', ['tsunamichog', 'ga_drownedbell']],
    ],
  ),
  region(
    'static', 6, 'THE STATIC LINE', 'void',
    'where the road ends and the noise begins',
    'There is no landmark here, because the Line stops and the Index does not. Distance is something other people measured. Every trade in the city ends up on this road, and every Chog that ever held one has walked it.',
    { name: 'THE INDEX', archetype: 'baron' },
    { xp: 480, wav: 1100, title: 'Core Keeper' },
    [
      ['Noise husks', 'void', ['chognova']],
      ['Null hounds', 'void', ['red_candle']],
      ['Dead channels', 'void', ['ripplebite']],
      ['Blind relays', 'void', ['arcsnap']],
      ['The last mile marker', 'void', ['eclipse']],
      ['The out-of-band', 'prism', ['glacierhowl', 'ga_prismchoir']],
      ['The Index', 'void', ['signaldeath', 'ga_lasttrain']],
    ],
  ),
];

export const REGION_IDS: readonly RegionId[] = REGIONS.map((r) => r.id);
export * from './budget.ts';
export * from './layout.ts';
export * from './mobs.ts';
export * from './quirks.ts';

export const REGION_BY_ID: ReadonlyMap<RegionId, RegionDef> = new Map(REGIONS.map((r) => [r.id, r]));

/** Every encounter, in the order a player meets them. */
export const ENCOUNTERS: readonly EncounterDef[] = REGIONS.flatMap((r) => r.encounters);
export const ENCOUNTER_BY_ID: ReadonlyMap<string, EncounterDef> = new Map(ENCOUNTERS.map((e) => [e.id, e]));

/** The encounter that seals a region. */
export function wardenOf(id: RegionId): EncounterDef {
  const r = REGION_BY_ID.get(id);
  const w = r?.encounters.find((e) => e.kind === 'warden');
  if (!w) throw new Error(`region ${id} has no warden`);
  return w;
}

// ---------------------------------------------------------------------------
// Progress and gating
// ---------------------------------------------------------------------------

/** The only thing the server needs to persist about the Line. */
export interface LineProgress {
  /** Encounter ids beaten, permanent. */
  cleared: readonly string[];
}

export const EMPTY_LINE: LineProgress = { cleared: [] };

/**
 * How many regions are *done*, counting only a contiguous run from the first.
 *
 * A clear out of order cannot happen through the server — region *N* is not open until
 * region *N−1*'s warden is down — but this is also the cheap way to make that true in the
 * numbers rather than only in the routing: a stray id in `cleared` buys nothing.
 */
export function regionsCleared(prog: LineProgress): number {
  const set = new Set(prog.cleared);
  let n = 0;
  for (const r of REGIONS) {
    if (!set.has(wardenOf(r.id).id)) break;
    n++;
  }
  return n;
}

/** Which regions are behind you and which are in front, for the map screen. */
export function regionState(prog: LineProgress, id: RegionId): 'done' | 'open' | 'sealed' {
  const r = REGION_BY_ID.get(id);
  if (!r) return 'sealed';
  if (new Set(prog.cleared).has(wardenOf(id).id)) return 'done';
  return r.n <= regionsCleared(prog) + 1 ? 'open' : 'sealed';
}

export interface LineGate {
  open: boolean;
  reason: string;
}

const ok: LineGate = { open: true, reason: '' };
const shut = (reason: string): LineGate => ({ open: false, reason });

export function regionGate(prog: LineProgress, id: RegionId): LineGate {
  const r = REGION_BY_ID.get(id);
  if (!r) return shut('no such region');
  if (r.n === 1) return ok;
  const prev = REGIONS[r.n - 2]!;
  return new Set(prog.cleared).has(wardenOf(prev.id).id)
    ? ok
    : shut(`${prev.name}: the warden is still standing`);
}

export function encounterGate(prog: LineProgress, id: string): LineGate {
  const e = ENCOUNTER_BY_ID.get(id);
  if (!e) return shut('no such encounter');
  const rg = regionGate(prog, e.region);
  if (!rg.open) return rg;


  // Encounters are independent inside an open region: no predecessor chain. The road is
  // walked for levels and drops, not in a fixed order — difficulty runs by distance from
  // the trailhead instead (see budget.ts), so wandering further is the risk dial.

  return ok;
}

/** Every card the Line has handed this player, in the order it was handed over. */
export function unlockedBy(prog: LineProgress): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of ENCOUNTERS) {
    if (!prog.cleared.includes(e.id)) continue;
    for (const id of e.unlocks) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function cardsHeld(prog: LineProgress): number {
  return unlockedBy(prog).length;
}

/**
 * How big a deck the Line has made room for.
 *
 * Two regions cleared is twelve slots and a hand you can actually think about; the whole
 * Line is eighteen, which is the ceiling because the Hand is a 3x2 panel and six
 * is the whole hand. What the deck *is* still comes from the token — copies, Mega and
 * Giga caps and the banned element all come from `deckShape` — so rarity decides what
 * kind of deck is buildable and walking only decides what is in it.
 */
export const LINE_BASE_SLOTS = 2;
export const LINE_MAX_SLOTS = 18;

export function slotsFor(prog: LineProgress): number {
  const raw = LINE_BASE_SLOTS + regionsCleared(prog) * 2 + Math.floor(prog.cleared.length / 4);
  return Math.max(LINE_BASE_SLOTS, Math.min(LINE_MAX_SLOTS, raw));
}

/**
 * The dungeons are phase two, and the gate says so twice on purpose.
 *
 * A level check alone would let a grinder walk into a fold holding nothing but a signature
 * card, which is not phase two — it is a duel with the interesting part removed. So it
 * takes two regions crossed *and* ten cards found: a hand, and the reason to want a
 * longer one.
 */
export const DUNGEONS_AT_REGIONS = 2;
export const DUNGEONS_AT_CARDS = 10;

export function dungeonsGate(prog: LineProgress): LineGate {
  const regions = regionsCleared(prog);
  if (regions < DUNGEONS_AT_REGIONS) {
    return shut(`the Line, first — ${DUNGEONS_AT_REGIONS - regions} more warden${DUNGEONS_AT_REGIONS - regions === 1 ? '' : 's'}`);
  }
  const cards = cardsHeld(prog);
  if (cards < DUNGEONS_AT_CARDS) return shut(`${DUNGEONS_AT_CARDS - cards} more cards from the Line`);
  return ok;
}

/**
 * Anomalies are the market-driven half of the game and they are not on the critical path
 * — they never were, the Line does not wait for one — but they move behind the third
 * region, so the first two hours of a run are not spent watching a ticker for something
 * that will not come. Past that they are the endgame, and the eight `e_*` cards are theirs.
 */
export const ANOMALIES_AT_REGIONS = 3;

export function anomaliesGate(prog: LineProgress): LineGate {
  const regions = regionsCleared(prog);
  return regions >= ANOMALIES_AT_REGIONS ? ok : shut(`the Line, first — ${ANOMALIES_AT_REGIONS - regions} more warden${ANOMALIES_AT_REGIONS - regions === 1 ? '' : 's'}`);
}

// ---------------------------------------------------------------------------
// The cards the Line does not hold
// ---------------------------------------------------------------------------

/**
 * Card ids the Line does **not** hold, so the rest of the catalogue has somewhere to live.
 * 51 cards are on the Line; these nineteen are the difference between a reward
 * table and a closed set.
 */
export const ANOMALY_CARDS: readonly string[] = [
  'e_laser', 'e_visor', 'e_vr', 'e_wide', 'e_narrow', 'e_tear', 'e_dead', 'e_wild',
];

export const DUNGEON_CARDS: readonly string[] = [
  'v_moncoin', 'spectrum', 'b_skull', 'b_radio', 'b_one',
  'cindercoat', 'slagmaw', 'deepchill', 'whiteout', 'aegisnap', 'tidewall',
];

/**
 * Every card the game can *give* a player, and where it comes from.
 *
 * The six basic attacks are excluded on purpose: nobody wins them, nothing sells them, and they
 * are not in `CARDS_ALL`'s reward economy — they exist so a hand is never short. Throws a
 * duplicate on `missing`, which is the only thing this function is really for: if a card is
 * handed by two systems, or by none, it says so here instead of quietly in a reward screen.
 */
export function cardSources(): { line: string[]; anomaly: string[]; dungeon: string[]; missing: string[] } {
  const line = unlockedBy({ cleared: ENCOUNTERS.map((e) => e.id) });
  const anomaly = [...ANOMALY_CARDS];
  const dungeon = [...DUNGEON_CARDS];
  const all = [...line, ...anomaly, ...dungeon];
  return { line, anomaly, dungeon, missing: all.length === new Set(all).size ? [] : all.filter((id, i) => all.indexOf(id) !== i) };
}

/** Everything a player can end up owning: the reward catalogue, plus the six basics. */
export const REWARD_CATALOGUE_SIZE = cardSources().line.length + ANOMALY_CARDS.length + DUNGEON_CARDS.length;
