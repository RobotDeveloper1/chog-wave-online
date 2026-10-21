import type { ShopLine } from './economy.ts';

/**
 * Housing: one room per Chog, furnished by its owner, visited by its friends.
 *
 * A house is data the server owns and the client draws: a list of placed furniture
 * on a 16x12 floor, the same footprint as every interior in `client/.../interiors.ts`,
 * so the existing player, collision and camera code walks it with no special cases.
 * Furniture is decor, full stop — no buffs, no rest XP, nothing that prices into a
 * fight. The day a lamp wins a duel is the day this file gets deleted.
 *
 * Ownership is stock: buying adds a unit, placing consumes one off the floor count,
 * picking up frees it. The profile holds `furniture` (owned counts) and `house`
 * (placed pieces); the difference is what the edit mode can still put down.
 */

export const HOUSE_W = 16;
export const HOUSE_D = 12;
/** How many pieces a room holds before it reads as a warehouse. */
export const HOUSE_MAX_ITEMS = 40;
export const HOUSE_SPAWN = { x: 0, z: 2.5 };
/** The exit mat stays walkable: no furniture parks on the doorway. */
const EXIT_KEEP = { x: 0, z: HOUSE_D / 2 - 0.8, hw: 1.8, hd: 0.9 };
/** And nothing spawns inside a wardrobe. Clear of the doorway, so each refusal is its own. */
const SPAWN_KEEP = { x: HOUSE_SPAWN.x, z: HOUSE_SPAWN.z, hw: 1.4, hd: 1.0 };
/** Walls eat the rim: pieces stand this far inside the shell. */
const WALL_INSET = 0.4;

export interface FurnitureDef {
  id: string;
  name: string;
  /** What it is, in the words the shop shows. */
  desc: string;
  /** Fixed WAV price. Decor holds still while cards ride the floor. */
  price: number;
  /** Footprint in units, before rotation. */
  w: number;
  d: number;
  /** False for rugs and posters: walked over, not around. */
  solid: boolean;
}

export const FURNITURE: Record<string, FurnitureDef> = {
  cot: { id: 'cot', name: 'BUNK COT', desc: 'sleep off the road, under your own roof', price: 65, w: 1.6, d: 2.6, solid: true },
  table: { id: 'table', name: 'SCRAP TABLE', desc: 'welded from a sign that used to lie', price: 95, w: 2.2, d: 1.4, solid: true },
  stool: { id: 'stool', name: 'STOOL', desc: 'one seat, no promises', price: 40, w: 0.8, d: 0.8, solid: true },
  lamp: { id: 'lamp', name: 'GLOW LAMP', desc: 'burns the same neon the street wastes', price: 55, w: 0.6, d: 0.6, solid: true },
  rug: { id: 'rug', name: 'THREADBARE RUG', desc: 'softens the concrete, hides nothing', price: 35, w: 2.6, d: 2.6, solid: false },
  plant: { id: 'plant', name: 'POTTED SPROUT', desc: 'the only green thing on the block', price: 45, w: 0.7, d: 0.7, solid: true },
  shelf: { id: 'shelf', name: 'TAPE SHELF', desc: 'your tapes, spine out, judged daily', price: 130, w: 2.4, d: 0.8, solid: true },
  crystal: { id: 'crystal', name: 'RESONANT CRYSTAL', desc: 'hums along with the wave boards', price: 210, w: 1.0, d: 1.0, solid: true },
  screen: { id: 'screen', name: 'STATIC SCREEN', desc: 'plays the districts weather, forever', price: 160, w: 1.8, d: 0.6, solid: true },
  trunk: { id: 'trunk', name: 'ROAD TRUNK', desc: 'everything you owned before the room', price: 85, w: 1.4, d: 0.9, solid: true },
  poster: { id: 'poster', name: 'GIG POSTER', desc: 'a band that never played here', price: 30, w: 1.2, d: 0.2, solid: false },
  throne: { id: 'throne', name: 'JUNKYARD THRONE', desc: 'for the chog who has everything else', price: 260, w: 1.6, d: 1.6, solid: true },
};

export const FURNITURE_IDS = Object.keys(FURNITURE);

/** What a new roof comes with: a bed and something soft under it. */
export const STARTER_FURNITURE: Record<string, number> = { cot: 1, rug: 1 };

export interface PlacedItem {
  uid: string;
  fid: string;
  x: number;
  z: number;
  /** Quarter turns clockwise, 0..3. Odd turns swap the footprint. */
  rot: number;
}

export interface HouseLayout {
  items: PlacedItem[];
}

export const emptyHouse = (): HouseLayout => ({ items: [] });

/** Half-extents of a piece at a rotation, for bounds and overlap. */
export function footprintOf(def: FurnitureDef, rot: number): { hw: number; hd: number } {
  return rot % 2 === 0 ? { hw: def.w / 2, hd: def.d / 2 } : { hw: def.d / 2, hd: def.w / 2 };
}

interface Rect {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.z - b.z) < a.hd + b.hd;

const placedCount = (house: HouseLayout, fid: string): number => house.items.filter((i) => i.fid === fid).length;

/** Units owned but not on the floor: what the edit mode can still put down. */
export function stockOf(owned: Record<string, number>, house: HouseLayout, fid: string): number {
  return Math.max(0, (owned[fid] ?? 0) - placedCount(house, fid));
}

function fit(house: HouseLayout, fid: string, x: number, z: number, rot: number, ignoreUid: string | null): { ok: boolean; reason?: string } {
  const def = FURNITURE[fid];
  if (!def) return { ok: false, reason: 'no such furniture' };
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: 'nowhere to stand' };
  if (!Number.isInteger(rot) || rot < 0 || rot > 3) return { ok: false, reason: 'it only turns in quarters' };
  const { hw, hd } = footprintOf(def, rot);
  const me: Rect = { x, z, hw, hd };
  if (Math.abs(x) + hw > HOUSE_W / 2 - WALL_INSET || Math.abs(z) + hd > HOUSE_D / 2 - WALL_INSET) {
    return { ok: false, reason: 'through the wall' };
  }
  if (overlaps(me, EXIT_KEEP)) return { ok: false, reason: 'not on the doorway' };
  if (overlaps(me, SPAWN_KEEP)) return { ok: false, reason: 'not on the welcome mat' };
  for (const it of house.items) {
    if (it.uid === ignoreUid) continue;
    const other = FURNITURE[it.fid];
    if (!other) continue;
    // Rugs slide under everything and posters hang over nothing: only two solids collide.
    if (!def.solid || !other.solid) continue;
    const o = footprintOf(other, it.rot);
    if (overlaps(me, { x: it.x, z: it.z, hw: o.hw, hd: o.hd })) return { ok: false, reason: 'overlaps the furniture' };
  }
  return { ok: true };
}

export function placeItem(
  house: HouseLayout,
  owned: Record<string, number>,
  fid: string,
  x: number,
  z: number,
  rot: number,
  uid: string,
): { ok: boolean; reason?: string; house?: HouseLayout } {
  if (house.items.length >= HOUSE_MAX_ITEMS) return { ok: false, reason: 'the room is full' };
  if (house.items.some((i) => i.uid === uid)) return { ok: false, reason: 'that piece is already down' };
  if (stockOf(owned, house, fid) <= 0) return { ok: false, reason: 'none left on the shelf' };
  const f = fit(house, fid, x, z, rot, null);
  if (!f.ok) return f;
  return { ok: true, house: { items: [...house.items, { uid, fid, x, z, rot }] } };
}

export function pickupItem(house: HouseLayout, uid: string): { ok: boolean; reason?: string; house?: HouseLayout } {
  if (!house.items.some((i) => i.uid === uid)) return { ok: false, reason: 'no such piece' };
  return { ok: true, house: { items: house.items.filter((i) => i.uid !== uid) } };
}

export function rotateItem(house: HouseLayout, uid: string): { ok: boolean; reason?: string; house?: HouseLayout } {
  const it = house.items.find((i) => i.uid === uid);
  if (!it) return { ok: false, reason: 'no such piece' };
  const rot = (it.rot + 1) % 4;
  const f = fit(house, it.fid, it.x, it.z, rot, uid);
  if (!f.ok) return f;
  return { ok: true, house: { items: house.items.map((i) => (i.uid === uid ? { ...i, rot } : i)) } };
}

/** The furniture counter: fixed catalogue, fixed price. Decor holds still. */
export function furnitureLines(): ShopLine[] {
  return FURNITURE_IDS.map((id) => {
    const def = FURNITURE[id]!;
    return { kind: 'furniture' as const, stockId: def.id, name: def.name, price: def.price, desc: def.desc, limited: false };
  });
}
