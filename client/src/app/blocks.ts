import * as THREE from 'three';
import { Batcher, box, cyl, pick, xform } from './geo.ts';
import { flat, toon, type DistrictArt } from './art.ts';

/**
 * The three building vocabularies, one per district, lifted from the concept paintings.
 *
 * The old town ran every district through the same `building()` with a palette swap,
 * which is why the three sectors looked like the same street painted three times. Real
 * districts differ in *section*: how many storeys, how the roofline breaks, what sits on
 * the roof, and what the ground floor does. So each type below commits to one of those:
 *
 *   Ashflat  — 2-3 storey brick row houses, gables, dormers, chimneys, water towers,
 *              striped awnings, shopfronts that meet the pavement.
 *   Voltgrid — 6-8 storey flat-roofed steel blocks, dense window grids, neon edge trim,
 *              antenna masts with aircraft lights, satellite dishes, cable runs.
 *   Hollow   — verdigris concrete blocks on arcade arches, rooftop greenhouses, ivy,
 *              hanging banners, scaffolding.
 *
 * Everything pushes into the Batcher, so the detail is nearly free: a whole block of
 * windows is one draw call, not sixty.
 */

const rnd = (seed: number, salt = 0) => {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------------------
// shared sub-parts
// ---------------------------------------------------------------------------

/** Window recess + glass + sill, the thing that makes a flat wall read as a facade. */
function windowGrid(
  b: Batcher,
  a: DistrictArt,
  cx: number,
  base: number,
  w: number,
  h: number,
  z: number,
  cols: number,
  rows: number,
  seed: number,
  litBias: number,
): void {
  const cw = w / cols;
  const rh = h / rows;
  const ww = Math.min(1.15, cw * 0.52);
  const wh = Math.min(1.45, rh * 0.6);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cx - w / 2 + (c + 0.5) * cw;
      const y = base + rh * (r + 0.5);
      const lit = rnd(seed, r * 13 + c) < litBias;
      // Frame first, glass inset — the frame is what catches the eye at street scale.
      b.push('win-frame', toon(a.trim), box(ww + 0.22, wh + 0.22, 0.1), xform([x, y, z + 0.02]));
      b.push(lit ? 'win-lit' : 'win-dark', lit ? toon(a.window, a.windowGlow) : toon(a.dark),
        box(ww, wh, 0.12), xform([x, y, z + 0.07]));
      if (rnd(seed, r * 7 + c * 3) > 0.72) {
        b.push('win-sill', toon(a.stone), box(ww + 0.4, 0.1, 0.3), xform([x, y - wh / 2 - 0.12, z + 0.14]));
      }
    }
  }
}

/** Cornice + plinth bands: the two horizontal lines that give a block its scale. */
function bands(b: Batcher, a: DistrictArt, cx: number, w: number, d: number, h: number, z: number): void {
  b.push('plinth', toon(a.stone), box(w + 0.4, 0.55, d + 0.4), xform([cx, 0.28, z]));
  b.push('cornice', toon(a.trim), box(w + 0.3, 0.34, d + 0.3), xform([cx, h - 0.2, z]));
}

/** Rooftop clutter shared by every type: vents, ducts, a stub wall. */
function roofClutter(b: Batcher, a: DistrictArt, cx: number, w: number, d: number, h: number, z: number, seed: number): void {
  const n = 2 + Math.floor(rnd(seed, 1) * 3);
  for (let i = 0; i < n; i++) {
    const ux = cx - w / 2 + 0.9 + rnd(seed, i * 3) * Math.max(0.6, w - 1.8);
    const uz = z - d / 2 + 0.8 + rnd(seed, i * 5 + 2) * Math.max(0.6, d - 1.6);
    b.push('roof-kit', toon(a.metal), box(0.75, 0.55, 0.75), xform([ux, h + 0.28, uz]));
    b.push('roof-kit', toon(a.metal), box(0.2, 0.22, 0.9), xform([ux, h + 0.62, uz]));
  }
  // A parapet wall so flat roofs do not read as open trays.
  b.push('parapet', toon(a.stone), box(w + 0.2, 0.42, 0.16), xform([cx, h + 0.2, z + d / 2]));
  b.push('parapet', toon(a.stone), box(w + 0.2, 0.42, 0.16), xform([cx, h + 0.2, z - d / 2]));
  b.push('parapet', toon(a.stone), box(0.16, 0.42, d), xform([cx - w / 2, h + 0.2, z]));
  b.push('parapet', toon(a.stone), box(0.16, 0.42, d), xform([cx + w / 2, h + 0.2, z]));
}

/** Timber water tower on legs — the Ashflat silhouette signature. */
function waterTower(b: Batcher, a: DistrictArt, x: number, z: number, h: number, seed: number): void {
  const legTop = h + 1.5;
  for (const [dx, dz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]] as const) {
    b.push('tower-leg', toon(a.metal), box(0.14, 1.5, 0.14), xform([x + dx, h + 0.75, z + dz]));
  }
  b.push('tower-tank', toon(pick(a.roof, seed)), cyl(0.85, 0.85, 1.5, 10), xform([x, legTop + 0.75, z]));
  b.push('tower-cap', toon(a.stone), new THREE.ConeGeometry(0.95, 0.7, 10), xform([x, legTop + 1.85, z]));
  b.push('tower-band', toon(a.metal), cyl(0.9, 0.9, 0.1, 10), xform([x, legTop + 0.5, z]));
}

function chimney(b: Batcher, a: DistrictArt, x: number, z: number, h: number, seed: number): void {
  const tall = 1.1 + rnd(seed, 9) * 1.1;
  b.push('chimney', toon(pick(a.wall, seed + 2)), box(0.55, tall, 0.55), xform([x, h + tall / 2, z]));
  b.push('chimney-cap', toon(a.stone), box(0.68, 0.16, 0.68), xform([x, h + tall + 0.06, z]));
  b.push('chimney-pot', toon(a.metal), cyl(0.1, 0.12, 0.3, 6), xform([x + 0.14, h + tall + 0.28, z]));
}

/** Pitched roof with an overhang, built as an extruded triangle so the gable ends close. */
function gableRoof(b: Batcher, color: string, cx: number, w: number, d: number, h: number, z: number, rise: number): void {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - 0.3, 0);
  shape.lineTo(0, rise);
  shape.lineTo(w / 2 + 0.3, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d + 0.6, bevelEnabled: false });
  geo.translate(0, 0, -(d + 0.6) / 2);
  b.push('roof', toon(color), geo, xform([cx, h, z]));
  // A fascia board along each eave, which is what gives the pediment a readable edge.
  for (const dx of [-w / 2 - 0.18, w / 2 + 0.18]) {
    b.push('roof-edge', toon(color), box(0.2, 0.18, d + 0.8), xform([cx + dx, h + 0.06, z]));
  }
}

/** Dormer window in a roof slope — the detail that stops a roof being a plain triangle. */
function dormer(b: Batcher, a: DistrictArt, x: number, y: number, z: number, seed: number): void {
  b.push('dormer', toon(pick(a.wall, seed)), box(0.95, 0.8, 0.7), xform([x, y, z]));
  b.push('dormer-roof', toon(pick(a.roof, seed + 1)), box(1.1, 0.14, 0.85), xform([x, y + 0.46, z - 0.05], [0.3, 0, 0]));
  b.push('dormer-glass', toon(a.window, a.windowGlow), box(0.55, 0.5, 0.08), xform([x, y + 0.02, z + 0.36]));
}

/** Striped shop awning with a valance and two stays. */
function awningCanopy(b: Batcher, a: DistrictArt, x: number, y: number, z: number, w: number): void {
  const depth = 1.15;
  b.push('awning', toon(a.accent), box(w, 0.12, depth), xform([x, y, z + depth / 2], [0.2, 0, 0]));
  const stripes = 5;
  for (let i = 0; i < stripes; i++) {
    if (i % 2) continue;
    b.push('awning-stripe', toon(a.cloth), box(w / stripes - 0.04, 0.15, depth + 0.04),
      xform([x - w / 2 + (i + 0.5) * (w / stripes), y, z + depth / 2], [0.2, 0, 0]));
  }
  b.push('awning-valance', toon(a.accent), box(w, 0.3, 0.06), xform([x, y - 0.32, z + depth]));
  for (const dx of [-w / 2 + 0.12, w / 2 - 0.12]) {
    b.push('metal', toon(a.metal), cyl(0.035, 0.035, 0.85, 4), xform([x + dx, y - 0.42, z + depth - 0.1], [0.42, 0, 0]));
  }
}

/** Door with a transom and a step, recessed so the facade has depth. */
function doorway(b: Batcher, a: DistrictArt, x: number, z: number, seed: number): void {
  b.push('door-frame', toon(a.stone), box(2.1, 2.9, 0.22), xform([x, 1.45, z + 0.06]));
  b.push('door', toon(pick(a.roof, seed + 3)), box(1.55, 2.5, 0.16), xform([x, 1.25, z + 0.14]));
  b.push('door-glass', toon(a.window, a.windowGlow * 0.7), box(1.2, 0.5, 0.08), xform([x, 2.35, z + 0.2]));
  b.push('door-step', toon(a.stone), box(2.6, 0.16, 1.0), xform([x, 0.08, z + 0.62]));
  b.push('door-knob', toon(a.metal), new THREE.SphereGeometry(0.07, 6, 5), xform([x + 0.55, 1.25, z + 0.22]));
}

// ---------------------------------------------------------------------------
// ASHFLAT — brick row house
// ---------------------------------------------------------------------------

export interface BlockSpec {
  x: number;
  w: number;
  d: number;
  h: number;
  seed: number;
  sign?: string;
  shop?: boolean;
}

/**
 * A 2-3 storey row house. Widths and heights vary per instance and the roofline choice
 * is seeded, because a row of identical houses is the single most obvious tell of a
 * generated street.
 */
export function rowHouse(b: Batcher, a: DistrictArt, s: BlockSpec, z: number, solids: { x: number; z: number; halfW: number; halfD: number }[]): void {
  const { w, d, h, seed } = s;
  const wall = pick(a.wall, seed);
  const roofCol = pick(a.roof, seed + 1);
  const storeys = Math.max(2, Math.round(h / 3.1));

  b.push('wall-brick', toon(wall), box(w, h, d), xform([s.x, h / 2, z]));
  bands(b, a, s.x, w, d, h, z);

  const roofH = h;
  const gabled = rnd(seed, 4) > 0.35;
  if (gabled) {
    gableRoof(b, roofCol, s.x, w, d, roofH, z, Math.max(1.1, w * 0.3));
    for (let i = 0; i < 2; i++) {
      if (rnd(seed, 20 + i) > 0.55) continue;
      dormer(b, a, s.x - w / 4 + (i * w) / 2, roofH + 0.62, z + d / 2 - 0.35, seed + i);
    }
  } else {
    b.push('roof-flat', toon(roofCol), box(w + 0.35, 0.4, d + 0.35), xform([s.x, roofH + 0.2, z]));
    waterTower(b, a, s.x + w * 0.22, z - d * 0.18, roofH + 0.4, seed);
  }
  chimney(b, a, s.x - w * 0.32, z - d * 0.2, roofH + (gabled ? 0.5 : 0.3), seed);

  // Facade windows on the +z face; ground floor is left clear for the shopfront.
  const cols = Math.max(2, Math.round(w / 2.4));
  const gridBase = s.shop ? 3.0 : 1.4;
  const gridH = Math.max(1.6, h - gridBase - 0.6);
  windowGrid(b, a, s.x, gridBase, w - 0.6, gridH, z + d / 2,
    cols, Math.max(1, storeys - (s.shop ? 1 : 0)), seed, s.shop ? 0.55 : 0.4);

  if (s.shop) {
    // Big display window + door + awning at pavement level.
    b.push('shop-glass', toon(a.window, a.windowGlow * 0.55), box(w - 2.6, 1.7, 0.12), xform([s.x - 0.9, 1.35, z + d / 2 + 0.1]));
    b.push('shop-frame', toon(a.trim), box(w - 2.3, 1.95, 0.08), xform([s.x - 0.9, 1.35, z + d / 2 + 0.05]));
    doorway(b, a, s.x + w / 2 - 1.3, z + d / 2, seed);
    awningCanopy(b, a, s.x - 0.9, 2.5, z + d / 2 + 0.1, w - 2.2);
    // Window box under the display, because the concept has one on every other shop.
    b.push('win-box', toon(a.metal), box(w - 3.0, 0.28, 0.4), xform([s.x - 0.9, 0.5, z + d / 2 + 0.42]));
    b.push('win-box-leaf', toon(a.leaf), box(w - 3.3, 0.34, 0.3), xform([s.x - 0.9, 0.72, z + d / 2 + 0.42]));
  } else {
    doorway(b, a, s.x, z + d / 2, seed);
    b.push('stoop', toon(a.stone), box(2.2, 0.2, 1.4), xform([s.x, 0.1, z + d / 2 + 0.9]));
  }

  if (s.sign) {
    // A board perpendicular to the facade, readable when looking down the street.
    b.push('sign-face', toon(a.trim), box(0.14, 1.0, 2.4), xform([s.x + w / 2 + 0.5, 3.4, z + d / 2 + 0.6]));
    b.push('sign-arm', toon(a.metal), cyl(0.05, 0.05, 1.0, 5), xform([s.x + w / 2 + 0.1, 3.95, z + d / 2 + 0.6], [0, 0, Math.PI / 2]));
  }
  roofClutter(b, a, s.x, w * 0.7, d * 0.7, roofH + (gabled ? 0.9 : 0.4), z, seed);
  solids.push({ x: s.x, z, halfW: w / 2 + 0.3, halfD: d / 2 + 0.3 });
}

// ---------------------------------------------------------------------------
// VOLTGRID — tower block
// ---------------------------------------------------------------------------

export function towerBlock(b: Batcher, a: DistrictArt, s: BlockSpec, z: number, solids: { x: number; z: number; halfW: number; halfD: number }[]): void {
  const { w, d, h, seed } = s;
  const wall = pick(a.wall, seed);

  b.push('wall-steel', toon(wall), box(w, h, d), xform([s.x, h / 2, z]));
  // Setback crown: a narrower box on top, which is how real towers read as tall.
  b.push('wall-steel', toon(pick(a.wall, seed + 2)), box(w * 0.68, h * 0.16, d * 0.68), xform([s.x, h + h * 0.08, z]));
  b.push('parapet', toon(a.stone), box(w + 0.2, 0.5, 0.18), xform([s.x, h + 0.25, z + d / 2]));

  // Dense window grid — the concept's towers are all lit graticules.
  const cols = Math.max(3, Math.round(w / 1.7));
  const rows = Math.max(4, Math.round(h / 2.0));
  windowGrid(b, a, s.x, 2.2, w - 0.8, h - 3.4, z + d / 2, cols, rows, seed, 0.42);

  // Neon edge trim: one horizontal along the roofline, two vertical up the corners.
  b.push('neon', toon(a.neon, a.neonGlow), box(w + 0.3, 0.14, 0.14), xform([s.x, h - 0.1, z + d / 2 + 0.1]));
  for (const dx of [-w / 2, w / 2]) {
    b.push('neon', toon(a.neon, a.neonGlow), box(0.14, h - 2.5, 0.14), xform([s.x + dx, (h - 2.5) / 2 + 1.6, z + d / 2 + 0.1]));
  }
  // Horizontal cable runs across the facade.
  for (let i = 0; i < 3; i++) {
    const y = 3.2 + i * (h / 4);
    b.push('cable', toon(a.metal), box(w + 0.5, 0.12, 0.12), xform([s.x, y, z + d / 2 + 0.22]));
  }
  // Wall-mounted AC units, staggered.
  for (let i = 0; i < 4; i++) {
    const x = s.x - w / 2 + 0.9 + rnd(seed, i * 11) * Math.max(0.5, w - 1.8);
    const y = 3.6 + rnd(seed, i * 17 + 3) * Math.max(1, h - 6);
    b.push('ac', toon(a.stone), box(0.7, 0.5, 0.4), xform([x, y, z + d / 2 + 0.2]));
    b.push('ac-grill', toon(a.dark), box(0.55, 0.34, 0.06), xform([x, y, z + d / 2 + 0.42]));
  }

  // Roof: mast with an aircraft light, a dish, and a stair box.
  const mastH = 3.2 + rnd(seed, 31) * 3.4;
  const mx = s.x - w * 0.22;
  b.push('mast', toon(a.metal), cyl(0.09, 0.14, mastH, 6), xform([mx, h + mastH / 2, z - d * 0.1]));
  for (let i = 0; i < 3; i++) {
    b.push('mast', toon(a.metal), box(0.7 - i * 0.16, 0.06, 0.06), xform([mx, h + mastH * (0.4 + i * 0.22), z - d * 0.1]));
  }
  b.push('mast-light', toon('#ff4a5e', 2.2), new THREE.SphereGeometry(0.13, 6, 5), xform([mx, h + mastH + 0.1, z - d * 0.1]));
  const dishX = s.x + w * 0.24;
  b.push('dish-stalk', toon(a.metal), cyl(0.07, 0.07, 0.8, 5), xform([dishX, h + 0.4, z + d * 0.12]));
  b.push('dish', toon(a.stone), new THREE.SphereGeometry(0.75, 10, 6, 0, Math.PI * 2, 0, Math.PI / 3),
    xform([dishX, h + 0.95, z + d * 0.12], [1.9, 0.4, 0]));
  b.push('roof-box', toon(a.metal), box(1.4, 1.1, 1.2), xform([s.x + w * 0.05, h + 0.55, z - d * 0.2]));

  // Vertical neon sign column beside the entrance.
  b.push('sign-col', toon(a.accent, a.neonGlow * 0.6), box(0.5, 3.4, 0.24), xform([s.x + w / 2 - 0.6, 3.0, z + d / 2 + 0.3]));
  doorway(b, a, s.x - w * 0.15, z + d / 2, seed);
  solids.push({ x: s.x, z, halfW: w / 2 + 0.3, halfD: d / 2 + 0.3 });
}

// ---------------------------------------------------------------------------
// HOLLOW — arcade block
// ---------------------------------------------------------------------------

export function arcadeBlock(b: Batcher, a: DistrictArt, s: BlockSpec, z: number, solids: { x: number; z: number; halfW: number; halfD: number }[]): void {
  const { w, d, h, seed } = s;
  b.push('wall-concrete', toon(pick(a.wall, seed)), box(w, h, d), xform([s.x, h / 2, z]));
  bands(b, a, s.x, w, d, h, z);

  // Arcade: a recessed ground floor with arch heads between the piers.
  const arches = Math.max(2, Math.round(w / 3.4));
  const aw = w / arches;
  for (let i = 0; i < arches; i++) {
    const x = s.x - w / 2 + (i + 0.5) * aw;
    b.push('arch-recess', toon(a.dark), box(aw - 0.9, 2.5, 0.5), xform([x, 1.5, z + d / 2 - 0.35]));
    b.push('arch-head', toon(a.stone), new THREE.CylinderGeometry(aw / 2 - 0.45, aw / 2 - 0.45, 0.4, 10, 1, false, 0, Math.PI),
      xform([x, 2.75, z + d / 2 - 0.1], [Math.PI / 2, 0, Math.PI]));
    if (i < arches - 1) b.push('pier', toon(a.stone), box(0.5, 3.0, 0.6), xform([x + aw / 2, 1.5, z + d / 2]));
  }

  windowGrid(b, a, s.x, 4.0, w - 0.8, h - 5.2, z + d / 2, Math.max(2, Math.round(w / 2.6)), Math.max(2, Math.floor((h - 5) / 2.4)), seed, 0.3);

  // Balcony rails on the first upper floor — a strong horizontal at street height.
  b.push('balcony', toon(a.metal), box(w - 0.4, 0.14, 0.7), xform([s.x, 3.9, z + d / 2 + 0.35]));
  for (let i = 0; i < Math.round(w / 0.8); i++) {
    b.push('balcony-rail', toon(a.metal), box(0.07, 0.7, 0.07),
      xform([s.x - w / 2 + 0.4 + i * 0.8, 4.3, z + d / 2 + 0.65]));
  }

  // Rooftop greenhouse: a glass pitched box, the Hollow silhouette.
  b.push('roof-flat', toon(pick(a.roof, seed)), box(w + 0.3, 0.4, d + 0.3), xform([s.x, h + 0.2, z]));
  const ghW = w * 0.5;
  b.push('greenhouse', toon(a.trim), box(ghW, 1.5, d * 0.55), xform([s.x - w * 0.15, h + 0.95, z]));
  b.push('greenhouse-glass', flat('#bfe6d8', 0.55), box(ghW - 0.3, 1.1, d * 0.55 - 0.3), xform([s.x - w * 0.15, h + 0.95, z + 0.02]));
  b.push('greenhouse-roof', toon(pick(a.roof, seed + 2)), box(ghW + 0.3, 0.18, d * 0.55 + 0.3), xform([s.x - w * 0.15, h + 1.78, z], [0, 0, 0.06]));
  for (let i = 0; i < 3; i++) {
    b.push('greenhouse-mullion', toon(a.trim), box(0.09, 1.2, d * 0.55 - 0.2), xform([s.x - w * 0.15 - ghW / 2 + (i + 1) * (ghW / 4), h + 0.95, z]));
  }
  b.push('dish-stalk', toon(a.metal), cyl(0.07, 0.07, 0.7, 5), xform([s.x + w * 0.3, h + 0.75, z - d * 0.15]));
  b.push('dish', toon(a.stone), new THREE.SphereGeometry(0.6, 9, 5, 0, Math.PI * 2, 0, Math.PI / 3),
    xform([s.x + w * 0.3, h + 1.2, z - d * 0.15], [1.8, 0.6, 0]));
  chimney(b, a, s.x - w * 0.36, z - d * 0.22, h + 0.3, seed);

  // Ivy: small green plates pinned to the wall, plus a hanging banner.
  for (let i = 0; i < 9; i++) {
    const x = s.x - w / 2 + rnd(seed, i * 7) * w;
    const y = 3.4 + rnd(seed, i * 13 + 1) * Math.max(1, h - 4.5);
    b.push('ivy', toon(a.leaf), box(0.5 + rnd(seed, i) * 0.7, 0.4 + rnd(seed, i + 5) * 0.6, 0.12),
      xform([x, y, z + d / 2 + 0.08]));
  }
  b.push('banner', toon(a.cloth), box(1.5, 3.2, 0.08), xform([s.x + w * 0.28, h - 2.6, z + d / 2 + 0.16], [0.05, 0, 0]));
  b.push('banner-rod', toon(a.metal), cyl(0.05, 0.05, 1.8, 5), xform([s.x + w * 0.28, h - 0.95, z + d / 2 + 0.2], [0, 0, Math.PI / 2]));
  solids.push({ x: s.x, z, halfW: w / 2 + 0.3, halfD: d / 2 + 0.3 });
}

/** One district's building type, so town.ts can stay about *layout*. */
export function blockFor(district: 'ashflat' | 'voltgrid' | 'hollow'): (b: Batcher, a: DistrictArt, s: BlockSpec, z: number, solids: { x: number; z: number; halfW: number; halfD: number }[]) => void {
  return district === 'voltgrid' ? towerBlock : district === 'hollow' ? arcadeBlock : rowHouse;
}

/**
 * Distant skyline: pure massing with a few lit rows, in the haze colour so it reads as
 * atmosphere rather than as objects. All three concepts have one.
 */
export function skyline(b: Batcher, a: DistrictArt, z: number, count = 30, spread = 340): void {
  // Massing must sit *below* the sky in value or it stops reading as distance and
  // becomes a pink band with dashes in it — which is what the first frames showed.
  const body = shade(a.haze, a.fog, 0.55);
  for (let i = 0; i < count; i++) {
    const x = -spread / 2 + (i * spread) / count + rnd(i, 3) * 8;
    const h = 11 + rnd(i, 7) * 26;
    const w = 7 + rnd(i, 11) * 9;
    b.push('skyline', toon(body), box(w, h, 7), xform([x, h / 2, z]));
    b.push('skyline-cap', toon(body), box(w * 0.5, 1.2, 4), xform([x, h + 0.6, z]));
    // Window specks: small, sparse and dim, so they glitter rather than stripe.
    for (let k = 0; k < Math.floor(h / 3.4); k++) {
      if (rnd(i, k) > 0.34) continue;
      b.push('skyline-lit', toon(a.window, 0.22), box(0.42, 0.16, 0.2),
        xform([x - w * 0.22 + rnd(i, k + 40) * w * 0.44, 2.6 + k * 3.2, z + 3.6]));
    }
  }
}

/** Blend two hex colours. Used to push distant massing toward the fog colour. */
function shade(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, t).getHexString()}`;
}
