import type { Chip } from './types.ts';

const S = {
  dot: [[0, 0]] as const,
  h2: [[0, 0], [0, 1]] as const,
  v2: [[0, 0], [1, 0]] as const,
  bar3: [[0, 0], [0, 1], [0, 2]] as const,
  l: [[0, 0], [1, 0], [1, 1]] as const,
  sq: [[0, 0], [0, 1], [1, 0], [1, 1]] as const,
  plus: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] as const,
};

export const CHIPS: readonly Chip[] = [
  // burn — fast, low coverage, stacks resonance cheaply
  { id: 'emberpaw', name: 'Emberpaw', element: 'burn', shape: S.dot, power: 90, hits: 1, effect: 'none', waveDrain: 1 },
  { id: 'cinderfang', name: 'Cinder Fang', element: 'burn', shape: S.l, power: 70, hits: 2, effect: 'knock', waveDrain: 2 },
  { id: 'magmachog', name: 'Magma Chog', element: 'burn', shape: S.bar3, power: 130, hits: 3, effect: 'pierce', waveDrain: 4, klass: 'M' },

  // frost — control
  { id: 'rimeclaw', name: 'Rimeclaw', element: 'frost', shape: S.dot, power: 70, hits: 1, effect: 'stun', waveDrain: 1 },
  { id: 'hoarbar', name: 'Hoarbar', element: 'frost', shape: S.v2, power: 95, hits: 2, effect: 'stun', waveDrain: 2 },
  { id: 'glacierhowl', name: 'Glacier Howl', element: 'frost', shape: S.plus, power: 110, hits: 4, effect: 'stun', waveDrain: 5, klass: 'M' },

  // volt — burst, drains the wave hardest
  { id: 'staticnip', name: 'Static Nip', element: 'volt', shape: S.dot, power: 80, hits: 1, effect: 'chain', waveDrain: 2 },
  { id: 'arcsnap', name: 'Arc Snap', element: 'volt', shape: S.h2, power: 120, hits: 2, effect: 'chain', waveDrain: 3 },
  { id: 'stormchomp', name: 'Storm Chomp', element: 'volt', shape: S.sq, power: 150, hits: 3, effect: 'pierce', waveDrain: 6, klass: 'M' },

  // wave — sustain and recovery
  { id: 'undertow', name: 'Undertow', element: 'wave', shape: S.dot, power: 60, hits: 1, effect: 'drain', waveDrain: 1 },
  { id: 'ripplebite', name: 'Ripple Bite', element: 'wave', shape: S.h2, power: 85, hits: 3, effect: 'drain', waveDrain: 2 },
  { id: 'tsunamichog', name: 'Tsunami Chog', element: 'wave', shape: S.sq, power: 120, hits: 4, effect: 'knock', waveDrain: 4, klass: 'M' },

  // prism — the resonance catalyst
  { id: 'refract', name: 'Refract', element: 'prism', shape: S.dot, power: 75, hits: 1, effect: 'none', waveDrain: 1 },
  { id: 'spectrum', name: 'Spectrum', element: 'prism', shape: S.l, power: 100, hits: 2, effect: 'pierce', waveDrain: 3 },
  { id: 'chognova', name: 'Chog Nova', element: 'prism', shape: S.plus, power: 160, hits: 3, effect: 'pierce', waveDrain: 7, klass: 'G' },

  // void — high cost, punishes your own wave affinity
  { id: 'nullfur', name: 'Null Fur', element: 'void', shape: S.dot, power: 140, hits: 1, effect: 'none', waveDrain: -1 },
  { id: 'eclipse', name: 'Eclipse', element: 'void', shape: S.v2, power: 175, hits: 2, effect: 'pierce', waveDrain: -2 },
  { id: 'signaldeath', name: 'Signal Death', element: 'void', shape: S.bar3, power: 240, hits: 2, effect: 'stun', waveDrain: -4, klass: 'G' },
] as const;

/**
 * Held-item cards. One per Accessory trait value, so owning the Chog is the only
 * way to hold its card — this is the trait→card coupling the collection makes
 * real. These are the cards a player *notices*: each one breaks a rule the 18
 * core chips obey.
 */
export const SIGNATURE_CHIPS: readonly Chip[] = [
  { id: 'fwog_buddy', name: 'Fwog Buddy', element: 'wave', shape: S.dot, power: 40, hits: 1, effect: 'drain', waveDrain: 1, signature: 'Fwog' },
  { id: 'switchblade', name: 'Switchblade', element: 'void', shape: S.dot, power: 260, hits: 1, effect: 'pierce', waveDrain: -2, klass: 'M', signature: 'Knife' },
  { id: 'lucky_coin', name: 'Lucky Coin', element: 'prism', shape: S.dot, power: 0, hits: 0, effect: 'none', waveDrain: 0, signature: 'Coin' },
  { id: 'hot_heart', name: 'Hot Heart', element: 'burn', shape: S.v2, power: 90, hits: 2, effect: 'drain', waveDrain: 2, signature: 'Heart' },
  { id: 'green_candle', name: 'Green Candle', element: 'frost', shape: S.sq, power: 60, hits: 4, effect: 'stun', waveDrain: 3, signature: 'Green Candle' },
  { id: 'red_candle', name: 'Red Candle', element: 'burn', shape: S.sq, power: 150, hits: 4, effect: 'none', waveDrain: 5, klass: 'M', signature: 'Red Candle' },
  { id: 'cigar_steady', name: 'Cigar Steady', element: 'volt', shape: S.h2, power: 110, hits: 2, effect: 'chain', waveDrain: 2, signature: 'Cigar' },
  { id: 'sb_signal', name: 'SB Signal', element: 'prism', shape: S.bar3, power: 130, hits: 3, effect: 'pierce', waveDrain: 4, klass: 'G', signature: 'SB' },
  { id: 'pepe_curse', name: 'Pepe Curse', element: 'void', shape: S.plus, power: 180, hits: 5, effect: 'knock', waveDrain: -3, klass: 'M', signature: 'PEPE' },
] as const;

/**
 * Voice cards, granted by the Mouth trait. Only 9% of the collection carries an
 * Accessory, so without a second source the marquee "a card only your Chog holds"
 * would be missing for the other 91%.
 */
export const VOICE_CHIPS: readonly Chip[] = [
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
export const STYLE_CHIPS: readonly Chip[] = [
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
export const FORM_CHIPS: readonly Chip[] = [
  { id: 'b_origin', name: 'Origin Chime', element: 'burn', shape: S.dot, power: 90, hits: 1, effect: 'none', waveDrain: 1, klass: 'S', base: 'Origin' },
  { id: 'b_skull', name: 'Skull Return', element: 'void', shape: S.v2, power: 135, hits: 1, effect: 'none', waveDrain: -1, klass: 'M', base: 'Skull' },
  { id: 'b_radio', name: 'Radioactive Bloom', element: 'frost', shape: S.sq, power: 120, hits: 3, effect: 'stun', waveDrain: 5, klass: 'M', base: 'Radioactive' },
  { id: 'b_one', name: 'One of One', element: 'prism', shape: S.dot, power: 200, hits: 1, effect: 'pierce', waveDrain: 6, klass: 'G', base: '1:1' },
] as const;

/**
 * The heavy cards fusion produces (see fusion.ts). Not purchasable, not droppable: a Chog
 * earns one by firing its recipe once. They live here, not in fusion.ts, so that `chip()`
 * can resolve them — a card in a folder must be a card the rest of the game can read.
 */
export const GA_CHIPS: readonly Chip[] = [
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

export const GA_BY_ID: ReadonlyMap<string, Chip> = new Map(GA_CHIPS.map((c) => [c.id, c]));

export const CHIPS_ALL: readonly Chip[] = [
  ...CHIPS,
  ...SIGNATURE_CHIPS,
  ...VOICE_CHIPS,
  ...STYLE_CHIPS,
  ...FORM_CHIPS,
];

/** Every card that can be bought, dropped or born with. Fusion cards are deliberately absent. */
export const CHIP_BY_ID: ReadonlyMap<string, Chip> = new Map(CHIPS_ALL.map((c) => [c.id, c]));

/** Any card the game knows, including the fused ones. */
export function anyChip(id: string): Chip | undefined {
  return CHIP_BY_ID.get(id) ?? GA_BY_ID.get(id);
}

export const isChipId = (id: string): boolean => CHIP_BY_ID.has(id) || GA_BY_ID.has(id);

/** The card a Chog is born holding, or null when its Accessory grants none. */
export const CHIP_BY_SIGNATURE: ReadonlyMap<string, Chip> = new Map(
  SIGNATURE_CHIPS.map((c) => [c.signature as string, c]),
);

/** The cascade sources, keyed by the trait value that grants them. */
export const CHIP_BY_MOUTH: ReadonlyMap<string, Chip> = new Map(
  VOICE_CHIPS.map((c) => [(c.voice as string).toLowerCase(), c]),
);
export const CHIP_BY_EYES_STYLE: ReadonlyMap<string, Chip> = new Map(
  STYLE_CHIPS.map((c) => [c.style as string, c]),
);
export const CHIP_BY_BASE: ReadonlyMap<string, Chip> = new Map(
  FORM_CHIPS.map((c) => [(c.base as string).toLowerCase(), c]),
);
export const chip = (id: string): Chip => {
  const c = CHIP_BY_ID.get(id) ?? GA_BY_ID.get(id);
  if (!c) throw new Error(`unknown chip: ${id}`);
  return c;
};

export const ELEMENTS = ['burn', 'frost', 'volt', 'wave', 'prism', 'void'] as const;
