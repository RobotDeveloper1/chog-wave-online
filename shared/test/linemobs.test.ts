import { describe, expect, it } from 'vitest';
import { archetypeForEncounter, mobAt, mobFacing, mobSpawns } from '../src/line/mobs.ts';
import { lineLayout } from '../src/line/layout.ts';
import { REGION_BY_ID, REGION_IDS } from '../src/line/index.ts';
import { ARCHETYPES, MOVES, movePanels, pickMove } from '../src/sf/boss.ts';
import { FIRST_PLAYER_LANE, LANES } from '../src/sf/field.ts';

/**
 * The Line's mobs have to exist before anything can render them.
 *
 * "Mobs do not appear on the road" was measured live at `serverSent=0`, which is the server sending
 * an empty list. That is one of two things: the transport dropped them, or there was nothing to
 * send. This settles the second one without a browser, because both functions are pure.
 */
describe('line mobs exist', () => {
  it('gives every region at least one spawn, and each spawn a live position', () => {
    for (const r of REGION_IDS) {
      const sites = lineLayout(r).encounters;
      const spawns = mobSpawns(r);
      expect(sites.length, `${r} has encounter sites`).toBeGreaterThan(0);
      expect(spawns.length, `${r} has mob spawns`).toBeGreaterThan(0);
      for (const s of spawns) {
        const at = mobSpawns(r)[0];
        void at;
        expect(typeof s.home.x).toBe('number');
        expect(typeof s.home.z).toBe('number');
        expect(Number.isFinite(s.home.x) && Number.isFinite(s.home.z)).toBe(true);
        expect(s.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('reports TOLLS specifically, since that is the region the live game opens on', () => {
    const spawns = mobSpawns('tolls');
    expect(spawns.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`TOLLS: ${lineLayout('tolls').encounters.length} sites -> ${spawns.length} mobs: ` +
      spawns.map((s) => `${s.id}@${s.home.x.toFixed(0)},${s.home.z.toFixed(0)}`).join(' | '));
  });
});

describe('line mobs wear their duel', () => {
  it('gives every mob the archetype and tier its fight opens', () => {
    for (const r of REGION_IDS) {
      const boss = REGION_BY_ID.get(r)!.boss.archetype;
      for (const m of mobSpawns(r)) {
        expect(m.tier, m.id).toBe(REGION_BY_ID.get(r)!.n);
        if (m.kind === 'warden') expect(m.archetype, m.id).toBe(boss);
        else expect(m.archetype, m.id).toBe(archetypeForEncounter(m.encounterId));
      }
    }
  });

  it('fields each region its own roster of fights', () => {
    // The whole table, not spot checks: every region leads with its own mob, in its own
    // pattern. Tolls fields its own three kits — the reference every later region is read
    // against; the relay leads with the glitch its own masts leak.
    const drifts: Record<string, string[]> = {
      tolls: ['mite', 'walker', 'mite', 'walker'],
      ashpine: ['spark', 'glitch', 'spark', 'glitch'],
      marsh: ['wisp', 'spark', 'wisp', 'spark'],
      relay: ['glitch', 'spark', 'glitch', 'spark'],
      causeway: ['husk', 'spark', 'husk', 'spark'],
      static: ['spark', 'husk', 'spark', 'husk'],
    };
    for (const [region, want] of Object.entries(drifts)) {
      expect(
        [1, 2, 3, 4].map((n) => archetypeForEncounter(`${region}.${n}`)),
        `${region} drifts`,
      ).toEqual(want);
    }
    const posts = ['tolls', 'ashpine', 'marsh', 'relay', 'causeway', 'static'].map(
      (r) => `${archetypeForEncounter(`${r}.5`)}/${archetypeForEncounter(`${r}.6`)}`,
    );
    expect(posts).toEqual(['walker/walker', 'glitch/glitch', 'wisp/wisp', 'glitch/glitch', 'husk/husk', 'husk/husk']);
    expect(archetypeForEncounter('tolls.7')).toBe('tollkeeper');
    expect(archetypeForEncounter('static.7')).toBe('baron');
    // Six regions, six signatures — no two maps field the same war.
    const sigs = new Set(
      Object.entries(drifts).map(([region, d]) => [...d, archetypeForEncounter(`${region}.5`)].join(',')),
    );
    expect(sigs.size).toBe(6);
    // Both bodies of one drift wear the same fight.
    for (const m of mobSpawns('tolls').filter((x) => x.encounterId === 'tolls.2')) {
      expect(m.archetype).toBe('walker');
    }
  });

  describe('the regional signatures', () => {
    it('marks what the manual promises', () => {
      const near = LANES - 1;
      // STOP LOSS: the panel under your shadow.
      expect(movePanels(MOVES['stop-loss']!, { cols: 3, bossFile: 0, youFile: 2 })).toEqual([
        { file: 2, lane: near },
      ]);
      // REORG: your file and its own, low.
      expect(movePanels(MOVES.reorg!, { cols: 3, bossFile: 0, youFile: 2 })).toEqual([
        { file: 0, lane: near },
        { file: 2, lane: near },
      ]);
      // CIRCUIT BREAKER: the whole far row.
      expect(movePanels(MOVES['circuit-breaker']!, { cols: 3, bossFile: 0, youFile: 1 })).toEqual([
        { file: 0, lane: FIRST_PLAYER_LANE },
        { file: 1, lane: FIRST_PLAYER_LANE },
        { file: 2, lane: FIRST_PLAYER_LANE },
      ]);
      // SUNK COST: three files around it, low — boss file first, then its neighbours.
      expect(movePanels(MOVES['sunk-cost']!, { cols: 3, bossFile: 1, youFile: 0 })).toEqual([
        { file: 1, lane: near },
        { file: 0, lane: near },
        { file: 2, lane: near },
      ]);
    });

    it('leads each regional mob with its own word, and leaves spark alone', () => {
      expect(ARCHETYPES.walker.pool[0]).toBe('stop-loss');
      expect(ARCHETYPES.mite.pool[0]).toBe('nibble');
      expect(ARCHETYPES.tollkeeper.pool[0]).toBe('toll');
      expect(ARCHETYPES.glitch.pool[0]).toBe('reorg');
      expect(ARCHETYPES.wisp.pool[0]).toBe('circuit-breaker');
      expect(ARCHETYPES.husk.pool[0]).toBe('sunk-cost');
      for (const a of ['mite', 'walker', 'tollkeeper', 'glitch', 'wisp', 'husk'] as const) {
        for (const id of ARCHETYPES[a].pool) expect(MOVES[id], `${a} move ${id}`).toBeTruthy();
      }
      // Spark is also an anomaly and a dungeon boss: its vocabulary is frozen.
      expect(ARCHETYPES.spark.pool).toEqual(['bagholder', 'frontrun', 'double-spend', 'rug-pull']);
    });

    it('speaks its signature at home, and nothing it has not earned', () => {
      const reachable = (arch: string, phase: number, depth: number): Set<string> => {
        const out = new Set<string>();
        for (let i = 0; i < 100; i++) out.add(pickMove(arch, phase, depth, () => i / 100).id);
        return out;
      };
      // Tolls, depth 2: the walker's whole voice is three words, the mite's three, the gate's four.
      expect(reachable('walker', 1, 2)).toEqual(new Set(['stop-loss', 'frontrun', 'bagholder']));
      expect(reachable('mite', 1, 2)).toEqual(new Set(['nibble', 'bagholder', 'frontrun']));
      expect(reachable('tollkeeper', 1, 2)).toEqual(new Set(['toll', 'stop-loss', 'frontrun', 'bagholder']));
      // Ash Pine, depth 2: the glitch speaks all five.
      expect(reachable('glitch', 1, 2)).toEqual(
        new Set(['reorg', 'bagholder', 'frontrun', 'double-spend', 'midcurve']),
      );
      // Glass Marsh, depth 3: the wisp's whole ring.
      expect(reachable('wisp', 1, 3)).toEqual(
        new Set(['circuit-breaker', 'bagholder', 'frontrun', 'double-spend']),
      );
      // Causeway, depth 5: the husk opens with four words and learns the fifth as it dies.
      expect(reachable('husk', 1, 5)).toEqual(
        new Set(['sunk-cost', 'bagholder', 'midcurve', 'double-spend']),
      );
      expect(reachable('husk', 3, 5)).toEqual(
        new Set(['sunk-cost', 'bagholder', 'midcurve', 'double-spend', 'sandwich']),
      );
      // And the depth gate holds: nowhere below Ash Pine ever hears a REORG.
      expect(reachable('glitch', 4, 1)).toEqual(new Set(['bagholder', 'frontrun']));
    });
  });

  it('gives the six line mobs real moves and honest mechanics', () => {
    for (const a of ['mite', 'walker', 'tollkeeper', 'glitch', 'wisp', 'husk'] as const) {
      const info = ARCHETYPES[a];
      expect(info, a).toBeTruthy();
      expect(info.pool.length, `${a} pool`).toBeGreaterThan(0);
      for (const move of info.pool) expect(MOVES[move], `${a} move ${move}`).toBeTruthy();
      expect(info.blurb.length, `${a} blurb`).toBeGreaterThan(0);
    }
    expect(ARCHETYPES.walker.mirrors).toBe(false);
    expect(ARCHETYPES.tollkeeper.guard).toBe(ARCHETYPES.baron.guard);
    expect(ARCHETYPES.wisp.walls).toBe(true);
    expect(ARCHETYPES.husk.guard).toBeGreaterThan(0);
    expect(ARCHETYPES.husk.guard).toBeLessThan(ARCHETYPES.baron.guard);
  });

  it('keeps wardens still and lets drifts patrol', () => {
    const warden = mobSpawns('tolls').find((m) => m.kind === 'warden')!;
    expect(warden.roam).toBe(0);
    expect(mobAt(warden, 1_000_000)).toEqual(mobAt(warden, 9_000_000));
    expect(mobFacing(warden, 1_000_000)).toBe(0);
    const drift = mobSpawns('tolls').find((m) => m.kind === 'drift')!;
    expect(drift.roam).toBeGreaterThan(0);
    // Patrol tempo: over a full wander period some two-second window must read as walking,
    // otherwise the road looks inhabited by statues. Fixed timestamps, so deterministic.
    let leg = 0;
    for (let n = 0; n <= 14; n++) {
      const a = mobAt(drift, 1_000_000 + n * 2000);
      const b = mobAt(drift, 1_000_000 + (n + 1) * 2000);
      leg = Math.max(leg, Math.hypot(a.x - b.x, a.z - b.z));
    }
    expect(leg, 'a drift visibly walks within two seconds').toBeGreaterThan(1);
    const a = mobAt(drift, 1_000_000);
    const b = mobAt(drift, 1_000_000 + 30_000);
    expect(Math.hypot(a.x - b.x, a.z - b.z), 'a drift walks over half a minute').toBeGreaterThan(0.5);
    expect(Number.isFinite(mobFacing(drift, 1_000_000))).toBe(true);
  });
});
