import { describe, expect, it } from 'vitest';
import { deriveBuild } from '../src/derive.ts';
import { CHIP_BY_ID, GA_CHIPS, anyChip } from '../src/chips.ts';
import {
  autoFolder,
  canAdd,
  cardPool,
  checkFolder,
  defaultFolder,
  folderRules,
  folderStats,
  repairFolder,
} from '../src/folder.ts';

const TIERS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const BODIES = ['Kings Robe', 'Tuxedo', 'Banana suit', 'Blue jacket', 'Golden Armor', 'Army Vest'];
const AURAS = ['Fire', 'Ice', 'Electric', 'Water', 'Rainbow', 'Void'];

const build = (id: number) =>
  deriveBuild({
    tokenId: id,
    transferCount: 0,
    daysHeld: 0,
    attributes: {
      Tier: TIERS[id % TIERS.length]!,
      Body: BODIES[id % BODIES.length]!,
      Aura: AURAS[(id * 7) % AURAS.length]!,
      Eyes: 'Laser',
      Mouth: 'Smile',
      Base: 'Origin',
    },
  });

describe('the born folder', () => {
  it('is a legal folder for every kind of Chog, so nobody starts in violation', () => {
    for (let id = 1; id <= 240; id++) {
      const b = build(id);
      const rules = folderRules(b);
      const folder = defaultFolder(b);
      const res = checkFolder(rules, folder, new Set(cardPool(b, [])));
      expect(res.errors, `token ${id} (${b.loadout.profile}, ${b.loadout.element})`).toEqual([]);
      expect(res.ok).toBe(true);
    }
  });

  it('always carries the signature, even when a cap squeezed it out of the draw', () => {
    for (let id = 1; id <= 240; id++) {
      const b = build(id);
      expect(defaultFolder(b)).toContain(b.signature);
    }
  });

  it('keeps every repeat the Body trait paid for', () => {
    const b = build(7);
    expect(b.folder.length).toBeGreaterThan(b.library.length - 1);
    expect(new Set(b.folder).size).toBeLessThanOrEqual(b.folder.length);
  });
});

describe('what may go in', () => {
  const b = build(3);
  const rules = folderRules(b);
  const pool = new Set(cardPool(b, []));

  it('never offers the element the Chog is weak to, except the signature', () => {
    const owned = [...CHIP_BY_ID.values()].map((c) => c.id);
    for (const id of cardPool(b, owned)) {
      const c = anyChip(id)!;
      if (id !== b.signature) expect(c.element).not.toBe(b.loadout.weakness);
    }
  });

  it('refuses a card the player does not own', () => {
    const stranger = [...CHIP_BY_ID.keys()].find((id) => !pool.has(id) && anyChip(id)!.element !== rules.banned)!;
    expect(canAdd(rules, [], stranger, pool)).toBe(false);
    const withIt = new Set([...pool, stranger]);
    expect(canAdd(rules, [], stranger, withIt)).toBe(true);
  });

  it('stops at the copy limit', () => {
    const plain = [...pool].find((id) => {
      const c = anyChip(id)!;
      return !c.klass || c.klass === 'S';
    })!;
    const folder = Array(rules.copies).fill(plain) as string[];
    expect(canAdd(rules, folder, plain, pool)).toBe(false);
    expect(canAdd(rules, folder.slice(1), plain, pool)).toBe(true);
  });

  it('enforces the Mega cap across different cards', () => {
    const owned = [...CHIP_BY_ID.values()].filter((c) => c.klass === 'M' && c.element !== rules.banned).map((c) => c.id);
    const p = new Set(cardPool(b, owned));
    const folder: string[] = [];
    for (const id of owned) while (canAdd({ ...rules, copies: 5 }, folder, id, p) && folder.length < 40) folder.push(id);
    const mega = folder.filter((id) => id !== b.signature && anyChip(id)!.klass === 'M').length;
    expect(mega).toBe(rules.megaCap);
  });

  it('gives fused cards their own allowance and makes them singletons', () => {
    const ga = GA_CHIPS.find((c) => c.element !== rules.banned)!;
    const p = new Set(cardPool(b, [ga.id]));
    expect(p.has(ga.id)).toBe(true);
    expect(canAdd(rules, [], ga.id, p)).toBe(true);
    expect(canAdd(rules, [ga.id], ga.id, p)).toBe(false);
    // A Chog with no Giga allowance can still carry its fused cards.
    expect(rules.fusedCap).toBe(1 + rules.gigaCap);
  });
});

describe('checkFolder says why', () => {
  const b = build(11);
  const rules = folderRules(b);
  const pool = new Set(cardPool(b, []));

  it('rejects a short folder, a missing signature and a stranger in one pass', () => {
    const res = checkFolder(rules, ['definitely-not-a-card'], pool);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/exactly/);
    expect(res.errors.join(' ')).toMatch(/signature/);
    expect(res.errors.join(' ')).toMatch(/not a card/);
  });
});

describe('autoFolder and repairFolder', () => {
  it('builds a legal, full folder from nothing but the born cards', () => {
    for (let id = 1; id <= 120; id++) {
      const b = build(id);
      const pool = cardPool(b, []);
      const folder = autoFolder(b, pool);
      const res = checkFolder(folderRules(b), folder, new Set(pool));
      expect(res.errors, `token ${id}`).toEqual([]);
      expect(folder).toContain(b.signature);
    }
  });

  it('uses what the player earned: a stronger card in the pool raises the folder', () => {
    const b = build(5);
    const base = cardPool(b, []);
    const best = [...CHIP_BY_ID.values()]
      .filter((c) => c.element !== b.loadout.weakness && (!c.klass || c.klass === 'S') && !base.includes(c.id))
      .sort((x, y) => y.power * y.hits - x.power * x.hits)[0]!;
    const before = folderStats(autoFolder(b, base)).avgPower;
    const after = folderStats(autoFolder(b, [...base, best.id])).avgPower;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(autoFolder(b, [...base, best.id])).toContain(best.id);
  });

  it('keeps the player\'s choices and tops up when a card is sold', () => {
    const b = build(9);
    const owned = [...CHIP_BY_ID.values()].filter((c) => (!c.klass || c.klass === 'S') && c.element !== b.loadout.weakness).map((c) => c.id);
    const pool = cardPool(b, owned);
    const mine = autoFolder(b, pool);
    const sold = mine.find((id) => id !== b.signature && !b.library.includes(id)) ?? mine.find((id) => id !== b.signature)!;
    const without = pool.filter((id) => id !== sold || b.library.includes(id));
    const fixed = repairFolder(b, mine, without);
    const res = checkFolder(folderRules(b), fixed, new Set(without));
    expect(res.errors).toEqual([]);
    expect(fixed).toHaveLength(folderRules(b).size);
    // Most of the player's own folder survives a single sale.
    const survivors = fixed.filter((id) => mine.includes(id)).length;
    expect(survivors).toBeGreaterThan(mine.length * 0.7);
  });

  it('repairs a hopeless folder into a legal one', () => {
    const b = build(14);
    const pool = cardPool(b, []);
    const fixed = repairFolder(b, ['nope', 'nope2'], pool);
    expect(checkFolder(folderRules(b), fixed, new Set(pool)).ok).toBe(true);
  });
});

describe('folderStats', () => {
  it('counts the elements and the average', () => {
    const s = folderStats(['emberpaw', 'emberpaw', 'rimeclaw']);
    expect(s.byElement).toEqual({ burn: 2, frost: 1 });
    expect(s.distinct).toBe(2);
    expect(s.avgPower).toBe(Math.round((90 + 90 + 70) / 3));
  });
});
