import * as THREE from 'three';

import type { BossAvatar, BossState } from '../duel/boss.ts';
import { ELEMENT_HEX, clamp, laneZ } from '../duel/theme.ts';
import type { RegionId } from '@chog/shared';

/**
 * The Line's fauna: what a mob looks like standing on the road.
 *
 * These are deliberately **not** the duel avatars. The duel keeps its signals-and-chrome
 * look (`duel/boss.ts`); the map fields the ladder's own fauna — a mite near the trailhead,
 * a walker further on, an imp at the far end — ten species across the six regions, sized by
 * kind (drift < post < warden, and the warden carries the brass). All primitives, no models,
 * no textures: the same recipe as the street's stand-ins. A species nobody has drawn falls
 * back to its region's family, so the roster fills in one creature at a time and a missing
 * animal never leaves the road empty.
 *
 * Two languages survive the translation, because the map still has to say what the fight
 * is: **eyes are the encounter's element** (white ball, glowing element pupil — the thing
 * `mobs.ts` means by "the fight reads before it starts") and **wardens wear the brass**.
 * Everything else is the family's own silhouette.
 *
 * Same `BossAvatar` contract as the duel figures, so `render.ts` reconciles these exactly
 * the way it reconciled those: `root` is placed by the outer group, `update` idles, `die`
 * plays the corpse out. In `'duel'` stage the same animal fights on the arena floor instead:
 * it owns its root like the signal avatars do (file glide, lunge, warn gather), because the
 * duel adds a lane delta to `root.position.z` every frame and anything that does not own
 * its root absolutely drifts to infinity.
 */

type Kind = 'drift' | 'post' | 'warden';

const SCALE: Record<Kind, number> = { drift: 1, post: 1.45, warden: 2.2 };

interface Ctx {
  body: THREE.Group;
  /** Plain body paint, per family. */
  paint: (color: number) => THREE.MeshLambertMaterial;
  /** The element's own glow, for pupils and lit bits. */
  glow: THREE.MeshBasicMaterial;
  white: THREE.MeshLambertMaterial;
  eyes: THREE.Object3D[];
  extras: ((t: number) => void)[];
  phase: number;
  warden: boolean;
  eyeY: number;
  baseY: number;
  /** Floaters bob high and slow; walkers stay on their feet. */
  hover: boolean;
}

const ball = (r: number, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
};

const stick = (
  r: number, h: number, mat: THREE.Material, x: number, y: number, z: number,
  rx = 0, rz = 0,
): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, h, 6), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, 0, rz);
  return m;
};

const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
};

const cone = (r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
};

/** A pair of eyes: white balls, glowing element pupils, facing +Z. */
function eyes(c: Ctx, spread: number, y: number, z: number, r: number): void {
  for (const s of [-1, 1]) {
    const w = ball(r, c.white, s * spread, y, z);
    const p = ball(r * 0.45, c.glow, s * spread, y, z + r * 0.8);
    c.eyes.push(w);
    c.body.add(w, p);
  }
  c.eyeY = y;
}

function mite(c: Ctx): void {
  const rust = c.paint(0x7a5230);
  const dark = c.paint(0x5a3d22);
  c.body.add(ball(0.55, rust, 0, 0.45, 0, 1.15, 0.65, 1.35));
  c.body.add(ball(0.4, dark, 0, 0.62, -0.1, 1.0, 0.5, 1.1));
  for (const sx of [-1, 1]) {
    for (const z of [-0.4, 0, 0.4]) {
      c.body.add(stick(0.06, 0.5, dark, sx * 0.5, 0.25, z, 0, -sx * 0.5));
    }
    c.body.add(stick(0.03, 0.5, dark, sx * 0.2, 0.78, 0.55, -0.5, 0));
    c.body.add(ball(0.05, dark, sx * 0.2, 1.0, 0.68));
  }
  eyes(c, 0.22, 0.62, 0.62, 0.11);
  if (c.warden) {
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.09, 8, 18), c.paint(0xd8a03c));
    crown.position.set(0, 1.02, 0);
    crown.rotation.set(Math.PI / 2 - 0.2, 0, 0.15);
    c.body.add(crown);
  }
  c.baseY = 0;
}

function cinderbat(c: Ctx): void {
  const char = c.paint(0x2e2622);
  const membrane = new THREE.MeshLambertMaterial({ color: 0x1c1616, side: THREE.DoubleSide });
  c.body.add(ball(0.5, char, 0, 0.85, 0, 1, 1.35, 1));
  const wings: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.75), membrane);
    w.position.set(s * 0.8, 0.9, -0.05);
    c.body.add(w);
    wings.push(w);
  }
  c.extras.push((t) => {
    const flap = 0.25 + Math.sin(t * 9 + c.phase) * 0.55;
    wings[0]!.rotation.z = flap;
    wings[1]!.rotation.z = -flap;
  });
  for (const s of [-1, 1]) c.body.add(cone(0.12, 0.35, char, s * 0.2, 1.5, 0));
  eyes(c, 0.18, 1.05, 0.42, 0.1);
  if (c.warden) c.body.add(cone(0.12, 0.7, char, 0, 0.45, -0.5, 2.2, 0, 0));
  c.baseY = 0.15;
  c.hover = true;
}

function wader(c: Ctx): void {
  const bone = c.paint(0x9aa88f);
  const reed = c.paint(0x4e7a5e);
  for (const [x, z] of [[-0.25, 0.1], [0.25, 0.1], [0, -0.35]] as const) {
    c.body.add(stick(0.05, 1.3, bone, x, 0.65, z));
  }
  c.body.add(ball(0.45, reed, 0, 1.35, 0, 0.9, 0.75, 1.2));
  c.body.add(stick(0.09, 0.55, reed, 0, 1.7, 0.25, 0.3, 0));
  c.body.add(ball(0.22, reed, 0, 2.0, 0.38));
  const beak = cone(0.09, 0.45, bone, 0, 1.98, 0.62, Math.PI / 2, 0, 0);
  c.body.add(beak);
  eyes(c, 0.13, 2.05, 0.5, 0.07);
  if (c.warden) {
    for (let k = -1; k <= 1; k++) {
      c.body.add(cone(0.06, 0.3, bone, k * 0.12, 2.28, 0.3, -0.3 + k * 0.2, 0, 0));
    }
  }
  c.baseY = 0;
}

function staticbug(c: Ctx): void {
  const steel = c.paint(0x5c6b7d);
  const dark = c.paint(0x46525f);
  c.body.add(box(1.0, 0.55, 1.3, steel, 0, 0.55, 0));
  c.body.add(box(0.6, 0.4, 0.4, dark, 0, 0.6, 0.7));
  for (const sx of [-1, 1]) {
    for (const z of [-0.4, 0, 0.4]) c.body.add(box(0.12, 0.35, 0.12, dark, sx * 0.55, 0.18, z));
  }
  const tips: THREE.Mesh[] = [];
  const red = new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false });
  const antH = c.warden ? 1.1 : 0.8;
  for (const s of [-1, 1]) {
    c.body.add(stick(0.035, antH, dark, s * 0.2, 0.8 + antH / 2, 0.55));
    const tip = ball(0.08, red, s * 0.2, 0.85 + antH, 0.55);
    c.body.add(tip);
    tips.push(tip);
  }
  c.extras.push((t) => {
    const on = Math.sin(t * 4 + c.phase) > -0.2;
    for (const tip of tips) tip.visible = on;
  });
  eyes(c, 0.16, 0.65, 0.92, 0.09);
  c.baseY = 0;
}

function tidecrab(c: Ctx): void {
  const slate = c.paint(0x55606b);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.38, 12), slate);
  shell.position.set(0, 0.45, 0);
  c.body.add(shell);
  for (const s of [-1, 1]) {
    c.body.add(stick(0.09, 0.5, slate, s * 0.45, 0.4, 0.4, 1.0, 0));
    c.body.add(box(0.32, 0.22, 0.45, slate, s * 0.62, 0.35, 0.62));
    for (const z of [-0.3, 0, 0.3]) c.body.add(box(0.12, 0.3, 0.12, slate, s * 0.65, 0.15, z));
    c.body.add(stick(0.04, 0.4, slate, s * 0.2, 0.8, 0.35));
  }
  eyes(c, 0.2, 1.02, 0.35, 0.09);
  c.extras.push((t) => {
    const w = Math.sin(t * 6 + c.phase);
    c.body.rotation.z = w * 0.07;
    c.body.position.x = w * 0.06;
  });
  if (c.warden) {
    const pale = c.paint(0xd8d0b8);
    for (const [x, z] of [[-0.3, -0.1], [0.25, -0.25], [0, 0.25]] as const) {
      c.body.add(cone(0.12, 0.3, pale, x, 0.72, z));
    }
  }
  c.baseY = 0;
}

function nullwisp(c: Ctx): void {
  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.5, 0),
    new THREE.MeshLambertMaterial({ color: 0x2a2440, wireframe: true }),
  );
  shell.position.y = 1.0;
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), c.glow);
  core.position.y = 1.0;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x9a7ae0, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 8, 28), ringMat);
  ring.position.y = 1.0;
  c.body.add(shell, core, ring);
  const ring2 = c.warden
    ? new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.04, 8, 28), ringMat)
    : null;
  if (ring2) {
    ring2.position.y = 1.0;
    c.body.add(ring2);
  }
  c.extras.push((t) => {
    ring.rotation.x = t * 1.3 + c.phase;
    ring.rotation.y = t * 0.9;
    if (ring2) {
      ring2.rotation.x = -(t * 1.1 + c.phase);
      ring2.rotation.y = t * 0.7;
    }
    shell.rotation.y = t * 0.5 + c.phase;
    c.body.position.x = Math.sin(t * 13 + c.phase) * 0.06;
    c.body.position.z = Math.cos(t * 11 + c.phase) * 0.06;
  });
  eyes(c, 0.16, 1.0, 0.42, 0.08);
  c.baseY = 0.35;
  c.hover = true;
}

/** The walker's build: a tall tripod strider grazing by its own marsh-light. */
function strider(c: Ctx): void {
  const bark = c.paint(0x6b5a3e);
  const moss = c.paint(0x5a7a4e);
  for (const s of [-1, 1]) {
    c.body.add(stick(0.07, 1.7, bark, s * 0.28, 0.85, 0));
    c.body.add(ball(0.12, bark, s * 0.28, 0.08, 0.1));
  }
  c.body.add(ball(0.34, moss, 0, 1.75, 0, 1.2, 0.8, 1));
  c.body.add(stick(0.06, 0.6, bark, 0, 2.1, 0.15, 0.25, 0));
  c.body.add(ball(0.2, moss, 0, 2.42, 0.24));
  // The lamp: a marsh-light the walker grazes by, in the encounter's element.
  c.body.add(ball(0.09, c.glow, 0, 2.42, 0.46));
  eyes(c, 0.12, 2.46, 0.36, 0.07);
  if (c.warden) {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.07, 8, 20), c.paint(0xd8a03c));
    collar.position.set(0, 1.72, 0);
    collar.rotation.set(Math.PI / 2, 0, 0);
    c.body.add(collar);
  }
  c.baseY = 0;
}

/** The glitch's build: three stacked shards that never sit still. */
function glitchcube(c: Ctx): void {
  const steel = c.paint(0x3a3f4a);
  const dark = c.paint(0x2a2e36);
  const a = box(0.7, 0.7, 0.7, steel, -0.12, 0.75, 0.05, 0.2);
  const b = box(0.5, 0.5, 0.5, dark, 0.25, 1.25, -0.1, -0.3);
  const d = box(0.34, 0.34, 0.34, steel, -0.05, 1.65, 0.12, 0.5);
  c.body.add(a, b, d);
  // Absolute offsets, never accumulated: adding the shiver would random-walk the shards
  // across the region over a minute.
  const shards = [a, b, d];
  const bases = shards.map((s) => s.position.clone());
  const seeds = [0, 2.1, 4.4];
  c.extras.push((t) => {
    shards.forEach((s, i) => {
      const base = bases[i]!;
      s.position.set(
        base.x + Math.sin(t * 17 + c.phase + seeds[i]!) * 0.05,
        base.y + Math.cos(t * 13 + c.phase * 2 + seeds[i]!) * 0.05,
        base.z,
      );
    });
  });
  eyes(c, 0.16, 1.25, 0.18, 0.08);
  if (c.warden) c.body.add(box(0.9, 0.12, 0.9, c.paint(0xd8a03c), 0, 0.32, 0, 0.2));
  c.baseY = 0.3;
  c.hover = true;
}

/** The husk's build: a bulky hollow shell that breathes through its mouth. */
function husk(c: Ctx): void {
  const bone = c.paint(0xb8a888);
  const hollow = c.paint(0x3a3226);
  c.body.add(ball(0.7, bone, 0, 0.5, 0, 1.25, 0.7, 1.35));
  // The hollow: a dark mouth the husk breathes through, ringed in bone.
  c.body.add(ball(0.3, hollow, 0, 0.42, 0.72, 1, 0.7, 0.5));
  for (const sx of [-1, 1]) {
    for (const z of [-0.45, 0.45]) c.body.add(ball(0.18, bone, sx * 0.7, 0.18, z));
  }
  c.body.add(cone(0.3, 0.5, bone, 0, 1.0, -0.3));
  eyes(c, 0.28, 0.72, 0.78, 0.1);
  if (c.warden) {
    for (let k = -2; k <= 2; k++) {
      c.body.add(cone(0.09, 0.45, bone, k * 0.3, 1.0, -0.55, -0.5, 0, 0));
    }
  }
  c.baseY = 0;
}

/** The surge's build: a breathing coil stack crowned with a live spark. */
function surge(c: Ctx): void {
  const coil = c.paint(0x4a5568);
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55 - i * 0.09, 0.06, 8, 24), coil);
    ring.position.y = 0.45 + i * 0.34;
    ring.rotation.x = Math.PI / 2;
    c.body.add(ring);
    rings.push(ring);
  }
  c.body.add(ball(0.2, c.glow, 0, 1.65, 0));
  c.body.add(cone(0.1, 0.4, c.glow, 0, 1.95, 0));
  // Breathe, not spin: a torus is radially symmetric, so rotating one is invisible.
  c.extras.push((t) => {
    rings.forEach((r, i) => {
      r.position.y = 0.45 + i * 0.34 + Math.sin(t * 3 + c.phase + i * 1.1) * 0.05;
    });
  });
  eyes(c, 0.15, 1.15, 0.4, 0.08);
  if (c.warden) {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 8, 28), c.paint(0xd8a03c));
    halo.position.y = 1.1;
    halo.rotation.x = Math.PI / 2;
    c.body.add(halo);
  }
  c.baseY = 0.25;
  c.hover = true;
}

/** The mirror's build: a standing glass the thing inside looks back out of. */
function mirror(c: Ctx): void {
  const frame = c.paint(0x2e2a3a);
  const glass = new THREE.MeshLambertMaterial({ color: 0xcfd8ea });
  c.body.add(box(0.9, 1.7, 0.12, glass, 0, 1.05, 0));
  for (const s of [-1, 1]) {
    c.body.add(box(0.1, 1.9, 0.16, frame, s * 0.5, 1.05, 0));
    c.body.add(box(0.16, 0.5, 0.16, frame, s * 0.35, 0.25, 0));
  }
  c.body.add(box(1.1, 0.1, 0.16, frame, 0, 2.0, 0));
  c.body.add(box(1.1, 0.1, 0.16, frame, 0, 0.12, 0));
  // The eyes float ON the glass: the thing in the mirror is looking back out.
  eyes(c, 0.2, 1.2, 0.1, 0.09);
  c.extras.push((t) => {
    c.body.rotation.y = Math.sin(t * 0.9 + c.phase) * 0.25;
  });
  if (c.warden) c.body.add(box(0.7, 1.3, 0.1, glass, 0.75, 1.0, -0.2, 0.5));
  c.baseY = 0;
}

/**
 * The ten things the ladder fields. Tolls opens on mites because the farm track is where
 * the game starts; every ladder climbs from there to something faster, tougher, or stranger
 * at the far end. Wardens are not here: the gate wears its region's family at warden scale.
 */
const SPECIES: Record<string, (c: Ctx) => void> = {
  mite,
  walker: strider,
  spark: staticbug,
  glitch: glitchcube,
  wisp: nullwisp,
  husk,
  imp: cinderbat,
  surge,
  front: tidecrab,
  mirror,
};

const FAMILIES: Record<RegionId, (c: Ctx) => void> = {
  tolls: mite,
  ashpine: cinderbat,
  marsh: wader,
  relay: staticbug,
  causeway: tidecrab,
  static: nullwisp,
};

const kindOf = (kind: string): Kind => (kind === 'warden' ? 'warden' : kind === 'post' ? 'post' : 'drift');

const hashSalt = (salt: string): number => {
  let h = 0;
  for (const ch of salt) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
};

/**
 * One standing mob: its ladder species, sized by kind, eyes in its element.
 *
 * `salt` (the mob id) desyncs the idle cycle, so two bodies of one drift breathe out of
 * step instead of like one animal with two shadows. An empty or unknown `species` falls
 * back to the region's family, which is what wardens wear on purpose.
 */
export function buildCritter(
  region: RegionId, kind: string, element: string, salt: string, stage: 'map' | 'duel' = 'map', species = '',
): BossAvatar {
  const k = kindOf(kind);
  const size = SCALE[k];
  const phase = hashSalt(salt);
  const root = new THREE.Group();
  root.name = `critter:${region}:${kind}:${species || 'wild'}`;
  const body = new THREE.Group();
  root.add(body);

  const glow = new THREE.MeshBasicMaterial({ color: ELEMENT_HEX[element] ?? 0xa874ff, toneMapped: false });
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f0ff });
  const ctx: Ctx = {
    body,
    paint: (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color }),
    glow,
    white,
    eyes: [],
    extras: [],
    phase,
    warden: k === 'warden',
    eyeY: 1,
    baseY: 0,
    hover: false,
  };
  const build = (species ? SPECIES[species] : undefined) ?? FAMILIES[region];
  build(ctx);
  body.scale.setScalar(size);

  let squash = 0;
  let dying = false;
  let dieT = 0;
  let dead = false;
  // Duel-only rig. `homeZ` is the signal avatars' own home lane: the duel shifts whatever
  // stands here onto the SF lane every frame, so standing anywhere else reads as the wrong
  // file before the first volley.
  const homeZ = laneZ(1) - 0.2;
  let targetX = 0;
  let vx = 0;
  let lungeT = 0;

  return {
    root,
    update(dt: number, t: number, s: BossState): void {
      const warn = stage === 'duel' ? clamp(s.warn, 0, 1) : 0;
      if (stage === 'duel') {
        // Glide to the target file with a little overshoot, which reads as weight —
        // the same spring the signal avatars use, so the swap changes the animal,
        // never the footwork.
        const dx = targetX - root.position.x;
        vx += dx * 60 * dt;
        vx *= Math.max(0, 1 - 9 * dt);
        root.position.x += vx * dt;
        let lungeZ = 0;
        if (lungeT > 0) {
          lungeT += dt;
          lungeZ = Math.sin(Math.min(lungeT / 0.32, 1) * Math.PI) * 1.5;
          if (lungeT > 0.34) lungeT = 0;
        }
        root.position.z = homeZ + lungeZ - warn * 0.6;
      }
      if (dying) {
        // The death clock starts on the first update after die(), in the scene's own
        // seconds — the wall clock lives in a different epoch and would pin p at 0.
        if (dieT < 0) dieT = t;
        const p = Math.min(1, (t - dieT) / 0.7);
        body.rotation.x = -p * 1.2;
        body.position.y = ctx.baseY - p * 0.35;
        body.scale.setScalar(size * (1 - p * 0.25));
        if (p >= 1) dead = true;
        return;
      }
      squash = Math.max(0, squash - dt * 5);
      const breathe = 1 + 0.025 * Math.sin(t * 2.2 + phase);
      // The wind-up has to be impossible to miss: the animal grows and its element eyes
      // flare before the strike, the same 400 ms the avatar spends gathering red.
      const charge = 1 + warn * 0.15 + Math.sin(t * 22) * warn * 0.03;
      body.scale.set(
        size * breathe * charge * (1 + squash * 0.06),
        size * breathe * charge * (1 - 0.25 * squash),
        size * breathe * charge * (1 + squash * 0.06),
      );
      const hover = ctx.hover;
      body.position.y = ctx.baseY + Math.sin(t * (hover ? 1.6 : 2.4) + phase) * (hover ? 0.14 : 0.05);
      const blink = ((t + phase) % 3.2 < 0.12 ? 0.15 : 1) * (1 + warn * 0.4);
      for (const e of ctx.eyes) e.scale.y = blink;
      for (const extra of ctx.extras) extra(t);
    },
    moveTo(x: number): void {
      // The map owns positions through the outer group; only the duel floor drives this.
      if (stage === 'duel') targetX = x;
    },
    hurt(power: number): void {
      squash = Math.max(squash, power);
    },
    lunge(): void {
      if (stage === 'duel') lungeT = 0.001;
    },
    die(): void {
      if (!dying) {
        dying = true;
        dieT = -1;
      }
    },
    get dead(): boolean {
      return dead;
    },
    eye(): THREE.Vector3 {
      return root.localToWorld(new THREE.Vector3(0, ctx.eyeY * size, 0.5));
    },
    dispose(): void {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) {
            for (const mm of mat) mm.dispose();
          } else {
            mat?.dispose();
          }
        }
      });
    },
  };
}

