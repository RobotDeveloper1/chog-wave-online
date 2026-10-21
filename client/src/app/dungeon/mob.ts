import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { dress, parseGlb, SHARED_MATERIALS } from '../chogLoader.ts';
import { glowTexture } from './glow.ts';
import { ELEMENT_HEX } from '../duel/theme.ts';

/**
 * The band, standing in the room, in the flesh.
 *
 * Until now a chamber with something in it was a floating gem on the floor -- the map knew a
 * monster was there and the room showed a marker. This puts the actual body in the room, out of
 * the same generated mesh the fight uses, so what you see in the corridor is what you meet on the
 * field. It is also the thing that makes the walk a decision instead of a corridor: a body can be
 * seen from a distance, read for where it is looking, and either avoided or walked into.
 *
 * Two rules carried over from `duel/mobModel.ts`, for the same reasons:
 *
 *   - The mesh is optional. No file, a bad download, or a mob nobody has generated yet all fall
 *     back to a body the field builds itself, so the roster fills in one creature at a time and a
 *     missing asset never leaves a room looking empty.
 *   - `dress` is the house style. A generated mesh arrives at whatever scale and origin the service
 *     felt like, with its own textures; dressing it keeps the toon ramp, the ink hull and the real
 *     base-colour map, so it lands next to the Chog instead of beside it.
 *
 * The preview exports Meshy returns are unrigged -- no skin, no clips -- so the body is animated by
 * transform: a breath, a lean, and a walk that is the whole body rocking. A rigged file, if one is
 * ever generated, plays its own idle instead and the transform work steps aside.
 *
 * ---------------------------------------------------------------------------------------------
 * Why behaviour and body are separate functions here.
 *
 * Only one of the twenty-seven mobs the six dungeons name has a generated mesh on disk, so the
 * "mesh is optional" rule above is not an edge case -- it is the normal path for five of the six
 * dungeons. That makes the fallback a load-bearing part of the game rather than a placeholder, and
 * it has to be a real creature: the ambush (`MOB_CATCH`) is what starts a fight when the band
 * catches you, and a body that is not there cannot catch anyone.
 *
 * So the state machine -- patrol, lock, charge, the ring that fills red -- is written once, in
 * `makeMob`, and takes a body as an argument. A generated mesh and a built-in echo are two ways to
 * produce that argument and nothing else. If the two ever diverged, the dungeon would play
 * differently depending on whether an art asset had been generated that week, which is the one
 * thing a fallback must never do.
 */

/** How far a body can see, before the forge widens it. */
export const MOB_NOTICE = 7.5;
/** How long it stands and stares before it commits. The window you are meant to read and back out of. */
export const MOB_LOCK_SECONDS = 0.9;
/** How close it has to get to start the fight. */
export const MOB_CATCH = 1.9;
const CHARGE_SPEED = 6.4;
/** How far past its own leash a body will chase before it gives up and walks home. */
const LEASH = 2.6;

export interface MobCtx {
  px: number;
  pz: number;
  /** Multiplied into the notice radius by the forge's own heat. */
  aggro: number;
  /** False when the room this body guards is cleared, unreachable, or a fight is already open. */
  live: boolean;
  /** True while the entry cinematic plays, so nothing hunts a player who cannot move yet. */
  held: boolean;
}

export interface MobState {
  /** 0 while it is unaware, 0..1 while it winds up. The tell the player reads. */
  lock: number;
  /** Set for a single frame, the moment the charge lands. */
  caught: boolean;
  /** Distance to the player, so the field can pick the nearest of a band. */
  dist: number;
  /** 'patrol' | 'lock' | 'charge', for the field to reason about. */
  mood: 'patrol' | 'lock' | 'charge';
}

export interface FieldMob {
  readonly root: THREE.Group;
  /** The node this body stands for: killing it is killing that room. */
  readonly nodeId: string;
  /** The body it was built from, so the field can tell a lead from a minion. */
  readonly mobId: string;
  /** True when a real generated mesh was loaded, false when this is a body the field built. */
  readonly real: boolean;
  update(dt: number, t: number, ctx: MobCtx): MobState;
  dispose(): void;
}

export interface FieldMobOpts {
  mobId: string;
  element: string;
  nodeId: string;
  home: { x: number; z: number };
  /** Unit vector the body walks along, and how far either side of home. */
  axis: { x: number; z: number };
  reach: number;
  role: 'lead' | 'minion';
  /** Staggers the patrol so a band of three does not move as one animal. */
  phase: number;
  /** A boss lead gets a heavier build, so the silhouette says "boss" before the health bar does. */
  boss?: boolean;
}

/**
 * How tall a body stands.
 *
 * A boss is its own size, not a lead with a crown on: the core of a fold is the thing the whole
 * run was walked for, and a body the same height as the ones in the corridor does not say that
 * from the doorway. Near five units against a two-unit Chog is the difference between "the last
 * room" and "another room".
 */
const HEIGHTS: Record<'lead' | 'minion' | 'boss', number> = { lead: 2.9, minion: 1.8, boss: 4.7 };

/** Everything `makeMob` needs that is not the rule: a body, and the numbers that keep it grounded. */
interface BodyParts {
  root: THREE.Group;
  /** The child the state machine animates. Its origin is between the feet. */
  body: THREE.Object3D;
  /** The uniform scale `body` was normalised to, and the offset that grounds it. */
  scale: number;
  baseY: number;
  anim: THREE.AnimationMixer | null;
  real: boolean;
  /** What this instance owns and must free: never the module's shared hull. */
  owned: { materials: THREE.Material[]; geometries: THREE.BufferGeometry[] };
}

/**
 * Build one body. Never resolves to null: a mob with no generated mesh gets an echo body instead,
 * so a room that has a band always has something standing in it.
 */
export async function buildFieldMob(opts: FieldMobOpts): Promise<FieldMob> {
  let gltf: GLTF | null = null;
  try {
    gltf = await parseGlb(`/mobs/${opts.mobId}.glb`);
  } catch {
    gltf = null;
  }
  return gltf ? realMob(opts, gltf) : echoMob(opts);
}

/** The generated mesh, dressed and normalised. */
function realMob(opts: FieldMobOpts, gltf: GLTF): FieldMob {
  const root = new THREE.Group();
  const body = cloneSkinned(gltf.scene) as THREE.Group;
  // flat: true keeps the facets, which is what makes a generated mesh read as low-poly instead of
  // as a smooth import. The texture the export carries is kept by `dress` and rides the toon ramp.
  dress(body, { solid: elementHex(opts.element), flat: true });
  const { scale, baseY } = normalise(body, opts.role, opts.boss);
  root.add(body);
  return makeMob(opts, {
    root, body, scale, baseY,
    anim: playIdle(root, gltf.animations ?? []),
    real: true,
    owned: collectOwned(body),
  });
}

// -------------------------------------------------------------------------------------------
// The echo: what stands in a room nobody has modelled yet.
//
// A fold that has been open long enough throws off copies of whatever is on the other side, and
// those copies are what a band is made of before anyone has sculpted the real thing. That is the
// fiction, and it is doing real work: it means the fallback is *allowed* to be a faceted shard of
// the room's own element, and it means the player is never looking at a grey debug capsule.
//
// Three builds, keyed off the mob id, so the six dungeons do not field one identical creature:
//
//   shard   a tapered skirt, a core, a crest          the default biped-ish thing
//   brute   wide, low, two heavy arms                 reads as "this one hits harder"
//   drifter no legs, a crown and orbiting motes       reads as "this one is not walking to you"
//
// All three are built from a handful of low-count primitives, dressed with the same toon ramp and
// ink hull the Chogs get, and lit from the room's own point light. They are cheap: a body is six
// meshes plus their hulls, and a ten-room dungeon fields at most thirty of them.
// -------------------------------------------------------------------------------------------

/** Element colour, taken down to dark stone for the body so the trims have something to burn against. */
function bodyHex(element: string): string {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(ELEMENT_HEX[element] ?? 0xa874ff).getHSL(hsl);
  return '#' + new THREE.Color()
    .setHSL(hsl.h, Math.min(1, hsl.s * 0.5), Math.max(0.07, hsl.l * 0.16))
    .getHexString();
}

/** The element at full strength, for the shards. The part that says which dungeon you are in. */
function accentHex(element: string): string {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(ELEMENT_HEX[element] ?? 0xa874ff).getHSL(hsl);
  return '#' + new THREE.Color()
    .setHSL(hsl.h, Math.min(1, hsl.s * 0.85), Math.min(0.68, hsl.l * 0.82 + 0.06))
    .getHexString();
}

/** The element at full brightness, for the eyes. The one part that must read across a dark room. */
function eyeColour(element: string): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(ELEMENT_HEX[element] ?? 0xa874ff).getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.7), Math.min(0.9, hsl.l * 0.7 + 0.34));
}

/** The element accent as a CSS-style hex, for the ring and the floor wash. */
function elementHex(element: string): string {
  return '#' + (ELEMENT_HEX[element] ?? 0xa874ff).toString(16).padStart(6, '0');
}

/** FNV-1a, so a mob id picks the same build on every machine and every reload. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function echoMob(opts: FieldMobOpts): FieldMob {
  const root = new THREE.Group();
  const g = new THREE.Group();
  // Two groups, because the body is two tones and `dress` paints everything it is handed one
  // colour. Dark stone for the mass, the element itself for the shards -- which is the whole
  // reason an echo is legible in a room that is already lit the colour of its own element.
  const core = new THREE.Group();
  const trim = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const placer = (parent: THREE.Group) =>
    (
      geo: THREE.BufferGeometry, x: number, y: number, z: number,
      rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1,
    ): void => {
      const m = new THREE.Mesh(geo, stone);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.scale.set(sx, sy, sz);
      parent.add(m);
    };
  const put = placer(core);
  const acc = placer(trim);

  const kind = hash(opts.mobId) % 3;
  /** Eyes sit on the front face; yaw 0 faces +z, which is what `atan2(dx, dz)` produces. */
  let eyes: [number, number, number];

  if (kind === 1) {
    // BRUTE. Weight at the bottom, a barrel torso, and a head you can pick out of the mass -- the
    // first pass had the torso so large that the whole thing read as a boulder with plates.
    put(new THREE.CylinderGeometry(0.3, 0.38, 0.6, 6), -0.3, 0.3, 0);
    put(new THREE.CylinderGeometry(0.3, 0.38, 0.6, 6), 0.3, 0.3, 0);
    put(new THREE.DodecahedronGeometry(0.62, 0), 0, 1.12, 0, 0, 0.4, 0, 1, 0.85, 0.8);
    put(new THREE.IcosahedronGeometry(0.29, 0), 0, 1.68, 0.02, 0.2, 0.3);
    acc(new THREE.IcosahedronGeometry(0.19, 0), 0, 1.6, 0.24, 0, 0, 0, 1, 0.7, 1);
    acc(new THREE.OctahedronGeometry(0.25, 0), -0.72, 1.08, 0, 0, 0, -0.75, 1, 1.5, 1);
    acc(new THREE.OctahedronGeometry(0.25, 0), 0.72, 1.08, 0, 0, 0, 0.75, 1, 1.5, 1);
    eyes = [0.16, 1.71, 0.26];
  } else if (kind === 2) {
    // DRIFTER. Nothing touches the floor, so the patrol sweep reads as floating rather than walking.
    put(new THREE.OctahedronGeometry(0.46, 0), 0, 1.15, 0, 0, 0, 0, 1, 1.5, 1);
    acc(new THREE.TetrahedronGeometry(0.36, 0), 0, 1.95, 0, 0, 0.4, 0.2);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      acc(new THREE.OctahedronGeometry(0.17, 0), Math.cos(a) * 0.62, i === 1 ? 1.0 : 0.72, Math.sin(a) * 0.62);
    }
    eyes = [0.17, 1.24, 0.36];
  } else {
    // SHARD. The default: a skirt, a core, a crest, and two shards off the shoulders.
    put(new THREE.ConeGeometry(0.52, 0.85, 5), 0, 0.425, 0, 0, Math.PI / 5);
    put(new THREE.IcosahedronGeometry(0.52, 0), 0, 1.15, 0, 0.3, 0.5);
    acc(new THREE.OctahedronGeometry(0.3, 0), 0, 1.78, -0.04, 0.15, 0, 0, 1, 1.75, 1);
    acc(new THREE.OctahedronGeometry(0.24, 0), -0.58, 1.22, 0.02, 0, 0, -0.55, 1, 1.3, 1);
    acc(new THREE.OctahedronGeometry(0.24, 0), 0.58, 1.22, 0.02, 0, 0, 0.55, 1, 1.3, 1);
    eyes = [0.18, 1.19, 0.42];
  }

  if (opts.boss) {
    // A crown, so a boss is a boss from across the room and not just a taller lead.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      acc(new THREE.OctahedronGeometry(0.22, 0), Math.cos(a) * 0.56, 1.58, Math.sin(a) * 0.56, 0, 0, 0.5);
    }
  }

  dress(core, { solid: bodyHex(opts.element), flat: true });
  dress(trim, { solid: accentHex(opts.element), flat: true });
  g.add(core, trim);

  // The eyes go on after both passes, because `dress` rewrites every material it finds and these
  // are the one thing that must stay unlit.
  const eyeMat = new THREE.MeshBasicMaterial({ color: eyeColour(opts.element), toneMapped: false });
  const eyeGeo = new THREE.IcosahedronGeometry(0.13, 0);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(s * eyes[0], eyes[1], eyes[2]);
    g.add(e);
  }

  const { scale, baseY } = normalise(g, opts.role, opts.boss);
  root.add(g);
  return makeMob(opts, {
    root, body: g, scale, baseY, anim: null, real: false,
    owned: collectOwned(g),
  });
}

// -------------------------------------------------------------------------------------------
// The rule. One implementation, whatever body it was handed.
// -------------------------------------------------------------------------------------------

/**
 * Locomotion for a body with no rig.
 *
 * Every mesh in a fold is either an unrigged preview export or a generated echo, so nothing on the
 * body can bend: a walk has to be read out of the pose of the whole thing. Three cues carry it, and
 * all three were missing:
 *
 *   1. a footfall the body *lands* on — the silhouette has to touch down, twice a cycle. The old
 *      bob was `|sin|`, which is ≥ 0 and therefore always ABOVE the floor: a hover, and a hover
 *      exactly where the golem was said to be "floating".
 *   2. a sway out of phase with the bob, so the body leans onto the planted foot;
 *   3. a lean into the acceleration, which is what makes a charge read as a lunge.
 *
 * The clock is the distance walked. A band sweeps a sine and charges, so its speed is never
 * constant — a gait clocked off the wall clock therefore desyncs from the ground the instant the
 * body changes pace, which is what "deslizando" actually is.
 */
interface Gait {
  /** Radians of phase. 2π is one cycle: two steps, two footfalls, two landings. */
  phase: number;
  /** Units per second the body travelled on the last frame. */
  speed: number;
}

interface GaitTune {
  /** World units between footfalls. Sets how fast the gait turns over at a given speed. */
  strideLen: number;
  /** How high the body rises between contacts, in world units. */
  rise: number;
  /** The speed at which the gait is at its full expression, units per second. */
  speedFull: number;
  /** Lateral sway in radians at full expression. */
  sway: number;
  /** Forward lean in radians at full expression. */
  lean: number;
}

interface GaitPose {
  /** Height above the pose the body rests at. Zero on every footfall. */
  y: number;
  /** Rotation about X — positive is forward. */
  pitch: number;
  /** Rotation about Z. */
  roll: number;
  /** Vertical scale: the body compresses into a landing. */
  squash: number;
  /** 1 exactly on a footfall, easing to 0. */
  thump: number;
}

function newGait(): Gait {
  return { phase: Math.random() * Math.PI * 2, speed: 0 };
}

/** Advance the phase by the ground the body actually covered, then read the pose off it. */
function poseGait(g: Gait, tune: GaitTune): GaitPose {
  const swing = Math.sin(g.phase);
  // Two contacts per cycle, so the support term runs at twice the stride frequency.
  const support = Math.cos(g.phase * 2);
  const norm = Math.min(1, g.speed / tune.speedFull);
  const rise = tune.rise * norm;
  // `+0.5, *0.5` maps support from [-1,1] to [0,1]: zero on the planted foot, peak at mid-stride.
  const y = Math.max(0, support * 0.5 + 0.5) * rise;
  // Weight arriving. A sixth power so it is a spike on the footfall, not a ripple through the cycle.
  const thump = Math.max(0, -support) ** 6;
  return {
    y,
    pitch: -tune.lean * norm + swing * 0.03 * norm,
    roll: -swing * tune.sway * norm + thump * 0.045 * norm,
    squash: 1 - thump * 0.05,
    thump,
  };
}

function makeMob(opts: FieldMobOpts, parts: BodyParts): FieldMob {
  const { root, body, scale, baseY } = parts;
  const hex = elementHex(opts.element);

  root.position.set(opts.home.x, 0, opts.home.z);

  // The ring on the floor: the body's own footprint, and the only thing that says "it has seen
  // you" without a health bar. It starts as the element's accent and burns red as the lock fills.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(opts.boss ? 2.6 : opts.role === 'lead' ? 1.5 : 1.1, opts.boss ? 0.11 : 0.07, 6, 28),
    new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: opts.boss ? 0.4 : 0.3, toneMapped: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.07;
  root.add(ring);

  // A wash around the body, so one standing in an unlit corridor is still legible at range.
  //
  // The map is the whole point of it. A SpriteMaterial with no map draws its quad as a solid
  // rectangle, so this was a hard additive box around every body -- invisible while only the
  // Ember Foundry had a mesh, and unmistakable once every room in every dungeon had a band.
  const wash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: hex, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }));
  wash.scale.setScalar(opts.boss ? 9 : opts.role === 'lead' ? 5 : 3.4);
  wash.position.y = opts.boss ? 1.6 : 1.1;
  root.add(wash);

  // A glow at the head, and the one thing that reads at the far end of a corridor. A body is a
  // dark silhouette in a dark room; the ring on the floor is only visible once you are close
  // enough to be caught, so this is what says "something is standing in that doorway" from a
  // distance. It sits at 72% of the silhouette height, which is where the head is on a generated
  // mesh and on every build the echo makes.
  const head = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: hex, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }));
  head.scale.setScalar(opts.boss ? 3.2 : opts.role === 'lead' ? 1.9 : 1.3);
  head.position.y = (opts.boss ? HEIGHTS.boss : HEIGHTS[opts.role]) * 0.72;
  root.add(head);

  const accent = new THREE.Color(hex);
  const alarm = new THREE.Color('#ff2f45');
  let mood: MobState['mood'] = 'patrol';
  let lockT = 0;
  let caught = false;
  let facing = 0;
  /** Seconds since the charge began, for the wind-up a lunge needs. */
  let chargeT = 0;
  // The leash is anchored where the body was told to stand, not where it has wandered to.
  const leash = { x: opts.home.x, z: opts.home.z };
  // The gait, plus the last position it was advanced from. The two together are what lets the
  // body's own speed be measured rather than assumed.
  const gait = newGait();
  let atX = root.position.x;
  let atZ = root.position.z;
  // A minion scuttles, a lead lumbers, and a boss pounds: the longest stride, the biggest rise
  // and the least sway, so the core walks like a thing with weight on it rather than like a
  // bigger version of the band outside.
  const tune: GaitTune = opts.boss
    ? { strideLen: 3.4, rise: 0.34, speedFull: CHARGE_SPEED, sway: 0.03, lean: 0.22 }
    : opts.role === 'lead'
      ? { strideLen: 2.3, rise: 0.2, speedFull: CHARGE_SPEED, sway: 0.05, lean: 0.17 }
      : { strideLen: 1.25, rise: 0.115, speedFull: CHARGE_SPEED, sway: 0.08, lean: 0.13 };

  return {
    root,
    nodeId: opts.nodeId,
    mobId: opts.mobId,
    real: parts.real,
    update(dt, t, ctx) {
      caught = false;

      // The distance this body actually covered on the last frame, which is the only honest speed
      // it has. Measured here, before the state machine moves it, so the pose below is clocked off
      // the ground rather than off a clock the ground knows nothing about.
      gait.speed = dt > 0
        ? Math.min(24, Math.hypot(root.position.x - atX, root.position.z - atZ) / dt)
        : 0;
      atX = root.position.x;
      atZ = root.position.z;
      gait.phase = (gait.phase + (gait.speed / tune.strideLen) * dt * Math.PI * 2) % (Math.PI * 2);
      const pose = poseGait(gait, tune);

      // The breath still runs, under the gait rather than instead of it.
      const breath = Math.sin(t * 1.7 + opts.phase);
      body.scale.set(
        scale * (1 + breath * 0.018),
        scale * pose.squash * (1 + breath * 0.02),
        scale * (1 + breath * 0.018),
      );
      body.rotation.z = Math.sin(t * 0.9 + opts.phase) * 0.014 + pose.roll;

      const dx = ctx.px - root.position.x;
      const dz = ctx.pz - root.position.z;
      const dist = Math.hypot(dx, dz);
      const homeDist = Math.hypot(root.position.x - leash.x, root.position.z - leash.z);
      const noticed = ctx.live && !ctx.held && dist < MOB_NOTICE * ctx.aggro;

      if (mood === 'patrol') {
        if (noticed) {
          mood = 'lock';
          lockT = 0;
        } else {
          // A slow sweep across the doorway and back. Read off the wall clock, so a band of three
          // sweeps in a rhythm the player can actually learn instead of at random.
          const s = Math.sin(t * 0.55 + opts.phase);
          root.position.x = opts.home.x + opts.axis.x * s * opts.reach;
          root.position.z = opts.home.z + opts.axis.z * s * opts.reach;
          // Face the way it is walking, smoothed so the turn does not snap.
          const want = Math.atan2(
            opts.axis.x * Math.cos(t * 0.55 + opts.phase),
            opts.axis.z * Math.cos(t * 0.55 + opts.phase),
          );
          facing = turn(facing, want, dt, 4);
          body.rotation.y = facing;
        }
      }

      if (mood === 'lock') {
        lockT += dt;
        // It turns to face you and stops. This is the whole tell: 0.9s of being looked at.
        facing = turn(facing, Math.atan2(dx, dz), dt, 9);
        body.rotation.y = facing;
        if (!noticed) {
          mood = 'patrol';
          lockT = 0;
        } else if (lockT >= MOB_LOCK_SECONDS) {
          mood = 'charge';
          chargeT = 0;
        }
      }

      if (mood === 'charge') {
        chargeT += dt;
        if (!ctx.live || ctx.held || homeDist > opts.reach * LEASH) {
          mood = 'patrol';
          lockT = 0;
        } else {
          const inv = dist > 0.001 ? 1 / dist : 0;
          root.position.x += dx * inv * CHARGE_SPEED * dt;
          root.position.z += dz * inv * CHARGE_SPEED * dt;
          facing = turn(facing, Math.atan2(dx, dz), dt, 12);
          body.rotation.y = facing;
          if (dist < MOB_CATCH) caught = true;
        }
      }

      // One pose for the whole body, wherever the state machine left it. The lean is measured, so a
      // charge is lean plus gait and a sweep is gait alone; the wind-up is a rock back in the
      // first 0.2s of a charge, which is the anticipation that makes a lunge read as a lunge.
      const wind = mood === 'charge' ? Math.max(0, 1 - chargeT / 0.2) : 0;
      body.position.y = baseY + pose.y + breath * 0.012 - wind * 0.06;
      body.rotation.x = pose.pitch + wind * 0.34 + (mood === 'lock' ? 0.05 : 0);

      // The ring is the state read: dim and element-coloured on patrol, filling to red as it locks.
      const lock = mood === 'lock' ? Math.min(1, lockT / MOB_LOCK_SECONDS) : mood === 'charge' ? 1 : 0;
      const mat = ring.material as THREE.MeshBasicMaterial;
      mat.color.copy(accent).lerp(alarm, lock);
      mat.opacity = 0.24 + lock * 0.66 - pose.thump * 0.16 * Math.min(1, gait.speed / tune.speedFull);
      // The ring travels with the body. It is a footprint, not a decal, so it has to land when the
      // body lands or the whole gait reads as a slide against a floor that is ignoring it.
      ring.position.y = 0.07 + pose.y * 0.6;
      ring.scale.setScalar(1 + lock * 0.22);
      const washMat = wash.material as THREE.SpriteMaterial;
      washMat.color.copy(accent).lerp(alarm, lock);
      washMat.opacity = 0.18 + lock * 0.3 + (mood === 'patrol' ? 0.04 : 0);
      // The head brightens as it commits, so the same tell the ring gives on the floor is given at
      // the distance you are actually looking from.
      const headMat = head.material as THREE.SpriteMaterial;
      headMat.color.copy(accent).lerp(alarm, lock);
      headMat.opacity = 0.26 + lock * 0.5 + (mood === 'charge' ? 0.2 : 0);

      parts.anim?.update(dt);
      return { lock, caught, dist, mood };
    },
    dispose() {
      parts.anim?.stopAllAction();
      // The shared hull is not ours to free. Disposing it would take the outline off every Chog in
      // the game and force a recompile to put it back -- see `SHARED_MATERIALS`.
      for (const m of parts.owned.materials) if (!SHARED_MATERIALS.has(m)) m.dispose();
      for (const g of parts.owned.geometries) g.dispose();
      (ring.material as THREE.Material).dispose();
      ring.geometry.dispose();
      (wash.material as THREE.Material).dispose();
      (head.material as THREE.Material).dispose();
    },
  };
}

/**
 * Normalise a body to a role's height and sit it on the floor.
 *
 * A generated mesh arrives at whatever scale and origin the service felt like, and a body built
 * here arrives at whatever numbers its build used. Both need the same silhouette budget, so this
 * is the single place that decides how tall a lead is.
 *
 * The two returned numbers are the ones every later frame has to preserve: the uniform scale the
 * mesh was normalised to, and the offset that puts its lowest vertex on the floor. The animation
 * adds to these rather than assigning over them -- overwriting either is what makes a body shrink
 * or sink.
 */
function normalise(body: THREE.Object3D, role: 'lead' | 'minion', boss = false): { scale: number; baseY: number } {
  body.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = (boss ? HEIGHTS.boss : HEIGHTS[role]) / Math.max(0.001, size.y);
  body.scale.setScalar(scale);
  const baseY = -box.min.y * scale;
  body.position.set(-center.x * scale, baseY, -center.z * scale);
  return { scale, baseY };
}

/** Angle in radians, turned toward `want` at `rate` rad/s and taking the short way round. */
function turn(from: number, want: number, dt: number, rate: number): number {
  let d = ((want - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  const step = rate * dt;
  return from + Math.max(-step, Math.min(step, d));
}

/**
 * Everything `dress` made a fresh copy of, so the instance can free it.
 *
 * `dress({ flat: true })` unindexes the geometry into a new one and builds a new material, so
 * neither is shared with the cached source GLB and both are this instance's to dispose. Two things
 * are deliberately left out: the texture map, which belongs to the cached parse and is still in use
 * by every other body, and the ink hull, which is a single material the whole game draws with.
 * The hull also shares its geometry with the mesh it wraps, so it is skipped before that is
 * collected -- collecting it would have the same geometry disposed twice.
 */
function collectOwned(root: THREE.Object3D): { materials: THREE.Material[]; geometries: THREE.BufferGeometry[] } {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.userData.hull === true) return;
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!SHARED_MATERIALS.has(x)) materials.add(x);
    }
    geometries.add(m.geometry);
  });
  return { materials: [...materials], geometries: [...geometries] };
}

/**
 * A rigged export brings its own idle. A preview export has no clips at all, which is the normal
 * case, and the caller's transform work is the animation instead.
 */
function playIdle(root: THREE.Object3D, clips: THREE.AnimationClip[]): THREE.AnimationMixer | null {
  if (!clips.length) return null;
  const mixer = new THREE.AnimationMixer(root);
  const idle = clips.find((c) => /idle|breath|float|loop/i.test(c.name)) ?? clips[0];
  if (idle) mixer.clipAction(idle).play();
  return mixer;
}
