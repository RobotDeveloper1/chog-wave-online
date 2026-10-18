import type { Element } from './types.ts';

/**
 * The build formula.
 *
 * Traits do not add power — they set a *shape*. Every Chog's six attributes come
 * from a normalised profile that is then filled from a budget, which means a
 * Common and a Legendary with the same traits play identically. Rarity buys
 * breadth (more points to place, more cards allowed), never a higher ceiling on
 * any one number. If it bought raw stats, the 333 Commons would be unplayable and
 * the game's population would be fifty Chogs.
 *
 * Provenance is deliberately outside the picture. Wave Affinity and Clean Signal
 * can only come from on-chain history, they pull against each other by
 * construction, and selling a Chog hands the buyer a loud signal with a reset
 * clock. That is the one coupling a screenshot cannot fake.
 */

export const ATTRS = ['PWR', 'GRD', 'SPD', 'SIG', 'RES', 'CAP'] as const;
export type Attr = (typeof ATTRS)[number];
export type Vector = Record<Attr, number>;

export const ATTR_LABEL: Record<Attr, string> = {
  PWR: 'power',
  GRD: 'guard',
  SPD: 'speed',
  SIG: 'signal',
  RES: 'resonance',
  CAP: 'capacity',
};

const zero = (): Vector => ({ PWR: 0, GRD: 0, SPD: 0, SIG: 0, RES: 0, CAP: 0 });

/**
 * Family -> attribute weights. Written by family rather than per trait value
 * because traits.ts already collapses the 272 values into these keys; a new trait
 * value joins a family and inherits real weight instead of being dead stat text.
 */
export const AFFINITY: Record<string, Partial<Vector>> = {
  // Aura, the tribe.
  burn: { PWR: 2, RES: 1 },
  frost: { GRD: 2, SIG: 1 },
  volt: { SPD: 2, RES: 1 },
  wave: { GRD: 1, SIG: 2 },
  prism: { RES: 2, CAP: 1 },
  void: { PWR: 1, SIG: 2 },
  // Eyes, the lock-on style.
  laser: { PWR: 2, SIG: 1 },
  visor: { SIG: 2 },
  vr: { SPD: 1, SIG: 1 },
  wide: { RES: 2 },
  narrow: { PWR: 1, SIG: 1 },
  tear: { GRD: 1, RES: 1 },
  dead: { GRD: 2, PWR: 1 },
  wild: { SPD: 2, PWR: 1 },
  // Mouth, the voice.
  m_gauge: { SPD: 2 },
  m_crit: { SIG: 2 },
  m_drain: { RES: 1, PWR: 1 },
  m_aggro: { GRD: 1, PWR: 1 },
  m_sneak: { SIG: 1, SPD: 1 },
  m_flat: { GRD: 1, CAP: 1 },
  // Head, the gear.
  g_charge: { SPD: 2 },
  g_hp: { GRD: 2 },
  g_slots: { CAP: 2 },
  g_crit: { SIG: 2 },
  g_guard: { GRD: 1, CAP: 1 },
  g_drain: { PWR: 1, RES: 1 },
  g_speed: { SPD: 1, GRD: 1 },
  // Body, the deck profile.
  f_standard: { CAP: 2, PWR: 1 },
  f_balanced: { CAP: 1, GRD: 1, SPD: 1 },
  f_mega: { PWR: 2, CAP: 1 },
  f_giga: { PWR: 2, RES: 2 },
  f_chaos: { SPD: 2, SIG: 1, RES: 1 },
  // Skin, the resist.
  r_burn: { GRD: 1, PWR: 1 },
  r_frost: { GRD: 2 },
  r_volt: { SPD: 2 },
  r_wave: { GRD: 1, SIG: 1 },
  r_prism: { RES: 2 },
  r_void: { SIG: 2 },
  // Accessory, the held card.
  h_fwog: { GRD: 1, RES: 1 },
  h_knife: { PWR: 3 },
  h_coin: { CAP: 1, SIG: 1 },
  h_heart: { GRD: 2 },
  h_green_candle: { GRD: 1, SPD: 1 },
  h_red_candle: { PWR: 2 },
  h_cigar: { SIG: 1, CAP: 1 },
  h_sb: { RES: 2, SPD: 1 },
  h_pepe: { PWR: 1, RES: 1, SIG: 1 },
  h_none: { CAP: 1 },
  // Background, the native sector.
  s_ashflat: { PWR: 1, GRD: 1 },
  s_voltgrid: { SPD: 1, RES: 1 },
  s_hollow: { GRD: 1, SIG: 1 },
  // Base / Form, the special rule.
  x_none: { CAP: 1 },
  x_undeath: { GRD: 2 },
  x_poison: { PWR: 1, RES: 1 },
  x_pristine: { SPD: 2, SIG: 1 },
  // Side, the stance.
  stance: { SPD: 1 },
};

/** Tier index 0..4 -> the shared budget and the deck's card slots. */
export const TIER_INDEX = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 } as const;
export const BASE_BUDGET = 30;
export const BUDGET_PER_TIER = 3;
export const ATTR_MIN = 2;
export const ATTR_MAX = 10;

/** Raw affinity sum from a trait reading. Unnormalised, so profiles can be compared. */
export function affinityOf(keys: readonly string[]): Vector {
  const out = zero();
  for (const key of keys) {
    const w = AFFINITY[key];
    if (!w) continue;
    for (const [attr, n] of Object.entries(w)) out[attr as Attr] += n as number;
  }
  return out;
}

/** p = a / Σa. The shape, independent of how much of it there was. */
export function profileOf(vec: Vector): Vector {
  const total = ATTRS.reduce((s, a) => s + vec[a], 0) || 1;
  const out = zero();
  for (const a of ATTRS) out[a] = vec[a] / total;
  return out;
}

/**
 * The most any one attribute may take of a **foster** Chog's budget.
 *
 * A foster wears token #1's traits — the showcase skew — without holding anything, and token #1
 * is one of the most extreme shapes in the collection. Uncapped that hands a free visitor the
 * rarest profile on day one, and the collection's whole shape argument becomes decorative: why
 * hold a Legendary for a lean the default already has. A quarter of the budget is the line: eight
 * points against an even spread's five, so a foster still leans and no longer monocultures.
 *
 * This caps the foster path and nothing else. A held token's skew is precisely what rarity buys,
 * and capping that too would flatten every Legendary into a Common — the opposite of the deal.
 */
export const FOSTER_SHARE_CAP = 0.25;

/**
 * Clamp every share of a profile at `cap`, giving the overflow back to whoever still has room.
 *
 * Water-filling: the crowded attributes are pinned at the cap, the surplus is spread over the
 * ones underneath, and if that pushes a new attribute over the cap the next pass pins that too.
 * It terminates because each pass pins strictly more attributes than the last.
 */
export function capShares(profile: Vector, cap: number): Vector {
  const out: Vector = { ...profile };
  for (let pass = 0; pass < ATTRS.length; pass++) {
    let over = 0;
    let open = 0;
    for (const a of ATTRS) {
      if (out[a] > cap) {
        over += out[a] - cap;
        out[a] = cap;
      } else if (out[a] < cap) open += 1;
    }
    // Nothing overflowed, or everything is already pinned — either way there is nothing to hand out.
    if (over <= 1e-9 || open === 0) break;
    for (const a of ATTRS) if (out[a] < cap) out[a] += over / open;
  }
  return out;
}

/**
 * Fill the budget from the profile. Floor and ceiling are applied first, then the
 * rounding drift is paid back out of the attributes with the most unspent share,
 * so the result always sums to the budget exactly and no attribute is ever
 * starved or allowed to run away.
 */
/**
 * Fill the budget from the profile using largest-remainder apportionment.
 *
 * The obvious implementation — floor each share, then hand the leftovers to the
 * biggest attribute — silently breaks the profile: the drift can be several points
 * and they all land on one attribute until it hits the ceiling, so a build that
 * should read PWR 7 / RES 5 comes out with RES pinned at 10. Apportioning by
 * remainder spreads the same leftover across whoever was closest to rounding up,
 * which keeps the shape the normalisation was supposed to express.
 */
export function allocate(profile: Vector, budget: number): Vector {
  const out = zero();
  for (const a of ATTRS) out[a] = ATTR_MIN;
  const left = budget - ATTRS.length * ATTR_MIN;

  const weights = ATTRS.map((a) => ({ a, share: Math.max(0, profile[a]) }));
  const wsum = weights.reduce((s, r) => s + r.share, 0) || 1;

  const exact = weights.map((w) => ({ a: w.a, want: (w.share / wsum) * left }));
  // Clamp on the way in as well as during the drift pass. A heavily skewed profile
  // can ask for more than one attribute is allowed to hold, and that overshoot has
  // to fall back into `drift` for the others instead of punching through the cap.
  for (const e of exact) {
    out[e.a] += Math.max(0, Math.min(ATTR_MAX - ATTR_MIN, Math.floor(e.want)));
  }

  // Give the remaining points to the largest fractional parts first.
  const drift = budget - ATTRS.reduce((s, a) => s + out[a], 0);
  const byRemainder = exact
    .map((e) => ({ a: e.a, rem: e.want - Math.floor(e.want) }))
    .sort((x, y) => y.rem - x.rem || ATTRS.indexOf(x.a) - ATTRS.indexOf(y.a));
  let handed = 0;
  for (let pass = 0; handed < drift && pass < ATTRS.length; pass++) {
    for (const { a } of byRemainder) {
      if (handed >= drift) break;
      if (out[a] >= ATTR_MAX) continue;
      out[a] += 1;
      handed += 1;
    }
  }
  return out;
}

/**
 * The two provenance numbers. They saturate rather than grow without bound, so a
 * whale that flipped forty times is not forty times louder than one that flipped
 * once, and a Chog held for two years stops gaining after 180 days.
 */
export function provenance(transferCount: number, daysHeld = 0) {
  const affinity = 1 - Math.exp(-Math.max(0, transferCount) / 6);
  // Affinity is a ceiling, not a multiplier. Scaling clean by it let a Chog that
  // had been flipped twenty times still reach a perfect signal after long enough,
  // because the days term simply grew past the discount. A loud Chog is loud
  // permanently: buying a famous token buys its noise, and no amount of holding
  // washes it off.
  const ceiling = 1 - 0.9 * affinity;
  const clean = Math.min(ceiling, Math.max(0, daysHeld) / 180);
  return { affinity, clean, ceiling };
}

/** Damage multiplier and aggro radius both scale off the same loud number. */
export const affinityDamage = (affinity: number) => 1 + affinity * 0.8;
export const affinityAggro = (affinity: number) => 1 + affinity * 1.6;
export const critChance = (sig: number, clean: number) =>
  Math.min(0.45, clean * 0.35 + sig * 0.008);

/** Grid edge length. Capacity is the only route to a wider board. */
export function gridEdge(cap: number, tierIndex: number): number {
  return Math.max(3, Math.min(5, 2 + Math.round(cap / 4) + Math.floor(tierIndex / 2)));
}

/**
 * Deck slots used to live here, priced off the Tier: `24 + tier * 2`, so every Chog woke up
 * holding two dozen cards it never chose. They moved to `line.ts slotsFor`, where the size of a
 * deck is something the *world* pays for — two to start, eighteen once the Line is walked —
 * and the token only decides the shape of it. See `docs/THE-LINE.md` §4.4.
 */

/** Which elements this Chog may put cards of. Its own weakness is excluded. */
export function usableElements(element: Element, weakness: Element): Element[] {
  const all: Element[] = ['burn', 'frost', 'volt', 'wave', 'prism', 'void'];
  return all.filter((e) => e !== weakness);
}

/**
 * A one-line audit string. Anyone holding the metadata and the transfer count can
 * recompute a Chog's whole build without running the game, which is the difference
 * between a stat block and a claim.
 */
export function auditLine(keys: readonly string[], attrs: Vector, budget: number): string {
  const shown = ATTRS.map((a) => `${a} ${attrs[a]}`).join(' ');
  return `${keys.length} traits -> ${shown} (budget ${budget})`;
}
