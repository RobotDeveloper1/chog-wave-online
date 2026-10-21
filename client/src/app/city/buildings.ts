import * as THREE from 'three';
import { mulberry32, type Lot } from '@chog/shared';
import type { DistrictArt } from '../art.ts';
import type { ChunkBatcher } from './batch.ts';
import { CELL, GND_COLS, GND_ROWS, WALL_COLS, WALL_ROWS } from './textures.ts';

/**
 * Buildings, from a lot.
 *
 * A facade is a grid of quads, one per bay per floor, each sampling its own cell of the
 * district's wall atlas — so a ten-storey block is forty different windows, not one window
 * stretched. Everything else (cornices, awnings, chimneys, tanks, aerials) is added in
 * solid vertex colour on top, which is cheap and is what gives a silhouette its character.
 *
 * The three districts share one set of rules and differ in vocabulary: Ashflat gets
 * gables, chimneys, awnings and tanks; Voltgrid gets setback crowns, neon edge trim,
 * masts and dishes; Hollow gets arcades, green roofs, scaffolding and ivy.
 */

const BAY = 3.2;
const FLOOR = 3.3;

export interface BuildEnv {
  B: ChunkBatcher;
  art: DistrictArt;
  sector: 'ashflat' | 'voltgrid' | 'hollow';
  /** Sign cell lookup, so a door's label can be drawn on its building. */
  sign: (label: string) => [number, number, number, number] | null;
}

type V3 = [number, number, number];
const SIDES = ['N', 'E', 'S', 'W'] as const;
type Side = (typeof SIDES)[number];

const cellUV = (col: number, row: number, cols: number, rows: number): [number, number, number, number] => {
  const eu = 0.75 / (cols * CELL);
  const ev = 0.75 / (rows * CELL);
  return [col / cols + eu, 1 - (row + 1) / rows + ev, (col + 1) / cols - eu, 1 - row / rows - ev];
};

interface Face {
  ox: number;
  oz: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  len: number;
}

function faceOf(lot: Lot, side: Side): Face {
  const x0 = lot.x - lot.w / 2;
  const x1 = lot.x + lot.w / 2;
  const z0 = lot.z - lot.d / 2;
  const z1 = lot.z + lot.d / 2;
  switch (side) {
    case 'S':
      return { ox: x0, oz: z1, ux: 1, uz: 0, nx: 0, nz: 1, len: lot.w };
    case 'N':
      return { ox: x1, oz: z0, ux: -1, uz: 0, nx: 0, nz: -1, len: lot.w };
    case 'E':
      return { ox: x1, oz: z1, ux: 0, uz: -1, nx: 1, nz: 0, len: lot.d };
    case 'W':
      return { ox: x0, oz: z0, ux: 0, uz: 1, nx: -1, nz: 0, len: lot.d };
  }
}

const FRONT: Record<0 | 1 | 2 | 3, Side> = { 0: 'N', 1: 'E', 2: 'S', 3: 'W' };

/** A point along a face, `t` units from its origin and `y` up, pushed `out` from the wall. */
const at = (f: Face, t: number, y: number, out = 0): V3 => [f.ox + f.ux * t + f.nx * out, y, f.oz + f.uz * t + f.nz * out];

/** Where on the ground the door of a front face is, for the sign and the awning. */
function doorBayOf(nb: number, lot: Lot): number {
  if (nb <= 1) return 0;
  return lot.seed % 2 === 0 ? Math.floor(nb / 2) : Math.max(0, Math.ceil(nb / 2) - 1);
}

function wallFace(env: BuildEnv, lot: Lot, side: Side, rand: () => number): void {
  const { B } = env;
  const f = faceOf(lot, side);
  const front = FRONT[lot.face] === side;
  const nb = Math.max(1, Math.round(f.len / BAY));
  const bw = f.len / nb;
  const variant = lot.seed % 3;
  const shopFront = front && !!lot.shop;
  const gh = Math.min(shopFront ? 3.9 : 3.4, lot.h);
  const upper = Math.max(0, Math.round((lot.h - gh) / FLOOR));
  const fh = upper > 0 ? (lot.h - gh) / upper : 0;
  const door = doorBayOf(nb, lot);

  for (let i = 0; i < nb; i++) {
    let col: number;
    let row: number;
    if (front && i === door) {
      col = 0;
      row = shopFront ? 0 : 1;
    } else if (shopFront) {
      col = 1 + Math.floor(rand() * 3);
      row = 0;
    } else {
      col = 1 + Math.floor(rand() * 3);
      row = 1;
    }
    const uv = cellUV(col, row, GND_COLS, GND_ROWS);
    B.quad(`gnd${variant}`, at(f, i * bw, 0), at(f, (i + 1) * bw, 0), at(f, (i + 1) * bw, gh), at(f, i * bw, gh), uv, 0xffffff, 0, rand());
  }
  for (let j = 0; j < upper; j++) {
    const y0 = gh + j * fh;
    const y1 = y0 + fh;
    for (let i = 0; i < nb; i++) {
      const c = Math.floor(rand() * WALL_COLS);
      const r = Math.floor(rand() * WALL_ROWS);
      B.quad(`wall${variant}`, at(f, i * bw, y0), at(f, (i + 1) * bw, y0), at(f, (i + 1) * bw, y1), at(f, i * bw, y1), cellUV(c, r, WALL_COLS, WALL_ROWS), 0xffffff, 0, rand());
    }
  }
}

/** A horizontal band round the building: cornice, plinth, string course. */
function band(env: BuildEnv, lot: Lot, y: number, h: number, out: number, color: string): void {
  env.B.box('solid', lot.x, y + h / 2, lot.z, lot.w + out * 2, h, lot.d + out * 2, color);
}

/** A striped awning over a shop bay, sloping out from the wall. */
function awning(env: BuildEnv, lot: Lot, side: Side, bay: number, nb: number, rand: () => number): void {
  const { B, art } = env;
  const f = faceOf(lot, side);
  const bw = f.len / nb;
  const a0 = bay * bw + 0.15;
  const a1 = (bay + 1) * bw - 0.15;
  const stripes = 6;
  // One colour pair per *lot*, keyed off its seed, so a shop's awning, and every bay of it,
  // matches: a street of awnings where each shop keeps its own stripe is a street of shops.
  const pi = lot.seed % 3;
  const c1 = pi === 0 ? art.accent : pi === 1 ? art.cloth : art.neon || art.accent;
  // c2 must always be a *different* hue from c1: cloth-on-trim is cream-on-cream, which at a
  // distance collapses the stripe into a single white slab over the shop.
  const c2 = pi === 0 ? art.cloth : pi === 1 ? art.accent : art.cloth;
  const y0 = 3.5;
  const y1 = 2.85;
  const out = 1.5;
  for (let s = 0; s < stripes; s++) {
    const t0 = a0 + ((a1 - a0) * s) / stripes;
    const t1 = a0 + ((a1 - a0) * (s + 1)) / stripes;
    B.quad('solid', at(f, t0, y1, out), at(f, t1, y1, out), at(f, t1, y0, 0.02), at(f, t0, y0, 0.02), [0, 0, 1, 1], s % 2 ? c2 : c1);
  }
  const mid = (a0 + a1) / 2;
  const w = a1 - a0;
  const cx = f.ox + f.ux * mid + f.nx * out;
  const cz = f.oz + f.uz * mid + f.nz * out;
  const horizontalFace = side === 'N' || side === 'S';
  B.box('solid', cx, y1 - 0.14, cz, horizontalFace ? w : 0.1, 0.28, horizontalFace ? 0.1 : w, c1);
}

const lighten = (hex: string, t: number): string => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), t).getHexString();
const darken = (hex: string, t: number): string => '#' + new THREE.Color(hex).lerp(new THREE.Color('#000000'), t).getHexString();

function flatRoof(env: BuildEnv, lot: Lot, rand: () => number, mat: string): void {
  const { B, art } = env;
  const y = lot.h;
  const x0 = lot.x - lot.w / 2;
  const x1 = lot.x + lot.w / 2;
  const z0 = lot.z - lot.d / 2;
  const z1 = lot.z + lot.d / 2;
  const k = 1 / 6;
  B.quad(mat, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [x0 * k, z0 * k, x1 * k, z1 * k], 0xffffff);
  // A gravel border laid in from the parapet: ballast piled against the upstand is what a
  // built-up roof actually looks like from above, and it frames the field so the roof reads
  // as a surface with an edge rather than a texture poured into a tray.
  const gi = 0.42;
  const gw = 0.5;
  const gy = y + 0.035;
  const gc = darken(art.stone, 0.32);
  B.quad('solid', [x0 + gi, gy, z1 - gi], [x1 - gi, gy, z1 - gi], [x1 - gi, gy, z1 - gi - gw], [x0 + gi, gy, z1 - gi - gw], [0, 0, 1, 1], gc);
  B.quad('solid', [x0 + gi, gy, z0 + gi + gw], [x1 - gi, gy, z0 + gi + gw], [x1 - gi, gy, z0 + gi], [x0 + gi, gy, z0 + gi], [0, 0, 1, 1], gc);
  B.quad('solid', [x0 + gi, gy, z1 - gi], [x0 + gi + gw, gy, z1 - gi], [x0 + gi + gw, gy, z0 + gi], [x0 + gi, gy, z0 + gi], [0, 0, 1, 1], gc);
  B.quad('solid', [x1 - gi - gw, gy, z1 - gi], [x1 - gi, gy, z1 - gi], [x1 - gi, gy, z0 + gi], [x1 - gi - gw, gy, z0 + gi], [0, 0, 1, 1], gc);
  // Parapet: a low wall all round, the thing that stops a flat roof reading as an open tray.
  const pc = art.stone;
  B.box('solid', lot.x, y + 0.25, z1 - 0.1, lot.w, 0.5, 0.2, pc, 0, { skipBottom: true });
  B.box('solid', lot.x, y + 0.25, z0 + 0.1, lot.w, 0.5, 0.2, pc, 0, { skipBottom: true });
  B.box('solid', x0 + 0.1, y + 0.25, lot.z, 0.2, 0.5, lot.d - 0.4, pc, 0, { skipBottom: true });
  B.box('solid', x1 - 0.1, y + 0.25, lot.z, 0.2, 0.5, lot.d - 0.4, pc, 0, { skipBottom: true });
  // Coping: a lighter cap stone on the parapet's top edge. Without it the parapet is a flat
  // ring of one colour and reads as a painted line; the cap catches the light and reads as a wall.
  const cc = lighten(art.stone, 0.22);
  B.box('solid', lot.x, y + 0.54, z1 - 0.1, lot.w + 0.08, 0.1, 0.3, cc, 0, { skipBottom: true });
  B.box('solid', lot.x, y + 0.54, z0 + 0.1, lot.w + 0.08, 0.1, 0.3, cc, 0, { skipBottom: true });
  B.box('solid', x0 + 0.1, y + 0.54, lot.z, 0.3, 0.1, lot.d - 0.2, cc, 0, { skipBottom: true });
  B.box('solid', x1 - 0.1, y + 0.54, lot.z, 0.3, 0.1, lot.d - 0.2, cc, 0, { skipBottom: true });
  rooftopKit(env, lot, rand, y + 0.05);
}

/** A condenser: body on four legs, a fan disc and grille on top, a side louver. */
function acUnit(env: BuildEnv, x: number, y: number, z: number, rand: () => number): void {
  const { B, art } = env;
  const w = 1.1 + rand() * 0.7;
  const d = 0.9 + rand() * 0.5;
  const h = 0.7 + rand() * 0.4;
  const leg = 0.22;
  for (const [dx, dz] of [[-w / 2 + 0.12, -d / 2 + 0.12], [w / 2 - 0.12, -d / 2 + 0.12], [-w / 2 + 0.12, d / 2 - 0.12], [w / 2 - 0.12, d / 2 - 0.12]] as const) {
    B.box('solid', x + dx, y + leg / 2, z + dz, 0.1, leg, 0.1, art.dark);
  }
  B.box('solid', x, y + leg + h / 2, z, w, h, d, art.metal);
  // Fan shroud, blades and hub on top: the round shape with a cross in it is what says
  // "condenser" from above. Neutral grey, not the district dark — a violet disc at this size
  // reads as a coloured dot, not a fan.
  B.geo('solid', new THREE.CylinderGeometry(Math.min(w, d) * 0.36, Math.min(w, d) * 0.36, 0.1, 10), new THREE.Matrix4().makeTranslation(x, y + leg + h + 0.05, z), '#3c3c40');
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2 + 0.4;
    B.box('solid', x + Math.cos(a) * 0.14, y + leg + h + 0.11, z + Math.sin(a) * 0.14, 0.3, 0.03, 0.07, lighten(art.metal, 0.3), 0, { rot: -a });
  }
  B.geo('solid', new THREE.CylinderGeometry(0.06, 0.06, 0.16, 6), new THREE.Matrix4().makeTranslation(x, y + leg + h + 0.12, z), lighten(art.metal, 0.4));
  // Louver lines on the long side.
  B.box('solid', x, y + leg + h * 0.55, z + d / 2 + 0.015, w * 0.8, h * 0.5, 0.03, lighten(art.metal, 0.15));
}

/** An L-shaped pipe run at roof level between two points: conduits tie the kit together. */
function pipeRun(env: BuildEnv, ax: number, az: number, bx: number, bz: number, y: number): void {
  const { B, art } = env;
  const c = lighten(art.metal, 0.06);
  B.box('solid', (ax + bx) / 2, y, az, Math.max(0.09, Math.abs(bx - ax)), 0.09, 0.09, c);
  B.box('solid', bx, y, (az + bz) / 2, 0.09, 0.09, Math.max(0.09, Math.abs(bz - az)), c);
}

/** A low glazed lantern: frame, glass, and a curb it stands on. */
function skylight(env: BuildEnv, x: number, y: number, z: number, w: number, d: number, rand: () => number): void {
  const { B, art } = env;
  B.box('solid', x, y + 0.12, z, w + 0.2, 0.24, d + 0.2, art.stone, 0, { skipBottom: true });
  B.box('glass', x, y + 0.5, z, w, 0.5, d, '#bfe0e8', 0.12);
  B.box('solid', x, y + 0.78, z, w + 0.1, 0.08, d + 0.1, art.metal);
  B.box('solid', x, y + 0.5, z, 0.08, 0.5, d, art.metal);
  void rand;
}

/**
 * Roof clutter, composed: a stair bulkhead in one corner, a row of condensers along the
 * opposite edge tied to it by pipe runs, a drain to the parapet, and — by district — a water
 * tank, chimney pots, an aerial or a roof garden. The old version scattered two to four pale
 * boxes at random, which from above read as litter dropped on a lid; a roof is a *machine
 * room*, and the pieces have to relate to each other to say so.
 */
function rooftopKit(env: BuildEnv, lot: Lot, rand: () => number, y: number): void {
  const { B, art, sector } = env;
  const x0 = lot.x - lot.w / 2;
  const x1 = lot.x + lot.w / 2;
  const z0 = lot.z - lot.d / 2;
  const z1 = lot.z + lot.d / 2;
  const inset = 1.1;
  const iw = lot.w - inset * 2;
  const id = lot.d - inset * 2;
  if (iw < 2 || id < 2) return;

  // Stair bulkhead in one corner: the tallest thing on the roof, with a door and a cap.
  const corner = Math.floor(rand() * 4);
  const bw = Math.min(2.4, iw * 0.45);
  const bd = Math.min(2.0, id * 0.45);
  const bx = corner === 0 || corner === 3 ? x0 + inset + bw / 2 : x1 - inset - bw / 2;
  const bz = corner < 2 ? z0 + inset + bd / 2 : z1 - inset - bd / 2;
  const bh = 2.1 + rand() * 0.7;
  // Dark brick, not the pale wall tone: a cream box on a gravel roof read as a fridge left out.
  B.box('solid', bx, y + bh / 2, bz, bw, bh, bd, art.wall[2]!, 0, { skipTop: true });
  B.box('solid', bx, y + bh + 0.07, bz, bw + 0.26, 0.14, bd + 0.26, art.stone);
  const doorX = bx < lot.x ? bx + bw / 2 + 0.03 : bx - bw / 2 - 0.03;
  B.box('solid', doorX, y + 1.0, bz, 0.06, 1.9, 0.85, art.dark);
  B.box('solid', bx, y + bh + 0.34, bz - bd * 0.2, 0.44, 0.44, 0.44, art.metal);

  // Condensers in a row along the edge opposite the bulkhead, piped back to it.
  const alongX = iw >= id;
  const nAc = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < nAc; i++) {
    const t = (i + 0.5) / nAc;
    const ax = alongX ? x0 + inset + iw * t : corner < 2 ? x1 - inset - 0.9 : x0 + inset + 0.9;
    const az = alongX ? (corner < 2 ? z1 - inset - 0.9 : z0 + inset + 0.9) : z0 + inset + id * t;
    acUnit(env, ax, y, az, rand);
    pipeRun(env, bx, bz, ax, az, y + 0.14);
  }
  // A rainwater drain from the field to the parapet, and its scupper hole.
  const dx = corner === 0 || corner === 3 ? x1 - inset - 0.4 : x0 + inset + 0.4;
  const dz = corner < 2 ? z1 - inset - 0.4 : z0 + inset + 0.4;
  pipeRun(env, lot.x, lot.z, dx, dz, y + 0.06);
  B.box('solid', dx, y + 0.1, dz, 0.34, 0.2, 0.34, art.dark);

  // A glazed lantern near the middle of the field.
  if (rand() > 0.45 && iw > 3.4 && id > 3.4) {
    skylight(env, lot.x + (rand() - 0.5) * iw * 0.3, y, lot.z + (rand() - 0.5) * id * 0.3, 1.5 + rand() * 0.8, 1.2 + rand() * 0.6, rand);
  }

  if (sector === 'ashflat') {
    if (rand() > 0.35 && lot.w > 5) waterTank(env, lot.x + (rand() - 0.5) * (lot.w - 3), y, lot.z + (rand() - 0.5) * (lot.d - 3), rand);
    // Chimney stack with two clay pots: the rowhouse signature on the skyline.
    const cx = lot.x - lot.w * 0.28;
    const cz = lot.z - lot.d * 0.2;
    const ch = 1.3 + rand() * 1.4;
    B.box('solid', cx, y + ch / 2, cz, 0.9, ch, 0.9, art.wall[Math.floor(rand() * art.wall.length)]!);
    B.box('solid', cx, y + ch + 0.1, cz, 1.1, 0.2, 1.1, art.stone);
    for (const po of [-0.22, 0.22]) {
      B.geo('solid', new THREE.CylinderGeometry(0.14, 0.16, 0.42, 8), new THREE.Matrix4().makeTranslation(cx + po, y + ch + 0.4, cz), '#a4643c');
    }
    // A television aerial: mast, crossarms, and a small reflector grid.
    if (rand() > 0.4) {
      const axx = lot.x + lot.w * 0.3;
      const azz = lot.z + lot.d * 0.28;
      B.geo('solid', new THREE.CylinderGeometry(0.04, 0.05, 2.2, 6), new THREE.Matrix4().makeTranslation(axx, y + 1.1, azz), art.metal);
      for (const hh of [1.7, 1.95, 2.2]) B.box('solid', axx, y + hh, azz, 0.9 - (hh - 1.7) * 0.2, 0.04, 0.04, art.metal);
    }
  } else if (sector === 'voltgrid') {
    const mx = lot.x - lot.w * 0.25;
    const mh = 3 + rand() * 4;
    B.box('solid', mx, y + mh / 2, lot.z, 0.2, mh, 0.2, art.metal);
    B.box('solid', mx, y + mh + 0.1, lot.z, 0.3, 0.3, 0.3, '#ff4a5e', 1.4);
    B.box('solid', lot.x + lot.w * 0.25, y + 0.5, lot.z + lot.d * 0.15, 1.6, 0.14, 1.6, art.neon, 0.9);
  } else {
    // Hollow: a roof garden of planters and a skylight, not machinery.
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const px = lot.x + (rand() - 0.5) * iw * 0.8;
      const pz = lot.z + (rand() - 0.5) * id * 0.8;
      B.box('solid', px, y + 0.28, pz, 1.3, 0.5, 1.0, art.trim);
      B.box('foliage', px, y + 0.62, pz, 1.1, 0.4, 0.8, art.leaf);
    }
    skylight(env, lot.x - lot.w * 0.25, y, lot.z + lot.d * 0.1, 1.8, 1.4, rand);
  }
}

function waterTank(env: BuildEnv, x: number, y: number, z: number, rand: () => number): void {
  const { B, art } = env;
  for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) {
    B.box('solid', x + dx, y + 0.8, z + dz, 0.14, 1.6, 0.14, art.metal);
  }
  const tank = new THREE.CylinderGeometry(0.95, 0.95, 1.6, 12);
  B.geo('solid', tank, new THREE.Matrix4().makeTranslation(x, y + 2.4, z), art.roof[Math.floor(rand() * art.roof.length)]!);
  B.geo('solid', new THREE.ConeGeometry(1.08, 0.8, 12), new THREE.Matrix4().makeTranslation(x, y + 3.6, z), art.stone);
  B.geo('solid', new THREE.CylinderGeometry(1, 1, 0.1, 12), new THREE.Matrix4().makeTranslation(x, y + 2.0, z), art.metal);
}

/** Two slopes and two gable ends, ridge along the long axis. */
function gableRoof(env: BuildEnv, lot: Lot, rise: number, mat: string): void {
  const { B, art } = env;
  const ov = 0.35;
  const alongX = lot.w >= lot.d;
  const y = lot.h;
  const hw = lot.w / 2 + (alongX ? ov : ov);
  const hd = lot.d / 2 + ov;
  const x0 = lot.x - hw;
  const x1 = lot.x + hw;
  const z0 = lot.z - hd;
  const z1 = lot.z + hd;
  const k = 1 / 5;
  if (alongX) {
    const rz = lot.z;
    B.quad(mat, [x0, y, z1], [x1, y, z1], [x1, y + rise, rz], [x0, y + rise, rz], [x0 * k, z1 * k, x1 * k, rz * k]);
    B.quad(mat, [x1, y, z0], [x0, y, z0], [x0, y + rise, rz], [x1, y + rise, rz], [x1 * k, z0 * k, x0 * k, rz * k]);
    for (const [x, s] of [[lot.x - lot.w / 2, -1], [lot.x + lot.w / 2, 1]] as const) {
      const a: V3 = [x, y, lot.z - lot.d / 2];
      const b: V3 = [x, y, lot.z + lot.d / 2];
      const c: V3 = [x, y + rise, lot.z];
      if (s > 0) B.tri('solid', b, a, c, [0, 0, 1, 0, 0.5, 1], art.wall[1]!);
      else B.tri('solid', a, b, c, [0, 0, 1, 0, 0.5, 1], art.wall[1]!);
    }
  } else {
    const rx = lot.x;
    B.quad(mat, [x1, y, z1], [x1, y, z0], [rx, y + rise, z0], [rx, y + rise, z1], [x1 * k, z1 * k, x1 * k, z0 * k]);
    B.quad(mat, [x0, y, z0], [x0, y, z1], [rx, y + rise, z1], [rx, y + rise, z0], [x0 * k, z0 * k, x0 * k, z1 * k]);
    for (const [z, s] of [[lot.z - lot.d / 2, -1], [lot.z + lot.d / 2, 1]] as const) {
      const a: V3 = [lot.x - lot.w / 2, y, z];
      const b: V3 = [lot.x + lot.w / 2, y, z];
      const c: V3 = [lot.x, y + rise, z];
      if (s > 0) B.tri('solid', a, b, c, [0, 0, 1, 0, 0.5, 1], art.wall[1]!);
      else B.tri('solid', b, a, c, [0, 0, 1, 0, 0.5, 1], art.wall[1]!);
    }
  }
  // Ridge cap.
  B.box('solid', lot.x, y + rise + 0.05, lot.z, alongX ? lot.w + ov * 2 : 0.3, 0.2, alongX ? 0.3 : lot.d + ov * 2, art.stone);
}

/** A hip roof. Textured when a roof mat is given — a solid-colour hip is a cardboard pyramid,
 *  and from this camera the four slopes are a large part of the building's picture. */
function hipRoof(env: BuildEnv, lot: Lot, rise: number, mat: string | null, color: string | number = 0xffffff): void {
  const { B } = env;
  const ov = 0.3;
  const x0 = lot.x - lot.w / 2 - ov;
  const x1 = lot.x + lot.w / 2 + ov;
  const z0 = lot.z - lot.d / 2 - ov;
  const z1 = lot.z + lot.d / 2 + ov;
  const y = lot.h;
  const top: V3 = [lot.x, y + rise, lot.z];
  const k = 1 / 5;
  const uv = (p: V3): number => p[0] * k;
  const wv = (p: V3): number => p[2] * k;
  const faces: [V3, V3, V3][] = [
    [[x0, y, z1], [x1, y, z1], top],
    [[x1, y, z0], [x0, y, z0], top],
    [[x1, y, z1], [x1, y, z0], top],
    [[x0, y, z0], [x0, y, z1], top],
  ];
  for (const [a, b, c] of faces) {
    if (mat) B.tri(mat, a, b, c, [uv(a), wv(a), uv(b), wv(b), uv(c), wv(c)], 0xffffff);
    else B.tri('solid', a, b, c, [0, 0, 1, 0, 0.5, 1], color);
  }
}

/** Warehouse sawtooth: slopes with a glazed vertical face that glows at night. */
function sawtoothRoof(env: BuildEnv, lot: Lot, rand: () => number): void {
  const { B, art } = env;
  const teeth = Math.max(2, Math.round(lot.w / 5));
  const tw = lot.w / teeth;
  const rise = 1.5;
  const y = lot.h;
  const z0 = lot.z - lot.d / 2;
  const z1 = lot.z + lot.d / 2;
  for (let i = 0; i < teeth; i++) {
    const xa = lot.x - lot.w / 2 + i * tw;
    const xb = xa + tw;
    const k = 1 / 6;
    B.quad('roofMetal', [xa, y, z1], [xb, y + rise, z1], [xb, y + rise, z0], [xa, y, z0], [xa * k, z0 * k, xb * k, z1 * k]);
    // The north-facing glazing, lit from inside.
    B.quad('solid', [xb, y + rise, z1], [xb, y, z1], [xb, y, z0], [xb, y + rise, z0], [0, 0, 1, 1], '#cfe0f0', 0.55 + rand() * 0.2);
    B.tri('solid', [xa, y, z1], [xb, y, z1], [xb, y + rise, z1], [0, 0, 1, 0, 1, 1], art.metal);
    B.tri('solid', [xb, y, z0], [xa, y, z0], [xb, y + rise, z0], [0, 0, 1, 0, 1, 1], art.metal);
  }
  B.box('solid', lot.x + lot.w * 0.3, y + 0.7, lot.z - lot.d * 0.2, 0.9, 1.4, 0.9, art.metal);
}

function steppedRoof(env: BuildEnv, lot: Lot, rand: () => number): void {
  const { B, art, sector } = env;
  let w = lot.w;
  let d = lot.d;
  let y = lot.h;
  const steps = lot.h > 28 ? 3 : 2;
  for (let s = 0; s < steps; s++) {
    w *= 0.74;
    d *= 0.74;
    const h = 3.2 + rand() * 2.4;
    const wall = s % 2 ? art.wall[2]! : art.wall[0]!;
    // No top face: the roof quad below is the top, and a second face there would z-fight it.
    B.box('solid', lot.x, y + h / 2, lot.z, w, h, d, wall, 0, { skipTop: true });
    // A lit strip at the top of each setback.
    if (sector === 'voltgrid') B.box('solid', lot.x, y + h - 0.12, lot.z, w + 0.2, 0.16, d + 0.2, art.neon, 1.1);
    const k = 1 / 6;
    B.quad('roofTar', [lot.x - w / 2, y + h, lot.z + d / 2], [lot.x + w / 2, y + h, lot.z + d / 2], [lot.x + w / 2, y + h, lot.z - d / 2], [lot.x - w / 2, y + h, lot.z - d / 2], [0, 0, w * k, d * k]);
    y += h;
  }
  const mh = 4 + rand() * 6;
  B.box('solid', lot.x, y + mh / 2, lot.z, 0.22, mh, 0.22, art.metal);
  B.box('solid', lot.x, y + mh + 0.15, lot.z, 0.36, 0.36, 0.36, '#ff4a5e', 1.6);
}

/** A vertical neon blade on a corner, and a horizontal edge line — Voltgrid's signature. */
function neonTrim(env: BuildEnv, lot: Lot, rand: () => number): void {
  const { B, art } = env;
  const hue = rand() > 0.72 ? '#ff4fd8' : art.neon;
  const h = lot.h;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    if (rand() > 0.55) continue;
    // Ends 10 cm below the roofline: a blade whose top was *at* `h` put a glowing square in the
    // same plane as the roof, and a neon face that z-fights its roof blinks under bloom.
    B.box('solid', lot.x + (sx * lot.w) / 2, h / 2 + 0.45, lot.z + (sz * lot.d) / 2, 0.22, h - 1.1, 0.22, hue, 1.5);
  }
  B.box('solid', lot.x, h - 0.15, lot.z, lot.w + 0.3, 0.2, lot.d + 0.3, hue, 1.2);
}

/** A sign over the door: the label, lit, hung clear of anything the wall projects.
 *  It used to sit 28 cm off the wall — inside a bay window's 62 cm projection — so the middle
 *  of the board was buried in the bay and only its ends showed, jutting out at an angle. A
 *  hung sign stands proud of everything on the facade, on two arms, like a real one. */
function signBoard(env: BuildEnv, lot: Lot, nb: number): void {
  if (!lot.sign) return;
  const uv = env.sign(lot.sign);
  if (!uv) return;
  const f = faceOf(lot, FRONT[lot.face]);
  const bw = f.len / nb;
  const door = doorBayOf(nb, lot);
  const cx = door * bw + bw / 2;
  const w = Math.min(f.len * 0.62, Math.max(3.2, bw * 2.2));
  const y0 = Math.min(lot.shop ? 4.15 : 3.7, lot.h - 1.5);
  const out = 0.82;
  env.B.quad('signs', at(f, cx - w / 2, y0, out), at(f, cx + w / 2, y0, out), at(f, cx + w / 2, y0 + 1.15, out), at(f, cx - w / 2, y0 + 1.15, out), uv, 0xffffff, 0, 0);
  // Two arms back to the wall, so the board is hung and not floating.
  for (const t of [cx - w / 2 + 0.3, cx + w / 2 - 0.3]) {
    const a0 = at(f, t, y0 + 1.0, 0.05);
    const a1 = at(f, t, y0 + 1.0, out);
    env.B.box('solid', (a0[0] + a1[0]) / 2, y0 + 1.0, (a0[2] + a1[2]) / 2, Math.abs(a1[0] - a0[0]) + 0.06, 0.06, Math.abs(a1[2] - a0[2]) + 0.06, env.art.metal);
  }
}

function chimneyAndDormers(env: BuildEnv, lot: Lot, rand: () => number, rise: number): void {
  const { B, art } = env;
  const alongX = lot.w >= lot.d;
  const y = lot.h;
  const ch = rise + 1.2;
  B.box('solid', lot.x + (alongX ? lot.w * 0.28 : 0), y + ch / 2, lot.z + (alongX ? 0 : lot.d * 0.28), 0.85, ch, 0.85, art.wall[Math.floor(rand() * 3)]!);
  B.box('solid', lot.x + (alongX ? lot.w * 0.28 : 0), y + ch + 0.1, lot.z + (alongX ? 0 : lot.d * 0.28), 1.05, 0.2, 1.05, art.stone);
  if (lot.w >= 6 && rand() > 0.4) {
    // A dormer on the street slope.
    const f = faceOf(lot, FRONT[lot.face]);
    const t = f.len * (0.3 + rand() * 0.4);
    const p = at(f, t, y + rise * 0.35, -lot.d * 0.12);
    B.box('solid', p[0], p[1] + 0.5, p[2], 1.3, 1.0, 1.0, art.wall[1]!);
    B.box('glass', p[0] + f.nx * 0.51, p[1] + 0.5, p[2] + f.nz * 0.51, f.nx ? 0.06 : 0.8, 0.6, f.nz ? 0.06 : 0.8, art.window, 0.9);
  }
}

/**
 * Massing: the moves that stop a lot being a box.
 *
 * A facade atlas gives a wall its surface; it cannot give a building its *shape*. These are
 * the cheap projections that read as architecture from the street and from above — a stone
 * plinth that plants the building, pilasters that give it corners, a bay window and a stoop
 * that say "house", a balcony that says "tenement", a jetty band and a front pediment that
 * break the roofline. Each is chosen by style and seed, so no two neighbours get the same set.
 */
function massing(env: BuildEnv, lot: Lot, rand: () => number, nb: number): void {
  const { B, art } = env;
  const f = faceOf(lot, FRONT[lot.face]);
  const bw = f.len / nb;
  const style = lot.style;
  const variant = lot.seed % 3;

  // A stone plinth, a hand wider than the wall: the building sits on something.
  band(env, lot, 0, 1.0, 0.12, darken(art.stone, 0.14));

  // Pilasters up the two front corners, so the box has edges instead of a wrap-around print.
  const pilW = Math.min(0.5, bw * 0.22);
  for (const t of [pilW / 2, f.len - pilW / 2]) {
    B.quad('solid', at(f, t - pilW / 2, 0, 0.13), at(f, t + pilW / 2, 0, 0.13), at(f, t + pilW / 2, lot.h, 0.13), at(f, t - pilW / 2, lot.h, 0.13), [0, 0, 1, 1], art.trim);
    B.quad('solid', at(f, t - pilW / 2, lot.h, 0.2), at(f, t + pilW / 2, lot.h, 0.2), at(f, t + pilW / 2, lot.h + 0.22, 0.2), at(f, t - pilW / 2, lot.h + 0.22, 0.2), [0, 0, 1, 1], art.stone);
  }

  // A bay window: three faces projecting half a metre over the middle floors.
  if ((style === 'rowhouse' || style === 'tenement') && nb >= 3 && rand() > 0.42) {
    const bay = 1 + Math.floor(rand() * (nb - 2));
    const t0 = bay * bw + 0.18;
    const t1 = (bay + 1) * bw - 0.18;
    const out = 0.62;
    const y0 = 3.2;
    const y1 = Math.min(lot.h - 0.5, y0 + FLOOR * (1 + Math.floor(rand() * 2)));
    const wc = cellUV(1 + Math.floor(rand() * 3), 1, WALL_COLS, WALL_ROWS);
    B.quad(`wall${variant}`, at(f, t0, y0, out), at(f, t1, y0, out), at(f, t1, y1, out), at(f, t0, y1, out), wc, 0xffffff, 0, rand());
    B.quad('solid', at(f, t0, y0, 0), at(f, t0, y0, out), at(f, t0, y1, out), at(f, t0, y1, 0), [0, 0, 1, 1], darken(art.wall[variant]!, 0.12));
    B.quad('solid', at(f, t1, y0, out), at(f, t1, y0, 0), at(f, t1, y1, 0), at(f, t1, y1, out), [0, 0, 1, 1], darken(art.wall[variant]!, 0.12));
    // A sloped cap, and a sill band under it.
    B.quad('solid', at(f, t0 - 0.08, y1, out + 0.1), at(f, t1 + 0.08, y1, out + 0.1), at(f, t1 + 0.08, y1 + 0.34, 0), at(f, t0 - 0.08, y1 + 0.34, 0), [0, 0, 1, 1], art.stone);
    B.quad('solid', at(f, t0 - 0.08, y0 - 0.16, out + 0.1), at(f, t1 + 0.08, y0 - 0.16, out + 0.1), at(f, t1 + 0.08, y0, out + 0.1), at(f, t0 - 0.08, y0, out + 0.1), [0, 0, 1, 1], art.stone);
  }

  // A stoop at a residential door: steps, cheeks, and a canopy on two posts.
  if (style === 'rowhouse' && !lot.shop) {
    const door = doorBayOf(nb, lot);
    const cx = door * bw + bw / 2;
    for (let s = 0; s < 3; s++) {
      const w = bw * 0.82 - s * 0.22;
      const p = at(f, cx, 0.13 + s * 0.15, 0.62 + (2 - s) * 0.3);
      B.box('solid', p[0], p[1], p[2], f.nx ? 1.0 : w, 0.26, f.nz ? 1.0 : w, art.stone);
    }
    for (const s of [-1, 1]) {
      const p = at(f, cx + s * bw * 0.42, 0.52, 0.55);
      B.box('solid', p[0], p[1], p[2], f.nx ? 1.2 : 0.2, 1.04, f.nz ? 1.2 : 0.2, art.stone);
    }
    const cp = at(f, cx, 2.95, 0.85);
    B.box('solid', cp[0], cp[1], cp[2], f.nx ? 1.7 : bw * 0.94, 0.14, f.nz ? 1.7 : bw * 0.94, art.trim);
    for (const s of [-1, 1]) {
      const pp = at(f, cx + s * bw * 0.4, 1.5, 0.95);
      B.box('solid', pp[0], pp[1], pp[2], 0.1, 2.9, 0.1, art.metal);
    }
  }

  // A balcony on a tenement front: slab, posts, top rail.
  if (style === 'tenement' && rand() > 0.4) {
    const y = Math.min(lot.h - 1.4, 3.4 + FLOOR * (1 + Math.floor(rand() * 2)));
    const w = f.len * 0.52;
    const cx = f.len / 2;
    const out = 0.72;
    const sp = at(f, cx, y, out / 2);
    B.box('solid', sp[0], sp[1], sp[2], f.nx ? out : w, 0.14, f.nz ? out : w, art.stone);
    const rp = at(f, cx, y + 0.62, out);
    B.box('solid', rp[0], rp[1], rp[2], f.nx ? 0.07 : w, 0.07, f.nz ? 0.07 : w, art.metal);
    const n = 7;
    for (let k = 0; k <= n; k++) {
      const pp = at(f, cx - w / 2 + (w * k) / n, y + 0.34, out);
      B.box('solid', pp[0], pp[1], pp[2], 0.05, 0.62, 0.05, art.metal);
    }
    for (const s of [-1, 1]) {
      const sr = at(f, cx + (s * w) / 2, y + 0.62, out / 2);
      B.box('solid', sr[0], sr[1], sr[2], f.nx ? out : 0.07, 0.07, f.nz ? out : 0.07, art.metal);
    }
  }

  // A jetty: the upper storey carried proud of the ground on a bracket row.
  if ((style === 'shopfront' || style === 'rowhouse') && rand() > 0.5) {
    band(env, lot, 3.24, 0.34, 0.26, art.trim);
    const n = Math.max(2, Math.round(f.len / 2.4));
    for (let k = 0; k < n; k++) {
      const p = at(f, ((k + 0.5) * f.len) / n, 3.06, 0.14);
      B.box('solid', p[0], p[1], p[2], 0.14, 0.3, 0.3, art.wall[1]!);
    }
  }

  // A front pediment raised above the parapet: a feature on the roofline from the street.
  if (lot.roof === 'flat' && rand() > 0.45) {
    const w = f.len * 0.44;
    const cx = f.len / 2;
    B.quad('solid', at(f, cx - w / 2, lot.h + 0.4, 0.1), at(f, cx + w / 2, lot.h + 0.4, 0.1), at(f, cx + w / 2, lot.h + 1.1, 0.1), at(f, cx - w / 2, lot.h + 1.1, 0.1), [0, 0, 1, 1], art.trim);
    B.quad('solid', at(f, cx - w / 2 - 0.16, lot.h + 1.1, 0.18), at(f, cx + w / 2 + 0.16, lot.h + 1.1, 0.18), at(f, cx + w / 2 + 0.16, lot.h + 1.26, 0.18), at(f, cx - w / 2 - 0.16, lot.h + 1.26, 0.18), [0, 0, 1, 1], art.stone);
  }
}

// ---------------------------------------------------------------------------
// The public entry
// ---------------------------------------------------------------------------

export function buildLot(env: BuildEnv, lot: Lot): void {
  const rand = mulberry32(lot.seed);
  switch (lot.style) {
    case 'warehouse':
      return warehouse(env, lot, rand);
    case 'greenhouse':
      return greenhouse(env, lot, rand);
    case 'kiosk':
      return kiosk(env, lot, rand);
    default:
      return masonry(env, lot, rand);
  }
}

function masonry(env: BuildEnv, lot: Lot, rand: () => number): void {
  const { art, sector } = env;
  for (const side of SIDES) wallFace(env, lot, side, rand);

  const style = lot.style;
  const front = faceOf(lot, FRONT[lot.face]);
  const nb = Math.max(1, Math.round(front.len / BAY));

  // Shop awnings over every bay that is not the door's, and a sign if it has a name.
  if (lot.shop && sector !== 'voltgrid') {
    for (let i = 0; i < nb; i++) if (i !== doorBayOf(nb, lot) || rand() > 0.5) awning(env, lot, FRONT[lot.face], i, nb, rand);
  }
  signBoard(env, lot, nb);
  massing(env, lot, rand, nb);

  // A cornice at the roofline and a plinth at the foot. The cornice stops 3 cm *under* the
  // roof plane: its top face used to sit at exactly `lot.h`, coplanar with the roof quad over
  // the whole footprint, and two surfaces at one depth z-fight — the roofs flickered and
  // streaked whenever the camera moved. Only its overhang is meant to show.
  band(env, lot, lot.h - 0.31, 0.28, 0.18, art.trim);
  if (style === 'rowhouse' || style === 'shopfront' || style === 'tenement' || style === 'townhall') band(env, lot, 0, 0.5, 0.1, art.stone);

  if (style === 'tower' || (style === 'podium' && sector === 'voltgrid')) neonTrim(env, lot, rand);

  const roof = lot.roof;
  if (roof === 'gable' && lot.h < 14) {
    const rise = Math.max(1.4, Math.min(lot.w, lot.d) * 0.3);
    gableRoof(env, lot, rise, 'roofSlate');
    chimneyAndDormers(env, lot, rand, rise);
  } else if (roof === 'hip') {
    hipRoof(env, lot, Math.min(lot.w, lot.d) * 0.28, 'roofSlate');
  } else if (roof === 'stepped' && lot.h > 14) {
    flatRoof(env, lot, rand, 'roofTar');
    steppedRoof(env, lot, rand);
  } else {
    flatRoof(env, lot, rand, sector === 'hollow' ? (rand() > 0.5 ? 'roofGreen' : 'roofTar') : 'roofTar');
  }

  if (style === 'townhall') {
    // Steps and columns: the civic building announces itself.
    const f = faceOf(lot, FRONT[lot.face]);
    const mid = f.len / 2;
    for (let i = 0; i < 3; i++) {
      const p = at(f, mid, 0.18 + i * 0.18, 0.7 + (2 - i) * 0.5);
      env.B.box('solid', p[0], p[1], p[2], f.nx ? 1.4 : 5.4, 0.36, f.nz ? 1.4 : 5.4, art.stone);
    }
    for (const dx of [-2.2, -0.75, 0.75, 2.2]) {
      const p = at(f, mid + dx, 2.2, 0.55);
      env.B.box('solid', p[0], p[1], p[2], 0.45, 4.2, 0.45, art.trim);
    }
  }
}

function warehouse(env: BuildEnv, lot: Lot, rand: () => number): void {
  const { B, art } = env;
  const x0 = lot.x - lot.w / 2;
  const x1 = lot.x + lot.w / 2;
  const z0 = lot.z - lot.d / 2;
  const z1 = lot.z + lot.d / 2;
  const h = lot.h;
  const k = 1 / 6;
  // Corrugated walls on all four sides: the metal roof texture, tipped on its side.
  B.quad('roofMetal', [x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [x0 * k, 0, x1 * k, h * k]);
  B.quad('roofMetal', [x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [x1 * k, 0, x0 * k, h * k]);
  B.quad('roofMetal', [x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [z1 * k, 0, z0 * k, h * k]);
  B.quad('roofMetal', [x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [z0 * k, 0, z1 * k, h * k]);
  B.box('solid', lot.x, 0.35, lot.z, lot.w + 0.2, 0.7, lot.d + 0.2, art.stone, 0, { skipTop: true });
  // A big roller door on the front, a hazard stripe above it, a lamp beside it.
  const f = faceOf(lot, FRONT[lot.face]);
  const dw = Math.min(5, f.len * 0.4);
  const mid = f.len * (0.3 + rand() * 0.4);
  const dh = Math.min(4.4, h - 0.6);
  const dp = at(f, mid, dh / 2, 0.06);
  B.box('solid', dp[0], dp[1], dp[2], f.nx ? 0.14 : dw, dh, f.nz ? 0.14 : dw, art.dark);
  const lp = at(f, mid - dw / 2 - 0.9, Math.min(3.8, h - 0.4), 0.3);
  B.box('solid', lp[0], lp[1], lp[2], 0.4, 0.25, 0.4, art.window, 1.4);
  if (lot.sign) signBoard(env, lot, Math.max(1, Math.round(f.len / BAY)));
  if (lot.roof === 'sawtooth') sawtoothRoof(env, lot, rand);
  else flatRoof(env, lot, rand, 'roofMetal');
}

function greenhouse(env: BuildEnv, lot: Lot, rand: () => number): void {
  const { B, art } = env;
  const x0 = lot.x - lot.w / 2;
  const x1 = lot.x + lot.w / 2;
  const z0 = lot.z - lot.d / 2;
  const z1 = lot.z + lot.d / 2;
  const h = lot.h;
  B.box('solid', lot.x, 0.5, lot.z, lot.w, 1, lot.d, art.stone, 0, { skipTop: true });
  // Glass walls: a translucent box with a mullion grid, and plants showing through.
  B.box('glass', lot.x, 0.9 + h / 2, lot.z, lot.w - 0.2, h - 0.9, lot.d - 0.2, '#cfeadf', 0.2, { skipBottom: true, skipTop: true });
  const cols = Math.round(lot.w / 2.2);
  for (let i = 0; i <= cols; i++) {
    const x = x0 + (i * lot.w) / cols;
    B.box('solid', x, 0.9 + (h - 0.9) / 2, z1, 0.12, h - 0.9, 0.12, art.trim);
    B.box('solid', x, 0.9 + (h - 0.9) / 2, z0, 0.12, h - 0.9, 0.12, art.trim);
  }
  B.box('solid', lot.x, h, z1, lot.w, 0.14, 0.14, art.trim);
  B.box('solid', lot.x, h, z0, lot.w, 0.14, 0.14, art.trim);
  // A barrel-vault roof: a half cylinder along the long axis, glazed.
  const alongX = lot.w >= lot.d;
  const r = (alongX ? lot.d : lot.w) / 2;
  const len = alongX ? lot.w : lot.d;
  const vault = new THREE.CylinderGeometry(r, r, len, 14, 1, true, 0, Math.PI);
  const m = new THREE.Matrix4().makeTranslation(lot.x, h, lot.z);
  m.multiply(new THREE.Matrix4().makeRotationZ(alongX ? Math.PI / 2 : 0));
  if (!alongX) m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  B.geo('glass', vault.rotateY(alongX ? Math.PI / 2 : 0), new THREE.Matrix4().makeTranslation(lot.x, h, lot.z).multiply(new THREE.Matrix4().makeRotationZ(0)), '#cfeadf', 0.18);
  // Plants inside: tufts of green on the floor that read through the glass.
  for (let i = 0; i < 9; i++) {
    const px = lot.x + (rand() - 0.5) * (lot.w - 2);
    const pz = lot.z + (rand() - 0.5) * (lot.d - 2);
    B.box('foliage', px, 0.6 + rand() * 0.8, pz, 0.8 + rand() * 0.8, 1.2 + rand() * 1.4, 0.8 + rand() * 0.8, art.leaf);
  }
  B.box('solid', x0 + 0.9, 1.3, lot.z, 0.1, 1.4, 1.2, art.window, 0.7);
  void z0;
}

function kiosk(env: BuildEnv, lot: Lot, rand: () => number): void {
  const { B, art } = env;
  const c = art.wall[Math.floor(rand() * art.wall.length)]!;
  B.box('solid', lot.x, lot.h / 2, lot.z, lot.w, lot.h, lot.d, c);
  B.box('solid', lot.x, 0.3, lot.z, lot.w + 0.15, 0.6, lot.d + 0.15, art.stone, 0, { skipTop: true });
  // A counter window on the front, glowing.
  const f = faceOf(lot, FRONT[lot.face]);
  const p = at(f, f.len / 2, 1.5, 0.06);
  B.box('solid', p[0], p[1], p[2], f.nx ? 0.1 : lot.w * 0.6, 1.0, f.nz ? 0.1 : lot.d * 0.6, art.window, 1.0);
  awning(env, lot, FRONT[lot.face], 0, 1, rand);
  hipRoof(env, lot, 1.3, null, art.accent);
  if (lot.shop) {
    const q = at(f, f.len / 2, lot.h + 1.8, 0.2);
    B.box('solid', q[0], q[1], q[2], f.nx ? 0.12 : 1.4, 0.6, f.nz ? 0.12 : 1.4, art.neon, 1.2);
  }
}

/**
 * A building seen only from inside the zone: one facade, a roof, and a lit crown. These
 * ring the city so that its edge is a skyline rather than the end of the world.
 */
export function backdropLot(env: BuildEnv, lot: Lot, inward: Side): void {
  const rand = mulberry32(lot.seed);
  wallFace(env, lot, inward, rand);
  const { B, art, sector } = env;
  const k = 1 / 6;
  const y = lot.h;
  const x0 = lot.x - lot.w / 2;
  const x1 = lot.x + lot.w / 2;
  const z0 = lot.z - lot.d / 2;
  const z1 = lot.z + lot.d / 2;
  B.quad('roofTar', [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [x0 * k, z0 * k, x1 * k, z1 * k]);
  // The three sides nobody sees are plain, in the district's darkest wall colour.
  const dark = art.wall[2]!;
  for (const side of SIDES) {
    if (side === inward) continue;
    const f = faceOf(lot, side);
    B.quad('solid', at(f, 0, 0), at(f, f.len, 0), at(f, f.len, y), at(f, 0, y), [0, 0, 1, 1], dark);
  }
  if (sector === 'voltgrid') B.box('solid', lot.x, y - 0.12, lot.z, lot.w + 0.2, 0.2, lot.d + 0.2, art.neon, 1.0);
  if (rand() > 0.5) {
    const mh = 3 + rand() * 6;
    B.box('solid', lot.x, y + mh / 2, lot.z, 0.2, mh, 0.2, art.metal);
    B.box('solid', lot.x, y + mh + 0.12, lot.z, 0.3, 0.3, 0.3, '#ff4a5e', 1.4);
  }
}

/** A soft contact shadow under a footprint — the cheapest way to plant a box on the ground. */
export function contactShadow(env: BuildEnv, x: number, z: number, w: number, d: number, strength = 1): void {
  const pad = 2.4;
  const x0 = x - w / 2 - pad;
  const x1 = x + w / 2 + pad;
  const z0 = z - d / 2 - pad;
  const z1 = z + d / 2 + pad;
  const c = Math.round(255 * Math.min(1, strength));
  void c;
  env.B.quad('ao', [x0, 0.03, z1], [x1, 0.03, z1], [x1, 0.03, z0], [x0, 0.03, z0], [0, 0, 1, 1], 0x000000);
}
