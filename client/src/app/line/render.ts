import * as THREE from 'three';

import { ChunkBatcher, type Chunk, type MatKey } from '../city/batch.ts';
import { BIOMES, REGION_SIZE, campOf, lineLayout, chaseStep, chaseSpeedFor, type ChaseAnchor, roadHalfAt, roadXAt, type LineLayout, type MobSpawn, type RegionId } from '@chog/shared';
import type { BossAvatar } from '../duel/boss.ts';
import { buildCritter } from './critters.ts';
import { nameplate } from '../tribes.ts';
import { WU, patch } from '../city/materials.ts';
import { loadChogNFT, type Chog } from '../chogLoader.ts';
import { CHOG_SCALE } from '../explorer.ts';
import { WATER_LEVEL, WATER_REGIONS, buildGroundCover, buildMotes, buildSky, pourStaticDetails, softDot } from './detail.ts';
import { moodOf } from './theme.ts';

/** Shared blob shadow: one geometry and material for every tent, scout and mob. Never disposed. */
const blobGeo = new THREE.CircleGeometry(1, 20);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });

const blob = (x: number, y: number, z: number, r: number): THREE.Mesh => {
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.scale.setScalar(r);
  return m;
};

/** The trailhead scout wears a fixed token, like the city's people wear fixed faces. */
const SCOUT_MODEL = {
  baseUrl: '/models/chog-base.glb',
  partsUrl: '/models/trait-parts.json',
  colorsUrl: '/models/trait-colors.json',
  skinsUrl: '/models/skins.json',
  skullBaseUrl: '/models/chog-skull.glb',
  skullSkinsUrl: '/models/skull-skins.json',
};
const SCOUT_TOKEN = 4242;

/** Trailhead canvas, dyed the way each region dyes cloth. */
const TENT_CANVAS: Record<RegionId, number> = {
  tolls: 0x8a6f4d,
  ashpine: 0x5f564c,
  marsh: 0x51684f,
  relay: 0x5c6b7d,
  causeway: 0x5c6a70,
  static: 0x4c4666,
};

/**
 * The Line, rebuilt from the ground up.
 *
 * The first renderer drew one flat quad with a 128-pixel canvas sheet tiled 14×14 across it — one
 * cell of noise per thirty metres of dirt — and then stood the camera forty-seven metres up. A flat
 * surface, a texture too small to resolve, and a camera too far to see either is not a bad map, it
 * is no map: every one of those three faults alone would flatten it, and together they produced a
 * purple floor. Patching any one of them was patching a symptom.
 *
 * So this file starts from the opposite assumptions:
 *
 *  1. **The ground has relief.** A plane with real displacement. Relief is the single property that
 *     makes a surface read as ground rather than as a floor — a flat quad cannot do it at any
 *     texture resolution, because a texture on a flat quad is a picture of a floor.
 *  2. **Colour comes from the geometry.** Vertex colours mix ground, high-ground and rock by height
 *     and by slope, so a hillside is visibly a hillside without a single extra texture lookup. A
 *     slope that is a different colour from the flat is the cheapest readable terrain there is.
 *  3. **The road is a thing.** The Line is a road. It gets its own strip with its own material,
 *     slightly proud of the terrain, and the walk runs along it — which is what tells a player
 *     where to go without a marker.
 *  4. **Props are solids, not boxes.** Cones taper, trunks taper, rocks are lumpy. A silhouette that
 *     does not taper reads as architecture at any distance.
 */

/** How many ground cells across the region. 128² over 420 units is a 3.3 m cell — enough relief. */
const GROUND_SEG = 128;
/** How far the terrain lifts at its highest, in metres. Small on purpose: a hill you cannot see
 *  over is a wall, and a wall in a forest is geometry the walk has to agree with. */
const RELIEF = 2.6;
/** World units per tiling of the detail sheet. Small, so the grain survives a close camera. */
const TILE = 3;

/** One standing mob: the region's own fauna on a map handle. */
interface MobFigure {
  group: THREE.Group;
  avatar: BossAvatar;
  /** `region|kind|element`: a respawned or re-rolled body rebuilds rather than inheriting colours. */
  key: string;
  /** Set once `die()` runs, so the corpse plays out instead of freezing mid-frame. */
  dying: boolean;
}

/**
 * Deterministic value noise on a lattice.
 *
 * No `Math.random` anywhere: the terrain has to be the same on every client and on every reload,
 * because `groundY` is the walk's referee and a client whose hill disagrees with its own collision
 * is a client the player falls through.
 */
function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise, two octaves. Cheap, and the second octave is what stops it looking like a grid. */
function noise(x: number, z: number, s: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, s);
  const b = hash2(xi + 1, zi, s);
  const c = hash2(xi, zi + 1, s);
  const d = hash2(xi + 1, zi + 1, s);
  const coarse = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  const e = hash2(xi * 2, zi * 2, s + 91);
  const f = hash2(xi * 2 + 1, zi * 2, s + 91);
  const g = hash2(xi * 2, zi * 2 + 1, s + 91);
  const h2 = hash2(xi * 2 + 1, zi * 2 + 1, s + 91);
  const fine = e + (f - e) * u + (g - e) * v + (e - f - g + h2) * u * v;
  return coarse * 0.72 + fine * 0.28;
}

/** The terrain height at a world point. The walk and the mesh read the SAME function. */
function terrainAt(x: number, z: number, salt: number): number {
  const u = (x + REGION_SIZE / 2) / 46;
  const v = (z + REGION_SIZE / 2) / 46;
  const n = noise(u, v, salt) * 0.7 + noise(u * 2.7, v * 2.7, salt + 17) * 0.3;
  // Flatten toward the region's edges so the walk never runs into a cliff at the boundary.
  const edge = Math.min(1, Math.min(Math.abs(x), Math.abs(z)) / (REGION_SIZE * 0.34));
  return (n - 0.5) * RELIEF * (0.35 + 0.65 * Math.min(1, edge));
}

/**
 * The road's centreline.
 *
 * The curve lives in `shared/src/line/layout.ts` (`roadXAt`): the sites, the spawn, the prop
 * clearing and this ribbon all read the same function, so encounters stand on the road the
 * player sees instead of far off it.
 */
const roadX = (region: RegionId, z: number): number => roadXAt(region, z);
const roadHalf = (region: RegionId, z: number): number => roadHalfAt(z, region);

/** The detail sheet: a small, high-contrast tile of ground grain. Painted once per region. */
function groundSheet(salt: number, base: number, high: number): THREE.Texture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${base.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, S, S);
  // Grain, then a second lighter pass. Two passes is what gives a tile depth at a small world
  // scale — one pass reads as static, two read as dirt.
  for (let i = 0; i < 2600; i++) {
    const x = hash2(i, 3, salt) * S;
    const y = hash2(i, 7, salt) * S;
    const r = 0.6 + hash2(i, 11, salt) * 2.1;
    g.fillStyle = hash2(i, 13, salt) < 0.5
      ? `rgba(0,0,0,${0.05 + hash2(i, 17, salt) * 0.16})`
      : `rgba(${(high >> 16) & 255},${(high >> 8) & 255},${high & 255},${0.1 + hash2(i, 19, salt) * 0.3})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(REGION_SIZE / TILE, REGION_SIZE / TILE);
  t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export interface MobView {
  id: string;
  encounterId: string;
  region: RegionId;
  name: string;
  kind: string;
  /**
   * Patrol anchor and radius: the figure runs `mobAt` on these every frame. Optional because
   * the wire can predate them (an older server): anything missing falls back to the `x`/`z`
   * snapshot below, which is always sent.
   */
  home?: { x: number; z: number };
  roam?: number;
  element: string;
  /** The duel avatar this body wears — the same one its fight opens. */
  archetype: string;
  /** Region tier (1..6), so the map figure matches the duel it opens. */
  tier: number;
  x: number;
  z: number;
  /** Radians, so two clients show the same body facing the same way. */
  facing: number;
  alive: boolean;
}

export interface LineScene {
  layout: LineLayout;
  group: THREE.Group;
  chunks: Chunk[];
  groundY(x: number, z: number): number;
  update(t: number, focus: THREE.Vector3, mobs: readonly MobView[], foe?: { x: number; z: number }): void;
  dispose(): void;
}

/**
 * Build the region: terrain, road, and everything standing on it.
 *
 * Everything here is generated from the region id and nothing else, so the same region is the same
 * place for every player and on every reload — which matters more than it sounds, because a mob
 * spawn and a collision box both have to agree with the hill they are standing on.
 */
export function buildLineScene(region: RegionId): LineScene {
  const l = lineLayout(region);
  const b = BIOMES[region];
  const salt = region.length * 7919 + region.charCodeAt(0) * 131;

  const group = new THREE.Group();
  group.name = `line:${region}`;
  const disposables: { dispose(): void }[] = [];

  // ── terrain ────────────────────────────────────────────────────────────────────────────────
  // A real displaced plane, vertex-coloured by height and slope. One mesh, one material, no
  // per-vertex logic at runtime: the colour is baked at build and the height is a closed form the
  // walk can call a thousand times a second.
  const geo = new THREE.PlaneGeometry(REGION_SIZE, REGION_SIZE, GROUND_SEG, GROUND_SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const groundCol = new THREE.Color(b.ground);
  const highCol = new THREE.Color(b.groundHigh);
  const rockCol = new THREE.Color(b.rock);
  const colours = new Float32Array(pos.count * 3);
  const tint = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainAt(x, z, salt);
    pos.setY(i, h);

    // Slope from the neighbours, so a steep face picks up rock without a normal pass.
    const dh = Math.abs(terrainAt(x + 1.6, z, salt) - h) + Math.abs(terrainAt(x, z + 1.6, salt) - h);
    const steep = Math.min(1, dh / 1.1);
    const up = Math.min(1, Math.max(0, (h + RELIEF * 0.5) / RELIEF));
    tint.copy(groundCol).lerp(highCol, up * 0.85).lerp(rockCol, steep * 0.7);
    colours[i * 3] = tint.r;
    colours[i * 3 + 1] = tint.g;
    colours[i * 3 + 2] = tint.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();

  const detail = groundSheet(salt + 5, b.ground, b.groundHigh);
  disposables.push(detail);
  const groundMat = new THREE.MeshLambertMaterial({ map: detail, vertexColors: true });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = false;
  ground.name = 'ground';
  group.add(ground);
  disposables.push(groundMat, geo);

  // ── the road ───────────────────────────────────────────────────────────────────────────────
  // Its own strip, proud of the terrain by a few centimetres so it never z-fights the hillside it
  // crosses. A ribbon rather than a long box: the meander is the whole point.
  const roadMat = new THREE.MeshLambertMaterial({ color: b.rock, vertexColors: false });
  const ribbon = new THREE.BufferGeometry();
  const rp: number[] = [];
  const rc: number[] = [];
  const ri: number[] = [];
  const STEPS = 220;
  const roadTint = new THREE.Color(b.groundHigh).lerp(new THREE.Color(0xffffff), 0.22);
  for (let i = 0; i <= STEPS; i++) {
    const z = -REGION_SIZE / 2 + (REGION_SIZE * i) / STEPS;
    const cx = roadX(region, z);
    const hw = roadHalf(region, z);
    // Walk the two edges, offset along the road's own tangent so the strip keeps its width on a bend.
    const dz = 0.6;
    const tx = (roadX(region, z + dz) - roadX(region, z - dz)) / (2 * dz);
    const len = Math.hypot(tx, 1);
    const nx = 1 / len;
    const nz = -tx / len;
    for (const side of [-1, 1]) {
      const ex = cx + nx * hw * side;
      const ez = z + nz * hw * side;
      rp.push(ex, terrainAt(ex, ez, salt) + 0.06, ez);
      rc.push(roadTint.r, roadTint.g, roadTint.b);
    }
  }
  for (let i = 0; i < STEPS; i++) {
    const a = i * 2;
    ri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  ribbon.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  ribbon.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  ribbon.setIndex(ri);
  ribbon.computeVertexNormals();
  const roadMesh = new THREE.Mesh(ribbon, new THREE.MeshLambertMaterial({ vertexColors: true }));
  roadMesh.name = 'road';
  group.add(roadMesh);
  disposables.push(ribbon, roadMesh.material as THREE.Material);

  // ── detail: props, road dressing, sites, landmark, horizon ──────────────────────────────
  // Every solid poured as the shape its kind names, then everything else that makes six
  // regions read as six places. `detail.ts` owns the builders; the batcher owns the draws.
  const B = new ChunkBatcher({ chunk: 100 });
  const dctx = { region, salt, layout: l, groundY: (x: number, z: number): number => terrainAt(x, z, salt) };
  pourStaticDetails(B, group, dctx);

  const detailMap = new THREE.CanvasTexture(document.createElement('canvas'));
  detailMap.dispose();
  const bark = new THREE.MeshLambertMaterial({ color: b.bark });
  const leaf = new THREE.MeshLambertMaterial({ color: b.leaf });
  const rock = new THREE.MeshLambertMaterial({ color: b.rock });
  const water = new THREE.MeshLambertMaterial({ color: b.waterColour, transparent: true, opacity: 0.82 });
  const pale = new THREE.MeshLambertMaterial({ color: 0xe8e0d0 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x707a88 });
  const cloth = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  const lit = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  // The city's shader language: the see-through hole around the player on everything standing
  // up, wind sway on the canopies and banners, shimmer on the water, glow on the lit pieces.
  // Keys name programs and must never match a city key, or the two recipes would share one program.
  patch(bark, 'line-bark', { hole: true, sway: true });
  patch(leaf, 'line-leaf', { hole: true, sway: true });
  patch(rock, 'line-rock', { hole: true });
  patch(water, 'line-water', { water: true });
  patch(pale, 'line-pale', { hole: true });
  patch(metal, 'line-metal', { hole: true });
  patch(cloth, 'line-cloth', { hole: true, sway: true });
  patch(lit, 'line-lit', { glow: true });
  disposables.push(bark, leaf, rock, water, pale, metal, cloth, lit);

  const built = B.build(
    { ground: groundMat, bark, leaf, rock, water, pale, metal, cloth, lit } as unknown as Record<MatKey, THREE.Material>,
    { ground: { cast: false, receive: true } },
  );
  group.add(built.group);

  // ── water ─────────────────────────────────────────────────────────────────────────────────
  // A single plane at the biome's own level, where the biome wants one. It sits under the walk's
  // own test — `groundY` returns the water height there, so wading is walking, not falling through.
  let waterMesh: THREE.Mesh | null = null;
  if (WATER_REGIONS.has(region)) {
    const wg = new THREE.PlaneGeometry(REGION_SIZE, REGION_SIZE);
    wg.rotateX(-Math.PI / 2);
    waterMesh = new THREE.Mesh(wg, water);
    waterMesh.position.y = WATER_LEVEL[region];
    waterMesh.name = 'water';
    group.add(waterMesh);
    disposables.push(wg);
  }

  // ── trailhead camp ──────────────────────────────────────────────────────────────────────────
  // Tents off the road, a fire, and the scout. A few dozen individual meshes for the whole camp,
  // placed from the same `campOf` the layout collides against, so canvas matches walk.
  let flameMesh: THREE.Mesh | null = null;
  let scout: Chog | null = null;
  let scoutAlive = true;
  {
    const camp = campOf(region);
    const tentMat = new THREE.MeshLambertMaterial({ color: TENT_CANVAS[region] });
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3d3227 });
    const logMat = new THREE.MeshLambertMaterial({ color: 0x4a3826 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, toneMapped: false });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7a3c, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, alphaMap: softDot });
    const cloakMat = new THREE.MeshLambertMaterial({ color: 0x5a4a6a });
    const tentGeo = new THREE.ConeGeometry(2.2, 3.2, 8);
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 4.4, 6);
    const logGeo = new THREE.CylinderGeometry(0.14, 0.14, 1.6, 6);
    const flameGeo = new THREE.SphereGeometry(0.42, 10, 8);
    const glowGeo = new THREE.PlaneGeometry(3.2, 3.2);
    const cloakGeo = new THREE.ConeGeometry(0.5, 1.6, 8);
    disposables.push(tentMat, poleMat, logMat, flameMat, glowMat, cloakMat);
    disposables.push(tentGeo, poleGeo, logGeo, flameGeo, glowGeo, cloakGeo);
    for (const tn of camp.tents) {
      const gy = terrainAt(tn.x, tn.z, salt);
      const tent = new THREE.Mesh(tentGeo, tentMat);
      tent.position.set(tn.x, gy + 1.6, tn.z);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(tn.x, gy + 2.2, tn.z);
      group.add(tent, pole, blob(tn.x, gy + 0.05, tn.z, 2.6));
    }
    const fy = terrainAt(camp.fire.x, camp.fire.z, salt);
    for (let li = 0; li < 3; li++) {
      const log = new THREE.Mesh(logGeo, logMat);
      log.position.set(camp.fire.x, fy + 0.18, camp.fire.z);
      log.rotation.set(Math.PI / 2, 0, (li / 3) * Math.PI);
      group.add(log);
    }
    flameMesh = new THREE.Mesh(flameGeo, flameMat);
    flameMesh.position.set(camp.fire.x, fy + 0.6, camp.fire.z);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(camp.fire.x, fy + 0.06, camp.fire.z);
    group.add(flameMesh, glow);
    const ny = terrainAt(camp.npc.x, camp.npc.z, salt);
    // A real Chog like the city's people: same loader, fixed token, same face every visit.
    // Async like the street — a small marker stands in until the model lands, and a disposed
    // scene never adopts it. The model shares the city's caches, so it is removed, not disposed.
    const marker = new THREE.Mesh(cloakGeo, cloakMat);
    marker.position.set(camp.npc.x, ny + 0.8, camp.npc.z);
    group.add(marker, blob(camp.npc.x, ny + 0.05, camp.npc.z, 1.0));
    const plate = nameplate(camp.npc.name, '#c98bff');
    plate.position.set(camp.npc.x, ny + 2.9, camp.npc.z);
    disposables.push(plate.material as { dispose(): void });
    group.add(plate);
    void loadChogNFT({ ...SCOUT_MODEL, traits: {}, tokenId: SCOUT_TOKEN })
      .then((c) => {
        if (!scoutAlive) return;
        group.remove(marker);
        scout = c;
        c.root.position.set(camp.npc.x, ny, camp.npc.z);
        c.root.scale.setScalar(CHOG_SCALE);
        c.root.rotation.y = Math.atan2(l.spawn.x - camp.npc.x, l.spawn.z - camp.npc.z);
        group.add(c.root);
      })
      .catch(() => undefined);
  }

  // ── sky, ground cover, motes ─────────────────────────────────────────────────────────────
  // The air above, the green below, and what drifts between. The wind is the mood's own:
  // the Static Line barely breathes and the Relay Flats never stop.
  buildSky(group, dctx, disposables);
  buildGroundCover(group, dctx, disposables);
  const motes = buildMotes(group, dctx, disposables);
  WU.uWind.value = moodOf(region).wind;

  // ── mobs ───────────────────────────────────────────────────────────────────────────────────
  // A pool keyed on the server's mob id. The server is the only authority on where a mob stands and
  // whether it is alive (`mobAt`), so this never predicts and never lerps toward a guess — it places
  // each figure exactly where the last message said. A figure that drifted would be a figure you
  // swing at and miss, and the ambush would fire somewhere the player is not standing.
  //
  // Each figure is its ladder species (`critters.ts buildCritter`), not the duel avatar:
  // mites near the trailhead, imps at the far end. The archetype still decides the fight the
  // body opens — the server reads it when the ambush fires — but the map shows the animal, and
  // the duel is where the signal puts its mask on. The figure owns its idle motion; the outer
  // group owns the map position and yaw.
  const mobFigures = new Map<string, MobFigure>();
  /** Each figure's chase anchor: same step as the server, kept per figure. */
  const figChase = new Map<string, ChaseAnchor | null>();
  let lastT = 0;

  const makeFigure = (m: MobView): MobFigure => {
    const g = new THREE.Group();
    g.name = `mob:${m.id}`;
    const avatar = buildCritter(m.region, m.kind, m.element || 'void', m.id, 'map', m.archetype || '');
    g.add(avatar.root);
    // Grounded like the city's people: a blob shadow that walks with the body.
    const shade = blob(0, 0.07, 0, 1.4);
    g.add(shade);
    group.add(g);
    return { group: g, avatar, key: `${m.region}|${m.kind}|${m.element}|${m.archetype || ''}`, dying: false };
  };

  return {
    layout: l,
    group,
    chunks: built.chunks,
    groundY(x: number, z: number): number {
      const h = terrainAt(x, z, salt);
      return waterMesh && Math.abs(x) < REGION_SIZE * 0.42 && Math.abs(z) < REGION_SIZE * 0.42
        ? Math.max(h, WATER_LEVEL[region] + 0.05)
        : h;
    },
    update(t: number, focus: THREE.Vector3, mobs: readonly MobView[], foeArg?: { x: number; z: number }): void {
      // The water breathes. One sine on one plane is the cheapest sign of life a map has.
      if (waterMesh) waterMesh.position.y = WATER_LEVEL[region] + Math.sin(t * 0.8) * 0.05;
      const dt = Math.min(0.05, Math.max(0.0001, t - lastT));
      lastT = t;
      // The city's clock and the hole around the player: same uniforms, same language.
      WU.uTime.value = t;
      WU.uPlayer.value.set(focus.x, 1.1, focus.z);
      // The scout breathes and the fire flickers.
      if (scout) scout.update(dt);
      if (flameMesh) {
        const fl = 1 + 0.12 * Math.sin(t * 9) + 0.06 * Math.sin(t * 23 + 1.7);
        flameMesh.scale.setScalar(fl);
      }
      motes.update(t, focus);

      // Reconcile against the server's list. Present figures are moved; absent ones are removed, so
      // a mob that dies or despawns leaves the road instead of standing there as a statue.
      //
      // Positions are LIVE: the server's snapshot only says where a body was when the message was
      // built, so each figure runs the same pure chase on the wall clock every frame — the same
      // function the server's ambush check runs, so the walk you see is the walk you bump into.
      // The foe is your boots, not the camera: the lens leads and lags, and a chase drawn
      // around it would disagree with the server's, which runs on reported position.
      const nowMs = Date.now();
      const foe = { x: (foeArg ?? focus).x, z: (foeArg ?? focus).z };


      const seen = new Set<string>();
      for (const m of mobs) {
        seen.add(m.id);
        let f = mobFigures.get(m.id);
        const wantKey = `${m.region}|${m.kind}|${m.element}|${m.archetype || ''}`;
        if (f && f.key !== wantKey) {
          group.remove(f.group);
          f.avatar.dispose();
          mobFigures.delete(m.id);
          f = undefined;
        }
        if (!m.alive) {
          // The corpse plays out: one `die()`, then the figure leaves once the avatar says so.
          if (f && !f.dying) { f.dying = true; f.avatar.die(); }
          if (f) f.avatar.update(dt, t, { phase: Math.min(4, Math.max(1, m.tier || 1)), warn: 0, hp: 0 });
          if (f && f.avatar.dead) {
            group.remove(f.group);
            f.avatar.dispose();
            mobFigures.delete(m.id);
          }
          continue;
        }
        if (!f) { figChase.delete(m.id); f = makeFigure(m); mobFigures.set(m.id, f); }
        if (f.dying) {
          // A respawned body is a new standing, not a corpse that stood back up mid-death.
          group.remove(f.group);
          f.avatar.dispose();
          figChase.delete(m.id);
          f = makeFigure(m);
          mobFigures.set(m.id, f);
        }
        // A poisoned entry must never freeze the frame: anything missing or non-finite
        // falls back to the snapshot, so one bad mob stands still instead of stopping the
        // camera (a throw here used to skip `follow` and `render` every frame).
        let px = m.x;
        let pz = m.z;
        let yaw = m.facing || 0;
        const hh = m.home;
        const rr = m.roam;
        if (hh && rr !== undefined && Number.isFinite(hh.x) && Number.isFinite(hh.z) && Number.isFinite(rr)) {
          const partial = { home: hh, roam: rr, region: m.region, chaseSpeed: chaseSpeedFor(m.archetype) } as MobSpawn;
          const r = chaseStep(figChase.get(m.id) ?? null, partial, nowMs, foe);
          figChase.set(m.id, r.anchor);
          if (Number.isFinite(r.x) && Number.isFinite(r.z)) {
            px = r.x;
            pz = r.z;

            yaw = r.facing;
          }
        }
        if (!Number.isFinite(px) || !Number.isFinite(pz)) continue;
        const y = terrainAt(px, pz, salt);
        f.group.position.set(px, y, pz);
        f.group.rotation.y = yaw;
        f.avatar.update(dt, t, { phase: Math.min(4, Math.max(1, m.tier || 1)), warn: 0, hp: 1 });
      }
      for (const [id, f] of [...mobFigures]) {
        if (seen.has(id)) continue;
        group.remove(f.group);
        f.avatar.dispose();
        mobFigures.delete(id);
        figChase.delete(id);
      }
    },
    dispose(): void {
      scoutAlive = false;
      // The scout shares the city's model caches: removed, never disposed.
      scout = null;
      flameMesh = null;
      WU.uWind.value = 1; // the city's trees sway on the default wind
      for (const d of disposables) d.dispose();
      // A chunk is `{ key, group, centre }` — the geometry lives on the merged meshes inside
      // `group`, not on the chunk. Reading `.geometry` off the chunk threw on every exit, which
      // skipped `restoreStreet()` mid-transition and left an empty (black) scene behind.
      for (const c of built.chunks) {
        c.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.geometry?.dispose();
        });
      }
      for (const f of mobFigures.values()) f.avatar.dispose();
      mobFigures.clear();
      group.clear();
    },
  };
}
