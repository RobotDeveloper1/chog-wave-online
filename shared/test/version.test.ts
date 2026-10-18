import { describe, expect, it } from 'vitest';
import { BUILD_VERSION, GAME_NAME } from '../src/version.ts';

describe('the build label', () => {
  it('is a plain three-part version, so it reads the same everywhere it is printed', () => {
    expect(BUILD_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('names the game the way the player was told', () => {
    expect(GAME_NAME).toBe('CHOG WAVES');
    expect(BUILD_VERSION).toBe('0.0.3');
  });
});
