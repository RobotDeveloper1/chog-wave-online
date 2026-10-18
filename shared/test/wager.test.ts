import { describe, expect, it } from 'vitest';
import { STARTING_CHOG, WAGER_RAKE_BPS, wagerPayout } from '../src/economy.ts';

describe('wagered brawls', () => {
  it('takes five percent of the pot for the team, integer money only', () => {
    expect(WAGER_RAKE_BPS).toBe(500);
    expect(wagerPayout(100)).toEqual({ pot: 200, rake: 10, prize: 190 });
  });

  it('floors the rake down, so the prize is never short a fraction', () => {
    expect(wagerPayout(1)).toEqual({ pot: 2, rake: 0, prize: 2 });
    expect(wagerPayout(3)).toEqual({ pot: 6, rake: 0, prize: 6 });
  });

  it('conserves money: prize plus rake is always the pot', () => {
    for (const stake of [0, 1, 7, 99, 100, 333, 1_000_000]) {
      const { pot, rake, prize } = wagerPayout(stake);
      expect(prize + rake).toBe(pot);
      expect(Number.isInteger(prize)).toBe(true);
      expect(Number.isInteger(rake)).toBe(true);
    }
  });

  it('floors funny stakes at zero instead of paying nonsense', () => {
    expect(wagerPayout(-50)).toEqual({ pot: 0, rake: 0, prize: 0 });
    expect(wagerPayout(10.9)).toEqual(wagerPayout(10));
  });

  it('seeds every token with paper money until deposits exist', () => {
    expect(STARTING_CHOG).toBe(1000);
  });
});
