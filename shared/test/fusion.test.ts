import { describe, expect, it } from 'vitest';

import {
  RECIPES,
  RECIPE_BY_RESULT,
  describeRecipe,
  emptyLibrary,
  findRecipe,
  libraryLine,
  resolveTurn,
} from '../src/fusion.ts';
import { CHIP_BY_ID, GA_BY_ID, anyChip, chip } from '../src/chips.ts';

describe('recipe data', () => {
  it('every ingredient is a real card and every result is a real heavy card', () => {
    for (const r of RECIPES) {
      for (const id of r.needs) expect(CHIP_BY_ID.has(id), `${r.id} needs ${id}`).toBe(true);
      expect(GA_BY_ID.has(r.result), `${r.id} -> ${r.result}`).toBe(true);
      expect(r.hint.length).toBeGreaterThan(8);
    }
  });

  it('has one result per recipe, so learning cannot hand out the same card twice', () => {
    const results = RECIPES.map((r) => r.result);
    expect(new Set(results).size).toBe(results.length);
    expect(RECIPE_BY_RESULT.size).toBe(results.length);
  });

  it('is reachable for every element, so no tribe is locked out of fusion', () => {
    for (const e of ['burn', 'frost', 'volt', 'wave', 'prism', 'void']) {
      expect(RECIPES.some((r) => GA_BY_ID.get(r.result)?.element === e)).toBe(true);
    }
  });
});

describe('matching', () => {
  const triad = RECIPES.find((r) => r.id === 'triple_burn')!;

  it('fires when the three cards are queued together, in any order', () => {
    expect(findRecipe([...triad.needs].reverse())?.id).toBe('triple_burn');
    expect(findRecipe(['emberpaw', 'refract', 'cinderfang', 'magmachog'])?.id).toBe('triple_burn');
  });

  it('does not fire on a partial set', () => {
    expect(findRecipe([triad.needs[0], triad.needs[1]])).toBeNull();
    expect(findRecipe(['emberpaw', 'rimeclaw', 'staticnip'])).toBeNull();
  });

  it('does not let copies stand in for distinct ingredients', () => {
    expect(findRecipe(['emberpaw', 'emberpaw', triad.needs[1]])).toBeNull();
  });
});

describe('library and rewards', () => {
  const triad = RECIPES.find((r) => r.id === 'triple_burn')!;
  const queue = [...triad.needs];

  it('grants the fused card the first time only', () => {
    const first = resolveTurn(emptyLibrary(), queue);
    expect(first.fired?.id).toBe('triple_burn');
    expect(first.granted).toEqual([triad.result]);
    const second = resolveTurn(first.library, queue);
    expect(second.fired).toBeTruthy();
    expect(second.granted).toEqual([]);
  });

  it('teaches exactly one recipe per turn even when two are present', () => {
    const burn = [...RECIPES.find((r) => r.id === 'triple_burn')!.needs];
    const frost = [...RECIPES.find((r) => r.id === 'triple_frost')!.needs];
    const out = resolveTurn(emptyLibrary(), [...burn, ...frost]);
    expect(out.granted).toHaveLength(1);
    expect(out.library.discovered).toHaveLength(1);
  });

  it('leaves an untouched library unchanged', () => {
    const lib = emptyLibrary();
    const out = resolveTurn(lib, ['emberpaw']);
    expect(out.library).toBe(lib);
    expect(out.fired).toBeNull();
  });

  it('hides what has not been found yet', () => {
    expect(libraryLine(emptyLibrary())).toMatch(/0\/\d+ fusions known · \d+ undiscovered/);
    const all = { discovered: RECIPES.map((r) => r.id) };
    expect(libraryLine(all)).toContain('undiscovered');
    expect(libraryLine(all)).toMatch(/0 undiscovered/);
  });

  it('names a recipe only after it is known, and never spells out the answer', () => {
    const r = RECIPES.find((x) => x.id === 'staticbloom')!;
    const line = describeRecipe(r);
    expect(line).toContain('Static Bloom');
    expect(r.hint).not.toContain('staticnip');
  });
});

describe('anyChip', () => {
  it('resolves both the ordinary cards and the fused ones', () => {
    expect(anyChip('emberpaw')?.name).toBe('Emberpaw');
    expect(anyChip('ga_cinderfall')?.klass).toBe('G');
    expect(anyChip('nope')).toBeUndefined();
  });

  it('lets chip() read a fused card, but keeps them out of the shop and the drop table', () => {
    expect(chip('ga_quietdeath').name).toBe('Quiet Death');
    for (const id of GA_BY_ID.keys()) expect(CHIP_BY_ID.has(id)).toBe(false);
  });
});
