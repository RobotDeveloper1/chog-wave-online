import * as THREE from 'three';

import { REGION_MARGIN, REGION_SIZE, roadHalfAt, roadXAt, type LineLayout, type RegionId } from '@chog/shared';
import type { ChunkBatcher } from '../city/batch.ts';
import { moodOf } from './theme.ts';

/**
 * The Line's detail pass: everything that makes six regions read as six places.
 *
 * `render.ts` owns the ground, the road ribbon, the camp and the mobs. This file owns
 * everything *standing* on the ground that is not a collision box with a tree on top:
 * per-region props with real silhouettes (reeds are not cones, pylons are not pines),
 * grass and pebbles, road dressing, visible encounter sites, one landmark per region,
 * the horizon ring, the sky, and the air itself (motes).
 *
 * Three rules, all load-bearing:
 *
 *  1. **Nothing here collides.** Every piece is decoration poured into the batcher or an
 *     instanced/points mesh with no collision entry. `shared/test/collision.test.ts`
 *     asserts the layout's boxes match the drawings; decoration cannot break it because
 *     decoration is never a box. Ground-level pieces still stay narrow so the eye and
 *     the walk agree.
 *  2. **No `Math.random`.** Every scatter is `hash2` on an index and the region salt, so
 *     the same region is the same place on every client and every reload.
 *  3. **Batch or instance.** A region is thousands of pieces; anything drawn as an
 *     individual mesh is a handful of glows at most.
 */

// ---------------------------------------------------------------------------
// Context and deterministic noise
// ---------------------------------------------------------------------------

/** Deterministic value noise on a lattice. Same function as `render.ts` uses. */
export function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export interface DetailCtx {
  region: RegionId;
  salt: number;
  layout: LineLayout;
  /** The renderer's own height function: decoration stands on the walked ground. */
  groundY(x: number, z: number): number;
}

/** Regions with standing water. The causeway is a flooded highway, whatever its haze says. */
export const WATER_REGIONS: ReadonlySet<RegionId> = new Set(['marsh', 'relay', 'static', 'causeway']);

/**
 * Still water sits at its own height per region: the marsh is a shallow mirror, the causeway
 * a real flood. `render.ts` floats the plane here and walks the floor 0.05 above it. Tolls and
 * Ash Pine carry a value only because the table is total — they have no water.
 */
export const WATER_LEVEL: Record<RegionId, number> = {
  tolls: -0.55,
  ashpine: -0.55,
  marsh: -0.45,
  relay: -0.55,
  causeway: -0.62,
  static: -0.5,
};

// ---------------------------------------------------------------------------
// Shared geometries (never disposed) and matrix helper
// ---------------------------------------------------------------------------

const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1, 6);
const coneGeo = new THREE.ConeGeometry(0.5, 1, 7);
const rockGeo = new THREE.IcosahedronGeometry(0.5, 0);
const thinGeo = new THREE.CylinderGeometry(0.035, 0.05, 1, 5);
const tipGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 6);
const octaGeo = new THREE.OctahedronGeometry(0.5, 0);
const sphGeo = new THREE.SphereGeometry(0.5, 8, 6);
const dishGeo = new THREE.SphereGeometry(1.6, 12, 6, 0, Math.PI * 2, 0, 0.7);
const pylonGeo = new THREE.CylinderGeometry(0.14, 0.26, 1, 4);

interface Pose {
  ry?: number;
  rx?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** Compose a placement matrix. Euler XYZ; enough for every prop here. */
function M(x: number, y: number, z: number, o: Pose = {}): THREE.Matrix4 {
  _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// ---------------------------------------------------------------------------
// Props: one silhouette per tree kind
// ---------------------------------------------------------------------------

/**
 * Pour every layout solid as the shape its kind names.
 *
 * The old loop drew every kind as trunk-plus-cones, so a relay pylon and an ash pine
 * were the same object in different paint, and the Static Line — `tree: 'none'` —
 * grew a forest anyway. Each kind now builds its own silhouette from the same
 * shared geometries, and `none` grows crystals instead of trees.
 */
export function pourProps(B: ChunkBatcher, ctx: DetailCtx): void {
  const { salt } = ctx;
  const props = ctx.layout.solids ?? [];
  for (let i = 0; i < props.length; i++) {
    const o = props[i]!;
    const kind = o.kind ?? 'pine';
    if (kind === 'tent') continue; // the camp builder draws tents
    const y = ctx.groundY(o.x, o.z);
    const j = (n: number): number => hash2(i, n, salt);
    if (kind === 'rock') {
      const s = 0.7 + j(2) * 1.5;
      B.geo('rock', rockGeo, M(o.x, y + s * 0.28, o.z, { ry: j(3) * Math.PI * 2, sx: s * (0.8 + j(4) * 0.6), sy: s * (0.6 + j(5) * 0.5), sz: s * (0.8 + j(6) * 0.6) }), 0xffffff, 0, Math.floor(j(7) * 9999));
      continue;
    }
    if (kind === 'pine') {
      // A burnt conifer: tall trunk, four dark tiers, an ash-white cap.
      const th = 3.4 + j(8) * 2.2;
      B.geo('bark', trunkGeo, M(o.x, y + th / 2, o.z, { ry: j(9) * Math.PI * 2, sy: th }), 0xffffff, 0, Math.floor(j(10) * 9999));
      for (let t = 0; t < 4; t++) {
        const w = 2.7 - t * 0.62;
        const h = 1.9;
        B.geo('leaf', coneGeo, M(o.x, y + th * 0.42 + t * 1.15 + h * 0.4, o.z, { ry: j(20 + t) * Math.PI * 2, sx: w, sy: h, sz: w }), 0xffffff, 0, Math.floor(j(30 + t) * 9999));
      }
      B.geo('pale', coneGeo, M(o.x, y + th * 0.42 + 4 * 1.15 + 0.5, o.z, { ry: j(24) * Math.PI * 2, sx: 0.5, sy: 1.0, sz: 0.5 }), 0xffffff, 0, Math.floor(j(34) * 9999));
      continue;
    }
    if (kind === 'bare') {
      // A dead tree: trunk and three bare branches, no canopy at all.
      const th = 3.0 + j(8) * 1.6;
      B.geo('bark', trunkGeo, M(o.x, y + th / 2, o.z, { ry: j(9) * Math.PI * 2, sy: th }), 0xffffff, 0, Math.floor(j(10) * 9999));
      for (let b = 0; b < 3; b++) {
        const bl = 1.3 + j(20 + b) * 1.1;
        const tilt = 0.6 + j(23 + b) * 0.5;
        const yaw = j(26 + b) * Math.PI * 2;
        const by = y + th * (0.55 + b * 0.14);
        B.geo('bark', thinGeo, M(o.x, by + (bl / 2) * Math.cos(tilt), o.z, { ry: yaw, rz: tilt, sx: 2.2, sy: bl, sz: 2.2 }), 0xffffff, 0, Math.floor(j(30 + b) * 9999));
      }
      continue;
    }
    if (kind === 'reed') {
      // A reed bed: five thin stems, the tallest tipped brown.
      for (let r = 0; r < 5; r++) {
        const a = (r / 5) * Math.PI * 2 + j(11) * 3;
        const rr = 0.1 + j(12 + r) * 0.28;
        const sx = o.x + Math.cos(a) * rr;
        const sz = o.z + Math.sin(a) * rr;
        const sh = 2.1 + j(20 + r) * 1.3;
        B.geo('leaf', thinGeo, M(sx, y + sh / 2, sz, { sx: 1.6, sy: sh, sz: 1.6, rz: (j(25 + r) - 0.5) * 0.16 }), 0xffffff, 0, Math.floor(j(30 + r) * 9999));
        if (r < 3) B.geo('bark', tipGeo, M(sx, y + sh + 0.2, sz, {}), 0xffffff, 0, Math.floor(j(35 + r) * 9999));
      }
      continue;
    }
    if (kind === 'pylon') {
      // A relay pylon: a tapered steel column, two crossarms, amber insulators,
      // and a red beacon on every third one.
      const ph = 5.0 + j(8) * 2.0;
      const yaw = j(9) * Math.PI;
      B.geo('metal', pylonGeo, M(o.x, y + ph / 2, o.z, { ry: yaw + Math.PI / 4, sy: ph }), 0xffffff, 0, Math.floor(j(10) * 9999));
      for (let a = 0; a < 2; a++) {
        const ay = y + ph * (0.68 + a * 0.17);
        const aw = 1.7 - a * 0.4;
        B.box('metal', o.x, ay, o.z, aw, 0.12, 0.12, 0xffffff, 0, { rot: yaw + (a * Math.PI) / 2, seed: Math.floor(j(20 + a) * 9999) });
        for (const s of [-1, 1]) {
          const ex = o.x + Math.cos(yaw + (a * Math.PI) / 2) * (aw / 2) * s;
          const ez = o.z - Math.sin(yaw + (a * Math.PI) / 2) * (aw / 2) * s;
          B.geo('lit', sphGeo, M(ex, ay - 0.12, ez, { sx: 0.18, sy: 0.18, sz: 0.18 }), 0xffb347, 0.8, Math.floor(j(30 + a * 2 + (s + 1)) * 9999));
        }
      }
      if (j(40) < 0.34) B.geo('lit', sphGeo, M(o.x, y + ph + 0.15, o.z, { sx: 0.22, sy: 0.22, sz: 0.22 }), 0xff2a2a, 1, Math.floor(j(41) * 9999));
      continue;
    }
    if (kind === 'bone') {
      // Rib spikes: three tilted pale cones, close enough to read as one growth.
      for (let b = 0; b < 3; b++) {
        const a = (b / 3) * Math.PI * 2 + j(11) * 3;
        const bx = o.x + Math.cos(a) * 0.3;
        const bz = o.z + Math.sin(a) * 0.3;
        const bh = 1.5 + j(20 + b) * 1.2;
        B.geo('pale', coneGeo, M(bx, y + (bh / 2) * 0.92, bz, { ry: j(23 + b) * Math.PI * 2, rz: 0.15 + j(26 + b) * 0.3, sx: 0.62, sy: bh, sz: 0.62 }), 0xffffff, 0, Math.floor(j(30 + b) * 9999));
      }
      continue;
    }
    // 'none' (the Static Line) and anything unknown: a crystal cluster, dark shards
    // with one cyan vein shard. No trees where the fiction says none.
    for (let c = 0; c < 3; c++) {
      const a = (c / 3) * Math.PI * 2 + j(11) * 3;
      const cx = o.x + Math.cos(a) * 0.32;
      const cz = o.z + Math.sin(a) * 0.32;
      const cs = 0.55 + j(20 + c) * 0.6;
      const tall = j(23 + c) < 0.3 ? 2.1 : 1.2;
      B.geo('rock', octaGeo, M(cx, y + cs * 0.5, cz, { ry: j(26 + c) * Math.PI, rz: (j(29 + c) - 0.5) * 0.7, sx: cs, sy: cs * tall, sz: cs }), 0xffffff, 0, Math.floor(j(30 + c) * 9999));
    }
    B.geo('lit', octaGeo, M(o.x, y + 0.55, o.z, { ry: j(33) * Math.PI, sx: 0.22, sy: 0.5, sz: 0.22 }), 0x37e0ff, 1, Math.floor(j(34) * 9999));
  }
}

// ---------------------------------------------------------------------------
// Ground cover: grass tufts and pebbles, instanced
// ---------------------------------------------------------------------------

const GRASS: Record<RegionId, number> = {
  tolls: 0xb89a4a,
  ashpine: 0x5a5148,
  marsh: 0x4e7a5e,
  relay: 0x7a6e46,
  causeway: 0x5e7a72,
  static: 0x4a4468,
};

const grassGeo = new THREE.ConeGeometry(0.12, 0.8, 5);
const pebbleGeo = new THREE.IcosahedronGeometry(0.12, 0);

/** Wheat stands tall; ash-field grass barely clears the dirt. */
const GRASS_H: Record<RegionId, number> = {
  tolls: 1.7,
  ashpine: 0.8,
  marsh: 1.3,
  relay: 1.0,
  causeway: 1.1,
  static: 0.9,
};

/** Wheat stands in a sea; the Static Line barely grows, and kicks up rubble instead. */
const GRASS_N: Record<RegionId, number> = {
  tolls: 1400,
  ashpine: 650,
  marsh: 1100,
  relay: 750,
  causeway: 900,
  static: 350,
};

const PEB_N: Record<RegionId, number> = {
  tolls: 180,
  ashpine: 200,
  marsh: 120,
  relay: 150,
  causeway: 130,
  static: 220,
};

/**
 * Two instanced meshes — tufts and pebbles — scattered everywhere the walk goes
 * except the road, the sites and open water. One draw call each for the region.
 */
export function buildGroundCover(group: THREE.Group, ctx: DetailCtx, disposables: { dispose(): void }[]): void {
  const { region, salt } = ctx;
  const half = REGION_SIZE / 2 - REGION_MARGIN;
  const wet = WATER_REGIONS.has(region);
  const sites = ctx.layout.encounters;
  const clearOf = (x: number, z: number, roadPad: number, sitePad: number): boolean => {
    if (Math.abs(x - roadXAt(region, z)) < roadHalfAt(z, region) + roadPad) return false;
    for (const s of sites) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (dx * dx + dz * dz < sitePad * sitePad) return false;
    }
    return true;
  };
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const base = new THREE.Color(GRASS[region]);

  const N = GRASS_N[region];
  const grassMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, N);
  const gh = GRASS_H[region];
  let gi = 0;
  for (let i = 0; i < N * 3 && gi < N; i++) {
    const x = (hash2(i, 1, salt) * 2 - 1) * half;
    const z = (hash2(i, 2, salt + 3) * 2 - 1) * half;
    if (!clearOf(x, z, 1.2, 9)) continue;
    const y = ctx.groundY(x, z);
    if (wet && y < -0.35) continue; // no grass on the lakebed
    const s = (0.7 + hash2(i, 4, salt) * 0.8) * gh;
    dummy.position.set(x, y + 0.32 * s, z);
    dummy.rotation.set(0, hash2(i, 3, salt) * Math.PI * 2, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    grass.setMatrixAt(gi, dummy.matrix);
    col.copy(base).offsetHSL(0, 0, (hash2(i, 5, salt) - 0.5) * 0.12);
    grass.setColorAt(gi, col);
    gi++;
  }
  grass.count = gi;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  grass.name = 'grass';
  group.add(grass);
  disposables.push(grassMat);

  const P = PEB_N[region];
  const pebMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const peb = new THREE.InstancedMesh(pebbleGeo, pebMat, P);
  let pi = 0;
  for (let i = 0; i < P * 4 && pi < P; i++) {
    const x = (hash2(i, 11, salt + 31) * 2 - 1) * half;
    const z = (hash2(i, 12, salt + 37) * 2 - 1) * half;
    if (!clearOf(x, z, 0.6, 7)) continue;
    const y = ctx.groundY(x, z);
    if (wet && y < -0.4) continue;
    dummy.position.set(x, y + 0.05, z);
    dummy.rotation.set(hash2(i, 13, salt) * 3, hash2(i, 14, salt) * 6, 0);
    dummy.scale.set(0.6 + hash2(i, 15, salt), 0.4 + hash2(i, 16, salt) * 0.5, 0.6 + hash2(i, 17, salt));
    dummy.updateMatrix();
    peb.setMatrixAt(pi, dummy.matrix);
    col.setHex(0x8a8578).offsetHSL(0, 0, (hash2(i, 18, salt) - 0.5) * 0.16);
    peb.setColorAt(pi, col);
    pi++;
  }
  peb.count = pi;
  peb.instanceMatrix.needsUpdate = true;
  if (peb.instanceColor) peb.instanceColor.needsUpdate = true;
  peb.name = 'pebbles';
  group.add(peb);
  disposables.push(pebMat);
}

// ---------------------------------------------------------------------------
// Road dressing: posts and lanterns
// ---------------------------------------------------------------------------

/**
 * The roadside, in the region's own dialect. The rhythm never changes — one marker every
 * sixteen units, alternating shoulders, skipping the sites — but the marker does: Tolls keeps
 * the wooden posts and lanterns, and everywhere else the road is kept the way that place
 * would keep a road.
 */
export function pourRoadDressing(B: ChunkBatcher, ctx: DetailCtx): void {
  const { region, salt } = ctx;
  const sites = ctx.layout.encounters;
  let n = 0;
  for (let z = -190; z <= 190; z += 16) {
    const side = n % 2 === 0 ? 1 : -1;
    const cx = roadXAt(region, z);
    const x = cx + side * (roadHalfAt(z, region) + 1.4);
    if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 10)) { n++; continue; }
    const y = ctx.groundY(x, z);
    const lean = (hash2(n, 1, salt) - 0.5) * 0.1;
    if (region === 'ashpine') {
      // Charred posts, taller and leaner; every fourth still holds an ember.
      B.box('bark', x, y + 1.0, z, 0.16, 2.0, 0.16, 0xffffff, 0, { rot: lean * 2, seed: n });
      if (n % 4 === 0) B.geo('lit', sphGeo, M(x, y + 2.1, z, { sx: 0.22, sy: 0.22, sz: 0.22 }), 0xff6a2a, 1, n + 500);
    } else if (region === 'marsh') {
      // Reed poles over still water; every third carries a buoy lamp.
      B.geo('leaf', thinGeo, M(x, y + 0.9, z, { sx: 1.6, sy: 1.8, sz: 1.6, rz: 0.12 + lean }), 0xffffff, 0, n);
      if (n % 3 === 0) B.geo('lit', sphGeo, M(x, y + 2.0, z, { sx: 0.3, sy: 0.3, sz: 0.3 }), 0xb8ff9a, 1, n + 500);
    } else if (region === 'relay') {
      // Steel bollards; every second one blinks red.
      B.box('metal', x, y + 0.4, z, 0.3, 0.8, 0.3, 0xffffff, 0, { seed: n });
      if (n % 2 === 0) B.geo('lit', sphGeo, M(x, y + 0.95, z, { sx: 0.2, sy: 0.2, sz: 0.2 }), 0xff2a2a, 1, n + 500);
    } else if (region === 'causeway') {
      // Drowned signposts: a pale plate on a leaning steel pole, lanterns where they survived.
      B.geo('metal', thinGeo, M(x, y + 1.0, z, { sx: 1.6, sy: 2.0, sz: 1.6, rz: 0.18 }), 0xffffff, 0, n);
      B.box('pale', x + 0.3, y + 1.9, z, 1.1, 0.5, 0.1, 0xffffff, 0, { rot: 0.18, seed: n + 500 });
      if (n % 3 === 0) B.box('lit', x, y + 2.35, z, 0.3, 0.2, 0.3, 0xffc06a, 1, { seed: n + 900 });
    } else if (region === 'static') {
      // Fallen shards, one standing; every third leaks cyan.
      B.geo('rock', octaGeo, M(x, y + 0.4, z, { ry: lean * 6, rz: 0.5, sx: 0.5, sy: 0.8, sz: 0.5 }), 0xffffff, 0, n);
      if (n % 3 === 0) B.geo('lit', octaGeo, M(x, y + 0.9, z, { ry: lean * 6, sx: 0.18, sy: 0.4, sz: 0.18 }), 0x37e0ff, 1, n + 500);
    } else {
      // Tolls: wooden posts, every third carrying a lit lantern.
      B.box('bark', x, y + 0.75, z, 0.18, 1.5, 0.18, 0xffffff, 0, { rot: lean, seed: n });
      if (n % 3 === 0) {
        B.box('lit', x, y + 1.65, z, 0.3, 0.34, 0.3, 0xffc06a, 1, { seed: n + 500 });
        B.box('metal', x, y + 1.9, z, 0.42, 0.08, 0.42, 0xffffff, 0, { seed: n + 900 });
      }
    }
    n++;
  }
}

// ---------------------------------------------------------------------------
// Encounter sites: rings, stones, barricades, braziers, the warden's arch
// ---------------------------------------------------------------------------

/**
 * A soft round dot. Points and glow quads are squares by default, and a square
 * ember or a square halo reads as a bug on sight. One shared texture fixes all
 * of them. Never disposed.
 */
export function softDotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
export const softDot = softDotTexture();

/** Shared additive glow quad material for braziers and beacons. Never disposed. */
const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, alphaMap: softDot });
const glowGeo = new THREE.PlaneGeometry(2.6, 2.6);

const KIND_RING = { drift: 0xd8a03c, post: 0xc4502a, warden: 0x9a5ae0 } as const;

/**
 * A site's dressing, in the region's own dialect. The ring stays kind-wide — gold is a drift
 * everywhere, because the ring is the language a player learns once — but everything inside
 * it is the place's: stakes in the burn, reeds in the marsh, spars on the flats, concrete on
 * the highway, shards in the static. Same for the post's walls and the warden's gate: timber
 * where there are trees, steel where there are masts, marble where there are drowned halls.
 */
const POST_WALL: Record<RegionId, 'bark' | 'pale' | 'metal' | 'rock'> = {
  tolls: 'bark',
  ashpine: 'bark',
  marsh: 'pale',
  relay: 'metal',
  causeway: 'rock',
  static: 'rock',
};

const ARCH_MAT: Record<RegionId, 'rock' | 'bark' | 'pale' | 'metal'> = {
  tolls: 'rock',
  ashpine: 'bark',
  marsh: 'pale',
  relay: 'metal',
  causeway: 'rock',
  static: 'rock',
};

const BANNER: Record<RegionId, number> = {
  tolls: 0xd8a03c,
  ashpine: 0xc4502a,
  marsh: 0x4e7a5e,
  relay: 0x9ab8ff,
  causeway: 0x5e7a72,
  static: 0x9a5ae0,
};

type Jitter = (n: number) => number;

/** Three ground marks around a drift's centre, whatever that region marks ground with. */
function pourDriftMark(
  B: ChunkBatcher,
  ctx: DetailCtx,
  s: { x: number; z: number },
  i: number,
  j: Jitter,
): void {
  const { region } = ctx;
  const ring = (k: number): [number, number] => {
    const a = (k / 3) * Math.PI * 2 + j(1) * 3;
    return [s.x + Math.cos(a) * 2.6, s.z + Math.sin(a) * 2.6];
  };
  if (region === 'ashpine') {
    for (let k = 0; k < 3; k++) {
      const [sx, sz] = ring(k);
      const sh = 1.6 + j(2 + k) * 0.9;
      B.geo('bark', thinGeo, M(sx, ctx.groundY(sx, sz) + sh / 2, sz, { sx: 2.4, sy: sh, sz: 2.4, rz: 0.2 + (j(5 + k) - 0.5) * 0.5 }), 0xffffff, 0, i * 100 + k);
    }
    return;
  }
  if (region === 'marsh') {
    for (let k = 0; k < 3; k++) {
      const [sx, sz] = ring(k);
      for (let r = 0; r < 3; r++) {
        const ox = sx + (j(10 + k * 3 + r) - 0.5) * 0.9;
        const oz = sz + (j(20 + k * 3 + r) - 0.5) * 0.9;
        const sh = 1.8 + j(30 + k * 3 + r) * 1.0;
        B.geo('leaf', thinGeo, M(ox, ctx.groundY(ox, oz) + sh / 2, oz, { sx: 1.6, sy: sh, sz: 1.6, rz: (j(40 + k * 3 + r) - 0.5) * 0.2 }), 0xffffff, 0, i * 100 + k * 3 + r);
      }
    }
    return;
  }
  if (region === 'relay') {
    for (let k = 0; k < 3; k++) {
      const [sx, sz] = ring(k);
      B.geo('metal', thinGeo, M(sx, ctx.groundY(sx, sz) + 0.5, sz, { ry: j(5 + k) * 3, rz: 1.1, sx: 2.0, sy: 2.2, sz: 2.0 }), 0xffffff, 0, i * 100 + k);
    }
    return;
  }
  if (region === 'causeway') {
    for (let k = 0; k < 3; k++) {
      const [sx, sz] = ring(k);
      B.box('pale', sx, ctx.groundY(sx, sz) + 0.3, sz, 1.0, 0.6 + j(2 + k) * 0.3, 0.7, 0xffffff, 0, { rot: j(5 + k) * 3, seed: i * 100 + k });
    }
    return;
  }
  if (region === 'static') {
    for (let k = 0; k < 3; k++) {
      const [sx, sz] = ring(k);
      const cs = 0.5 + j(2 + k) * 0.4;
      B.geo('rock', octaGeo, M(sx, ctx.groundY(sx, sz) + cs * 0.5, sz, { ry: j(5 + k) * 3, rz: 0.4, sx: cs, sy: cs * 1.8, sz: cs }), 0xffffff, 0, i * 100 + k);
    }
    return;
  }
  for (let k = 0; k < 3; k++) {
    const [sx, sz] = ring(k);
    B.box('rock', sx, ctx.groundY(sx, sz) + 0.5, sz, 0.55, 1.1 + j(2 + k) * 0.5, 0.35, 0xffffff, 0, { rot: Math.atan2(sx - s.x, sz - s.z) + j(5 + k), seed: i * 100 + k });
  }
}

/** A ring draped on the terrain: a quad strip following the ground, never clipping. */
function pourRing(B: ChunkBatcher, ctx: DetailCtx, cx: number, cz: number, r: number, color: number, seed: number): void {
  const SEG = 40;
  const W = 0.55;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2;
    const a1 = ((i + 1) / SEG) * Math.PI * 2;
    const p = (a: number, rr: number): [number, number, number] => {
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      return [x, ctx.groundY(x, z) + 0.07, z];
    };
    // Counter-clockwise seen from above (+y): p0 inner-a0, p1 inner-a1, p2 outer-a1, p3 outer-a0.
    B.quad('cloth', p(a0, r - W / 2), p(a1, r - W / 2), p(a1, r + W / 2), p(a0, r + W / 2), [0, 0, 1, 1], color, 0, seed + i);
  }
}

function pourBrazier(B: ChunkBatcher, group: THREE.Group, ctx: DetailCtx, x: number, z: number, big: boolean, seed: number): void {
  const y = ctx.groundY(x, z);
  const s = big ? 1.35 : 1;
  B.geo('metal', tipGeo, M(x, y + 0.55 * s, z, { sx: 4 * s, sy: 1.1 * s, sz: 4 * s }), 0xffffff, 0, seed);
  B.geo('metal', sphGeo, M(x, y + 1.05 * s, z, { sx: 0.7 * s, sy: 0.35 * s, sz: 0.7 * s }), 0xffffff, 0, seed + 1);
  B.geo('lit', coneGeo, M(x, y + (1.05 + 0.45) * s, z, { sx: 0.55 * s, sy: 0.9 * s, sz: 0.55 * s }), 0xff7a2a, 1, seed + 2);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(x, y + 0.1, z);
  glow.scale.setScalar(s);
  group.add(glow);
}

/** The road's tangent at a point, so gates and barricades face the walk. */
function roadDir(region: RegionId, z: number): { x: number; z: number } {
  const dz = 0.6;
  const tx = (roadXAt(region, z + dz) - roadXAt(region, z - dz)) / (2 * dz);
  const len = Math.hypot(tx, 1);
  return { x: tx / len, z: 1 / len };
}

export function pourSites(B: ChunkBatcher, group: THREE.Group, ctx: DetailCtx): void {
  const { region, salt } = ctx;
  ctx.layout.encounters.forEach((s, i) => {
    const y = ctx.groundY(s.x, s.z);
    const j = (n: number): number => hash2(i, n, salt + 101);
    if (s.kind === 'drift') {
      pourRing(B, ctx, s.x, s.z, 4, KIND_RING.drift, i * 100);
      pourDriftMark(B, ctx, s, i, j);
      return;
    }
    if (s.kind === 'post') {
      pourRing(B, ctx, s.x, s.z, 5.5, KIND_RING.post, i * 100);
      const d = roadDir(region, s.z);
      for (const q of [-1, 1]) {
        pourBrazier(B, group, ctx, s.x - d.z * q * 4.2, s.z + d.x * q * 4.2, false, i * 100 + q + 10);
      }
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + j(1) * 3 + 0.4;
        const px = s.x + Math.cos(a) * 4.4;
        const pz = s.z + Math.sin(a) * 4.4;
        B.box(POST_WALL[region], px, ctx.groundY(px, pz) + 0.45, pz, 0.16, 1.1, 1.5, 0xffffff, 0, { rot: a + Math.PI / 2 + (j(2 + k) - 0.5) * 0.5, seed: i * 100 + 20 + k });
      }
      return;
    }
    // Warden: a gate arch over the walk, two banners, two great braziers.
    pourRing(B, ctx, s.x, s.z, 7, KIND_RING.warden, i * 100);
    const d = roadDir(region, s.z);
    // Pillars across the road: perpendicular of the tangent.
    const px = -d.z;
    const pz = d.x;
    for (const q of [-1, 1]) {
      const gx = s.x + px * q * 4.6;
      const gz = s.z + pz * q * 4.6;
      const gy = ctx.groundY(gx, gz);
      B.box(ARCH_MAT[region], gx, gy + 3, gz, 0.95, 6, 0.95, 0xffffff, 0, { rot: Math.atan2(d.x, d.z), seed: i * 100 + q + 30 });
      pourBrazier(B, group, ctx, s.x + px * q * 6.4, s.z + pz * q * 6.4, true, i * 100 + q + 40);
    }
    const ly = Math.max(ctx.groundY(s.x + px * 4.6, s.z + pz * 4.6), ctx.groundY(s.x - px * 4.6, s.z - pz * 4.6)) + 6.2;
    B.box(ARCH_MAT[region], s.x, ly, s.z, 10.6, 1.0, 1.1, 0xffffff, 0, { rot: Math.atan2(px, pz), seed: i * 100 + 50 });
    for (const q of [-1, 1]) {
      const bx = s.x + px * q * 2.4;
      const bz = s.z + pz * q * 2.4;
      const top = ly - 0.5;
      // A hanging banner: two triangles as one quad, swaying in the wind.
      const w = 0.65;
      B.quad('cloth',
        [bx - w, top, bz], [bx + w, top, bz], [bx + w, top - 2.6, bz], [bx - w, top - 2.6, bz],
        [0, 0, 1, 1], BANNER[region], 0, i * 100 + 60 + q);
    }
    if (region === 'static') {
      // Two veined shards inside the gate, where anywhere else would put flowers.
      for (const q of [-1, 1]) {
        const cx = s.x + px * q * 3.4;
        const cz = s.z + pz * q * 3.4;
        const cy = ctx.groundY(cx, cz);
        B.geo('rock', octaGeo, M(cx, cy + 0.7, cz, { ry: q, rz: 0.3, sx: 0.7, sy: 1.4, sz: 0.7 }), 0xffffff, 0, i * 100 + 70 + q);
        B.geo('lit', octaGeo, M(cx, cy + 1.5, cz, { sx: 0.2, sy: 0.45, sz: 0.2 }), 0x37e0ff, 1, i * 100 + 73 + q);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Landmarks: one hero structure per region, beside the warden's site
// ---------------------------------------------------------------------------

/**
 * The thing you navigate by. Each region gets one, built from the fiction's own
 * nouns — the weighbridge, the signal tree, the reading room, the quiet mast,
 * the drowned interchange, the last mile marker — placed off the walk so the
 * fight never clips through it. Vista pieces: seen, never collided.
 */
export function pourLandmark(B: ChunkBatcher, group: THREE.Group, ctx: DetailCtx): void {
  const { region } = ctx;
  const sites = ctx.layout.encounters;
  const w = sites[sites.length - 1]!;
  const d = roadDir(region, w.z);
  // Off to the side of the site, clear of the ring and the arch.
  const side = hash2(7, 7, ctx.salt) < 0.5 ? 1 : -1;
  const lx = w.x - d.z * side * 17;
  const lz = w.z + d.x * side * 17;
  const ly = ctx.groundY(lx, lz);
  const yaw = Math.atan2(d.x, d.z);

  if (region === 'tolls') {
    // The weighbridge: a gantry over the road with a hanging sign and chains.
    const gz = w.z - 14;
    const gx = roadXAt(region, gz);
    const hw = roadHalfAt(gz, region) + 0.9;
    for (const q of [-1, 1]) {
      const qx = gx + q * hw;
      const qy = ctx.groundY(qx, gz);
      B.box('metal', qx, qy + 2.75, gz, 0.7, 5.5, 0.7, 0xffffff, 0, { seed: 11 + q });
      B.box('metal', qx, qy + 5.2, gz, 1.4, 0.3, 1.4, 0xffffff, 0, { seed: 13 + q });
    }
    const by = Math.max(ctx.groundY(gx - hw, gz), ctx.groundY(gx + hw, gz)) + 5.6;
    B.box('metal', gx, by, gz, hw * 2 + 1.4, 0.8, 0.8, 0xffffff, 0, { seed: 15 });
    B.box('cloth', gx, by - 1.5, gz, 2.4, 1.1, 0.14, 0xd8a03c, 0, { seed: 16 });
    for (const q of [-1, 1]) {
      B.geo('metal', thinGeo, M(gx + q * 0.8, by - 0.5, gz, { sx: 1.4, sy: 1.1, sz: 1.4 }), 0xffffff, 0, 17 + q);
    }
    B.geo('lit', sphGeo, M(gx, by + 0.7, gz, { sx: 0.24, sy: 0.24, sz: 0.24 }), 0xffc06a, 1, 19);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(gx, ctx.groundY(gx, gz) + 0.1, gz);
    glow.scale.setScalar(1.6);
    group.add(glow);
    return;
  }
  if (region === 'ashpine') {
    // The signal tree: a giant burnt pine with ember dots in its tiers.
    B.geo('bark', trunkGeo, M(lx, ly + 7, lz, { sx: 5, sy: 14, sz: 5 }), 0xffffff, 0, 21);
    for (let t = 0; t < 3; t++) {
      const tw = 7.5 - t * 1.9;
      B.geo('leaf', coneGeo, M(lx, ly + 8 + t * 2.6, lz, { ry: t * 1.1, sx: tw, sy: 3.2, sz: tw }), 0xffffff, 0, 22 + t);
    }
    B.geo('pale', coneGeo, M(lx, ly + 16.6, lz, { sx: 0.9, sy: 1.6, sz: 0.9 }), 0xffffff, 0, 25);
    for (let e = 0; e < 5; e++) {
      const a = hash2(e, 1, ctx.salt) * Math.PI * 2;
      const er = 1.5 + hash2(e, 2, ctx.salt) * 3;
      B.geo('lit', sphGeo, M(lx + Math.cos(a) * er, ly + 8.5 + hash2(e, 3, ctx.salt) * 6, lz + Math.sin(a) * er, { sx: 0.2, sy: 0.2, sz: 0.2 }), 0xff6a2a, 1, 26 + e);
    }
    return;
  }
  if (region === 'marsh') {
    // The reading room: a sunken rotunda, six columns and a broken dome slab.
    for (let c = 0; c < 6; c++) {
      const a = (c / 6) * Math.PI * 2;
      const cx = lx + Math.cos(a) * 5;
      const cz = lz + Math.sin(a) * 5;
      const cy = ctx.groundY(cx, cz);
      B.geo('pale', new THREE.CylinderGeometry(0.4, 0.46, 1, 8), M(cx, cy + 2, cz, { sy: 4 }), 0xffffff, 0, 31 + c);
      if (c % 2 === 0) {
        const b = a + Math.PI / 6;
        B.box('pale', lx + Math.cos(b) * 5, cy + 4.2, lz + Math.sin(b) * 5, 5.4, 0.5, 0.9, 0xffffff, 0, { rot: -b, seed: 37 + c });
      }
    }
    B.box('pale', lx + 1.2, ly + 4.9, lz - 0.8, 4.2, 0.5, 4.2, 0xffffff, 0, { rot: 0.5, seed: 43 });
    pourRing(B, ctx, lx, lz, 6.5, 0x3c5a5c, 44);
    return;
  }
  if (region === 'relay') {
    // The quiet mast: a sixteen-metre tower with a dish and a red eye.
    B.geo('metal', pylonGeo, M(lx, ly + 8, lz, { ry: yaw, sx: 4.4, sy: 16, sz: 4.4 }), 0xffffff, 0, 51);
    for (let a = 0; a < 3; a++) {
      B.box('metal', lx, ly + 9 + a * 2.4, lz, 4.6 - a, 0.22, 0.22, 0xffffff, 0, { rot: yaw + (a * Math.PI) / 3, seed: 52 + a });
    }
    B.geo('metal', dishGeo, M(lx + 2.4, ly + 11.5, lz, { ry: yaw + 0.7, rz: -0.5 }), 0xffffff, 0, 55);
    B.geo('lit', sphGeo, M(lx, ly + 16.4, lz, { sx: 0.5, sy: 0.5, sz: 0.5 }), 0xff2a2a, 1, 56);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(lx, ly + 0.1, lz);
    glow.scale.setScalar(2.2);
    group.add(glow);
    return;
  }
  if (region === 'causeway') {
    // The drowned interchange: an overpass beam on two piers, cables hanging.
    const gz = w.z - 16;
    const gx = roadXAt(region, gz);
    const hw = roadHalfAt(gz, region) + 2.2;
    for (const q of [-1, 1]) {
      const qx = gx + q * hw;
      B.box('rock', qx, ctx.groundY(qx, gz) + 2.25, gz, 1.2, 4.5, 3.0, 0xffffff, 0, { seed: 61 + q });
    }
    const by = Math.max(ctx.groundY(gx - hw, gz), ctx.groundY(gx + hw, gz)) + 5.1;
    B.box('rock', gx, by, gz, hw * 2 + 2.4, 1.2, 3.0, 0xffffff, 0, { seed: 63 });
    for (let c = -1; c <= 1; c++) {
      B.geo('metal', thinGeo, M(gx + c * 2.2, by - 1.5, gz + 1.2, { sx: 1.2, sy: 2.2, sz: 1.2 }), 0xffffff, 0, 64 + c);
      B.box('lit', gx + c * 2.2, by + 0.75, gz + 1.2, 0.34, 0.2, 0.34, 0xffc06a, 1, { seed: 67 + c });
    }
    return;
  }
  // Static: the last mile marker, a tilted monolith with cyan rune strips.
  B.box('rock', lx, ly + 4.5, lz, 2.4, 9, 1.4, 0xffffff, 0, { rot: 0.35 + yaw * 0.1, seed: 71 });
  for (let r = 0; r < 3; r++) {
    B.box('lit', lx + 0.4, ly + 2.2 + r * 2.1, lz + 0.78, 1.5, 0.22, 0.06, 0x37e0ff, 1, { rot: 0.35 + yaw * 0.1, seed: 72 + r });
  }
  for (let c = 0; c < 4; c++) {
    const a = (c / 4) * Math.PI * 2 + 0.7;
    B.geo('rock', octaGeo, M(lx + Math.cos(a) * 4.4, ly + 1.1 + (c % 2) * 0.9, lz + Math.sin(a) * 4.4, { ry: a, rz: 0.5, sx: 0.8, sy: 1.3, sz: 0.8 }), 0xffffff, 0, 75 + c);
  }
  pourRing(B, ctx, lx, lz, 6, 0x5a4a9a, 79);
}

// ---------------------------------------------------------------------------
// Horizon: the silhouette ring at the map's edge
// ---------------------------------------------------------------------------

/** Big dark cones past the walk bounds, so a clear region ends in hills, not fog. */
export function pourHorizon(B: ChunkBatcher, ctx: DetailCtx): void {
  const { salt } = ctx;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + hash2(i, 1, salt) * 0.12;
    const r = 248 + hash2(i, 2, salt) * 34;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const w = 20 + hash2(i, 3, salt) * 16;
    const h = 26 + hash2(i, 4, salt) * 22;
    B.geo('rock', coneGeo, M(x, h / 2 - 3, z, { ry: hash2(i, 5, salt) * 3, sx: w, sy: h, sz: w }), 0xffffff, 0, 100 + i);
  }
}

// ---------------------------------------------------------------------------
// Sky: gradient dome, sun or moon, stars
// ---------------------------------------------------------------------------

const SUN: Record<RegionId, { color: number; az: number; el: number; r: number }> = {
  tolls: { color: 0xff9a4a, az: 2.4, el: 0.22, r: 46 },
  ashpine: { color: 0xc4502a, az: 1.1, el: 0.5, r: 34 },
  marsh: { color: 0xe8f0e4, az: 4.2, el: 0.62, r: 30 },
  relay: { color: 0xc8d4f0, az: 5.3, el: 0.55, r: 28 },
  causeway: { color: 0xb8d0de, az: 0.4, el: 0.48, r: 32 },
  static: { color: 0x9a7ae0, az: 3.1, el: 0.6, r: 30 },
};

const STAR_OPACITY: Record<RegionId, number> = {
  tolls: 0.12,
  ashpine: 0.3,
  marsh: 0.25,
  relay: 0.5,
  causeway: 0.3,
  static: 0.9,
};

/**
 * A gradient dome (skyTop up, horizon at eye level, fog colour below so the
 * ground's edge melts into it), one sun or moon disc, and a star field.
 * All unlit and unfogged: the sky is the one thing the fog never touches.
 */
export function buildSky(group: THREE.Group, ctx: DetailCtx, disposables: { dispose(): void }[]): void {
  const m = moodOf(ctx.region);
  const top = new THREE.Color(m.skyTop);
  const hor = new THREE.Color(m.skyHorizon);
  const low = new THREE.Color(m.fog);

  const domeGeo = new THREE.SphereGeometry(700, 24, 12);
  const dp = domeGeo.getAttribute('position') as THREE.BufferAttribute;
  const dc = new Float32Array(dp.count * 3);
  const tc = new THREE.Color();
  for (let i = 0; i < dp.count; i++) {
    const t = dp.getY(i) / 700; // -1..1
    if (t >= 0) tc.copy(hor).lerp(top, Math.min(1, t * 2.2));
    else tc.copy(hor).lerp(low, Math.min(1, -t * 3));
    dc[i * 3] = tc.r;
    dc[i * 3 + 1] = tc.g;
    dc[i * 3 + 2] = tc.b;
  }
  domeGeo.setAttribute('color', new THREE.BufferAttribute(dc, 3));
  const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.BackSide, depthWrite: false });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.name = 'sky';
  group.add(dome);
  disposables.push(domeGeo, domeMat);

  const sun = SUN[ctx.region];
  const sunGeo = new THREE.CircleGeometry(sun.r, 40);
  const sunMat = new THREE.MeshBasicMaterial({ color: sun.color, fog: false, toneMapped: false, depthWrite: false });
  const disc = new THREE.Mesh(sunGeo, sunMat);
  disc.position.set(Math.cos(sun.az) * 620, Math.sin(sun.el) * 620, Math.sin(sun.az) * 620);
  disc.lookAt(0, 0, 0);
  disc.renderOrder = -1;
  disc.frustumCulled = false;
  group.add(disc);
  disposables.push(sunGeo, sunMat);

  const NS = 350;
  const sp = new Float32Array(NS * 3);
  for (let i = 0; i < NS; i++) {
    const a = hash2(i, 1, ctx.salt) * Math.PI * 2;
    const e = 0.08 + hash2(i, 2, ctx.salt) * 0.85;
    const r = 660;
    sp[i * 3] = Math.cos(a) * Math.cos(e) * r;
    sp[i * 3 + 1] = Math.sin(e) * r;
    sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, fog: false, transparent: true, opacity: STAR_OPACITY[ctx.region], depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -1;
  stars.frustumCulled = false;
  group.add(stars);
  disposables.push(starGeo, starMat);
}

// ---------------------------------------------------------------------------
// Motes: the air itself, drifting
// ---------------------------------------------------------------------------

interface MoteStyle {
  color: number;
  size: number;
  opacity: number;
  additive: boolean;
  vx: number;
  vy: number;
  vz: number;
}

const MOTES: Record<RegionId, MoteStyle> = {
  tolls: { color: 0xff9a4a, size: 0.35, opacity: 0.85, additive: true, vx: 0.9, vy: 0.35, vz: 0.3 },
  ashpine: { color: 0x9a938a, size: 0.3, opacity: 0.7, additive: false, vx: 0.4, vy: -0.5, vz: 0.2 },
  marsh: { color: 0xb8ff9a, size: 0.3, opacity: 0.8, additive: true, vx: 0.25, vy: 0.12, vz: 0.25 },
  relay: { color: 0x9ab8ff, size: 0.3, opacity: 0.85, additive: true, vx: 1.4, vy: 0.1, vz: 0.5 },
  causeway: { color: 0x9ac8e0, size: 0.28, opacity: 0.65, additive: false, vx: 0.5, vy: -0.9, vz: 0.3 },
  static: { color: 0x9a7ae0, size: 0.32, opacity: 0.8, additive: true, vx: 0.2, vy: 0.3, vz: 0.2 },
};

const MOTE_BOX = 70;

/** Embers, ash, fireflies, sparks, droplets, static — one Points cloud per region. */
export function buildMotes(group: THREE.Group, ctx: DetailCtx, disposables: { dispose(): void }[]): { update(t: number, focus: THREE.Vector3): void } {
  const st = MOTES[ctx.region];
  const N = 260;
  const base = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    base[i * 3] = hash2(i, 1, ctx.salt) * MOTE_BOX;
    base[i * 3 + 1] = 0.5 + hash2(i, 2, ctx.salt) * 13;
    base[i * 3 + 2] = hash2(i, 3, ctx.salt) * MOTE_BOX;
    phase[i] = hash2(i, 4, ctx.salt) * Math.PI * 2;
  }
  const g = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  g.setAttribute('position', posAttr);
  const mat = new THREE.PointsMaterial({
    color: st.color,
    size: st.size,
    map: softDot,
    transparent: true,
    opacity: st.opacity,
    depthWrite: false,
    blending: st.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.name = 'motes';
  group.add(pts);
  disposables.push(g, mat);
  const wrap = (v: number): number => ((v % MOTE_BOX) + MOTE_BOX) % MOTE_BOX - MOTE_BOX / 2;
  return {
    update(t: number, focus: THREE.Vector3): void {
      const arr = posAttr.array as Float32Array;
      for (let i = 0; i < N; i++) {
        arr[i * 3] = focus.x + wrap(base[i * 3]! + t * st.vx + Math.sin(t * 0.7 + phase[i]!) * 1.2);
        arr[i * 3 + 1] = 0.5 + ((base[i * 3 + 1]! + t * st.vy + Math.sin(t * 0.9 + phase[i]!) * 0.8) % 13 + 13) % 13;
        arr[i * 3 + 2] = focus.z + wrap(base[i * 3 + 2]! + t * st.vz + Math.cos(t * 0.6 + phase[i]!) * 1.2);
      }
      posAttr.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------
// One call for everything the batcher pours
// ---------------------------------------------------------------------------

export function pourStaticDetails(B: ChunkBatcher, group: THREE.Group, ctx: DetailCtx): void {
  pourProps(B, ctx);
  pourRoadDressing(B, ctx);
  pourSites(B, group, ctx);
  pourLandmark(B, group, ctx);
  pourHorizon(B, ctx);
}
