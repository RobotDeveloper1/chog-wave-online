import { describe, expect, it } from 'vitest';

import {
  AFFINITY,
  ATTRS,
  ATTR_MAX,
  ATTR_MIN,
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
  type Vector,
} from '../src/formula.ts';
import { affinityKeys, loadoutOf } from '../src/traits.ts';
import * as formula from '../src/formula.ts';
import { deriveBuild } from '../src/derive.ts';

/** The trait families a real reading produces, in the order the formula wants. */
function familiesOf(attrs: Record<string, string>): string[] {
  return affinityKeys(loadoutOf(attrs), attrs);
}

const SAMPLE = {
  Aura: 'Fire',
  Eyes: 'Purple laser',
  Head: 'Crown',
  Body: 'Tuxedo',
  Skin: 'Red',
  Accessory: 'Knife',
  Background: 'Lemon',
  Base: 'Origin',
  Form: 'Chog',
  Side: 'Left',
  Tier: 'Common',
  Mouth: 'Sad',
  Naked: 'No',
};

describe('profile normalisation', () => {
  it('sums to one, so a profile is a shape and not a score', () => {
    const p = profileOf(affinityOf(familiesOf(SAMPLE)));
    expect(ATTRS.reduce((s, a) => s + p[a], 0)).toBeCloseTo(1, 6);
  });

  it('gives a Common and a Legendary the same shape from the same traits', () => {
    const common = profileOf(affinityOf(familiesOf({ ...SAMPLE, Tier: 'Common' })));
    const legendary = profileOf(affinityOf(familiesOf({ ...SAMPLE, Tier: 'Legendary' })));
    for (const a of ATTRS) expect(common[a]).toBe(legendary[a]);
  });

  it('is not all zero for any legal reading', () => {
    const v = affinityOf(familiesOf(SAMPLE));
    expect(ATTRS.some((a) => v[a] > 0)).toBe(true);
  });
});

describe('budget allocation', () => {
  it('always spends the budget exactly', () => {
    for (const tier of Object.keys(TIER_INDEX)) {
      const budget = BASE_BUDGET + TIER_INDEX[tier as keyof typeof TIER_INDEX] * 3;
      const out = allocate(profileOf(affinityOf(familiesOf(SAMPLE))), budget);
      expect(ATTRS.reduce((s, a) => s + out[a], 0)).toBe(budget);
    }
  });

  it('never starves or inflates an attribute past its floor and ceiling', () => {
    const skewed = allocate({ PWR: 0.97, GRD: 0.006, SPD: 0.006, SIG: 0.006, RES: 0.006, CAP: 0.006 }, 42);
    for (const a of ATTRS) {
      expect(skewed[a]).toBeGreaterThanOrEqual(ATTR_MIN);
      expect(skewed[a]).toBeLessThanOrEqual(ATTR_MAX);
    }
    expect(ATTRS.reduce((s, a) => s + skewed[a], 0)).toBe(42);
  });

  it('keeps every attribute at the same ceiling regardless of tier', () => {
    const budgetFor = (tier: string) => BASE_BUDGET + TIER_INDEX[tier as keyof typeof TIER_INDEX] * 3;
    const common = allocate(profileOf(affinityOf(familiesOf(SAMPLE))), budgetFor('common'));
    const legend = allocate(profileOf(affinityOf(familiesOf(SAMPLE))), budgetFor('legendary'));
    for (const a of ATTRS) expect(legend[a]).toBeLessThanOrEqual(ATTR_MAX);
    // The legendary has more total points but cannot exceed the same cap per stat.
    expect(ATTRS.reduce((s, a) => s + legend[a], 0)).toBeGreaterThan(
      ATTRS.reduce((s, a) => s + common[a], 0),
    );
  });

  it('concentrates points where the traits point', () => {
    const out = allocate(profileOf(affinityOf(familiesOf(SAMPLE))), 36);
    // Knife is PWR-heavy and laser eyes add PWR, so power should lead this build.
    expect(out.PWR).toBeGreaterThanOrEqual(out.GRD);
  });
});

describe('the foster cap', () => {
  const even = (): Vector => ({ PWR: 1 / 6, GRD: 1 / 6, SPD: 1 / 6, SIG: 1 / 6, RES: 1 / 6, CAP: 1 / 6 });

  /**
   * A showcase-style monoculture, built from real trait values: every category that can point at
   * SIG does. Raw affinity 11 of 18 — a share of 0.61 against an even spread's 0.17, which is the
   * shape the cap exists to refuse a visitor.
   */
  const MONOCULTURE = {
    Aura: 'Purple',           // void  → SIG 2, PWR 1
    Eyes: 'Sunset visor',     // visor → SIG 2
    Head: 'Red Headband',     // crit  → SIG 2
    Skin: 'Black',            // void  → SIG 2
    Background: 'Aqua',       // hollow→ SIG 1, GRD 1
    Body: 'Banana suit',      // chaos → SIG 1, SPD 2, RES 1
    Accessory: 'cigar_steady',// h_cigar → SIG 1, CAP 1
  };

  it('leaves a spread that already fits alone', () => {
    const out = capShares(even(), FOSTER_SHARE_CAP);
    for (const a of ATTRS) expect(out[a]).toBeCloseTo(1 / 6, 10);
  });

  it('pins the crowded attribute at the cap and hands the rest to whoever has room', () => {
    // A showcase-style monoculture: one attribute at ninety percent.
    const out = capShares({ PWR: 0.9, GRD: 0.02, SPD: 0.02, SIG: 0.02, RES: 0.02, CAP: 0.02 }, FOSTER_SHARE_CAP);
    for (const a of ATTRS) expect(out[a]).toBeLessThanOrEqual(FOSTER_SHARE_CAP + 1e-9);
    expect(out.PWR).toBeCloseTo(FOSTER_SHARE_CAP, 10);
    // Still a distribution: the cap takes from the leader, it does not create points.
    expect(ATTRS.reduce((s, a) => s + out[a], 0)).toBeCloseTo(1, 10);
  });

  it('terminates when several attributes are over the cap', () => {
    const out = capShares({ PWR: 0.4, GRD: 0.3, SPD: 0.3, SIG: 0, RES: 0, CAP: 0 }, FOSTER_SHARE_CAP);
    for (const a of ATTRS) expect(out[a]).toBeLessThanOrEqual(FOSTER_SHARE_CAP + 1e-9);
    expect(ATTRS.reduce((s, a) => s + out[a], 0)).toBeCloseTo(1, 10);
  });

  it('holds the shape under the cap through a real foster build', () => {
    const foster = deriveBuild({
      tokenId: 900_001,
      transferCount: 0,
      daysHeld: 0,
      attributes: MONOCULTURE,
      foster: true,
    });
    expect(foster.hasTraits).toBe(true);
    expect(ATTRS.reduce((s, a) => s + foster.attrs[a], 0)).toBe(BASE_BUDGET);
    // 25% of the budget in points, rounded up by the apportionment.
    const ceiling = Math.ceil(BASE_BUDGET * FOSTER_SHARE_CAP);
    for (const a of ATTRS) {
      expect(foster.attrs[a]).toBeLessThanOrEqual(ATTR_MAX);
      expect(foster.attrs[a]).toBeLessThanOrEqual(ceiling);
    }
  });

  it('does not cap a held token — the skew is what rarity buys', () => {
    const held = deriveBuild({ tokenId: 1, transferCount: 0, daysHeld: 0, attributes: MONOCULTURE });
    const foster = deriveBuild({
      tokenId: 900_002,
      transferCount: 0,
      daysHeld: 0,
      attributes: MONOCULTURE,
      foster: true,
    });
    // Same traits, same budget: the only difference is the cap, and it must actually bite.
    expect(ATTRS.reduce((s, a) => s + held.attrs[a], 0)).toBe(BASE_BUDGET);
    expect(held.attrs.SIG).toBeGreaterThan(foster.attrs.SIG);
    expect(held.attrs.SIG).toBeGreaterThan(Math.ceil(BASE_BUDGET * FOSTER_SHARE_CAP));
    // A foster is not a cripple either — it still leans toward the shape it was capped into.
    expect(foster.attrs.SIG).toBe(Math.max(...ATTRS.map((a) => foster.attrs[a])));
    expect(foster.attrs.SIG).toBeGreaterThan(Math.ceil(BASE_BUDGET / ATTRS.length));
  });
});

describe('provenance', () => {
  it('saturates rather than growing without bound', () => {
    expect(provenance(400, 0).affinity).toBeLessThan(1.000001);
    expect(provenance(1).affinity).toBeLessThan(provenance(2).affinity);
    expect(provenance(0).affinity).toBe(0);
  });

  it('trades off: a heavily flipped Chog can never read clean, however long it is held', () => {
    const flipped = provenance(20, 4000);
    const hoarded = provenance(0, 400);
    expect(flipped.affinity).toBeGreaterThan(0.9);
    // Twenty flips put affinity at 0.964, so the ceiling is ~0.13.
    expect(flipped.clean).toBeLessThan(0.15);
    expect(hoarded.clean).toBe(1);
  });

  it('publishes the ceiling so the inspect panel can say why a Chog is capped', () => {
    expect(provenance(0).ceiling).toBe(1);
    expect(provenance(20).ceiling).toBeLessThan(0.15);
  });

  it('stops accruing after the hold window', () => {
    expect(provenance(0, 180).clean).toBeCloseTo(provenance(0, 900).clean, 5);
  });

  it('makes a loud Chog hit harder and pull more aggro, both from one number', () => {
    expect(affinityDamage(1)).toBe(1.8);
    expect(affinityDamage(0)).toBe(1);
    expect(affinityAggro(1)).toBeGreaterThan(affinityAggro(0));
  });
});

describe('derived combat numbers', () => {
  it('caps crit so no build becomes unconditional', () => {
    expect(critChance(10, 1)).toBeLessThanOrEqual(0.45);
    expect(critChance(0, 0)).toBe(0);
  });

  it('keeps the grid between three and five wide', () => {
    expect(gridEdge(2, 0)).toBeGreaterThanOrEqual(3);
    expect(gridEdge(10, 4)).toBeLessThanOrEqual(5);
  });

  it('no longer prices deck size off the Tier — the world does that now', () => {
    // `folderSlots(tier) = 24 + tier * 2` meant a Chog woke up holding two dozen cards it
    // never chose. Rarity still widens a deck — through `deckShape`'s copies and the
    // Mega/Giga caps the Tier sets — but it no longer decides how big it is. See
    // `docs/THE-LINE.md` §4.4 and `line.ts slotsFor`.
    expect(formula).not.toHaveProperty('folderSlots');
  });

  it('bans the weakness element from the deck', () => {
    const usable = usableElements('burn', 'wave');
    expect(usable).not.toContain('wave');
    expect(usable).toContain('burn');
    expect(usable).toHaveLength(5);
  });
});

describe('auditability', () => {
  it('names every attribute and the budget it was drawn from', () => {
    const line = auditLine(familiesOf(SAMPLE), allocate(profileOf(affinityOf(familiesOf(SAMPLE))), 33), 33);
    for (const a of ATTRS) expect(line).toContain(a);
    expect(line).toContain('budget 33');
  });

  it('has a weight entry for every family the trait tables can produce', () => {
    for (const family of familiesOf(SAMPLE)) {
      expect(AFFINITY[family], `family ${family} has no weights`).toBeTruthy();
    }
  });
});
