import { CHIPS, CHIPS_ALL } from './chips.ts';
import { affinityKeys, folderShape, loadoutOf } from './traits.ts';
import {
  ATTRS,
  BASE_BUDGET,
  TIER_INDEX,
  affinityAggro,
  affinityDamage,
  affinityOf,
  allocate,
  auditLine,
  critChance,
  folderSlots,
  gridEdge,
  profileOf,
  provenance,
  usableElements,
  type Attr,
  type Vector,
} from './formula.ts';
import type { ChogBuild, ChogLoadout, ChogSource, Element, Personality } from './types.ts';

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Total Chog Genesis supply — used to date a token by its mint number. */
export const GENESIS_SUPPLY = 1969;

const ELEMENT_WORDS: Record<Element, string> = {
  burn: 'Cinder',
  frost: 'Hoar',
  volt: 'Static',
  wave: 'Undertow',
  prism: 'Prism',
  void: 'Null',
};

const STYLE_WORDS = {
  laser: 'Lanced',
  visor: 'Visored',
  vr: 'Immersed',
  wide: 'Wideeye',
  narrow: 'Squint',
  tear: 'Weeping',
  dead: 'Hollow',
  wild: 'Feral',
} as const;

/**
 * The folder a Chog is born with. Every line of it is a trait:
 *
 * - Aura sets the tribe, and most of the deck speaks it
 * - Skin sets a resist, and part of the deck is that element's card
 * - Accessory supplies one held card nobody else can hold
 * - Body decides how many copies of one card fit, so a plain shirt stacks
 *   five Embers while a Kings Robe is allowed exactly two heavy hitters
 * - Tier caps Mega and Giga copies, which is the rarity economy
 *
 * Distinct cards are drawn first and only then stacked, because the Custom Screen
 * draws 6 candidates from the folder: a folder of three cards repeated ten times
 * would always show the same six. The tokenId breaks ties inside those
 * constraints, so two Chogs with the same traits feel alike and two different
 * traits genuinely play differently.
 */
function buildFolder(
  loadout: ChogLoadout,
  rand: () => number,
  attrs: Vector,
  usable: Element[],
  slots: number,
): string[] {
  const shape = { ...folderShape(loadout.profile), size: slots };
  const of = (e: Element) => CHIPS.filter((c) => c.element === e);
  // Each element's share of the deck follows the attribute profile, so the traits
  // that made this Chog resonant also give it the cards to express that — and the
  // weakness element is absent from `usable`, so it can never appear here.
  const ELEMENT_ATTR: Record<Element, Attr> = {
    burn: 'PWR', frost: 'GRD', volt: 'SPD', wave: 'SIG', prism: 'RES', void: 'CAP',
  };
  const weighted: { pool: typeof CHIPS; weight: number }[] = (
    ['burn', 'frost', 'volt', 'wave', 'prism', 'void'] as Element[]
  )
    .filter((e) => usable.includes(e))
    .map((e) => ({ pool: of(e), weight: 1 + attrs[ELEMENT_ATTR[e]] * (e === loadout.element ? 1.5 : 0.5) }));
  const held = loadout.signature ? [loadout.signature] : [];

  // 1. Distinct picks, biased toward the tribe.
  const total = weighted.reduce((s, w) => s + w.weight * w.pool.length, 0);
  const distinctTarget = Math.min(
    12,
    Math.max(6, Math.ceil(shape.size / Math.max(1, shape.copies)) + 4),
  );
  const distinct: string[] = [...held];
  const seen = new Set(distinct);
  let guard = 0;
  while (seen.size < distinctTarget && guard++ < 400) {
    let roll = rand() * total;
    let chosen: string | undefined;
    for (const { pool, weight } of weighted) {
      const span = weight * pool.length;
      if (roll < span && pool.length) {
        chosen = pool[Math.floor((roll / span) * pool.length)]!.id;
        break;
      }
      roll -= span;
    }
    if (chosen && !seen.has(chosen)) {
      seen.add(chosen);
      distinct.push(chosen);
    }
  }

  // 2. Expand to the folder size, honouring copies-per-card and the Tier caps.
  const byId = new Map(CHIPS_ALL.map((c) => [c.id, c]));
  const order = [...distinct];
  const out: string[] = [];
  const copies = new Map<string, number>();
  let mega = 0;
  let giga = 0;
  let cursor = 0;
  while (out.length < shape.size && cursor < shape.size * 4) {
    const id = order[cursor % order.length]!;
    cursor++;
    const chip = byId.get(id);
    if (!chip) continue;
    if ((copies.get(id) ?? 0) >= shape.copies) continue;
    if (chip.klass === 'G' && giga >= loadout.gigaCap) continue;
    if (chip.klass === 'M' && mega >= loadout.megaCap) continue;
    if (chip.klass === 'G') giga++;
    else if (chip.klass === 'M') mega++;
    copies.set(id, (copies.get(id) ?? 0) + 1);
    out.push(id);
  }
  return out;
}

export function deriveBuild(src: ChogSource): ChogBuild {
  const rand = mulberry32(fnv1a(`chog:${src.tokenId}`));
  const loadout = loadoutOf(src.attributes);
  const hasTraits = Object.keys(src.attributes ?? {}).length > 0;

  const personality: Personality = {
    aggression: rand(),
    skittish: rand(),
    curiosity: rand(),
    stamina: rand(),
  };

  // The formula: traits set the shape, tier sets the budget, provenance is overlaid.
  const keys = affinityKeys(loadout, src.attributes);
  const profile = profileOf(affinityOf(keys));
  const tierIndex = TIER_INDEX[(src.attributes?.Tier ?? 'common').toLowerCase() as keyof typeof TIER_INDEX] ?? 0;
  const budget = BASE_BUDGET + tierIndex * 3;
  const attrs = allocate(profile, budget);

  // Provenance is the part that cannot be faked: only on-chain history yields these.
  const { affinity: waveAffinity, clean: cleanSignal, ceiling } = provenance(src.transferCount, src.daysHeld);

  const era = 1 - Math.min(1, src.tokenId / GENESIS_SUPPLY);
  const mintAge = src.mintBlock === undefined ? era : clamp01(1 - src.mintBlock / 5_000_000);
  const linkSlots = gridEdge(attrs.CAP, tierIndex) + (mintAge > 0.7 ? 1 : 0) > 5
    ? 5
    : gridEdge(attrs.CAP, tierIndex);

  const folder = buildFolder(loadout, rand, attrs, usableElements(loadout.element, loadout.weakness), folderSlots(tierIndex));
  const strongest = (ids: string[]) =>
    ids.reduce(
      (best, id) => {
        const c = CHIPS_ALL.find((x) => x.id === id)!;
        return c.power * c.hits > best.power * best.hits ? c : best;
      },
      CHIPS_ALL.find((x) => x.id === ids[0])!,
    );

  const signature = loadout.signature ?? strongest(folder).id;

  return {
    tokenId: src.tokenId,
    audit: auditLine(keys, attrs, budget),
    callsign: `${STYLE_WORDS[loadout.style]} ${ELEMENT_WORDS[loadout.element]} #${String(src.tokenId).padStart(4, '0')}`,
    personality,
    waveAffinity,
    cleanSignal,
    cleanCeiling: ceiling,
    attrs,
    damageBonus: affinityDamage(waveAffinity),
    aggroRadius: affinityAggro(waveAffinity),
    crit: critChance(attrs.SIG, cleanSignal),
    linkSlots,
    library: [...new Set([signature, ...folder])],
    folder,
    signature,
    hasTraits,
    loadout,
  };
}

/** One-line readout for the HUD — the clarity the judges score. */
export function describeBuild(b: ChogBuild): string[] {
  const role =
    b.waveAffinity > 0.66 ? 'VEINLICKER — anomalies hunt you, and you hurt them back'
    : b.cleanSignal > 0.5 ? 'CLEAN SIGNAL — unseen until it lands'
    : 'DRIFTER — reads the market, not the fight';
  return [
    role,
    `link slots ${b.linkSlots}x${b.linkSlots} · tribe ${b.loadout.element} · weak to ${b.loadout.weakness}`,
    `wave affinity ${(b.waveAffinity * 100) | 0}% · clean signal ${(b.cleanSignal * 100) | 0}%`,
    b.hasTraits
      ? `build read off on-chain traits: ${b.loadout.why.slice(0, 3).join(' · ')}`
      : 'build derived from provenance (no trait metadata)',
  ];
}
