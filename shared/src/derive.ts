import { CARDS, CARDS_ALL } from './cards.ts';
import { affinityKeys, deckShape, loadoutOf } from './traits.ts';
import {
  ATTRS,
  BASE_BUDGET,
  FOSTER_SHARE_CAP,
  TIER_INDEX,
  affinityAggro,
  affinityDamage,
  affinityOf,
  allocate,
  auditLine,
  capShares,
  critChance,
  gridEdge,
  profileOf,
  provenance,
  usableElements,
  type Attr,
  type Vector,
} from './formula.ts';
import { FOSTER_BASIC_SHARE, basicMight } from './sf/loadout.ts';
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
 * The one card a Chog is born with.
 *
 * This used to be `buildFolder` (old name), which filled 24–34 slots out of the whole catalogue weighted
 * by the attribute profile — so a new player woke up holding a full deck and the first hour of
 * a run had nothing to want. Now it draws exactly one card and stops.
 *
 * **Deterministic on the traits, not rolled.** An earlier version of this kept the old weighted
 * pool draw and simply stopped after one card, which looked right and was not: over 493 tokens
 * it produced *fifteen* distinct cards, with 278 of them landing on three prism commons. One
 * roll off a distribution this peaked has almost no spread left in it. The rule is now stated
 * instead of sampled — the Chog's tribe names the shelf, the shelf is ranked by might, and the
 * attribute profile says how far down it to reach — which makes the born card a *fact about the
 * token* that anyone can recompute, the same promise `audit` already makes about the numbers.
 * Two tokens with the same traits get the same card, and that is the honest answer: without a
 * trait there is nothing to tell them apart.
 *
 * When the Accessory trait supplies a held card, that card is the whole reward of owning the
 * trait and the draw is skipped entirely — diluting it would be a quiet way of making the NFT
 * stop mattering.
 */
function bornCard(loadout: ChogLoadout, attrs: Vector): string | null {
  if (loadout.signature) return loadout.signature;
  const usable = (e: Element) => e !== loadout.weakness;
  // The tribe's own cards, or — if a trait pair left the tribe with nothing to field — the best
  // element that is not the weakness. Never the weakness: a Chog is not born holding the thing
  // it cannot use.
  const shelf = (CARDS.filter((c) => c.element === loadout.element && usable(c.element)).length
    ? CARDS.filter((c) => c.element === loadout.element)
    : CARDS.filter((c) => usable(c.element))
  ).sort((a, b) => b.power * b.hits - a.power * a.hits || a.id.localeCompare(b.id));
  if (!shelf.length) return null;
  return shelf[Math.min(shelf.length - 1, Math.floor(birthQuantile(attrs) * shelf.length))]!.id;
}

/**
 * Where down the shelf a Chog starts, 0..1, from its attribute profile.
 *
 * Prime multipliers, so the six attributes land in six different places instead of summing to
 * one number. This is the only place the born card reads the stats, and it reads them as a
 * position on a ladder rather than as damage — which is what keeps the basic attack free to be
 * the one thing the numbers *do* scale.
 */
function birthQuantile(a: Vector): number {
  const n = (a.PWR * 7 + a.GRD * 13 + a.SPD * 29 + a.SIG * 41 + a.RES * 53 + a.CAP * 61) % 97;
  return n / 97;
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
  // A foster borrows the showcase token's traits, so its shape is capped before the budget is
  // filled: free must not also be the most extreme. A held token keeps its skew whole.
  const raw = profileOf(affinityOf(keys));
  const profile = src.foster ? capShares(raw, FOSTER_SHARE_CAP) : raw;
  const tierIndex = TIER_INDEX[(src.attributes?.Tier ?? 'common').toLowerCase() as keyof typeof TIER_INDEX] ?? 0;
  const budget = BASE_BUDGET + tierIndex * 3;
  const attrs = allocate(profile, budget);
  // …and the basic attack is priced off the **uncapped** one, then cut, because the cap hands
  // the overflow to whatever is still under it and PWR is exactly what the basic attack reads.
  // Measured: a capped Kings Robe / Fire / Legendary came out at 17 against the 16 of the held
  // token it was borrowing, so "free costs you a third of your damage for an hour" was backwards.
  const rawMight = basicMight(allocate(raw, budget));
  const basicMightValue = src.foster ? Math.max(1, Math.floor(rawMight * FOSTER_BASIC_SHARE)) : rawMight;

  // Provenance is the part that cannot be faked: only on-chain history yields these.
  const { affinity: waveAffinity, clean: cleanSignal, ceiling } = provenance(src.transferCount, src.daysHeld);

  const era = 1 - Math.min(1, src.tokenId / GENESIS_SUPPLY);
  const mintAge = src.mintBlock === undefined ? era : clamp01(1 - src.mintBlock / 5_000_000);
  const linkSlots = gridEdge(attrs.CAP, tierIndex) + (mintAge > 0.7 ? 1 : 0) > 5
    ? 5
    : gridEdge(attrs.CAP, tierIndex);

  const born = bornCard(loadout, attrs);

  const signature = loadout.signature ?? born ?? CARDS_ALL[0]!.id;

  return {
    tokenId: src.tokenId,
    audit: auditLine(keys, attrs, budget),
    callsign: `${STYLE_WORDS[loadout.style]} ${ELEMENT_WORDS[loadout.element]} #${String(src.tokenId).padStart(4, '0')}`,
    personality,
    waveAffinity,
    cleanSignal,
    cleanCeiling: ceiling,
    basicMight: basicMightValue,
    attrs,
    damageBonus: affinityDamage(waveAffinity),
    aggroRadius: affinityAggro(waveAffinity),
    crit: critChance(attrs.SIG, cleanSignal),
    linkSlots,
    // A Chog is born holding nothing. The signature is who it is, not what it owns: the Sim pays
    // the first tribe card, the Line drops the next ones, and the first dungeon clear earns the
    // signature itself. Everything is out there to be found, which is what moved the deck out
    // of the token and onto the Line (`line.ts`, `docs/THE-LINE.md`).
    library: [],
    deck: [],
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
