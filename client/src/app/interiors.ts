import * as THREE from 'three';
import { Batcher, box, cyl, pick, xform } from './geo.ts';
import { flat, toon, type DistrictArt } from './art.ts';
import type { Actor } from './standin.ts';
import { loadChogNFT, type Chog, type PartsModel } from './chogLoader.ts';
import { TRIBE_COLOUR, TRIBE_TINT, nameplate } from './tribes.ts';

/** A room is a small place with the same shape the player's collision and prompts expect. */
export interface RoomLayout {
  group: THREE.Group;
  solids: { x: number; z: number; halfW: number; halfD: number }[];
  interactables: { kind: 'board' | 'gate'; label: string; x: number; z: number; hint: string }[];
  spawn: { x: number; z: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  art: DistrictArt;
  /** Whoever is working in the room (the clerk behind the counter), animated by the shell. */
  actors: Actor[];
  /** False once the room is left: the clerk loads async and must not staff a closed room. */
  alive: boolean;
}
type TownLayout = RoomLayout;

/**
 * Interiors — what a door is for.
 *
 * A door that opens onto a wall is set dressing, and the street had six of them. Each
 * room here is returned as a `TownLayout`, the same shape the street returns, which is
 * what lets the existing player, collision, camera and NPC-label code walk inside
 * without a single special case: an interior is just a smaller town with different
 * geometry and a mat that sends you back out.
 *
 * The rooms are also where the game's systems live physically: the card counter with
 * its stock, the station's wave boards, the tribe hall's war table, the terminal's
 * album wall. Walking into a room and pressing a button on a menu are the same action
 * from the server's point of view — the room is not a second authority.
 */

/** The same model the street wears: a clerk is a Chog, not a second species. */
const CLERK_MODEL: PartsModel = {
  baseUrl: '/models/chog-base.glb',
  partsUrl: '/models/trait-parts.json',
  colorsUrl: '/models/trait-colors.json',
  skinsUrl: '/models/skins.json',
};
/** One tribe per counter, so every clerk reads different at a glance. */
const CLERK_TRIBE: Record<string, string> = { shop: 'volt', heal: 'wave', station: 'frost', brother: 'burn', telemetry: 'prism', dungeon: 'void' };
const CLERK_NAME: Record<string, string> = { shop: 'SHOPKEEPER', heal: 'MEDIC', station: 'STATION CHIEF', brother: 'BIG BROTHER', telemetry: 'ENGINEER', dungeon: 'GATEKEEPER' };
const CLERK_SCALE = 1.35;

export type RoomKind = 'shop' | 'heal' | 'station' | 'brother' | 'telemetry' | 'dungeon';

const ROOM = { w: 16, d: 12, h: 7.2 };

export function buildRoom(kind: RoomKind, art: DistrictArt, label: string): TownLayout {
  const b = new Batcher();
  const solids: TownLayout['solids'] = [];
  const { w, d, h } = ROOM;

  // ---- floor. There is no ceiling: a room is a cutaway diorama seen from its open side,
  // and a ceiling would be the first thing the camera met.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ map: roomFloor(art, kind) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  floor.receiveShadow = true;
  const ceil = new THREE.Object3D();

  // ---- walls: back and sides full height; the front is a low wall with a doorway, so the
  // camera, which sits on that side, looks over it into the room.
  const wallMat = toon(art.stone);
  const doorW = 2.6;
  const lowH = 1.1;
  b.push('wall', wallMat, box(w, h, 0.4), xform([0, h / 2, -d / 2]));
  for (const side of [-1, 1]) {
    b.push('wall', wallMat, box((w - doorW) / 2, lowH, 0.4), xform([side * (doorW + (w - doorW) / 2) / 2, lowH / 2, d / 2]));
    b.push('wall', wallMat, box(0.4, h, d), xform([side * (w / 2), h / 2, 0]));
    solids.push({ x: side * (w / 2), z: 0, halfW: 0.6, halfD: d / 2 });
  }
  solids.push({ x: 0, z: -d / 2, halfW: w / 2, halfD: 0.6 });
  for (const side of [-1, 1]) {
    solids.push({ x: side * (doorW + (w - doorW) / 2) / 2, z: d / 2, halfW: (w - doorW) / 4, halfD: 0.6 });
  }

  // ---- skirting and a ceiling light row, the two things that make an interior feel built
  b.push('skirt', toon(art.metal), box(w, 0.18, 0.14), xform([0, 0.09, -d / 2 + 0.28]));
  for (const side of [-1, 1]) {
    b.push('skirt', toon(art.metal), box(0.14, 0.18, d), xform([side * (w / 2 - 0.28), 0.09, 0]));
  }
  // Light strips along the back wall, since there is no ceiling to hang them from.
  for (let i = -1; i <= 1; i++) {
    b.push('lamp-strip', toon(art.window, 1.3), box(3.2, 0.08, 0.34), xform([i * 4.6, h - 1.2, -d / 2 + 0.28]));
  }

  // ---- the doorway mat you stand on to leave
  b.push('exit-mat', flat(art.neon, 0.85), box(doorW, 0.04, 1.6), xform([0, 0.05, d / 2 - 0.9]));
  b.push('exit-frame', toon(art.trim), box(doorW + 0.5, 0.16, 0.2), xform([0, 1.2, d / 2 - 0.2]));

  // ---- the counter every room has, so there is a clerk to face
  b.push('counter', toon(pick(art.wall, 2)), box(6.4, 1.1, 1.2), xform([-2.6, 0.55, -d / 2 + 1.9]));
  b.push('counter-top', toon(art.trim), box(6.7, 0.12, 1.45), xform([-2.6, 1.14, -d / 2 + 1.9]));
  b.push('counter-lit', toon(art.neon, art.neonGlow * 0.6), box(6.4, 0.07, 0.1), xform([-2.6, 0.34, -d / 2 + 2.53]));
  solids.push({ x: -2.6, z: -d / 2 + 1.9, halfW: 3.4, halfD: 0.9 });

  // ---- shelving and stock along the left wall
  for (let r = 0; r < 3; r++) {
    b.push('shelf', toon(art.metal), box(0.3, 0.1, 7.4), xform([-w / 2 + 0.7, 1.1 + r * 0.95, -1.2]));
    for (let i = 0; i < 7; i++) {
      const hue = pick(art.wall, i + r);
      b.push('stock', toon(hue), box(0.34, 0.42, 0.5), xform([-w / 2 + 0.7, 1.38 + r * 0.95, -4.2 + i * 1.05]));
    }
  }
  solids.push({ x: -w / 2 + 0.7, z: -1.2, halfW: 0.6, halfD: 4.2 });

  // ---- what makes this room *this* room
  fitOut(b, art, kind, w, d, h, solids);

  const group = b.build();
  group.add(floor, ceil);
  // ---- someone behind the counter. A room with a counter and nobody at it reads as closed,
  // so every room gets a clerk: a real Chog in plain dress, standing behind the counter
  // facing the customer spot (rotation 0 looks down +z, straight at it). The Chog loads
  // async like a street NPC — see the staffing below the return value.
  const clerkAnchor = new THREE.Group();
  clerkAnchor.position.set(-2.6, 0, -d / 2 + 1.0);
  group.add(clerkAnchor);
  let clerk: Chog | null = null;
  const clerkActor: Actor = {
    root: clerkAnchor,
    update: (dt) => { clerk?.update(dt); },
    setSpeed: (v) => { clerk?.setSpeed(v); },
    height: 3,
  };
  // The interior is lit by the district's own key light, so its walls take shadow too.
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });

  // Where the room's own verb lives. Every room has a counter you walk up to — except the fold
  // gate, which has no counter at all: its verb is the ring on the floor, and it used to be pure
  // decoration while the interactable sat at an invisible counter spot across the room. That is
  // why walking onto the obvious glowing ring and pressing E did nothing.
  const counter: RoomLayout['interactables'][number] =
    kind === 'dungeon'
      ? { kind: 'board', label: 'FOLD RING', x: 3.4, z: -2.4, hint: 'open the fold' }
      : { kind: 'board', label, x: -2.6, z: -d / 2 + 3.2, hint: 'use the counter' };

  const layout: TownLayout = {
    group,
    solids,
    interactables: [
      counter,
      { kind: 'gate', label: 'DOOR', x: 0, z: d / 2 - 1.1, hint: 'step outside' },
    ],
    spawn: { x: 0, z: d / 2 - 2.2 },
    bounds: { minX: -w / 2 + 0.8, maxX: w / 2 - 0.8, minZ: -d / 2 + 0.8, maxZ: d / 2 - 0.4 },
    art,
    actors: [clerkActor],
    alive: true,
  };
  // Staffing happens after the layout exists so the loader can check `alive`: the room may
  // be gone before the Chog arrives, and a clerk for a closed room is a leak. The tint is
  // what dresses one counter apart from another; the clerk wears no trait parts.
  void loadChogNFT({ ...CLERK_MODEL, tint: TRIBE_TINT[CLERK_TRIBE[kind] ?? 'volt'] ?? {} }).then((c) => {
    if (!layout.alive) return;
    clerk = c;
    c.root.scale.setScalar(CLERK_SCALE);
    clerkAnchor.add(c.root);
    const tag = nameplate(CLERK_NAME[kind] ?? 'CLERK', TRIBE_COLOUR[CLERK_TRIBE[kind] ?? 'volt'] ?? '#e8c15a');
    tag.position.set(0, 3.6, 0);
    clerkAnchor.add(tag);
  }).catch(() => { /* a closed shop beats a crashed one */ });
  return layout;
}

/** The room-specific furniture. Kept apart from the shell so each fits one idea. */
function fitOut(
  b: Batcher,
  a: DistrictArt,
  kind: RoomKind,
  w: number,
  d: number,
  h: number,
  solids: TownLayout['solids'],
): void {
  const z = -d / 2 + 0.5;
  switch (kind) {
    case 'shop': {
      // Vending wall and crates of stock: this is where the cards come from.
      for (let i = 0; i < 3; i++) {
        b.push('vend', toon(pick(a.wall, i)), box(1.2, 2.2, 0.7), xform([w / 2 - 1.4, 1.1, -3.2 + i * 2.4]));
        b.push('vend-glass', toon(a.dark, 0.4), box(0.8, 1.2, 0.06), xform([w / 2 - 2.05, 1.4, -3.2 + i * 2.4]));
      }
      for (let i = 0; i < 4; i++) {
        b.push('crate', toon(pick(a.wall, i + 2)), box(0.8, 0.8, 0.8), xform([3.2 + (i % 2) * 0.9, 0.4, 1.4 + Math.floor(i / 2) * 0.9]));
      }
      solids.push({ x: w / 2 - 1.4, z: -2, halfW: 0.9, halfD: 4.6 });
      break;
    }
    case 'heal': {
      // A bed, a monitor and supply racks.
      b.push('bed', toon(a.trim), box(2.2, 0.5, 1.1), xform([w / 2 - 2.2, 0.35, -2.4]));
      b.push('bed-head', toon(a.metal), box(0.2, 1.0, 1.1), xform([w / 2 - 3.3, 0.5, -2.4]));
      b.push('monitor', toon(a.window, 1.1), box(0.12, 0.8, 1.1), xform([w / 2 - 2.2, 1.9, -2.4]));
      b.push('monitor-stand', toon(a.metal), cyl(0.07, 0.12, 1.1, 6), xform([w / 2 - 2.2, 1.1, -2.4]));
      for (let i = 0; i < 3; i++) {
        b.push('supply', toon(pick(a.roof, i)), box(0.9, 1.7, 0.5), xform([2.2 + i * 1.1, 0.85, z + 0.6]));
      }
      solids.push({ x: w / 2 - 2.2, z: -2.4, halfW: 1.6, halfD: 1.1 });
      break;
    }
    case 'station': {
      // A wall of wave boards: the same index the street shows, read from inside.
      for (let i = 0; i < 3; i++) {
        b.push('board', toon(a.dark), box(2.6, 1.6, 0.12), xform([-4.4 + i * 3.1, 2.6, z + 0.2]));
        b.push('board-face', toon(a.window, 0.9), box(2.3, 1.3, 0.06), xform([-4.4 + i * 3.1, 2.6, z + 0.3]));
        for (let k = 0; k < 4; k++) {
          b.push('board-line', toon(a.neon, 0.5), box(1.6, 0.09, 0.04), xform([-4.9 + i * 3.1, 3.0 - k * 0.28, z + 0.36]));
        }
      }
      b.push('console', toon(a.metal), box(3.4, 0.9, 1.0), xform([4.6, 0.45, -1.0]));
      b.push('console-desk', toon(a.window, 0.8), box(2.8, 0.08, 0.7), xform([4.6, 0.95, -1.0], [0.3, 0, 0]));
      solids.push({ x: 4.6, z: -1.0, halfW: 1.9, halfD: 0.7 });
      break;
    }
    case 'brother': {
      // The war table: a relief of the three sectors with a marker per tribe.
      b.push('table', toon(pick(a.wall, 1)), box(4.6, 0.9, 2.4), xform([3.6, 0.45, -2.2]));
      b.push('table-top', toon(a.stone), box(4.9, 0.1, 2.7), xform([3.6, 0.94, -2.2]));
      for (let i = 0; i < 3; i++) {
        b.push('map-block', toon(pick(a.roof, i)), box(1.2, 0.16, 1.6), xform([2.4 + i * 1.3, 1.05, -2.2]));
        b.push('marker', toon(a.neon, 1.2), cyl(0.09, 0.09, 0.5, 6), xform([2.4 + i * 1.3, 1.35, -2.2]));
      }
      // A banner wall behind the counter.
      for (let i = 0; i < 4; i++) {
        b.push('banner', toon(i % 2 ? a.trim : pick(a.roof, i)), box(1.1, 2.6, 0.07), xform([-5.4 + i * 1.4, 2.6, z + 0.3]));
      }
      solids.push({ x: 3.6, z: -2.2, halfW: 2.5, halfD: 1.4 });
      break;
    }
    case 'telemetry': {
      // The album wall: one panel per trait category, lit as it fills.
      for (let i = 0; i < 13; i++) {
        const col = i % 7;
        const row = Math.floor(i / 7);
        b.push('panel', toon(a.dark), box(1.15, 1.15, 0.1), xform([-5.6 + col * 1.3, 3.1 - row * 1.35, z + 0.2]));
        b.push('panel-face', toon(pick(a.wall, i), 0.4), box(0.95, 0.95, 0.05), xform([-5.6 + col * 1.3, 3.1 - row * 1.35, z + 0.28]));
      }
      b.push('server', toon(a.metal), box(1.4, 2.6, 1.0), xform([w / 2 - 1.2, 1.3, -3.4]));
      for (let k = 0; k < 6; k++) {
        b.push('server-led', toon(a.window, 1.4), box(0.7, 0.08, 0.04), xform([w / 2 - 1.9, 0.6 + k * 0.4, -3.4]));
      }
      solids.push({ x: w / 2 - 1.2, z: -3.4, halfW: 0.9, halfD: 0.7 });
      break;
    }
    case 'dungeon': {
      // The fold gate: a ring on the floor and a frame around the back wall.
      b.push('ring', toon(a.neon, 1.1), new THREE.TorusGeometry(2.1, 0.12, 8, 24), xform([3.4, 0.14, -2.4], [Math.PI / 2, 0, 0]));
      b.push('ring-inner', flat(a.window, 0.35), new THREE.CircleGeometry(1.95, 22), xform([3.4, 0.07, -2.4], [-Math.PI / 2, 0, 0]));
      b.push('gate-frame', toon(a.metal), box(0.4, 3.4, 0.4), xform([1.1, 1.7, -2.4]));
      b.push('gate-frame', toon(a.metal), box(0.4, 3.4, 0.4), xform([5.7, 1.7, -2.4]));
      b.push('gate-lintel', toon(a.trim), box(5.0, 0.4, 0.5), xform([3.4, 3.5, -2.4]));
      for (let i = 0; i < 5; i++) {
        b.push('debris', toon(pick(a.roof, i)), box(0.5 + i * 0.1, 0.3, 0.5), xform([-1.2 + i * 0.7, 0.15, 1.6]));
      }
      break;
    }
  }
  void h;
}

/** Interior flooring: a checker of two district colours, which no flat plane gives. */
function roomFloor(a: DistrictArt, kind: RoomKind): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const tile = kind === 'station' || kind === 'telemetry' ? a.metal : a.pavement;
  g.fillStyle = tile;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = a.stone;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      if ((x + y) % 2) continue;
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  g.strokeStyle = 'rgba(0,0,0,.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.moveTo(0, i);
    g.lineTo(128, i);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
