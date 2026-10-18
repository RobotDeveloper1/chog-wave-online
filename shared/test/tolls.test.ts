import { describe, expect, it } from 'vitest';
import { ARCHETYPES, MOVES, movePanels, pickMove, type PickMem } from '../src/sf/boss.ts';
import { LANES } from '../src/sf/field.ts';
import { addBody, openSession, tick, type DuelSession } from '../src/sf/session.ts';
import { DEFAULT_STATS } from '../src/sf/stats.ts';
import { enemyVolleyDamage, volleyAnchor, volleyClock } from '../src/sf/clock.ts';
import { archetypeForEncounter } from '../src/line/mobs.ts';
import { encounterBudget, screenMight } from '../src/line/budget.ts';
import { hasQuirk, quirkOf } from '../src/line/quirks.ts';

/**
 * The Tolls' kits: three mobs, seven twists, and a gate that counts to four.
 *
 * The first map used to field the shared `spark`/`imp`/`baron` tables, which meant the
 * Tollkeeper — a baron at depth 1 — only ever spoke BAGHOLDER, the weakest word in the
 * game. Now the Tolls field their own kits, each encounter carries one quirk, and the
 * fight runs one step deeper with the encounter's own bite.
 */

const mem = (over: Partial<PickMem> = {}): PickMem => ({
  lastMove: null, streak: 0, volleys: 0, quirk: null, ...over,
});

/** The tick is capped at 500 ms of real time, so tests have to walk it in steps. */
function advance(s: DuelSession, ms: number): void {
  for (let t = 0; t < ms; t += 100) tick(s, 100);
}

function tollsFight(encounterId: string, rand: () => number = Math.random): DuelSession {
  const s = openSession({
    id: `line:${encounterId}`,
    place: { kind: 'dungeon', sector: 'ashflat' },
    boss: {
      name: encounterId,
      archetype: archetypeForEncounter(encounterId),
      hp: encounterBudget(encounterId)!.hp,
      level: 4,
      difficulty: 2,
      node: true,
      quirk: encounterId,
    },
    rand,
  });
  // Level 4 against a level-4 fight: gap 0, so the clock reads exactly as priced.
  addBody(s, { id: 'p1', owner: 'o1', name: 'P1', tribe: 'burn', level: 4, stats: { ...DEFAULT_STATS } });
  return s;
}

describe('the tolls roster', () => {
  it('fields its own three kits, not the shared tables', () => {
    expect([1, 2, 3, 4].map((n) => archetypeForEncounter(`tolls.${n}`))).toEqual([
      'mite', 'walker', 'mite', 'walker',
    ]);
    expect(archetypeForEncounter('tolls.5')).toBe('walker');
    expect(archetypeForEncounter('tolls.6')).toBe('walker');
    expect(archetypeForEncounter('tolls.7')).toBe('tollkeeper');
  });

  it('leads each kit with its own word', () => {
    expect(ARCHETYPES.mite.pool[0]).toBe('nibble');
    expect(ARCHETYPES.walker.pool[0]).toBe('stop-loss');
    expect(ARCHETYPES.tollkeeper.pool[0]).toBe('toll');
    for (const a of ['mite', 'walker', 'tollkeeper'] as const) {
      for (const id of ARCHETYPES[a].pool) expect(MOVES[id], `${a} move ${id}`).toBeTruthy();
    }
  });

  it('gives the tollkeeper a real voice at home depth', () => {
    // The old baron-at-depth-1 spoke one word. The tollkeeper speaks four.
    const pool = ARCHETYPES.tollkeeper.pool.map((id) => MOVES[id]!);
    expect(pool.filter((m) => m.from <= 1 && m.depth <= 2).length).toBe(4);
    expect(ARCHETYPES.tollkeeper.guard).toBe(0.4);
  });

  it('marks what the two new words promise', () => {
    const near = LANES - 1;
    expect(movePanelsOf('nibble', 0, 2)).toEqual([{ file: 0, lane: near }]);
    expect(movePanelsOf('toll', 1, 0)).toEqual([
      { file: 0, lane: near },
      { file: 1, lane: near },
      { file: 2, lane: near },
    ]);
  });
});

function movePanelsOf(moveId: string, bossFile: number, youFile: number): { file: number; lane: number }[] {
  return movePanels(MOVES[moveId]!, { cols: 3, bossFile, youFile });
}

describe('seven quirks', () => {
  it('names one twist per tolls encounter and none elsewhere', () => {
    for (let n = 1; n <= 7; n++) expect(hasQuirk(`tolls.${n}`), `tolls.${n}`).toBe(true);
    expect(hasQuirk('ashpine.1')).toBe(false);
    expect(hasQuirk(null)).toBe(false);
    expect(quirkOf('ashpine.3')).toEqual({});
  });

  it('prices the young swarm soft and the gate hard', () => {
    expect(quirkOf('tolls.1')).toMatchObject({ hpK: 1.15, powerK: 0.9 });
    expect(quirkOf('tolls.7')).toMatchObject({ powerK: 1.25, toll: true });
    expect(quirkOf('tolls.5').walls).toBe(true);
    expect(quirkOf('tolls.2').bloodscent).toBe(true);
    expect(quirkOf('tolls.4').cornered).toBe(true);
  });

  it('seasons the budget without breaking its promise', () => {
    // tolls.1 arrives holding nothing: 1.8 screens of chained basics (12 + 13.8 + 15.6),
    // times the swarm's 1.15.
    expect(encounterBudget('tolls.1')!.hp).toBe(85);
    // tolls.6 is still its own screens of its own arrivals — just 30% heavier. The best
    // screen there runs burn (Hot Heart + Emberpaw); the volt pair never shares a lock.
    const b = encounterBudget('tolls.6')!;
    expect(b.screenMight).toBe(309);
    expect(b.hp).toBe(Math.round(3.4 * b.screenMight * 1.3));
    expect(b.screenMight).toBe(screenMight('tolls', 5));
  });

  it('bites above the line everywhere past the first walk', () => {
    const anchor = volleyAnchor('node');
    for (const [id, k] of [['tolls.2', 1.15], ['tolls.7', 1.25]] as const) {
      const power = Math.round(anchor * k);
      const flat = enemyVolleyDamage(1, 'node', undefined, 'walker', 0);
      const spicy = enemyVolleyDamage(1, 'node', power, 'walker', 0);
      expect(spicy, id).toBe(Math.max(1, Math.round(flat * (power / anchor))));
      expect(spicy, `${id} above the line`).toBeGreaterThan(flat);
    }
    // And the first walk stays under it.
    const soft = enemyVolleyDamage(1, 'node', Math.round(anchor * 0.9), 'mite', 0);
    expect(soft).toBeLessThan(enemyVolleyDamage(1, 'node', undefined, 'mite', 0));
  });
});

describe('a boss with a memory', () => {
  it('counts to four on the gate', () => {
    // Volleys 0-2 play; volley 3 is the toll. Then it starts counting again.
    expect(pickMove('tollkeeper', 1, 2, () => 0.99, mem({ volleys: 3, quirk: 'tolls.7' })).id).toBe('toll');
    expect(pickMove('tollkeeper', 4, 2, () => 0.99, mem({ volleys: 7, quirk: 'tolls.7' })).id).toBe('toll');
    expect(pickMove('tollkeeper', 1, 2, () => 0.99, mem({ volleys: 2, quirk: 'tolls.7' })).id).not.toBe('toll');
    // No quirk, no count: the same kit elsewhere plays the odds.
    expect(pickMove('tollkeeper', 1, 2, () => 0.99, mem({ volleys: 3 })).id).not.toBe('toll');
  });

  it('runs where you fled on the chaff track', () => {
    const blood = mem({ lastMove: 'stop-loss', streak: 1, volleys: 1, quirk: 'tolls.2' });
    expect(pickMove('walker', 1, 2, () => 0, blood).id).toBe('frontrun');
    // The 65% is a die, not a promise: a high roll plays the table instead.
    expect(pickMove('walker', 1, 2, () => 0.99, blood).id).toBe('bagholder');
    // And without the cut before it, there is nothing to follow.
    expect(pickMove('walker', 1, 2, () => 0, mem({ ...blood, lastMove: 'bagholder' })).id).toBe('stop-loss');
  });

  it('corners the dogs past half', () => {
    const cornered = mem({ lastMove: 'bagholder', streak: 1, volleys: 1, quirk: 'tolls.4' });
    expect(pickMove('walker', 3, 2, () => 0.99, cornered).id).toBe('frontrun');
    expect(pickMove('walker', 2, 2, () => 0.99, cornered).id).not.toBe('frontrun');
    expect(pickMove('walker', 3, 2, () => 0.99, mem({ ...cornered, volleys: 2 })).id).not.toBe('frontrun');
  });

  it('never plays the same word three times running', () => {
    const stuck = mem({ lastMove: 'bagholder', streak: 2, volleys: 5 });
    // A max roll would take the last word of the pool — unless it is excluded.
    expect(pickMove('walker', 1, 6, () => 0.999, stuck).id).toBe('frontrun');
    // Below the streak, the table plays as priced.
    expect(pickMove('walker', 1, 6, () => 0.999, mem({ ...stuck, streak: 1 })).id).toBe('bagholder');
  });
});

describe('the tolls on the field', () => {
  it('holds the fence file for the whole fight', () => {
    const fenced = tollsFight('tolls.5', () => 0);
    expect(fenced.field.blocked).toBe(0);
    const open = tollsFight('tolls.1', () => 0);
    expect(open.field.blocked).toBeNull();
  });

  it('reads the crows fast', () => {
    // Nibble off the lead weight: rand 0 takes the first word of the pool.
    const crows = tollsFight('tolls.3', () => 0);
    for (let i = 0; i < 50 && !crows.field.hazards.length; i++) tick(crows, 100);
    const hazard = crows.field.hazards[0] ?? null;
    expect(hazard?.label).toBe('NIBBLE');
    // telegraph(909) * nibble tell(0.85) * omen tellK(0.85) = 657.
    const expectMs = Math.round(volleyClock({ phase: 1, difficulty: 2 }).telegraph * 0.85 * 0.85);
    expect(expectMs).toBe(657);
    expect(hazard?.total).toBe(657);
  });

  it('skitters the mites and plants the gate', () => {
    const mites = tollsFight('tolls.1', () => 0);
    expect(mites.field.boss.file).toBe(1);
    // The first strike lands on tick 18: the skitter scatters to file 0 with rand 0.
    advance(mites, 1800);
    expect(mites.boss.volleys).toBe(1);
    expect(mites.field.boss.file).toBe(0);
    // The 700 ms hunt is a skitter too: off file 0 it bounces to 1, never the chase.
    advance(mites, 700);
    expect(mites.field.boss.file).toBe(1);

    const gate = tollsFight('tolls.7', () => 0.99);
    advance(gate, 9000);
    expect(gate.boss.volleys).toBeGreaterThanOrEqual(1);
    expect(gate.field.boss.file).toBe(1);
  });

  it('remembers across the volley it just telegraphed', () => {
    const s = tollsFight('tolls.2', () => 0);
    advance(s, 3000);
    expect(s.boss.volleys).toBeGreaterThanOrEqual(1);
    expect(s.boss.lastMove).toBeTruthy();
    expect(s.boss.streak).toBeGreaterThanOrEqual(1);
  });
});
