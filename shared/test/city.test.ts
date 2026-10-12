import { describe, expect, it } from 'vitest';
import { SECTORS, ZONES, arrivalFor, cityOf, isClear, layoutZone, type CityLayout, type Rect } from '../src/index.ts';

/**
 * The city has to be *walkable*, not just drawn. A door behind a wall, an NPC standing
 * in a kiosk or a gate you cannot reach is a quest nobody can finish, and none of those
 * can be seen by reading the plan — so these walk it: every cell of the zone is marked
 * free or blocked the way the player's collision would, and a flood fill from the spawn
 * has to touch everything the game sends a player to.
 */

const PLAYER = 0.55;
const CELL = 1;

function walkMask(c: CityLayout): { free: Uint8Array; w: number; d: number; cell: (x: number, z: number) => number } {
  const { bounds: b } = c;
  const w = Math.ceil((b.x1 - b.x0) / CELL);
  const d = Math.ceil((b.z1 - b.z0) / CELL);
  const free = new Uint8Array(w * d).fill(1);
  const idx = (x: number, z: number): number => {
    const ix = Math.floor((x - b.x0) / CELL);
    const iz = Math.floor((z - b.z0) / CELL);
    return ix < 0 || iz < 0 || ix >= w || iz >= d ? -1 : iz * w + ix;
  };
  for (const s of c.solids) {
    const x0 = Math.max(0, Math.floor((s.x - s.halfW - PLAYER - b.x0) / CELL));
    const x1 = Math.min(w - 1, Math.floor((s.x + s.halfW + PLAYER - b.x0) / CELL));
    const z0 = Math.max(0, Math.floor((s.z - s.halfD - PLAYER - b.z0) / CELL));
    const z1 = Math.min(d - 1, Math.floor((s.z + s.halfD + PLAYER - b.z0) / CELL));
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const cx = b.x0 + (ix + 0.5) * CELL;
        const cz = b.z0 + (iz + 0.5) * CELL;
        if (Math.abs(cx - s.x) < s.halfW + PLAYER && Math.abs(cz - s.z) < s.halfD + PLAYER) free[iz * w + ix] = 0;
      }
    }
  }
  return { free, w, d, cell: idx };
}

/** Cells reachable from the spawn, 4-connected. */
function reachable(c: CityLayout): { has: (x: number, z: number) => boolean; count: number; total: number } {
  const { free, w, d, cell } = walkMask(c);
  const spawn = c.anchors.find((a) => a.kind === 'spawn')!;
  const start = cell(spawn.x, spawn.z);
  const seen = new Uint8Array(w * d);
  const queue: number[] = [];
  if (start >= 0 && free[start]) {
    seen[start] = 1;
    queue.push(start);
  }
  let count = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    count++;
    const ix = i % w;
    const iz = (i - ix) / w;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = ix + dx;
      const nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
      const j = nz * w + nx;
      if (seen[j] || !free[j]) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return {
    has: (x, z) => {
      // An anchor is a point, a cell is a square: accept the cell or any neighbour of it.
      const i = cell(x, z);
      if (i < 0) return false;
      const ix = i % w;
      const iz = (i - ix) / w;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ix + dx;
          const nz = iz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
          if (seen[nz * w + nx]) return true;
        }
      }
      return false;
    },
    count,
    total: free.reduce((s, v) => s + v, 0),
  };
}

const overlap = (a: Rect, b: Rect, eps = 0.05): boolean => a.x0 < b.x1 - eps && a.x1 > b.x0 + eps && a.z0 < b.z1 - eps && a.z1 > b.z0 + eps;
const boxOf = (o: { x: number; z: number; w: number; d: number }): Rect => ({ x0: o.x - o.w / 2, z0: o.z - o.d / 2, x1: o.x + o.w / 2, z1: o.z + o.d / 2 });

describe.each(SECTORS)('city plan · %s', (sector) => {
  const plan = ZONES[sector];
  const city = cityOf(sector);

  it('is deterministic', () => {
    expect(JSON.stringify(layoutZone(plan))).toBe(JSON.stringify(layoutZone(plan)));
  });

  it('is big enough to be a place, not a street', () => {
    const w = city.extent.x1 - city.extent.x0;
    const d = city.extent.z1 - city.extent.z0;
    expect(w * d).toBeGreaterThan(40_000);
    expect(city.lots.length).toBeGreaterThan(80);
    expect(city.areas.length).toBeGreaterThanOrEqual(10);
  });

  it('keeps every building inside the zone and clear of every other', () => {
    const boxes = [
      ...city.lots.map((l) => ({ id: l.id, r: boxOf(l) })),
      ...city.landmarks.map((l) => ({ id: l.id, r: boxOf(l) })),
    ];
    for (const b of boxes) {
      expect(b.r.x0, b.id).toBeGreaterThanOrEqual(city.extent.x0);
      expect(b.r.x1, b.id).toBeLessThanOrEqual(city.extent.x1);
      expect(b.r.z0, b.id).toBeGreaterThanOrEqual(city.extent.z0);
      expect(b.r.z1, b.id).toBeLessThanOrEqual(city.extent.z1);
    }
    const clashes: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (overlap(boxes[i]!.r, boxes[j]!.r)) clashes.push(`${boxes[i]!.id} x ${boxes[j]!.id}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('turns every named door into an anchor, and every named NPC into a person', () => {
    const named = plan.blocks.flat().flatMap((b) => b.doors ?? []);
    for (const d of named) expect(city.anchors.some((a) => a.id === d.id), `door ${d.id}`).toBe(true);
    for (const n of plan.npcs) expect(city.anchors.some((a) => a.id === n.id), `npc ${n.id}`).toBe(true);
    for (const p of plan.pois) expect(city.anchors.some((a) => a.id === p.id), `poi ${p.id}`).toBe(true);
    for (const g of plan.gates) expect(city.anchors.some((a) => a.id === `gate-${g.side}`), `gate ${g.side}`).toBe(true);
  });

  it('has the six doors the game is built around', () => {
    const kinds = new Set(city.anchors.filter((a) => a.kind === 'door' || a.kind === 'fold').map((a) => a.sub));
    for (const k of ['shop', 'heal', 'station', 'brother', 'telemetry', 'dungeon']) expect(kinds.has(k), k).toBe(true);
  });

  it('never stands a person, a point of interest or the spawn inside a wall', () => {
    for (const a of city.anchors) {
      if (a.kind !== 'npc' && a.kind !== 'board' && a.kind !== 'poi' && a.kind !== 'spawn') continue;
      expect(isClear(city.solids, a.x, a.z, 0, 0, 0.5), `${a.id} at ${a.x.toFixed(1)},${a.z.toFixed(1)}`).toBe(true);
    }
  });

  it('lets a player walk from the spawn to every door, NPC, point of interest and gate', () => {
    const walk = reachable(city);
    const stuck = city.anchors.filter((a) => !walk.has(a.x, a.z)).map((a) => `${a.kind}:${a.id}`);
    expect(stuck).toEqual([]);
    // And the walkable space is one connected city, not a handful of islands.
    expect(walk.count / walk.total).toBeGreaterThan(0.93);
  });

  it('has eighteen Mystery Waves, spread across the neighbourhoods and clear of everything', () => {
    const waves = city.anchors.filter((a) => a.kind === 'wave');
    expect(waves).toHaveLength(18);
    expect(new Set(waves.map((w) => w.area)).size).toBeGreaterThanOrEqual(8);
    for (const w of waves) {
      for (const o of city.anchors) {
        if (o === w || o.kind === 'gate' || o.kind === 'wave') continue;
        expect(Math.hypot(o.x - w.x, o.z - w.z), `${w.id} near ${o.id}`).toBeGreaterThan(4);
      }
    }
  });

  it('lets you arrive from any neighbour on open road', () => {
    const walk = reachable(city);
    for (const from of SECTORS) {
      if (from === sector) continue;
      const at = arrivalFor(city, from);
      expect(isClear(city.solids, at.x, at.z, 0, 0, 0.6), `from ${from}`).toBe(true);
      expect(walk.has(at.x, at.z), `from ${from}`).toBe(true);
    }
  });

  it('puts the gates on the ring road, and sends them somewhere else', () => {
    for (const g of city.anchors.filter((a) => a.kind === 'gate')) {
      expect(g.sub).not.toBe(sector);
      expect(g.x).toBeGreaterThan(city.bounds.x0);
      expect(g.x).toBeLessThan(city.bounds.x1);
    }
  });
});

describe('the city', () => {
  it('is built from brick and rowhouses, not towers', () => {
    const styles = new Set(cityOf('ashflat').lots.map((l) => l.style));
    expect(styles.has('rowhouse')).toBe(true);
    expect(styles.has('tower')).toBe(false);
  });

  it('has no gates to other districts, and one door down to the dungeons', () => {
    const anchors = cityOf('ashflat').anchors;
    expect(anchors.filter((a) => a.kind === 'gate')).toEqual([]);
    expect(anchors.filter((a) => a.kind === 'fold')).toHaveLength(1);
  });

  it('is called Genesis', () => {
    expect(cityOf('ashflat').name).toBe('GENESIS');
  });
});
