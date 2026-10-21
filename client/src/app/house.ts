import * as THREE from 'three';
import { FURNITURE, HOUSE_D, HOUSE_SPAWN, HOUSE_W, footprintOf, type HouseLayout } from '@chog/shared';
import { Batcher, box, cyl, xform } from './geo.ts';
import { flat, toon, type DistrictArt } from './art.ts';
import type { RoomLayout } from './interiors.ts';

/**
 * The house: one room per Chog, drawn from the server's layout.
 *
 * It is a `RoomLayout` like every interior, which is what lets the existing
 * player, collision, camera and prompt code walk it with no special cases —
 * the shell cannot tell a house from the card shop except by the label. Two
 * things differ: the furniture group is rebuilt live whenever the server
 * pushes a layout (the owner edits, the guests watch), and the room exposes
 * its floor and furniture group so edit mode can raycast them.
 */

export interface HouseRoom extends RoomLayout {
  setLayout(layout: HouseLayout): void;
  furnGroup: THREE.Group;
  floorMesh: THREE.Mesh;
}

const W = HOUSE_W;
const D = HOUSE_D;
const H = 7.2;

/** Warm planks, not district stone: a house reads as lived-in at a glance. */
function houseFloorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6b4a2e';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#75532f';
  for (let y = 0; y < 8; y++) {
    g.fillRect(0, y * 16 + (y % 2 ? 8 : 0), 128, 1);
    for (let x = 0; x < 4; x++) {
      if ((x + y) % 2) g.fillRect(x * 32 + (y % 2 ? 16 : 0), y * 16, 1, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 3);
  return t;
}

type Piece = (m: Record<string, THREE.Material>) => THREE.Group;

const at = (g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0): void => {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
};

/** One builder per catalogue id. Origin at the floor, centred on the footprint. */
const PIECES: Record<string, Piece> = {
  cot: (m) => {
    const g = new THREE.Group();
    at(g, box(1.6, 0.35, 2.6), m.wood!, 0, 0.35, 0);
    at(g, box(1.4, 0.28, 2.3), m.cloth!, 0, 0.66, 0);
    at(g, box(1.1, 0.22, 0.6), m.pale!, 0, 0.85, -0.75);
    for (const [x, z] of [[-0.7, -1.1], [0.7, -1.1], [-0.7, 1.1], [0.7, 1.1]] as const) at(g, box(0.12, 0.35, 0.12), m.dark!, x, 0.17, z);
    return g;
  },
  table: (m) => {
    const g = new THREE.Group();
    at(g, box(2.2, 0.12, 1.4), m.wood!, 0, 0.85, 0);
    for (const [x, z] of [[-0.95, -0.55], [0.95, -0.55], [-0.95, 0.55], [0.95, 0.55]] as const) at(g, box(0.12, 0.85, 0.12), m.dark!, x, 0.42, z);
    at(g, box(0.5, 0.3, 0.4), m.cloth!, -0.5, 1.06, 0.1);
    at(g, cyl(0.09, 0.12, 0.35, 8), m.glow!, 0.5, 1.08, -0.2);
    return g;
  },
  stool: (m) => {
    const g = new THREE.Group();
    at(g, cyl(0.4, 0.4, 0.12, 10), m.wood!, 0, 0.6, 0);
    at(g, cyl(0.07, 0.1, 0.55, 8), m.dark!, 0, 0.3, 0);
    return g;
  },
  lamp: (m) => {
    const g = new THREE.Group();
    at(g, cyl(0.3, 0.36, 0.1, 10), m.dark!, 0, 0.05, 0);
    at(g, cyl(0.05, 0.05, 1.5, 8), m.dark!, 0, 0.85, 0);
    at(g, cyl(0.28, 0.42, 0.5, 10), m.glow!, 0, 1.8, 0);
    return g;
  },
  rug: (m) => {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(box(2.6, 0.04, 2.6), m.rug!);
    mesh.position.y = 0.03;
    mesh.receiveShadow = true;
    g.add(mesh);
    const inner = new THREE.Mesh(box(1.7, 0.045, 1.7), m.rugIn!);
    inner.position.y = 0.032;
    inner.receiveShadow = true;
    g.add(inner);
    return g;
  },
  plant: (m) => {
    const g = new THREE.Group();
    at(g, cyl(0.32, 0.26, 0.5, 10), m.pot!, 0, 0.25, 0);
    at(g, cyl(0.05, 0.05, 0.7, 6), m.dark!, 0, 0.8, 0);
    at(g, box(0.5, 0.4, 0.12), m.leaf!, 0, 1.2, 0, 0.4);
    at(g, box(0.4, 0.34, 0.12), m.leaf!, 0.1, 0.95, 0.1, 1.2);
    return g;
  },
  shelf: (m) => {
    const g = new THREE.Group();
    for (const x of [-1.1, 1.1]) at(g, box(0.1, 2.2, 0.8), m.wood!, x, 1.1, 0);
    for (let r = 0; r < 3; r++) {
      at(g, box(2.3, 0.08, 0.8), m.wood!, 0, 0.4 + r * 0.7, 0);
      for (let i = 0; i < 4; i++) at(g, box(0.3, 0.42, 0.5), r % 2 ? m.cloth! : m.pale!, -0.75 + i * 0.5, 0.65 + r * 0.7, 0);
    }
    return g;
  },
  crystal: (m) => {
    const g = new THREE.Group();
    at(g, cyl(0.45, 0.55, 0.25, 10), m.dark!, 0, 0.12, 0);
    const rock = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), m.glow!);
    rock.position.y = 0.85;
    rock.castShadow = true;
    g.add(rock);
    return g;
  },
  screen: (m) => {
    const g = new THREE.Group();
    at(g, box(0.5, 0.5, 0.4), m.dark!, 0, 0.25, 0);
    at(g, box(1.8, 1.1, 0.14), m.dark!, 0, 1.25, 0);
    at(g, box(1.6, 0.9, 0.06), m.screen!, 0, 1.25, 0.06);
    return g;
  },
  trunk: (m) => {
    const g = new THREE.Group();
    at(g, box(1.4, 0.6, 0.9), m.wood!, 0, 0.3, 0);
    at(g, box(1.44, 0.18, 0.94), m.dark!, 0, 0.66, 0);
    at(g, box(0.16, 0.62, 0.94), m.metal!, -0.4, 0.31, 0);
    at(g, box(0.16, 0.62, 0.94), m.metal!, 0.4, 0.31, 0);
    return g;
  },
  poster: (m) => {
    const g = new THREE.Group();
    at(g, box(1.2, 1.6, 0.08), m.pale!, 0, 1.5, 0);
    at(g, box(1.0, 1.0, 0.1), m.cloth!, 0, 1.65, 0);
    at(g, box(1.0, 0.12, 0.1), m.dark!, 0, 0.95, 0);
    at(g, box(0.1, 0.7, 0.1), m.dark!, 0, 0.35, 0);
    return g;
  },
  throne: (m) => {
    const g = new THREE.Group();
    at(g, box(1.6, 0.5, 1.6), m.metal!, 0, 0.25, 0);
    at(g, box(1.4, 0.3, 1.4), m.cloth!, 0, 0.62, 0);
    at(g, box(1.6, 1.8, 0.3), m.metal!, 0, 1.5, -0.65);
    for (const x of [-0.7, 0.7]) at(g, box(0.2, 0.7, 1.2), m.metal!, x, 1.0, 0);
    at(g, cyl(0.12, 0.12, 0.3, 8), m.glow!, 0, 2.5, -0.65);
    return g;
  },
};

/** Build one catalogue piece for the room, a ghost, or a preview. Null when the id is not furniture. */
export function buildFurniture(fid: string): THREE.Group | null {
  const make = PIECES[fid];
  if (!make) return null;
  return make(mats());
}

const mats = (): Record<string, THREE.Material> => ({
  wood: toon('#7a5636'),
  dark: toon('#2c2434'),
  pale: toon('#e8e2d2'),
  cloth: toon('#b0506e'),
  rug: toon('#31435c'),
  rugIn: toon('#7fd8ff', 0.25),
  glow: toon('#ffd98a', 1.6),
  screen: toon('#7fd8ff', 1.1),
  leaf: toon('#43e2a8'),
  pot: toon('#a8542f'),
  metal: toon('#5a6a7a'),
});

export function buildHouse(art: DistrictArt, layout: HouseLayout): HouseRoom {
  const b = new Batcher();
  const baseSolids: RoomLayout['solids'] = [];
  const d = D;
  const w = W;
  const h = H;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: houseFloorTexture() }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  floor.receiveShadow = true;

  // Pale walls, warm light: the street is neon and noise, the house is the exhale.
  const wallMat = toon('#d7e2ee');
  const doorW = 2.6;
  const lowH = 1.1;
  b.push('wall', wallMat, box(w, h, 0.4), xform([0, h / 2, -d / 2]));
  for (const side of [-1, 1]) {
    b.push('wall', wallMat, box((w - doorW) / 2, lowH, 0.4), xform([(side * (doorW + (w - doorW) / 2)) / 2, lowH / 2, d / 2]));
    b.push('wall', wallMat, box(0.4, h, d), xform([(side * w) / 2, h / 2, 0]));
    baseSolids.push({ x: (side * w) / 2, z: 0, halfW: 0.6, halfD: d / 2 });
  }
  baseSolids.push({ x: 0, z: -d / 2, halfW: w / 2, halfD: 0.6 });
  for (const side of [-1, 1]) {
    baseSolids.push({ x: (side * (doorW + (w - doorW) / 2)) / 2, z: d / 2, halfW: (w - doorW) / 4, halfD: 0.6 });
  }
  // A round window on the back wall: the one thing a house has that a shop does not.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.14, 8, 20), toon('#8fa3bd'));
  ring.position.set(0, 4.4, -d / 2 + 0.25);
  const pane = new THREE.Mesh(new THREE.CircleGeometry(1.05, 20), toon('#9fd8ff', 0.7));
  pane.position.set(0, 4.4, -d / 2 + 0.24);
  for (let i = -1; i <= 1; i++) {
    b.push('lamp-strip', toon('#ffd98a', 1.0), box(2.4, 0.08, 0.3), xform([i * 5.2, h - 1.4, -d / 2 + 0.28]));
  }
  b.push('exit-mat', flat(art.neon, 0.85), box(doorW, 0.04, 1.6), xform([0, 0.05, d / 2 - 0.9]));
  b.push('exit-frame', toon('#8fa3bd'), box(doorW + 0.5, 0.16, 0.2), xform([0, 1.2, d / 2 - 0.2]));

  const group = b.build();
  group.add(floor, ring, pane);
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  const furnGroup = new THREE.Group();
  group.add(furnGroup);

  const room: HouseRoom = {
    group,
    solids: [...baseSolids],
    interactables: [{ kind: 'gate', label: 'DOOR', x: 0, z: d / 2 - 1.1, hint: 'step outside' }],
    spawn: { x: HOUSE_SPAWN.x, z: HOUSE_SPAWN.z },
    bounds: { minX: -w / 2 + 0.8, maxX: w / 2 - 0.8, minZ: -d / 2 + 0.8, maxZ: d / 2 - 0.4 },
    art,
    actors: [],
    alive: true,
    furnGroup,
    floorMesh: floor,
    setLayout(next: HouseLayout): void {
      for (const child of [...furnGroup.children]) {
        furnGroup.remove(child);
        child.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry?.dispose();
        });
      }
      const solids: RoomLayout['solids'] = [...baseSolids];
      for (const it of next.items) {
        const def = FURNITURE[it.fid];
        const piece = buildFurniture(it.fid);
        if (!def || !piece) continue;
        piece.position.set(it.x, 0, it.z);
        piece.rotation.y = (it.rot * Math.PI) / 2;
        piece.userData.uid = it.uid;
        piece.traverse((o) => {
          o.userData.uid = it.uid;
        });
        furnGroup.add(piece);
        if (def.solid) {
          const { hw, hd } = footprintOf(def, it.rot);
          solids.push({ x: it.x, z: it.z, halfW: hw, halfD: hd });
        }
      }
      room.solids = solids;
    },
  };
  room.setLayout(layout);
  return room;
}
