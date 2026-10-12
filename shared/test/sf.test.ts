import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATS,
  LANES,
  MIN_TELEGRAPH_MS,
  addBody,
  busterDamage,
  canPick,
  coverFiles,
  dropFor,
  emptyCustom,
  matchup,
  openCustom,
  openSession,
  partyDepth,
  partySteps,
  pickCard,
  execute,
  rankOf,
  stepChain,
  tick,
  volleyClock,
  type Caps,
  type DuelSession,
  type PartySeat,
} from '../src/sf/index.ts';

/**
 * The Star Force engine, pinned.
 *
 * These tests exist for one reason: the rules live in `shared` so the client and the server
 * cannot disagree, and a rule nobody asserts is a rule that will quietly move.
 */

/** The tick is capped at 500 ms of real time, so tests have to walk it in steps. */
function advance(s: DuelSession, ms: number): void {
  for (let t = 0; t < ms; t += 100) tick(s, 100);
}

const CAPS: Caps = { slots: 3, mega: 1, giga: 1 };

// ---------------------------------------------------------------------------

describe('the element cycle', () => {
  it('is a cycle, so every element has exactly one thing it beats', () => {
    expect(matchup('burn', 'wave')).toBe(2);
    expect(matchup('wave', 'volt')).toBe(2);
    expect(matchup('volt', 'frost')).toBe(2);
    expect(matchup('frost', 'burn')).toBe(2);
  });

  it('reads backwards for what each element loses to', () => {
    expect(matchup('wave', 'burn')).toBe(0.5);
    expect(matchup('burn', 'frost')).toBe(0.5);
  });

  it('treats prism as non-elemental and void as the anti-signal', () => {
    for (const e of ['burn', 'wave', 'volt', 'frost', 'prism'] as const) {
      expect(matchup('prism', e)).toBe(1);
    }
    expect(matchup('void', 'prism')).toBe(2); // the only thing void doubles into
    expect(matchup('void', 'burn')).toBe(1);
  });
});

describe('the element chain', () => {
  it('starts paying on the second card, never the first', () => {
    expect(stepChain(0, null, 'burn')).toBe(0);
    expect(stepChain(0, 'burn', 'burn')).toBe(1);
  });

  it('breaks the moment a different element lands', () => {
    expect(stepChain(3, 'burn', 'frost')).toBe(0);
    expect(stepChain(3, 'burn', 'burn')).toBe(4);
  });
});

// ---------------------------------------------------------------------------

describe('the Custom Screen', () => {
  it('locks the element on the first pick and refuses anything else', () => {
    let s = emptyCustom();
    s = { ...s, hand: [{ cell: 0, row: 0, col: 0, chipId: 'emberpaw' }, { cell: 1, row: 0, col: 1, chipId: 'rimeclaw' }] };
    const first = canPick(s, 0, CAPS);
    expect(first.ok).toBe(true);
    // Emberpaw is burn, so the turn is a burn turn.
    expect(canPick({ ...s, lock: 'burn' }, 1, CAPS).reason).toBe('element');
  });

  it('lets a NULL card into any lock, which is the whole point of NULL', () => {
    const s = { ...emptyCustom(), lock: 'burn' as const, hand: [{ cell: 0, row: 0, col: 0, chipId: 'refract' }] };
    expect(canPick(s, 0, CAPS).ok).toBe(true);
  });

  it('allows one MEGA and one GIGA, and no duplicates', () => {
    const s = {
      ...emptyCustom(),
      hand: [
        { cell: 0, row: 0, col: 0, chipId: 'magmachog' },
        { cell: 1, row: 0, col: 1, chipId: 'glacierhowl' },
        { cell: 2, row: 1, col: 0, chipId: 'emberpaw' },
        { cell: 3, row: 1, col: 1, chipId: 'emberpaw' },
      ],
    };
    // Both are MEGA and the lock is set by the first, so the second is refused twice over.
    expect(canPick({ ...s, lock: 'burn' }, 1, CAPS).ok).toBe(false);
    // Two copies of one card in one turn is never allowed.
    const withEmber = { ...s, queue: [2], lock: 'burn' as const };
    expect(canPick(withEmber, 3, CAPS).reason).toBe('duplicate');
  });

  it('spends the battle\'s one Giga for good', () => {
    const spent = { ...emptyCustom(), gigaSpent: true, hand: [{ cell: 0, row: 0, col: 0, chipId: 'chognova' }] };
    expect(canPick(spent, 0, CAPS).reason).toBe('giga-spent');
  });
});

// ---------------------------------------------------------------------------

describe('the Buster', () => {
  it('is worth exactly ten taps when fully charged', () => {
    expect(busterDamage(true, 1) / busterDamage(false, 1)).toBe(10);
  });

  it('scales with Attack, which is why Attack is the stat it is', () => {
    expect(busterDamage(true, 10)).toBeGreaterThan(busterDamage(true, 1) * 1.7);
  });
});

describe('the reading window', () => {
  it('never drops below the floor, however hard the fight is tuned', () => {
    for (let gap = -8; gap <= 16; gap++) {
      for (let depth = 1; depth <= 6; depth++) {
        for (let phase = 1; phase <= 4; phase++) {
          expect(volleyClock({ phase, levelGap: gap, difficulty: depth }).telegraph)
            .toBeGreaterThanOrEqual(MIN_TELEGRAPH_MS);
        }
      }
    }
  });

  it('gets shorter as the level gap opens, which is the point of the gap', () => {
    const even = volleyClock({ phase: 2, levelGap: 0, difficulty: 1 }).telegraph;
    const under = volleyClock({ phase: 2, levelGap: 12, difficulty: 1 }).telegraph;
    expect(under).toBeLessThan(even);
  });
});

// ---------------------------------------------------------------------------

const seat = (id: string, tokenId: number, gear: PartySeat['gear']): PartySeat => ({
  id,
  owner: `o${id}`,
  tokenId,
  name: id.toUpperCase(),
  element: 'burn',
  level: 10,
  gear,
  voice: {},
});

describe('the party', () => {
  it('grants one step per *distinct* trait, so duplicates are worthless', () => {
    const steps = partySteps([seat('a', 1, 'gauge'), seat('b', 2, 'gauge'), seat('c', 3, 'hp')], 'a');
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.id)).toEqual(['gauge', 'hp']);
  });

  it('names the Chog that granted each step', () => {
    const steps = partySteps([seat('a', 1, 'gauge'), seat('b', 812, 'hp')], 'z');
    expect(steps.map((s) => s.id)).toEqual(['gauge', 'hp']);
    expect(steps[0]!.from.tokenId).toBe(1);
    expect(steps[1]!.from.tokenId).toBe(812);
    expect(steps[1]!.from.name).toBe('B');
  });

  it('counts how deep the party is, not how big', () => {
    expect(partyDepth([seat('a', 1, 'gauge'), seat('b', 2, 'gauge')])).toBe(1);
    expect(partyDepth([seat('a', 1, 'gauge'), seat('b', 2, 'hp')])).toBe(2);
  });

  it('gives a body nothing from its own seat', () => {
    expect(partySteps([seat('a', 1, 'gauge')], 'a')).toHaveLength(0);
  });
});

describe('the Busting Level', () => {
  it('grades the fight, not the kill', () => {
    expect(rankOf(1)).toBe('D');
    expect(rankOf(13)).toBe('SS');
  });

  it('pays in better loot, not more loot', () => {
    const sloppy = dropFor(3);
    const clean = dropFor(13);
    expect(clean.rolls).toBeGreaterThan(sloppy.rolls);
    expect(clean.rareChance).toBeGreaterThan(sloppy.rareChance * 5);
  });
});

// ---------------------------------------------------------------------------

describe('aiming', () => {
  it('is decided by where you stand, not by a grid', () => {
    const dot = [[0, 0]] as const;
    expect(coverFiles(dot, 0, 3)).toEqual([0]);
    expect(coverFiles(dot, 2, 3)).toEqual([2]);
    // A wide card from the edge reaches less than the same card from the middle.
    const wide = [[0, 0], [0, 1], [0, 2]] as const;
    expect(coverFiles(wide, 0, 3)).toEqual([0, 1, 2]);
    expect(coverFiles(wide, 2, 3)).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------

function fight(overrides: Partial<Parameters<typeof addBody>[1]> = {}) {
  const s = openSession({
    id: 'test',
    place: { kind: 'sector', sector: 'ashflat' },
    boss: { name: 'SIM', archetype: 'dummy', hp: 4000, level: 10, difficulty: 1 },
    rand: () => 0.5,
  });
  const body = addBody(s, {
    id: 'p1',
    owner: 'o1',
    name: 'TEST',
    tribe: 'burn',
    level: 10,
    stats: { ...DEFAULT_STATS, attack: 5, hp: 500 },
    folder: ['emberpaw'],
    tokenId: 1,
    ...overrides,
  });
  return { s, body };
}

describe('a duel', () => {
  it('runs a program and lands it on the anomaly', () => {
    const { s, body } = fight();
    openCustom(s, body);
    expect(body.custom).not.toBeNull();
    const cell = body.custom!.hand.find((h) => h.chipId === 'emberpaw')!.cell;
    expect(pickCard(s, 'p1', cell)).toBe(true);
    expect(execute(s, 'p1')).toBe(true);
    advance(s, 600);
    expect(s.field.boss.hp).toBeLessThan(4000);
  });

  it('refuses a pick the screen would have greyed out', () => {
    const { s, body } = fight();
    openCustom(s, body);
    // Cell 99 does not exist.
    expect(pickCard(s, 'p1', 99)).toBe(false);
  });

  it('pays a counter hit double, and pays a card for reading the wind-up', () => {
    const { s, body } = fight();
    // Force a wind-up and hold it open so the shot is fired into it.
    s.boss.next = 0;
    advance(s, 200);
    expect(s.field.hazard).not.toBeNull();
    s.field.hazard!.left = 10_000;

    openCustom(s, body);
    const cell = body.custom!.hand.find((h) => h.chipId === 'emberpaw')!.cell;
    pickCard(s, 'p1', cell);
    execute(s, 'p1');
    advance(s, 600);

    expect(body.busting.counters).toBe(1);
    expect(body.bonus.length).toBe(1); // paid in cards, for the next screen
  });

  it('can be won, and grades the bodies that stood on it', () => {
    const { s, body } = fight();
    for (let i = 0; i < 200 && !s.over; i++) {
      // The hand is on the table from the join; the screen is what you step into to spend it.
      if (body.customOpen) {
        const cell = body.custom!.hand.find((h) => h.chipId === 'emberpaw')?.cell;
        if (cell !== undefined) pickCard(s, 'p1', cell);
        execute(s, 'p1');
      } else {
        openCustom(s, body);
      }
      advance(s, 400);
    }
    expect(s.over).toBe(true);
    expect(s.result).toBe('win');
    expect(s.field.boss.hp).toBe(0);
  });
});

// ---------------------------------------------------------------------------

/** Force one clean strike on a body standing in the centre of a three-file floor. */
function strikeOn(args: { armour?: number; resist?: 'prism' | null }): number {
  const s = openSession({
    id: 'strike',
    place: { kind: 'sector', sector: 'ashflat' },
    boss: { name: 'BARON', archetype: 'baron', hp: 99_999, level: 10, difficulty: 2 },
    rand: () => 0,
  });
  const body = addBody(s, {
    id: 'p1',
    owner: 'o1',
    name: 'TANK',
    tribe: 'prism',
    level: 1,
    stats: { ...DEFAULT_STATS, hp: 10_000, cols: 3, ...(args.armour ? { armour: args.armour } : {}) },
    tokenId: 1,
    ...(args.resist ? { resist: args.resist } : {}),
  });
  body.file = 1;
  body.lane = LANES - 1;

  s.boss.next = 0;
  advance(s, 100);
  const h = s.field.hazard;
  expect(h).not.toBeNull();
  advance(s, h!.total + 200);
  return 10_000 - body.hp;
}

describe('what the token says "no" to', () => {
  it('spends armour before the hit lands', () => {
    const bare = strikeOn({ armour: 0 });
    expect(bare).toBeGreaterThan(0);
    const armoured = strikeOn({ armour: 0.4 });
    expect(armoured).toBeLessThan(bare);
    expect(armoured).toBeGreaterThan(bare * 0.5);
  });

  it('shrugs off the element its Skin carries', () => {
    const bare = strikeOn({ armour: 0 });
    const resisted = strikeOn({ armour: 0, resist: 'prism' }); // baron is prism
    expect(resisted).toBeLessThan(bare);
    expect(resisted).toBeGreaterThan(bare * 0.6);
  });
});
