import { describe, expect, it } from 'vitest';

import {
  AFFINITY,
  ATTRS,
  ATTR_MAX,
  ATTR_MIN,
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
} from '../src/formula.ts';
import { affinityKeys, loadoutOf } from '../src/traits.ts';

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

  it('widens the folder with tier, which is where rarity actually lives', () => {
    expect(folderSlots(4)).toBeGreaterThan(folderSlots(0));
    expect(folderSlots(0)).toBe(24);
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
