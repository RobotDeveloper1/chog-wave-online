import { describe, expect, it } from 'vitest';
import { AGGRO_R, CHASE_CONTACT, GIVE_UP_R, archetypeForEncounter, chaseStep, mobAt, mobFacing, mobSpawns, type MobSpawn } from '../src/line/mobs.ts';
import { lineLayout, walkable } from '../src/line/layout.ts';
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

describe('line mobs chase', () => {
  const spawn = () => mobSpawns('tolls')[0]!;
  const NOW = 1_700_000_000_000;

  /** A foe off the patrol along a ray the run can actually travel: foe and midpoint dry. */
  function foeAlong(m: MobSpawn, nowMs: number, dist = 10): { x: number; z: number } {
    const patrol = mobAt(m, nowMs);
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const foe = { x: patrol.x + dx * dist, z: patrol.z + dz * dist };
      const mid = { x: patrol.x + dx * dist * 0.6, z: patrol.z + dz * dist * 0.6 };
      if (walkable(m.region, foe.x, foe.z) && walkable(m.region, mid.x, mid.z)) return foe;
    }
    throw new Error('no dry ray off this patrol');
  }

  it('patrols past a foe beyond the aggro radius, keeping no anchor', () => {
    const m = spawn();
    const patrol = mobAt(m, NOW);
    const far = { x: patrol.x + AGGRO_R + 5, z: patrol.z };
    const r = chaseStep(null, m, NOW, far);
    expect(r.anchor).toBeNull();
    expect({ x: r.x, z: r.z }).toEqual(patrol);
  });

  it('notices a foe inside and runs it down at species speed', () => {
    const m = spawn();
    const patrol = mobAt(m, NOW);
    const foe = foeAlong(m, NOW, 10);
    const r0 = chaseStep(null, m, NOW, foe);
    expect(r0.anchor).not.toBeNull();
    // The run starts where the patrol stood: no teleport on notice.
    expect(Math.hypot(r0.x - patrol.x, r0.z - patrol.z)).toBeLessThan(0.01);
    const later = chaseStep(r0.anchor, m, NOW + 2000, foe);
    const d0 = Math.hypot(r0.x - foe.x, r0.z - foe.z);
    const d1 = Math.hypot(later.x - foe.x, later.z - foe.z);
    expect(d1).toBeLessThan(d0);
    // Two seconds at species speed: the run is a run, not a lean.
    expect(d0 - d1).toBeCloseTo(Math.min(m.chaseSpeed * 2, d0 - CHASE_CONTACT), 1);
  });

  it('stops at contact, so the duel opens on a touch', () => {
    const m = spawn();
    const foe = foeAlong(m, NOW, 8);
    const r0 = chaseStep(null, m, NOW, foe);
    const r1 = chaseStep(r0.anchor, m, NOW + 30000, foe);
    expect(Math.hypot(r1.x - foe.x, r1.z - foe.z)).toBeLessThanOrEqual(CHASE_CONTACT + 0.01);
  });

  it('gives up past the rim and walks home, clearing the anchor on arrival', () => {
    const m = spawn();
    const patrol = mobAt(m, NOW);
    const foe = foeAlong(m, NOW, 10);
    const r0 = chaseStep(null, m, NOW, foe);
    expect(r0.anchor?.back).toBeFalsy();
    const far = { x: patrol.x + AGGRO_R + GIVE_UP_R + 5, z: patrol.z };
    const r1 = chaseStep(r0.anchor, m, NOW + 1000, far);
    expect(r1.anchor?.back).toBe(true);
    // The turn starts from the run's own feet, within one second of travel.
    expect(Math.hypot(r1.x - r0.x, r1.z - r0.z)).toBeLessThan(m.chaseSpeed * 1 + 0.01);
    const home = chaseStep(r1.anchor, m, NOW + 60000, null);
    expect(home.anchor).toBeNull();
    expect({ x: home.x, z: home.z }).toEqual(mobAt(m, NOW + 60000));
  });

  it('is deterministic from the same anchor, so both sides agree exactly', () => {
    const m = spawn();
    const foe = { x: m.home.x + 7, z: m.home.z - 3 };
    const a = chaseStep(null, m, NOW, foe);
    expect(chaseStep(null, m, NOW, foe)).toEqual(a);
    expect(chaseStep(a.anchor, m, NOW + 1500, foe)).toEqual(chaseStep(a.anchor, m, NOW + 1500, foe));
  });

  it('faces down the run while moving, the foe at contact, the walk otherwise', () => {
    const m = spawn();
    const patrol = mobAt(m, NOW);
    const foe = foeAlong(m, NOW, 8);
    const want = Math.atan2(foe.x - patrol.x, foe.z - patrol.z);
    const r0 = chaseStep(null, m, NOW, foe);
    // Standing at notice: turned to face the foe, in one turn.
    expect(r0.facing).toBeCloseTo(want, 9);
    const r1 = chaseStep(r0.anchor, m, NOW + 1500, foe);
    // Running: facing the run, which is straight at a standing foe — no whipping
    // when the player strafes, because the yaw follows the body, not the boots.
    expect(r1.facing).toBeCloseTo(want, 5);
    const far = { x: patrol.x + AGGRO_R + 5, z: patrol.z };
    expect(chaseStep(null, m, NOW, far).facing).toBe(mobFacing(m, NOW));
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

  it('fields each region its own ladder of fights, nearest drift first', () => {
    // The whole table, not spot checks: every region climbs from its own weakest mob
    // at the nearest drift to something faster, tougher, or stranger at the far end.
    // Tolls opens on mites because the farm track is where the game starts.
    const drifts: Record<string, string[]> = {
      tolls: ['imp', 'walker', 'mite', 'mite'],
      ashpine: ['imp', 'glitch', 'glitch', 'spark'],
      marsh: ['husk', 'husk', 'spark', 'wisp'],
      relay: ['surge', 'glitch', 'spark', 'glitch'],
      causeway: ['husk', 'front', 'front', 'spark'],
      static: ['husk', 'imp', 'husk', 'spark'],
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
    // Every body of one drift wears the same fight.
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
