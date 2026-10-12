import { describe, expect, it } from 'vitest';
import { deriveBuild, describeBuild } from '../src/derive.ts';
import * as SF from '../src/sf/index.ts';
import {
  applyDamage,
  createSectors,
  ingest,
  pressureOf,
  routeOf,
  tick,
  tierFor,
  TIER_AT,
  AMBIENT_CEILING,
  WAVE_CAP,
  type WaveEvent,
} from '../src/wave.ts';

const src = (over: Partial<Parameters<typeof deriveBuild>[0]> = {}) => ({
  tokenId: 418,
  transferCount: 0,
  daysHeld: 0,
  ...over,
});

describe('deriveBuild — the NFT is the character', () => {
  it('is deterministic for a given token', () => {
    expect(deriveBuild(src())).toEqual(deriveBuild(src()));
  });

  it('produces different builds for different tokens', () => {
    const a = deriveBuild(src({ tokenId: 418 }));
    const b = deriveBuild(src({ tokenId: 419 }));
    expect(a.library.join() + a.signature).not.toEqual(b.library.join() + b.signature);
  });

  it('raises wave affinity with transfer count', () => {
    expect(deriveBuild(src({ transferCount: 0 })).waveAffinity).toBeCloseTo(0, 5);
    expect(deriveBuild(src({ transferCount: 12 })).waveAffinity).toBeGreaterThan(0.8);
  });

  it('burns clean signal when a long-held token has been flipped a lot', () => {
    const hoarded = deriveBuild(src({ daysHeld: 300, transferCount: 0 }));
    const flipped = deriveBuild(src({ daysHeld: 300, transferCount: 20 }));
    expect(hoarded.cleanSignal).toBeGreaterThan(flipped.cleanSignal);
  });

  it('gives older mints more link slots', () => {
    expect(deriveBuild(src({ tokenId: 3 })).linkSlots).toBeGreaterThanOrEqual(
      deriveBuild(src({ tokenId: 1900 })).linkSlots,
    );
  });

  it('never hands out an empty library and always contains the signature', () => {
    for (let id = 0; id < 200; id++) {
      const b = deriveBuild(src({ tokenId: id, transferCount: id % 9 }));
      expect(b.library.length).toBeGreaterThan(0);
      expect(b.library).toContain(b.signature);
      expect(b.linkSlots).toBeGreaterThanOrEqual(3);
      expect(b.linkSlots).toBeLessThanOrEqual(5);
    }
  });

  it('flags missing trait metadata instead of silently pretending', () => {
    expect(deriveBuild(src()).hasTraits).toBe(false);
    expect(deriveBuild(src({ attributes: { Eyes: 'Laser' } })).hasTraits).toBe(true);
    expect(describeBuild(deriveBuild(src()))[3]).toMatch(/no trait metadata/);
  });
});

describe('SF — cards replace the placement grid', () => {
  const caps = { slots: 3, mega: 1, giga: 1 };
  const screen = (ids: string[]): SF.CustomState => ({
    ...SF.emptyCustom(),
    hand: ids.map((chipId, cell) => ({ cell, ...SF.cellOf(cell), chipId })),
  });

  it('locks the turn to an element and refuses duplicate cards', () => {
    const selected = SF.pick(screen(['emberpaw', 'rimeclaw', 'emberpaw', 'refract']), 0, caps).state;
    expect(SF.canPick(selected, 1, caps)).toEqual({ ok: false, reason: 'element' });
    expect(SF.canPick(selected, 2, caps)).toEqual({ ok: false, reason: 'duplicate' });
    expect(SF.canPick(selected, 3, caps).ok).toBe(true);
  });

  it('pays consecutive elements rather than spatial adjacency', () => {
    const first = SF.stepChain(0, null, 'burn');
    const second = SF.stepChain(first, 'burn', 'burn');
    expect(SF.chainMultiplier(first)).toBe(1);
    expect(SF.chainMultiplier(second)).toBeGreaterThan(1);
    expect(SF.stepChain(second, 'burn', 'frost')).toBe(0);
  });

  it('treats prism as NULL and void as its counter-element', () => {
    expect(SF.matchup('prism', 'burn')).toBe(1);
    expect(SF.matchup('void', 'prism')).toBe(2);
    expect(SF.matchup('burn', 'wave')).toBe(2);
    expect(SF.matchup('burn', 'frost')).toBe(0.5);
  });

  it('aims coverage from the player file on the SF field', () => {
    expect(SF.coverFiles(SF.card('emberpaw').shape, 1, 3)).toContain(1);
    const files = SF.coverFiles(SF.card('magmachog').shape, 0, 6);
    expect(files.every((file) => file >= 0 && file < 6)).toBe(true);
  });

  it('spends a Giga for the whole session, not just the current screen', () => {
    const build = deriveBuild(src());
    const giga = build.library.map(SF.card).find((card) => card.cls === 'giga') ?? SF.card('chognova');
    expect(giga.cls).toBe('giga');
    const session = SF.openSession({ id: 'giga-regression', place: { kind: 'train', sector: 'ashflat' }, boss: { name: 'Target', hp: 1_000_000, level: 2 }, rand: () => 0.99 });
    const body = SF.addBody(session, { id: 'a', owner: 'a', name: 'Reference', tribe: 'burn', level: 2, stats: { ...SF.DEFAULT_STATS, gigaCap: 1 }, folder: [giga.id] });
    SF.openCustom(session, body);
    expect(SF.pickCard(session, body.id, 0)).toBe(true);
    expect(SF.execute(session, body.id)).toBe(true);
    while (body.program || session.field.shots.length) SF.tick(session, 50);
    SF.openCustom(session, body);
    expect(body.gigaSpent).toBe(true);
    expect(SF.canPick(body.custom!, 0, SF.capsOf(body))).toEqual({ ok: false, reason: 'giga-spent' });
  });
});

describe('wave — the market is the game master', () => {
  const ev = (over: Partial<WaveEvent>): WaveEvent => ({
    kind: 'nft-swap',
    tokenId: 1,
    amount: 100,
    block: 1,
    ts: 0,
    ...over,
  });

  // Measured on mainnet: Genesis produced 0 transfers in 45 min, $CHOG ~1/min.
  // These numbers encode that reality so a future retune cannot silently make
  // the game unplayable again.
  const FLOOR = 5250;

  it('scales pressure logarithmically, so big trades crack a sector', () => {
    expect(pressureOf(ev({ amount: 50 }))).toBeLessThan(pressureOf(ev({ amount: 5000 })));
    const gap = pressureOf(ev({ amount: 500_000 })) - pressureOf(ev({ amount: 50_000 }));
    expect(gap).toBeLessThan(8);
  });

  it('treats a single floor-priced sale as a nudge, not an anomaly', () => {
    const states = createSectors();
    ingest(states, [ev({ amount: FLOOR })], 0);
    const hot = states.find((s) => s.wave > 0)!;
    expect(hot.wave).toBeGreaterThan(20);
    expect(hot.tier).toBe('normal');
  });

  it('escalates by volume: one sale is quiet, two is an anomaly, three a storm', () => {
    const one = createSectors();
    ingest(one, [ev({ amount: FLOOR, tokenId: 3 })], 0);
    expect(one.find((s) => s.wave > 0)!.tier).toBe('normal');
    expect(one.some((s) => s.boss)).toBe(false);

    const two = createSectors();
    ingest(two, [ev({ amount: FLOOR, tokenId: 3 }), ev({ amount: FLOOR, tokenId: 3 })], 0);
    expect(two.find((s) => s.boss)!.tier).toBe('anomaly');

    const three = createSectors();
    ingest(three, Array.from({ length: 3 }, () => ev({ amount: FLOOR, tokenId: 3 })), 0);
    expect(three.find((s) => s.boss)!.tier).toBe('storm');
  });

  it('keeps chain pulses spread evenly instead of compounding one sector', () => {
    const states = createSectors();
    const pulses = Array.from({ length: 300 }, (_, i) =>
      ev({ kind: 'chain-pulse', amount: 1, tokenId: undefined, block: 1000 + i }),
    );
    ingest(states, pulses, 0);
    const waves = states.map((s) => s.wave);
    expect(Math.max(...waves) - Math.min(...waves)).toBeLessThan(2);
    // ~100 pulses per sector at 0.15 each, minus nothing yet: must be alive
    expect(waves[0]).toBeGreaterThan(10);
  });

  it('decays slowly enough that one real event still matters minutes later', () => {
    const states = createSectors();
    ingest(states, [ev({ amount: FLOOR * 4, tokenId: 3 })], 0);
    const hot = states.find((s) => s.wave > 0)!;
    const before = hot.wave;
    tick(states, 60_000, 60, 1);
    expect(hot.wave).toBeGreaterThan(before * 0.5);
    expect(hot.wave).toBeLessThan(before);
  });

  it('routes token swaps into the city, which is the only place there is', () => {
    const states = createSectors();
    expect(states).toHaveLength(1);
    states[0]!.wave = 30;
    expect(routeOf(ev({ kind: 'token-swap', tokenId: undefined, amount: 10 }), states)).toBe('ashflat');
    expect(routeOf(ev({ kind: 'nft-sale', tokenId: 7, amount: 10 }), states)).toBe('ashflat');
  });

  it('crosses tiers', () => {
    expect(tierFor(0)).toBe('normal');
    expect(tierFor(TIER_AT.glitch)).toBe('glitch');
    expect(tierFor(TIER_AT.storm)).toBe('storm');
  });

  it('spawns exactly one boss per sector and locks the sector out after clearing', () => {
    const states = createSectors();
    const whale = ev({ amount: FLOOR * 4, tokenId: 3 });
    const signals = ingest(states, [whale, whale], 0);
    expect(signals.filter((s) => s.type === 'spawn')).toHaveLength(1);

    const hot = states.find((s) => s.boss)!;
    const out = applyDamage(states, hot.sector, hot.boss!.maxHp, 1_000);
    expect(out.map((s) => s.type)).toContain('cleared');
    expect(hot.boss).toBeNull();

    hot.wave = 100;
    expect(tick(states, 2_000, 0, 1).filter((s) => s.type === 'spawn')).toHaveLength(0);
  });

  it('ravages the sector when nobody kills it in time', () => {
    const states = createSectors();
    ingest(states, [ev({ amount: FLOOR, tokenId: 3 }), ev({ amount: FLOOR, tokenId: 3 })], 0);
    const hot = states.find((s) => s.boss)!;
    const before = hot.wave;
    const out = tick(states, 400_000, 0, 1);
    expect(out.map((s) => s.type)).toContain('ravaged');
    expect(hot.boss).toBeNull();
    expect(hot.wave).toBeLessThan(before);
  });

  it('scales boss hp with the co-op party', () => {
    const mk = () => {
      const states = createSectors();
      ingest(states, [ev({ amount: FLOOR * 4, tokenId: 3 }), ev({ amount: FLOOR * 4, tokenId: 3 })], 0);
      return states.find((s) => s.boss)!;
    };
    const solo = mk();
    const squad = mk();
    solo.boss = null;
    squad.boss = null;
    solo.lockoutUntil = 0;
    squad.lockoutUntil = 0;
    tick([solo], 1, 0, 1);
    tick([squad], 1, 0, 4);
    expect(solo.boss!.maxHp).toBeGreaterThan(0);
    expect(squad.boss!.maxHp).toBeGreaterThan(solo.boss!.maxHp);
  });

  it('escalates the boss through all four attack phases', () => {
    // The phase drives how hard the fight swings, and an earlier
    // min(2, floor(p*3)) meant phase 4 was unreachable and the top-end pattern
    // never played. Pin the full range so it cannot collapse again.
    const states = createSectors();
    ingest(states, [ev({ amount: FLOOR * 4, tokenId: 3 }), ev({ amount: FLOOR * 4, tokenId: 3 })], 0);
    const s = states.find((x) => x.boss)!;
    const seen: number[] = [];
    const step = Math.ceil(s.boss!.maxHp / 9);
    for (let i = 0; i < 9 && s.boss; i++) {
      seen.push(s.boss.phase);
      applyDamage(states, s.sector, step, 1);
    }
    expect(seen[0]).toBe(1);
    expect(seen[seen.length - 1]).toBe(4);
    expect([...new Set(seen)].sort()).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
  });

  it('keeps routing volume to the city at the ceiling, and the ceiling still holds', () => {
    // With one place to put it, volume goes there; the cap is what keeps it from running away.
    const states = createSectors();
    states[0]!.wave = 118;
    const ev2 = (n: number): WaveEvent => ({ kind: 'token-swap', amount: 10, block: n, ts: 0 });
    expect(routeOf(ev2(1), states)).toBe('ashflat');
    ingest(states, [ev2(1), ev2(2), ev2(3)], 0);
    expect(states[0]!.wave).toBeLessThanOrEqual(WAVE_CAP);
  });

  it('caps what chain noise alone can do, but never caps trading', () => {
    // Background traffic is a proxy for the market, not the market. It is
    // allowed to reach the glitch tier so a viewer sees something within a few
    // minutes, then stops. Without this the wave climbed linearly and every
    // sector sat pinned at WAVE_CAP three minutes after boot.
    const states = createSectors();
    const pulses = Array.from({ length: 400 }, (_, i) => ({
      kind: 'chain-pulse' as const, amount: 3, block: i + 1, ts: 0,
    }));
    ingest(states, pulses, 0);
    for (const s of states) expect(s.wave).toBeLessThanOrEqual(AMBIENT_CEILING + 0.001);
    expect(AMBIENT_CEILING).toBeGreaterThanOrEqual(TIER_AT.glitch);
    expect(AMBIENT_CEILING).toBeLessThan(TIER_AT.storm);

    // A real run of sales still reaches storm on top of that baseline.
    const whale = ev({ amount: FLOOR * 4, tokenId: 3 });
    ingest(states, [whale, whale, whale], 0);
    const hottest = states.reduce((a, b) => (b.wave > a.wave ? b : a));
    expect(hottest.wave).toBeGreaterThan(AMBIENT_CEILING);
    expect(tierFor(hottest.wave)).not.toBe('normal');
    expect(WAVE_CAP).toBeGreaterThan(AMBIENT_CEILING);
  });
});
