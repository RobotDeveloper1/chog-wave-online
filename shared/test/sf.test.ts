import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATS,
  DODGE_IFRAME_MS,
  LANES,
  MIN_TELEGRAPH_MS,
  addBody,
  attackScale,
  battleCard,
  canPick,
  chainMultiplier,
  coverFiles,
  dropFor,
  emptyHand,
  matchup,
  openHand,
  openSession,
  partyDepth,
  partySteps,
  pickCard,
  previewDamage,
  execute,
  guardOf,
  rankOf,
  step,
  stepChain,
  tick,
  viewOf,
  volleyClock,
  type Caps,
  type DuelBody,
  type DuelSession,
  type PartySeat,
  BARRIER_CAP,
  BURN_EVERY_MS,
  BURN_TICKS,
  FREEZE_MS,
  cardKind,
  enemyVolleyDamage,
  volleyDamage,
} from '../src/sf/index.ts';
import { CARDS } from '../src/cards.ts';

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

describe('the Hand', () => {
  it('locks the element on the first pick and refuses anything else', () => {
    let s = emptyHand();
    s = { ...s, cells: [{ cell: 0, row: 0, col: 0, cardId: 'emberpaw' }, { cell: 1, row: 0, col: 1, cardId: 'rimeclaw' }] };
    const first = canPick(s, 0, CAPS);
    expect(first.ok).toBe(true);
    // Emberpaw is burn, so the turn is a burn turn.
    expect(canPick({ ...s, lock: 'burn' }, 1, CAPS).reason).toBe('element');
  });

  it('lets a NULL card into any lock, which is the whole point of NULL', () => {
    const s = { ...emptyHand(), lock: 'burn' as const, cells: [{ cell: 0, row: 0, col: 0, cardId: 'refract' }] };
    expect(canPick(s, 0, CAPS).ok).toBe(true);
  });

  it('allows one MEGA and one GIGA, and no duplicates', () => {
    const s = {
      ...emptyHand(),
      cells: [
        { cell: 0, row: 0, col: 0, cardId: 'magmachog' },
        { cell: 1, row: 0, col: 1, cardId: 'glacierhowl' },
        { cell: 2, row: 1, col: 0, cardId: 'emberpaw' },
        { cell: 3, row: 1, col: 1, cardId: 'emberpaw' },
      ],
    };
    // Both are MEGA and the lock is set by the first, so the second is refused twice over.
    expect(canPick({ ...s, lock: 'burn' }, 1, CAPS).ok).toBe(false);
    // Two copies of one card in one turn is never allowed.
    const withEmber = { ...s, queue: [2], lock: 'burn' as const };
    expect(canPick(withEmber, 3, CAPS).reason).toBe('duplicate');
  });

  it('spends the battle\'s one Giga for good', () => {
    const spent = { ...emptyHand(), gigaSpent: true, cells: [{ cell: 0, row: 0, col: 0, cardId: 'chognova' }] };
    expect(canPick(spent, 0, CAPS).reason).toBe('giga-spent');
  });
});

// ---------------------------------------------------------------------------

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
    const steps = partySteps([seat('a', 1, 'charge'), seat('b', 2, 'charge'), seat('c', 3, 'hp')], 'a');
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.id)).toEqual(['charge', 'hp']);
  });

  it('names the Chog that granted each step', () => {
    const steps = partySteps([seat('a', 1, 'charge'), seat('b', 812, 'hp')], 'z');
    expect(steps.map((s) => s.id)).toEqual(['charge', 'hp']);
    expect(steps[0]!.from.tokenId).toBe(1);
    expect(steps[1]!.from.tokenId).toBe(812);
    expect(steps[1]!.from.name).toBe('B');
  });

  it('counts how deep the party is, not how big', () => {
    expect(partyDepth([seat('a', 1, 'charge'), seat('b', 2, 'charge')])).toBe(1);
    expect(partyDepth([seat('a', 1, 'charge'), seat('b', 2, 'hp')])).toBe(2);
  });

  it('gives a body nothing from its own seat', () => {
    expect(partySteps([seat('a', 1, 'charge')], 'a')).toHaveLength(0);
  });
});

describe('the RankStats Level', () => {
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
    deck: ['emberpaw'],
    tokenId: 1,
    ...overrides,
  });
  return { s, body };
}

describe('a duel', () => {
  it('runs a program and lands it on the anomaly', () => {
    const { s, body } = fight();
    openHand(s, body);
    expect(body.hand).not.toBeNull();
    const cell = body.hand!.cells.find((h) => h.cardId === 'emberpaw')!.cell;
    expect(pickCard(s, 'p1', cell)).toBe(true);
    expect(execute(s, 'p1')).toBe(true);
    advance(s, 600);
    expect(s.field.boss.hp).toBeLessThan(4000);
  });

  it('refuses a pick the screen would have greyed out', () => {
    const { s, body } = fight();
    openHand(s, body);
    // Cell 99 does not exist.
    expect(pickCard(s, 'p1', 99)).toBe(false);
  });

  it('pays a counter hit double, and pays a card for reading the wind-up', () => {
    const { s, body } = fight();
    // Force a wind-up and hold it open so the shot is fired into it.
    s.boss.next = 0;
    advance(s, 200);
    expect(s.field.hazards.length).toBe(1);
    s.field.hazards[0]!.left = 10_000;

    openHand(s, body);
    const cell = body.hand!.cells.find((h) => h.cardId === 'emberpaw')!.cell;
    pickCard(s, 'p1', cell);
    execute(s, 'p1');
    advance(s, 600);

    expect(body.rank.counters).toBe(1);
    expect(body.bonus.length).toBe(1); // paid in cards, for the next screen
  });

  it('can be won, and grades the bodies that stood on it', () => {
    const { s, body } = fight();
    for (let i = 0; i < 200 && !s.over; i++) {
      // The hand is on the table from the join; the screen is what you step into to spend it.
      if (body.handOpen) {
        const cell = body.hand!.cells.find((h) => h.cardId === 'emberpaw')?.cell;
        if (cell !== undefined) pickCard(s, 'p1', cell);
        execute(s, 'p1');
      } else {
        openHand(s, body);
      }
      advance(s, 400);
    }
    expect(s.over).toBe(true);
    expect(s.result).toBe('win');
    expect(s.field.boss.hp).toBe(0);
  });
});

describe('seamless movement with the Hand open', () => {
  it(
    'steps out of the safe room: moves, closes the screen, drops the shield, keeps the hand',
    () => {
      const { s, body } = fight();
      body.file = 2;
      openHand(s, body);
      expect(body.handOpen).toBe(true);
      expect(step(s, 'p1', 'left')).toBe(true);
      expect(body.file).toBe(1);
      expect(body.handOpen).toBe(false);
      expect(body.hand).not.toBeNull();
      expect(body.charge).toBe(0);
      expect(viewOf(s, 'p1').you).toMatchObject({ frozen: false, shielded: false });
    },
  );

  it('still locks the boots while a program is in flight', () => {
    const { s, body } = fight();
    body.file = 2;
    openHand(s, body);
    const cell = body.hand!.cells.find((h) => h.cardId === 'emberpaw')!.cell;
    expect(pickCard(s, 'p1', cell)).toBe(true);
    expect(execute(s, 'p1')).toBe(true);
    expect(body.program).not.toBeNull();
    expect(step(s, 'p1', 'left')).toBe(false);
    expect(body.file).toBe(2);
  });

  it('does not snap the screen straight back open after stepping out', () => {
    const { s, body } = fight();
    body.file = 2;
    openHand(s, body);
    step(s, 'p1', 'left');
    advance(s, 400);
    expect(body.handOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('the dodge', () => {
  /** A held strike standing on one panel, so a step can be judged against it. */
  const hold = (s: DuelSession, file: number, lane: number): void => {
    s.field.hazards = [{ panels: [{ file, lane }], files: [file], left: 150, total: 150,
      move: 'JAB', label: 'TEST JAB', damage: 500, on: ['p1'], owner: null, drain: 0 }];
  };

  it('earns a short invulnerability when the step escapes the panel under it', () => {
    const { s, body } = fight();
    body.file = 1; body.lane = LANES - 1;
    hold(s, 1, LANES - 1);
    expect(body.invuln).toBe(0);
    expect(step(s, 'p1', 'left')).toBe(true);
    expect(body.invuln).toBe(DODGE_IFRAME_MS);
    // The held strike lands inside the grace window, so it cannot touch the body that escaped.
    const hp = body.hp;
    advance(s, 400);
    expect(body.hp).toBe(hp);
    expect(body.rank.dodges).toBe(1);
  });

  it('earns nothing for a step that never leaves a marked panel', () => {
    const { s, body } = fight();
    body.file = 1; body.lane = LANES - 1;
    hold(s, 2, LANES - 1);        // the danger is over there; this step is just walking
    step(s, 'p1', 'left');
    expect(body.invuln).toBe(0);
  });

  it('earns nothing for a step into the marked panel', () => {
    const { s, body } = fight();
    body.file = 1; body.lane = LANES - 1;
    hold(s, 2, LANES - 1);
    step(s, 'p1', 'right');       // stepping onto the danger
    expect(body.file).toBe(2);
    expect(body.invuln).toBe(0);
    // And it really is danger: the held strike takes the HP for it.
    advance(s, 400);
    expect(body.hp).toBeLessThan(500);
  });

  it('reports the grace window to the client, and only while it is live', () => {
    const { s, body } = fight();
    body.file = 1; body.lane = LANES - 1;
    hold(s, 1, LANES - 1);
    // Standing still: the readout exists (so the HUD can draw the bar) and is empty (so it is not).
    const idle = viewOf(s, 'p1');
    expect(idle.you?.dodge.graceMs).toBe(DODGE_IFRAME_MS);
    expect(idle.you?.dodge.iframeMs).toBe(0);

    step(s, 'p1', 'left');
    expect(viewOf(s, 'p1').you?.dodge.iframeMs).toBe(DODGE_IFRAME_MS);

    // It drains with the clock and never goes negative, so the bar cannot render inverted.
    advance(s, DODGE_IFRAME_MS + 50);
    expect(viewOf(s, 'p1').you?.dodge.iframeMs).toBe(0);
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
  const h = s.field.hazards[0] ?? null;
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

describe('the damage preview', () => {
  // The screen prices a program with this; the field fires with this. If the two ever
  // disagree the player is lied to, so the composition is pinned factor by factor — and
  // then checked against a real shot, which is the only assertion that matters.
  const shot = { might: 100, kind: 'shot' as const, element: 'burn' as const };
  const base = {
    chain: 0,
    lastElement: null as null,
    attack: 5,
    bossElement: 'wave' as const,
    counter: false,
    linkMult: 1,
    guard: 0,
  };

  it('prices attack, element and chain the way the field does', () => {
    const pv = previewDamage(shot, base);
    expect(pv.element).toBe('burn');
    expect(pv.run).toBe(0);
    expect(pv.damage).toBe(
      Math.max(1, Math.round(100 * attackScale(5) * matchup('burn', 'wave') * chainMultiplier(0))),
    );
    // Continuing a run pays the chain step the field would pay.
    const cont = previewDamage(shot, { ...base, chain: 1, lastElement: 'burn' });
    expect(cont.run).toBe(2);
    expect(cont.damage).toBe(
      Math.max(1, Math.round(100 * attackScale(5) * matchup('burn', 'wave') * chainMultiplier(2))),
    );
    expect(cont.damage).toBeGreaterThan(pv.damage);
  });

  it('doubles on a counter and lets the guard eat every non-piercing card', () => {
    const plain = previewDamage(shot, base).damage;
    expect(previewDamage(shot, { ...base, counter: true }).damage).toBe(
      Math.max(1, Math.round(2 * 100 * attackScale(5) * matchup('burn', 'wave') * chainMultiplier(0))),
    );
    const guarded = previewDamage(shot, { ...base, guard: 0.5 }).damage;
    expect(guarded).toBeLessThan(plain);
    const sword = { ...shot, kind: 'sword' as const };
    expect(previewDamage(sword, { ...base, guard: 0.5 }).damage).toBe(plain);
    const breaker = { ...shot, kind: 'break' as const };
    expect(previewDamage(breaker, { ...base, guard: 0.5 }).damage).toBe(plain);
  });

  it('inherits the running element on a CHAIN card, and never pays less than one', () => {
    const chained = { might: 100, kind: 'chain' as const, element: 'volt' as const };
    expect(previewDamage(chained, { ...base, lastElement: 'burn' }).element).toBe('burn');
    expect(previewDamage(chained, base).element).toBe('volt');
    const scratch = { might: 1, kind: 'shot' as const, element: 'wave' as const };
    const resisted = { ...base, bossElement: 'burn' as const, attack: 1, guard: 0.9 };
    expect(previewDamage(scratch, resisted).damage).toBe(1);
  });

  it('is exactly what the field fires: no drift between screen and session', () => {
    const { s, body } = fight();
    // No wind-up while the program is in the air: the counter flag must be the same
    // at preview time and at fire time, or the comparison proves nothing.
    s.boss.next = 100_000;
    openHand(s, body);
    const cell = body.hand!.cells.find((h) => h.cardId === 'emberpaw')!.cell;
    const card = battleCard('emberpaw')!;
    const chainBefore = body.chain;
    const lastBefore = body.lastElement;
    const counterBefore = s.field.hazards.length > 0;
    expect(pickCard(s, 'p1', cell)).toBe(true);
    expect(execute(s, 'p1')).toBe(true);
    // The program fires on the ticks, not on the execute: catch the shot mid-flight.
    let shotFired = null as (typeof s.field.shots)[number] | null;
    for (let t = 0; t < 3000 && !shotFired; t += 50) {
      tick(s, 50);
      shotFired = s.field.shots.at(-1) ?? null;
    }
    expect(shotFired?.cardId).toBe('emberpaw');
    const pv = previewDamage(card, {
      chain: chainBefore,
      lastElement: lastBefore,
      attack: body.stats.attack,
      bossElement: s.field.boss.element,
      counter: counterBefore,
      linkMult: body.link?.mult ?? 1,
      guard: guardOf(s),
    });
    expect(shotFired!.damage).toBe(pv.damage);
  });

  it('tells the screen the running element, so a preview can start the chain', () => {
    const { s, body } = fight();
    expect(viewOf(s, 'p1').you?.lastElement).toBeNull();
    s.boss.next = 100_000;
    openHand(s, body);
    const cell = body.hand!.cells.find((h) => h.cardId === 'emberpaw')!.cell;
    pickCard(s, 'p1', cell);
    execute(s, 'p1');
    for (let t = 0; t < 3000 && s.field.shots.length === 0; t += 50) tick(s, 50);
    expect(s.field.shots.length).toBeGreaterThan(0);
    expect(viewOf(s, 'p1').you?.lastElement).toBe(battleCard('emberpaw')!.element);
  });
});

describe('the new verbs', () => {
  function fire(s: DuelSession, body: DuelBody, cardId: string): void {
    openHand(s, body);
    const cell = body.hand!.cells.find((h) => h.cardId === cardId)!.cell;
    expect(pickCard(s, body.id, cell)).toBe(true);
    expect(execute(s, body.id)).toBe(true);
  }

  function until(s: DuelSession, ms: number, cond: () => boolean): void {
    for (let t = 0; t < ms && !cond(); t += 100) tick(s, 100);
    expect(cond()).toBe(true);
  }

  it('burns: ticks of damage after the hit, refreshed by the next landing', () => {
    const { s, body } = fight({ deck: ['cindercoat'] });
    fire(s, body, 'cindercoat');
    until(s, 2000, () => s.boss.burn !== null);
    expect(s.boss.burn).toMatchObject({ ticks: BURN_TICKS });
    expect(viewOf(s, 'p1').boss.burn).toMatchObject({ ticks: BURN_TICKS });
    const per = s.boss.burn!.damage;
    const hp0 = s.field.boss.hp;
    advance(s, BURN_EVERY_MS * BURN_TICKS + 200);
    expect(s.field.boss.hp).toBe(hp0 - BURN_TICKS * per);
    expect(s.boss.burn).toBeNull();
    // A second landing while it still burns starts the count over, it does not stack.
    fire(s, body, 'cindercoat');
    until(s, 2000, () => s.boss.burn !== null);
    advance(s, BURN_EVERY_MS + 100);
    expect(s.boss.burn!.ticks).toBe(BURN_TICKS - 1);
    fire(s, body, 'cindercoat');
    until(s, 2000, () => s.boss.burn !== null && s.boss.burn.ticks === BURN_TICKS);
    const hp1 = s.field.boss.hp;
    const per1 = s.boss.burn!.damage;
    advance(s, BURN_EVERY_MS * BURN_TICKS + 200);
    expect(s.field.boss.hp).toBe(hp1 - BURN_TICKS * per1);
  });

  it('freezes: the whole clock runs slow while it lasts', () => {
    const { s, body } = fight({ tribe: 'frost', deck: ['deepchill'] });
    fire(s, body, 'deepchill');
    until(s, 2000, () => s.boss.freeze > 0);
    expect(s.boss.freeze).toBeGreaterThan(0);
    expect(s.boss.freeze).toBeLessThanOrEqual(FREEZE_MS);
    expect(viewOf(s, 'p1').boss.freezeMs).toBe(s.boss.freeze);
    s.boss.freeze = 1000;
    s.boss.next = 10_000;
    s.field.hazards = [];
    advance(s, 400);
    expect(s.boss.next).toBe(10_000 - 200);
    s.boss.freeze = 0;
    advance(s, 400);
    expect(s.boss.next).toBe(10_000 - 200 - 400);
  });

  it('wards: a barrier charge eats one landed hit, then it is gone', () => {
    const { s, body } = fight({ tribe: 'prism', deck: ['aegisnap'] });
    fire(s, body, 'aegisnap');
    until(s, 2000, () => body.barrier === 1);
    expect(viewOf(s, 'p1').players.find((p) => p.id === 'p1')!.barrier).toBe(1);
    const strike = (): void => {
      s.boss.next = 0;
      advance(s, 200);
      expect(s.field.hazards.length).toBe(1);
      const panel = s.field.hazards[0]!.panels[0]!;
      body.file = panel.file;
      body.lane = panel.lane;
      body.handOpen = false;
      s.field.hazards[0]!.left = 1;
      advance(s, 100);
    };
    const hp0 = body.hp;
    strike();
    expect(body.barrier).toBe(0);
    expect(body.hp).toBe(hp0);
    expect(s.events.some((e) => e.type === 'ward')).toBe(true);
    strike();
    expect(body.hp).toBeLessThan(hp0);
  });

  it('caps barrier charges instead of stacking forever', () => {
    const { s, body } = fight({ tribe: 'prism', deck: ['aegisnap'] });
    for (let i = 0; i < BARRIER_CAP + 1; i++) {
      fire(s, body, 'aegisnap');
      advance(s, 800);
    }
    expect(body.barrier).toBe(BARRIER_CAP);
  });

  it('spells the new verbs on the card face', () => {
    expect(cardKind(CARDS.find((c) => c.id === 'cindercoat')!)).toBe('burn');
    expect(cardKind(CARDS.find((c) => c.id === 'whiteout')!)).toBe('freeze');
    expect(cardKind(CARDS.find((c) => c.id === 'aegisnap')!)).toBe('barrier');
    expect(battleCard('slagmaw')!.kind).toBe('burn');
    expect(battleCard('tidewall')!.kind).toBe('barrier');
  });

  it('deals the new cards from the same shelf the pools read', () => {
    const byId = new Map(CARDS.map((c) => [c.id, c]));
    const want: [string, string | undefined][] = [
      ['cindercoat', undefined], ['slagmaw', 'M'], ['deepchill', undefined],
      ['whiteout', 'M'], ['aegisnap', undefined], ['tidewall', 'M'],
    ];
    for (const [id, klass] of want) expect(byId.get(id)?.klass).toBe(klass);
  });

  it('scales volley damage by the level gap, and changes nothing at zero', () => {
    expect(enemyVolleyDamage(2, 'node', undefined)).toBe(volleyDamage(2, 'node'));
    const base = enemyVolleyDamage(2, 'node', undefined);
    expect(enemyVolleyDamage(2, 'node', undefined, undefined, 5)).toBeGreaterThan(base);
    expect(enemyVolleyDamage(2, 'node', undefined, undefined, -8)).toBeLessThan(base);
    expect(enemyVolleyDamage(2, 'node', undefined, undefined, 100))
      .toBe(enemyVolleyDamage(2, 'node', undefined, undefined, 10));
    expect(enemyVolleyDamage(2, 'node', 999)).toBeGreaterThan(enemyVolleyDamage(2, 'node', undefined));
  });
});
