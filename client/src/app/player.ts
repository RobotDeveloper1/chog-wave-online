import * as THREE from 'three';
import type { Chog } from './chogLoader.ts';

/**
 * Player movement on the city plane.
 *
 * The client predicts locally so walking feels immediate, then sends its position and the
 * server clamps it — the server owns the bounds and the speed, so a modified client cannot
 * teleport or move faster than the street allows. Collision is resolved here rather than
 * server-side, because the solids are static layout data both sides can agree on.
 *
 * Input is *screen-relative*: W is "up the screen", whatever corner of the city the camera
 * is over. In an isometric view that is a diagonal of the map, and it is the only mapping
 * that does not make every quarter turn of the camera a puzzle.
 */

export const WALK_SPEED = 7.2;
export const RUN_SPEED = 12.5;
const RADIUS = 0.55;

/** What the player needs from a place: things to bump into, and where it ends. */
export interface WalkLayout {
  solids: { x: number; z: number; halfW: number; halfD: number }[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Height of the floor at a point; the pavement is a step above the road. */
  groundY?: (x: number, z: number) => number;
}

export interface LocalPlayer {
  chog: Chog;
  pos: THREE.Vector3;
  facing: number;
  moving: boolean;
  running: boolean;
  /** Distance travelled since the last position report, used to throttle sends. */
  since: number;
}

export function createPlayer(chog: Chog, at: { x: number; z: number }): LocalPlayer {
  chog.root.position.set(at.x, 0, at.z);
  return {
    chog,
    pos: new THREE.Vector3(at.x, 0, at.z),
    facing: Math.PI,
    moving: false,
    running: false,
    since: 0,
  };
}

const keys = new Set<string>();
let bound = false;

export function bindKeys(): void {
  if (bound) return;
  bound = true;
  addEventListener('keydown', (e) => {
    // Typing in the chat line must not walk the Chog.
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    keys.add(e.key.toLowerCase());
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
}

export function pressed(...names: string[]): boolean {
  return names.some((n) => keys.has(n));
}

/** Consume a key press: true once per physical press, however long it is held. */
const taken = new Set<string>();
export function tapped(...names: string[]): boolean {
  let hit = false;
  for (const n of names) {
    if (keys.has(n)) {
      if (!taken.has(n)) hit = true;
      taken.add(n);
    } else taken.delete(n);
  }
  return hit;
}

/**
 * Synthetic input, used by the headless walk test and by anything that needs to
 * drive the avatar without a keyboard. Real key state always wins, so a player
 * pressing a key overrides a scripted move. These are *world* directions, not screen ones.
 */
export const virtual = { x: 0, z: 0, run: false };

export function setVirtualInput(x: number, z: number, run = false): void {
  virtual.x = Math.max(-1, Math.min(1, x));
  virtual.z = Math.max(-1, Math.min(1, z));
  virtual.run = run;
}

/**
 * Turn a push on the screen into a heading in the world. Keys and the touch stick both mean
 * "up the screen", and only the camera's yaw knows where that points, so the two share this.
 */
export function screenToWorld(ix: number, iz: number, yaw: number): { x: number; z: number } {
  // right = (cos, -sin), forward (up the screen) = (-sin, -cos); at yaw 0 these are +x and -z.
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return { x: rx * ix + fx * -iz, z: rz * ix + fz * -iz };
}

/**
 * The touch stick, in *screen* units: pushing up means "up the picture", wherever the camera
 * happens to be pointing. `virtual` above is world-fixed for scripted walks, so the two cannot
 * share a field — a stick is meaningless without the yaw it was drawn against.
 */
export const stick = { x: 0, z: 0, run: false };

export function setStick(x: number, z: number, run = false): void {
  stick.x = Math.max(-1, Math.min(1, x));
  stick.z = Math.max(-1, Math.min(1, z));
  stick.run = run;
}

/** Pushes a circle out of every box it ended up inside. */
function resolveCollides(pos: THREE.Vector3, solids: WalkLayout['solids'], bounds: WalkLayout['bounds']): void {
  pos.x = Math.max(bounds.minX, Math.min(bounds.maxX, pos.x));
  pos.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, pos.z));
  // Two passes: pushing out of one wall can push into the next at a corner.
  for (let pass = 0; pass < 2; pass++) {
    for (const s of solids) {
      const dx = pos.x - s.x;
      const dz = pos.z - s.z;
      if (Math.abs(dx) > s.halfW + RADIUS + 0.2 || Math.abs(dz) > s.halfD + RADIUS + 0.2) continue;
      const overlapX = s.halfW + RADIUS - Math.abs(dx);
      const overlapZ = s.halfD + RADIUS - Math.abs(dz);
      if (overlapX <= 0 || overlapZ <= 0) continue;
      // Exit along whichever axis is shallower, so corners do not snag.
      if (overlapX < overlapZ) pos.x += Math.sign(dx || 1) * overlapX;
      else pos.z += Math.sign(dz || 1) * overlapZ;
    }
  }
}

export interface StepResult {
  moved: boolean;
  anim: 'idle' | 'walk' | 'attack';
}

export function stepPlayer(
  p: LocalPlayer,
  dt: number,
  layout: WalkLayout,
  interactLock: boolean,
  yaw = 0,
): StepResult {
  const ix = (pressed('d', 'arrowright') ? 1 : 0) - (pressed('a', 'arrowleft') ? 1 : 0);
  const iz = (pressed('s', 'arrowdown') ? 1 : 0) - (pressed('w', 'arrowup') ? 1 : 0);
  const dir = new THREE.Vector3();
  if (ix || iz) {
    const w = screenToWorld(ix, iz, yaw);
    dir.set(w.x, 0, w.z);
  } else if (stick.x || stick.z) {
    const w = screenToWorld(stick.x, stick.z, yaw);
    dir.set(w.x, 0, w.z);
  } else {
    dir.set(virtual.x, 0, virtual.z);
  }
  p.running = (pressed('shift') || virtual.run || stick.run) && dir.lengthSq() > 0;
  const speed = p.running ? RUN_SPEED : WALK_SPEED;
  p.moving = dir.lengthSq() > 0 && !interactLock;

  if (p.moving) {
    dir.normalize().multiplyScalar(speed * dt);
    p.pos.add(dir);
    // The model faces the camera at rest, so a zero vector here would snap it.
    p.facing = Math.atan2(dir.x, dir.z);
    resolveCollides(p.pos, layout.solids, layout.bounds);
    p.since += dir.length();
  }

  p.pos.y = layout.groundY ? layout.groundY(p.pos.x, p.pos.z) : 0;
  p.chog.root.position.copy(p.pos);
  p.chog.root.rotation.y = p.facing;
  // The gait reads its own speed, so a run is a faster cycle rather than a
  // different animation that happens to look similar.
  p.chog.setSpeed(p.moving ? (p.running ? 1 : 0.55) : 0);
  p.chog.play(p.moving ? 'walk' : 'idle');
  p.chog.update(dt);
  return { moved: p.moving, anim: p.moving ? 'walk' : 'idle' };
}

/** Other players, rendered from the server snapshot with smoothing. */
export class RemoteAvatars {
  private items = new Map<string, { chog: Chog; target: THREE.Vector3; facing: number }>();

  constructor(
    private parent: THREE.Object3D,
    private make: () => Promise<Chog | null>,
    private groundY: (x: number, z: number) => number = () => 0,
  ) {}

  async sync(ids: { id: string; x: number; y: number; facing: number; heading?: number; anim: string }[]): Promise<void> {
    const seen = new Set<string>();
    for (const p of ids) {
      seen.add(p.id);
      // `facing` is the legacy left/right flag; `heading` is the real angle on the plane.
      const angle = p.heading ?? (p.facing > 0 ? Math.PI / 2 : -Math.PI / 2);
      let it = this.items.get(p.id);
      if (!it) {
        const chog = await this.make();
        if (!chog) return;
        it = { chog, target: new THREE.Vector3(p.x, 0, p.y), facing: angle };
        chog.root.position.copy(it.target);
        this.parent.add(chog.root);
        this.items.set(p.id, it);
      }
      // Server space is (x, y) on the street; Three space is (x, z).
      it.target.set(p.x, 0, p.y);
      it.facing = angle;
    }
    for (const [id, it] of this.items) {
      if (seen.has(id)) continue;
      this.parent.remove(it.chog.root);
      this.items.delete(id);
    }
  }

  /** Forget everyone, after a change of district: they belong to the place we left. */
  clear(): void {
    for (const it of this.items.values()) this.parent.remove(it.chog.root);
    this.items.clear();
  }

  setGround(fn: (x: number, z: number) => number): void {
    this.groundY = fn;
  }

  visible(on: boolean): void {
    for (const it of this.items.values()) it.chog.root.visible = on;
  }

  positions(): { id: string; x: number; z: number }[] {
    return [...this.items.entries()].map(([id, it]) => ({ id, x: it.chog.root.position.x, z: it.chog.root.position.z }));
  }

  update(dt: number): void {
    for (const it of this.items.values()) {
      it.chog.root.position.lerp(it.target, Math.min(1, dt * 9));
      it.chog.root.position.y = this.groundY(it.chog.root.position.x, it.chog.root.position.z);
      // Turn the short way round toward the heading, so a remote Chog never spins a full circle.
      let d = it.facing - it.chog.root.rotation.y;
      d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      it.chog.root.rotation.y += d * Math.min(1, dt * 10);
      const far = it.chog.root.position.distanceToSquared(it.target) > 0.02;
      it.chog.setSpeed(far ? 0.6 : 0);
      it.chog.play(far ? 'walk' : 'idle');
      it.chog.update(dt);
    }
  }
}
