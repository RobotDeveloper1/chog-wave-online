import * as THREE from 'three';

import type { BossAvatar, BossState } from '../duel/boss.ts';
import { ELEMENT_HEX, clamp, laneZ } from '../duel/theme.ts';
import type { RegionId } from '@chog/shared';

/**
 * The Line's fauna: what a mob looks like standing on the road.
 *
 * These are deliberately **not** the duel avatars. The duel keeps its signals-and-chrome
 * look (`duel/boss.ts`); the map fields normal creatures — a mite, a bat, a wader, a bug,
 * a crab, a wisp — one family per region, sized by kind (drift < post < warden, and the
 * warden carries the family's crown). All primitives, no models, no textures: the same
 * recipe as the street's stand-ins, which is why a region's mobs read as belonging to it.
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
}

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
 * One standing mob: the region's own fauna, sized by kind, eyes in its element.
 *
 * `salt` (the mob id) desyncs the idle cycle, so two bodies of one drift breathe out of
 * step instead of like one animal with two shadows.
 */
export function buildCritter(
  region: RegionId, kind: string, element: string, salt: string, stage: 'map' | 'duel' = 'map',
): BossAvatar {
  const k = kindOf(kind);
  const size = SCALE[k];
  const phase = hashSalt(salt);
  const root = new THREE.Group();
  root.name = `critter:${region}:${kind}`;
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
  };
  FAMILIES[region](ctx);
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
      const hover = region === 'ashpine' || region === 'static';
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

