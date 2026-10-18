/**
 * The Line, from the ground up.
 *
 * **No heightfield.** The first three versions of this file generated a 0-to-14-unit terrain with
 * value noise, and every one of them was unfilmable for the same reason: the game's camera rigs
 * frame a floor at a fixed chest height, so any real relief puts the player out of frame, and any
 * attempt to compensate puts the camera inside the hill. The terrain is now **flat at y = 0**.
 * All depth comes from what stands on the ground — which is where it belonged anyway.
 *
 * That one decision also removes two whole classes of bug that were real and reported:
 *
 *  - *"there is no ground"* — a camera aiming at `focusY` absolute, on a ground that is not at
 *    that height, is a camera aimed into the side of a hill. Flat ground cannot do that.
 *  - *"I walk and hit nothing"* — the walkable test and the drawn surface were derived from the
 *    same noise, and any disagreement between them was invisible until you walked into it.
 *
 * What is kept, because it worked: deterministic placement from a seed both sides run, a road with
 * the sites in walk order, and biome silhouettes that read before the banner does.
 */

import { ENCOUNTERS, REGION_BY_ID, type EncounterDef, type RegionId } from './index.ts';

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

function hash2(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Biomes
// ---------------------------------------------------------------------------

export type TreeKind = 'pine' | 'bare' | 'reed' | 'pylon' | 'bone' | 'none';

export interface Biome {
  ground: number;
  groundHigh: number;
  waterColour: number;
  tree: TreeKind;
  density: number;
  bark: number;
  leaf: number;
  rock: number;
  haze: number;
}

export const BIOMES: Record<RegionId, Biome> = {
  tolls:    { ground: 0x7a6142, groundHigh: 0x9a7d4e, waterColour: 0x2b2a3e, tree: 'bare',  density: 26, bark: 0x5a4a34, leaf: 0x8f7c4e, rock: 0x7d7466, haze: 0.42 },
  ashpine:  { ground: 0x3a2f2c, groundHigh: 0x4d3c33, waterColour: 0x241f26, tree: 'pine',  density: 30, bark: 0x241c1c, leaf: 0x2e3138, rock: 0x4a423f, haze: 0.66 },
  marsh:    { ground: 0x2b3a3e, groundHigh: 0x3c4a44, waterColour: 0x16232b, tree: 'reed',  density: 24, bark: 0x3b4a42, leaf: 0x54705f, rock: 0x586470, haze: 0.58 },
  relay:    { ground: 0x4a4038, groundHigh: 0x6b5a44, waterColour: 0x2a2436, tree: 'pylon', density: 16, bark: 0x554a40, leaf: 0x8a7448, rock: 0x7a6a58, haze: 0.74 },
  causeway: { ground: 0x2f3a44, groundHigh: 0x41505c, waterColour: 0x141f2b, tree: 'bone',  density: 18, bark: 0x46525c, leaf: 0x5f7480, rock: 0x55606b, haze: 0.50 },
  static:   { ground: 0x1e1c28, groundHigh: 0x2a2740, waterColour: 0x120f1c, tree: 'none',  density: 6,  bark: 0x2a2434, leaf: 0x3a3350, rock: 0x342e46, haze: 0.86 },
};

/** A seed per region, so the six worlds never share a silhouette. */
const SEEDS: Record<RegionId, number> = {
  tolls: 0x7a11, ashpine: 0x5b2e, marsh: 0x3cd9, relay: 0x91f4, causeway: 0x2ab7, static: 0xe150,
};

export const seedOf = (region: RegionId): number => SEEDS[region];

/**
 * One plan per region: how its road runs, how far its sites spread, how its camp pitches.
 *
 * The six regions used to be one plan in six paints — the same road, the same seven sites at
 * the same spacing, the same camp — so the second region walked exactly like the first. The
 * anatomy is still the same everywhere (seven sites in walk order, on the road, reachable),
 * but the ground is not:
 *
 *  - **the road meanders its own way** (`amp`/`freq`): the marsh walks a near-straight
 *    causeway over water, the relay flats switch back between the masts, the static road
 *    jitters. Amplitudes stay small on purpose — tents pitch up to 40 units off the
 *    centreline, so a road that wanders is a camp in the next region;
 *  - **the road runs its own width** (`widthMul`): the drowned highway is half as wide again
 *    as the Tolls farm track. Tolls is 1.0 and must stay 1.0 — it is the minimum width the
 *    road tests pin through the single-argument `roadHalfAt`;
 *  - **the sites walk their own legs** (`zStart` + six legs): Tolls is a short walk with
 *    short legs, the causeway is a march, and the last leg is the warden's final approach —
 *    a stretch of empty road before the gate, longer the deeper the region. Every leg still
 *    clears 30 units, because "five seconds of walking between fights" is a design statement;
 *  - **the middle leg is the trailhead clearing**: it straddles the spawn with both ends at
 *    least 24 units out, so no encounter starts inside the camp's safe radius. An even
 *    spacing marches a site to within a few units of the fire, and the safety shift that
 *    rescues it eats the whole leg to the neighbouring site;
 *  - **the camp pitches its own way**: which tents, which side the fire burns on.
 */
export interface RegionPlan {
  road: { amp1: number; freq1: number; amp2: number; freq2: number };
  widthMul: number;
  sites: { zStart: number; legs: [number, number, number, number, number, number] };
  camp: {
    tents: [readonly [number, number], readonly [number, number], readonly [number, number]];
    fireSide: 1 | -1;
    npcSide: 1 | -1;
  };
}

export const REGION_PLAN: Record<RegionId, RegionPlan> = {
  tolls: {
    road: { amp1: 26, freq1: 2.1, amp2: 7, freq2: 5.3 },
    widthMul: 1.0,
    sites: { zStart: -100, legs: [34, 34, 60, 34, 34, 34] },
    camp: { tents: [[-6, -1], [3, 1], [9, -1]], fireSide: 1, npcSide: 1 },
  },
  ashpine: {
    road: { amp1: 34, freq1: 2.6, amp2: 9, freq2: 6.1 },
    widthMul: 1.1,
    sites: { zStart: -112, legs: [38, 38, 66, 38, 38, 44] },
    camp: { tents: [[-8, 1], [2, -1], [10, 1]], fireSide: -1, npcSide: -1 },
  },
  marsh: {
    road: { amp1: 14, freq1: 1.4, amp2: 5, freq2: 4.2 },
    widthMul: 1.2,
    sites: { zStart: -124, legs: [42, 42, 66, 42, 42, 44] },
    camp: { tents: [[-10, 1], [4, -1], [12, 1]], fireSide: 1, npcSide: -1 },
  },
  relay: {
    road: { amp1: 30, freq1: 3.4, amp2: 10, freq2: 7.0 },
    widthMul: 1.15,
    sites: { zStart: -108, legs: [36, 36, 68, 36, 36, 42] },
    camp: { tents: [[-5, -1], [5, 1], [11, -1]], fireSide: -1, npcSide: 1 },
  },
  causeway: {
    road: { amp1: 8, freq1: 1.1, amp2: 3, freq2: 3.0 },
    widthMul: 1.6,
    sites: { zStart: -120, legs: [44, 44, 60, 38, 38, 52] },
    camp: { tents: [[-9, 1], [1, -1], [8, 1]], fireSide: 1, npcSide: 1 },
  },
  static: {
    road: { amp1: 20, freq1: 4.3, amp2: 12, freq2: 8.2 },
    widthMul: 1.0,
    sites: { zStart: -116, legs: [40, 40, 66, 40, 40, 46] },
    camp: { tents: [[-7, -1], [6, 1], [12, -1]], fireSide: -1, npcSide: -1 },
  },
};

/**
 * The road's centreline: the same curve the client ribbons.
 *
 * Lives here (not in `render.ts`) so the sites, the spawn, the prop clearing and the drawn
 * strip all agree on where the road is. An earlier version kept two curves — the layout
 * placed sites on `sin()*110` while the renderer drew `sin()*26` — so encounters stood far
 * off the visible road and the maps read as broken.
 */
export function roadXAt(region: RegionId, z: number): number {
  const salt = SEEDS[region];
  const p = REGION_PLAN[region].road;
  const t = (z + REGION_SIZE / 2) / REGION_SIZE;
  return Math.sin(t * Math.PI * p.freq1 + salt * 0.7) * p.amp1 + Math.sin(t * Math.PI * p.freq2 + salt) * p.amp2;
}

/**
 * Half-width of the road at a point, widening gently where it bends. Same curve as the ribbon.
 *
 * Pass the region for that road's own width. Without it this is the Tolls farm track — the
 * minimum width, and the form the road tests pin — because every per-region width only ever
 * grows from here.
 */
export function roadHalfAt(z: number, region?: RegionId): number {
  const base = 3.4 + Math.abs(Math.cos((z / REGION_SIZE) * Math.PI * 4)) * 1.1;
  return region === undefined ? base : base * REGION_PLAN[region].widthMul;
}

// ---------------------------------------------------------------------------
// The world square
// ---------------------------------------------------------------------------

/** A region is a square this many units on a side. */
export const REGION_SIZE = 420;

/** Keep-out at the edge, so nobody walks off the terrain mesh into the fog. */
export const REGION_MARGIN = 24;

/** The flat ground. Kept as a function so nothing has to change shape when it stops being 0. */
export const heightAt = (_region: RegionId, _x: number, _z: number): number => 0;

export const walkable = (region: RegionId, x: number, z: number): boolean => {
  const half = REGION_SIZE / 2 - REGION_MARGIN;
  return x >= -half && x <= half && z >= -half && z <= half;
};

/** What a solid is drawn as: a tree, a boulder, or a trailhead tent (drawn by the camp builder, not the prop loop). */
export type TreeLike = TreeKind | 'rock' | 'tent';

/**
 * One solid.
 *
 * `halfW`/`halfD` are **exactly** the half-width `render.ts` draws — that is the whole point, and
 * it is the fix for a bug that took three rewrites to name: a 1.8-metre collision box under a
 * 0.42-metre trunk is a wall of nothing, and in a forest it is a maze. `shared/test/collision.test.ts`
 * asserts the two sides agree in both directions.
 */
export interface TerrainSolid {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  kind: TreeLike;
}

export interface EncounterSite {
  id: string;
  kind: EncounterDef['kind'];
  name: string;
  x: number;
  z: number;
  reach: number;
}

export interface LineLayout {
  region: RegionId;
  seed: number;
  biome: Biome;
  bounds: { x0: number; x1: number; z0: number; z1: number };
  spawn: { x: number; z: number };
  exit: { x: number; z: number } | null;
  solids: TerrainSolid[];
  encounters: EncounterSite[];
  heightAt(x: number, z: number): number;
  walkable(x: number, z: number): boolean;
  siteAt(x: number, z: number, reach: number): EncounterSite | null;
}

const HALF = REGION_SIZE / 2;

/**
 * Seven sites on a road that walks north, in walk order.
 *
 * The legs are the region's own (`REGION_PLAN`): Tolls walks short legs, the causeway marches,
 * and the last leg is the warden's final approach. The middle leg is the trailhead clearing —
 * it straddles the spawn, so the camp sits in empty road instead of inside a fight's reach.
 *
 * A site is placed at its final z and nudged **sideways only** — never north or south — so two
 * neighbouring sites can never swap places, and the gap between them can never collapse to a
 * walk into two fights at once. The centreline is read at the site's own z: reading it anywhere
 * else puts the site off the visible road on any curve with a real bend.
 */
function sitesOf(region: RegionId): EncounterSite[] {
  const enc = ENCOUNTERS.filter((e) => e.region === region);
  const plan = REGION_PLAN[region].sites;
  let z = plan.zStart;
  return enc.map((e, i) => {
    if (i > 0) z += plan.legs[i - 1]!;
    const x0 = roadXAt(region, z);
    // Walk sideways from the centreline until walkable. Bounded, so a crowded region still
    // places every site — and sideways only, so walk order never changes.
    let x = x0;
    for (let d = 0; d <= 18; d++) {
      const cand = [x0 + d * 9, x0 - d * 9];
      const first = cand.find((cx) => walkable(region, cx, z));
      if (first !== undefined) { x = first; break; }
    }
    return { id: e.id, kind: e.kind, name: e.name, x, z, reach: 7 };
  });
}

/** Every prop in the region, on a jittered grid, sized to what `render.ts` draws. */
function solidsOf(region: RegionId, sites: EncounterSite[]): TerrainSolid[] {
  const b = BIOMES[region];
  const seed = SEEDS[region];
  const out: TerrainSolid[] = [];
  const step = Math.sqrt(1000 / Math.max(1, b.density));
  const half = HALF - REGION_MARGIN;
  for (let x = -half; x <= half; x += step) {
    for (let z = -half; z <= half; z += step) {
      const jx = hash2(Math.round(x), Math.round(z), seed);
      const jz = hash2(Math.round(z), Math.round(x), seed + 7);
      if (jx > (b.density / 1000) * step * step) continue;
      const px = x + (jx - 0.5) * step * 0.8;
      const pz = z + (jz - 0.5) * step * 0.8;
      if (!walkable(region, px, pz)) continue;
      // Clear the sites and the road: a tree planted on an encounter is a fight you cannot reach.
      if (sites.some((s) => Math.hypot(s.x - px, s.z - pz) < 15)) continue;
      if (Math.abs(px - roadXAt(region, pz)) < roadHalfAt(pz, region) + 2.5) continue;
      const isRock = jz > 0.86;
      // Collision equals the drawing. Trees are 0.42 wide; a rock's slab is drawn `halfW * 1.8`
      // wide, so its own half-width is `halfW * 0.9` and that is the box.
      const rockHalf = (1.2 + jx * 1.6) / 0.9;
      out.push({
        x: px, z: pz,
        halfW: isRock ? rockHalf * 0.9 : 0.21,
        halfD: isRock ? (1.1 + jz * 1.5) * 0.9 : 0.21,
        kind: isRock ? 'rock' : b.tree,
      });
    }
  }
  return out;
}

/** Nobody is ambushed at the trailhead: no body starts within this of the spawn. */
export const TRAILHEAD_SAFE_R = 30;

const cache = new Map<RegionId, LineLayout>();

const spawnOf = (region: RegionId): { x: number; z: number } => ({ x: roadXAt(region, 0), z: 0 });

/** The trailhead camp: tents off the road, a fire, and whoever the Line posted there. */
export interface TrailCamp {
  tents: { x: number; z: number; r: number }[];
  fire: { x: number; z: number };
  npc: { x: number; z: number; name: string };
}

export function campOf(region: RegionId): TrailCamp {
  const sp = spawnOf(region);
  const sites = sitesOf(region);
  const plan = REGION_PLAN[region].camp;
  // A tent needs road shoulder AND site corridor: sideways only (like the sites, so walk order
  // never changes), first fit wins. Deterministic, and the corridor test holds by construction.
  const place = (dz: number, dir: number): { x: number; z: number } => {
    const z = sp.z + dz;
    const cx = roadXAt(region, z);
    for (let d = 11; d <= 40; d += 1) {
      for (const sgn of [dir, -dir]) {
        const x = cx + sgn * d;
        if (Math.abs(x - cx) < roadHalfAt(z, region) + 2.5) continue;
        if (!sites.every((s) => Math.hypot(x - s.x, z - s.z) >= 16)) continue;
        if (!walkable(region, x, z)) continue;
        return { x, z };
      }
    }
    return { x: cx + dir * 16, z };
  };
  const [[dz1, dir1], [dz2, dir2], [dz3, dir3]] = plan.tents;
  const t1 = place(dz1, dir1);
  const t2 = place(dz2, dir2);
  const t3 = place(dz3, dir3);
  // The fire and the scout stand off the shoulder of their own road — a fixed offset would put
  // them in the middle of the causeway's highway. Which side is the region's own.
  const fireZ = sp.z - 1;
  const npcZ = sp.z + 4;
  return {
    tents: [
      { x: t1.x, z: t1.z, r: 2.2 },
      { x: t2.x, z: t2.z, r: 2.2 },
      { x: t3.x, z: t3.z, r: 2.2 },
    ],
    fire: { x: roadXAt(region, fireZ) + plan.fireSide * (roadHalfAt(fireZ, region) + 3), z: fireZ },
    npc: { x: roadXAt(region, npcZ) + plan.npcSide * (roadHalfAt(npcZ, region) + 1.2), z: npcZ, name: 'SCOUT' },
  };
}

/** The layout for a region. Built once per process; the client reuses it across region changes. */
export function lineLayout(region: RegionId): LineLayout {
  const hit = cache.get(region);
  if (hit) return hit;
  const encounters = sitesOf(region);
  const half = HALF - REGION_MARGIN;
  const n = REGION_BY_ID.get(region)?.n ?? 1;
  const layout: LineLayout = {
    region,
    seed: SEEDS[region],
    biome: BIOMES[region],
    bounds: { x0: -half, x1: half, z0: -half, z1: half },
    spawn: spawnOf(region),
    exit: n < 6 ? { x: roadXAt(region, HALF - 50), z: HALF - 50 } : null,
    solids: [...solidsOf(region, encounters), ...campOf(region).tents.map((t) => ({ x: t.x, z: t.z, halfW: t.r, halfD: t.r, kind: 'tent' as const }))],
    encounters,
    heightAt: () => 0,
    walkable: (x, z) => walkable(region, x, z),
    siteAt(x, z, reach) {
      let best: EncounterSite | null = null;
      let bestD = reach;
      for (const s of encounters) {
        const d = Math.hypot(s.x - x, s.z - z);
        if (d <= bestD) { best = s; bestD = d; }
      }
      return best;
    },
  };
  cache.set(region, layout);
  return layout;
}


/** Forget every region. Only useful in a test that changes the tables. */
export function resetTerrain(): void {
  cache.clear();
}