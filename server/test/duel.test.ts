import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CARDS, SF, cityOf, isBasicId, nodeBudget, partyHpScale, startRun,
  type Boss, type DataArea, type DuelEndMsg, type DuelMsg, type SectorState,
} from '@chog/shared';
import { BattleSession, type DuelBossSpec, type JoinSpec } from '../src/battle.ts';

const spec = (over: Partial<DuelBossSpec> = {}): DuelBossSpec => ({
  name: 'TEST SPARK', hp: 10_000, maxHp: 10_000, element: 'frost',
  archetype: 'spark', node: true, tier: 'node', level: 2, ...over,
});
const joinSpec = (over: Partial<JoinSpec> = {}): JoinSpec => ({
  stats: { ...SF.DEFAULT_STATS }, tokenId: 1, aggro: 0, resist: null,
  deck: ['emberpaw', 'rimeclaw', 'staticnip', 'hoarbar', 'undertow', 'refract'],
  // The neutral mid-range Chog, so a test that is not measuring the gap between a common and a
  // Legendary is not quietly measuring it. `sf/loadout.ts basicMight`.
  basic: SF.basicCard('burn', SF.basicMight({ PWR: 4, SPD: 4 })),
  level: 2, ...over,
});
function field(over: Partial<DuelBossSpec> = {}) {
  const s = new BattleSession('test', 'ashflat', spec(over), () => 0.5);
  s.join({ id: 'a', name: 'ALICE', tribe: 'burn' }, joinSpec());
  return s;
}
function advance(s: BattleSession, ms: number, sectors: SectorState[] = []): SF.FieldEvent[] {
  const events: SF.FieldEvent[] = [];
  for (let left = ms; left > 0; left -= 50) events.push(...s.step(Math.min(50, left), sectors).events);
  return events;
}
function until(s: BattleSession, pred: (e: SF.FieldEvent) => boolean): SF.FieldEvent[] {
  const all: SF.FieldEvent[] = [];
  for (let t = 0; t < 20_000; t += 50) {
    const events = s.step(50, []).events;
    all.push(...events);
    if (events.some(pred)) return all;
  }
  throw new Error('expected field event did not occur');
}
function hazard(s: BattleSession, ids: string[], damage = 1, left = 50): void {
  const panels = ids.map((id) => {
    const b = s.bodyOf(id)!;
    return { file: b.file, lane: b.lane };
  });
  s.field.hazards = [{ panels, files: [...new Set(panels.map((p) => p.file))],
    left, total: left, move: 'jab', label: 'TEST JAB', damage, on: ids, owner: null, drain: 0 }];
}
// Keep long lifecycle fixtures out of unrelated boss attacks and automatic menus.
function pauseAttacks(s: BattleSession): void {
  s.state.boss.next = 100_000;
  // A telegraph already in the air still lands: the clock only refuses to raise new ones, and a
  // strike mid-revive knocks the rescuer down, which cancels the hold under test.
  s.field.hazards = [];
  for (const b of s.state.players) { b.chargeMs = 100_000; b.charge = 0; }
}
function sectorFixture(hp = 1_000) {
  const boss: Boss = { id: 'original', tier: 'glitch', hp, maxHp: hp, spawnedAt: 10, phase: 1 };
  const sector: SectorState = { sector: 'ashflat', boss, wave: 60, peakWave: 60,
    tier: 'glitch', lockoutUntil: 0, spawned: 1, cleared: 0 };
  const make = (id: string) => {
    const s = new BattleSession(id, 'ashflat', spec({ node: false, tier: 'glitch', hp, maxHp: hp, source: boss }));
    s.join({ id, wallet: id }, joinSpec());
    return s;
  };
  return { boss, sector, sectors: [sector], make };
}

let dir: string;
let World: typeof import('../src/world.ts').World;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-duel-sf-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  ({ World } = await import('../src/world.ts'));
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); }
  catch { /* SQLite handles can remain open on Windows. */ }
});
let nextToken = 7000;
type Receipt = DuelEndMsg & { xp: number; wav: number; first?: boolean; refunded: { id: string; wav: number }[] };
function seat(world: InstanceType<typeof World>, wallet: string | null = null) {
  const tokenId = nextToken++;
  const p = world.join(`p${tokenId}`, { tokenId, transferCount: 0, daysHeld: 0 }, 'ashflat', wallet);
  const msgs: Record<string, unknown>[] = [];
  world.onPush(p.id, (m) => msgs.push(m));
  const station = cityOf('ashflat').anchors.find((a) => a.kind === 'door' && a.sub === 'station')!;
  p.x = station.x + 1; p.y = station.z;
  return { world, p, id: p.id, msgs,
    last: (kind: string) => [...msgs].reverse().find((m) => m.t === 'duel' && m.kind === kind)!,
    end: () => [...msgs].reverse().find((m) => m.t === 'duel' && m.kind === 'end') as unknown as Receipt | undefined };
}
function arena() { return seat(new World()); }
function training() {
  const a = arena();
  a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'train' });
  const s = a.world.sessionOf(a.id)!;
  return { ...a, s, b: s.bodyOf(a.id)! };
}
function worldAdvance(world: InstanceType<typeof World>, ms: number): void {
  for (let left = ms; left > 0; left -= 50) world.stepSessions(Math.min(50, left));
}
function ready(a: ReturnType<typeof training>, deck = ['emberpaw']): void {
  a.b.deck = deck;
  a.s.state.boss.next = 100_000;
  // The hand is dealt on arrival, so a test that names its deck has the old one discarded before
  // the charge fills and the screen opens on exactly the cards it asked for.
  a.b.hand = null;
  a.b.handOpen = false;
  a.b.charge = 0;
  worldAdvance(a.world, a.b.chargeMs - a.b.charge);
  expect(a.b.hand!.cells).toHaveLength(6);
}
// The Buster is gone, so a tap is a refused wire call: it fires nothing and hurts nothing.
function tap(a: ReturnType<typeof seat>): void {
  a.world.duel(a.id, { t: 'duel', action: 'buster', down: true } as unknown as DuelMsg);
  a.world.duel(a.id, { t: 'duel', action: 'buster', down: false } as unknown as DuelMsg);
}
// Fire one real card through the engine: open the hand, take the first legal cell, fire it.
function fireCardHit(st: SF.DuelSession, id: string): void {
  const body = st.players.find((p) => p.id === id)!;
  body.file = st.field.boss.file;
  SF.openHand(st, body);
  const hand = body.hand!;
  const cell = hand.cells.find((c) => SF.canPick(hand, c.cell, SF.capsOf(body)).ok);
  expect(cell, 'a pickable card').toBeDefined();
  expect(SF.pickCard(st, id, cell!.cell)).toBe(true);
  expect(SF.execute(st, id)).toBe(true);
}
// Kill the aligned anomaly with a real card — the only damage path left after the Buster was cut.
// It drops the anomaly to 1 HP on the shooter's own file (so a covering shot is guaranteed), opens
// the safe room if it isn't already, taps the first card (which fires it), and runs the clock until
// the shot lands.
function fireKill(a: ReturnType<typeof seat>): void {
  const s = a.world.sessionOf(a.id)!;
  const body = s.bodyOf(a.id)!;
  s.field.boss.hp = Math.min(s.field.boss.hp, 1);
  s.state.boss.next = 100_000;
  s.field.hazards = [];
  // The server no longer serves the removed Buster action, so a test that
  // must land one authoritative hit goes through the engine primitive instead of the refused wire
  // call. The body has to be able to act: out of the safe room and with no program mid-flight.
  body.handOpen = false;
  body.program = null;
  fireCardHit(s.state, body.id);
  for (let t = 0; t < 2000 && s.state.result == null; t += 100) a.world.stepSessions(100);
}
function finish(a: ReturnType<typeof seat>): Receipt {
  const s = a.world.sessionOf(a.id)!;
  s.field.boss.hp = 1;
  fireKill(a);
  const end = a.end();
  expect(end?.won).toBe(true);
  return end!;
}
function dungeon(a: ReturnType<typeof seat>, hp = 73) {
  const stats = SF.duelStatsOf({ loadout: a.p.build.loadout, level: a.p.level });
  const area: DataArea = {
    id: `area-${a.id}`, dungeonId: 'd-ember', name: 'TEST FOLD', tier: 1, seed: 1,
    sector: 'ashflat', rows: 2, entryId: 'gate', bossId: 'enemy',
    nodes: [
      { id: 'gate', kind: 'gate', row: 0, col: 0, links: ['enemy'], label: 'MOUTH' },
      { id: 'enemy', kind: 'wave', row: 1, col: 0, links: ['gate'], label: 'CONTACT',
        enemy: { name: 'TEST WAVE', element: 'burn', hp: 400, power: 8, archetype: 'spark' } },
    ],
  };
  const doc = a.world.profiles.doc(a.p.tokenId);
  doc.area = area; doc.run = { ...startRun(area, stats.hp), hp };
  return { doc, area };
}

// These tests exercise the wrapper's real SF state, never the removed roster/placement APIs.
describe('SF field authority', () => {
  it('warns with marked panels before the strike, and does not hit during the warning', () => {
    const s = field();
    const warn = until(s, (e) => e.type === 'telegraph').find((e) => e.type === 'telegraph')!;
    expect(warn.panels.length).toBeGreaterThan(0);
    expect(warn.ms).toBeGreaterThanOrEqual(SF.MIN_TELEGRAPH_MS);
    const during = advance(s, warn.ms - 50);
    expect(during.some((e) => e.type === 'strike' || e.type === 'took-hit')).toBe(false);
    expect(s.step(50, []).events.some((e) => e.type === 'strike')).toBe(true);
  });

  it('awards a dodge only to a body that steps out of the marked panels, not a passive bystander', () => {
    const s = field(); s.join({ id: 'b' }, joinSpec()); pauseAttacks(s);
    s.bodyOf('b')!.file = 0;
    hazard(s, ['a'], 20, 100);
    const hp = s.hpOf('a')!.hp;
    SF.step(s.state, 'a', 'back');
    const events = advance(s, 100);
    expect(events).toContainEqual({ type: 'dodge', owner: 'a', file: s.bodyOf('a')!.file });
    expect(events.some((e) => e.type === 'dodge' && e.owner === 'b')).toBe(false);
    expect(s.bodyOf('a')!.rank.dodges).toBe(1);
    expect(s.hpOf('a')!.hp).toBe(hp);
    expect(events.some((e) => e.type === 'took-hit')).toBe(false);
  });

  it('protects a body in Hand without crediting a passive nonhit as a dodge', () => {
    const s = field(); const b = s.bodyOf('a')!;
    SF.openHand(s.state, b);
    const hp = b.hp;
    hazard(s, ['a'], 20);
    s.field.hazards[0]!.on = [];
    const events = s.step(50, []).events;
    expect(b.hp).toBe(hp);
    expect(events.some((e) => e.type === 'took-hit' || e.type === 'dodge')).toBe(false);
    expect(b.rank.dodges).toBe(0);
  });

  it('widens without moving existing bodies, and never shrinks file indices on departure', () => {
    const s = field();
    const file = s.bodyOf('a')!.file;
    s.join({ id: 'b' }, joinSpec({ stats: { ...SF.DEFAULT_STATS, cols: 6 } }));
    expect(s.field.cols).toBe(6);
    expect(s.bodyOf('a')!.file).toBe(file);
    s.leave('b');
    expect(s.field.cols).toBe(6);
  });

  it('preserves damage while dungeon body-count scaling grows and shrinks the HP pool', () => {
    const s = field({ hp: 1_000, maxHp: 1_000, partyHp: 'node' });
    pauseAttacks(s);
    fireCardHit(s.state, 'a');
    advance(s, 1500);
    const damage = s.damageOf('a');
    expect(damage).toBeGreaterThan(0);
    s.join({ id: 'b', wallet: 'other' }, joinSpec());
    expect(s.field.boss.maxHp).toBe(Math.round(1_000 * partyHpScale(2, 'node')));
    expect(s.field.boss.maxHp - s.field.boss.hp).toBe(damage);
    s.leave('b');
    expect(s.field.boss.maxHp).toBe(1_000);
    expect(s.field.boss.hp).toBe(1_000 - damage);
  });

  it('changes capacity and charge timing without healing or losing charge fraction', () => {
    const s = field(); const b = s.bodyOf('a')!;
    b.hp = 71; b.charge = b.chargeMs / 2;
    s.setStats('a', { ...b.stats, hp: 400, charge: 5 });
    expect(s.hpOf('a')).toEqual({ hp: 71, maxHp: 400 });
    expect(b.charge / b.chargeMs).toBeCloseTo(0.5, 3);
    s.setStats('a', { ...b.stats, hp: 60 });
    expect(s.hpOf('a')).toEqual({ hp: 60, maxHp: 60 });
  });

  it('passes the dungeon budget through to the actual strike damage', () => {
    const power = nodeBudget(3, { kind: 'node' }).power;
    const s = field({ power });
    const b = s.bodyOf('a')!; b.hp = b.maxHp = 10_000;
    const warn = until(s, (e) => e.type === 'telegraph').find((e) => e.type === 'telegraph')!;
    expect(warn.damage).toBe(SF.enemyVolleyDamage(1, 'node', power, 'spark'));
    b.file = warn.panels[0]!.file; b.lane = warn.panels[0]!.lane;
    const events = advance(s, warn.ms);
    expect(events.find((e) => e.type === 'took-hit')).toMatchObject({ damage: warn.damage });
    expect(b.hp).toBe(10_000 - warn.damage);
  });
});

describe('authoritative duel routing', () => {
  it('requires physical station proximity, and never invents a missing anomaly', () => {
    const a = arena(); a.p.x = -100; a.p.y = 40;
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'train' });
    expect(a.last('refused').reason).toMatch(/Wave Station/);
    expect(a.world.sessionOf(a.id)).toBeNull();
    const b = arena(); b.world.duel(b.id, { t: 'duel', action: 'enter', mode: 'anomaly' });
    expect(b.last('refused').reason).toMatch(/quiet/);
    expect(b.world.sessionOf(b.id)).toBeNull();
  });

  it('starts with an SF view and treats a repeated compatible enter as idempotent', () => {
    const a = training();
    expect(a.last('start')).toMatchObject({ place: { kind: 'train', sector: 'ashflat' },
      caps: SF.capsOf(a.b), view: { boss: { training: true, archetype: 'dummy' } } });
    a.b.hp -= 30;
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'train' });
    expect(a.world.sessionOf(a.id)).toBe(a.s);
    expect(a.s.size).toBe(1);
    expect(a.b.hp).toBe(a.b.maxHp - 30);
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'anomaly' });
    expect(a.last('refused').reason).toMatch(/leave the current field/);
  });

  it('steps exactly one panel on both axes and clamps the player side of the grid', () => {
    const a = training(); const initial = a.b.file;
    const step = (dir: NonNullable<DuelMsg['dir']>) => a.world.duel(a.id, { t: 'duel', action: 'step', dir });
    step('left'); expect(a.b.file).toBe(initial - 1);
    step('right'); expect(a.b.file).toBe(initial);
    step('back'); expect(a.b.lane).toBe(3);
    step('back'); expect(a.b.lane).toBe(3);
    step('forward'); expect(a.b.lane).toBe(4);
    step('forward'); expect(a.b.lane).toBe(4);
    for (let i = 0; i < 10; i++) step('right');
    expect(a.b.file).toBe(a.s.field.cols - 1);
    for (let i = 0; i < 10; i++) step('left');
    expect(a.b.file).toBe(0);
    expect(a.s.view(a.id).you).toMatchObject({ file: 0, lane: 4 });
  });

  it('rejects invalid directions and actions without modifying the field', () => {
    const a = training(); const before = { file: a.b.file, lane: a.b.lane, hp: a.s.field.boss.hp };
    a.world.duel(a.id, { t: 'duel', action: 'step', dir: 'teleport' } as unknown as DuelMsg);
    expect(a.last('refused').reason).toBe('invalid step');
    a.world.duel(a.id, { t: 'duel', action: 'open' } as unknown as DuelMsg);
    expect(a.last('refused').reason).toBe('unsupported duel action');
    expect({ file: a.b.file, lane: a.b.lane, hp: a.s.field.boss.hp }).toEqual(before);
  });

  it('opens Hand automatically on server time; stepping out closes the safe room', () => {
    const a = training();
    // The hand is on the table from the join; the screen, the picking and the safe room are not.
    expect(a.b.hand).not.toBeNull();
    expect(a.b.handOpen).toBe(false);
    a.world.duel(a.id, { t: 'duel', action: 'pick', cell: 0 });
    expect(a.last('pick')).toMatchObject({ ok: false, reason: 'closed' });
    ready(a);
    expect(a.s.view(a.id).you).toMatchObject({ frozen: true, shielded: true });
    // Seamless movement: the body walks out of the safe room instead of being refused.
    a.b.file = 2;
    a.world.duel(a.id, { t: 'duel', action: 'step', dir: 'left' }); tap(a);
    expect(a.b.file).toBe(1);
    expect(a.b.handOpen).toBe(false);
    expect(a.b.hand).not.toBeNull();
    expect(a.b.charge).toBe(0);
    expect(a.s.view(a.id).you).toMatchObject({ frozen: false, shielded: false });
    expect(a.last('refused').reason).toBe('unsupported duel action');
  });

  it('deals the persisted chosen deck, not an obsolete token-born hand', () => {
    const a = arena();
    const granted = ['glacierhowl', 'stormchomp', 'tsunamichog', 'magmachog', 'chognova', 'signaldeath'];
    a.world.profiles.grant(a.p.tokenId, { cards: granted.filter((id) => !a.p.build.library.includes(id)) });
    const saved = a.world.loop(a.id, { action: 'deck.auto' });
    expect(saved.ok).toBe(true);
    const deck = a.world.profiles.deckFor(a.p.tokenId, a.p.build);
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'train' });
    const s = a.world.sessionOf(a.id)!; const b = s.bodyOf(a.id)!;
    expect(b.deck).toEqual(deck);
    s.state.boss.next = 100_000;
    worldAdvance(a.world, b.chargeMs - b.charge);
    // Every cell is either the deck the player saved or the token's basic attack — never a card
    // from an obsolete token-born hand, which is what this test is actually about. It used to be
    // `every(c => deck.includes(c.cardId))`, which cannot hold any more: a two-slot deck
    // cannot fill a six-cell panel, and the cells it cannot fill are the whole point.
    const hand = b.hand!.cells;
    expect(hand).toHaveLength(6);
    expect(hand.every((c) => deck.includes(c.cardId) || isBasicId(c.cardId))).toBe(true);
    // And the basics carry the token's own number, not the catalogue's placeholder.
    for (const c of hand) {
      if (!isBasicId(c.cardId)) continue;
      expect(c.might).toBe(a.p.build.basicMight);
      expect(c.might).toBeGreaterThan(1);
    }
  });

  it('rejects an over-full deck and a card outside the collection', () => {
    const a = arena();
    // Over-full is the deck rule now. Under-full is not: a Chog that has cleared one
    // encounter of the Line holds one card and has two slots, and that is a legal deck.
    // See `shared/test/deck.test.ts` and `docs/THE-LINE.md` §4.4.
    const over = a.world.loop(a.id, { action: 'deck.save', cards: Array(9).fill(a.p.build.signature) });
    expect(over.ok).toBe(false); expect((over.errors as string[]).join(' ')).toMatch(/holds 2 cards/);
    const deck = [...a.world.profiles.deckFor(a.p.tokenId, a.p.build)];
    const stranger = ['glacierhowl', 'stormchomp', 'tsunamichog', 'chognova'].find((id) => !a.p.build.library.includes(id))!;
    deck.push(stranger);
    const unowned = a.world.loop(a.id, { action: 'deck.save', cards: deck });
    expect(unowned.ok).toBe(false); expect((unowned.errors as string[]).join(' ')).toMatch(/collection/);
  });

  it('repairs the deck after a sale and refuses duplicate sale or buying a birth card', () => {
    const a = arena();
    const extra = ['glacierhowl', 'stormchomp', 'tsunamichog', 'staticnip', 'rimeclaw', 'refract'].find((id) =>
      !a.p.build.library.includes(id) && SF.battleCard(id)!.element !== a.p.build.loadout.weakness)!;
    a.world.profiles.grant(a.p.tokenId, { cards: [extra] });
    // The Line is what pays for deck room, so walk two regions before expecting the
    // auto-deck to have anywhere to put the card the grant just handed over.
    a.world.profiles.lineCleared(a.p.tokenId, ['tolls.1'], a.p.build);
    a.world.loop(a.id, { action: 'deck.auto' });
    expect(a.world.profiles.sell(a.p.tokenId, extra, [a.p.build.signature]).ok).toBe(true);
    expect(a.world.profiles.sell(a.p.tokenId, extra, [a.p.build.signature]).ok).toBe(false);
    const deck = a.world.profiles.deckFor(a.p.tokenId, a.p.build);
    expect(deck).not.toContain(extra);
    expect(deck.length).toBe(a.world.profiles.slots(a.p.tokenId));
    expect(deck.length).toBeGreaterThanOrEqual(2);
    expect(a.world.profiles.buy(a.p.tokenId, 'ashflat', 'card', a.p.build.library[0]!, 3000, Date.now(), a.p.build.library).ok).toBe(false);
  });

  it.each([
    { action: 'fire', placements: [{ cardId: 'signaldeath', row: 0, col: 1 }] },
    { action: 'laser' }, { action: 'fire', queue: [0] },
    { action: 'execute', queue: [0] }, { action: 'pick', cell: 0, placements: [] },
    { action: 'step', dir: 'right', col: 2 }, { action: 'move', col: 2 },
    { action: 'enter', mode: 'train', placements: [] },
  ])('rejects forged legacy packet %j without side effects', (packet) => {
    const a = training(); const hp = a.s.field.boss.hp; const file = a.b.file;
    a.world.duel(a.id, { t: 'duel', ...packet } as unknown as DuelMsg);
    expect(a.last('refused')).toBeTruthy();
    expect(a.s.field.boss.hp).toBe(hp); expect(a.b.file).toBe(file);
    expect(a.s.field.shots).toHaveLength(0); expect(a.b.program).toBeNull();
    expect(a.world.sessionOf(a.id)).toBe(a.s);
  });

  it('rejects legacy direct fire, laser and absolute-file movement entry points', () => {
    const a = training(); const hp = a.s.field.boss.hp; const file = a.b.file;
    for (const laser of [false, true]) {
      expect(a.world.fire(a.id, 'ashflat', [{ cardId: 'signaldeath', row: 0, col: 1 }], laser))
        .toMatchObject({ damage: 0, laser, reason: expect.stringMatching(/legacy combat is disabled/) });
    }
    a.world.battleMove(a.id, 0);
    expect(a.last('refused').reason).toMatch(/legacy file movement/);
    expect(a.s.field.boss.hp).toBe(hp); expect(a.b.file).toBe(file);
  });
});

describe('Hand picks, locks and execution', () => {
  it('enforces already, duplicate, element and invalid-cell locks on the dealt hand', () => {
    const a = training();
    const cards = ['emberpaw', 'emberpaw', 'rimeclaw', 'staticnip', 'undertow', 'refract'];
    let i = 0; a.b.handRand = () => (i++ % 6 + 0.1) / 6;
    ready(a, cards);
    expect(a.b.hand!.cells.map((c) => c.cardId)).toEqual(cards);
    // A cell with no card is refused outright and never fires.
    for (const cell of [-1, 0.5, 99]) {
      a.world.duel(a.id, { t: 'duel', action: 'pick', cell });
      expect(a.last('pick')).toMatchObject({ ok: false, reason: 'empty' });
      expect(a.b.hand!.queue).toEqual([]);
      expect(a.b.program).toBeNull();
    }
    // Tapping a card fires it, so a screen is only ever mid-build when the engine has taken a
    // card without executing — and it is that state the world must still refuse against.
    expect(SF.pickCard(a.s.state, a.id, 0)).toBe(true);
    expect(a.b.hand).toMatchObject({ queue: [0], lock: 'burn' });
    for (const [cell, reason] of [[0, 'already'], [1, 'duplicate'], [2, 'element']] as const) {
      a.world.duel(a.id, { t: 'duel', action: 'pick', cell });
      expect(a.last('pick')).toMatchObject({ ok: false, reason });
      expect(a.b.hand!.queue).toEqual([0]);
      expect(a.b.program).toBeNull();
    }
    expect(a.s.view(a.id).you!.hand!.cells[1]!.locked).toBe('duplicate');
    a.world.duel(a.id, { t: 'duel', action: 'undo' });
    expect(a.b.hand).toMatchObject({ queue: [], lock: null });
    a.world.duel(a.id, { t: 'duel', action: 'clear' });
    expect(a.b.hand).toMatchObject({ queue: [], lock: null });
  });

  it('a refused pick does not fire the card, close the screen or spend the charge', () => {
    const a = training();
    ready(a, ['emberpaw']);
    const hp = a.s.field.boss.hp; const charge = a.b.charge;
    a.world.duel(a.id, { t: 'duel', action: 'pick', cell: 99 });
    expect(a.last('pick')).toMatchObject({ ok: false, reason: 'empty' });
    expect(a.b.hand).not.toBeNull();
    expect(a.b.program).toBeNull();
    expect(a.s.field.shots).toHaveLength(0);
    expect(a.b.charge).toBe(charge);
    a.world.stepSessions(50);
    expect(a.s.field.boss.hp).toBe(hp);
  });

  it.each(['mega', 'giga', 'giga-spent', 'full'] as const)('enforces the %s selection cap', (reason) => {
    const a = training();
    const cls = reason.startsWith('giga') ? 'giga' : reason === 'mega' ? 'mega' : 'standard';
    const cards = CARDS.filter((c) => SF.cardClass(c) === cls).slice(0, 6).map((c) => c.id);
    expect(cards.length).toBeGreaterThanOrEqual(2);
    a.b.transformed = true;
    a.p.build.loadout.megaCap = 1;
    a.p.build.loadout.gigaCap = 1;
    if (reason === 'giga-spent') a.b.gigaSpent = true;
    let i = 0; a.s.state.rand = () => i < 6 ? (i++ + 0.1) / cards.length : 0.99;
    ready(a, cards);
    if (reason === 'full') a.b.stats.slots = 1;
    // The screen's first card is taken through the engine primitive, which does not fire, so the
    // world is still asked to take a second and must refuse it on the cap alone.
    if (reason !== 'giga-spent') expect(SF.pickCard(a.s.state, a.id, 0)).toBe(true);
    a.world.duel(a.id, { t: 'duel', action: 'pick', cell: reason === 'giga-spent' ? 0 : 1 });
    expect(a.last('pick')).toMatchObject({ ok: false, reason });
    expect(a.b.program).toBeNull();
  });

  it('fires the tapped card from the authoritative file, waits for flight, and resets the charge', () => {
    const a = training();
    const cards = CARDS.filter((c) => c.element === 'burn' && SF.cardClass(c) === 'standard').slice(0, 6).map((c) => c.id);
    let i = 0; a.b.handRand = () => (i++ % cards.length + 0.1) / cards.length;
    ready(a, cards);
    // Pin the anomaly on the shooter's own file and clear its reposition clock, so the flight —
    // which is shorter than the next reposition — lands for sure.
    a.s.field.boss.file = a.b.file;
    a.s.state.bossClock = 0;
    // One tap both selects and fires: the screen closes and the charge resets in the same action,
    // and the next hand is dealt before the panel repaints, so it is never an empty table.
    a.world.duel(a.id, { t: 'duel', action: 'pick', cell: 1 });
    expect(a.last('pick').ok).toBe(true);
    expect(a.b.handOpen).toBe(false); expect(a.b.hand).not.toBeNull(); expect(a.b.charge).toBe(0);
    expect(a.b.program!.cards.map((c) => c.id)).toEqual([cards[1]]);
    const file = a.b.file; const hp = a.s.field.boss.hp;
    a.world.duel(a.id, { t: 'duel', action: 'step', dir: 'left' });
    expect(a.b.file).toBe(file);
    a.world.stepSessions(50);
    expect(a.s.field.shots[0]).toMatchObject({ owner: a.id, cardId: cards[1], t: 0 });
    expect(a.s.field.boss.hp).toBe(hp);
    worldAdvance(a.world, 550);
    const fired = a.msgs.flatMap((m) => (m.events ?? []) as SF.FieldEvent[]).filter((e) => e.type === 'shot-fired');
    expect(fired.map((e) => e.cardId)).toEqual([cards[1]]);
    expect(a.s.damageOf(a.id)).toBeGreaterThan(0);
    expect(a.b.handOpen).toBe(false); expect(a.b.hand).not.toBeNull(); expect(a.b.program).toBeNull();
    expect(a.s.view(a.id).you!.readyIn).toBeGreaterThan(0);
    // There is no separate Execute step to take once a card is tapped.
    a.world.duel(a.id, { t: 'duel', action: 'execute' });
    expect(a.last('program').ok).toBe(false);
  });

  it('a program aimed away from the boss produces no damage or participation credit', () => {
    const a = training();
    a.world.duel(a.id, { t: 'duel', action: 'step', dir: 'left' });
    ready(a, ['emberpaw']);
    // Pin the anomaly on the far file so the tap is genuinely aimed off it. The flight is shorter
    // than the anomaly's next reposition, so it stays put for the whole shot.
    a.s.field.boss.file = a.s.field.cols - 1;
    a.s.state.bossClock = 0;
    const hp = a.s.field.boss.hp;
    a.world.duel(a.id, { t: 'duel', action: 'pick', cell: 0 });
    worldAdvance(a.world, 400);
    expect(a.s.field.boss.hp).toBe(hp);
    expect(a.s.damageOf(a.id)).toBe(0);
    expect(a.msgs.flatMap((m) => (m.events ?? []) as SF.FieldEvent[]))
      .toContainEqual(expect.objectContaining({ type: 'miss', owner: a.id }));
  });

  it('spends a selected Giga for the battle, not merely for this screen', () => {
    const a = training(); const giga = CARDS.find((c) => SF.cardClass(c) === 'giga')!.id;
    a.p.build.loadout.gigaCap = 1;
    a.s.field.boss.hp = a.s.field.boss.maxHp = 100_000;
    ready(a, [giga]);
    a.world.duel(a.id, { t: 'duel', action: 'pick', cell: 0 });
    expect(a.b.gigaSpent).toBe(true);
    worldAdvance(a.world, a.b.chargeMs + 1_000);
    expect(a.b.hand?.gigaSpent).toBe(true);
    a.world.duel(a.id, { t: 'duel', action: 'pick', cell: 0 });
    expect(a.last('pick')).toMatchObject({ ok: false, reason: 'giga-spent' });
  });
});

describe('Buster is removed — the fight is cards and dodging', () => {
  it('refuses the removed action with the standing unsupported-action message', () => {
    const a = training(); const hp = a.s.field.boss.hp;
    a.world.duel(a.id, { t: 'duel', action: 'buster', down: true } as unknown as DuelMsg);
    expect(a.last('refused').reason).toBe('unsupported duel action');
    a.world.duel(a.id, { t: 'duel', action: 'buster', down: false } as unknown as DuelMsg);
    expect(a.last('refused').reason).toBe('unsupported duel action');
    // Nothing fires and nothing takes damage.
    a.world.stepSessions(50);
    expect(a.s.field.boss.hp).toBe(hp);
    expect(a.s.damageOf(a.id)).toBe(0);
  });
});

describe('down, cover, loss and archived outcomes', () => {
  it('keeps a downed body through grace, then archives HP, grading, wave and seconds', () => {
    const s = field(); const b = s.bodyOf('a')!;
    pauseAttacks(s); b.hp = 1; b.waveDrained = 7; b.rank.counters = 2;
    hazard(s, ['a'], 10);
    const first = s.step(50, []);
    expect(first.downed).toEqual(['a']); expect(first.expired).toEqual([]);
    expect(s.has('a')).toBe(true); expect(b.down).toBe(true); expect(b.chain).toBe(0);
    const remaining = b.downLeft;
    advance(s, remaining - 50);
    expect(s.has('a')).toBe(true);
    expect(s.step(50, []).expired).toEqual(['a']);
    expect(s.has('a')).toBe(false); expect(s.state.result).toBe('loss');
    expect(s.hpOf('a')).toEqual({ hp: 0, maxHp: SF.DEFAULT_STATS.hp });
    const outcome = s.outcomeOf('a')!;
    expect(outcome).toMatchObject({ survived: false, wave: 7, rank: { counters: 2, abacks: 1 } });
    expect(outcome.drop).toEqual(SF.dropFor(outcome.level));
    expect(s.secondsOf('a')).toBeCloseTo(SF.DOWN_GRACE_MS / 1000);
    s.join({ id: 'a' }, joinSpec()); expect(s.has('a')).toBe(false);
  });

  it('revives an adjacent body after a full cover hold and restores exactly forty percent', () => {
    const s = field(); s.join({ id: 'b' }, joinSpec()); pauseAttacks(s);
    s.bodyOf('b')!.file = 0; s.bodyOf('b')!.hp = 1;
    hazard(s, ['b'], 10); s.step(50, []);
    SF.setCover(s.state, 'a', 'b');
    expect(s.bodyOf('a')!.hold).toMatchObject({ target: 'b', ms: 0 });
    advance(s, SF.REVIVE_HOLD_MS - 50); expect(s.bodyOf('b')!.down).toBe(true);
    expect(s.step(50, []).events).toContainEqual({ type: 'revived', owner: 'b', by: 'a' });
    expect(s.bodyOf('b')).toMatchObject({ down: false, downLeft: 0, hp: SF.revivedHp(SF.DEFAULT_STATS.hp) });
    expect(s.outcomeOf('b')!.survived).toBe(true);
  });

  it('cancels cover progress when the rescuer moves and does not bank the previous hold', () => {
    const s = field(); s.join({ id: 'b' }, joinSpec()); pauseAttacks(s);
    s.bodyOf('b')!.file = 0; s.bodyOf('b')!.hp = 1;
    hazard(s, ['b'], 10); s.step(50, []);
    SF.setCover(s.state, 'a', 'b'); advance(s, 1_000);
    SF.step(s.state, 'a', 'right'); expect(s.bodyOf('a')!.hold).toBeNull();
    SF.step(s.state, 'a', 'left'); SF.setCover(s.state, 'a', 'b');
    advance(s, 1_000); expect(s.bodyOf('b')!.down).toBe(true);
    advance(s, 1_000); expect(s.bodyOf('b')!.down).toBe(false);
  });

  it('routes a valid cover hold through the world and preserves the revived seat', () => {
    const a = arena(); const partner = seat(a.world);
    a.world.simulateSale(12_000, 3);
    for (const who of [a, partner]) a.world.duel(who.id, { t: 'duel', action: 'enter', mode: 'anomaly' });
    const s = a.world.sessionOf(a.id)!; const b = s.bodyOf(partner.id)!;
    pauseAttacks(s);
    b.file = 0; b.hp = 1;
    hazard(s, [partner.id], 10); a.world.stepSessions(50);
    // The test jab re-arms the boss clock the moment it resolves, so the pause has to be
    // re-applied: without it the anomaly telegraphs again mid-hold and strikes exactly
    // when the revive would land.
    pauseAttacks(s);
    a.world.duel(a.id, { t: 'duel', action: 'cover', with: partner.id });
    expect(a.last('cover')).toMatchObject({ ok: true, target: partner.id });
    worldAdvance(a.world, SF.REVIVE_HOLD_MS - 50);
    expect(b.down).toBe(true);
    a.world.stepSessions(50);
    expect(b.down).toBe(false); expect(b.hp).toBe(SF.revivedHp(b.maxHp));
    expect(partner.p.inBattle).toBe(true); expect(partner.end()).toBeUndefined();
    expect(a.last('tick').events).toContainEqual({ type: 'revived', owner: partner.id, by: a.id });
  });

  it('archives a departing body and removes its airborne shots and cover targets', () => {
    const s = field(); s.join({ id: 'b' }, joinSpec());
    const b = s.bodyOf('b')!; b.hp = 73; b.rank.counters = 4; b.waveDrained = 9;
    SF.openHand(s.state, b); SF.pickCard(s.state, 'b', 0); SF.execute(s.state, 'b'); s.step(50, []);
    expect(s.field.shots.some((shot) => shot.owner === 'b')).toBe(true);
    s.bodyOf('a')!.hold = { target: 'b', ms: 100 };
    const outcome = s.outcomeOf('b'); const seconds = s.secondsOf('b');
    s.leave('b');
    expect(s.hpOf('b')).toEqual({ hp: 73, maxHp: b.maxHp });
    expect(s.outcomeOf('b')).toEqual(outcome); expect(s.secondsOf('b')).toBe(seconds);
    expect(s.field.shots.some((shot) => shot.owner === 'b')).toBe(false);
    expect(s.bodyOf('a')!.hold).toBeNull();
    s.join({ id: 'b' }, joinSpec()); expect(s.has('b')).toBe(false);
  });

  it('routes cover refusals and cancellation, sends down ticks, then an archived wiped receipt', () => {
    const a = training(); a.b.hp = 1; a.b.waveDrained = 5;
    a.world.duel(a.id, { t: 'duel', action: 'cover', with: 'stranger' });
    expect(a.last('cover')).toMatchObject({ ok: false, reason: 'not-down' });
    a.world.duel(a.id, { t: 'duel', action: 'cover', with: null });
    expect(a.last('cover').ok).toBe(true);
    hazard(a.s, [a.id], 10); a.world.stepSessions(50);
    expect(a.p.inBattle).toBe(true); expect(a.world.sessionOf(a.id)).toBe(a.s);
    expect(a.end()).toBeUndefined();
    worldAdvance(a.world, SF.DOWN_GRACE_MS);
    expect(a.p.inBattle).toBe(false); expect(a.s.hpOf(a.id)!.hp).toBe(0);
    expect(a.end()).toMatchObject({ won: false, reason: 'wiped', wave: 5, lockoutMs: SF.DEFEAT_LOCKOUT_MS });
    expect(a.end()!.rank.level).toBe(a.s.outcomeOf(a.id)!.level);
    expect(a.world.profiles.doc(a.p.tokenId).stats.deaths).toBe(1);
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'train' });
    expect(a.last('refused').reason).toMatch(/recovering/);
  });
});

describe('shared sector HP and boss identity', () => {
  it('reconciles between-tick releases and mirrors other sessions without double counting', () => {
    const { boss, sectors, make } = sectorFixture(); const a = make('a'); const b = make('b');
    pauseAttacks(a); pauseAttacks(b);
    fireCardHit(a.state, 'a');
    expect(boss.hp).toBe(1_000);
    for (let t = 0; t < 1500; t += 50) a.step(50, sectors);
    const damage = 1_000 - boss.hp;
    expect(damage).toBeGreaterThan(0);
    b.step(1, sectors); expect(b.field.boss.hp).toBe(boss.hp); expect(b.damageOf('b')).toBe(0);
    fireCardHit(b.state, 'b');
    for (let t = 0; t < 1500; t += 50) b.step(50, sectors);
    a.step(1, sectors); expect(a.field.boss.hp).toBe(boss.hp);
    expect(a.damageOf('a')).toBe(damage); expect(b.damageOf('b')).toBeGreaterThan(0);
    const total = 1_000 - boss.hp;
    a.step(1, sectors); expect(1_000 - boss.hp).toBe(total);
  });

  it('credits only actual shared HP removed when two sessions overkill the same pool', () => {
    const { sector, sectors, make } = sectorFixture(5); const a = make('a'); const b = make('b');
    pauseAttacks(a); pauseAttacks(b);
    fireCardHit(a.state, 'a');
    fireCardHit(b.state, 'b');
    let out = a.step(1, sectors);
    let hit = out.events.some((e) => e.type === 'hit');
    for (let t = 0; t < 2000 && !out.cleared; t += 50) {
      out = a.step(50, sectors);
      hit = hit || out.events.some((e) => e.type === 'hit');
    }
    expect(out.cleared).toBe(true); expect(out.signals.some((e) => e.type === 'cleared')).toBe(true);
    expect(hit).toBe(true);
    expect(a.damageOf('a')).toBe(5); expect(a.bestOf('a')).toBe(5);
    expect(sector.boss).toBeNull(); expect(sector.cleared).toBe(1);
    expect(b.step(1, sectors).gone).toBe(true); expect(b.damageOf('b')).toBe(0);
  });

  it.each(['id', 'spawnedAt'] as const)('never applies queued damage to a replacement with changed %s', (key) => {
    const { boss, sector, sectors, make } = sectorFixture(); const a = make('a');
    pauseAttacks(a);
    fireCardHit(a.state, 'a');
    const replacement = { ...boss, [key]: key === 'id' ? 'replacement' : boss.spawnedAt + 1 } as Boss;
    sector.boss = replacement;
    expect(a.matchesBoss(replacement)).toBe(false);
    expect(a.step(50, sectors)).toMatchObject({ gone: true, cleared: false, events: [], signals: [] });
    expect(replacement.hp).toBe(1_000); expect(a.damageOf('a')).toBe(0); expect(a.state.result).toBe('loss');
  });

  it('ends a replaced world anomaly once, then creates a fresh identity on re-entry', () => {
    const a = arena(); a.world.simulateSale(12_000, 3);
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'anomaly' });
    const s = a.world.sessionOf(a.id)!; const sector = a.world.sectors.find((s) => s.sector === 'ashflat')!;
    sector.boss = { ...sector.boss!, spawnedAt: sector.boss!.spawnedAt + 1 };
    const hp = sector.boss.hp; tap(a); a.world.stepSessions(50);
    expect(sector.boss.hp).toBe(hp); expect(a.end()).toMatchObject({ won: false, reason: 'gone', xp: 0 });
    expect(a.world.sessionOf(a.id)).toBeNull();
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'anomaly' });
    expect(a.world.sessionOf(a.id)).not.toBe(s);
    expect(a.world.sessionOf(a.id)!.matchesBoss(sector.boss)).toBe(true);
    expect(a.msgs.filter((m) => m.kind === 'end')).toHaveLength(1);
  });
});

describe('real social-party traits', () => {
  it('does not treat strangers in the same field as a social party, and never heals on membership changes', () => {
    const a = arena(); const b = seat(a.world, 'friend'); const c = seat(a.world, 'stranger');
    a.p.build.loadout.gear = 'charge'; b.p.build.loadout.gear = 'hp'; c.p.build.loadout.gear = 'guard';
    a.world.simulateSale(12_000, 3);
    for (const who of [a, b, c]) who.world.duel(who.id, { t: 'duel', action: 'enter', mode: 'anomaly' });
    const s = a.world.sessionOf(a.id)!; const body = s.bodyOf(a.id)!;
    const base = SF.duelStatsOf({ loadout: a.p.build.loadout, level: a.p.level });
    expect(a.world.sessionOf(b.id)).toBe(s); expect(body.stats).toEqual(base);
    body.hp = 61;
    a.world.partyAction(a.id, { action: 'invite', with: b.id });
    expect(body.stats).toEqual(base);
    a.world.partyAction(b.id, { action: 'accept' });
    expect(body.maxHp).toBe(Math.round(base.hp * 1.15)); expect(body.hp).toBe(61);
    expect(body.stats.armour).toBe(base.armour);
    a.world.partyAction(b.id, { action: 'leave' });
    expect(body.stats).toEqual(base); expect(body.hp).toBe(61);
    a.world.partyAction(a.id, { action: 'invite', with: b.id });
    a.world.partyAction(b.id, { action: 'accept' });
    expect(body.hp).toBe(61);
    b.world.duel(b.id, { t: 'duel', action: 'leave' });
    expect(body.stats).toEqual(base); expect(body.hp).toBe(61);
  });

  it('deduplicates party hats and requires the contributing member on this field', () => {
    const a = arena(); const b = seat(a.world); const c = seat(a.world);
    b.p.build.loadout.gear = c.p.build.loadout.gear = 'hp';
    for (const who of [b, c]) {
      a.world.partyAction(a.id, { action: 'invite', with: who.id });
      a.world.partyAction(who.id, { action: 'accept' });
    }
    a.world.simulateSale(12_000, 3);
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'anomaly' });
    const body = a.world.sessionOf(a.id)!.bodyOf(a.id)!;
    const base = SF.duelStatsOf({ loadout: a.p.build.loadout, level: a.p.level });
    expect(body.maxHp).toBe(base.hp);
    for (const who of [b, c]) a.world.duel(who.id, { t: 'duel', action: 'enter', mode: 'anomaly' });
    expect(body.maxHp).toBe(Math.round(base.hp * 1.15));
    expect(body.hp).toBe(base.hp);
  });
});

describe('graded loot and training rewards', () => {
  it.each([false, true])('rolls anomaly loot from the actual %s high-grade outcome and excludes spectators', (high) => {
    const a = arena(); const spectator = seat(a.world);
    a.world.simulateSale(12_000, 3);
    const sector = a.world.sectors.find((s) => s.sector === 'ashflat')!;
    sector.boss!.hp = sector.boss!.maxHp = 1;
    for (const who of [a, spectator]) a.world.duel(who.id, { t: 'duel', action: 'enter', mode: 'anomaly' });
    const s = a.world.sessionOf(a.id)!; const b = s.bodyOf(a.id)!;
    b.rank = { ...SF.emptyRank(), counters: high ? 5 : 0, abacks: high ? 0 : 18, maxChain: high ? 4 : 0 };
    s.state.elapsed = high ? 1_000 : 200_000;
    spectator.p.bestProgram = 100_000;
    const grant = vi.spyOn(a.world.profiles, 'grant');
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    fireKill(a);
    const outcome = s.outcomeOf(a.id)!; const end = a.end()!;
    expect(end).toMatchObject({ won: true, reason: 'cleared', rank: { level: outcome.level, letter: outcome.letter }, drop: outcome.drop });
    expect(outcome.letter).toBe(high ? 'S' : 'D');
    const cards = grant.mock.calls.filter(([token, reward]) => token === a.p.tokenId && reward.cards?.length).flatMap(([, reward]) => reward.cards!);
    expect(cards).toHaveLength(outcome.drop.rolls);
    expect(cards.every((id) => (SF.battleCard(id)!.cls !== 'standard') === high)).toBe(true);
    expect(a.world.saves.get(a.p.tokenId).kills).toBe(1);
    expect(spectator.end()).toMatchObject({ won: true, xp: 0, wav: 0, cards: [] });
    expect(a.world.saves.get(spectator.p.tokenId).kills).toBe(0);
    a.world.stepSessions(50);
    expect(a.msgs.filter((m) => m.kind === 'end')).toHaveLength(1);
  });

  it('pays the first Training clear once, awards a new tribe card, and enforces the daily cap', () => {
    const a = training();
    const first = finish(a);
    expect(first).toMatchObject({ won: true, first: true, reason: 'cleared' });
    expect(first.xp).toBeGreaterThanOrEqual(40); expect(first.items).toContain('med');
    expect(first.cards).toHaveLength(1); expect(a.p.build.library).not.toContain(first.cards[0]);
    expect(a.world.profileFor(a.id)!.cards).toContain(first.cards[0]);
    const paid: number[] = [];
    for (let i = 0; i < 6; i++) {
      a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'train' });
      const end = finish(a); expect(end.first).toBe(false); expect(end.cards).toEqual([]); paid.push(end.xp);
    }
    expect(paid[0]).toBeGreaterThan(0); expect(paid[0]).toBeLessThan(20);
    expect(paid.at(-1)).toBe(0); expect(a.world.profiles.doc(a.p.tokenId).stats.trains).toBe(7);
  });

  it('updates the training quest through a real field clear', () => {
    const a = training(); const doc = a.world.profiles.doc(a.p.tokenId);
    doc.quests['m-01b'] = { progress: [0], done: false, turnedIn: false };
    const end = finish(a);
    expect(doc.quests['m-01b']!.done).toBe(true); expect(end.quests).toContain('Testnet Baby');
  });
});

describe('dungeon authorization and persisted run integrity', () => {
  it('requires the current dungeon and room, refuses station entry during a run, and prevents skipping a fight', () => {
    const a = arena(); const { doc, area } = dungeon(a);
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'room', dungeonId: 'wrong', roomId: 'enemy' });
    expect(a.last('refused').reason).toMatch(/walk to that room/); expect(a.world.sessionOf(a.id)).toBeNull();
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'train' });
    expect(a.last('refused').reason).toMatch(/leave the dungeon/);
    expect(a.world.loop(a.id, { action: 'area.step', nodeId: 'enemy' }).ok).toBe(true);
    expect(a.world.loop(a.id, { action: 'area.engage' }).ok).toBe(true);
    const s = a.world.sessionOf(a.id)!;
    expect(s.state.place).toMatchObject({ kind: 'dungeon', dungeonId: area.dungeonId, roomId: 'enemy' });
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'room', dungeonId: area.dungeonId, roomId: 'gate' });
    expect(a.last('refused').reason).toMatch(/walk to that room/);
    expect(doc.run!.at).toBe('enemy');
    expect(a.world.loop(a.id, { action: 'area.step', nodeId: 'gate' }).ok).toBe(false);
    expect(a.world.loop(a.id, { action: 'area.kill' }).ok).toBe(false);
    expect(a.world.profiles.armNode(a.p.tokenId, 'enemy')).toBe(true);
    expect(a.world.loop(a.id, { action: 'area.kill' }).ok).toBe(false);
    const xp = doc.xp; const end = finish(a);
    expect(end.won).toBe(true); expect(doc.run!.cleared).toContain('enemy'); expect(doc.xp).toBeGreaterThan(xp);
    const paid = doc.xp; expect(a.world.loop(a.id, { action: 'area.kill' }).ok).toBe(false); expect(doc.xp).toBe(paid);
  });

  it('persists remaining HP on departure and re-enters with that same damaged bar', () => {
    const a = arena(); const { doc, area } = dungeon(a, 73);
    a.world.loop(a.id, { action: 'area.step', nodeId: 'enemy' });
    a.world.loop(a.id, { action: 'area.engage' });
    const s = a.world.sessionOf(a.id)!; expect(s.hpOf(a.id)!.hp).toBe(73);
    hazard(s, [a.id], 10); a.world.stepSessions(50);
    const hp = s.hpOf(a.id)!; expect(hp.hp).toBeLessThan(73);
    a.world.duel(a.id, { t: 'duel', action: 'leave' });
    expect(doc.run).toMatchObject({ hp: hp.hp, maxHp: hp.maxHp, failed: false, cleared: [] });
    expect(a.world.saves.readProgress(a.p.tokenId, { run: null }).run).toMatchObject({ hp: hp.hp });
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'room', dungeonId: area.dungeonId, roomId: 'enemy' });
    expect(a.world.sessionOf(a.id)!.hpOf(a.id)).toEqual(hp);
    const end = finish(a); expect(end.won).toBe(true);
    expect(doc.run!.hp).toBe(hp.hp);
    expect(a.world.saves.readProgress(a.p.tokenId, { run: null }).run).toMatchObject({ hp: hp.hp, cleared: ['enemy'] });
  });

  it('persists zero HP and failure after grace expires, gives no payout, and refuses re-entry', () => {
    const a = arena(); const { doc, area } = dungeon(a, 1);
    a.world.loop(a.id, { action: 'area.step', nodeId: 'enemy' });
    a.world.loop(a.id, { action: 'area.engage' });
    const s = a.world.sessionOf(a.id)!; const xp = doc.xp;
    hazard(s, [a.id], 10); a.world.stepSessions(50);
    expect(a.end()).toBeUndefined(); expect(s.has(a.id)).toBe(true);
    worldAdvance(a.world, SF.DOWN_GRACE_MS);
    expect(doc.run).toMatchObject({ hp: 0, failed: true, cleared: [] });
    expect(a.world.saves.readProgress(a.p.tokenId, { run: null }).run).toMatchObject({ hp: 0, failed: true });
    expect(doc.xp).toBe(xp); expect(a.end()).toMatchObject({ won: false, reason: 'wiped', xp: 0 });
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'room', dungeonId: area.dungeonId, roomId: 'enemy' });
    expect(a.last('refused').reason).toMatch(/walk to that room/);
  });

  it('refuses dungeon IDs on station packets', () => {
    const a = arena();
    a.world.duel(a.id, { t: 'duel', action: 'enter', mode: 'train', dungeonId: 'd-ember', roomId: 'enemy' });
    expect(a.last('refused').reason).toMatch(/room IDs are only valid/);
    expect(a.world.sessionOf(a.id)).toBeNull();
  });
});

/**
 * Loot with a body.
 *
 * A payout used to arrive as a menu entry. These tests hold the four rules that make a drop a
 * thing on the street instead: it exists, only its owner may take it, only from arm's reach, and
 * the street eventually takes it back.
 */
describe('loot on the street', () => {
  // Winning a fight is a real-time fixture; give the block room on a loaded machine.
  const TIMEOUT = 20_000;
  const piles = (a: ReturnType<typeof seat>): Record<string, unknown>[] => {
    const m = [...a.msgs].reverse().find((x) => x.t === 'drops') as { drops?: Record<string, unknown>[] } | undefined;
    return m?.drops ?? [];
  };
  /** Walk a dungeon room: arm the node, clear the field, take the kill. */
  const clearRoom = (a: ReturnType<typeof seat>): void => {
    // The real route into a fold room: arm the node on the run and engage it. The kill is issued by
    // the server itself when the field closes — calling `area.kill` here would find no field left.
    const { area } = dungeon(a, 90);
    a.world.loop(a.id, { action: 'area.step', nodeId: 'enemy' });
    a.world.loop(a.id, { action: 'area.engage' });
    const s = a.world.sessionOf(a.id)!;
    expect(s.state.place).toMatchObject({ kind: 'dungeon', dungeonId: area.dungeonId, roomId: 'enemy' });
    fireKill(a);
    expect(a.end()?.won).toBe(true);
  };

  it('drops nothing for training — it is a practice room, not a reward', () => {
    const a = training();
    expect(piles(a)).toHaveLength(0);
    finish(a);
    // Training hands out the starter card to teach the loop and then it is over. A pile left on the
    // street afterwards is a pile a player walks over expecting a fold's loot and receives the
    // starter card instead, so there is no pile.
    expect(piles(a)).toHaveLength(0);
    const list = [...a.msgs].filter((m) => m.t === 'drops');
    expect(list.every((m) => (m.drops as unknown[]).length === 0)).toBe(true);
  }, TIMEOUT);

  it('drops what a cleared dungeon room paid, on the ground where it was earned', () => {
    const a = arena();
    clearRoom(a);
    const list = piles(a);
    expect(list.length).toBeGreaterThan(0);
    for (const d of list) {
      expect(d.owner).toBe(a.id);
      expect(typeof d.x).toBe('number');
      expect(typeof d.z).toBe('number');
      expect(d.ttl).toBeGreaterThan(0);
      // Scattered around the body, not stacked on the exact same spot.
      expect(Math.hypot((d.x as number) - a.p.x, (d.z as number) - a.p.y)).toBeGreaterThan(0);
    }
  }, TIMEOUT);

  it('refuses a pile that belongs to somebody else', () => {
    const a = arena();
    clearRoom(a);
    const first = piles(a)[0]!;
    const other = seat(a.world);
    // Put the stranger right on top of it: proximity is not permission.
    other.p.x = first.x as number; other.p.y = first.z as number;
    const res = a.world.loop(other.id, { action: 'take', dropId: first.id as string });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/not yours/);
    // And it is still on the ground for the player who earned it.
    expect(piles(a).some((d) => d.id === first.id)).toBe(true);
  }, TIMEOUT);

  it('refuses a pile you are not standing on, then collects it when you walk to it', () => {
    const a = arena();
    clearRoom(a);
    const first = piles(a)[0]!;
    a.p.x = (first.x as number) + 40; a.p.y = first.z as number;
    expect(a.world.loop(a.id, { action: 'take', dropId: first.id as string }).reason).toMatch(/too far/);

    // The bag must NOT grow: a clear already paid this loot, and the pile is that payout made
    // visible. Granting again would hand the bag a duplicate, which the duplicate path silently
    // buys back for WAV — a beam labelled CINDER FANG that pays coins.
    const chipsBefore = [...a.world.saves.get(a.p.tokenId).cards];
    const itemsBefore = { ...(a.world.profiles.doc(a.p.tokenId).bag.items as Record<string, number>) };
    a.p.x = first.x as number; a.p.y = first.z as number;
    const res = a.world.loop(a.id, { action: 'take', dropId: first.id as string });
    expect(res.ok).toBe(true);
    expect(res.name).toBe(first.name);
    expect(a.world.saves.get(a.p.tokenId).cards).toEqual(chipsBefore);
    expect(a.world.profiles.doc(a.p.tokenId).bag.items).toEqual(itemsBefore);
    expect(piles(a).some((d) => d.id === first.id)).toBe(false);
  }, TIMEOUT);

  it('lets the street take a pile back once it has waited too long', () => {
    const a = arena();
    clearRoom(a);
    const first = piles(a)[0]!;
    a.p.x = first.x as number; a.p.y = first.z as number;
    const real = Date.now;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(real() + 10 * 60_000);
    try {
      const res = a.world.loop(a.id, { action: 'take', dropId: first.id as string });
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/took it back/);
      expect(piles(a).some((d) => d.id === first.id)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('re-asks for the street on demand, so a reconnect is not blind', () => {
    const a = arena();
    clearRoom(a);
    const res = a.world.loop(a.id, { action: 'drops' });
    expect(res.ok).toBe(true);
    expect((res.drops as unknown[]).length).toBe(piles(a).length);
  }, TIMEOUT);
});
