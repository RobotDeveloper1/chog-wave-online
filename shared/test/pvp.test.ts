import { describe, expect, it } from 'vitest';
import {
  PVP_DOWN_MS,
  PVP_TELEGRAPH_MS,
  addBody,
  execute,
  openHand,
  openSession,
  outcome,
  pickCard,
  step,
  tick,
  viewOf,
  type DuelBody,
  type DuelSession,
} from '../src/sf/session.ts';
import { DEFAULT_STATS } from '../src/sf/stats.ts';
import { LANES } from '../src/sf/field.ts';

/**
 * PvP: both bodies are players, on opposite halves, KO decides.
 *
 * No boss clock, no boss hunt, no shadow to punch: a program becomes a warning on the
 * rival's row, the rival dodges the file or the lane, and whoever is still up takes it.
 * Both screens read self-near, rival-far — side 1 sees every lane mirrored.
 */

/** The tick is capped at 500 ms of real time, so tests have to walk it in steps. */
function advance(s: DuelSession, ms: number): void {
  for (let t = 0; t < ms; t += 100) tick(s, 100);
}

function duel(rand: () => number = Math.random): { s: DuelSession; a: DuelBody; b: DuelBody } {
  const s = openSession({
    id: 'pvp:a:b',
    place: { kind: 'pvp', sector: 'ashflat' },
    boss: { name: 'PVP', hp: 1, level: 5, pvp: true },
    rand,
  });
  const a = addBody(s, { id: 'a', owner: 'oa', name: 'A', tribe: 'burn', level: 5, stats: { ...DEFAULT_STATS }, deck: ['hot_heart'] });
  const b = addBody(s, { id: 'b', owner: 'ob', name: 'B', tribe: 'wave', level: 5, stats: { ...DEFAULT_STATS }, deck: ['hot_heart'] });
  return { s, a, b };
}

/** Open the hand, take the first cell holding `cardId`, and fire. No basics, no noise. */
function fire(s: DuelSession, body: DuelBody, cardId: string): void {
  openHand(s, body);
  const cell = body.hand!.cells.find((c) => c.cardId === cardId);
  expect(cell, `${cardId} dealt`).toBeDefined();
  expect(pickCard(s, body.id, cell!.cell)).toBe(true);
  expect(execute(s, body.id)).toBe(true);
}

describe('two sides of one field', () => {
  it('seats the challenger near and the rival far', () => {
    const { a, b } = duel();
    expect([a.side, b.side]).toEqual([0, 1]);
    expect([a.file, a.lane]).toEqual([1, LANES - 1]);
    expect([b.file, b.lane]).toEqual([1, 0]);
  });

  it('keeps each body on its own half', () => {
    const { s } = duel();
    expect(step(s, 'a', 'back')).toBe(true);
    expect(step(s, 'a', 'back')).toBe(false);
    expect(step(s, 'b', 'forward')).toBe(true);
    expect(step(s, 'b', 'forward')).toBe(true);
    expect(step(s, 'b', 'forward')).toBe(false);
    expect(step(s, 'b', 'back')).toBe(true);
    expect(step(s, 'b', 'back')).toBe(true);
    expect(step(s, 'b', 'back')).toBe(false);
  });

  it('runs no boss clock and no boss hunt', () => {
    const { s } = duel();
    advance(s, 30_000);
    expect(s.field.hazards).toEqual([]);
    expect(s.over).toBe(false);
  });
});

describe('programs become warnings', () => {
  it('marks the rival row with the lead card on the banner', () => {
    const { s, a, b } = duel();
    fire(s, a, 'hot_heart');
    expect(s.field.hazards.length).toBe(1);
    const h = s.field.hazards[0]!;
    expect(h.owner).toBe('a');
    expect(h.label).toBe('Hot Heart');
    expect(h.total).toBe(PVP_TELEGRAPH_MS);
    expect(h.files).toEqual([1]);
    expect(h.panels).toEqual([{ file: 1, lane: b.lane }]);
    expect(h.on).toEqual(['b']);
  });

  it('lands on the rival and nobody else', () => {
    const { s, a, b } = duel();
    fire(s, a, 'hot_heart');
    advance(s, 1000);
    expect(s.field.hazards).toEqual([]);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(a.hp).toBe(a.maxHp);
  });

  it('pays the dodge that gets out', () => {
    const { s, b } = duel();
    fire(s, s.players[0]!, 'hot_heart');
    expect(step(s, 'b', 'right')).toBe(true);
    const dodges = b.rank.dodges;
    advance(s, 1000);
    expect(b.hp).toBe(b.maxHp);
    expect(b.rank.dodges).toBe(dodges + 1);
  });

  it('holds one warning per side, and each screen sees its own incoming', () => {
    const { s } = duel();
    fire(s, s.players[0]!, 'hot_heart');
    fire(s, s.players[1]!, 'hot_heart');
    expect(s.field.hazards.length).toBe(2);
    expect(viewOf(s, 'a').hazard?.label).toBe('Hot Heart');
    expect(viewOf(s, 'a').hazard?.damage).toBe(s.field.hazards.find((h) => h.owner === 'b')!.damage);
    expect(viewOf(s, 'b').hazard?.damage).toBe(s.field.hazards.find((h) => h.owner === 'a')!.damage);
  });

  it('doubles a program fired into a live warning, and pays a card', () => {
    const { s } = duel();
    fire(s, s.players[1]!, 'hot_heart');
    // B into burn-tribe A is neutral: 190. A answers into wave-tribe B doubled twice.
    expect(s.field.hazards[0]!.damage).toBe(190);
    fire(s, s.players[0]!, 'hot_heart');
    const counter = s.field.hazards.find((h) => h.owner === 'a')!;
    expect(counter.damage).toBe(190 * 2 * 2);
    expect(s.players[0]!.bonus.length).toBe(1);
    expect(s.players[0]!.rank.counters).toBe(1);
  });

  it('reads the matchup against the rival tribe, and heals the drain', () => {
    const { s, a } = duel();
    a.hp = 100;
    // Burn into wave is super effective: 190 might, doubled, minus nothing.
    fire(s, a, 'hot_heart');
    const h = s.field.hazards[0]!;
    expect(h.damage).toBe(190 * 2);
    expect(h.drain).toBeCloseTo(0.15, 5);
    advance(s, 1000);
    expect(a.hp).toBeGreaterThan(100);
  });
});

describe('both screens read self-near', () => {
  it('wears the rival on the boss plate', () => {
    const { s } = duel();
    const va = viewOf(s, 'a');
    expect(va.pvp).toBe(true);
    expect(va.boss.name).toBe('B');
    expect(va.boss.archetype).toBe('rival');
    expect(va.boss.element).toBe('wave');
    expect(va.boss.tier).toBe('pvp');
    expect(va.boss.file).toBe(1);
    expect(va.players.map((p) => p.side)).toEqual([0, 1]);
  });

  it('mirrors every lane for the far side', () => {
    const { s } = duel();
    fire(s, s.players[0]!, 'hot_heart');
    const va = viewOf(s, 'a');
    const vb = viewOf(s, 'b');
    // Side 0 sees the floor as it is: self on 4, rival plate on 0.
    expect(va.you?.lane).toBe(LANES - 1);
    expect(va.boss.lane).toBe(0);
    expect(va.hazard).toBeNull();
    // Side 1 sees it flipped: self on 4, the warning on its own row.
    expect(vb.you?.lane).toBe(LANES - 1);
    expect(vb.boss.lane).toBe(0);
    expect(vb.hazard?.panels).toEqual([{ file: 1, lane: LANES - 1 }]);
    expect(vb.players.find((p) => p.id === 'a')?.lane).toBe(0);
  });
});

describe('one KO decides it', () => {
  it('names the body still standing, with no lockout either way', () => {
    const { s, b } = duel();
    b.hp = 5;
    fire(s, s.players[0]!, 'hot_heart');
    advance(s, 1000 + PVP_DOWN_MS + 500);
    expect(s.over).toBe(true);
    expect(s.result).toBe('win');
    expect(s.winnerId).toBe('a');
    const o = outcome(s);
    expect(o.winnerId).toBe('a');
    expect(o.lockoutMs).toBe(0);
  });

  it('calls two bodies down together a draw', () => {
    const { s, a, b } = duel();
    a.hp = 5;
    b.hp = 5;
    fire(s, a, a.deck[0]!);
    fire(s, b, b.deck[0]!);
    advance(s, 1000 + PVP_DOWN_MS + 500);
    expect(s.over).toBe(true);
    expect(s.result).toBe('loss');
    expect(s.winnerId).toBeNull();
    expect(outcome(s).winnerId).toBeNull();
  });
});
