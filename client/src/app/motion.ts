import * as THREE from 'three';

/**
 * Procedural character motion.
 *
 * The exported Chog has a real bone hierarchy but no keyframes, so animation is
 * driven from code instead of from clips. That turns out to be the better tool
 * here anyway: a walk cycle can read the avatar's actual speed and lean into it,
 * an idle can breathe at a different rate per character so a crowd never syncs,
 * and none of it needs a 670 KB animation payload per token.
 *
 * Everything is relative to the pose the model was exported in, and every joint
 * is restored before being moved, because these bones are shared state across
 * frames — a partial write would drift the character into a permanent crouch.
 */

export type MotionKind = 'idle' | 'walk' | 'run' | 'attack' | 'hit';

interface Bones {
  root?: THREE.Object3D;
  hips?: THREE.Object3D;
  spine?: THREE.Object3D;
  head?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  handL?: THREE.Object3D;
  handR?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  footL?: THREE.Object3D;
  footR?: THREE.Object3D;
  /** The mane and hat parts hang off the head; they get secondary lag. */
  trailing: THREE.Object3D[];
  rest: Map<THREE.Object3D, { p: THREE.Vector3; r: THREE.Euler }>;
}

const NAMES: Record<string, keyof Bones> = {
  Root: 'root',
  Hips: 'hips',
  Spine: 'spine',
  Head: 'head',
  LeftArm: 'armL',
  RightArm: 'armR',
  LeftHand: 'handL',
  RightHand: 'handR',
  LeftUpLeg: 'legL',
  RightUpLeg: 'legR',
  LeftFoot: 'footL',
  RightFoot: 'footR',
};

export function rigOf(root: THREE.Object3D): Bones {
  const bones: Bones = { trailing: [], rest: new Map() };
  root.traverse((o) => {
    const slot = NAMES[o.name];
    if (slot && slot !== 'trailing' && slot !== 'rest') (bones as never as Record<string, THREE.Object3D>)[slot] = o;
    if (o.parent?.name === 'Head' && !(o as THREE.Mesh).isMesh) bones.trailing.push(o);
  });
  const record = (o: THREE.Object3D) => {
    bones.rest.set(o, { p: o.position.clone(), r: o.rotation.clone() });
  };
  for (const key of ['root', 'hips', 'spine', 'head', 'armL', 'armR', 'handL', 'handR', 'legL', 'legR', 'footL', 'footR'] as const) {
    const b = bones[key];
    if (b) record(b);
  }
  for (const t of bones.trailing) record(t);
  return bones;
}

function restore(bones: Bones): void {
  for (const [obj, rest] of bones.rest) {
    obj.position.copy(rest.p);
    obj.rotation.copy(rest.r);
  }
}

const TAU = Math.PI * 2;

export interface MotionInput {
  kind: MotionKind;
  /** Seconds since the character was created — never reset, so crowds desync. */
  t: number;
  /** 0..1 fraction of normal walking speed. */
  speed: number;
  /** 0..1 progress through a one-shot attack or hit, or null. */
  impulse?: number | null;
}

/**
 * One cycle of a chibi walk: legs counter-swing, the opposite arm leads, the hips
 * drop on the planted leg, and the head lags a beat behind the spine so the mane
 * has something to catch up to.
 */
/**
 * One cycle of a chibi walk: legs counter-swing, the opposite arm leads, the hips
 * drop on the planted leg, and the head lags a beat behind the spine so the mane
 * has something to catch up to.
 *
 * Every rotation is a DELTA on top of the rest pose (restore() has just copied
 * the pose the model exported in). An exported bone that points down carries a
 * rest rotation of ~180 deg -- `rotation.x = 0.4` would REPLACE that and flip
 * the limb through its pivot; `+=` swings it about the joint it actually has.
 * Positions were already deltas; rotations were the bug.
 */
export function applyMotion(bones: Bones, input: MotionInput): void {
  restore(bones);
  const { kind, t, speed, impulse = null } = input;

  if (kind === 'attack' && impulse !== null) {
    const p = Math.max(0, Math.min(1, impulse));
    // Snap out, hang at the top, ease back — a linear ramp reads as a slide.
    const strike = p < 0.28 ? p / 0.28 : p < 0.5 ? 1 : 1 - (p - 0.5) / 0.5;
    const s = Math.sin(Math.min(1, strike) * Math.PI * 0.5);
    if (bones.armR) bones.armR.rotation.x += -1.5 * s;
    if (bones.handR) bones.handR.rotation.x += -0.7 * s;
    if (bones.spine) bones.spine.rotation.x += 0.22 * s;
    if (bones.root) bones.root.position.z += 0.22 * s;
    if (bones.head) bones.head.rotation.x += -0.18 * s;
    return;
  }

  if (kind === 'hit' && impulse !== null) {
    const p = Math.max(0, Math.min(1, impulse));
    const shake = Math.sin(p * Math.PI * 6) * (1 - p);
    if (bones.head) bones.head.rotation.x += 0.3 * shake;
    if (bones.spine) bones.spine.rotation.x += -0.22 * shake;
    if (bones.root) bones.root.position.x += 0.09 * shake;
    return;
  }

  // Idle: breathing, a slow look around, and the mane settling.
  if (kind === 'idle') {
    const breath = Math.sin(t * 1.6) * 0.5 + 0.5;
    if (bones.spine) bones.spine.rotation.x += 0.028 * breath;
    if (bones.hips) bones.hips.position.y += 0.012 * breath;
    if (bones.head) bones.head.rotation.y += Math.sin(t * 0.45) * 0.22;
    if (bones.head) bones.head.rotation.x += Math.sin(t * 1.1) * 0.035;
    if (bones.armL) bones.armL.rotation.z += -0.06 - 0.03 * breath;
    if (bones.armR) bones.armR.rotation.z += 0.06 + 0.03 * breath;
    applyLag(bones, t, 0.35);
    return;
  }

  // Walk and run share a gait; run shortens the cycle and adds forward lean.
  const cadence = (kind === 'run' ? 10.5 : 7.2) * (0.55 + 0.45 * speed);
  const phase = t * cadence;
  const swing = (kind === 'run' ? 0.78 : 0.55) * (0.4 + 0.6 * speed);
  const lift = Math.abs(Math.sin(phase)) * (kind === 'run' ? 0.075 : 0.045);

  if (bones.legL) bones.legL.rotation.x += Math.sin(phase) * swing;
  if (bones.legR) bones.legR.rotation.x += -Math.sin(phase) * swing;
  if (bones.footL) bones.footL.rotation.x += Math.max(0, -Math.sin(phase)) * swing * 0.8;
  if (bones.footR) bones.footR.rotation.x += Math.max(0, Math.sin(phase)) * swing * 0.8;
  // Arms oppose the legs, which is the single cue that separates a walk from a slide.
  if (bones.armL) bones.armL.rotation.x += -Math.sin(phase) * swing * 0.85;
  if (bones.armR) bones.armR.rotation.x += Math.sin(phase) * swing * 0.85;
  if (bones.handL) bones.handL.rotation.x += -Math.sin(phase) * swing * 0.4;
  if (bones.handR) bones.handR.rotation.x += Math.sin(phase) * swing * 0.4;

  if (bones.hips) {
    bones.hips.position.y += lift;
    bones.hips.rotation.z += Math.sin(phase) * 0.05;
  }
  if (bones.spine) {
    bones.spine.rotation.y += Math.sin(phase) * -0.07;
    bones.spine.rotation.x += kind === 'run' ? 0.16 : 0.05;
  }
  if (bones.head) bones.head.rotation.y += Math.sin(phase) * 0.06;
  applyLag(bones, t, kind === 'run' ? 0.85 : 0.5);
}

/**
 * Secondary motion on the mane and hat. Each trailing part follows the head with
 * a delay proportional to its height, which is what makes the character feel
 * weighted instead of printed.
 */
function applyLag(bones: Bones, t: number, amount: number): void {
  bones.trailing.forEach((o, i) => {
    const offset = i * 0.37;
    const wobble = Math.sin(t * 5.2 + offset) * 0.09 * amount;
    const rest = bones.rest.get(o);
    if (!rest) return;
    o.rotation.x = rest.r.x + wobble;
    o.rotation.z = rest.r.z + Math.cos(t * 4.1 + offset) * 0.06 * amount;
  });
}

export function isRigged(bones: Bones): boolean {
  return Boolean(bones.hips || bones.spine || bones.head);
}

export const MOTION_TAU = TAU;
