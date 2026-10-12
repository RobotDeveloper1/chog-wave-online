import * as THREE from 'three';
import { mulberry32, type CityLayout, type Court, type Fence, type Rect } from '@chog/shared';
import type { DistrictArt } from '../art.ts';
import type { BuildEnv } from './buildings.ts';
import { KERB } from './ground.ts';

/**
 * Street furniture and planting: everything that is not a building and not the ground.
 *
 * This is the layer that turns a plan into a *place*. Lamps give a street its rhythm and
 * its pools of light, trees give a square its shade and a district its season, a bench
 * under a lamp tells you people stop here. Everything is poured into the same batcher as
 * the buildings, so a thousand props cost a handful of draw calls.
 */

type V3 = [number, number, number];

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))]!;

function tintLeaf(art: DistrictArt, sector: string, r: () => number): string {
  const c = new THREE.Color(art.leaf);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // Ashflat is autumn: a third of the trees have turned. Hollow is lush; Voltgrid is sparse and cool.
  if (sector === 'ashflat' && r() < 0.38) c.setHSL(0.07 + r() * 0.05, 0.62, 0.42 + r() * 0.08);
  else c.setHSL(hsl.h + (r() - 0.5) * 0.04, hsl.s, Math.min(0.6, hsl.l + (r() - 0.5) * 0.12));
  return `#${c.getHexString()}`;
}

export function tree(env: BuildEnv, x: number, z: number, r: () => number, y = KERB, scale = 1): void {
  shadeTree(env, x, z, r, y, scale, r() < 0.22 ? 'tall' : 'round');
}

function bush(env: BuildEnv, x: number, z: number, r: () => number, y = KERB): void {
  const { B, art, sector } = env;
  const s = 0.5 + r() * 0.5;
  B.geo('foliage', new THREE.IcosahedronGeometry(s, 1), new THREE.Matrix4().makeTranslation(x, y + s * 0.7, z), tintLeaf(art, sector, r));
}

function lamp(env: BuildEnv, x: number, z: number, rot: number, y = KERB, tall = true): void {
  const { B, art, sector } = env;
  const h = tall ? 5.2 : 3.2;
  B.geo('solid', new THREE.CylinderGeometry(0.2, 0.28, 0.5, 8), new THREE.Matrix4().makeTranslation(x, y + 0.25, z), art.metal);
  B.geo('solid', new THREE.CylinderGeometry(0.08, 0.12, h, 8), new THREE.Matrix4().makeTranslation(x, y + h / 2, z), art.metal);
  const arm = 0.9;
  const ax = x + Math.sin(rot) * arm;
  const az = z + Math.cos(rot) * arm;
  B.box('solid', (x + ax) / 2, y + h, (z + az) / 2, Math.abs(Math.sin(rot)) * arm + 0.1, 0.1, Math.abs(Math.cos(rot)) * arm + 0.1, art.metal);
  const glow = sector === 'voltgrid' ? '#8fe8ff' : art.window;
  B.box('solid', ax, y + h - 0.12, az, 0.55, 0.22, 0.55, glow, 1.9);
  B.box('solid', ax, y + h + 0.06, az, 0.7, 0.1, 0.7, art.metal);
  // Its pool of light on the ground: an additive decal that bloom turns into atmosphere.
  const pr = tall ? 3.6 : 2.4;
  const c = new THREE.Color(glow);
  B.quad('pool', [ax - pr, y + 0.04, az + pr], [ax + pr, y + 0.04, az + pr], [ax + pr, y + 0.04, az - pr], [ax - pr, y + 0.04, az - pr], [0, 0, 1, 1], c.multiplyScalar(sector === 'voltgrid' ? 0.42 : 0.2).getHex());
}

function bench(env: BuildEnv, x: number, z: number, rot: number, y = KERB): void {
  const { B, art } = env;
  const g = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
  const place = (px: number, py: number, pz: number, w: number, h: number, d: number, c: string): void => {
    const v = new THREE.Vector3(px, py, pz).applyMatrix4(g);
    B.box('solid', v.x, v.y, v.z, w, h, d, c, 0, { rot });
  };
  place(0, 0.46, 0, 1.9, 0.1, 0.55, '#8a6a46');
  place(0, 0.8, -0.27, 1.9, 0.5, 0.09, '#8a6a46');
  place(-0.8, 0.23, 0, 0.1, 0.46, 0.5, art.metal);
  place(0.8, 0.23, 0, 0.1, 0.46, 0.5, art.metal);
}

function bin(env: BuildEnv, x: number, z: number, y = KERB): void {
  const { B, art } = env;
  B.geo('solid', new THREE.CylinderGeometry(0.3, 0.26, 0.85, 8), new THREE.Matrix4().makeTranslation(x, y + 0.42, z), art.metal);
  B.geo('solid', new THREE.CylinderGeometry(0.33, 0.33, 0.08, 8), new THREE.Matrix4().makeTranslation(x, y + 0.88, z), '#1b1626');
}

function hydrant(env: BuildEnv, x: number, z: number, y = KERB): void {
  const { B } = env;
  B.geo('solid', new THREE.CylinderGeometry(0.17, 0.2, 0.62, 8), new THREE.Matrix4().makeTranslation(x, y + 0.31, z), '#d84a4a');
  B.geo('solid', new THREE.SphereGeometry(0.17, 8, 6), new THREE.Matrix4().makeTranslation(x, y + 0.66, z), '#d84a4a');
}

function planter(env: BuildEnv, x: number, z: number, r: () => number, y = KERB): void {
  const { B, art } = env;
  B.box('solid', x, y + 0.3, z, 1.3, 0.6, 1.3, art.trim);
  B.box('solid', x, y + 0.62, z, 1.1, 0.06, 1.1, '#2b1f18');
  bush(env, x, z, r, y + 0.45);
}

function signalPole(env: BuildEnv, x: number, z: number, y = 0): void {
  const { B, art } = env;
  B.geo('solid', new THREE.CylinderGeometry(0.09, 0.12, 5, 8), new THREE.Matrix4().makeTranslation(x, y + 2.5, z), art.metal);
  B.box('solid', x + 0.45, y + 4.8, z, 0.9, 0.1, 0.1, art.metal);
  B.box('solid', x + 0.9, y + 4.35, z, 0.34, 1.0, 0.3, '#1b1626');
  B.box('solid', x + 0.9, y + 4.66, z + 0.17, 0.2, 0.2, 0.06, '#ff4a5e', 1.6);
  B.box('solid', x + 0.9, y + 4.36, z + 0.17, 0.2, 0.2, 0.06, '#ffd04a', 0.5);
  B.box('solid', x + 0.9, y + 4.06, z + 0.17, 0.2, 0.2, 0.06, '#5eff9e', 1.2);
}

const CAR = ['#8c2f4f', '#2f6f8c', '#c9a227', '#3b3b4a', '#7a8a4a', '#d8d0c0', '#a84a2f', '#26324a'];

/**
 * A parked car: three volumes (body, glasshouse, roof), raked screens front and back, and
 * round wheels. Two stacked boxes with box wheels read as a brick with legs at this camera
 * height; the rake of the windscreen and the round of the wheel are the two cues that say car.
 */
export function car(env: BuildEnv, x: number, z: number, rot: number, color: string, y = 0, lights = true): void {
  const { B } = env;
  const along = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
  const side = new THREE.Vector3(along.z, 0, -along.x);
  const P = (f: number, s: number, h: number): V3 => [x + along.x * f + side.x * s, y + h, z + along.z * f + side.z * s];
  const put = (f: number, s: number, h: number, w: number, hh: number, l: number, c: string, glow = 0): void => {
    const p = P(f, s, h);
    B.box('solid', p[0], p[1], p[2], w, hh, l, c, glow, { rot });
  };
  const glass = '#1a2430';
  // Body, with a slightly narrower glasshouse and a roof panel on top of it.
  put(0, 0, 0.6, 1.8, 0.6, 4.1, color);
  put(-0.25, 0, 1.14, 1.62, 0.5, 1.95, glass, 0.06);
  put(-0.25, 0, 1.42, 1.5, 0.1, 1.75, color);
  // Raked windscreen and rear window.
  B.quad('solid', P(0.72, -0.74, 0.92), P(0.72, 0.74, 0.92), P(0.4, 0.74, 1.4), P(0.4, -0.74, 1.4), [0, 0, 1, 1], '#7fa0c8', 0.1);
  B.quad('solid', P(-1.22, 0.74, 0.92), P(-1.22, -0.74, 0.92), P(-0.9, -0.74, 1.4), P(-0.9, 0.74, 1.4), [0, 0, 1, 1], '#7fa0c8', 0.1);
  // Side glass.
  for (const s of [-0.82, 0.82]) put(-0.25, s, 1.16, 0.05, 0.36, 1.6, glass, 0.06);
  // Round wheels on their true axis.
  for (const f of [-1.35, 1.35]) {
    for (const s of [-0.86, 0.86]) {
      const p = P(f, s, 0.36);
      const m = new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]).multiply(new THREE.Matrix4().makeRotationY(rot)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
      B.geo('solid', new THREE.CylinderGeometry(0.36, 0.36, 0.26, 10), m, '#0c0a12');
      const m2 = new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]).multiply(new THREE.Matrix4().makeRotationY(rot)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
      B.geo('solid', new THREE.CylinderGeometry(0.16, 0.16, 0.28, 8), m2, '#6a6a72');
    }
  }
  if (lights) {
    for (const s of [-0.6, 0.6]) {
      put(2.03, s, 0.7, 0.34, 0.2, 0.08, '#fff2c0', 1.6);
      put(-2.03, s, 0.7, 0.34, 0.2, 0.08, '#ff3a4a', 1.0);
    }
  }
}

export function carColour(r: () => number): string {
  return pick(r, CAR);
}

/** Fence segments from the plan: open rails, brick walls, hedges. */
function fence(env: BuildEnv, f: Fence): void {
  const { B, art } = env;
  const y = KERB;
  const dx = f.x1 - f.x0;
  const dz = f.z1 - f.z0;
  const len = Math.hypot(dx, dz);
  const cx = (f.x0 + f.x1) / 2;
  const cz = (f.z0 + f.z1) / 2;
  const alongX = Math.abs(dx) >= Math.abs(dz);
  if (f.kind === 'hedge') {
    B.box('foliage', cx, y + f.height / 2, cz, alongX ? len : 0.9, f.height, alongX ? 0.9 : len, art.leaf);
    return;
  }
  if (f.kind === 'wall') {
    B.box('solid', cx, y + f.height / 2, cz, alongX ? len : 0.4, f.height, alongX ? 0.4 : len, art.wall[0]!);
    B.box('solid', cx, y + f.height + 0.06, cz, alongX ? len + 0.1 : 0.55, 0.14, alongX ? 0.55 : len + 0.1, art.stone);
    return;
  }
  // Rail fence: posts every two units and two rails.
  const n = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = f.x0 + dx * t;
    const pz = f.z0 + dz * t;
    B.box('solid', px, y + f.height / 2, pz, 0.12, f.height, 0.12, art.metal);
  }
  for (const k of [0.45, 0.92]) {
    B.box('solid', cx, y + f.height * k, cz, alongX ? len : 0.08, 0.08, alongX ? 0.08 : len, art.metal);
  }
}

function crate(env: BuildEnv, x: number, z: number, r: () => number, y = KERB): void {
  const { B, art } = env;
  const s = 0.8 + r() * 0.5;
  B.box('solid', x, y + s / 2, z, s, s, s, pick(r, [art.wall[0]!, art.wall[2]!, art.accent, art.metal]), 0, { rot: r() * 0.6 });
  if (r() > 0.5) B.box('solid', x + (r() - 0.5) * 0.3, y + s + 0.35, z, s * 0.7, 0.7, s * 0.7, art.wall[1]!, 0, { rot: r() });
}

function barrel(env: BuildEnv, x: number, z: number, y = KERB): void {
  const { B, art } = env;
  B.geo('solid', new THREE.CylinderGeometry(0.4, 0.4, 0.9, 10), new THREE.Matrix4().makeTranslation(x, y + 0.45, z), art.accent);
  B.geo('solid', new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10), new THREE.Matrix4().makeTranslation(x, y + 0.6, z), art.metal);
}

/** Broken masonry for the ruins: leaning slabs and rubble. */
function rubble(env: BuildEnv, x: number, z: number, r: () => number, y = KERB): void {
  const { B, art } = env;
  for (let i = 0; i < 5; i++) {
    const s = 0.4 + r() * 0.9;
    B.box('solid', x + (r() - 0.5) * 2.4, y + s * 0.4, z + (r() - 0.5) * 2.4, s, s * 0.8, s, pick(r, [art.stone, art.wall[0]!, art.wall[2]!, art.metal]), 0, { rot: r() * 3 });
  }
}

/** String lights hung across a street: a sagging line of warm bulbs.
 *  The line is carried by a slim pole at each end. Strung across open asphalt with nothing at
 *  either end, the catenary floated in mid-air and read as a rendering error, which is exactly
 *  what a player calls "modelagem errada". */
function stringLights(env: BuildEnv, ax: number, az: number, bx: number, bz: number, y: number, r: () => number): void {
  const { B, art } = env;
  for (const [px, pz] of [[ax, az], [bx, bz]] as const) {
    B.geo('solid', new THREE.CylinderGeometry(0.06, 0.09, y - KERB, 6), new THREE.Matrix4().makeTranslation(px, KERB + (y - KERB) / 2, pz), art.metal);
    B.geo('solid', new THREE.SphereGeometry(0.1, 6, 5), new THREE.Matrix4().makeTranslation(px, y + 0.06, pz), art.metal);
  }
  const n = Math.max(5, Math.round(Math.hypot(bx - ax, bz - az) / 1.1));
  let px = ax;
  let py = y;
  let pz = az;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const sag = Math.sin(t * Math.PI) * 1.1;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const yy = y - sag;
    B.box('solid', (px + x) / 2, (py + yy) / 2, (pz + z) / 2, Math.max(0.04, Math.abs(x - px)), Math.max(0.04, Math.abs(yy - py)), Math.max(0.04, Math.abs(z - pz)), '#2a2230');
    if (i % 1 === 0) B.box('solid', x, yy - 0.18, z, 0.2, 0.26, 0.2, r() > 0.25 ? art.window : '#ff9e5e', 1.7);
    px = x;
    py = yy;
    pz = z;
  }
}

/** A hanging market banner or a shop flag: colour on the facades at the height of the eye. */
function banner(env: BuildEnv, x: number, y: number, z: number, rot: number, color: string): void {
  env.B.box('solid', x, y, z, 0.08, 2.6, 1.0, color, 0, { rot });
}

// ---------------------------------------------------------------------------
// Chog-world identity props
// ---------------------------------------------------------------------------

const TRIBE_COLOURS: Record<string, string> = {
  burn: '#e8622a',
  frost: '#6ac5d8',
  volt: '#f5d547',
  wave: '#5ec46a',
  prism: '#c87aef',
  void: '#4a4a6a',
};

/** A market stall: two poles, a coloured canopy, crates of goods underneath. */
function marketStall(env: BuildEnv, x: number, z: number, rot: number, r: () => number): void {
  const { B, art } = env;
  const g = new THREE.Matrix4().makeRotationY(rot);
  const p = (lx: number, ly: number, lz: number): V3 => {
    const v = new THREE.Vector3(lx, ly, lz).applyMatrix4(g);
    return [x + v.x, ly, z + v.z];
  };
  const canopy = pick(r, [art.accent, art.cloth, art.neon || art.accent]);
  const w = 2.4 + r() * 1.2;
  const d = 1.6;
  const h = 2.6;
  // Poles
  for (const [sx, sz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]] as const) {
    const [px, py, pz] = p(sx, 0, sz);
    B.geo('solid', new THREE.CylinderGeometry(0.06, 0.06, h, 5), new THREE.Matrix4().makeTranslation(px, py + h / 2, pz), art.metal);
  }
  // Canopy — a slightly sagging quad
  const [c0x, , c0z] = p(-w / 2 - 0.2, h + 0.1, -d / 2 - 0.2);
  const [c1x, , c1z] = p(w / 2 + 0.2, h + 0.1, -d / 2 - 0.2);
  const [c2x, , c2z] = p(w / 2 + 0.2, h - 0.15, d / 2 + 0.2);
  const [c3x, , c3z] = p(-w / 2 - 0.2, h - 0.15, d / 2 + 0.2);
  B.quad('solid', [c0x, h + 0.1, c0z], [c1x, h + 0.1, c1z], [c2x, h - 0.15, c2z], [c3x, h - 0.15, c3z], [0, 0, 1, 1], canopy);
  // Counter
  const [tx, , tz] = p(0, 0, 0);
  B.box('solid', tx, KERB + 0.9, tz, Math.abs(Math.cos(rot)) > 0.5 ? w : 0.6, 0.12, Math.abs(Math.sin(rot)) > 0.5 ? w : 0.6, art.wall[0]!, 0, { rot });
  // Goods — small coloured boxes on the counter
  const nGoods = 2 + Math.floor(r() * 3);
  for (let i = 0; i < nGoods; i++) {
    const gx = (r() - 0.5) * w * 0.6;
    const gz = (r() - 0.5) * 0.3;
    const [px2, , pz2] = p(gx, 0, gz);
    const s = 0.2 + r() * 0.25;
    const gc = pick(r, ['#e8c44a', '#d86a3a', '#6aaa5a', '#aa6ad8', '#d8d0c0', '#8a4a2a']);
    B.box('solid', px2, KERB + 1.02 + s / 2, pz2, s, s, s, gc, 0, { rot: r() * 0.5 });
  }
}

/** A wave pylon: tall thin pole with a glowing orb — the wave's presence made visible. */
function wavePylon(env: BuildEnv, x: number, z: number, r: () => number): void {
  const { B, art } = env;
  const h = 6 + r() * 2;
  // Base — a heavy disc
  B.geo('solid', new THREE.CylinderGeometry(0.5, 0.6, 0.4, 8), new THREE.Matrix4().makeTranslation(x, KERB + 0.2, z), art.metal);
  // Pole
  B.geo('solid', new THREE.CylinderGeometry(0.08, 0.14, h, 6), new THREE.Matrix4().makeTranslation(x, KERB + h / 2, z), art.metal);
  // Ring near the top
  B.geo('solid', new THREE.TorusGeometry(0.35, 0.06, 6, 12), new THREE.Matrix4().makeTranslation(x, KERB + h - 0.5, z), art.neon || art.metal);
  // Glowing orb
  B.geo('solid', new THREE.SphereGeometry(0.22, 8, 6), new THREE.Matrix4().makeTranslation(x, KERB + h + 0.1, z), art.window, 2.2);
  // Small secondary orbs orbiting
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r() * 0.5;
    const ox = Math.cos(a) * 0.5;
    const oz = Math.sin(a) * 0.5;
    B.geo('solid', new THREE.SphereGeometry(0.08, 5, 4), new THREE.Matrix4().makeTranslation(x + ox, KERB + h - 0.5 + r() * 0.6, z + oz), art.neon || art.window, 1.4);
  }
}

/** A tribe banner: a pole with a coloured flag that catches the eye. */
function tribeBanner(env: BuildEnv, x: number, z: number, tribe: string, r: () => number): void {
  const { B, art } = env;
  const h = 4.5 + r() * 1.5;
  const color = TRIBE_COLOURS[tribe] || art.accent;
  B.geo('solid', new THREE.CylinderGeometry(0.06, 0.08, h, 5), new THREE.Matrix4().makeTranslation(x, KERB + h / 2, z), art.metal);
  // Flag — two quads forming a pennant
  const flagH = 1.8;
  const flagW = 0.9;
  const fy = KERB + h - 0.3;
  B.quad('solid', [x, fy, z], [x + flagW, fy - 0.2, z], [x + flagW * 0.6, fy - flagH, z], [x, fy - flagH + 0.3, z], [0, 0, 1, 1], color);
  B.quad('solid', [x, fy, z + 0.04], [x + flagW, fy - 0.2, z + 0.04], [x + flagW * 0.6, fy - flagH, z + 0.04], [x, fy - flagH + 0.3, z + 0.04], [0, 0, 1, 1], color);
  // Cap
  B.geo('solid', new THREE.SphereGeometry(0.1, 5, 4), new THREE.Matrix4().makeTranslation(x, KERB + h + 0.05, z), color, 0.8);
}

/** Laundry line between two points — hanging rectangles of cloth. */
function laundryLine(env: BuildEnv, ax: number, az: number, bx: number, bz: number, y: number, r: () => number): void {
  const { B, art } = env;
  const n = 4 + Math.floor(r() * 4);
  // The line itself
  B.box('solid', (ax + bx) / 2, y, (az + bz) / 2, Math.hypot(bx - ax, bz - az), 0.03, 0.03, art.metal);
  // Hanging cloth rectangles
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const alongX = Math.abs(dx) >= Math.abs(dz);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const sag = Math.sin(t * Math.PI) * 0.3;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    const cy = y - sag;
    const cw = 0.4 + r() * 0.5;
    const ch = 0.5 + r() * 0.7;
    const cc = pick(r, ['#d8d0c0', '#c0a888', '#8a6a46', '#e8dcc8', '#b0c8d8', '#d8b0b0', '#ffffff']);
    B.box('solid', cx, cy - ch / 2 - 0.05, cz, alongX ? 0.04 : cw, ch, alongX ? cw : 0.04, cc);
  }
}

/** A plaza fountain: circular basin with a central jet. */
function fountain(env: BuildEnv, x: number, z: number, r: () => number): void {
  const { B, art } = env;
  const radius = 2.2 + r() * 0.8;
  // Basin wall
  B.geo('solid', new THREE.CylinderGeometry(radius, radius + 0.2, 0.7, 16), new THREE.Matrix4().makeTranslation(x, KERB + 0.35, z), art.stone);
  // Water surface
  B.geo('solid', new THREE.CylinderGeometry(radius - 0.15, radius - 0.15, 0.08, 16), new THREE.Matrix4().makeTranslation(x, KERB + 0.6, z), '#5a8aaa', 0.15);
  // Central pillar
  B.geo('solid', new THREE.CylinderGeometry(0.18, 0.22, 1.8, 8), new THREE.Matrix4().makeTranslation(x, KERB + 1.2, z), art.stone);
  // Top dish
  B.geo('solid', new THREE.CylinderGeometry(0.6, 0.4, 0.2, 10), new THREE.Matrix4().makeTranslation(x, KERB + 2.1, z), art.stone);
  // Glowing tip
  B.geo('solid', new THREE.SphereGeometry(0.12, 6, 5), new THREE.Matrix4().makeTranslation(x, KERB + 2.3, z), art.window, 1.0);
}

/** A street cat: tiny box body, head, and tail. */
function streetCat(env: BuildEnv, x: number, z: number, rot: number, r: () => number): void {
  const { B } = env;
  const color = pick(r, ['#4a4040', '#8a7060', '#d8c8a8', '#2a2a2a', '#c08840']);
  const g = new THREE.Matrix4().makeRotationY(rot).setPosition(x, KERB, z);
  const put = (lx: number, ly: number, lz: number, w: number, h: number, d: number, c: string): void => {
    const v = new THREE.Vector3(lx, ly, lz).applyMatrix4(g);
    B.box('solid', v.x, v.y, v.z, w, h, d, c, 0, { rot });
  };
  put(0, 0.22, 0, 0.22, 0.2, 0.4, color);
  put(0, 0.35, -0.22, 0.18, 0.16, 0.16, color);
  put(0, 0.3, 0.24, 0.06, 0.06, 0.2, color);
  // Ears
  put(-0.06, 0.44, -0.24, 0.05, 0.07, 0.04, color);
  put(0.06, 0.44, -0.24, 0.05, 0.07, 0.04, color);
}

/** Delivery crates stacked near a shop door — the street is a workplace. */
function deliveryCrates(env: BuildEnv, x: number, z: number, rot: number, r: () => number): void {
  const { B, art } = env;
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const s = 0.5 + r() * 0.4;
    const ox = (r() - 0.5) * 0.8;
    const oz = (r() - 0.5) * 0.4;
    const c = pick(r, [art.wall[0]!, art.wall[2]!, art.accent, '#8a7a5a', '#6a5a4a']);
    const g = new THREE.Matrix4().makeRotationY(rot).setPosition(x + ox, KERB, z + oz);
    const v = new THREE.Vector3(0, s / 2, 0).applyMatrix4(g);
    B.box('solid', v.x, v.y, v.z, s, s, s, c, 0, { rot: rot + r() * 0.4 });
    if (r() > 0.5 && i === 0) {
      const s2 = s * 0.7;
      B.box('solid', v.x, KERB + s + s2 / 2, v.z, s2, s2, s2, art.wall[1]!, 0, { rot: rot + r() });
    }
  }
}

/**
 * A shade tree with an actual structure: a trunk you can see under the canopy, two or three
 * branch stubs carrying it, and a crown of separate lobes lit from above and dark underneath.
 *
 * The old crown was three or four overlapping icosahedra of one colour, which merge into a
 * single smooth balloon — the one shape in the whole city that reads as a placeholder. A real
 * crown is lumpy and has an inside: separating the lobes and grading their colour top-light to
 * bottom-dark is what turns the balloon into a tree at this camera height.
 */
function shadeTree(env: BuildEnv, x: number, z: number, r: () => number, y: number, scale: number, form: 'round' | 'tall' | 'wide'): void {
  const { B, art, sector } = env;
  const trunkH = (form === 'tall' ? 2.6 : 2.0) * scale + r() * 0.8 * scale;
  const rad = (form === 'wide' ? 2.1 : form === 'tall' ? 1.2 : 1.6) * scale + r() * 0.6 * scale;
  B.geo('solid', new THREE.CylinderGeometry(0.13 * scale, 0.26 * scale, trunkH, 7), new THREE.Matrix4().makeTranslation(x, y + trunkH / 2, z), art.trunk);
  // Branch stubs: short angled limbs from the trunk top into the crown.
  const nBr = 2 + Math.floor(r() * 2);
  for (let i = 0; i < nBr; i++) {
    const a = (i / nBr) * Math.PI * 2 + r() * 1.2;
    const len = rad * 0.7;
    const m = new THREE.Matrix4().makeTranslation(x + Math.cos(a) * len * 0.4, y + trunkH - 0.1 + len * 0.28, z + Math.sin(a) * len * 0.4);
    m.multiply(new THREE.Matrix4().makeRotationZ(0.7));
    m.multiply(new THREE.Matrix4().makeRotationY(-a));
    B.geo('solid', new THREE.CylinderGeometry(0.05 * scale, 0.1 * scale, len, 5), m, art.trunk);
  }
  // The crown: lobes on a shell, graded light above and dark below so it has an inside.
  const cy = y + trunkH + rad * 0.42;
  const lobes = form === 'tall' ? 5 : 7;
  const base = tintLeaf(art, sector, r);
  const lc = new THREE.Color(base);
  // Only a touch lighter above and clearly darker below: a strong white lift turns the crown
  // into a cauliflower, because the autumn tints are already pale.
  const light = '#' + lc.clone().lerp(new THREE.Color('#ffffff'), 0.09).getHexString();
  const dark = '#' + lc.clone().lerp(new THREE.Color('#000000'), 0.34).getHexString();
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + r() * 0.7;
    const shell = i === 0 ? 0 : rad * (0.42 + r() * 0.3);
    const up = i === 0 ? rad * 0.34 : (r() - 0.35) * rad * 0.6;
    const br = rad * (i === 0 ? 0.72 : 0.42 + r() * 0.3);
    const col = up > rad * 0.3 ? light : up < -rad * 0.05 ? dark : base;
    B.geo('foliage', new THREE.IcosahedronGeometry(br, 1), new THREE.Matrix4().makeTranslation(x + Math.cos(a) * shell, cy + up, z + Math.sin(a) * shell), col);
  }
  // A dark pit of soil round the foot.
  B.box('solid', x, y + 0.04, z, 1.3 * scale, 0.08, 1.3 * scale, '#2c2218');
}

/** A district-distinct tree: different silhouette per sector. */
function districtTree(env: BuildEnv, x: number, z: number, r: () => number, y = KERB): void {
  const { B, art, sector } = env;
  if (sector === 'voltgrid') {
    // Thin, cypress-like — dark and vertical, fits between towers.
    const h = 1.8 + r() * 1.3;
    const rad = 0.5 + r() * 0.3;
    const totalH = h + 3 + r() * 2;
    B.geo('solid', new THREE.CylinderGeometry(0.08, 0.16, h, 6), new THREE.Matrix4().makeTranslation(x, y + h / 2, z), art.trunk);
    B.geo('foliage', new THREE.ConeGeometry(rad, totalH, 7), new THREE.Matrix4().makeTranslation(x, y + h + totalH / 2 - 0.3, z), tintLeaf(art, sector, r));
    B.box('solid', x, y + 0.04, z, 1.3, 0.08, 1.3, '#2c2218');
    return;
  }
  shadeTree(env, x, z, r, y, sector === 'hollow' ? 1.2 : 1, sector === 'hollow' ? 'wide' : r() < 0.25 ? 'tall' : 'round');
}

/** A window box with flowers — placed on a building facade. */
function windowBox(env: BuildEnv, x: number, y: number, z: number, rot: number, r: () => number): void {
  const { B, art } = env;
  const w = 0.8 + r() * 0.4;
  B.box('solid', x, y, z, Math.abs(Math.cos(rot)) > 0.5 ? 0.04 : w, 0.2, Math.abs(Math.sin(rot)) > 0.5 ? 0.04 : w, art.metal);
  // Flowers
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const off = (i / (n - 1) - 0.5) * w * 0.7;
    const fx = x + (Math.abs(Math.cos(rot)) > 0.5 ? 0 : off);
    const fz = z + (Math.abs(Math.sin(rot)) > 0.5 ? 0 : off);
    const fc = pick(r, ['#ff7ab0', '#ffe066', '#ffffff', '#b07aff', '#ff8a4a', '#ff4a6a']);
    B.box('solid', fx, y + 0.18, fz, 0.12, 0.16, 0.12, fc, 0.1);
    B.box('solid', fx, y + 0.12, fz, 0.08, 0.1, 0.08, art.leaf);
  }
}

export function buildProps(env: BuildEnv, layout: CityLayout): void {
  const { B, art, sector } = env;
  const rand = mulberry32(layout.sector.length * 7919 + 17);
  const anchors = layout.anchors;
  const near = (x: number, z: number, d = 2.4): boolean => anchors.some((a) => Math.hypot(a.x - x, a.z - z) < d);
  const clear = (x: number, z: number, r = 0.9): boolean =>
    !layout.solids.some((s) => Math.abs(x - s.x) < s.halfW + r && Math.abs(z - s.z) < s.halfD + r);
  const onIntersection = (x: number, z: number, pad = 1.5): boolean =>
    layout.intersections.some((i) => x > i.x0 - pad && x < i.x1 + pad && z > i.z0 - pad && z < i.z1 + pad);
  // The asphalt belongs to traffic. Everything scattered by angle or pushed off a lot front
  // can land in a lane, and a pylon standing in the middle of a road is a hole in the world's
  // rules — the same road the cars now brake on, no less.
  const onRoad = (x: number, z: number): boolean =>
    layout.streets.some((s) => x > s.rect.x0 + 1 && x < s.rect.x1 - 1 && z > s.rect.z0 + 1 && z < s.rect.z1 - 1);

  // A crown needs room: two trees planted three metres apart grow through each other and read
  // as one broken tree. Every planting goes through this, so the street row and the courts
  // share one notion of "already taken".
  const trees: [number, number][] = [];
  const spot = (x: number, z: number, rad = 3.2): boolean => {
    if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < rad)) return false;
    trees.push([x, z]);
    return true;
  };

  // Pavement furniture: lamps on the kerb side, trees between them, a bin or hydrant now and then.
  for (const b of layout.blocks) {
    const { x0, z0, x1, z1 } = b.rect;
    const edges: { a: V3; b: V3; out: [number, number] }[] = [
      { a: [x0 + 3, 0, z0 + 0.8], b: [x1 - 3, 0, z0 + 0.8], out: [0, -1] },
      { a: [x0 + 3, 0, z1 - 0.8], b: [x1 - 3, 0, z1 - 0.8], out: [0, 1] },
      { a: [x0 + 0.8, 0, z0 + 3], b: [x0 + 0.8, 0, z1 - 3], out: [-1, 0] },
      { a: [x1 - 0.8, 0, z0 + 3], b: [x1 - 0.8, 0, z1 - 3], out: [1, 0] },
    ];
    for (const e of edges) {
      const len = Math.hypot(e.b[0] - e.a[0], e.b[2] - e.a[2]);
      const dx = (e.b[0] - e.a[0]) / len;
      const dz = (e.b[2] - e.a[2]) / len;
      const rot = Math.atan2(e.out[0], e.out[1]);
      const phase = rand() * 4;
      // Lamps every 16 units rather than 12, and the mixed street furniture on its own,
      // wider beat: the pavement was a continuous run of poles and bins, and a street that
      // is *all* furniture has no room to look like a street.
      for (let t = 4 + phase; t < len - 3; t += 16) {
        const x = e.a[0] + dx * t;
        const z = e.a[2] + dz * t;
        if (onIntersection(x, z, 3.5) || near(x, z, 2.6)) continue;
        lamp(env, x, z, rot);
      }
      for (let t = 12 + phase; t < len - 3; t += 20) {
        const x = e.a[0] + dx * t;
        const z = e.a[2] + dz * t;
        if (onIntersection(x, z, 3.5) || near(x, z, 2.6)) continue;
        const r = rand();
        if (r < 0.55) {
          if (spot(x, z)) districtTree(env, x, z, rand);
        } else if (r < 0.7) bin(env, x, z);
        else if (r < 0.8) hydrant(env, x, z);
        else if (r < 0.9) planter(env, x, z, rand);
        else bench(env, x, z, rot + Math.PI);
      }
    }
  }

  // Traffic lights at every intersection corner.
  for (const i of layout.intersections) {
    const ext = layout.extent;
    if (i.x0 <= ext.x0 + 0.5 || i.x1 >= ext.x1 - 0.5 || i.z0 <= ext.z0 + 0.5 || i.z1 >= ext.z1 - 0.5) continue;
    signalPole(env, i.x0 - 0.8, i.z0 - 0.8, KERB);
    signalPole(env, i.x1 + 0.8, i.z1 + 0.8, KERB);
  }

  // No parked cars: the streets belong to the moving traffic now, and a row of static cars
  // read as obstacles the player had to walk around for no reason. Traffic brakes for you;
  // parked metal only ever got in the way.
  void car;
  void carColour;

  // Courts.
  for (const c of layout.courts) courtProps(env, c, rand, near, clear, spot);

  for (const f of layout.fences) fence(env, f);

  // Voltgrid: cables on poles along the main avenue.
  if (sector === 'voltgrid') {
    for (const s of layout.streets) {
      if (!s.main || s.axis !== 'x') continue;
      const r = s.rect;
      const z = (r.z0 + r.z1) / 2;
      for (let x = r.x0 + 12; x < r.x1 - 12; x += 28) {
        if (onIntersection(x, z, 4)) continue;
        B.box('solid', x, 5.5, r.z0 + 0.6, 0.2, 11, 0.2, art.metal);
        B.box('solid', x, 10.6, r.z0 + 0.6, 0.2, 0.2, 2.8, art.metal);
        B.box('solid', x, 10.8, r.z0 + 0.6, 0.5, 0.3, 0.5, art.neon, 1.5);
      }
    }
  }
  // Banners in the markets and along the shop rows — sparingly, or every shopfront wears one.
  for (const l of layout.lots) {
    if (!l.shop || l.style === 'kiosk' || rand() > 0.18) continue;
    const front = l.face;
    const dx = front === 1 ? l.w / 2 + 0.2 : front === 3 ? -l.w / 2 - 0.2 : 0;
    const dz = front === 2 ? l.d / 2 + 0.2 : front === 0 ? -l.d / 2 - 0.2 : 0;
    const x = l.x + dx + (front % 2 === 0 ? (l.w / 2 - 0.6) : 0);
    const z = l.z + dz + (front % 2 === 1 ? (l.d / 2 - 0.6) : 0);
    banner(env, x, 5.2, z, front % 2 === 0 ? Math.PI / 2 : 0, pick(rand, [art.accent, art.cloth, art.neon]));
  }

  // ---------------------------------------------------------------------------
  // Chog-world identity: the things that make this city belong to its universe
  // ---------------------------------------------------------------------------

  // Market stalls in front of shops — the street is a marketplace, but not every doorway.
  for (const l of layout.lots) {
    if (!l.shop || l.style === 'kiosk' || rand() > 0.2) continue;
    const front = l.face;
    const push = 2.2;
    const dx = front === 1 ? l.w / 2 + push : front === 3 ? -l.w / 2 - push : (rand() - 0.5) * l.w * 0.3;
    const dz = front === 2 ? l.d / 2 + push : front === 0 ? -l.d / 2 - push : (rand() - 0.5) * l.d * 0.3;
    const sx = l.x + dx;
    const sz = l.z + dz;
    if (!clear(sx, sz, 1.5) || near(sx, sz, 3) || onRoad(sx, sz)) continue;
    const stallRot = front === 0 ? 0 : front === 1 ? Math.PI / 2 : front === 2 ? Math.PI : -Math.PI / 2;
    marketStall(env, sx, sz, stallRot, rand);
  }

  // Wave pylons near the Wave Station — the wave's presence made visible.
  for (const a of layout.anchors) {
    if (a.kind !== 'wave') continue;
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + rand() * 0.5;
      const dist = 8 + rand() * 6;
      const px = a.x + Math.cos(angle) * dist;
      const pz = a.z + Math.sin(angle) * dist;
      if (!clear(px, pz, 1) || onRoad(px, pz)) continue;
      wavePylon(env, px, pz, rand);
    }
  }

  // Tribe banners near tribe halls and tribe NPCs.
  for (const l of layout.lots) {
    if (l.sign !== 'TRIBE HALL' && l.sign !== 'Tribe Hall' && l.sign !== 'TRIBE ARCADE') continue;
    const front = l.face;
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 3;
      const push = 1.8;
      const dx = front === 1 ? l.w / 2 + push : front === 3 ? -l.w / 2 - push : off;
      const dz = front === 2 ? l.d / 2 + push : front === 0 ? -l.d / 2 - push : off;
      const bx = l.x + dx;
      const bz = l.z + dz;
      if (!clear(bx, bz, 0.8) || onRoad(bx, bz)) continue;
      const tribe = ['burn', 'frost', 'volt', 'wave', 'prism'][Math.floor(rand() * 5)]!;
      tribeBanner(env, bx, bz, tribe, rand);
    }
  }

  // Delivery crates beside shop doors — commerce is visible, occasionally.
  for (const l of layout.lots) {
    if (!l.shop || rand() > 0.28) continue;
    const front = l.face;
    const side = front % 2 === 0 ? 1 : -1;
    const push = 0.8;
    const dx = front === 1 ? l.w / 2 + push : front === 3 ? -l.w / 2 - push : side * l.w * 0.35;
    const dz = front === 2 ? l.d / 2 + push : front === 0 ? -l.d / 2 - push : side * l.d * 0.35;
    const cx = l.x + dx;
    const cz = l.z + dz;
    if (!clear(cx, cz, 0.8) || onRoad(cx, cz)) continue;
    const crateRot = front === 0 ? 0 : front === 1 ? Math.PI / 2 : front === 2 ? Math.PI : -Math.PI / 2;
    deliveryCrates(env, cx, cz, crateRot, rand);
  }

  // Street cats — the city has strays.
  for (const b of layout.blocks) {
    const { x0, z0, x1, z1 } = b.rect;
    const nCats = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < nCats; i++) {
      const side = Math.floor(rand() * 4);
      let cx: number, cz: number;
      if (side === 0) { cx = x0 + 2 + rand() * (x1 - x0 - 4); cz = z0 + 1.5; }
      else if (side === 1) { cx = x0 + 2 + rand() * (x1 - x0 - 4); cz = z1 - 1.5; }
      else if (side === 2) { cx = x0 + 1.5; cz = z0 + 2 + rand() * (z1 - z0 - 4); }
      else { cx = x1 - 1.5; cz = z0 + 2 + rand() * (z1 - z0 - 4); }
      if (!clear(cx, cz, 0.5)) continue;
      streetCat(env, cx, cz, rand() * Math.PI * 2, rand);
    }
  }

  // Laundry lines between residential buildings — the street is a home.
  for (const b of layout.blocks) {
    if (b.def.kind !== 'houses' && b.def.kind !== 'tenements' && b.def.kind !== 'shops') continue;
    if (rand() > 0.3) continue;
    const { x0, z0, x1, z1 } = b.rect;
    const ly = 4 + rand() * 2;
    // Along the back edge
    if (rand() > 0.4) {
      const lz = z1 - 2;
      laundryLine(env, x0 + 2, lz, x1 - 2, lz, ly, rand);
    }
    // Along a side edge
    if (rand() > 0.5) {
      const lx = x0 + 2;
      laundryLine(env, lx, z0 + 3, lx, z1 - 3, ly, rand);
    }
  }

  // Fountains in plaza courts.
  for (const c of layout.courts) {
    if (c.kind !== 'plaza') continue;
    const cx = (c.rect.x0 + c.rect.x1) / 2;
    const cz = (c.rect.z0 + c.rect.z1) / 2;
    if (!clear(cx, cz, 3)) continue;
    fountain(env, cx, cz, rand);
  }

  // String lights across the narrow streets — a few, so they read as an occasion rather
  // than as wiring strung over every road in the city.
  for (const s of layout.streets) {
    if (s.width > 22 || rand() > 0.28) continue;
    const r2 = s.rect;
    if (s.axis === 'z') {
      for (let z = r2.z0 + 18; z < r2.z1 - 12; z += 34 + rand() * 12) {
        if (onIntersection((r2.x0 + r2.x1) / 2, z, 4)) continue;
        stringLights(env, r2.x0 + 0.5, z, r2.x1 - 0.5, z, 5.8 + rand() * 1.2, rand);
      }
    } else if (s.axis === 'x') {
      for (let x = r2.x0 + 18; x < r2.x1 - 12; x += 34 + rand() * 12) {
        if (onIntersection(x, (r2.z0 + r2.z1) / 2, 4)) continue;
        stringLights(env, x, r2.z0 + 0.5, x, r2.z1 - 0.5, 5.8 + rand() * 1.2, rand);
      }
    }
  }

  // Window boxes on residential buildings — colour at eye height, on a minority of them.
  for (const l of layout.lots) {
    if (l.style !== 'rowhouse' && l.style !== 'tenement' && l.style !== 'shopfront') continue;
    if (rand() > 0.22) continue;
    const front = l.face;
    const y = 3.8 + rand() * 3;
    const push = 0.2;
    const wRot = front === 0 ? 0 : front === 1 ? Math.PI / 2 : front === 2 ? Math.PI : -Math.PI / 2;
    for (let i = 0; i < 2; i++) {
      const off = (i - 0.5) * l.w * 0.4;
      const dx = front === 1 ? l.w / 2 + push : front === 3 ? -l.w / 2 - push : off;
      const dz = front === 2 ? l.d / 2 + push : front === 0 ? -l.d / 2 - push : off;
      windowBox(env, l.x + dx, y, l.z + dz, wRot, rand);
    }
  }
}

function courtProps(
  env: BuildEnv,
  c: Court,
  rand: () => number,
  near: (x: number, z: number, d?: number) => boolean,
  clear: (x: number, z: number, r?: number) => boolean,
  spot: (x: number, z: number, rad?: number) => boolean,
): void {
  const { B, art } = env;
  const { x0, z0, x1, z1 } = c.rect;
  const w = x1 - x0;
  const d = z1 - z0;
  const y = KERB + 0.02;
  const inside = (r: Rect): boolean => r.x1 > r.x0;
  void inside;
  const spots = (n: number, margin: number): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < n * 5 && out.length < n; i++) {
      const x = x0 + margin + rand() * Math.max(0.1, w - margin * 2);
      const z = z0 + margin + rand() * Math.max(0.1, d - margin * 2);
      if (!clear(x, z, 1.1) || near(x, z, 2.6)) continue;
      out.push([x, y, z]);
    }
    return out;
  };

  switch (c.kind) {
    case 'plaza':
    case 'market': {
      // A ring of trees round the edge and benches facing in, with the middle left open.
      const m = 2.4;
      const n = Math.floor((w + d) / 6);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * 2 * (w + d);
        let x: number;
        let z: number;
        if (t < w) {
          x = x0 + t;
          z = z0 + m;
        } else if (t < w + d) {
          x = x1 - m;
          z = z0 + (t - w);
        } else if (t < 2 * w + d) {
          x = x1 - (t - w - d);
          z = z1 - m;
        } else {
          x = x0 + m;
          z = z1 - (t - 2 * w - d);
        }
        if (!clear(x, z, 1.4) || near(x, z, 3)) continue;
        if (i % 3 === 0) bench(env, x, z, Math.atan2(rectCentre(c.rect).x - x, rectCentre(c.rect).z - z), y);
        else if (spot(x, z)) tree(env, x, z, rand, y, 0.9);
      }
      for (const [x, yy, z] of spots(4, 4)) planter(env, x, z, rand, yy);
      break;
    }
    case 'lawn':
    case 'garden': {
      for (const [x, yy, z] of spots(Math.round((w * d) / 70), 2.5)) if (spot(x, z)) tree(env, x, z, rand, yy, 1.05);
      for (const [x, yy, z] of spots(Math.round((w * d) / 50), 1.8)) bush(env, x, z, rand, yy);
      for (const [x, yy, z] of spots(3, 3)) bench(env, x, z, rand() * Math.PI * 2, yy);
      // Flower beds: scattered dots of colour on the grass.
      for (let i = 0; i < 40; i++) {
        const x = x0 + 1 + rand() * (w - 2);
        const z = z0 + 1 + rand() * (d - 2);
        if (!clear(x, z, 0.4)) continue;
        B.box('solid', x, y + 0.08, z, 0.22, 0.16, 0.22, pick(rand, ['#ff7ab0', '#ffe066', '#ffffff', '#b07aff', '#ff8a4a']), 0.1);
      }
      break;
    }
    case 'yard': {
      for (const [x, yy, z] of spots(Math.round((w * d) / 60), 2)) {
        if (rand() > 0.5) crate(env, x, z, rand, yy);
        else barrel(env, x, z, yy);
      }
      for (const [x, , z] of spots(2, 3)) lamp(env, x, z, rand() * 6, y, false);
      break;
    }
    case 'dirt': {
      for (const [x, yy, z] of spots(Math.round((w * d) / 55), 2)) rubble(env, x, z, rand, yy);
      for (const [x, yy, z] of spots(Math.round((w * d) / 110), 2)) if (spot(x, z)) tree(env, x, z, rand, yy, 0.8);
      break;
    }
    case 'paved': {
      for (const [x, yy, z] of spots(Math.round((w * d) / 110), 2.4)) {
        if (rand() > 0.5 && spot(x, z)) tree(env, x, z, rand, yy, 0.85);
        else bench(env, x, z, rand() * Math.PI * 2, yy);
      }
      for (const [x, , z] of spots(Math.round((w * d) / 220) + 1, 2.5)) lamp(env, x, z, rand() * 6, y, false);
      break;
    }
    case 'allotment': {
      for (const [x, yy, z] of spots(3, 3)) if (spot(x, z)) tree(env, x, z, rand, yy, 0.9);
      break;
    }
    default:
      break;
  }
  void art;
}

const rectCentre = (r: Rect): { x: number; z: number } => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
