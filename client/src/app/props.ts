import * as THREE from 'three';
import { Batcher, box, cyl, pick, toonMat, xform } from './geo.ts';
import type { DistrictArt } from './art.ts';

/**
 * Street props, all authored to go through the Batcher.
 *
 * Each function pushes geometry keyed by a material name rather than returning a
 * Mesh, so a hundred bollards cost one draw call. Anything that has to move or be
 * interacted with is deliberately not here.
 */

/** One palette type for the whole street: the district colour script in art.ts. */
export type Palette = DistrictArt;

/**
 * A bollard row along the kerb. Both street concepts show the caps lit, which is what
 * makes the pavement edge readable at night without a lamp on every metre.
 */
export function bollards(b: Batcher, xs: number[], z: number, color: string, glow?: string): void {
  for (const x of xs) {
    b.push('bollard', toonMat(color), cyl(0.1, 0.13, 0.78, 7), xform([x, 0.39, z]));
    b.push('bollard', toonMat(color), new THREE.SphereGeometry(0.11, 7, 5), xform([x, 0.8, z]));
    if (glow) b.push('bollard-glow', toonMat(glow, 1.6), cyl(0.085, 0.085, 0.1, 7), xform([x, 0.72, z]));
  }
}

/** A bench: seat, back, legs. Placed facing the street. */
export function bench(b: Batcher, x: number, z: number, wood: string, metal: string, rot = 0): void {
  const t = xform([x, 0, z], [0, rot, 0]);
  const at = (pos: [number, number, number], g: THREE.BufferGeometry, key: string, col: string) => {
    b.push(key, toonMat(col), g, t.clone().multiply(xform(pos)));
  };
  at([0, 0.46, 0], box(1.9, 0.1, 0.55), 'bench-wood', wood);
  at([0, 0.78, -0.26], box(1.9, 0.5, 0.09), 'bench-wood', wood);
  for (const dx of [-0.78, 0.78]) {
    at([dx, 0.23, 0], box(0.1, 0.46, 0.5), 'bench-metal', metal);
  }
}

/**
 * A tree: trunk plus three stacked foliage cones. Stacking cones rather than using
 * one sphere gives a silhouette that reads as a tree at street scale for a tenth
 * of the triangles.
 */
export function tree(b: Batcher, x: number, z: number, p: Palette, seed = 1): void {
  const h = 1.5 + ((seed * 37) % 5) * 0.22;
  const r = 0.9 + ((seed * 53) % 4) * 0.13;
  b.push('trunk', toonMat(p.trunk), cyl(0.11, 0.17, h, 6), xform([x, h / 2, z]));
  for (let i = 0; i < 3; i++) {
    const yy = h + i * r * 0.62;
    const rr = r * (1 - i * 0.24);
    b.push(
      'foliage',
      toonMat(p.leaf),
      new THREE.ConeGeometry(rr, rr * 1.35, 7),
      xform([x, yy, z], [0, (seed + i) * 0.7, 0]),
    );
  }
}

export function bush(b: Batcher, x: number, z: number, p: Palette, scale = 1): void {
  b.push('foliage', toonMat(p.leaf), new THREE.IcosahedronGeometry(0.42 * scale, 0), xform([x, 0.3 * scale, z]));
}

/** A planter with soil and a shrub, the thing that makes a sidewalk look maintained. */
export function planter(b: Batcher, x: number, z: number, p: Palette): void {
  b.push('planter', toonMat(p.trim), box(1.2, 0.5, 1.2), xform([x, 0.25, z]));
  b.push('soil', toonMat('#2b1f18'), box(1.0, 0.1, 1.0), xform([x, 0.52, z]));
  bush(b, x, z, p, 0.9);
}

/**
 * An ornate street lamp: base collar, fluted post, swan-neck arm and a glowing lantern
 * with a cap. Every concept painting has a row of these in the foreground, and a plain
 * cylinder with a ball on it does not read as one.
 */
export function lamp(b: Batcher, x: number, z: number, p: Palette, tall = true): void {
  const h = tall ? 4.6 : 2.9;
  const glow = p.window;
  b.push('lamp-base', toonMat(p.metal), cyl(0.2, 0.26, 0.34, 8), xform([x, 0.17, z]));
  b.push('lamp-post', toonMat(p.metal), cyl(0.075, 0.11, h, 8), xform([x, h / 2 + 0.3, z]));
  b.push('lamp-collar', toonMat(p.metal), cyl(0.13, 0.13, 0.12, 8), xform([x, h * 0.62, z]));
  // Swan neck: three short segments bending toward the street.
  for (let i = 0; i < 3; i++) {
    b.push('lamp-arm', toonMat(p.metal), box(0.09, 0.09, 0.34),
      xform([x + 0.1 + i * 0.11, h + 0.32 + i * 0.055, z], [0, 0, 0.5 + i * 0.35]));
  }
  const lx = x + 0.42;
  b.push('lamp-glow', toonMat(glow, 1.9), new THREE.SphereGeometry(0.2, 9, 6), xform([lx, h + 0.3, z]));
  b.push('lamp-cap', toonMat(p.metal), new THREE.ConeGeometry(0.26, 0.22, 8), xform([lx, h + 0.53, z]));
  b.push('lamp-finial', toonMat(p.metal), new THREE.SphereGeometry(0.05, 5, 4), xform([lx, h + 0.68, z]));
}

/** A traffic pole with a head, giving the intersection a reason to exist. */
export function trafficPole(b: Batcher, x: number, z: number, p: Palette): void {
  b.push('metal', toonMat(p.metal), cyl(0.09, 0.12, 4.6, 6), xform([x, 2.3, z]));
  b.push('metal', toonMat(p.metal), box(0.9, 0.12, 0.12), xform([x + 0.35, 4.4, z]));
  b.push('signal-box', toonMat('#1b1626'), box(0.3, 0.8, 0.28), xform([x + 0.72, 4.0, z]));
  b.push('signal-red', toonMat('#ff4a5e', 1.4), new THREE.SphereGeometry(0.1, 6, 5), xform([x + 0.72, 4.28, z - 0.16]));
  b.push('signal-green', toonMat('#5eff9e', 1.1), new THREE.SphereGeometry(0.1, 6, 5), xform([x + 0.72, 3.76, z - 0.16]));
}

/** A hydrant, a bin, a post box: the small objects that fill a street's gaps. */
export function hydrant(b: Batcher, x: number, z: number, color = '#d84a4a'): void {
  b.push('hydrant', toonMat(color), cyl(0.17, 0.2, 0.62, 7), xform([x, 0.31, z]));
  b.push('hydrant', toonMat(color), new THREE.SphereGeometry(0.17, 7, 5), xform([x, 0.66, z]));
  b.push('hydrant', toonMat(color), box(0.5, 0.09, 0.09), xform([x, 0.44, z]));
}

export function bin(b: Batcher, x: number, z: number, color: string): void {
  b.push('bin', toonMat(color), cyl(0.28, 0.24, 0.8, 8), xform([x, 0.4, z]));
  b.push('bin-lid', toonMat('#1b1626'), cyl(0.3, 0.3, 0.08, 8), xform([x, 0.84, z]));
}

export function vending(b: Batcher, x: number, z: number, p: Palette, rot = 0): void {
  const t = xform([x, 0, z], [0, rot, 0]);
  b.push('vending', toonMat(p.accent), box(1.0, 2.0, 0.7), t.clone().multiply(xform([0, 1, 0])));
  b.push('vending-glass', toonMat(p.dark, 0.5), box(0.72, 1.15, 0.05), t.clone().multiply(xform([0, 1.25, 0.37])));
  b.push('vending-dark', toonMat('#0e0a18'), box(0.2, 0.6, 0.05), t.clone().multiply(xform([0.34, 0.9, 0.37])));
}

/** Rooftop clutter. Seen from the town camera's downward tilt, roofs are half the view. */
export function roofKit(b: Batcher, x: number, z: number, w: number, d: number, h: number, p: Palette, seed: number): void {
  const units = 1 + (seed % 3);
  for (let i = 0; i < units; i++) {
    const ux = x - w / 2 + 0.8 + ((i * 1.7) % Math.max(1, w - 1.6));
    const uz = z - d / 2 + 0.7 + ((i * 1.3) % Math.max(1, d - 1.4));
    b.push('roof-kit', toonMat(p.metal), box(0.8, 0.5, 0.8), xform([ux, h + 0.25, uz]));
  }
  // A vent pipe and aerial, staggered per building so roofs do not repeat.
  b.push('roof-kit', toonMat(p.metal), cyl(0.1, 0.1, 0.9, 6), xform([x + w * 0.3, h + 0.45, z + d * 0.25]));
  b.push('aerial', toonMat(p.metal), cyl(0.03, 0.03, 1.6, 4), xform([x - w * 0.3, h + 0.8, z - d * 0.2]));
  b.push('aerial', toonMat(p.metal), box(0.7, 0.04, 0.04), xform([x - w * 0.3, h + 1.55, z - d * 0.2]));
}

/** An awning over a shopfront, which is what makes a facade read as a shop. */
export function awning(b: Batcher, x: number, y: number, z: number, w: number, color: string, stripes: string): void {
  b.push('awning', toonMat(color), box(w, 0.12, 1.0), xform([x, y, z], [0.16, 0, 0]));
  for (let i = 0; i < 4; i++) {
    b.push('awning-stripe', toonMat(stripes), box(w / 4 - 0.06, 0.14, 1.02), xform([x - w / 2 + w / 8 + (i * w) / 4, y, z], [0.16, 0, 0]));
  }
  for (const dx of [-w / 2 + 0.1, w / 2 - 0.1]) {
    b.push('metal', toonMat('#241a3a'), cyl(0.03, 0.03, 0.6, 4), xform([x + dx, y - 0.35, z + 0.45], [0.3, 0, 0]));
  }
}

/** A hanging sign perpendicular to the facade, readable from down the street. */
export function hangingSign(b: Batcher, x: number, y: number, z: number, color: string): void {
  b.push('metal', toonMat('#241a3a'), cyl(0.04, 0.04, 0.7, 4), xform([x, y + 0.35, z], [0, 0, Math.PI / 2]));
  b.push('sign-board', toonMat(color), box(0.16, 1.1, 0.7), xform([x + 0.3, y - 0.2, z]));
}

/** A fence run, useful for a construction site or a closed block. */
export function fence(b: Batcher, x0: number, x1: number, z: number, color: string, h = 1.6): void {
  const len = Math.abs(x1 - x0);
  const mid = (x0 + x1) / 2;
  b.push('fence', toonMat(color), box(len, h, 0.08), xform([mid, h / 2, z]));
  for (let i = 0; i <= Math.floor(len / 2); i++) {
    b.push('fence-post', toonMat('#1b1626'), box(0.12, h + 0.2, 0.12), xform([x0 + i * 2, (h + 0.2) / 2, z]));
  }
}

/** A raised walkway deck with supports, the second elevation over the street. */
export function walkway(b: Batcher, x0: number, x1: number, z: number, y: number, p: Palette): void {
  const len = Math.abs(x1 - x0);
  const mid = (x0 + x1) / 2;
  b.push('walkway', toonMat(p.metal), box(len, 0.28, 2.2), xform([mid, y, z]));
  b.push('walkway-rail', toonMat(p.trim), box(len, 1.0, 0.08), xform([mid, y + 0.6, z + 1.05]));
  b.push('walkway-rail', toonMat(p.trim), box(len, 1.0, 0.08), xform([mid, y + 0.6, z - 1.05]));
  for (let i = 0; i <= Math.floor(len / 8); i++) {
    b.push('metal', toonMat(p.metal), box(0.3, y, 0.3), xform([x0 + i * 8, y / 2, z + 0.9]));
  }
}

/**
 * A distant skyline. Pure silhouette massing at depth, which is what makes a street
 * feel like it is inside a city rather than on a set.
 */
export function skyline(b: Batcher, z: number, p: Palette, count = 22, spread = 260): void {
  for (let i = 0; i < count; i++) {
    const x = -spread / 2 + (i * spread) / count + ((i * 37) % 7);
    const h = 12 + ((i * 71) % 34);
    const w = 6 + ((i * 31) % 8);
    b.push('skyline', toonMat(pick(p.roof, 0)), box(w, h, 6), xform([x, h / 2, z]));
    // A couple of lit rows per tower, so the distance is not a flat wall.
    for (let k = 0; k < Math.floor(h / 6); k++) {
      if ((i + k) % 3) continue;
      b.push('skyline-lit', toonMat(p.window, 0.7), box(w * 0.5, 0.3, 0.2), xform([x, 3 + k * 5, z + 3.1]));
    }
  }
}

// ---------------------------------------------------------------------------
// The pieces both street concepts share and the old town did not have
// ---------------------------------------------------------------------------

/**
 * A steel pedestrian overpass on pylons, with a truss side and a diagonal stair.
 * Both paintings put one across the street; a plain deck on posts reads as a shelf.
 */
export function overpass(b: Batcher, x0: number, x1: number, z: number, y: number, p: Palette): void {
  const len = Math.abs(x1 - x0);
  const mid = (x0 + x1) / 2;
  // Deck top in stone and underside in metal: seen from a low camera the *underside*
  // is most of what you see, and an all-dark deck reads as a floating black slab.
  b.push('op-deck', toonMat(p.metal), box(len, 0.22, 2.4), xform([mid, y - 0.12, z]));
  b.push('op-deck-top', toonMat(p.stone), box(len, 0.16, 2.5), xform([mid, y + 0.06, z]));
  b.push('op-deck-lit', toonMat(p.neon, p.neonGlow * 0.5), box(len, 0.07, 2.55), xform([mid, y + 0.16, z]));
  for (let i = 0; i <= Math.floor(len / 1.6); i++) {
    b.push('op-joist', toonMat(p.metal), box(0.14, 0.34, 2.3), xform([x0 + i * 1.6, y - 0.34, z]));
  }
  for (const side of [1, -1]) {
    // Truss: top chord, bottom chord and diagonals that alternate.
    b.push('op-truss', toonMat(p.metal), box(len, 0.12, 0.12), xform([mid, y + 1.5, z + side * 1.15]));
    b.push('op-truss', toonMat(p.metal), box(len, 0.1, 0.1), xform([mid, y + 0.3, z + side * 1.15]));
    for (let i = 0; i <= Math.floor(len / 2.4); i++) {
      const x = x0 + i * 2.4;
      b.push('op-truss', toonMat(p.metal), box(0.1, 1.35, 0.1), xform([x, y + 0.9, z + side * 1.15]));
      b.push('op-diag', toonMat(p.metal), box(0.08, 2.5, 0.08),
        xform([x + 1.2, y + 0.9, z + side * 1.15], [0, 0, (i % 2 ? 1 : -1) * 0.72]));
    }
  }
  for (let i = 0; i <= Math.floor(len / 9); i++) {
    const x = x0 + i * 9;
    for (const dz of [-0.95, 0.95]) {
      b.push('op-pylon', toonMat(p.metal), box(0.34, y, 0.34), xform([x, y / 2, z + dz]));
      b.push('op-pylon-foot', toonMat(p.trim), box(0.7, 0.22, 0.7), xform([x, 0.11, z + dz]));
    }
  }
}

/** A diagonal stair run up to the overpass, with steps and both rails. */
export function stairRun(b: Batcher, x: number, z0: number, z1: number, rise: number, p: Palette): void {
  const steps = 14;
  const run = Math.abs(z1 - z0);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    b.push('stair', toonMat(p.metal), box(1.9, 0.16, run / steps + 0.06),
      xform([x, rise * t + 0.1, z0 + (z1 - z0) * t]));
  }
  for (const dx of [-0.98, 0.98]) {
    b.push('stair-rail', toonMat(p.trim), box(0.08, 0.08, Math.hypot(run, rise)),
      xform([x + dx, rise / 2 + 0.7, (z0 + z1) / 2], [Math.atan2(rise, run), 0, 0]));
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      b.push('stair-post', toonMat(p.metal), box(0.07, 0.9, 0.07),
        xform([x + dx, rise * t + 0.45, z0 + (z1 - z0) * t]));
    }
  }
}

/**
 * A pole-mounted ticker board. The screen itself is a separate textured mesh — the
 * canvas updates, so it can never join a merged batch — and this is its frame.
 */
export function billboardFrame(b: Batcher, x: number, z: number, w: number, h: number, p: Palette): void {
  const base = 6.2;
  b.push('bb-mast', toonMat(p.metal), cyl(0.24, 0.34, base, 8), xform([x, base / 2, z]));
  b.push('bb-mast-foot', toonMat(p.trim), box(2.2, 0.3, 2.2), xform([x, 0.15, z]));
  b.push('bb-frame', toonMat(p.metal), box(w + 0.7, h + 0.7, 0.34), xform([x, base + h / 2, z]));
  b.push('bb-face-back', toonMat(pick(p.roof, 0)), box(w + 0.3, h + 0.3, 0.3), xform([x, base + h / 2, z - 0.2]));
  // The lit face. A board with no screen reads as a hole cut in the sky, which is
  // exactly what the first street screenshot showed.
  b.push('bb-screen', toonMat(p.window, 0.85), box(w - 0.2, h - 0.2, 0.1), xform([x, base + h / 2, z + 0.22]));
  for (let r = 0; r < 4; r++) {
    b.push('bb-row', toonMat(p.dark), box(w - 1.2, 0.16, 0.06), xform([x, base + h * 0.78 - r * (h / 5.5), z + 0.29]));
  }
  // Truss legs under the board, which is how the concept builds them.
  for (const dx of [-w / 2 + 0.4, w / 2 - 0.4]) {
    b.push('bb-leg', toonMat(p.metal), box(0.14, 2.2, 0.14), xform([x + dx, base - 0.6, z + 0.1], [0.34, 0, 0]));
  }
  b.push('bb-crown', toonMat(p.metal), box(w + 0.9, 0.24, 0.5), xform([x, base + h + 0.4, z]));
  for (let i = 0; i < 4; i++) {
    b.push('bb-lamp', toonMat(p.window, 1.4), box(0.2, 0.12, 0.2),
      xform([x - w / 2 + (i + 0.5) * (w / 4), base + h + 0.6, z + 0.3], [0.5, 0, 0]));
  }
}

/** Chain-link site fence with posts and a hazard-striped bottom board. */
export function constructionFence(b: Batcher, x0: number, x1: number, z: number, p: Palette): void {
  const len = Math.abs(x1 - x0);
  const mid = (x0 + x1) / 2;
  b.push('mesh', toonMat(p.metal, 0.15), box(len, 1.8, 0.05), xform([mid, 1.15, z]));
  b.push('hazard', toonMat(p.accent), box(len, 0.34, 0.12), xform([mid, 0.2, z]));
  b.push('hazard-stripe', toonMat(p.dark), box(len, 0.16, 0.14), xform([mid, 0.2, z + 0.02]));
  for (let i = 0; i <= Math.floor(len / 2.2); i++) {
    b.push('mesh-post', toonMat(p.metal), box(0.12, 2.2, 0.12), xform([x0 + i * 2.2, 1.1, z]));
  }
  // Scaffolding inside the site: standards, ledgers and boards.
  for (let i = 0; i < 3; i++) {
    const x = x0 + 1.2 + i * 2.6;
    for (const dz of [-0.7, 0.7]) {
      b.push('scaf', toonMat(p.metal), box(0.12, 4.4, 0.12), xform([x, 2.2, z + dz]));
    }
    for (let k = 1; k <= 3; k++) {
      b.push('scaf', toonMat(p.metal), box(0.1, 0.1, 1.5), xform([x, k * 1.3, z]));
      b.push('scaf-board', toonMat(p.trim), box(2.6, 0.09, 1.4), xform([x + 1.3, k * 1.3 + 0.06, z]));
    }
  }
}

/** A stack of shipping crates and a pallet, the thing that says a shop receives goods. */
export function crateStack(b: Batcher, x: number, z: number, p: Palette, seed: number): void {
  const wood = toonMat(pick(p.wall, seed));
  for (let i = 0; i < 3; i++) {
    const s = 0.75 + rnd(i + seed) * 0.3;
    b.push('crate', wood, box(s, s, s), xform([x + (i % 2) * 0.8, s / 2 + (i > 1 ? 0.8 : 0), z], [0, (i * 0.4) % 1, 0]));
    b.push('crate-band', toonMat(p.metal), box(s + 0.04, 0.08, s + 0.04), xform([x + (i % 2) * 0.8, s * 0.62 + (i > 1 ? 0.8 : 0), z]));
  }
  b.push('pallet', toonMat(pick(p.wall, seed + 2)), box(1.5, 0.14, 1.0), xform([x - 1.3, 0.07, z + 0.2]));
  for (const dz of [-0.4, 0, 0.4]) {
    b.push('pallet-runner', toonMat(p.metal), box(1.5, 0.07, 0.09), xform([x - 1.3, 0.03, z + 0.2 + dz]));
  }
}

function rnd(n: number): number {
  const x = Math.sin(n * 91.37) * 1000;
  return x - Math.floor(x);
}

/** Manhole cover and a storm grate, the small ground detail that sells a road. */
export function streetDrain(b: Batcher, x: number, z: number, p: Palette): void {
  b.push('manhole', toonMat(p.dark), cyl(0.55, 0.55, 0.05, 12), xform([x, 0.04, z]));
  b.push('manhole-ring', toonMat(p.metal), cyl(0.62, 0.62, 0.04, 12), xform([x, 0.03, z]));
  for (let i = 0; i < 5; i++) {
    b.push('grate', toonMat(p.metal), box(0.9, 0.05, 0.08), xform([x + 2.4, 0.045, z - 0.2 + i * 0.1]));
  }
}

/** Traffic pole with a signal head, a back plate and a district name plate. */
export function signalPole(b: Batcher, x: number, z: number, p: Palette): void {
  b.push('signal-post', toonMat(p.metal), cyl(0.1, 0.14, 4.8, 8), xform([x, 2.4, z]));
  b.push('signal-post-base', toonMat(p.metal), cyl(0.24, 0.28, 0.24, 8), xform([x, 0.12, z]));
  b.push('signal-arm', toonMat(p.metal), box(1.5, 0.11, 0.11), xform([x + 0.7, 4.55, z]));
  b.push('signal-head', toonMat('#1b1626'), box(0.34, 0.95, 0.34), xform([x + 1.35, 4.1, z]));
  b.push('signal-red', toonMat('#ff4a5e', 1.8), new THREE.SphereGeometry(0.12, 7, 5), xform([x + 1.35, 4.42, z + 0.18]));
  b.push('signal-amber', toonMat('#ffbb4a', 1.2), new THREE.SphereGeometry(0.12, 7, 5), xform([x + 1.35, 4.1, z + 0.18]));
  b.push('signal-green', toonMat('#5eff9e', 1.2), new THREE.SphereGeometry(0.12, 7, 5), xform([x + 1.35, 3.78, z + 0.18]));
  // The name plate is what makes a district legible without a UI label.
  b.push('plate', toonMat(p.accent, 0.5), box(1.25, 0.5, 0.08), xform([x - 0.1, 3.2, z + 0.12]));
  b.push('plate-rim', toonMat(p.metal), box(1.4, 0.62, 0.06), xform([x - 0.1, 3.2, z + 0.09]));
}
