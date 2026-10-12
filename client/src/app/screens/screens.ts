import * as THREE from 'three';
import { inRect, type CityLayout, type Lot } from '@chog/shared';
import type { DistrictArt } from '../art.ts';
import { KERB } from '../city/ground.ts';
import { HouseAd, SCREEN_ASPECT, clipFor, drop, hold, loadPlaylist, textureFor, type Clip } from './content.ts';

/**
 * The screens of the city: LED telões in the squares, and outdoor boards on the tall fronts.
 *
 * Both play a clip from the playlist and show the house ad until one is ready. They are placed
 * from the plan rather than by hand, so every district gets them: a telão stands in each square,
 * on the edge that opens onto a street; an outdoor board goes on the front of the tallest
 * buildings that look onto a street. Each is a few boxes and two planes, so the set is a few
 * dozen draw calls.
 */

export interface ScreenSet {
  group: THREE.Group;
  /** Advance the house ad. The clips play on their own. */
  update(t: number): void;
  dispose(): void;
}

/** The direction a lot's front faces, indexed by `Lot.face` (quarter turns clockwise from north). */
const FRONT: Record<Lot['face'], [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };

/** A telão: a free-standing panel, `y` up to its middle, standing on a plinth. */
const TELAO = { w: 6.4, h: 3.6, y: 4 };
/** An outdoor board: the widest it gets, and how far it stands off the wall. */
const OUTDOOR = { maxW: 8.4, reach: 1.2 };

export function buildScreens(layout: CityLayout, art: DistrictArt): ScreenSet {
  const group = new THREE.Group();
  const ad = new HouseAd();
  const dark = new THREE.MeshLambertMaterial({ color: '#17151f' });
  const metal = new THREE.MeshLambertMaterial({ color: art.metal });
  const stone = new THREE.MeshLambertMaterial({ color: art.stone });
  const lamp = new THREE.MeshBasicMaterial({ color: art.accent, toneMapped: false });

  interface Slot {
    mat: THREE.MeshBasicMaterial;
    index: number;
  }
  const slots: Slot[] = [];
  const held: Clip[] = [];
  /** The clips on screen right now, and when to next check that they are still running. */
  const playing = new Set<Clip>();
  let nextNudge = 0;
  /** Screens still showing the house ad. The ad is only painted while there is one. */
  let onAd = 0;
  let disposed = false;

  const add = (parent: THREE.Object3D, m: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh => {
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  /** One screen: a single material shown on both of its faces, starting on the house ad. */
  const screen = (parent: THREE.Object3D, w: number, h: number, y: number, z: number): void => {
    const mat = new THREE.MeshBasicMaterial({ map: ad.tex, toneMapped: false });
    const geo = new THREE.PlaneGeometry(w, h);
    add(parent, new THREE.Mesh(geo, mat), 0, y, z);
    add(parent, new THREE.Mesh(geo, mat), 0, y, -z).rotation.y = Math.PI;
    slots.push({ mat, index: slots.length });
    onAd++;
  };

  /** A telão: plinth, two legs, a dark body with the panel on both faces, and a light along its top. */
  const telao = (x: number, z: number, theta: number): void => {
    const root = new THREE.Group();
    root.position.set(x, KERB, z);
    root.rotation.y = theta;
    group.add(root);
    const { w, h, y } = TELAO;
    const legTop = y - h / 2;
    add(root, box(2.6, 0.5, 1.3, stone), 0, 0.25, 0);
    for (const lx of [-w * 0.34, w * 0.34]) add(root, box(0.34, legTop - 0.5, 0.34, metal), lx, 0.5 + (legTop - 0.5) / 2, 0);
    add(root, box(w + 0.5, h + 0.5, 0.36, dark), 0, y, 0);
    add(root, box(w + 0.5, 0.14, 0.44, lamp), 0, y + h / 2 + 0.3, 0);
    screen(root, w, h, y, 0.2);
  };

  /** An outdoor board: wall-mounted on a tall front, standing off it on two struts, lit from the top. */
  const outdoor = (lot: Lot): void => {
    const [nx, nz] = FRONT[lot.face];
    const facade = nx !== 0 ? lot.d : lot.w;
    const wall = nx !== 0 ? lot.w / 2 : lot.d / 2;
    const w = Math.min(OUTDOOR.maxW, facade - 1.6);
    const h = w / SCREEN_ASPECT;
    const { reach } = OUTDOOR;
    const root = new THREE.Group();
    root.position.set(lot.x + nx * (wall + reach), lot.h - 1.4 - h / 2, lot.z + nz * (wall + reach));
    root.rotation.y = Math.atan2(nx, nz);
    group.add(root);
    add(root, box(w + 0.6, h + 0.6, 0.4, dark), 0, 0, -0.1);
    add(root, box(w * 0.9, 0.12, 0.3, lamp), 0, h / 2 + 0.36, 0.05);
    for (const sx of [-w * 0.3, w * 0.3]) add(root, box(0.24, 0.24, reach, metal), sx, -h / 2 - 0.3, -reach / 2);
    screen(root, w, h, 0, 0.22);
  };

  // ---------------------------------------------------------------------------
  // Where a screen stands
  //
  // The rule for both kinds is the same: it goes where there is *nothing*. Not on the Wave
  // Station forecourt, not over a door the game sends you to, not beside a person or in
  // front of a landmark. A board standing in front of the one building the whole game points
  // at is a board standing in front of that building, and it reads as clutter however good
  // the clip is — so every legal spot is scored by how far it is from everything a player is
  // sent to, and the emptiest ones win.
  // ---------------------------------------------------------------------------

  const onStreet = (x: number, z: number): boolean => !layout.blocks.some((b) => inRect(b.rect, x, z));
  const free = (x: number, z: number, r: number): boolean =>
    !layout.solids.some((s) => Math.abs(x - s.x) < s.halfW + r && Math.abs(z - s.z) < s.halfD + r);

  /** How far a spot is from the nearest landmark, door, person or spawn. Bigger is emptier. */
  const clearOfEverything = (x: number, z: number): number => {
    let near = Infinity;
    for (const lm of layout.landmarks) {
      // Measured from the footprint plus a little standing room: a board two metres off the
      // plinth of the clock tower is still a board on the clock tower. The Wave Station gets
      // a much wider berth, because it is the one building the whole game points at — and a
      // telão parked on its forecourt is exactly the sort of clutter that reads as "empilhado".
      const pad = lm.kind === 'waveStation' ? 24 : Math.max(lm.w, lm.d) / 2 + 3;
      near = Math.min(near, Math.hypot(lm.x - x, lm.z - z) - pad);
    }
    for (const a of layout.anchors) {
      // Mystery Waves are scattered everywhere on purpose and gates sit on the ring road;
      // neither is the sort of thing a board can be said to be standing in front of.
      if (a.kind === 'wave' || a.kind === 'gate') continue;
      near = Math.min(near, Math.hypot(a.x - x, a.z - z));
    }
    return near;
  };

  /** Where boards already stand, so no two end up competing for the same empty corner. */
  const placed: { x: number; z: number }[] = [];

  // Telões: every legal standing spot in the squares, emptiest first, three at most.
  const spots: { x: number; z: number; theta: number; score: number }[] = [];
  for (const c of layout.courts) {
    if (c.kind !== 'plaza' && c.kind !== 'market') continue;
    const { x0, z0, x1, z1 } = c.rect;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const w = x1 - x0;
    const d = z1 - z0;
    const edges = [
      { x: mx, z: z0, dx: 0, dz: 1, along: w, ux: 1, uz: 0 },
      { x: mx, z: z1, dx: 0, dz: -1, along: w, ux: -1, uz: 0 },
      { x: x0, z: mz, dx: 1, dz: 0, along: d, ux: 0, uz: 1 },
      { x: x1, z: mz, dx: -1, dz: 0, along: d, ux: 0, uz: -1 },
    ];
    // Every edge of a court opens onto pavement, so there is nothing to prefer here: the
    // only thing that picks a spot is how empty it is. (Checking "on the street" with a
    // three-unit margin lands exactly on the block boundary, which rules out all four.)
    for (const e of edges) {
      // Tucked toward a corner of the edge rather than dead centre, so a board never stands
      // square in the middle of the view down a street.
      for (const t of [0.3, 0.7]) {
        const off = (t - 0.5) * e.along;
        const px = e.x + e.ux * off + e.dx * 2.6;
        const pz = e.z + e.uz * off + e.dz * 2.6;
        if (!free(px, pz, 1.5)) continue;
        spots.push({ x: px, z: pz, theta: Math.atan2(e.dx, e.dz), score: clearOfEverything(px, pz) });
      }
    }
    // Plus the four corners, which is where a square has the most room round whatever
    // stands in its middle — a feature takes the centre, so the centre is never empty.
    for (const [cx0, cz0] of [[x0 + 2.6, z0 + 2.6], [x1 - 2.6, z0 + 2.6], [x0 + 2.6, z1 - 2.6], [x1 - 2.6, z1 - 2.6]] as const) {
      if (!free(cx0, cz0, 1.5)) continue;
      spots.push({ x: cx0, z: cz0, theta: Math.atan2(mx - cx0, mz - cz0), score: clearOfEverything(cx0, cz0) });
    }
  }
  spots.sort((a, b) => b.score - a.score);
  let telaos = 0;
  for (const s of spots) {
    if (telaos >= 3) break;
    // Below this it is standing on top of something that matters, so it goes nowhere at all.
    if (s.score < 7) continue;
    if (placed.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 34)) continue;
    telao(s.x, s.z, s.theta);
    placed.push({ x: s.x, z: s.z });
    telaos++;
  }

  // Outdoor boards: the emptiest tall fronts that look onto a street, two at most.
  const fronts: { lot: Lot; score: number }[] = [];
  for (const l of layout.lots) {
    if (l.h < 11) continue;
    const [nx, nz] = FRONT[l.face];
    const facade = nx !== 0 ? l.d : l.w;
    const wall = nx !== 0 ? l.w / 2 : l.d / 2;
    if (facade < 8.5) continue;
    const fx = l.x + nx * (wall + 4);
    const fz = l.z + nz * (wall + 4);
    if (!onStreet(fx, fz)) continue;
    fronts.push({ lot: l, score: clearOfEverything(fx, fz) });
  }
  fronts.sort((a, b) => b.score - a.score);
  let boards = 0;
  for (const f of fronts) {
    if (boards >= 2) break;
    if (f.score < 8) continue;
    if (placed.some((p) => Math.hypot(p.x - f.lot.x, p.z - f.lot.z) < 30)) continue;
    outdoor(f.lot);
    placed.push({ x: f.lot.x, z: f.lot.z });
    boards++;
  }

  // The clips arrive whenever the playlist has been read: each screen takes the next one in the list.
  void loadPlaylist().then((urls) => {
    if (disposed || urls.length === 0) return;
    for (const s of slots) {
      const url = urls[s.index % urls.length]!;
      const clip = clipFor(url);
      const show = (): void => {
        if (disposed) return;
        hold(clip);
        held.push(clip);
        playing.add(clip);
        s.mat.map = textureFor(clip);
        s.mat.needsUpdate = true;
        onAd--;
      };
      if (clip.el.readyState >= 2) show();
      else clip.el.addEventListener('loadeddata', show, { once: true });
      clip.el.addEventListener('error', () => console.warn(`[screens] could not play ${url}`), { once: true });
    }
  });

  return {
    group,
    update(t) {
      if (onAd > 0) ad.tick(t);
      // a hidden tab can pause a silent clip; once a second, put back any clip that has stopped
      const now = performance.now() / 1000;
      if (now >= nextNudge) {
        nextNudge = now + 1;
        for (const c of playing) if (c.el.paused) void c.el.play().catch(() => undefined);
      }
    },
    dispose() {
      disposed = true;
      playing.clear();
      for (const c of held) drop(c);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      for (const s of slots) s.mat.dispose();
      dark.dispose();
      metal.dispose();
      stone.dispose();
      lamp.dispose();
      ad.dispose();
    },
  };
}
