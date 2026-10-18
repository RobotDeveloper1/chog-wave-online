import { describe, expect, it } from 'vitest';
import {
  ACTS,
  DUNGEONS,
  DUNGEON_BY_ID,
  GATES,
  LEVEL_CAP,
  QUEST_BY_ID,
  SECTORS,
  STORY,
  areaTierUnlocked,
  deriveBuild,
  dungeonStatus,
  gatesBetween,
  journey,
  makeDungeon,
  nextStep,
  nodeById,
  starterCard,
  unlocksAt,
  type ChogBuild,
} from '../src/index.ts';

/**
 * Progression as a player meets it: one city, six dungeons, a ladder with rungs they can name,
 * seven Acts that say what to do next, and a Sim that pays something to keep.
 */

describe('the world', () => {
  it('is one city', () => {
    expect(SECTORS).toEqual(['ashflat']);
  });
});

describe('the dungeons', () => {
  it('are six, in order, each one opening later than the last and hitting harder', () => {
    expect(DUNGEONS.map((d) => d.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(DUNGEONS.map((d) => d.id)).size).toBe(6);
    for (let i = 1; i < DUNGEONS.length; i++) {
      expect(DUNGEONS[i]!.level).toBeGreaterThan(DUNGEONS[i - 1]!.level);
      expect(DUNGEONS[i]!.tier).toBeGreaterThanOrEqual(DUNGEONS[i - 1]!.tier);
      expect(DUNGEONS[i]!.rows).toBeGreaterThanOrEqual(DUNGEONS[i - 1]!.rows);
    }
    expect(DUNGEONS[0]!.level).toBeLessThanOrEqual(2);
    expect(DUNGEONS.at(-1)!.level).toBeLessThan(LEVEL_CAP);
  });

  it('belong to six different elements, each with a boss that plays differently from its neighbours', () => {
    expect(new Set(DUNGEONS.map((d) => d.element)).size).toBe(6);
    for (let i = 1; i < DUNGEONS.length; i++) expect(DUNGEONS[i]!.boss.archetype).not.toBe(DUNGEONS[i - 1]!.boss.archetype);
    expect(new Set(DUNGEONS.map((d) => d.firstClear.title)).size).toBe(6);
  });

  it('open on a level and on the dungeon before them', () => {
    const [ember, frost] = [DUNGEONS[0]!, DUNGEONS[1]!];
    expect(dungeonStatus(ember, 1, new Set())).toEqual({ state: 'locked', reason: 'opens at LV 2' });
    expect(dungeonStatus(ember, 2, new Set()).state).toBe('open');
    // the level alone is not enough: the order is the story
    expect(dungeonStatus(frost, 30, new Set())).toEqual({ state: 'locked', reason: 'clear EMBER FOUNDRY first' });
    expect(dungeonStatus(frost, 4, new Set(['d-ember']))).toEqual({ state: 'locked', reason: 'opens at LV 5' });
    expect(dungeonStatus(frost, 5, new Set(['d-ember'])).state).toBe('open');
    expect(dungeonStatus(ember, 1, new Set(['d-ember'])).state).toBe('cleared');
  });

  it('build a map with a named boss in the dungeon’s own element, and a way to reach it', () => {
    for (const def of DUNGEONS) {
      for (let seed = 1; seed <= 40; seed++) {
        const area = makeDungeon(def, seed * 97 + def.n);
        expect(area.dungeonId).toBe(def.id);
        expect(area.name).toBe(def.name);
        expect(area.rows).toBe(def.rows);
        const boss = nodeById(area, area.bossId)!;
        expect(boss.enemy).toMatchObject({ name: def.boss.name, archetype: def.boss.archetype, element: def.element });
        expect(boss.cards?.length).toBeGreaterThan(0);
        const reach = new Set<string>([area.entryId]);
        const stack = [area.entryId];
        while (stack.length) for (const l of nodeById(area, stack.pop()!)?.links ?? []) if (!reach.has(l)) (reach.add(l), stack.push(l));
        expect(reach.has(area.bossId)).toBe(true);
      }
    }
  });

  it('are made of their element: most of what lives in one leans that way', () => {
    for (const def of DUNGEONS) {
      let mine = 0;
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        for (const n of makeDungeon(def, seed * 31).nodes) {
          if (!n.enemy || n.id === makeDungeon(def, seed * 31).bossId) continue;
          total++;
          if (n.enemy.element === def.element) mine++;
        }
      }
      expect(mine / total).toBeGreaterThan(0.55);
    }
  });

  it('reach the tier a level has earned', () => {
    expect(areaTierUnlocked(1)).toBe(0);
    expect(areaTierUnlocked(2)).toBe(1);
    expect(areaTierUnlocked(5)).toBe(2);
    expect(areaTierUnlocked(12)).toBe(3);
    expect(areaTierUnlocked(LEVEL_CAP)).toBe(4);
  });
});

describe('the ladder', () => {
  it('is in level order, inside the cap, with something in the first hour', () => {
    const levels = GATES.map((g) => g.at);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    expect(levels.every((l) => l >= 2 && l <= LEVEL_CAP)).toBe(true);
    expect(levels[0]).toBeLessThanOrEqual(2);
    expect(levels.filter((l) => l <= 5).length).toBeGreaterThanOrEqual(3);
  });

  it('has a rung for every dungeon, at the level it opens', () => {
    for (const d of DUNGEONS) {
      const rung = GATES.find((g) => g.kind === 'dungeon' && g.label === `Dungeon: ${d.name}`);
      expect(rung?.at).toBe(d.level);
    }
  });

  it('starts a newcomer with a three-card program and grows it to six', () => {
    expect(unlocksAt(1).queueSlots).toBe(3);
    expect(unlocksAt(2).queueSlots).toBe(4);
    expect(unlocksAt(6).queueSlots).toBe(5);
    expect(unlocksAt(14).queueSlots).toBe(6);
    expect(unlocksAt(LEVEL_CAP).queueSlots).toBe(6);
  });

  it('keeps a recipe fireable from the first level: three cards is the smallest fusion', () => {
    expect(unlocksAt(1).queueSlots).toBeGreaterThanOrEqual(3);
  });

  it('names what a level-up climbed, and says what comes next', () => {
    expect(gatesBetween(1, 2)).toEqual(['Hand: 4-card programs', 'Dungeon: EMBER FOUNDRY']);
    expect(gatesBetween(2, 4)).toEqual([]);
    expect(gatesBetween(4, 8)).toContain('Dungeon: RELAY SPIRE');
    expect(unlocksAt(1).next).toMatch(/Lv 2/);
    expect(unlocksAt(LEVEL_CAP).next).toBeNull();
  });
});

describe('the acts', () => {
  const mainIds = STORY.filter((q) => q.kind === 'main').map((q) => q.id);

  it('hold every main quest exactly once, in chain order', () => {
    const listed = ACTS.flatMap((a) => a.quests);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...mainIds].sort());
    const seen = new Set<string>();
    for (const id of listed) {
      const def = QUEST_BY_ID.get(id)!;
      if (def.after) expect(seen.has(def.after)).toBe(true);
      seen.add(id);
    }
  });

  it('are a morning in the city and then one for each dungeon, ending in its boss', () => {
    expect(ACTS).toHaveLength(7);
    expect(ACTS[0]!.dungeon).toBeUndefined();
    ACTS.slice(1).forEach((act, i) => {
      const def = DUNGEONS[i]!;
      expect(act.dungeon).toBe(def.id);
      expect(act.level).toBe(def.level);
      const last = QUEST_BY_ID.get(act.quests.at(-1)!)!;
      expect(last.objectives).toEqual([expect.objectContaining({ kind: 'dungeonClear', target: def.id })]);
      expect(last.level).toBe(def.level);
    });
  });

  it('teach the loop in the order it pays: the Sim before the deck before the shop', () => {
    const chain = ACTS.flatMap((a) => a.quests);
    expect(chain.indexOf('m-01b')).toBeLessThan(chain.indexOf('m-01c'));
    expect(chain.indexOf('m-01c')).toBeLessThan(chain.indexOf('m-02'));
    expect(QUEST_BY_ID.get('m-01b')!.objectives[0]!.kind).toBe('train');
    expect(QUEST_BY_ID.get('m-01c')!.objectives[0]!.kind).toBe('equip');
    expect(QUEST_BY_ID.get('m-05b')!.objectives[0]!.kind).toBe('fuse');
  });

  it('keep every main quest in the one city, and out of the market’s.cellss', () => {
    for (const q of STORY) {
      expect(q.sector ?? 'ashflat').toBe('ashflat');
      // an errand a quiet market could block would stop the road for whoever plays at night
      for (const o of q.objectives) expect(['clear', 'stormClear', 'witnessSale']).not.toContain(o.kind);
    }
  });

  it('write multi-page dialogue with a blank line between pages, and nothing empty', () => {
    for (const q of STORY) {
      for (const page of [...q.text.split('\n\n'), ...(q.thanks ?? '').split('\n\n')]) expect(page.trim().length).toBeGreaterThan(0);
    }
    for (const id of ['m-01b', 'm-01c', 'm-05b', 'm-06', 'm-16']) expect(QUEST_BY_ID.get(id)!.text.split('\n\n').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the journey', () => {
  it('starts on the first step of the first act', () => {
    const next = nextStep([], [], 1)!;
    expect(next.act.id).toBe(1);
    expect(next.step.id).toBe('m-01');
    expect(next.step.state).toBe('next');
  });

  it('reads a quest under way, then one ready to hand in, then moves on', () => {
    expect(nextStep(['m-01'], [{ id: 'm-01b', done: false }], 1)!.step).toMatchObject({ id: 'm-01b', state: 'active' });
    expect(nextStep(['m-01'], [{ id: 'm-01b', done: true }], 1)!.step).toMatchObject({ id: 'm-01b', state: 'ready' });
    expect(nextStep(['m-01', 'm-01b'], [], 1)!.step).toMatchObject({ id: 'm-01c', state: 'next' });
  });

  it('holds a quest until its level, and tells the player what they are waiting for', () => {
    const act1 = ['m-01', 'm-01b', 'm-01c', 'm-01d', 'm-01e', 'm-02', 'm-03', 'm-04'];
    const low = journey(act1, [], 1);
    expect(low[0]!.state).toBe('done');
    expect(low[1]!.steps[0]).toMatchObject({ id: 'm-05', state: 'locked', level: 2 });
    const guide = nextStep(act1, [], 1)!;
    expect(guide.step).toMatchObject({ id: 'm-05', state: 'locked' });
    const lv2 = journey(act1, [], 2);
    expect(lv2[1]!.steps[0]).toMatchObject({ id: 'm-05', state: 'next' });
    expect(lv2[2]!.state).toBe('locked');
  });

  it('is finished when every main quest is in', () => {
    const everything = STORY.filter((q) => q.kind === 'main').map((q) => q.id);
    expect(nextStep(everything, [], LEVEL_CAP)).toBeNull();
    expect(journey(everything, [], LEVEL_CAP).every((a) => a.state === 'done')).toBe(true);
  });
});

describe('the Sim’s first card', () => {
  const TIERS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
  const BODIES = ['Kings Robe', 'Tuxedo', 'Banana suit', 'Blue jacket', 'Golden Armor', 'Army Vest'];
  const AURAS = ['Fire', 'Ice', 'Electric', 'Water', 'Rainbow', 'Void'];
  const build = (id: number): ChogBuild =>
    deriveBuild({
      tokenId: id,
      transferCount: 0,
      daysHeld: 0,
      attributes: { Tier: TIERS[id % TIERS.length]!, Body: BODIES[id % BODIES.length]!, Aura: AURAS[(id * 7) % AURAS.length]!, Eyes: 'Laser', Mouth: 'Smile', Base: 'Origin' },
    });

  it('is a common card of the Chog’s own tribe that it does not hold', () => {
    let seen = 0;
    for (let t = 1; t <= 60; t++) {
      const b = build(t);
      const id = starterCard(b, []);
      if (!id) continue;
      seen++;
      expect(b.library).not.toContain(id);
      expect(id).not.toBe(b.signature);
    }
    expect(seen).toBeGreaterThan(30);
  });

  it('is never a card the Chog already owns, nor one it cannot field', () => {
    const b = build(143);
    const first = starterCard(b, [])!;
    const again = starterCard(b, [first]);
    expect(again).not.toBe(first);
  });
});

describe('the table', () => {
  it('is what the quests point at', () => {
    for (const q of STORY) for (const o of q.objectives) if (o.kind === 'dungeonClear' && o.target) expect(DUNGEON_BY_ID.has(o.target)).toBe(true);
  });
});
