import * as THREE from 'three';
import { inRect, mulberry32, type CityLayout, type Lot } from '@chog/shared';
import type { DistrictArt } from '../art.ts';
import { buildScreens } from '../screens/screens.ts';
import { ChunkBatcher, type Chunk } from './batch.ts';
import { backdropLot, buildLot, contactShadow, type BuildEnv } from './buildings.ts';
import { KERB, buildGround } from './ground.ts';
import { buildLandmarks, type Dynamic, type DynamicState } from './landmarks.ts';
import { WU, makeMaterials, type Built } from './materials.ts';
import { buildProps } from './props.ts';
import { makeSignAtlas, type SignAtlas } from './signs.ts';
import { disposeTextures, makeTextures, type Textures } from './textures.ts';

/**
 * A district, built: plan in, scene out.
 *
 * The whole pass is: ground, buildings, landmarks, props, a skyline round the edge, then
 * one merge into chunked meshes. It runs once per district, on entering it, and costs a
 * noticeable fraction of a second — which is a fair price for a place.
 */

const CULL = 150;

export interface CityScene {
  layout: CityLayout;
  art: DistrictArt;
  group: THREE.Group;
  chunks: Chunk[];
  dynamic: Dynamic[];
  triangles: number;
  buildMs: number;
  /** Advance the clock, cull far chunks and move the animated landmarks.
   *  `player` is the Chog's own position; `focus` is the camera's look-at, which leads the
   *  player, so culling must follow the latter. The cars live in CityLife, not here. */
  update(t: number, dt: number, focus: THREE.Vector3, state: DynamicState): void;
  /** Ground height at a point: the pavement is a step above the road. */
  groundY(x: number, z: number): number;
  dispose(): void;
}

const NIGHT_GLOW: Record<string, number> = { ashflat: 1.05, voltgrid: 1.6, hollow: 0.85 };

/** The ring of buildings beyond the edge of the zone, seen only from inside it. */
function skyline(env: BuildEnv, layout: CityLayout): void {
  const { sector } = env;
  const r = mulberry32(layout.sector.length * 131 + 5);
  const e = layout.extent;
  // Heights are deliberately modest: a backdrop is a *horizon*, and the old 30–78 range on
  // Voltgrid put a wall of black towers taller than anything inside the zone right at the
  // edge, so the city read as enclosed rather than as part of something bigger.
  const [lo, hi]: [number, number] = sector === 'voltgrid' ? [16, 38] : sector === 'ashflat' ? [10, 22] : [9, 20];
  const make = (x: number, z: number, w: number, d: number, inward: 'N' | 'E' | 'S' | 'W'): void => {
    const lot: Lot = {
      id: `edge-${x.toFixed(0)}-${z.toFixed(0)}`,
      style: sector === 'voltgrid' ? 'tower' : 'tenement',
      x,
      z,
      w,
      d,
      h: lo + r() * (hi - lo),
      face: ({ N: 2, S: 0, E: 3, W: 1 } as const)[inward],
      seed: Math.floor(r() * 1e6),
      roof: 'flat',
      block: [-1, -1],
    };
    backdropLot(env, lot, inward);
  };
  // A real gap between the backdrop blocks: 0.4 units apart they fused into one continuous
  // slab of facade, which is what made the edge of every district a wall.
  const gap = 9;
  for (let x = e.x0 - 36; x < e.x1 + 36; ) {
    const w = 10 + r() * 12;
    const d = 11 + r() * 6;
    make(x + w / 2, e.z0 - gap - d / 2, w, d, 'S');
    make(x + w / 2, e.z1 + gap + d / 2, w, d, 'N');
    x += w + 4.5;
  }
  for (let z = e.z0 - 36; z < e.z1 + 36; ) {
    const d = 10 + r() * 12;
    const w = 11 + r() * 6;
    make(e.x0 - gap - w / 2, z + d / 2, w, d, 'E');
    make(e.x1 + gap + w / 2, z + d / 2, w, d, 'W');
    z += d + 4.5;
  }
}

export function buildCity(layout: CityLayout, art: DistrictArt): CityScene {
  const t0 = performance.now();
  const sector = layout.sector;
  const tex: Textures = makeTextures(art, sector);
  const built: Built = makeMaterials(art, tex);
  const labels = [...layout.lots.filter((l) => l.sign).map((l) => l.sign!), ...layout.anchors.filter((a) => a.kind === 'gate').map((a) => a.label), 'WAVE STATION'];
  const signs: SignAtlas = makeSignAtlas(labels, art);
  built.materials.signs = signs.material;
  built.flags.signs = { cast: false, receive: true };

  WU.uGlow.value = NIGHT_GLOW[sector] ?? 1;

  const B = new ChunkBatcher({ chunk: 40 });
  const env: BuildEnv = { B, art, sector, sign: (l) => signs.uv.get(l) ?? null };

  buildGround(B, layout, art);
  for (const lot of layout.lots) {
    buildLot(env, lot);
    contactShadow(env, lot.x, lot.z, lot.w, lot.d);
  }
  for (const lm of layout.landmarks) contactShadow(env, lm.x, lm.z, lm.w, lm.d, 1);
  const dynamic = buildLandmarks(env, layout.landmarks, layout.anchors, layout.extent.x1);
  buildProps(env, layout);
  skyline(env, layout);
  const screens = buildScreens(layout, art);

  const { group, chunks } = B.build(built.materials, built.flags);
  for (const d of dynamic) group.add(d.object);
  group.add(screens.group);

  const blocks = layout.blocks.map((b) => b.rect);
  const scene: CityScene = {
    layout,
    art,
    group,
    chunks,
    dynamic,
    triangles: B.triangles,
    buildMs: performance.now() - t0,
    update(t, dt, focus, state) {
      WU.uTime.value = t;
      screens.update(t);
      for (const c of chunks) {
        const dx = c.centre.x - focus.x;
        const dz = c.centre.z - focus.z;
        c.group.visible = dx * dx + dz * dz < (CULL + 30) * (CULL + 30);
      }
      for (const d of dynamic) d.update(t, dt, state);
    },
    groundY(x, z) {
      for (const r of blocks) if (inRect(r, x, z)) return KERB;
      return 0;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      screens.dispose();
      built.dispose();
      signs.dispose();
      disposeTextures(tex);
    },
  };
  return scene;
}
