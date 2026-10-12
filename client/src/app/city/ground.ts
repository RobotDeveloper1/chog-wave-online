import * as THREE from 'three';
import { SIDEWALK, mulberry32, rectCx, rectCz, type CityLayout, type Court, type Rect } from '@chog/shared';
import type { DistrictArt } from '../art.ts';
import type { ChunkBatcher } from './batch.ts';

/**
 * The ground: asphalt, kerbs, pavements, squares, lawns, water, and every painted line.
 *
 * Pavement is *raised* (15 cm) rather than painted, which is a small lie that does a lot:
 * the kerb catches light on its top edge and throws a contact shadow on the road, and a
 * street reads as a channel between blocks instead of a texture with rectangles on it.
 */

/** Height of a pavement above the road. The player stands on this when they are on it. */
export const KERB = 0.15;

const TILE: Record<string, number> = { asphalt: 14, walk: 6, plaza: 8, grass: 8, dirt: 8, gravel: 8, cobble: 8, floor: 6, water: 8 };

type Tile = keyof typeof TILE;

/** A horizontal rectangle at height y, textured in world units so the grain never stretches. */
export function flat(B: ChunkBatcher, mat: Tile, r: Rect, y: number, color: string | number = 0xffffff): void {
  const ts = TILE[mat] ?? 8;
  B.quad(mat, [r.x0, y, r.z1], [r.x1, y, r.z1], [r.x1, y, r.z0], [r.x0, y, r.z0], [r.x0 / ts, r.z1 / ts, r.x1 / ts, r.z0 / ts], color);
}

/** A thin painted rectangle on the road. */
function paint(B: ChunkBatcher, x0: number, z0: number, x1: number, z1: number, color: string | number, y = 0.03, glow = 0): void {
  B.quad('paint', [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 0, 1, 1], color, glow);
}

function courtMat(kind: Court['kind']): Tile {
  switch (kind) {
    case 'plaza':
    case 'market':
      return 'cobble';
    case 'paved':
      return 'floor';
    case 'garden':
    case 'lawn':
      return 'grass';
    case 'yard':
      return 'gravel';
    case 'track':
      return 'gravel';
    case 'water':
      return 'water';
    default:
      return 'dirt';
  }
}

const inside = (a: Rect, b: Rect): Rect => ({
  x0: Math.max(a.x0, b.x0),
  z0: Math.max(a.z0, b.z0),
  x1: Math.min(a.x1, b.x1),
  z1: Math.min(a.z1, b.z1),
});

export function buildGround(B: ChunkBatcher, layout: CityLayout, art: DistrictArt): void {
  const { extent } = layout;
  const rand = mulberry32(layout.sector.length * 4093);
  const kerbColor = art.stone;

  // The apron under everything, a little past the zone so the edge is never a cliff.
  flat(B, 'walk', { x0: extent.x0 - 8, z0: extent.z0 - 8, x1: extent.x1 + 8, z1: extent.z1 + 8 }, 0.0);

  // Roads.
  for (const s of layout.streets) flat(B, 'asphalt', s.rect, 0.012);

  // Blocks: a raised pavement slab, its kerb, then each court's surface on top.
  for (const b of layout.blocks) {
    flat(B, 'walk', b.rect, KERB);
    const { x0, z0, x1, z1 } = b.rect;
    // Kerb faces: vertical quads, lit differently on each side by the normal alone.
    B.quad('solid', [x0, 0, z1], [x1, 0, z1], [x1, KERB, z1], [x0, KERB, z1], [0, 0, 1, 1], kerbColor);
    B.quad('solid', [x1, 0, z0], [x0, 0, z0], [x0, KERB, z0], [x1, KERB, z0], [0, 0, 1, 1], kerbColor);
    B.quad('solid', [x1, 0, z1], [x1, 0, z0], [x1, KERB, z0], [x1, KERB, z1], [0, 0, 1, 1], kerbColor);
    B.quad('solid', [x0, 0, z0], [x0, 0, z1], [x0, KERB, z1], [x0, KERB, z0], [0, 0, 1, 1], kerbColor);
    // A thin highlight along the kerb edge, which is what makes it read as a kerb.
    B.box('solid', (x0 + x1) / 2, KERB + 0.005, z1 - 0.12, x1 - x0, 0.012, 0.24, '#d8cfc0', 0, { skipBottom: true });
    B.box('solid', (x0 + x1) / 2, KERB + 0.005, z0 + 0.12, x1 - x0, 0.012, 0.24, '#d8cfc0', 0, { skipBottom: true });
    B.box('solid', x1 - 0.12, KERB + 0.005, (z0 + z1) / 2, 0.24, 0.012, z1 - z0, '#d8cfc0', 0, { skipBottom: true });
    B.box('solid', x0 + 0.12, KERB + 0.005, (z0 + z1) / 2, 0.24, 0.012, z1 - z0, '#d8cfc0', 0, { skipBottom: true });
  }

  const placed: Rect[] = [];
  for (const c of layout.courts) {
    if (c.kind === 'water') {
      water(B, c, art);
      continue;
    }
    // A court inside another court is a second skin on the same plane unless it stands a
    // centimetre proud per layer: coplanar quads z-fight, and the fight crawls across the
    // surface as you walk, which reads as the texture flickering.
    let depth = 0;
    for (const p of placed) {
      if (Math.min(c.rect.x1, p.x1) - Math.max(c.rect.x0, p.x0) > 0.2 && Math.min(c.rect.z1, p.z1) - Math.max(c.rect.z0, p.z0) > 0.2) depth++;
    }
    placed.push(c.rect);
    const mat = courtMat(c.kind);
    const y = KERB + 0.02 + depth * 0.01;
    flat(B, mat, c.rect, y);
    if (c.kind === 'plaza') inlay(B, c, art);
    if (c.kind === 'track') rails(B, c, art, y);
    if (c.kind === 'allotment') beds(B, c, art, rand);
    if (c.kind === 'lawn' || c.kind === 'garden') paths(B, c, art, rand);
  }

  markings(B, layout, art, rand);
}

/**
 * A square is *designed*, not just paved: a border, and two raised rings of stone round the
 * middle, so from above it reads as a place with a centre.
 *
 * The rings used to be flat paint, and flat white paint on dark cobbles is the one thing that
 * reads as a decal dropped on the floor from every angle. A ring that stands ten centimetres
 * proud catches light on its top edge and throws a shadow on its inner face, which is the
 * difference between a painted circle and a kerb you could sit on.
 */
function inlay(B: ChunkBatcher, c: Court, art: DistrictArt): void {
  const { x0, z0, x1, z1 } = c.rect;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const top = KERB + 0.45;
  // Plain district stone, not a lightened cream: a ring brighter than everything around it
  // glares from above and reads as paint however thick it is.
  const trim = mixStone(art.stone, 0.0);
  const skirt = mixStone(art.stone, -0.34);
  const t = 0.4;
  const m = 1.1;
  // The border is a low wall, not a painted line: it has a top you could set a cup on.
  for (const [bx, bz, bw, bd] of [
    [cx, z0 + m, x1 - x0 - m * 2, t],
    [cx, z1 - m, x1 - x0 - m * 2, t],
    [x0 + m, cz, t, z1 - z0 - m * 2],
    [x1 - m, cz, t, z1 - z0 - m * 2],
  ] as const) {
    B.box('solid', bx, KERB + 0.16, bz, bw, 0.34, bd, trim, 0, { skipBottom: true });
  }
  const r = Math.min(x1 - x0, z1 - z0) / 2 - 3;
  if (r < 5) return;
  // A seat wall: forty-five centimetres of stone you could sit on. At this height a flat ring
  // is indistinguishable from paint; a wall throws a shadow on its own inner face and reads
  // as architecture from every angle.
  const ring = (ri: number, ro: number): void => {
    B.geo('solid', new THREE.RingGeometry(ri, ro, 56), new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(cx, top, cz), trim);
    B.geo('solid', new THREE.CylinderGeometry(ro, ro, top - KERB, 56, 1, true), new THREE.Matrix4().makeTranslation(cx, (top + KERB) / 2, cz), skirt);
    B.geo('solid', new THREE.CylinderGeometry(ri, ri, top - KERB, 56, 1, true), new THREE.Matrix4().makeTranslation(cx, (top + KERB) / 2, cz), skirt);
  };
  ring(r * 0.5, r * 0.5 + 0.5);
  ring(r * 0.8, r * 0.8 + 0.5);
  // Spokes between the rings, eight of them: low ribs, a compass rose laid into the ground.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const mid = r * 0.65;
    B.box('solid', cx + Math.cos(a) * mid, KERB + 0.06, cz + Math.sin(a) * mid, 0.34, 0.14, r * 0.24, trim, 0, { rot: -a + Math.PI / 2, skipBottom: true });
  }
}

/** Lighten (+) or darken (−) the district stone, for the kerb top and its shaded skirts. */
function mixStone(hex: string, t: number): string {
  const c = new THREE.Color(hex);
  return '#' + (t >= 0 ? c.lerp(new THREE.Color('#ffffff'), t) : c.lerp(new THREE.Color('#000000'), -t)).getHexString();
}

function water(B: ChunkBatcher, c: Court, art: DistrictArt): void {
  const { x0, z0, x1, z1 } = c.rect;
  const y = KERB + 0.1;
  flat(B, 'water', c.rect, y);
  // Coping: a stone lip all round, standing proud of the water and the pavement.
  const t = 0.34;
  const h = 0.34;
  const top = KERB + h;
  B.box('solid', (x0 + x1) / 2, top - h / 2 + KERB * 0.3, z0 - t / 2, x1 - x0 + t * 2, h, t, art.stone, 0, { skipBottom: true });
  B.box('solid', (x0 + x1) / 2, top - h / 2 + KERB * 0.3, z1 + t / 2, x1 - x0 + t * 2, h, t, art.stone, 0, { skipBottom: true });
  B.box('solid', x0 - t / 2, top - h / 2 + KERB * 0.3, (z0 + z1) / 2, t, h, z1 - z0, art.stone, 0, { skipBottom: true });
  B.box('solid', x1 + t / 2, top - h / 2 + KERB * 0.3, (z0 + z1) / 2, t, h, z1 - z0, art.stone, 0, { skipBottom: true });
  // A bridge across, if the court declares a strip to walk on.
  for (const w of c.walk ?? []) {
    const horizontal = w.x1 - w.x0 < w.z1 - w.z0;
    B.box('solid', rectCx(w), KERB + 0.28, rectCz(w), w.x1 - w.x0, 0.2, w.z1 - w.z0, art.stone);
    // Rails along both edges of the span.
    for (const s of [-1, 1]) {
      if (horizontal) {
        B.box('solid', rectCx(w) + (s * (w.x1 - w.x0)) / 2, KERB + 0.95, rectCz(w), 0.14, 0.14, w.z1 - w.z0, art.metal);
        for (let z = w.z0 + 0.6; z < w.z1; z += 1.8) B.box('solid', rectCx(w) + (s * (w.x1 - w.x0)) / 2, KERB + 0.65, z, 0.1, 0.7, 0.1, art.metal);
      } else {
        B.box('solid', rectCx(w), KERB + 0.95, rectCz(w) + (s * (w.z1 - w.z0)) / 2, w.x1 - w.x0, 0.14, 0.14, art.metal);
        for (let x = w.x0 + 0.6; x < w.x1; x += 1.8) B.box('solid', x, KERB + 0.65, rectCz(w) + (s * (w.z1 - w.z0)) / 2, 0.1, 0.7, 0.1, art.metal);
      }
    }
  }
}

/** Two steel rails and the sleepers under them, running the length of the court. */
function rails(B: ChunkBatcher, c: Court, art: DistrictArt, y: number): void {
  const { x0, z0, x1, z1 } = c.rect;
  const cz = (z0 + z1) / 2;
  for (const dz of [-2.3, 2.3]) {
    for (const o of [-0.72, 0.72]) {
      B.box('solid', (x0 + x1) / 2, y + 0.11, cz + dz + o, x1 - x0, 0.16, 0.14, '#7a7570', 0, { skipBottom: true });
    }
    for (let x = x0 + 1; x < x1; x += 1.4) B.box('solid', x, y + 0.04, cz + dz, 0.4, 0.1, 2.3, '#4a3a2c', 0, { skipBottom: true });
  }
  void art;
}

/** Crop rows in an allotment: dark furrows with a green line down each. */
function beds(B: ChunkBatcher, c: Court, art: DistrictArt, rand: () => number): void {
  const { x0, z0, x1, z1 } = c.rect;
  const y = KERB + 0.04;
  for (let z = z0 + 3; z < z1 - 2; z += 2.6) {
    if (rand() < 0.2) continue;
    B.box('solid', (x0 + x1) / 2, y, z, x1 - x0 - 5, 0.1, 1.2, '#3a2a1c', 0, { skipBottom: true });
    B.box('foliage', (x0 + x1) / 2, y + 0.3, z, x1 - x0 - 5.4, 0.55, 0.5, rand() > 0.5 ? art.leaf : '#7fa04a', 0, { skipBottom: true });
  }
}

/** Gravel paths across a lawn, so the park has somewhere you are meant to walk. */
function paths(B: ChunkBatcher, c: Court, art: DistrictArt, rand: () => number): void {
  const { x0, z0, x1, z1 } = c.rect;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const y = KERB + 0.03;
  const col = '#a89878';
  const wide = 2.4;
  B.box('solid', cx, y, cz, wide, 0.04, z1 - z0, col, 0, { skipBottom: true });
  B.box('solid', cx, y, cz, x1 - x0, 0.04, wide, col, 0, { skipBottom: true });
  void art;
  void rand;
}

/** Lane lines, crosswalks and the rest of the paint. */
function markings(B: ChunkBatcher, layout: CityLayout, art: DistrictArt, rand: () => number): void {
  const white = art.paint;
  const yellow = '#f3c64a';
  const ints = layout.intersections;
  const hot = (x: number, z: number, pad: number): boolean => ints.some((i) => x > i.x0 - pad && x < i.x1 + pad && z > i.z0 - pad && z < i.z1 + pad);

  for (const s of layout.streets) {
    const r = s.rect;
    const horizontal = s.axis === 'x';
    const len = horizontal ? r.x1 - r.x0 : r.z1 - r.z0;
    const mid = horizontal ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
    const lane = s.main ? 0.14 : 0.16;
    for (let t = 1.5; t < len - 3.4; t += s.main ? 5.2 : 4.4) {
      const a = (horizontal ? r.x0 : r.z0) + t;
      const b = a + (s.main ? 3 : 2.2);
      const cx = horizontal ? (a + b) / 2 : mid;
      const cz = horizontal ? mid : (a + b) / 2;
      if (hot(cx, cz, 4.6)) continue;
      if (s.main) {
        // A double yellow centre line on the main roads.
        for (const o of [-0.32, 0.32]) {
          if (horizontal) paint(B, a, mid + o - lane / 2, b, mid + o + lane / 2, yellow);
          else paint(B, mid + o - lane / 2, a, mid + o + lane / 2, b, yellow);
        }
      } else if (horizontal) paint(B, a, mid - lane / 2, b, mid + lane / 2, white);
      else paint(B, mid - lane / 2, a, mid + lane / 2, b, white);
    }
    // Edge lines, solid, a metre off the kerb on the wide streets.
    if (s.width >= 14) {
      for (const o of [-(s.width / 2 - 1.1), s.width / 2 - 1.1]) {
        for (let t = 0; t < len; t += 12) {
          const a = (horizontal ? r.x0 : r.z0) + t + 2;
          const b = Math.min(a + 8, (horizontal ? r.x1 : r.z1) - 1);
          const cx = horizontal ? (a + b) / 2 : mid;
          const cz = horizontal ? mid : (a + b) / 2;
          if (hot(cx, cz, 4.8)) continue;
          if (horizontal) paint(B, a, mid + o - 0.07, b, mid + o + 0.07, white);
          else paint(B, mid + o - 0.07, a, mid + o + 0.07, b, white);
        }
      }
    }
  }

  // Zebra crossings on every arm of every intersection that has one.
  const stripe = 0.5;
  const gap = 0.55;
  for (const i of ints) {
    const w = i.x1 - i.x0;
    const d = i.z1 - i.z0;
    const ext = layout.extent;
    const arms: { side: 'N' | 'S' | 'W' | 'E'; ok: boolean }[] = [
      { side: 'N', ok: i.z0 > ext.z0 + 0.5 },
      { side: 'S', ok: i.z1 < ext.z1 - 0.5 },
      { side: 'W', ok: i.x0 > ext.x0 + 0.5 },
      { side: 'E', ok: i.x1 < ext.x1 - 0.5 },
    ];
    for (const a of arms) {
      if (!a.ok) continue;
      if (a.side === 'N' || a.side === 'S') {
        const z = a.side === 'N' ? i.z0 - 2.1 : i.z1 + 0.1;
        for (let x = i.x0 + 0.5; x < i.x1 - 0.5; x += stripe + gap) paint(B, x, z, Math.min(x + stripe, i.x1 - 0.4), z + 2, white, 0.032);
      } else {
        const x = a.side === 'W' ? i.x0 - 2.1 : i.x1 + 0.1;
        for (let z = i.z0 + 0.5; z < i.z1 - 0.5; z += stripe + gap) paint(B, x, z, x + 2, Math.min(z + stripe, i.z1 - 0.4), white, 0.032);
      }
    }
    void w;
    void d;
  }

  // Manholes and drains, scattered along the roads: the small things that say "used".
  for (const s of layout.streets) {
    const r = s.rect;
    const n = Math.floor((s.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0) / 38);
    for (let k = 0; k < n; k++) {
      const t = 14 + k * 38 + rand() * 12;
      const x = s.axis === 'x' ? r.x0 + t : (r.x0 + r.x1) / 2 + (rand() - 0.5) * s.width * 0.4;
      const z = s.axis === 'x' ? (r.z0 + r.z1) / 2 + (rand() - 0.5) * s.width * 0.4 : r.z0 + t;
      if (hot(x, z, 6)) continue;
      B.geo('paint', new THREE.CylinderGeometry(0.62, 0.62, 0.04, 14), new THREE.Matrix4().makeTranslation(x, 0.03, z), art.metal);
      B.geo('paint', new THREE.CylinderGeometry(0.7, 0.7, 0.03, 14), new THREE.Matrix4().makeTranslation(x, 0.026, z), '#14101a');
    }
  }
  void inside;
  void SIDEWALK;
}
