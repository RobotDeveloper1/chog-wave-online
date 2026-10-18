import { describe, expect, it } from 'vitest';
import {
  ALL_QUESTS,
  DUNGEONS,
  QUESTS,
  ZONES,
  applyEvent,
  freshState,
  isOpen,
  labelFor,
  marksFor,
  npcOf,
  offersFor,
  pendingAt,
  poiOf,
  readyAt,
  trackTargets,
  turnIn,
  turnInOf,
  xpToLevel,
  xpForQuest,
  xpForRoom,
  xpForRun,
  type QuestLog,
} from '../src/index.ts';

const DOORS = new Set(['shop', 'heal', 'station', 'brother', 'telemetry', 'dungeon', 'home']);

describe('the quest book', () => {
  it('has a lot of quests, and every id is unique', () => {
    expect(ALL_QUESTS.length).toBeGreaterThanOrEqual(28);
    expect(new Set(ALL_QUESTS.map((q) => q.id)).size).toBe(ALL_QUESTS.length);
  });

  it('is given and handed in by people who exist, who are not hidden', () => {
    for (const q of ALL_QUESTS) {
      for (const id of [q.giver, turnInOf(q)]) {
        const hit = npcOf(id);
        expect(hit, `${q.id}: ${id}`).not.toBeNull();
        expect(hit!.npc.hidden, `${q.id}: ${id} is hidden`).toBeFalsy();
      }
    }
  });

  it('names only real people, places and doors as objectives', () => {
    for (const q of ALL_QUESTS) {
      for (const o of q.objectives) {
        if (o.kind === 'talk') expect(npcOf(o.target ?? ''), `${q.id} talk ${o.target}`).not.toBeNull();
        if (o.kind === 'reach') expect(poiOf(o.target ?? ''), `${q.id} reach ${o.target}`).not.toBeNull();
        if (o.kind === 'enter') expect(DOORS.has(o.target ?? ''), `${q.id} enter ${o.target}`).toBe(true);
        expect(labelFor(o).length).toBeGreaterThan(3);
        expect(o.need).toBeGreaterThan(0);
      }
    }
  });

  it('only chains onto quests that exist, and never in a loop', () => {
    for (const q of ALL_QUESTS) {
      let cur = q;
      const seen = new Set<string>();
      while (cur.after) {
        expect(QUESTS.has(cur.after), `${cur.id} after ${cur.after}`).toBe(true);
        expect(seen.has(cur.after), `${q.id} loops`).toBe(false);
        seen.add(cur.after);
        cur = QUESTS.get(cur.after)!;
      }
    }
  });

  it('is given by someone who lives in a district the quest belongs to', () => {
    for (const q of ALL_QUESTS) {
      const giver = npcOf(q.giver)!;
      expect(ZONES[giver.sector].npcs.some((n) => n.id === q.giver)).toBe(true);
    }
  });

  it('never sets a level gate that is a wall: the dungeon before it pays the way up', () => {
    // A level is a ladder only if the thing a player can already do pays enough to climb it.
    // Quests alone cannot (the late levels are long), but every dungeon can be run again, so
    // the gap between one dungeon's level and the next must be a few flawless runs of the first.
    DUNGEONS.slice(0, -1).forEach((d, i) => {
      const next = DUNGEONS[i + 1]!;
      const run = (d.rows - 1) * xpForRoom(d.tier) + xpForRun(d.tier, true);
      const gap = xpToLevel(next.level) - xpToLevel(d.level);
      expect(run * 8 + d.firstClear.xp, `${d.name} → ${next.name}`).toBeGreaterThanOrEqual(gap);
    });
  });

  it('is climbable by the road alone for the first levels, so a newcomer is never stuck', () => {
    // Everything in the city and the first fold, with no replays at all, reaches the second dungeon.
    const early = ALL_QUESTS.filter((o) => (o.level ?? 1) <= 5).reduce((s, o) => s + xpForQuest(o.stars), 0);
    expect(early + DUNGEONS[0]!.firstClear.xp).toBeGreaterThanOrEqual(xpToLevel(5));
  });

  it('starts with one quest on offer at the board by the arrival, and several more elsewhere', () => {
    const open = ALL_QUESTS.filter((q) => isOpen(q, {}, 1));
    expect(open.length).toBeGreaterThan(5);
    expect(offersFor('a-board', {}, 1).map((q) => q.id)).toEqual(['m-01']);
  });

  it('puts a ! over the giver, then a ? over the person it is handed in to', () => {
    let log: QuestLog = {};
    expect(marksFor(log, 1)['a-board']).toBe('offer');
    log = { 'm-01': freshState(QUESTS.get('m-01')!) };
    expect(marksFor(log, 1)['a-operator']).toBe('progress');
    const res = applyEvent(log, QUESTS.get('m-01')!, { type: 'talk', target: 'a-operator' });
    log = { 'm-01': res.state };
    expect(res.justDone).toBe(true);
    expect(marksFor(log, 1)['a-operator']).toBe('turnin');
    expect(readyAt('a-operator', log).map((q) => q.id)).toEqual(['m-01']);
    expect(pendingAt('a-board', log)).toEqual([]);
  });

  it('walks the board tutorial onto the road and back', () => {
    const walk = QUESTS.get('m-01d')!;
    expect(walk.giver).toBe('a-board');
    // Another region is not the Tolls.
    expect(applyEvent({}, walk, { type: 'lineTravel', target: 'ashpine' }).state.progress[0]).toBe(0);
    const done = applyEvent({}, walk, { type: 'lineTravel', target: 'tolls' });
    expect(done.state.progress[0]).toBe(1);
    expect(done.justDone).toBe(true);
    const fight = QUESTS.get('m-01e')!;
    expect(fight.giver).toBe('a-board');
    const won = applyEvent({}, fight, { type: 'lineClear', target: 'tolls.1' });
    expect(won.state.progress[0]).toBe(1);
    expect(won.justDone).toBe(true);
    // The market errand waits for the road to be proven.
    expect(isOpen(QUESTS.get('m-02')!, {}, 1)).toBe(false);
    const log: QuestLog = {
      'm-01c': { progress: [1], done: true, turnedIn: true },
      'm-01d': { progress: [1], done: true, turnedIn: true },
      'm-01e': { progress: [1], done: true, turnedIn: true },
    };
    expect(isOpen(QUESTS.get('m-02')!, log, 1)).toBe(true);
    expect(labelFor({ kind: 'lineTravel', need: 1 })).toContain('walked');
    expect(labelFor({ kind: 'lineClear', need: 1 })).toContain('cleared');
  });

  it('only counts a talk at the person it names', () => {
    const def = QUESTS.get('m-01')!;
    expect(applyEvent({}, def, { type: 'talk', target: 'a-dealer' }).state.progress[0]).toBe(0);
    expect(applyEvent({}, def, { type: 'talk' }).state.progress[0]).toBe(0);
  });

  it('hands in a side quest and pays it once', () => {
    const def = QUESTS.get('s-a-clock')!;
    let log: QuestLog = { [def.id]: freshState(def) };
    log = { [def.id]: applyEvent(log, def, { type: 'reach', target: 'a-vista' }).state };
    const got = turnIn(log, def.id, def);
    expect(got.ok).toBe(true);
    expect(got.wav).toBe(def.reward.wav);
    expect(turnIn(got.log, def.id, def).ok).toBe(false);
  });

  it('points an open objective at its person, place or door', () => {
    const def = QUESTS.get('m-02')!;
    const log: QuestLog = { 'm-02': freshState(def) };
    const t = trackTargets(log).filter((x) => x.quest === 'm-02');
    expect(t.map((x) => `${x.kind}:${x.id}`)).toContain('door:shop');
  });

  it('points a dungeon clear at the Fold Gate door', () => {
    const def = QUESTS.get('m-06')!;
    const log: QuestLog = { 'm-06': freshState(def) };
    const t = trackTargets(log).filter((x) => x.quest === 'm-06');
    expect(t.map((x) => `${x.kind}:${x.id}`)).toContain('door:dungeon');
  });

  it('points nothing for a road walk: the card text is the guide', () => {
    const def = QUESTS.get('m-01d')!;
    const log: QuestLog = { 'm-01d': freshState(def) };
    expect(trackTargets(log).filter((x) => x.quest === 'm-01d')).toEqual([]);
  });

  it('keeps the level ladder: the errands are for the first levels, the dungeons for the rest', () => {
    const lvl = (id: string): number => QUESTS.get(id)?.level ?? 1;
    expect(lvl('s-a-bread')).toBeLessThanOrEqual(2);
    for (const q of ALL_QUESTS.filter((x) => x.kind === 'side')) expect(q.level ?? 1).toBeLessThanOrEqual(3);
    expect(lvl('m-16')).toBe(DUNGEONS.at(-1)!.level);
  });
});
