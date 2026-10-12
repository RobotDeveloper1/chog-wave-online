import * as THREE from 'three';
import { Batcher, box, cyl, pick, unlitMat, xform } from './geo.ts';
import { DISTRICTS, roadTexture, slabTexture, toon, type DistrictArt } from './art.ts';
import { blockFor, skyline, type BlockSpec } from './blocks.ts';
import {
  bench,
  bin,
  billboardFrame,
  bollards,
  bush,
  constructionFence,
  crateStack,
  hydrant,
  lamp,
  overpass,
  planter,
  signalPole,
  stairRun,
  streetDrain,
  tree,
  vending,
} from './props.ts';
import type { SectorId } from '@chog/shared';

/**
 * The street, per district, built to match the four concept paintings.
 *
 * What the camera sees is fixed: it sits above and in front (+z), looks down at a
 * pitch, and the street runs left-right along x. That single constraint decides the
 * whole layout — the *far* side carries the buildings because they can tower without
 * blocking anything, and the *near* side can only carry things below lamp height.
 *
 * Each district is a different block plan, not a palette swap: Ashflat is a row of
 * two-to-three-storey houses with shops, Voltgrid is a canyon of tower blocks over wet
 * asphalt, Hollow is arcade-fronted concrete with greenhouses and a half-built site.
 */

const STREET = { halfWidth: 6.2, length: 96 };
const FAR_KERB = -(STREET.halfWidth + 1.1);
const FAR_WALK = -(STREET.halfWidth + 4.6);
const NEAR_KERB = STREET.halfWidth + 1.1;
const NEAR_WALK = STREET.halfWidth + 4.6;

export interface Interactable {
  kind: 'shop' | 'heal' | 'board' | 'station' | 'gate' | 'brother' | 'telemetry' | 'dungeon';
  label: string;
  x: number;
  z: number;
  hint: string;
}

export interface NpcSpec {
  name: string;
  line: string;
  x: number;
  z: number;
  tribe: 'burn' | 'frost' | 'volt' | 'wave' | 'prism' | 'void';
}

export interface TownLayout {
  group: THREE.Group;
  solids: { x: number; z: number; halfW: number; halfD: number }[];
  interactables: Interactable[];
  spawn: { x: number; z: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  stairs: { x: number; z: number }[];
  /** Passable gaps in the building row, and how deep the yard behind them goes. */
  alleys: { x: number; z: number; z0: number; z1: number; name: string }[];
  /** The colour script this town was built with, so the stage can match its sky. */
  art: DistrictArt;
}

/**
 * Block plans. Widths and heights deliberately do not repeat on a clean interval —
 * a rhythm the eye can predict is the difference between a street and a barcode.
 */
interface Plan {
  specs: (i: number) => BlockSpec;
  count: number;
  /** x position of the i-th block's left edge. */
  x0: number;
  /**
   * Block pitch, and how far back the facade line sits. A shared building line is why
   * the tower district filled the whole frame: 30-unit blocks standing 14 units from
   * the kerb have no sky behind them. Canyons need to be pushed back and kept lower
   * than they look in a wide painting.
   */
  pitch: number;
  line: number;
  /** Which blocks are shops (ground floor open to the street). */
  shopAt: Set<number>;
  signs: string[];
  /**
   * Block indices after which the row opens into an alley. A street you cannot leave
   * is a backdrop, so each district gets two: one wide enough to walk through to the
   * yard behind the shops, and one that dead-ends behind a fence.
   */
  alleys: number[];
}

const PLANS: Record<SectorId, Plan> = {
  ashflat: {
    count: 9,
    x0: -46,
    // Widths match the pitch so the houses share party walls, which is what a row of
    // them actually is; the earlier gaps made each house look like a detached box.
    pitch: 10.2,
    line: 8.4,
    shopAt: new Set([0, 1, 2, 3, 4, 5, 7]),
    signs: ['CHIP SHOP', 'SIGNAL LANE', 'WAVE STATION', 'TRIBE HALL', 'TERMINAL', 'ZONE EDGE', 'NOODLE'],
    alleys: [2, 5],
    specs: (i) => ({
      x: 0,
      // 8.6 pitch with a 7.4-9.8 width leaves real gaps and party-wall joins.
      w: 9.4 + ((i * 5) % 4) * 0.26,
      d: 6.4 + ((i * 3) % 3) * 0.9,
      h: i % 4 === 3 ? 10.4 : 6.6 + ((i * 7) % 3) * 1.4,
      seed: i * 17 + 3,
      shop: true,
    }),
  },
  voltgrid: {
    count: 7,
    x0: -44,
    pitch: 13.4,
    line: 15.5,
    shopAt: new Set([1, 3, 5]),
    signs: ['ATLAS FEED', 'DATA CORE', 'GRID BANK', 'RELAY 07', 'NODE BAR', 'SPICE'],
    alleys: [1, 4],
    specs: (i) => ({
      x: 0,
      w: 12.4 + ((i * 4) % 4) * 0.9,
      d: 8.5 + ((i * 5) % 3) * 1.3,
      h: 13 + ((i * 11) % 5) * 2.4,
      seed: i * 23 + 11,
      shop: i % 2 === 1,
    }),
  },
  hollow: {
    count: 7,
    x0: -45,
    pitch: 13.0,
    line: 10.5,
    shopAt: new Set([0, 2, 4, 6]),
    signs: ['SAGE DISTRICT', 'ACACIA MARKET', 'CLINIC', 'ARCH 06', 'GREENHOUSE', 'YARD'],
    alleys: [3, 5],
    specs: (i) => ({
      x: 0,
      w: 12.0 + ((i * 3) % 3) * 0.9,
      d: 8.2 + ((i * 7) % 3) * 1.1,
      h: 8.6 + ((i * 9) % 4) * 1.9,
      seed: i * 31 + 7,
      shop: i % 2 === 0,
    }),
  },
};

export function artFor(sector: SectorId): DistrictArt {
  return DISTRICTS[sector];
}

/** The six doors that mean something, positioned wherever the plan puts their block. */
const DOORS: { kind: Interactable['kind']; label: string; block: number; hint: string }[] = [
  { kind: 'shop', label: 'CHIP SHOP', block: 0, hint: 'E  buy, sell, resupply' },
  { kind: 'heal', label: 'SIGNAL LANE', block: 1, hint: 'E  restore field integrity' },
  { kind: 'station', label: 'WAVE STATION', block: 2, hint: 'E  pulse into the wave' },
  { kind: 'brother', label: 'TRIBE HALL', block: 3, hint: 'E  report for the war' },
  { kind: 'telemetry', label: 'TERMINAL', block: 4, hint: 'E  read the album' },
  { kind: 'dungeon', label: 'FOLD GATE', block: 6, hint: 'E  enter a data area' },
];

export function buildTown(sector: SectorId): TownLayout {
  const a = DISTRICTS[sector];
  const plan = PLANS[sector];
  const b = new Batcher();
  const solids: TownLayout['solids'] = [];
  const build = blockFor(sector);

  // ---- ground: road, both walks, the verge behind the buildings
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(STREET.length + 40, STREET.halfWidth * 2 + 2.4),
    new THREE.MeshBasicMaterial({ map: roadTexture(a.asphalt, a.wet, a.paint, sector.length) }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;

  // The ground behind the shop row. It must not reach the horizon, or it fills the
  // sky band; the skyline and the sky plane take over from there.
  const verge = new THREE.Mesh(
    new THREE.PlaneGeometry(STREET.length + 120, 62),
    new THREE.MeshBasicMaterial({ map: roadTexture(a.dark, false, a.paint, 3, false) }),
  );
  verge.rotation.x = -Math.PI / 2;
  verge.position.set(0, -0.02, -26);

  const walkFar = new THREE.Mesh(
    new THREE.PlaneGeometry(STREET.length + 30, 7.2),
    new THREE.MeshBasicMaterial({ map: slabTexture(a.pavement, a.wet) }),
  );
  walkFar.rotation.x = -Math.PI / 2;
  walkFar.position.set(0, 0.035, FAR_WALK + 1.4);

  const walkNear = new THREE.Mesh(walkFar.geometry, walkFar.material);
  walkNear.position.set(0, 0.035, NEAR_WALK + 1.4);

  b.group.add(verge, road, walkFar, walkNear);

  // ---- painted road: centre dashes, lane lines, three crossings, stop bars
  const paint = unlitMat(a.paint);
  for (let i = -8; i <= 8; i++) {
    b.push('paint', paint, plane(3.0, 0.26), xform([i * 6.0, 0.05, 0], [-Math.PI / 2, 0, 0]));
  }
  for (const side of [-1, 1]) {
    for (let i = -9; i <= 9; i++) {
      b.push('paint', paint, plane(1.9, 0.14),
        xform([i * 5.4, 0.05, side * 3.1], [-Math.PI / 2, 0, 0]));
    }
  }
  for (const cx of [-28, 0, 28]) {
    for (let i = 0; i < 7; i++) {
      b.push('paint', paint, plane(1.15, 0.46),
        xform([cx, 0.06, -STREET.halfWidth + 0.6 + i * 1.85], [-Math.PI / 2, 0, 0]));
    }
    b.push('paint', paint, plane(0.36, STREET.halfWidth * 1.7), xform([cx - 4.6, 0.055, 0], [-Math.PI / 2, 0, 0]));
  }

  // ---- kerbs, with a face so the pavement has an edge
  for (const side of [-1, 1]) {
    b.push('kerb', toonKerb(a), box(STREET.length + 30, 0.3, 0.6),
      xform([0, 0.15, side * (STREET.halfWidth + 1.35)]));
  }

  // ---- the block row
  // Cumulative placement, because an alley is a *gap* and a fixed pitch cannot make
  // one: each block starts where the last ended, plus a party-wall join, plus a wide
  // mouth at the indices the plan calls an alley.
  const placed: { x: number; spec: BlockSpec; z: number }[] = [];
  const alleys: { x: number; z: number; z0: number; z1: number; name: string }[] = [];
  let cursor = plan.x0;
  for (let i = 0; i < plan.count; i++) {
    const spec = plan.specs(i);
    const withX = { ...spec, x: cursor + spec.w / 2, shop: plan.shopAt.has(i) };
    const z = -(STREET.halfWidth + plan.line) - withX.d / 2;
    build(b, a, withX, z, solids);
    placed.push({ x: withX.x, spec: withX, z });
    cursor += spec.w;
    const isAlley = plan.alleys.includes(i) && i < plan.count - 1;
    const gap = isAlley ? 3.6 : 0.35;
    if (isAlley) {
      const ax = cursor + gap / 2;
      alleys.push({ x: ax, z, z0: -(STREET.halfWidth + 1.4), z1: z - withX.d / 2 - 5.5, name: `alley-${i}` });
      alley(b, a, ax, z, withX.d, i);
    }
    cursor += gap;
  }

  // The rear yard, deliberately invisible from the street: you find it by walking
  // into an alley, which is the point of making the building row non-continuous.
  const yardZ = -(STREET.halfWidth + plan.line) - 15;
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(STREET.length + 40, 24),
    new THREE.MeshBasicMaterial({ map: roadTexture(a.dark, false, a.paint, 9, false) }),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(0, 0.02, yardZ);
  b.group.add(yard);

  // ---- backscape: a second, further row so the street has depth behind the shops
  for (let i = 0; i < 6; i++) {
    const spec: BlockSpec = {
      x: -34 + i * 14.5,
      w: 9 + ((i * 5) % 5),
      d: 8,
      // Kept lower than the front row on purpose: if the backscape tops the shops it
      // fills the frame and the sky band that defines each concept never appears.
      h: sector === 'voltgrid' ? 26 + ((i * 7) % 5) * 6 : 13 + ((i * 7) % 4) * 1.6,
      seed: i * 41 + 19,
    };
    build(b, a, spec, -(STREET.halfWidth + plan.line) - 17 - spec.d / 2, solids);
  }
  skyline(b, a, -84, 30, 360);

  // The east board is static scenery; the live market ticker is a separate textured
  // mesh (billboard.ts) and stands at the west end, where a second frame would clash.
  billboardFrame(b, 34, FAR_KERB - 2.4, 8.0, 4.4, a);

  // ---- overpass across the west half with two stair runs
  const deckY = sector === 'ashflat' ? 5.9 : 6.8;
  overpass(b, -46, -18, FAR_KERB + 1.6, deckY, a);
  for (const sx of [-44, -30, -18]) {
    stairRun(b, sx, FAR_KERB + 2.8, FAR_KERB - 0.4, deckY, a);
    solids.push({ x: sx, z: FAR_KERB + 1.2, halfW: 1.3, halfD: 2.4 });
  }

  // ---- the near side: everything below lamp height, or it blocks the street
  bollards(b, Array.from({ length: 24 }, (_, i) => -46 + i * 4), NEAR_KERB + 0.5, a.metal, a.neon);
  for (let i = 0; i < 11; i++) {
    const x = -46 + i * 9.2;
    lamp(b, x, NEAR_WALK + 0.9, a, true);
    if (i % 2 === 0) planter(b, x + 3.1, NEAR_WALK + 1.9, a);
    if (i % 3 === 1) bench(b, x + 4.8, NEAR_WALK + 2.4, pick(a.wall, i), a.metal, Math.PI);
    if (i % 4 === 2) bin(b, x - 2.4, NEAR_WALK + 1.2, a.metal);
    if (i % 5 === 3) hydrant(b, x + 1.6, NEAR_KERB + 1.5);
  }
  for (const cx of [-28, 0, 28]) {
    signalPole(b, cx - 2.2, NEAR_KERB + 0.4, a);
    streetDrain(b, cx + 3.4, 2.2, a);
  }
  for (const [mx, mz] of [[-9, 1.9], [17, -2.4], [5, 3.1], [-33, -3.2]] as const) {
    b.push('manhole', toon(a.dark), cyl(0.62, 0.62, 0.06, 12), xform([mx, 0.055, mz]));
    b.push('manhole-ring', toon(a.metal), cyl(0.7, 0.7, 0.04, 12), xform([mx, 0.045, mz]));
  }

  // ---- three plazas so the street reads as rooms
  for (const px of [-22, 8, 36]) {
    for (let i = 0; i < 3; i++) tree(b, px + i * 2.8 - 2.8, NEAR_WALK + 4.2 + (i % 2) * 1.5, a, px + i);
    bush(b, px - 4.2, NEAR_WALK + 5.0, a, 0.95);
    bush(b, px + 4.4, NEAR_WALK + 3.6, a, 0.75);
    bench(b, px, NEAR_WALK + 6.0, pick(a.wall, 1), a.metal, Math.PI);
    solids.push({ x: px, z: NEAR_WALK + 4.4, halfW: 3.8, halfD: 1.7 });
  }

  // ---- district-specific ground detail, the parts only this concept has
  if (sector === 'ashflat') {
    for (const [i, p] of placed.entries()) {
      if (i % 2) continue;
      crateStack(b, p.x + p.spec.w / 2 - 0.6, -(STREET.halfWidth + plan.line) + 1.6, a, i * 13);
    }
    vending(b, -31, NEAR_WALK + 0.6, a, 0);
    vending(b, 12, NEAR_WALK + 0.6, a, 0);
  } else if (sector === 'voltgrid') {
    // A wet street needs the light sources at the kerb to be visible in the floor,
    // which the road texture already smears; these add the physical cause.
    for (const x of [-30, -6, 18]) vending(b, x, FAR_KERB - 0.6, a, 0);
    for (let i = 0; i < 6; i++) {
      b.push('barrier', toonKerb(a), box(1.6, 0.9, 0.16), xform([-44 + i * 2.2, 0.45, NEAR_WALK + 5.6]));
    }
  } else {
    constructionFence(b, -47, -36, NEAR_WALK + 3.4, a);
    for (let i = 0; i < 8; i++) tree(b, 38 + (i % 3) * 3.4, -3 + i * 1.8, a, i * 5 + 2);
    for (let i = 0; i < 6; i++) bush(b, 35 + i * 2.6, NEAR_WALK + 5.2, a, 0.6 + (i % 3) * 0.22);
    vending(b, 2, NEAR_WALK + 0.6, a, 0);
  }

  const group = b.build();

  const interactables: Interactable[] = DOORS.filter((d) => d.block < placed.length).map((d) => {
    const p = placed[d.block]!;
    return {
      kind: d.kind,
      label: sector === 'voltgrid' && d.kind === 'shop' ? 'CHIP KIOSK' : d.label,
      x: p.x,
      z: -(STREET.halfWidth + plan.line) + 1.2,
      hint: d.hint,
    };
  });
  interactables.push({ kind: 'board', label: 'QUEST BOARD', x: 2, z: NEAR_WALK - 0.4, hint: 'E  read the tide' });

  return {
    group,
    solids,
    interactables,
    spawn: { x: -2, z: 0 },
    // The street bounds used to stop at the kerb, which made every door and every
    // alley scenery. The yard's rear wall is the backscape row's own collision.
    bounds: { minX: -(STREET.length / 2 + 4), maxX: STREET.length / 2 + 4, minZ: yardZ - 9, maxZ: NEAR_WALK + 7.4 },
    stairs: [{ x: -44, z: FAR_KERB + 1.2 }, { x: -30, z: FAR_KERB + 1.2 }, { x: -18, z: FAR_KERB + 1.2 }],
    alleys,
    art: a,
  };
}

// ---------------------------------------------------------------------------

/**
 * An alley: a passage between two blocks, built so it reads as somewhere you can go
 * rather than a gap in a texture. Bins, a dumpster, drainpipes, a graffiti panel,
 * puddles and a lamp — and at the back either a chain-link closure or an opening into
 * the yard, alternating so the two alleys of a district are not the same place twice.
 */
function alley(
  b: Batcher,
  a: DistrictArt,
  x: number,
  z: number,
  depth: number,
  index: number,
): void {
  const open = index % 2 === 0;
  const z0 = -(STREET.halfWidth + 1.2);
  const z1 = z - depth / 2 - (open ? 6.5 : 1.2);
  const len = Math.abs(z1 - z0);
  const mid = (z0 + z1) / 2;

  b.push('alley-floor', toon(a.dark), box(3.4, 0.06, len), xform([x, 0.035, mid]));
  // The flanking walls are the neighbouring blocks' own sides; a thin render keeps the
  // passage from looking like it runs through open air.
  for (const dx of [-1.8, 1.8]) {
    b.push('alley-wall', toon(pick(a.wall, index + 1)), box(0.22, 5.4, len), xform([x + dx, 2.7, mid]));
    for (let k = 0; k < 4; k++) {
      b.push('alley-pipe', toon(a.metal), cyl(0.08, 0.08, 4.8, 6),
        xform([x + dx * 0.9, 2.4, z0 - 1.4 - (k * len) / 5]));
    }
  }
  for (let k = 0; k < 3; k++) {
    b.push('alley-bin', toon(k === 0 ? a.accent : a.metal), box(0.8, 0.95, 0.7), xform([x - 1.2, 0.48, z0 - 1.6 - k * 1.1]));
  }
  b.push('dumpster', toon(pick(a.roof, index)), box(1.7, 1.25, 2.6), xform([x + 0.8, 0.63, z0 - 5.2]));
  b.push('dumpster-lid', toon(a.metal), box(1.8, 0.14, 2.7), xform([x + 0.8, 1.32, z0 - 5.2], [0.06, 0, 0]));

  b.push('graffiti', toon(a.trim), box(0.06, 1.3, 2.2), xform([x + 1.68, 1.7, z0 - 3.0]));
  b.push('graffiti-2', toon(a.neon), box(0.05, 0.5, 1.5), xform([x + 1.71, 1.9, z0 - 3.2]));
  b.push('ac', toon(a.stone), box(0.6, 0.5, 0.45), xform([x - 1.5, 3.4, z0 - 4.4]));

  // Puddles: the alley is where rain has nowhere to go.
  for (let k = 0; k < 3; k++) {
    b.push('puddle', toon(a.dark, a.wet ? 0.3 : 0), box(1.0 + k * 0.3, 0.02, 0.6 + k * 0.2),
      xform([x - 0.4 + k * 0.5, 0.07, z0 - 2.6 - k * 2.4]));
  }

  if (!open) {
    b.push('alley-gate', toon(a.metal, 0.12), box(3.3, 2.1, 0.07), xform([x, 1.05, z1]));
    b.push('alley-gate-bar', toon(a.accent), box(3.3, 0.2, 0.12), xform([x, 0.16, z1]));
    for (const dx of [-1.5, 1.5]) {
      b.push('alley-gate-post', toon(a.metal), box(0.14, 2.3, 0.14), xform([x + dx, 1.15, z1]));
    }
    crateStack(b, x - 0.6, z1 + 1.2, a, index * 7);
    // A dead end still has to stop the player, not just look like it does.
    return;
  }
  for (const dx of [-1.95, 1.95]) {
    b.push('yard-wall', toon(pick(a.wall, index + 3)), box(0.5, 3.6, 5.6), xform([x + dx, 1.8, z1 + 2.8]));
  }
  lamp(b, x + 1.15, z1 + 3.4, a, false);
  hydrant(b, x - 1.05, z1 + 4.6);
  bin(b, x + 0.35, z1 + 5.4, a.metal);
}

/** Kerb and cover stone. Cached by colour in art.ts, because a fresh material per
 *  call would split every batch and undo the whole point of the Batcher. */
function toonKerb(a: DistrictArt): THREE.Material {
  return toon(a.stone);
}

/** A floor decal laid flat, merge-compatible with the other decals. */
function plane(w: number, h: number): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(w, h);
}

export const NPCS: NpcSpec[] = [
  { name: 'DEALER 143', line: 'stock moves with the floor — buy now', x: -44, z: FAR_KERB - 1.2, tribe: 'volt' },
  { name: 'NURSE HOLLOW', line: 'you look like you walked out of a storm', x: -33, z: FAR_KERB - 1.2, tribe: 'wave' },
  { name: 'OPERATOR', line: 'station is hot — pulse when you are ready', x: -23, z: FAR_KERB - 1.2, tribe: 'prism' },
  { name: 'SCRIBE', line: 'the war resets at the week’s end', x: -12, z: FAR_KERB - 1.2, tribe: 'burn' },
  { name: 'WATCHMAN', line: 'fold gate is open, something is in voltgrid', x: 20, z: FAR_KERB - 1.2, tribe: 'frost' },
  { name: 'SURVEYOR', line: 'never seen your colours before', x: 33, z: NEAR_WALK + 1.2, tribe: 'void' },
];

export function skyFor(sector: SectorId): { sky: string; fog: string } {
  const a = DISTRICTS[sector];
  return { sky: a.skyTop, fog: a.fog };
}
