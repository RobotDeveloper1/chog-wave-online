import * as THREE from 'three';

import { lineLayout, type EncounterSite, type LineLayout, type RegionId } from '@chog/shared';
import { buildLineScene, type LineScene, type MobView } from './render.ts';
export type { MobView };
import type { WalkLayout } from '../player.ts';

/**
 * One region of the Line, as a place the player can stand in.
 *
 * **Same contract as `interiors.buildRoom` and `dungeon/field.ts`** — `group / solids / spawn /
 * bounds` — and that is why walking the Line works without touching `player.ts`. `stepPlayer`
 * was written against one shape of "here is the floor and here is what you bump into", and a
 * forest is that shape. This is the third place to say so out loud; the contract is stable enough
 * that a place can be added without touching the thing that walks in it.
 *
 * The bodies belong to `render.ts`, not here. Everything else about this field is the same job
 * the room and the dungeon field do — carry the walkable ground, hand back the nearest thing — so
 * the mob figures, their walk cycle and their colours are kept out of the place logic, where they
 * would only be a reason to keep two copies of "which mob is standing" in step.
 */
export interface LineField {
  region: RegionId;
  group: THREE.Group;
  solids: { x: number; z: number; halfW: number; halfD: number }[];
  spawn: { x: number; z: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  walk: WalkLayout;
  layout: LineLayout;
  /** Height of the ground at a point. `RemoteAvatars` needs it per frame per avatar. */
  groundY(x: number, z: number): number;
  /** Figures for the server's bodies. One call per `line.state`, never per frame. */
  setMobs(mobs: MobView[]): void;
  /** The sites, in walk order, with what each one is. */
  sites: EncounterSite[];
  update(t: number, focus: THREE.Vector3): void;
  dispose(): void;
}

/**
 * Solids within `reach` of a point. The batcher's chunk size, which is the granularity we keep.
 *
 * The region's own layout carries several thousand boxes and `resolveCollides` is a linear scan,
 * so the whole forest is never handed to `stepPlayer`. The set is re-scanned whenever the player
 * crosses a chunk boundary, which keeps the near set small and the far forest intact.
 */
function nearSolids(region: RegionId, x: number, z: number, reach: number) {
  const l = lineLayout(region);
  const out: { x: number; z: number; halfW: number; halfD: number }[] = [];
  for (const o of l.solids) {
    if (Math.abs(o.x - x) > reach || Math.abs(o.z - z) > reach) continue;
    out.push({ x: o.x, z: o.z, halfW: o.halfW, halfD: o.halfD });
  }
  return out;
}

const REACH = 90;

export function buildLineField(region: RegionId, _cleared?: readonly string[]): LineField {
  const l = lineLayout(region);
  const scene: LineScene = buildLineScene(region);
  const b = l.bounds;
  const bounds = { minX: b.x0, maxX: b.x1, minZ: b.z0, maxZ: b.z1 };

  /**
   * One array, mutated in place.
   *
   * Re-scanning *replaced* the array at first, and `walk` had been handed the reference — so the
   * player collided with the spawn area's trees forever and could not leave the first clearing.
   * Splicing keeps every holder on the same array.
   */
  const solids: { x: number; z: number; halfW: number; halfD: number }[] = [];
  let centred = l.spawn;
  const refill = (): void => {
    solids.length = 0;
    for (const o of nearSolids(region, centred.x, centred.z, REACH)) solids.push(o);
  };
  refill();

  /** The last bodies the server reported. The scene owns the figures; this owns the handoff. */
  let mobsSeen: MobView[] = [];

  return {
    region,
    layout: l,
    group: scene.group,
    solids,
    spawn: { ...l.spawn },
    bounds,
    walk: { solids, bounds, groundY: scene.groundY },
    groundY: scene.groundY,
    setMobs(mobs: MobView[]): void {
      // Overwrite, never blend. The server's `mobAt` is the only walk there is, so a figure that
      // lerped toward the position it already holds is a figure that ends up somewhere it is not.
      mobsSeen = mobs;
    },
    sites: l.encounters,
    update(t, focus) {
      if (Math.abs(focus.x - centred.x) > REACH * 0.45 || Math.abs(focus.z - centred.z) > REACH * 0.45) {
        centred = { x: focus.x, z: focus.z };
        refill();
      }
      scene.update(t, focus, mobsSeen);
    },
    dispose: () => scene.dispose(),
  };
}

