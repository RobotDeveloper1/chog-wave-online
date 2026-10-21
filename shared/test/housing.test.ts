import { describe, expect, it } from 'vitest';
import {
  FURNITURE,
  FURNITURE_IDS,
  HOUSE_D,
  HOUSE_MAX_ITEMS,
  HOUSE_SPAWN,
  HOUSE_W,
  STARTER_FURNITURE,
  emptyHouse,
  footprintOf,
  furnitureLines,
  pickupItem,
  placeItem,
  rotateItem,
  stockOf,
} from '../src/housing.ts';

/**
 * Housing: one room per Chog, furnished by its owner.
 *
 * The rules are all refusal-shaped: a forged placement can at worst waste the
 * sender's own click, because every put-down re-validates stock, bounds, the
 * doorway, the welcome mat and every other piece on the floor.
 */

const owned = (over: Record<string, number> = {}): Record<string, number> => ({ cot: 2, rug: 2, stool: 1, ...over });

describe('the catalogue', () => {
  it('prices every piece in WAV a road player can hold', () => {
    expect(FURNITURE_IDS.length).toBeGreaterThanOrEqual(10);
    for (const id of FURNITURE_IDS) {
      const def = FURNITURE[id]!;
      expect(def.price).toBeGreaterThan(0);
      expect(def.price).toBeLessThanOrEqual(300);
      expect(def.w).toBeGreaterThan(0);
      expect(def.d).toBeGreaterThan(0);
    }
  });

  it('starts a new roof with a bed and a rug', () => {
    expect(STARTER_FURNITURE.cot).toBe(1);
    expect(STARTER_FURNITURE.rug).toBe(1);
  });

  it('sells the catalogue as fixed-price shop lines', () => {
    const lines = furnitureLines();
    expect(lines.length).toBe(FURNITURE_IDS.length);
    for (const l of lines) {
      expect(l.kind).toBe('furniture');
      expect(l.price).toBe(FURNITURE[l.stockId]!.price);
      expect(l.limited).toBe(false);
    }
  });

  it('swaps the footprint on a quarter turn', () => {
    const table = FURNITURE.table!;
    expect(footprintOf(table, 0)).toEqual({ hw: table.w / 2, hd: table.d / 2 });
    expect(footprintOf(table, 1)).toEqual({ hw: table.d / 2, hd: table.w / 2 });
  });
});

describe('putting furniture down', () => {
  it('places a piece the owner holds', () => {
    const r = placeItem(emptyHouse(), owned(), 'cot', -4, -2, 0, 'u1');
    expect(r.ok).toBe(true);
    expect(r.house!.items).toEqual([{ uid: 'u1', fid: 'cot', x: -4, z: -2, rot: 0 }]);
    expect(stockOf(owned(), r.house!, 'cot')).toBe(1);
  });

  it('refuses what is not owned, and what ran out', () => {
    expect(placeItem(emptyHouse(), {}, 'cot', -4, -2, 0, 'u1').ok).toBe(false);
    const one = placeItem(emptyHouse(), owned(), 'stool', -4, -2, 0, 'u1');
    expect(one.ok).toBe(true);
    expect(placeItem(one.house!, owned(), 'stool', 0, -2, 0, 'u2').ok).toBe(false);
  });

  it('refuses the wall, the doorway and the welcome mat', () => {
    const o = owned();
    expect(placeItem(emptyHouse(), o, 'cot', HOUSE_W / 2, 0, 0, 'u1').reason).toBe('through the wall');
    expect(placeItem(emptyHouse(), o, 'cot', 0, 4, 0, 'u1').reason).toBe('not on the doorway');
    expect(placeItem(emptyHouse(), o, 'rug', HOUSE_SPAWN.x, HOUSE_SPAWN.z, 0, 'u1').reason).toBe('not on the welcome mat');
  });

  it('refuses a piece over another solid, but slides rugs under', () => {
    const o = owned();
    const cot = placeItem(emptyHouse(), o, 'cot', -4, -2, 0, 'u1').house!;
    expect(placeItem(cot, o, 'stool', -4, -2, 0, 'u2').reason).toBe('overlaps the furniture');
    expect(placeItem(cot, o, 'rug', -4, -2, 0, 'u3').ok).toBe(true);
  });

  it('refuses a duplicate uid and a full room', () => {
    const o = owned();
    const one = placeItem(emptyHouse(), o, 'rug', -4, -2, 0, 'u1').house!;
    expect(placeItem(one, o, 'rug', 0, -2, 0, 'u1').ok).toBe(false);
    const full = { items: Array.from({ length: HOUSE_MAX_ITEMS }, (_, i) => ({ uid: `f${i}`, fid: 'rug', x: 0, z: -4, rot: 0 })) };
    expect(placeItem(full, { rug: 99 }, 'rug', 2, -2, 0, 'ux').reason).toBe('the room is full');
  });

  it('picks a piece back up, freeing its stock', () => {
    const o = owned();
    const one = placeItem(emptyHouse(), o, 'stool', -4, -2, 0, 'u1').house!;
    expect(stockOf(o, one, 'stool')).toBe(0);
    const back = pickupItem(one, 'u1');
    expect(back.ok).toBe(true);
    expect(back.house!.items).toEqual([]);
    expect(stockOf(o, back.house!, 'stool')).toBe(1);
    expect(pickupItem(back.house!, 'nope').ok).toBe(false);
  });

  it('turns a piece in quarters, unless the turn would not fit', () => {
    const o = owned({ table: 2 });
    // A table near the east wall turns fine; shoved into the corner it does not.
    const one = placeItem(emptyHouse(), o, 'table', HOUSE_W / 2 - 1.6, -4, 0, 'u1').house!;
    const turned = rotateItem(one, 'u1');
    expect(turned.ok).toBe(true);
    expect(turned.house!.items[0]!.rot).toBe(1);
    const tight = placeItem(emptyHouse(), o, 'table', 0, -HOUSE_D / 2 + 1.3, 0, 'u2');
    expect(tight.ok).toBe(true);
    expect(rotateItem(tight.house!, 'u2').ok).toBe(false);
    expect(rotateItem(one, 'nope').ok).toBe(false);
  });
});
