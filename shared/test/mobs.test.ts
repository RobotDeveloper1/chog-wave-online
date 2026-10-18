import { describe, expect, it } from 'vitest';
import {
  ENCOUNTERS,
  REGION_IDS,
  allMobSpawns,
  lineLayout,
  mobAt,
  mobSpawns,
  walkable,
  type RegionId,
} from '../src/line/index.ts';

/**
 * The mobs, as a contract.
 *
 * Two things have to be true for the whole "walk into it and fight" design to hold, and both are
 * asserted here rather than hoped for in the browser:
 *
 *  - **every mob stands on ground you can reach**, because a mob in the marsh is a fight
 *    `siteUnder` can start but the player can never walk into;
 *  - **a drift's bodies are far enough apart to meet one at a time**, because two reaches that
 *    overlap are one encounter firing before the first has finished.
 */

describe('mobs — the roster', () => {
  it('fields two bodies for a drift, one for a post, one for a warden', () => {
    for (const id of REGION_IDS) {
      for (const e of ENCOUNTERS.filter((x) => x.region === id)) {
        const bodies = mobSpawns(id).filter((m) => m.encounterId === e.id);
        expect(bodies.length, e.id).toBe(e.kind === 'drift' ? 2 : 1);
      }
    }
  });

  it('names every mob uniquely, so a kill is a kill of exactly one thing', () => {
    expect(() => allMobSpawns()).not.toThrow();
    expect(new Set(allMobSpawns().map((m) => m.id)).size).toBe(allMobSpawns().length);
  });

  it('gives every region eleven bodies to meet', () => {
    for (const id of REGION_IDS) expect(mobSpawns(id)).toHaveLength(11);
  });

  it('lets a warden stand still and makes everything else wander', () => {
    for (const m of allMobSpawns()) {
      expect(m.roam, m.id).toBe(m.kind === 'warden' ? 0 : m.roam > 0 ? m.roam : NaN);
    }
  });

  it('brings wardens back never, posts in minutes, drifts in a minute and a half', () => {
    for (const m of allMobSpawns()) {
      expect(m.respawnS, m.id).toBe(m.kind === 'warden' ? 0 : m.kind === 'post' ? 150 : 90);
    }
  });

  it('speaks the encounter\'s own element, so the fight reads before it starts', () => {
    for (const m of allMobSpawns()) {
      const l = lineLayout(m.region);
      const site = l.encounters.find((e) => e.id === m.encounterId)!;
      expect(['drift', 'post', 'warden']).toContain(m.kind);
      expect(site.kind).toBe(m.kind);
    }
  });
});

describe('mobs — where they stand', () => {
  it('puts every body on ground the player can walk to', () => {
    for (const m of allMobSpawns()) {
      expect(walkable(m.region, m.home.x, m.home.z), m.id).toBe(true);
    }
  });

  it('keeps a drift\'s two bodies one encounter apart, never one fight', () => {
    for (const id of REGION_IDS) {
      for (const e of ENCOUNTERS.filter((x) => x.region === id && x.kind === 'drift')) {
        const [a, b] = mobSpawns(id).filter((m) => m.encounterId === e.id);
        const d = Math.hypot(a!.home.x - b!.home.x, a!.home.z - b!.home.z);
        // Two reaches that overlap are one fight starting inside another. `reach` is 6, so 14
        // leaves a real corridor between them.
        expect(d, e.id).toBeGreaterThan(14);
      }
    }
  });

  it('keeps every body clear of the road\'s sites, so the walk stays a walk', () => {
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      for (const m of mobSpawns(id)) {
        for (const s of l.encounters) {
          if (s.id === m.encounterId) continue;
          expect(Math.hypot(m.home.x - s.x, m.home.z - s.z), `${m.id} vs ${s.id}`).toBeGreaterThan(10);
        }
      }
    }
  });
});

describe('mobs — how they move', () => {
  it('is a pure function of time, so the server and the client draw the same walk', () => {
    const [m] = mobSpawns('tolls').filter((x) => x.kind === 'drift');
    expect(mobAt(m!, 1_000)).toEqual(mobAt(m!, 1_000));
    expect(mobAt(m!, 1_000)).not.toEqual(mobAt(m!, 60_000));
  });

  it('stays near home and on dry ground, however long it wanders', () => {
    for (const m of allMobSpawns().filter((x) => x.roam > 0)) {
      for (const t of [0, 7_000, 43_000, 120_000, 300_000]) {
        const p = mobAt(m, t);
        expect(Math.hypot(p.x - m.home.x, p.z - m.home.z), `${m.id} t=${t}`).toBeLessThanOrEqual(m.roam + 1);
        expect(walkable(m.region, p.x, p.z), `${m.id} t=${t}`).toBe(true);
      }
    }
  });

  it('never moves a warden, whatever the clock says', () => {
    for (const m of allMobSpawns().filter((x) => x.kind === 'warden')) {
      expect(mobAt(m, 999_999)).toEqual(m.home);
    }
  });
});