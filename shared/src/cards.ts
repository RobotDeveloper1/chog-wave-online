import type { Card } from './types.ts';

const S = {
  dot: [[0, 0]] as const,
  h2: [[0, 0], [0, 1]] as const,
  v2: [[0, 0], [1, 0]] as const,
  bar3: [[0, 0], [0, 1], [0, 2]] as const,
  l: [[0, 0], [1, 0], [1, 1]] as const,
  sq: [[0, 0], [0, 1], [1, 0], [1, 1]] as const,
  plus: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] as const,
};

export const CARDS: readonly Card[] = [
  // burn — fast, low coverage, stacks resonance cheaply
  { id: 'emberpaw', name: 'Emberpaw', element: 'burn', shape: S.dot, power: 90, hits: 1, effect: 'none', waveDrain: 1 },
  { id: 'cinderfang', name: 'Cinder Fang', element: 'burn', shape: S.l, power: 70, hits: 2, effect: 'knock', waveDrain: 2 },
  { id: 'magmachog', name: 'Magma Chog', element: 'burn', shape: S.bar3, power: 130, hits: 3, effect: 'pierce', waveDrain: 4, klass: 'M' },
  { id: 'cindercoat', name: 'Cindercoat', element: 'burn', shape: S.dot, power: 75, hits: 1, effect: 'burn', waveDrain: 2 },
  { id: 'slagmaw', name: 'Slagmaw', element: 'burn', shape: S.l, power: 95, hits: 2, effect: 'burn', waveDrain: 3, klass: 'M' },

  // frost — control
  { id: 'rimeclaw', name: 'Rimeclaw', element: 'frost', shape: S.dot, power: 70, hits: 1, effect: 'stun', waveDrain: 1 },
  { id: 'hoarbar', name: 'Hoarbar', element: 'frost', shape: S.v2, power: 95, hits: 2, effect: 'stun', waveDrain: 2 },
  { id: 'glacierhowl', name: 'Glacier Howl', element: 'frost', shape: S.plus, power: 110, hits: 4, effect: 'stun', waveDrain: 5, klass: 'M' },
  { id: 'deepchill', name: 'Deepchill', element: 'frost', shape: S.dot, power: 65, hits: 1, effect: 'freeze', waveDrain: 2 },
  { id: 'whiteout', name: 'Whiteout', element: 'frost', shape: S.v2, power: 85, hits: 2, effect: 'freeze', waveDrain: 3, klass: 'M' },

  // volt — burst, drains the wave hardest
  { id: 'staticnip', name: 'Static Nip', element: 'volt', shape: S.dot, power: 80, hits: 1, effect: 'chain', waveDrain: 2 },
  { id: 'arcsnap', name: 'Arc Snap', element: 'volt', shape: S.h2, power: 120, hits: 2, effect: 'chain', waveDrain: 3 },
  { id: 'stormchomp', name: 'Storm Chomp', element: 'volt', shape: S.sq, power: 150, hits: 3, effect: 'pierce', waveDrain: 6, klass: 'M' },

  // wave — sustain and recovery
  { id: 'undertow', name: 'Undertow', element: 'wave', shape: S.dot, power: 60, hits: 1, effect: 'drain', waveDrain: 1 },
  { id: 'ripplebite', name: 'Ripple Bite', element: 'wave', shape: S.h2, power: 85, hits: 3, effect: 'drain', waveDrain: 2 },
  { id: 'tsunamichog', name: 'Tsunami Chog', element: 'wave', shape: S.sq, power: 120, hits: 4, effect: 'knock', waveDrain: 4, klass: 'M' },
  { id: 'tidewall', name: 'Tidewall', element: 'wave', shape: S.h2, power: 80, hits: 2, effect: 'barrier', waveDrain: 3, klass: 'M' },
  { id: 'splashback', name: 'Splashback', element: 'wave', shape: S.h2, power: 55, hits: 2, effect: 'drain', waveDrain: 2 },

  // prism — the resonance catalyst
  { id: 'refract', name: 'Refract', element: 'prism', shape: S.dot, power: 75, hits: 1, effect: 'none', waveDrain: 1 },
  { id: 'spectrum', name: 'Spectrum', element: 'prism', shape: S.l, power: 100, hits: 2, effect: 'pierce', waveDrain: 3 },
  { id: 'chognova', name: 'Chog Nova', element: 'prism', shape: S.plus, power: 160, hits: 3, effect: 'pierce', waveDrain: 7, klass: 'G' },
  { id: 'aegisnap', name: 'Aegis Nap', element: 'prism', shape: S.dot, power: 70, hits: 1, effect: 'barrier', waveDrain: 2 },

  // void — high cost, punishes your own wave affinity
  { id: 'nullfur', name: 'Null Fur', element: 'void', shape: S.dot, power: 140, hits: 1, effect: 'none', waveDrain: -1 },
  { id: 'eclipse', name: 'Eclipse', element: 'void', shape: S.v2, power: 175, hits: 2, effect: 'pierce', waveDrain: -2 },
  { id: 'signaldeath', name: 'Signal Death', element: 'void', shape: S.bar3, power: 240, hits: 2, effect: 'stun', waveDrain: -4, klass: 'G' },
] as const;

/**
 * The basic attack: one card per element, and the only six cards a Chog owns before it has
 * walked anywhere.
 *
 * They are here rather than synthesised in `sf/` because a card that is not in the catalogue
 * cannot be rendered, priced, fused-checked or drawn as an icon — the whole point is that the
 * empty cells of a Hand are ordinary cards that happen to always be there.
 *
 * `power: 1` on purpose. The number a basic attack actually does is not a property of the card
 * but of the token pressing it — `sf/loadout.ts basicMight` reads the six attributes — so the
 * catalogue value is a placeholder that is *always* overridden before the client sees it. What
 * matters here is the shape (one panel), the verb (plain damage, no on-hit) and the element.
 *
 * These six are deliberately outside the reward economy: no encounter, anomaly, dungeon, shop or
 * fusion produces one, `cardValue` is pinned at zero so a pack cannot roll one, and the Line's
 * card accounting in `line.ts cardSources()` excludes them.
 */
export const BASIC_CARDS: readonly Card[] = [
  { id: 'basic_burn', name: 'Cinder Jab', element: 'burn', shape: S.dot, power: 1, hits: 1, effect: 'none', waveDrain: 0 },
  { id: 'basic_frost', name: 'Hoar Jab', element: 'frost', shape: S.dot, power: 1, hits: 1, effect: 'none', waveDrain: 0 },
  { id: 'basic_volt', name: 'Static Jab', element: 'volt', shape: S.dot, power: 1, hits: 1, effect: 'none', waveDrain: 0 },
  { id: 'basic_wave', name: 'Undertow Jab', element: 'wave', shape: S.dot, power: 1, hits: 1, effect: 'none', waveDrain: 0 },
  { id: 'basic_prism', name: 'Prism Jab', element: 'prism', shape: S.dot, power: 1, hits: 1, effect: 'none', waveDrain: 0 },
  { id: 'basic_void', name: 'Null Jab', element: 'void', shape: S.dot, power: 1, hits: 1, effect: 'none', waveDrain: 0 },
] as const;

/** The basic attack of one element, by id. Every element has exactly one. */
export const BASIC_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  BASIC_CARDS.map((c) => [c.element, c.id]),
);

export const isBasicId = (id: string): boolean => BASIC_CARDS.some((c) => c.id === id);

/**
 * Held-item cards. One per Accessory trait value, so owning the Chog is the only
 * way to hold its card — this is the trait→card coupling the collection makes
 * real. These are the cards a player *notices*: each one breaks a rule the 18
 * core cards obey.
 */
/**
 * Level bands. A born card is held from level 1 to the cap, so the band is about *role*,
 * not acquisition: standards are early-game cards (might under 200, free in the Hand),
 * megas are mid-game spikes (one selectable per Hand), and the giga is the late-game
 * build card (one per deck). No card in a band doubles another band's best, and nothing
 * here scales with level — damage comes from the deck, never from the number.
 */
export const SIGNATURE_CARDS: readonly Card[] = [
{ id: 'fwog_buddy', name: 'Fwog Buddy', element: 'wave', shape: S.dot, power: 90, hits: 1, effect: 'drain', waveDrain: 1, signature: 'Fwog' },
  { id: 'switchblade', name: 'Switchblade', element: 'void', shape: S.dot, power: 260, hits: 1, effect: 'pierce', waveDrain: -2, klass: 'M', signature: 'Knife' },
{ id: 'lucky_coin', name: 'Lucky Coin', element: 'prism', shape: S.dot, power: 70, hits: 1, effect: 'chain', waveDrain: 1, signature: 'Coin' },
{ id: 'hot_heart', name: 'Hot Heart', element: 'burn', shape: S.v2, power: 95, hits: 2, effect: 'drain', waveDrain: 2, signature: 'Heart' },
{ id: 'green_candle', name: 'Green Candle', element: 'frost', shape: S.sq, power: 45, hits: 4, effect: 'stun', waveDrain: 2, signature: 'Green Candle' },
{ id: 'red_candle', name: 'Red Candle', element: 'burn', shape: S.sq, power: 100, hits: 4, effect: 'none', waveDrain: 4, klass: 'M', signature: 'Red Candle' },
{ id: 'cigar_steady', name: 'Cigar Steady', element: 'volt', shape: S.h2, power: 95, hits: 2, effect: 'chain', waveDrain: 2, signature: 'Cigar' },
{ id: 'sb_signal', name: 'SB Signal', element: 'prism', shape: S.bar3, power: 160, hits: 3, effect: 'pierce', waveDrain: 5, klass: 'G', signature: 'SB' },
{ id: 'pepe_curse', name: 'Pepe Curse', element: 'void', shape: S.plus, power: 90, hits: 5, effect: 'knock', waveDrain: -3, klass: 'M', signature: 'PEPE' },
] as const;

/**
 * Voice cards, granted by the Mouth trait. Only 9% of the collection carries an
 * Accessory, so without a second source the marquee "a card only your Chog holds"
 * would be missing for the other 91%.
 */
export const VOICE_CARDS: readonly Card[] = [
  { id: 'v_bubblegum', name: 'Bubblegum Snare', element: 'wave', shape: S.dot, power: 70, hits: 1, effect: 'stun', waveDrain: 2, klass: 'M', voice: 'Bubblegum' },
  { id: 'v_rainfall', name: 'Rainfall', element: 'wave', shape: S.v2, power: 85, hits: 2, effect: 'drain', waveDrain: 2, klass: 'S', voice: 'Sad' },
  { id: 'v_drool', name: 'Caustic Drool', element: 'void', shape: S.h2, power: 130, hits: 2, effect: 'pierce', waveDrain: -1, klass: 'M', voice: 'Drooling' },
  { id: 'v_puke', name: 'Rainbow Puke', element: 'prism', shape: S.bar3, power: 150, hits: 3, effect: 'knock', waveDrain: 4, klass: 'M', voice: 'Rainbow Puke' },
  { id: 'v_goldtooth', name: 'Gold Tooth', element: 'burn', shape: S.dot, power: 120, hits: 1, effect: 'pierce', waveDrain: 2, klass: 'S', voice: 'Gold Tooth' },
  { id: 'v_clownlaugh', name: 'Clown Laugh', element: 'volt', shape: S.l, power: 100, hits: 2, effect: 'stun', waveDrain: 3, klass: 'S', voice: 'Clown Mouth' },
  { id: 'v_btccoin', name: 'Buttcoin Dividend', element: 'volt', shape: S.sq, power: 110, hits: 2, effect: 'chain', waveDrain: 3, klass: 'M', voice: 'BTC Coin' },
  { id: 'v_moncoin', name: 'Mon Dividend', element: 'prism', shape: S.sq, power: 95, hits: 3, effect: 'chain', waveDrain: 3, klass: 'S', voice: 'Mon coin' },
  { id: 'v_lipbite', name: 'Lip Bite', element: 'frost', shape: S.dot, power: 140, hits: 1, effect: 'pierce', waveDrain: 2, klass: 'S', voice: 'Lip Bite' },
  { id: 'v_grit', name: 'Grit', element: 'frost', shape: S.v2, power: 105, hits: 2, effect: 'knock', waveDrain: 2, klass: 'S', voice: 'Grit' },
  { id: 'v_wo', name: 'Wo', element: 'burn', shape: S.dot, power: 60, hits: 4, effect: 'none', waveDrain: 1, klass: 'S', voice: 'wo' },
  { id: 'v_flatline', name: 'Flatline', element: 'void', shape: S.dot, power: 160, hits: 1, effect: 'none', waveDrain: -2, klass: 'M', voice: 'Flat' },
  { id: 'v_smile', name: 'Easy Smile', element: 'wave', shape: S.h2, power: 75, hits: 2, effect: 'drain', waveDrain: 1, klass: 'S', voice: 'Smile' },
  { id: 'v_worried', name: 'Worried Glance', element: 'frost', shape: S.l, power: 80, hits: 2, effect: 'stun', waveDrain: 2, klass: 'S', voice: 'Worried' },
  { id: 'v_normsmile', name: 'Normal Smile', element: 'prism', shape: S.dot, power: 85, hits: 1, effect: 'none', waveDrain: 1, klass: 'S', voice: 'normal smile' },
] as const;

/** Lock-on cards, one per Eye style. Eyes are present on 99% of the collection. */
export const STYLE_CARDS: readonly Card[] = [
  { id: 'e_laser', name: 'Lance Through', element: 'burn', shape: S.bar3, power: 145, hits: 2, effect: 'pierce', waveDrain: 4, klass: 'M', style: 'laser' },
  { id: 'e_visor', name: 'Visor Lock', element: 'volt', shape: S.dot, power: 125, hits: 1, effect: 'chain', waveDrain: 2, klass: 'S', style: 'visor' },
  { id: 'e_vr', name: 'Immersion Feed', element: 'prism', shape: S.h2, power: 100, hits: 2, effect: 'none', waveDrain: 2, klass: 'S', style: 'vr' },
  { id: 'e_wide', name: 'Wide Sweep', element: 'wave', shape: S.sq, power: 90, hits: 3, effect: 'knock', waveDrain: 3, klass: 'S', style: 'wide' },
  { id: 'e_narrow', name: 'Narrow Point', element: 'frost', shape: S.dot, power: 150, hits: 1, effect: 'pierce', waveDrain: 2, klass: 'M', style: 'narrow' },
  { id: 'e_tear', name: 'Tear Tide', element: 'wave', shape: S.v2, power: 70, hits: 3, effect: 'drain', waveDrain: 2, klass: 'S', style: 'tear' },
  { id: 'e_dead', name: 'Hollow Stare', element: 'void', shape: S.l, power: 170, hits: 1, effect: 'none', waveDrain: -2, klass: 'M', style: 'dead' },
  { id: 'e_wild', name: 'Wild Gaze', element: 'volt', shape: S.plus, power: 110, hits: 4, effect: 'stun', waveDrain: 4, klass: 'M', style: 'wild' },
] as const;

/** Form cards, the last resort. Base is present on 100% of the collection. */
export const FORM_CARDS: readonly Card[] = [
  { id: 'b_origin', name: 'Origin Chime', element: 'burn', shape: S.dot, power: 90, hits: 1, effect: 'none', waveDrain: 1, klass: 'S', base: 'Origin' },
  { id: 'b_skull', name: 'Skull Return', element: 'void', shape: S.v2, power: 135, hits: 1, effect: 'none', waveDrain: -1, klass: 'M', base: 'Skull' },
  { id: 'b_radio', name: 'Radioactive Bloom', element: 'frost', shape: S.sq, power: 120, hits: 3, effect: 'stun', waveDrain: 5, klass: 'M', base: 'Radioactive' },
  { id: 'b_one', name: 'One of One', element: 'prism', shape: S.dot, power: 200, hits: 1, effect: 'pierce', waveDrain: 6, klass: 'G', base: '1:1' },
] as const;

/**
 * The heavy cards fusion produces (see fusion.ts). Not purchasable, not droppable: a Chog
 * earns one by firing its recipe once. They live here, not in fusion.ts, so that `card()`
 * can resolve them — a card in a deck must be a card the rest of the game can read.
 */
export const GA_CARDS: readonly Card[] = [
  { id: 'ga_cinderfall', name: 'Cinderfall', element: 'burn', shape: [[0, 0], [0, 1], [0, 2], [1, 1]], power: 320, hits: 3, effect: 'pierce', waveDrain: 8, klass: 'G' },
  { id: 'ga_hollowwinter', name: 'Hollow Winter', element: 'frost', shape: [[0, 0], [1, 0], [1, 1], [2, 1]], power: 240, hits: 4, effect: 'stun', waveDrain: 7, klass: 'G' },
  { id: 'ga_arccathedral', name: 'Arc Cathedral', element: 'volt', shape: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]], power: 300, hits: 5, effect: 'chain', waveDrain: 9, klass: 'G' },
  { id: 'ga_drownedbell', name: 'Drowned Bell', element: 'wave', shape: [[0, 0], [0, 1], [1, 0], [1, 1]], power: 260, hits: 4, effect: 'drain', waveDrain: 6, klass: 'G' },
  { id: 'ga_prismchoir', name: 'Prism Choir', element: 'prism', shape: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]], power: 340, hits: 3, effect: 'pierce', waveDrain: 10, klass: 'G' },
  { id: 'ga_quietdeath', name: 'Quiet Death', element: 'void', shape: [[0, 0], [2, 2], [1, 1]], power: 460, hits: 2, effect: 'none', waveDrain: -5, klass: 'G' },
  // Cross-element triples: these are the ones nobody guesses, which is the point.
  { id: 'ga_staticbloom', name: 'Static Bloom', element: 'volt', shape: [[0, 1], [1, 0], [1, 1], [1, 2]], power: 280, hits: 3, effect: 'stun', waveDrain: 5, klass: 'G' },
  { id: 'ga_lasttrain', name: 'Last Train', element: 'wave', shape: [[0, 0], [0, 1], [0, 2], [0, 3]], power: 220, hits: 6, effect: 'knock', waveDrain: 4, klass: 'G' },
  { id: 'ga_moltenmirror', name: 'Molten Mirror', element: 'burn', shape: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], power: 380, hits: 2, effect: 'pierce', waveDrain: 7, klass: 'G' },
] as const;

export const GA_BY_ID: ReadonlyMap<string, Card> = new Map(GA_CARDS.map((c) => [c.id, c]));

export const CARDS_ALL: readonly Card[] = [
  ...BASIC_CARDS,
  ...CARDS,
  ...SIGNATURE_CARDS,
  ...VOICE_CARDS,
  ...STYLE_CARDS,
  ...FORM_CARDS,
];

/** Every card that can be bought, dropped or born with. Fusion cards are deliberately absent. */
export const CARD_BY_ID: ReadonlyMap<string, Card> = new Map(CARDS_ALL.map((c) => [c.id, c]));

/** Any card the game knows, including the fused ones. */
export function anyCard(id: string): Card | undefined {
  return CARD_BY_ID.get(id) ?? GA_BY_ID.get(id);
}

export const isCardId = (id: string): boolean => CARD_BY_ID.has(id) || GA_BY_ID.has(id);

/** A card a trait granted at birth (accessory, mouth, eyes or base): bound to the token. */
export const isTraitCard = (c: Card): boolean =>
  c.signature !== undefined || c.voice !== undefined || c.style !== undefined || c.base !== undefined;

/** The card a Chog is born holding, or null when its Accessory grants none. */
export const CARD_BY_SIGNATURE: ReadonlyMap<string, Card> = new Map(
  SIGNATURE_CARDS.map((c) => [c.signature as string, c]),
);

/** The cascade sources, keyed by the trait value that grants them. */
export const CARD_BY_MOUTH: ReadonlyMap<string, Card> = new Map(
  VOICE_CARDS.map((c) => [(c.voice as string).toLowerCase(), c]),
);
export const CARD_BY_EYES_STYLE: ReadonlyMap<string, Card> = new Map(
  STYLE_CARDS.map((c) => [c.style as string, c]),
);
export const CARD_BY_BASE: ReadonlyMap<string, Card> = new Map(
  FORM_CARDS.map((c) => [(c.base as string).toLowerCase(), c]),
);
export const card = (id: string): Card => {
  const c = CARD_BY_ID.get(id) ?? GA_BY_ID.get(id);
  if (!c) throw new Error(`unknown card: ${id}`);
  return c;
};

export const ELEMENTS = ['burn', 'frost', 'volt', 'wave', 'prism', 'void'] as const;
