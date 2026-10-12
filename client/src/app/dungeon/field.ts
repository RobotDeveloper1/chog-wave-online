import * as THREE from 'three';
import type { AreaRun, DataArea } from '@chog/shared';
import { moodFor, type DungeonMood } from './themes.ts';

/**
 * A dungeon you walk through, built like a place rather than a board.
 *
 * The run graph is a floor plan: every node is a ROOM and every link is a
 * CORRIDOR, and everything else is rock. The rock is generated from a cell mask
 * so the walls follow whatever shape the graph takes, and then dressed:
 *
 *   - a dressed base course faces every wall, with raw rock piled above it
 *   - rooms are round chambers with pillars, an inlaid floor and a dais
 *   - every doorway gets an arch, every corridor gets ribs and a lit runner
 *   - the element's furniture grows in clusters, not single props
 *   - motes drift through the air, braziers flicker, and a landmark on the
 *     horizon gives the place a skyline
 *
 * Same contract as `interiors.buildRoom` (group / solids / spawn / bounds), so
 * the shell walks the player through a dungeon with the code it uses for a shop.
 */

export interface DungeonNode {
  id: string;
  kind: string;
  label: string;
  x: number;
  z: number;
  /** The room is entered by standing on its floor plate. */
  reachable: boolean;
  cleared: boolean;
  here: boolean;
}

export interface DungeonField {
  group: THREE.Group;
  solids: { x: number; z: number; halfW: number; halfD: number }[];
  spawn: { x: number; z: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  nodes: DungeonNode[];
  /** The room a point stands in, for "did I just walk into a fight". */
  roomAt(x: number, z: number): DungeonNode | null;
  update(t: number): void;
  dispose(): void;
}

const CELL = 2;            // rock is dressed on a 2-unit grid
const ROOM_R = 8;          // a room is a round chamber, 16 across
const STEP_X = 30;
const STEP_Z = 34;
const CORR_HALF = 3.5;     // a corridor is 7 wide
const RIB_EVERY = 7;       // one arch rib per 7 units of corridor

const NODE_COLOUR: Record<string, string> = {
  gate: '#9a72ea', wave: '#e6e0ff', elite: '#ffd24d',
  chest: '#43e2a8', shrine: '#7fd8ff', boss: '#ff5d72',
};
const nodeColour = (kind: string): string => NODE_COLOUR[kind] ?? '#cbb2f2';

// ---------------------------------------------------------------- utilities

/** Deterministic, so the same seed always builds the same dungeon. */
function rngFrom(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

let GLOW_TEX: THREE.Texture | null = null;
/** A soft radial blob, used for flames, haloes and light pools. */
function glowTexture(): THREE.Texture {
  if (GLOW_TEX) return GLOW_TEX;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.32, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  GLOW_TEX = new THREE.CanvasTexture(c);
  return GLOW_TEX;
}

type Anim = {
  spin: { o: THREE.Object3D; speed: number }[];
  bob: { o: THREE.Object3D; y0: number; amp: number; speed: number; phase: number }[];
  pulse: { m: THREE.Material & { opacity: number }; base: number; speed: number; phase: number }[];
  flick: { l: THREE.PointLight; base: number; phase: number }[];
};

/** A billboarded halo. Cheap stand-in for a real light where you only need the glow. */
function halo(colour: string, scale: number, opacity = 0.85): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: new THREE.Color(colour), transparent: true,
    opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }));
  s.scale.setScalar(scale);
  return s;
}

/** Light pooled on the floor, as a flat additive disc. */
function pool(colour: string, radius: number, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), color: new THREE.Color(colour), transparent: true,
      opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

const add = (g: THREE.Group, ...o: THREE.Object3D[]): void => { for (const it of o) g.add(it); };

// ------------------------------------------------------------ the furniture

/**
 * One cluster of the element's furniture. Each cluster is several parts at
 * different heights, which is what makes a room read as furnished rather than
 * sprinkled.
 */
function cluster(mood: DungeonMood, i: number, x: number, z: number, rand: () => number, anim: Anim): THREE.Object3D {
  const g = new THREE.Group();
  const r = rand();
  const toon = (c: string) => new THREE.MeshToonMaterial({ color: c });
  const emissive = (c: string) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });

  switch (mood.prop) {
    case 'lava': {
      // A cooled crust with the fire showing through the cracks.
      const crust = new THREE.Mesh(new THREE.CircleGeometry(1.5 + r * 0.9, 16), toon(mood.crust));
      crust.rotation.x = -Math.PI / 2;
      crust.position.y = 0.05;
      add(g, crust);
      for (let k = 0; k < 4; k++) {
        const a = rand() * Math.PI * 2;
        const len = 0.5 + rand() * 1.0;
        const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.22, len), emissive(mood.glow));
        crack.rotation.x = -Math.PI / 2;
        crack.rotation.z = a;
        crack.position.set(Math.cos(a) * 0.5, 0.09, Math.sin(a) * 0.5);
        add(g, crack);
      }
      const glow = pool(mood.glow, 2.6 + r, 0.5);
      glow.position.y = 0.07;
      anim.pulse.push({ m: glow.material as THREE.MeshBasicMaterial, base: 0.5, speed: 1.3 + r, phase: i });
      add(g, glow);
      // A plume of heat rising off it.
      const plume = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 3.2, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: mood.flame, transparent: true, opacity: 0.14, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      plume.position.y = 1.7;
      anim.bob.push({ o: plume, y0: 1.7, amp: 0.22, speed: 0.9, phase: i * 1.7 });
      add(g, plume);
      break;
    }
    case 'ice': {
      // Three spires of different heights plus the frozen patch they grew from.
      const patch = new THREE.Mesh(new THREE.CircleGeometry(1.6 + r, 16), new THREE.MeshToonMaterial({
        color: mood.crust, transparent: true, opacity: 0.55,
      }));
      patch.rotation.x = -Math.PI / 2;
      patch.position.y = 0.04;
      add(g, patch);
      for (let k = 0; k < 3; k++) {
        const h = 1.8 + rand() * 3.4;
        const spire = new THREE.Mesh(new THREE.ConeGeometry(0.34 + rand() * 0.4, h, 5), toon(mood.accent));
        spire.position.set((rand() - 0.5) * 1.6, h / 2, (rand() - 0.5) * 1.6);
        spire.rotation.z = (rand() - 0.5) * 0.22;
        add(g, spire);
      }
      const chill = pool(mood.glow, 2.2, 0.28);
      chill.position.y = 0.06;
      add(g, chill);
      break;
    }
    case 'coil': {
      const h = 3.2 + r * 2.4;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 8), toon(mood.pillar));
      base.position.y = 0.25;
      add(g, base);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.44, h, 10), toon(mood.course));
      mast.position.y = h / 2;
      add(g, mast);
      for (let k = 0; k < 3; k++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62 - k * 0.06, 0.11, 8, 20), emissive(mood.glow));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.9 + k * 1.0;
        add(g, ring);
      }
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), emissive(mood.glow));
      orb.position.y = h + 0.5;
      anim.bob.push({ o: orb, y0: h + 0.5, amp: 0.2, speed: 1.5, phase: i });
      anim.spin.push({ o: orb, speed: 1.1 });
      add(g, orb);
      const h2 = halo(mood.glow, 3.0, 0.6);
      h2.position.y = h + 0.5;
      add(g, h2);
      break;
    }
    case 'water': {
      // A rim of wet stone around standing water, with ripples on it.
      const basin = new THREE.Mesh(new THREE.CircleGeometry(1.7 + r * 0.8, 18), new THREE.MeshToonMaterial({
        color: mood.glow, transparent: true, opacity: 0.62,
      }));
      basin.rotation.x = -Math.PI / 2;
      basin.position.y = 0.05;
      add(g, basin);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + r;
        const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36 + rand() * 0.2, 0), toon(mood.rubble));
        stone.position.set(Math.cos(a) * (1.7 + r * 0.8), 0.2, Math.sin(a) * (1.7 + r * 0.8));
        stone.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        add(g, stone);
      }
      for (let k = 0; k < 2; k++) {
        const rip = new THREE.Mesh(new THREE.RingGeometry(0.5 + k * 0.55, 0.62 + k * 0.55, 22), emissive(mood.glow));
        rip.rotation.x = -Math.PI / 2;
        rip.position.y = 0.08;
        (rip.material as THREE.MeshBasicMaterial).transparent = true;
        (rip.material as THREE.MeshBasicMaterial).opacity = 0.4 - k * 0.15;
        anim.pulse.push({ m: rip.material as THREE.MeshBasicMaterial, base: 0.4 - k * 0.15, speed: 1.1 + k, phase: i + k });
        add(g, rip);
      }
      break;
    }
    case 'crystal': {
      // A shard cluster tilted every which way out of one base.
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 0.4, 6), toon(mood.pillar));
      base.position.y = 0.2;
      add(g, base);
      for (let k = 0; k < 4; k++) {
        const h = 1.2 + rand() * 2.2;
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(h * 0.42, 0), toon(mood.accent));
        shard.scale.y = 2.1;
        shard.position.set((rand() - 0.5) * 1.1, h * 0.42, (rand() - 0.5) * 1.1);
        shard.rotation.set((rand() - 0.5) * 0.7, rand() * 3, (rand() - 0.5) * 0.7);
        add(g, shard);
      }
      const shimmer = pool(mood.glow, 2.4, 0.34);
      shimmer.position.y = 0.06;
      anim.pulse.push({ m: shimmer.material as THREE.MeshBasicMaterial, base: 0.34, speed: 0.8, phase: i });
      add(g, shimmer);
      break;
    }
    default: {
      // Storm: a mast that keeps arcing into the air above it.
      const h = 2.2 + r * 2.2;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 0.45, 8), toon(mood.pillar));
      base.position.y = 0.22;
      add(g, base);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, h, 8), toon(mood.rock));
      mast.position.y = h / 2;
      add(g, mast);
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.9 + r * 0.5, 0.08, 6, 16, Math.PI * 1.15), emissive(mood.glow));
      arc.position.y = h;
      arc.rotation.z = Math.PI / 2 - 0.3 + r;
      anim.spin.push({ o: arc, speed: 0.6 + r });
      add(g, arc);
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), emissive(mood.accent));
      orb.position.y = h + 0.6;
      anim.bob.push({ o: orb, y0: h + 0.6, amp: 0.35, speed: 1.8, phase: i });
      add(g, orb);
      const stormGlow = halo(mood.glow, 2.6, 0.55);
      stormGlow.position.y = h;
      add(g, stormGlow);
      break;
    }
  }
  g.position.set(x, 0, z);
  return g;
}

/** A brazier: a bowl of the element's fire on a stand. Flame included. */
function brazier(mood: DungeonMood, x: number, z: number, anim: Anim, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const toon = (c: string) => new THREE.MeshToonMaterial({ color: c });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.5, 7), toon(mood.pillar));
  shaft.position.y = 0.75;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.3, 0.42, 10), toon(mood.course));
  bowl.position.y = 1.68;
  const fire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), new THREE.MeshBasicMaterial({ color: mood.flame, toneMapped: false }));
  fire.position.y = 2.0;
  const lit = halo(mood.flame, 3.4, 0.8);
  lit.position.y = 2.05;
  add(g, shaft, bowl, fire, lit);
  anim.bob.push({ o: fire, y0: 2.0, amp: 0.09, speed: 3.1, phase: rand() * 6 });
  anim.pulse.push({ m: lit.material as THREE.SpriteMaterial, base: 0.8, speed: 3.4, phase: rand() * 6 });
  g.position.set(x, 0, z);
  return g;
}

// --------------------------------------------------------- distant landmark

/** Something on the skyline, far enough away to read as depth through the fog. */
function landmark(mood: DungeonMood, cx: number, cz: number): THREE.Group {
  const g = new THREE.Group();
  const toon = (c: string) => new THREE.MeshToonMaterial({ color: c });
  const emissive = (c: string) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
  const at = (m: THREE.Object3D, x: number, y: number, z: number) => { m.position.set(x, y, z); g.add(m); };

  switch (mood.landmark) {
    case 'volcano': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(58, 74, 14), toon(mood.rock));
      at(cone, 0, 30, 0);
      const shoulder = new THREE.Mesh(new THREE.ConeGeometry(34, 40, 11), toon(mood.rock));
      at(shoulder, -66, 16, 26);
      const glow = pool(mood.glow, 26, 0.75);
      at(glow, 0, 73, 0);
      const plume = new THREE.Mesh(
        new THREE.ConeGeometry(30, 80, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: mood.flame, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      at(plume, 0, 118, 0);
      break;
    }
    case 'glacier': {
      for (let k = 0; k < 5; k++) {
        const h = 50 + k * 16;
        const wall = new THREE.Mesh(new THREE.ConeGeometry(24 + k * 6, h, 5), toon(mood.pillar));
        wall.rotation.y = k * 1.1;
        at(wall, -90 + k * 46, h / 2, (k % 2) * 30 - 15);
      }
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(220, 8, 40), toon(mood.course));
      at(shelf, 0, 4, -40);
      break;
    }
    case 'pylons': {
      for (let k = 0; k < 4; k++) {
        const h = 60 + k * 14;
        const p = new THREE.Mesh(new THREE.CylinderGeometry(4, 9, h, 6), toon(mood.pillar));
        at(p, -80 + k * 54, h / 2, (k % 2) * 24);
        const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(7, 0), emissive(mood.glow));
        at(cap, -80 + k * 54, h + 6, (k % 2) * 24);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(220, 3, 3), emissive(mood.accent));
      at(rail, 0, 74, 12);
      break;
    }
    case 'basin': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(76, 7, 8, 40), toon(mood.pillar));
      ring.rotation.x = Math.PI / 2;
      at(ring, 0, 6, 0);
      const water = new THREE.Mesh(new THREE.CircleGeometry(74, 36), new THREE.MeshToonMaterial({
        color: mood.glow, transparent: true, opacity: 0.5,
      }));
      water.rotation.x = -Math.PI / 2;
      at(water, 0, 5.6, 0);
      for (let k = 0; k < 4; k++) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(5, 8, 46, 7), toon(mood.course));
        at(col, -60 + k * 40, 23, -50);
      }
      break;
    }
    case 'geode': {
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(58, 1), toon(mood.rock));
      at(shell, 0, 22, 0);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(9 + (k % 3) * 5, 0), emissive(mood.accent));
        shard.scale.y = 2.4;
        at(shard, Math.cos(a) * 34, 44 + (k % 3) * 12, Math.sin(a) * 34);
      }
      break;
    }
    default: {
      // A rift standing open in the sky.
      const slab = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 150),
        new THREE.MeshBasicMaterial({
          color: mood.glow, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
        }),
      );
      at(slab, 0, 74, 0);
      for (let k = 0; k < 6; k++) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(9 + (k % 3) * 6, 0), toon(mood.rock));
        at(rock, -70 + k * 28, 20 + (k % 3) * 34, 30 + (k % 2) * 20);
      }
      break;
    }
  }
  g.position.set(cx, 0, cz);
  return g;
}

// ------------------------------------------------------------------- build

export function buildDungeonField(area: DataArea, run: AreaRun, element: string): DungeonField {
  const mood = moodFor(element);
  const rand = rngFrom(area.seed ?? 1);
  const group = new THREE.Group();
  const nodes: DungeonNode[] = [];
  const cleared = new Set(run.cleared);
  const anim: Anim = { spin: [], bob: [], pulse: [], flick: [] };
  const lights: THREE.PointLight[] = [];

  // ---- 1. the plan: a round chamber per node, on a grid of rows and lanes
  const cols = Math.max(1, ...area.nodes.map((n) => n.col + 1));
  const roomOf = new Map<string, { x: number; z: number }>();
  for (const n of area.nodes) {
    roomOf.set(n.id, { x: (n.col - (cols - 1) / 2) * STEP_X, z: -n.row * STEP_Z });
  }

  // ---- 2. carve the mask: round rooms, square corridors, L-joints
  const walkable = new Set<string>();
  const key = (ix: number, iz: number): string => `${ix},${iz}`;
  const carveBox = (x0: number, z0: number, x1: number, z1: number): void => {
    for (let ix = Math.floor(Math.min(x0, x1) / CELL); ix <= Math.ceil(Math.max(x0, x1) / CELL); ix++)
      for (let iz = Math.floor(Math.min(z0, z1) / CELL); iz <= Math.ceil(Math.max(z0, z1) / CELL); iz++)
        walkable.add(key(ix, iz));
  };
  for (const n of area.nodes) {
    const p = roomOf.get(n.id)!;
    const r = n.kind === 'boss' ? ROOM_R * 1.35 : ROOM_R;
    for (let ix = Math.floor((p.x - r) / CELL); ix <= Math.ceil((p.x + r) / CELL); ix++)
      for (let iz = Math.floor((p.z - r) / CELL); iz <= Math.ceil((p.z + r) / CELL); iz++)
        if (Math.hypot(ix * CELL - p.x, iz * CELL - p.z) <= r + CELL * 0.45) walkable.add(key(ix, iz));
  }
  for (const n of area.nodes) {
    const a = roomOf.get(n.id);
    if (!a) continue;
    for (const link of n.links) {
      const b = roomOf.get(link);
      if (!b) continue;
      carveBox(a.x - CORR_HALF, Math.min(a.z, b.z), a.x + CORR_HALF, Math.max(a.z, b.z));      // the run down
      carveBox(Math.min(a.x, b.x) - CORR_HALF, b.z - CORR_HALF, Math.max(a.x, b.x) + CORR_HALF, b.z + CORR_HALF); // and across
    }
  }

  let minIX = Infinity, maxIX = -Infinity, minIZ = Infinity, maxIZ = -Infinity;
  for (const k of walkable) {
    const [ixs, izs] = k.split(',');
    const ix = Number(ixs ?? 0), iz = Number(izs ?? 0);
    minIX = Math.min(minIX, ix); maxIX = Math.max(maxIX, ix);
    minIZ = Math.min(minIZ, iz); maxIZ = Math.max(maxIZ, iz);
  }
  const pad = 4;
  const bounds = { minX: minIX * CELL, maxX: maxIX * CELL, minZ: minIZ * CELL, maxZ: maxIZ * CELL };
  const isFloor = (ix: number, iz: number): boolean => walkable.has(key(ix, iz));

  // ---- 3. the ground: a dark bed, then a lighter floor inside every room
  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry((maxIX - minIX + 1 + pad * 2) * CELL, (maxIZ - minIZ + 1 + pad * 2) * CELL),
    new THREE.MeshToonMaterial({ color: mood.ground }),
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(((minIX + maxIX) / 2) * CELL, 0, ((minIZ + maxIZ) / 2) * CELL);
  group.add(bed);

  const roomFloorMat = new THREE.MeshToonMaterial({ color: mood.groundEdge });
  const inlayMat = new THREE.MeshBasicMaterial({
    color: mood.accent, transparent: true, opacity: 0.24,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const spokeGeo = new THREE.PlaneGeometry(0.18, ROOM_R - 5.0);
  for (const n of area.nodes) {
    const p = roomOf.get(n.id)!;
    const r = n.kind === 'boss' ? ROOM_R * 1.35 : ROOM_R;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40), roomFloorMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(p.x, 0.02, p.z);
    group.add(disc);

    // An inlaid ring and spokes, so the chamber reads as built and not just swept.
    const rim = new THREE.Mesh(new THREE.RingGeometry(r - 1.5, r - 1.15, 44), inlayMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(p.x, 0.04, p.z);
    const inner = new THREE.Mesh(new THREE.RingGeometry(3.5, 3.75, 34), inlayMat.clone());
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(p.x, 0.04, p.z);
    group.add(rim, inner);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const spoke = new THREE.Mesh(spokeGeo, inlayMat);
      spoke.rotation.x = -Math.PI / 2;
      spoke.rotation.z = a;
      spoke.position.set(p.x + Math.cos(a) * (r * 0.55), 0.04, p.z + Math.sin(a) * (r * 0.55));
      group.add(spoke);
    }
    // Light pooled on the floor, so each chamber glows from within.
    const wash = pool(n.kind === 'boss' ? mood.glow : mood.accent, r * 1.15, n.kind === 'boss' ? 0.3 : 0.16);
    wash.position.set(p.x, 0.05, p.z);
    group.add(wash);
  }

  // ---- 4. the rock: every cell that is not floor, in three passes
  //   course -- a dressed base course that faces anything walkable
  //   rock  -- raw stone piled behind and above it
  //   cap   -- a slab on top, so the wall has a lip instead of a flat cut
  const solidCells: { x: number; z: number }[] = [];
  const faceCells: { x: number; z: number }[] = [];
  for (let iz = minIZ - pad; iz <= maxIZ + pad; iz++) {
    for (let ix = minIX - pad; ix <= maxIX + pad; ix++) {
      if (isFloor(ix, iz)) continue;
      const x = ix * CELL, z = iz * CELL;
      solidCells.push({ x, z });
      const touches = isFloor(ix + 1, iz) || isFloor(ix - 1, iz) || isFloor(ix, iz + 1) || isFloor(ix, iz - 1);
      if (touches) faceCells.push({ x, z });
    }
  }

  const rockMat = new THREE.MeshToonMaterial({ color: mood.rock });
  const courseMat = new THREE.MeshToonMaterial({ color: mood.course });
  const capMat = new THREE.MeshToonMaterial({ color: mood.groundEdge });
  const rockMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL, 1, CELL), rockMat, solidCells.length);
  const courseMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL * 1.04, 1, CELL * 1.04), courseMat, faceCells.length);
  const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL * 1.1, 0.44, CELL * 1.1), capMat, solidCells.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  solidCells.forEach((c, i) => {
    const h = mood.rockLo + rand() * (mood.rockHi - mood.rockLo);
    // Lean each block a hair off vertical: the wall stops reading as a grid.
    q.setFromAxisAngle(new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize(), (rand() - 0.5) * 0.09);
    m4.compose(v3.set(c.x, h / 2, c.z), q, new THREE.Vector3(1, h, 1));
    rockMesh.setMatrixAt(i, m4);
    m4.compose(v3.set(c.x, h + 0.2, c.z), q, one);
    capMesh.setMatrixAt(i, m4);
  });
  faceCells.forEach((c, i) => {
    const h = 1.9 + rand() * 0.9;
    m4.compose(v3.set(c.x, h / 2, c.z), q.identity(), new THREE.Vector3(1, h, 1));
    courseMesh.setMatrixAt(i, m4);
  });
  for (const im of [rockMesh, courseMesh, capMesh]) {
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    group.add(im);
  }

  // Collision: the same cells, merged row by row so the list stays small.
  const solids: DungeonField['solids'] = [];
  for (let iz = minIZ - pad; iz <= maxIZ + pad; iz++) {
    let runStart: number | null = null;
    for (let ix = minIX - pad; ix <= maxIX + pad + 1; ix++) {
      const solid = ix <= maxIX + pad && !isFloor(ix, iz);
      if (solid && runStart === null) runStart = ix;
      if (!solid && runStart !== null) {
        const len = ix - runStart;
        solids.push({ x: ((runStart + ix - 1) / 2) * CELL, z: iz * CELL, halfW: (len * CELL) / 2, halfD: CELL / 2 });
        runStart = null;
      }
    }
  }

  // ---- 5. loose stone at the foot of the wall, so the floor is not bare
  const rubbleMat = new THREE.MeshToonMaterial({ color: mood.rubble });
  const rubbleSpots: { x: number; z: number; s: number; r: number }[] = [];
  for (const k of walkable) {
    const [ixs, izs] = k.split(',');
    const ix = Number(ixs ?? 0), iz = Number(izs ?? 0);
    const open = (isFloor(ix + 1, iz) ? 1 : 0) + (isFloor(ix - 1, iz) ? 1 : 0)
      + (isFloor(ix, iz + 1) ? 1 : 0) + (isFloor(ix, iz - 1) ? 1 : 0);
    if (open === 4) continue;                 // only along the walls
    if (rand() > 0.42) continue;
    rubbleSpots.push({ x: ix * CELL + (rand() - 0.5) * 1.4, z: iz * CELL + (rand() - 0.5) * 1.4, s: 0.28 + rand() * 0.5, r: rand() * 3 });
  }
  const rubble = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rubbleMat, rubbleSpots.length);
  rubbleSpots.forEach((c, i) => {
    q.setFromEuler(new THREE.Euler(c.r, c.r * 2, c.r * 3));
    m4.compose(v3.set(c.x, c.s * 0.55, c.z), q, new THREE.Vector3(c.s, c.s * 0.8, c.s));
    rubble.setMatrixAt(i, m4);
  });
  rubble.instanceMatrix.needsUpdate = true;
  rubble.frustumCulled = false;
  group.add(rubble);

  // ---- 6. the chambers: pillars in the corners, a dais, and an arch per door
  const pillarMat = new THREE.MeshToonMaterial({ color: mood.pillar });
  const pillarShaft = new THREE.CylinderGeometry(0.52, 0.62, 4.4, 10);
  const pillarBase = new THREE.BoxGeometry(1.5, 0.5, 1.5);
  const pillarTop = new THREE.BoxGeometry(1.6, 0.5, 1.6);
  const pillarRing = new THREE.TorusGeometry(0.66, 0.09, 6, 16);
  const lintelGeo = new THREE.BoxGeometry(1, 0.9, 1);

  for (const n of area.nodes) {
    const p = roomOf.get(n.id)!;
    const r = n.kind === 'boss' ? ROOM_R * 1.35 : ROOM_R;
    const boss = n.kind === 'boss';

    // Four columns, tucked into the corners so no doorway is ever blocked.
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
      const px = p.x + Math.cos(a) * (r - 2.3);
      const pz = p.z + Math.sin(a) * (r - 2.3);
      const col = new THREE.Group();
      const base = new THREE.Mesh(pillarBase, pillarMat); base.position.y = 0.25;
      const shaft = new THREE.Mesh(pillarShaft, pillarMat); shaft.position.y = 2.6;
      const top = new THREE.Mesh(pillarTop, pillarMat); top.position.y = 5.0;
      const band = new THREE.Mesh(pillarRing, new THREE.MeshBasicMaterial({ color: mood.accent, toneMapped: false }));
      band.rotation.x = Math.PI / 2;
      band.position.y = 3.4;
      add(col, base, shaft, top, band);
      col.position.set(px, 0, pz);
      group.add(col);
      solids.push({ x: px, z: pz, halfW: 0.8, halfD: 0.8 });
    }

    // A dais for the boss, so the last room is a stage and not a wider circle.
    if (boss) {
      const dais = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 5.0, 0.6, 26), pillarMat);
      dais.position.set(p.x, 0.3, p.z);
      const step = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.8, 0.3, 26), new THREE.MeshToonMaterial({ color: mood.course }));
      step.position.set(p.x, 0.15, p.z);
      group.add(dais, step);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
        group.add(brazier(mood, p.x + Math.cos(a) * 6.2, p.z + Math.sin(a) * 6.2, anim, rand));
      }
    } else {
      // Two braziers by the door side, so every chamber is lit from somewhere.
      group.add(brazier(mood, p.x - (r - 2.0), p.z + (r - 4.6), anim, rand));
      group.add(brazier(mood, p.x + (r - 2.0), p.z + (r - 4.6), anim, rand));
    }

    // An arch over every doorway out of the room.
    for (const link of n.links) {
      const b = roomOf.get(link);
      if (!b) continue;
      // Leaving along Z first (the run down), then along X (the run across).
      const mouths: { x: number; z: number; along: 'z' | 'x' }[] = [];
      if (Math.abs(b.z - p.z) > 0.5) mouths.push({ x: p.x, z: p.z + Math.sign(b.z - p.z) * (r + 0.6), along: 'z' });
      if (Math.abs(b.x - p.x) > 0.5) mouths.push({ x: p.x + Math.sign(b.x - p.x) * (r + 0.6), z: p.z, along: 'x' });
      for (const mth of mouths) {
        const arch = new THREE.Group();
        const half = CORR_HALF + 0.35;
        for (const s of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.6, 0.7), pillarMat);
          post.position.set(mth.along === 'z' ? s * half : 0, 2.3, mth.along === 'z' ? 0 : s * half);
          const lamp = halo(mood.flame, 1.5, 0.7);
          lamp.position.set(post.position.x, 4.9, post.position.z);
          anim.pulse.push({ m: lamp.material as THREE.SpriteMaterial, base: 0.7, speed: 2.6, phase: rand() * 6 });
          add(arch, post, lamp);
        }
        const lintel = new THREE.Mesh(lintelGeo, pillarMat);
        lintel.scale.set(mth.along === 'z' ? half * 2 + 0.7 : 0.8, 1, mth.along === 'z' ? 0.8 : half * 2 + 0.7);
        lintel.position.y = 4.85;
        arch.add(lintel);
        arch.position.set(mth.x, 0, mth.z);
        group.add(arch);
      }
    }
  }

  // ---- 7. the corridors: ribs every few units, a lit runner, and a torch
  const ribMat = new THREE.MeshToonMaterial({ color: mood.course });
  const runnerMat = new THREE.MeshBasicMaterial({
    color: mood.accent, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  for (const n of area.nodes) {
    const a = roomOf.get(n.id);
    if (!a) continue;
    for (const link of n.links) {
      const b = roomOf.get(link);
      if (!b) continue;
      const segs: { x0: number; z0: number; x1: number; z1: number }[] = [];
      if (Math.abs(b.z - a.z) > 0.5) segs.push({ x0: a.x, z0: a.z, x1: a.x, z1: b.z });
      if (Math.abs(b.x - a.x) > 0.5) segs.push({ x0: a.x, z0: b.z, x1: b.x, z1: b.z });
      for (const s of segs) {
        const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
        const along: 'z' | 'x' = Math.abs(s.z1 - s.z0) > Math.abs(s.x1 - s.x0) ? 'z' : 'x';
        // The runner: a strip of light down the middle.
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(along === 'z' ? 1.8 : len, along === 'z' ? len : 1.8), runnerMat);
        strip.rotation.x = -Math.PI / 2;
        strip.position.set((s.x0 + s.x1) / 2, 0.06, (s.z0 + s.z1) / 2);
        group.add(strip);
        // Ribs: an arch sprung across the corridor, with a lamp at the crown.
        const ribs = Math.max(1, Math.floor(len / RIB_EVERY));
        for (let k = 1; k < ribs; k++) {
          const f = k / ribs;
          const rx = s.x0 + (s.x1 - s.x0) * f;
          const rz = s.z0 + (s.z1 - s.z0) * f;
          const rib = new THREE.Mesh(
            new THREE.TorusGeometry(CORR_HALF + 0.45, 0.24, 6, 18, Math.PI),
            ribMat,
          );
          if (along === 'x') rib.rotation.y = Math.PI / 2;
          rib.position.set(rx, 0, rz);
          group.add(rib);
          const lamp = halo(mood.flame, 1.8, 0.55);
          lamp.position.set(rx, CORR_HALF + 1.1, rz);
          anim.pulse.push({ m: lamp.material as THREE.SpriteMaterial, base: 0.55, speed: 2.2 + rand(), phase: rand() * 6 });
          group.add(lamp);
        }
      }
    }
  }

  // ---- 8. the element's furniture, in clusters inside the chambers
  for (const n of area.nodes) {
    const p = roomOf.get(n.id)!;
    const r = n.kind === 'boss' ? ROOM_R * 1.35 : ROOM_R;
    const count = n.kind === 'boss' ? 6 : 4;
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2;
      const d = (n.kind === 'boss' ? 6.6 : 4.4) + rand() * (r - (n.kind === 'boss' ? 8.5 : 6.2));
      group.add(cluster(mood, nodes.length + k, p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, rand, anim));
    }
  }

  // ---- 9. the rooms themselves: plate, ring, what waits inside, and a light
  const plateGeo = new THREE.CircleGeometry(2.9, 30);
  const ringGeo = new THREE.TorusGeometry(3.0, 0.16, 8, 34);
  const from = area.nodes.find((n) => n.id === run.at);
  const linked = new Set(from?.links ?? []);
  for (const n of area.nodes) {
    const p = roomOf.get(n.id)!;
    const at: DungeonNode = {
      id: n.id, kind: n.kind, label: n.label, x: p.x, z: p.z,
      reachable: n.id === run.at || linked.has(n.id),
      cleared: cleared.has(n.id),
      here: n.id === run.at,
    };
    nodes.push(at);

    const col = nodeColour(n.kind);
    const boss = n.kind === 'boss';
    const plate = new THREE.Mesh(plateGeo, new THREE.MeshToonMaterial({ color: boss ? '#3a1520' : '#2a2438' }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(p.x, 0.08, p.z);
    if (boss) plate.scale.setScalar(1.5);
    group.add(plate);

    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: col, transparent: true,
      opacity: at.cleared ? 0.16 : at.reachable ? 0.95 : 0.35, toneMapped: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.14, p.z);
    if (boss) ring.scale.setScalar(1.5);
    group.add(ring);
    if (!at.cleared) anim.pulse.push({ m: ring.material as THREE.MeshBasicMaterial, base: ring.material.opacity, speed: 1.6, phase: p.x });

    // One real light per chamber, so walking in changes the lighting on the chog.
    const lamp = new THREE.PointLight(new THREE.Color(col), 2.1, 30, 2);
    lamp.position.set(p.x, 4.6, p.z);
    group.add(lamp);
    lights.push(lamp);
    anim.flick.push({ l: lamp, base: 2.1, phase: rand() * 6 });

    // What is waiting in the room, so a doorway can be read before it is entered.
    if (!at.cleared && n.kind !== 'gate') {
      const mark =
        n.kind === 'boss' ? new THREE.OctahedronGeometry(1.5)
          : n.kind === 'chest' ? new THREE.BoxGeometry(1.5, 1.5, 1.5)
            : n.kind === 'shrine' ? new THREE.CylinderGeometry(0.9, 0.9, 1.6, 6)
              : new THREE.IcosahedronGeometry(1.1);
      const body = new THREE.Mesh(mark, new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
      body.position.set(p.x, n.kind === 'boss' ? 3.4 : 1.5, p.z);
      anim.bob.push({ o: body, y0: body.position.y, amp: 0.28, speed: 1.4, phase: p.z });
      anim.spin.push({ o: body, speed: 0.7 });
      group.add(body);
      const h = halo(col, n.kind === 'boss' ? 7 : 4.2, 0.55);
      h.position.set(p.x, body.position.y, p.z);
      group.add(h);
      if (boss) {
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(1.5, 2.4, 26, 16, 1, true),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }),
        );
        beam.position.set(p.x, 13, p.z);
        group.add(beam);
      }
    } else if (n.kind === 'gate') {
      // The way out stands open: a portal ring you can see from across the room.
      const portal = new THREE.Mesh(
        new THREE.TorusGeometry(2.4, 0.22, 8, 30),
        new THREE.MeshBasicMaterial({ color: col, toneMapped: false }),
      );
      portal.position.set(p.x, 2.6, p.z);
      anim.spin.push({ o: portal, speed: 0.35 });
      const fill2 = pool(col, 2.4, 0.4);
      fill2.position.set(p.x, 0.1, p.z);
      group.add(portal, fill2);
    }
    if (at.here) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(2.0, 2.8, 24, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }),
      );
      beam.position.set(p.x, 12, p.z);
      group.add(beam);
    }
  }

  // ---- 10. a landmark on the horizon, and motes drifting through the air
  group.add(landmark(mood, ((minIX + maxIX) / 2) * CELL, minIZ * CELL - 190));

  const cellList = [...walkable];
  const MOTE_COUNT = Math.min(640, cellList.length * 2);
  const mpos = new Float32Array(MOTE_COUNT * 3);
  const mbase = new Float32Array(MOTE_COUNT * 3);
  const mphase = new Float32Array(MOTE_COUNT);
  for (let i = 0; i < MOTE_COUNT; i++) {
    const k = cellList[Math.floor(rand() * cellList.length)] ?? '0,0';
    const [ixs, izs] = k.split(',');
    const bx = Number(ixs ?? 0) * CELL + (rand() - 0.5) * CELL;
    const bz = Number(izs ?? 0) * CELL + (rand() - 0.5) * CELL;
    mbase[i * 3] = bx; mbase[i * 3 + 1] = rand() * 9; mbase[i * 3 + 2] = bz;
    mphase[i] = rand() * Math.PI * 2;
  }
  mpos.set(mbase);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: mood.mote, size: mood.drift === 'snow' ? 0.34 : 0.26, sizeAttenuation: true,
    map: glowTexture(), transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  motes.frustumCulled = false;
  group.add(motes);

  // ---- 11. the contract the shell walks the player through
  const spawn = from ? { x: roomOf.get(from.id)!.x, z: roomOf.get(from.id)!.z + 2 } : { x: 0, z: 0 };
  const inRoom = (n: DungeonNode, x: number, z: number): boolean => {
    const r = (n.kind === 'boss' ? ROOM_R * 1.35 : ROOM_R) - 1.2;
    return Math.hypot(x - n.x, z - n.z) < r;
  };

  return {
    group,
    solids,
    spawn,
    bounds,
    nodes,
    roomAt(x: number, z: number): DungeonNode | null {
      for (const n of nodes) if (inRoom(n, x, z)) return n;
      return null;
    },
    update(t: number): void {
      for (const s of anim.spin) s.o.rotation.y += s.speed * 0.016;
      for (const b of anim.bob) b.o.position.y = b.y0 + Math.sin(t * b.speed + b.phase) * b.amp;
      for (const p of anim.pulse) p.m.opacity = p.base * (0.72 + 0.28 * Math.sin(t * p.speed + p.phase));
      for (const f of anim.flick) {
        f.l.intensity = f.base * (0.86 + 0.14 * Math.sin(t * 5.1 + f.phase) * Math.sin(t * 1.7 + f.phase * 2));
      }
      // Motes: each element's air moves in its own way.
      const rise = mood.drift === 'snow' ? -1 : 1;
      for (let i = 0; i < MOTE_COUNT; i++) {
        const ph = mphase[i] ?? 0;
        const bx = mbase[i * 3] ?? 0, bz = mbase[i * 3 + 2] ?? 0;
        const span = mood.drift === 'snow' ? 11 : 9;
        let y: number;
        switch (mood.drift) {
          case 'spark': y = 0.4 + Math.abs(Math.sin(t * 2.2 + ph)) * 2.4; break;
          case 'dust': y = 3.2 + Math.sin(t * 0.5 + ph) * 1.6; break;
          case 'wisp': y = 2.4 + Math.sin(t * 0.8 + ph) * 2.2; break;
          case 'bubble': y = (t * 0.7 + ph * 2) % span; break;
          default: {
            const raw = (t * (mood.drift === 'snow' ? 0.6 : 1.1) + ph * 2) % span;
            y = rise > 0 ? raw : span - raw;
          }
        }
        mpos[i * 3] = bx + Math.sin(t * 0.35 + ph * 3) * 0.8;
        mpos[i * 3 + 1] = y;
        mpos[i * 3 + 2] = bz + Math.cos(t * 0.28 + ph * 2) * 0.8;
      }
      (moteGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    },
    dispose(): void {
      const seenG = new Set<THREE.BufferGeometry>();
      const seenM = new Set<THREE.Material>();
      group.traverse((o) => {
        const any = o as THREE.Mesh & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
        const g = any.geometry;
        const mm = any.material;
        if (g && !seenG.has(g)) { seenG.add(g); g.dispose(); }
        if (mm) for (const one of Array.isArray(mm) ? mm : [mm]) if (!seenM.has(one)) { seenM.add(one); one.dispose(); }
      });
    },
  };
}
