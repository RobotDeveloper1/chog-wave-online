import { describe, expect, it } from 'vitest';
import { SIGNATURE_CARDS } from '../src/cards.ts';
import { cardClass, mightOf } from '../src/sf/card.ts';

/**
 * The nine accessory cards, balanced against each other in level bands.
 *
 * A born card is held from level 1 to the cap, so the band is about role: standards
 * are early-game cards that must never eat the Hand's one mega slot by accident of
 * arithmetic, megas are mid-game spikes, and the one giga sits above every mega.
 * Nothing here scales with level — these numbers are the whole of the promise.
 */
describe('accessory cards — level bands', () => {
  it('holds nine cards, and none of them is dead', () => {
    expect(SIGNATURE_CARDS).toHaveLength(9);
    for (const c of SIGNATURE_CARDS) {
      expect(c.power, `${c.id} power`).toBeGreaterThan(0);
      expect(c.hits, `${c.id} hits`).toBeGreaterThan(0);
    }
  });

  it('keeps every undeclared card a true standard, free in the Hand', () => {
    const stds = SIGNATURE_CARDS.filter((c) => !c.klass);
    expect(stds.length).toBeGreaterThan(0);
    for (const c of stds) {
      expect(mightOf(c), `${c.id} might`).toBeLessThan(200);
      expect(cardClass(c), `${c.id} class`).toBe('standard');
    }
    // Mutually coherent: the best standard does not triple the weakest.
    const mights = stds.map(mightOf);
    expect(Math.max(...mights) / Math.min(...mights)).toBeLessThan(3);
  });

  it('keeps the megas in one mid-game band', () => {
    const megas = SIGNATURE_CARDS.filter((c) => c.klass === 'M');
    expect(megas.length).toBeGreaterThan(0);
    for (const c of megas) {
      expect(mightOf(c), `${c.id} might`).toBeGreaterThanOrEqual(200);
      expect(cardClass(c), `${c.id} class`).toBe('mega');
    }
    const mights = megas.map(mightOf);
    expect(Math.max(...mights) / Math.min(...mights)).toBeLessThan(2);
  });

  it('seats exactly one giga above every mega', () => {
    const gigas = SIGNATURE_CARDS.filter((c) => c.klass === 'G');
    expect(gigas).toHaveLength(1);
    const top = Math.max(...SIGNATURE_CARDS.filter((c) => c.klass === 'M').map(mightOf));
    expect(mightOf(gigas[0]!)).toBeGreaterThan(top);
  });
});
