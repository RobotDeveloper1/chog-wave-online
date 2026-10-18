import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { TRAIT_TABLES, WEAK_TO, deckShape, loadoutOf, matchup } from '../src/traits.ts';
import { matchup as sfMatchup } from '../src/sf/element.ts';
import type { Element } from '../src/types.ts';
import { ELEMENTS } from '../src/cards.ts';

/**
 * The scraped trait vocabulary is the spec for traits.ts. Reading it from the
 * data file rather than restating it means a newly discovered trait value fails
 * here instead of silently falling back to prism/wide/standard in production.
 */
const scraped = JSON.parse(
  readFileSync(new URL('../../.data/traits.json', import.meta.url), 'utf8'),
) as Record<string, { distinct: number; values: Record<string, number> }>;

const norm = (v: string) => v.trim().toLowerCase();

describe('trait coverage', () => {
  for (const [category, info] of Object.entries(scraped)) {
    it(`maps every ${category} value (${info.distinct})`, () => {
      const table = TRAIT_TABLES[category as keyof typeof TRAIT_TABLES];
      expect(table, `no table for category ${category}`).toBeTruthy();
      const missing = Object.keys(info.values).filter((v) => !table?.[norm(v)]);
      expect(missing, `unmapped ${category}: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('has no value listed in two outcomes', () => {
    // invert() throws on a duplicate, so simply building the module is the test.
    expect(() => loadoutOf({ Aura: 'Fire' })).not.toThrow();
  });
});

describe('loadout derivation', () => {
  const full = {
    Aura: 'Fire',
    Eyes: 'Purple laser',
    Body: 'Tuxedo',
    Head: 'Crown',
    Mouth: 'Rainbow Puke',
    Accessory: 'Knife',
    Skin: 'Red',
    Background: 'Lemon',
    Tier: 'Rare',
    Base: 'Origin',
    Form: 'Chog',
    Side: 'Left',
    Naked: 'No',
  };

  it('reads element, style, held card and deck shape off the traits', () => {
    const l = loadoutOf(full);
    expect(l.element).toBe('burn');
    expect(l.style).toBe('laser');
    expect(l.signature).toBe('switchblade');
    expect(l.profile).toBe('mega');
    expect(l.gear).toBe('hp');
    expect(l.resist).toBe('burn');
    expect(l.nativeSector).toBe('ashflat');
    expect(l.stance).toBe('left');
    expect(l.megaCap).toBe(3);
    expect(l.gigaCap).toBe(1);
  });

  it('gives the mouth a voice that bends combat numbers', () => {
    expect(loadoutOf(full).voice).toMatchObject({ aggro: 0.35, drainPct: 20 });
  });

  it('never throws and always yields a legal element when metadata is absent', () => {
    for (const attrs of [undefined, {}, { Aura: 'Never Seen Before' }]) {
      const l = loadoutOf(attrs as Record<string, string>);
      expect(ELEMENTS).toContain(l.element);
      expect(WEAK_TO[l.element]).toBeTruthy();
    }
  });

  it('explains itself for the inspect panel', () => {
    const why = loadoutOf(full).why.join(' · ');
    expect(why).toContain('burn');
    expect(why).toContain('Switchblade');
  });
});

describe('element ring', () => {
  it('never makes an element weak to itself', () => {
    for (const e of ELEMENTS) expect(WEAK_TO[e]).not.toBe(e);
  });

  it('closes a 4-cycle for the battle elements', () => {
    const walk = (from: Element, steps: number) => {
      let e = from;
      for (let i = 0; i < steps; i++) e = WEAK_TO[e];
      return e;
    };
    for (const e of ['burn', 'wave', 'volt', 'frost'] as Element[]) {
      expect(walk(e, 4)).toBe(e);
      expect(walk(e, 2)).not.toBe(e);
    }
  });

  it('keeps prism and void as a deliberate mutual-weakness pair', () => {
    expect(WEAK_TO.prism).toBe('void');
    expect(WEAK_TO.void).toBe('prism');
  });

  it('doubles damage only for the attacker holding the matching element', () => {
    expect(matchup('burn', 'wave')).toBe(2);
    expect(matchup('wave', 'burn')).toBe(0.5);
    expect(matchup('burn', 'burn')).toBe(1);
    expect(matchup('volt', 'burn')).toBe(1);
  });

  it('agrees with the combat table on every cycle pairing', () => {
    // Two matchup tables diverged once — wave dealt double to burn on paper and half on
    // the field — and every deck ban in the game followed the wrong one. This is the lock
    // that keeps them one table.
    for (const a of ['burn', 'wave', 'volt', 'frost'] as Element[]) {
      for (const d of ['burn', 'wave', 'volt', 'frost'] as Element[]) {
        expect(matchup(a, d), `${a} into ${d}`).toBe(sfMatchup(a, d));
      }
    }
  });
});

describe('deck shape', () => {
  it('shrinks duplicate allowance as rarity class rises', () => {
    expect(deckShape('standard').copies).toBeGreaterThan(deckShape('giga').copies);
    for (const p of ['standard', 'balanced', 'mega', 'giga', 'chaos'] as const) {
      expect(deckShape(p).size).toBeGreaterThanOrEqual(30);
    }
  });
});
