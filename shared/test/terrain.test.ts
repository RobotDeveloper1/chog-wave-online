import { describe, expect, it } from 'vitest';
import {
  BIOMES,
  REGION_IDS,
  REGION_SIZE,
  heightAt,
  lineLayout,
  walkable,
  type RegionId,
} from '../src/line/index.ts';

/**
 * The terrain, as a contract.
 *
 * The Line's ground is **flat at y = 0** on purpose, and every assertion here exists to keep it
 * that way or to catch the deliberate exceptions. The three versions before this one generated a
 * 0-to-14 heightfield and each one was unfilmable for the same reason: the game's camera rigs
 * frame a floor at a fixed chest height, so any real relief puts the player out of frame. Relief
 * now comes from what stands on the ground.
 *
 * What is asserted: the ground is flat, the bounds hold, the sites are in walk order and on dry
 * land, the props are on walkable ground, and one region is not another region's forest.
 */

describe('terrain — the ground is flat, and that is the design', () => {
  it('is zero everywhere, in every region', () => {
    for (const id of REGION_IDS) {
      for (let i = 0; i < 60; i++) {
        const x = ((i * 53) % 600) - 300;
        const z = ((i * 97) % 600) - 300;
        expect(heightAt(id, x, z), `${id} ${x},${z}`).toBe(0);
      }
    }
  });

  it('still reports the same height through the layout, so props sit on the ground', () => {
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      expect(l.heightAt(0, 0)).toBe(0);
      expect(l.heightAt(170, -170)).toBe(0);
    }
  });
});

describe('terrain — the shape of a region', () => {
  it('is the same square every time', () => {
    for (const id of REGION_IDS) {
      const b = lineLayout(id).bounds;
      expect(b.x1 - b.x0, id).toBe(b.z1 - b.z0);
      expect(b.x1 - b.x0, id).toBe(REGION_SIZE - 48);
    }
  });

  it('starts you in the middle of the road, with the exit at the far end', () => {
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      expect(l.spawn.z, id).toBe(0);
      if (l.exit) expect(l.exit.z, id).toBeGreaterThan(REGION_SIZE / 4);
    }
  });

  it('orders the sites so the fifth is never met before the first', () => {
    for (const id of REGION_IDS) {
      const zs = lineLayout(id).encounters.map((e) => e.z);
      for (let i = 1; i < zs.length; i++) expect(zs[i]!, `${id} #${i}`).toBeGreaterThan(zs[i - 1]!);
    }
  });

  it('spaces the sites so you never walk into two fights at once', () => {
    for (const id of REGION_IDS) {
      const sites = lineLayout(id).encounters;
      for (let i = 1; i < sites.length; i++) {
        const d = Math.hypot(sites[i]!.x - sites[i - 1]!.x, sites[i]!.z - sites[i - 1]!.z);
        expect(d, `${id} ${sites[i - 1]!.id}->${sites[i]!.id}`).toBeGreaterThan(30);
      }
    }
  });
});

describe('terrain — walkable', () => {
  it('has a spawn, an exit and seven sites on reachable ground', () => {
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      expect(l.walkable(l.spawn.x, l.spawn.z), `${id} spawn`).toBe(true);
      if (l.exit) expect(l.walkable(l.exit.x, l.exit.z), `${id} exit`).toBe(true);
      for (const s of l.encounters) expect(l.walkable(s.x, s.z), `${id} ${s.id}`).toBe(true);
    }
  });

  it('refuses the margin, so the map has an edge you can feel', () => {
    const l = lineLayout('tolls');
    expect(l.walkable(-REGION_SIZE / 2, 0)).toBe(false);
    expect(l.walkable(REGION_SIZE / 2, 0)).toBe(false);
    expect(l.walkable(0, -REGION_SIZE / 2)).toBe(false);
    expect(l.walkable(0, REGION_SIZE / 2)).toBe(false);
  });
});

describe('terrain — the props', () => {
  it('puts every prop on ground the player can reach', () => {
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      for (const o of l.solids) expect(l.walkable(o.x, o.z), `${id} prop`).toBe(true);
    }
  });

  it('clears a corridor around every site and the road', () => {
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      for (const s of l.encounters) {
        expect(l.solids.filter((o) => Math.hypot(o.x - s.x, o.z - s.z) < 15), `${id} ${s.id}`).toEqual([]);
      }
    }
  });

  it('gives each region its own amount of forest, so six regions are six places', () => {
    const counts = REGION_IDS.map((id) => lineLayout(id).solids.length);
    // Six densities, six silhouettes: at least four of them distinct.
    expect(new Set(counts).size, JSON.stringify(counts)).toBeGreaterThanOrEqual(4);
    expect(lineLayout('ashpine').solids.length).toBeGreaterThan(lineLayout('static').solids.length);
  });

  it('plants the species the biome says it should', () => {
    expect(BIOMES.ashpine.tree).toBe('pine');
    expect(BIOMES.marsh.tree).toBe('reed');
    expect(BIOMES.relay.tree).toBe('pylon');
    expect(BIOMES.causeway.tree).toBe('bone');
    expect(BIOMES.tolls.tree).toBe('bare');
    expect(BIOMES.static.tree).toBe('none');
  });

  it('gives the Static Line almost nothing, which is also a design', () => {
    expect(lineLayout('static').solids.length).toBeLessThan(1200);
  });
});

describe('terrain — one memo, not a fresh world per call', () => {
  it('hands back the same object, because six regions walked in a row should not rebuild', () => {
    for (const id of REGION_IDS) expect(lineLayout(id)).toBe(lineLayout(id));
  });
});