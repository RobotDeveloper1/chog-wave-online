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
import { PVP_LANES } from '../src/sf/field.ts';
import { BURN_EVERY_MS, BURN_TICKS, FREEZE_MS, FREEZE_SLOW, STUN_CAP_MS, STUN_MS } from '../src/sf/clock.ts';

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

/** Swap the deck after the join deal: the hand on the table is voided, so the next open deals fresh. */
function sdeck(body: DuelBody, deck: string[]): void {
  body.deck = deck;
  body.hand = null;
}

describe('two sides of one field', () => {
  it('seats the challenger near and the rival far', () => {
    const { a, b } = duel();
    expect([a.side, b.side]).toEqual([0, 1]);
    expect([a.file, a.lane]).toEqual([1, PVP_LANES - 1]);
    expect([b.file, b.lane]).toEqual([1, 0]);
  });

  it('keeps each body on its own half, three lanes each', () => {
    const { s } = duel();
    expect(step(s, 'a', 'back')).toBe(true);
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

  it('signs the telegraph with the attacker, so their screen can play the throw', () => {
    const { s, a } = duel();
    fire(s, a, 'hot_heart');
    expect(s.events.find((e) => e.type === 'telegraph')).toMatchObject({ owner: 'a', label: 'Hot Heart' });
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

  it('dodges by leaving the lane, with the file held', () => {
    // Three lanes a side means two ways out of a warning: b walks forward inside
    // its file, and the strike finds the file but not the body.
    const { s, b } = duel();
    fire(s, s.players[0]!, 'hot_heart');
    expect(s.field.hazards[0]!.panels).toEqual([{ file: 1, lane: 0 }]);
    expect(step(s, 'b', 'forward')).toBe(true);
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
    expect(va.boss.lanes).toBe(PVP_LANES);
    expect(va.boss.file).toBe(1);
    expect(va.players.map((p) => p.side)).toEqual([0, 1]);
  });

  it('mirrors every lane for the far side', () => {
    const { s } = duel();
    fire(s, s.players[0]!, 'hot_heart');
    const va = viewOf(s, 'a');
    const vb = viewOf(s, 'b');
    // Side 0 sees the floor as it is: self on 5, rival plate on 0.
    expect(va.you?.lane).toBe(PVP_LANES - 1);
    expect(va.boss.lane).toBe(0);
    expect(va.hazard).toBeNull();
    // Side 1 sees it flipped: self on 5, the warning on its own row.
    expect(vb.you?.lane).toBe(PVP_LANES - 1);
    expect(vb.boss.lane).toBe(0);
    expect(vb.hazard?.panels).toEqual([{ file: 1, lane: PVP_LANES - 1 }]);
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
describe('status lands with the hit', () => {
  it('stuns the rival shut: no hand, no charge, but the boots still work', () => {
    const { s, a, b } = duel();
    sdeck(a, ['rimeclaw']);
    fire(s, a, 'rimeclaw');
    expect(s.field.hazards[0]!.stunMs).toBe(STUN_MS);
    advance(s, 1000);
    expect(b.stun).toBeGreaterThan(0);
    openHand(s, b);
    expect(b.handOpen).toBe(false);
    const charge = b.charge;
    advance(s, 300);
    expect(b.charge).toBe(charge);
    expect(step(s, 'b', 'right')).toBe(true);
  });

  it('never stacks a stun past the cap', () => {
    const { s, a, b } = duel();
    sdeck(a, ['rimeclaw']);
    b.stun = STUN_CAP_MS;
    fire(s, a, 'rimeclaw');
    advance(s, 1000);
    expect(b.stun).toBeGreaterThan(0);
    expect(b.stun).toBeLessThanOrEqual(STUN_CAP_MS);
  });

  it('slows the charge to a crawl while frozen', () => {
    const { s, a, b } = duel();
    sdeck(a, ['deepchill']);
    b.chargeMs = 100_000;
    fire(s, a, 'deepchill');
    expect(s.field.hazards[0]!.freezeMs).toBe(FREEZE_MS);
    advance(s, 1000);
    expect(b.freeze).toBeGreaterThan(0);
    b.charge = 0;
    advance(s, 1000);
    expect(b.charge).toBe(1000 * FREEZE_SLOW);
    expect(b.freeze).toBeGreaterThan(0);
  });

  it('burns over time, then goes out', () => {
    const { s, a, b } = duel();
    sdeck(a, ['cindercoat']);
    b.maxHp = 10_000;
    b.hp = 10_000;
    fire(s, a, 'cindercoat');
    const carried = s.field.hazards[0]!.burn;
    expect(carried).not.toBeNull();
    expect(carried!.ticks).toBe(BURN_TICKS);
    advance(s, 1000);
    expect(b.burn).not.toBeNull();
    const hp = b.hp;
    const { ticks, damage } = b.burn!;
    advance(s, BURN_EVERY_MS * ticks + 200);
    expect(b.hp).toBe(hp - ticks * damage);
    expect(b.burn).toBeNull();
    expect(s.events.some((e) => e.type === 'burn-tick' && e.target === 'b')).toBe(true);
  });

  it('lets burn finish a body, and going down clears every ailment', () => {
    const { s, a, b } = duel();
    sdeck(a, ['cindercoat']);
    b.maxHp = 10_000;
    b.hp = 10_000;
    fire(s, a, 'cindercoat');
    advance(s, 1000);
    expect(b.burn).not.toBeNull();
    expect(b.hp).toBeGreaterThan(0);
    b.hp = 1;
    b.stun = 500;
    b.freeze = 500;
    advance(s, BURN_EVERY_MS + 200);
    expect(b.down).toBe(true);
    expect(b.burn).toBeNull();
    expect(b.stun).toBe(0);
    expect(b.freeze).toBe(0);
  });

  it('arms the shooter when a barrier program connects, and spends it on the next hit', () => {
    const { s, a, b } = duel();
    sdeck(a, ['aegisnap']);
    sdeck(b, ['hot_heart']);
    fire(s, a, 'aegisnap');
    expect(s.field.hazards[0]!.barrier).toBe(true);
    advance(s, 1000);
    expect(a.barrier).toBe(1);
    const hp = a.hp;
    fire(s, b, 'hot_heart');
    advance(s, 1000);
    expect(a.hp).toBe(hp);
    expect(a.barrier).toBe(0);
    expect(s.events.some((e) => e.type === 'ward' && e.owner === 'a')).toBe(true);
  });

  it('carries nothing through a dodge', () => {
    const { s, a, b } = duel();
    sdeck(a, ['rimeclaw']);
    fire(s, a, 'rimeclaw');
    expect(step(s, 'b', 'right')).toBe(true);
    advance(s, 1000);
    expect(b.hp).toBe(b.maxHp);
    expect(b.stun).toBe(0);
    expect(b.rank.dodges).toBe(1);
  });

  it('names the sufferer on status events', () => {
    const { s, a } = duel();
    sdeck(a, ['rimeclaw']);
    fire(s, a, 'rimeclaw');
    advance(s, 1000);
    expect(s.events.find((e) => e.type === 'stun')).toMatchObject({ owner: 'a', target: 'b' });
  });

  it('shows stun on both plates', () => {
    const { s, a } = duel();
    sdeck(a, ['rimeclaw']);
    fire(s, a, 'rimeclaw');
    advance(s, 1000);
    expect(viewOf(s, 'a').boss.stunMs).toBeGreaterThan(0);
    expect(viewOf(s, 'b').you!.stunMs).toBeGreaterThan(0);
    expect(viewOf(s, 'a').players.find((p) => p.id === 'b')!.stunMs).toBeGreaterThan(0);
  });

  it('shows burn and freeze on the rival plate', () => {
    const burn = duel();
    sdeck(burn.a, ['cindercoat']);
    burn.b.maxHp = 10_000;
    burn.b.hp = 10_000;
    fire(burn.s, burn.a, 'cindercoat');
    advance(burn.s, 1000);
    expect(viewOf(burn.s, 'a').boss.burn).not.toBeNull();
    const chill = duel();
    sdeck(chill.a, ['deepchill']);
    fire(chill.s, chill.a, 'deepchill');
    advance(chill.s, 1000);
    expect(viewOf(chill.s, 'a').boss.freezeMs).toBeGreaterThan(0);
  });
});
