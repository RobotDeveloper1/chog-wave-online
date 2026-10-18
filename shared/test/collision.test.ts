import { describe, expect, it } from 'vitest';
import { REGION_IDS, lineLayout } from '../src/line/index.ts';

/**
 * What you bump into has to be the thing you can see.
 *
 * The Line's first forest had every tree as a 1.8-metre collision box under a 0.42-metre trunk, so
 * the player stopped three-quarters of a metre short of nothing — at Ash Pine's density that is a
 * maze of invisible walls, and every step is a small betrayal of what the screen is showing. It
 * took three rewrites to name it, and the naming was the fix: **a solid's half-width is exactly
 * the half-width `render.ts` draws it at.**
 *
 * These assertions exist so the two sides cannot drift again. If the renderer's silhouette changes,
 * this fails and the collision is corrected with it — the only way they stay honest about each
 * other while neither can see the other.
 */

/** The widths `render.ts` draws: a 0.42 trunk, and a rock's slab at `halfW * 1.8` wide. */
const DRAWN = {
  treeHalf: 0.42 / 2,
  rockFactor: 0.9,
};

describe('the Line — collision matches the silhouette', () => {
  it('boxes a tree to the trunk it draws, not to a guess', () => {
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      for (const o of l.solids) {
        // Boulders and trailhead tents have their own silhouette tests; here only trees.
        if (o.kind === 'rock' || o.kind === 'tent') continue;
        expect(o.halfW, `${id} tree at ${Math.round(o.x)},${Math.round(o.z)}`).toBeLessThanOrEqual(DRAWN.treeHalf + 0.02);
        expect(o.halfD, `${id} tree at ${Math.round(o.x)},${Math.round(o.z)}`).toBeLessThanOrEqual(DRAWN.treeHalf + 0.02);
      }
    }
  });

  it('boxes a boulder to the slab it draws, and no wider', () => {
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      for (const o of l.solids) {
        if (o.kind !== 'rock') continue;
        const drawnHalf = o.halfW * DRAWN.rockFactor;
        expect(o.halfW, `${id} rock at ${Math.round(o.x)},${Math.round(o.z)}`).toBeLessThanOrEqual(drawnHalf * 1.15);
      }
    }
  });

  it('keeps a forest walkable — Ash Pine density still lets you walk a straight line', () => {
    const l = lineLayout('ashpine');
    let blocked = 0;
    let total = 0;
    for (let z = -150; z <= 150; z += 6) {
      for (let x = -150; x <= 150; x += 6) {
        total++;
        const here = l.solids.some((o) => Math.hypot(o.x - x, o.z - z) < o.halfW + 0.55);
        if (here) blocked++;
      }
    }
    // Under a sixth of the region un-passable at any given moment, which is a forest. Over that
    // is a maze, and that is what the original 1.8-metre boxes gave.
    expect(blocked / total, `blocked ${blocked} of ${total}`).toBeLessThan(0.16);
  });

  it('never walls an encounter site in', () => {
    for (const regionId of REGION_IDS) {
      const l = lineLayout(regionId);
      for (const s of l.encounters) {
        const near = l.solids.filter((o) => Math.hypot(o.x - s.x, o.z - s.z) < 15);
        expect(near, `${regionId} ${s.id}`).toEqual([]);
      }
    }
  });

  it('leaves a forest denser than the Static Line, which has almost nothing at all', () => {
    expect(lineLayout('ashpine').solids.length).toBeGreaterThan(lineLayout('static').solids.length * 2);
    expect(lineLayout('static').solids.length).toBeLessThan(1200);
  });
});