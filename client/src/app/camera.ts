import * as THREE from 'three';
import { reduceMotion } from '../settings.ts';

/**
 * The 2.5D camera.
 *
 * The game is 3D models on a 2D gameplay plane, so the camera's job is not to look at a
 * scene — it is to *frame a diorama*. That means a fixed yaw, a steep-enough pitch that
 * the ground plan is readable (a low camera compresses depth into a ribbon and turns
 * every district into a wall of facades), and a narrow lens that flattens perspective
 * the way a DS 3/4 view does while real models and real shadows survive.
 *
 * Everything is expressed in *world units* rather than camera numbers:
 *
 *   span      how many world units tall the screen is at the player's depth. This is what
 *             decides how big the Chog is on screen (a 2.2-unit Chog at span 18 is ~12% of
 *             the screen height), and it stays that size at any window shape.
 *   minWidth  the narrowest street the screen may show, so a phone-shaped window widens
 *             the shot instead of cropping the avenue to a keyhole.
 *
 * Aspect is therefore an input, not a surprise: a 2.7:1 desktop strip and a 0.6:1 phone
 * both frame the same part of the world around the player.
 */

export type RigName = 'street' | 'indoor' | 'battle' | 'dungeon' | 'line';

export interface Rig {
  /** Vertical field of view in degrees. Narrow on purpose. */
  fov: number;
  /** Degrees below the horizon the lens looks. */
  pitch: number;
  /** World units of screen height at the focus. */
  span: number;
  /** Minimum world units of screen width at the focus. */
  minWidth: number;
  /** How far ahead of the facing direction the camera leans, in world units. */
  lead: number;
  /** Shifts the aim toward the far side by this fraction of the span, so the Chog sits low. */
  frame: number;
  /** Chest height of what is being framed. */
  focusY: number;
  /** Whether the rig tracks the player; fixed rigs stay where `focusOn` put them. */
  follow: boolean;
  /** Whether the wheel changes the span. */
  zoomable: boolean;
}

export const RIGS: Record<RigName, Rig> = {
  // The city view. A low, close camera turned every district into a ribbon of shopfronts
  // — you could not see that it was a *city*, only the street you were on. This one is
  // the Star Force real-world view: high enough that the ground plan reads, a quarter
  // turn round so both street axes run across the screen and every building shows two
  // faces, and pulled back far enough that the next block is already in view.
  street: { fov: 28, pitch: 50, span: 32, minWidth: 36, lead: 3.4, frame: 0.02, focusY: 1.1, follow: true, zoomable: true },
  // A cutaway room: the camera looks down into it from the open side, so the whole floor
  // is on screen at once and nothing about the room needs to be explored with the lens.
  indoor: { fov: 30, pitch: 40, span: 15, minWidth: 19, lead: 0, frame: 0, focusY: 1.3, follow: false, zoomable: false },
  // Star Force reads the field as depth lanes, which only registers from a low camera
  // behind the player. This is the same shot the old rig produced, in the new terms.
  battle: { fov: 40, pitch: 15.9, span: 9.8, minWidth: 14, lead: 0, frame: 0, focusY: 1.7, follow: false, zoomable: false },
  // The dungeon: tall rock surrounds the player, so a street-height camera only sees
  // a wall. This one rides high enough to look *over* the rock into the next room,
  // and follows the chog through the corridor so the next doorway is always in view.
  dungeon: { fov: 36, pitch: 34, span: 30, minWidth: 34, lead: 1.2, frame: 0.18, focusY: 2.2, follow: true, zoomable: true },
  // Open country. Follows and zooms like the street, but wider and pitched a little flatter so the
// horizon stays in frame — at 44° looking down with a 15° half-lens the horizon sits off the top
  // of the screen and the whole shot becomes floor.
  //
  // `frame` is near zero, unlike the dungeon's 0.18. A dungeon is a corridor with one way to go
  // and wants the camera looking into it; here the road is under your feet and the terrain's own
  // relief does the work of showing depth. Pushing the aim ten units forward put the Chog off
  // the bottom edge of the frame on flat ground before the terrain even came into it.
  line: { fov: 30, pitch: 38, span: 40, minWidth: 48, lead: 3.2, frame: 0.04, focusY: 1.5, follow: true, zoomable: true },
};

const DEG = Math.PI / 180;

/** Critically damped follow: no overshoot, no fixed lag, and framerate independent. */
function smoothDamp(cur: number, target: number, vel: { v: number }, smoothTime: number, dt: number): number {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * e;
  let out = target + (change + temp) * e;
  if (target - cur > 0 === out > target) {
    out = target;
    vel.v = dt > 0 ? (out - target) / dt : 0;
  }
  return out;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export class CameraDirector {
  rig: RigName = 'street';
  /** Wheel zoom: multiplies the span. Below 1 is closer. */
  zoom = 1;
  /**
   * Which corner of the city the lens sits over, in radians clockwise from the south.
   * It turns in quarter steps (Q and E), which is how an isometric city copes with
   * the one thing it cannot do: show you what is behind the building in front of it.
   */
  yaw = Math.PI / 4;
  private yawTarget = Math.PI / 4;

  private bounds: Bounds | null = null;
  private readonly focus = new THREE.Vector3(0, 1.1, 0);
  private readonly fixed = new THREE.Vector3(0, 1.1, 0);
  private readonly vx = { v: 0 };
  private readonly vz = { v: 0 };
  private lead = 0;
  private leadVel = { v: 0 };
  private target = { x: 0, z: 0 };
  private snapNext = true;
  private ready = false;

  /** The pose the last frame actually drew, which a rig change blends *from*. */
  /** The ground height under the player, so ocusY means "above the floor" and not "above y=0". */
  private ground = 0;
  private shown: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 30 };
  private from: Pose | null = null;
  private blend = 1;

  private shakeAmp = 0;
  private shakeLeft = 0;
  private shakeTotal = 0;

  /** Overrides applied on top of the active rig, for live tuning from the console. */
  private tuned: Partial<Rig> = {};
  /**
   * A scene that wants the lens for itself (the duel's over-the-shoulder shot) installs a
   * function that poses the camera every frame; the rigs above are skipped while it is set.
   */
  private custom: ((camera: THREE.PerspectiveCamera, dt: number) => void) | null = null;
  private readonly camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  setCustom(fn: ((camera: THREE.PerspectiveCamera, dt: number) => void) | null): void {
    this.custom = fn;
    // Coming back to a rig, jump straight to its framing instead of gliding from the duel's pose.
    if (!fn) {
      this.from = null;
      this.blend = 1;
      this.snapNext = true;
    }
  }

  /**
   * Change rig. The default is a glide, which is right for a pulse into the wave or a
   * return from one; a door is a different *place*, and sweeping the lens through the
   * space between a room and the street would show nothing but the void, so those cut.
   */
  setRig(next: RigName, cut = false): void {
    if (next === this.rig) return;
    // Before the first frame there is nothing on screen to glide away from.
    this.from = this.ready && !cut
      ? { pos: this.shown.pos.clone(), look: this.shown.look.clone(), fov: this.shown.fov }
      : null;
    this.blend = this.from ? 0 : 1;
    this.rig = next;
    this.snapNext = true;
  }

  setBounds(b: Bounds | null): void {
    this.bounds = b ? { ...b } : null;
  }

  /** Aim a fixed rig (battle, indoor). Follow rigs ignore this and track the player. */
  focusOn(x: number, y: number, z: number): void {
    this.fixed.set(x, y, z);
  }

  /** Jump to the target with no easing — after a teleport, a door, or a district change. */
  snap(): void {
    this.snapNext = true;
    this.from = null;
    this.blend = 1;
  }

  setZoom(v: number): number {
    this.zoom = Math.min(2.4, Math.max(0.5, v));
    return this.zoom;
  }

  /** Turn the view a quarter turn. Negative is anticlockwise. */
  rotate(dir: 1 | -1): void {
    this.yawTarget += dir * (Math.PI / 2);
  }

  setYaw(rad: number, instant = false): void {
    this.yawTarget = rad;
    if (instant) this.yaw = rad;
  }

  shake(amplitude: number, seconds: number): void {
    if (reduceMotion()) return;
    this.shakeAmp = Math.max(this.shakeAmp * (this.shakeLeft / Math.max(0.001, this.shakeTotal)), amplitude);
    this.shakeLeft = this.shakeTotal = Math.max(this.shakeLeft, seconds);
  }

  tune(patch: Partial<Rig>): Rig {
    this.tuned = { ...this.tuned, ...patch };
    return this.active();
  }

  /** The rig with any console overrides applied. */
  active(): Rig {
    return { ...RIGS[this.rig], ...this.tuned };
  }

  /**
   * Tell the director where the player is. The look-ahead leans into the way the Chog
   * faces so the screen shows where it is going rather than where it has been, and it
   * only engages while moving, so standing still settles on the Chog instead of
   * drifting off to one side.
   */
  follow(x: number, z: number, facing: number, moving: boolean, dt: number, groundY = 0): void {
    const rig = this.active();
    if (!rig.follow) return;
    const want = moving ? rig.lead : 0;
    this.lead = smoothDamp(this.lead, want, this.leadVel, 0.55, dt);
    // Facing is atan2(dx, dz): +x is sin, +z is cos. Depth lead is shorter than lateral
    // lead because the screen is wide and shallow.
    this.target.x = x + Math.sin(facing) * this.lead;
    this.target.z = z + Math.cos(facing) * this.lead * 0.45;
    this.ground = groundY;
  }

  /** The span the screen is actually framing, after aspect and zoom. */
  private spanFor(rig: Rig, aspect: number): number {
    const zoom = rig.zoomable ? this.zoom : 1;
    return Math.max(rig.span * zoom, rig.minWidth / Math.max(0.3, aspect));
  }

  private clampToBounds(rig: Rig, span: number, aspect: number): void {
    const b = this.bounds;
    if (!b) return;
    // The view is turned, so its footprint on the ground is a diamond rather than a
    // rectangle; a single conservative margin keeps the edge of the world out of the
    // middle of the shot at any yaw without maths that would only matter to a camera
    // sitting exactly on the boundary. The Chog can still reach the edge: only the
    // *camera* is held back.
    const reach = Math.max(span * aspect * 0.5, span / Math.sin(rig.pitch * DEG) * 0.5) * 0.62;
    const lo = b.minX + reach;
    const hi = b.maxX - reach;
    this.target.x = lo >= hi ? (b.minX + b.maxX) / 2 : Math.min(hi, Math.max(lo, this.target.x));
    const zlo = b.minZ + reach;
    const zhi = b.maxZ - reach;
    this.target.z = zlo >= zhi ? (b.minZ + b.maxZ) / 2 : Math.min(zhi, Math.max(zlo, this.target.z));
  }

  private poseFor(rig: Rig, span: number, fx: number, fz: number, yaw: number): Pose {
    const fovRad = rig.fov * DEG;
    const dist = span / 2 / Math.tan(fovRad / 2);
    const cp = Math.cos(rig.pitch * DEG);
    const sp = Math.sin(rig.pitch * DEG);
    // Aim past the Chog by a slice of the screen, so it sits in the lower half and the
    // route ahead (always up the screen) gets the room. "Up the screen" is away from the
    // lens along the ground, which at this yaw is a diagonal.
    const far = (rig.frame * span) / sp;
    const ax = fx - Math.sin(yaw) * far;
    const az = fz - Math.cos(yaw) * far;
    // **`focusY` is above the ground under the player, not above the world's zero.**
    //
    // Every rig that existed before the Line was written for a flat place at y = 0 — the city
    // and all six dungeons — so an absolute 1.1 meant "chest height off the pavement". The Line
    // is not flat: its terrain runs 0 to 14 units. Computed off the rig's own numbers, a player
    // standing on ground 6 units up was framed at **480% of the screen height** — entirely off
    // the top — because the camera was still aiming at y = 1.6, which by then was inside the
    // hillside. The player saw dirt, which is what "the map is empty" turned out to be.
    //
    // So the height the rig frames is relative to where the player is standing, and any place
    // with hills gets this for free.
    const eye = this.ground + rig.focusY;
    const look = new THREE.Vector3(ax, eye, az);
    const pos = new THREE.Vector3(
      ax + Math.sin(yaw) * dist * cp,
      eye + dist * sp,
      az + Math.cos(yaw) * dist * cp,
    );
    return { pos, look, fov: rig.fov };
  }

  update(dt: number): void {
    if (this.custom) {
      this.custom(this.camera, dt);
      this.camera.updateProjectionMatrix();
      this.ready = true;
      this.shown.pos.copy(this.camera.position);
      this.shown.look.copy(this.fixed);
      this.shown.fov = this.camera.fov;
      return;
    }
    const rig = this.active();
    const aspect = this.camera.aspect || 1;
    // Zooming in eases the pitch down a little, which is how a mane or a held card is
    // read — the same reason the old rig dropped its aim when the wheel moved.
    const zoomPitch = rig.zoomable ? (this.zoom - 1) * 7 : 0;
    const shaped: Rig = { ...rig, pitch: Math.min(60, Math.max(14, rig.pitch + zoomPitch)) };
    const span = this.spanFor(shaped, aspect);

    let fx: number;
    let fz: number;
    if (rig.follow) {
      this.clampToBounds(shaped, span, aspect);
      if (this.snapNext) {
        this.focus.x = this.target.x;
        this.focus.z = this.target.z;
        this.vx.v = this.vz.v = 0;
      } else {
        this.focus.x = smoothDamp(this.focus.x, this.target.x, this.vx, 0.2, dt);
        this.focus.z = smoothDamp(this.focus.z, this.target.z, this.vz, 0.26, dt);
      }
      fx = this.focus.x;
      fz = this.focus.z;
    } else {
      fx = this.fixed.x;
      fz = this.fixed.z;
    }

    // The yaw eases to its quarter-turn target by the shortest way round.
    if (rig.follow) {
      let dy = this.yawTarget - this.yaw;
      dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.yaw += dy * (1 - Math.exp(-dt * 7));
      if (Math.abs(dy) < 0.0005) this.yaw = this.yawTarget;
    }
    const live = this.poseFor(shaped, span, fx, fz, rig.follow ? this.yaw : 0);
    this.snapNext = false;
    this.ready = true;

    let pose = live;
    if (this.from && this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.55);
      // Ease in-out, so a door or a pulse into the wave is a glide and not a lurch.
      const t = this.blend * this.blend * (3 - 2 * this.blend);
      pose = {
        pos: this.from.pos.clone().lerp(live.pos, t),
        look: this.from.look.clone().lerp(live.look, t),
        fov: this.from.fov + (live.fov - this.from.fov) * t,
      };
      if (this.blend >= 1) this.from = null;
    }

    this.shown.pos.copy(pose.pos);
    this.shown.look.copy(pose.look);
    this.shown.fov = pose.fov;

    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const k = this.shakeAmp * (this.shakeLeft / Math.max(0.001, this.shakeTotal));
      pose.pos.x += (Math.random() - 0.5) * 2 * k;
      pose.pos.y += (Math.random() - 0.5) * 2 * k * 0.6;
      pose.look.x += (Math.random() - 0.5) * 2 * k * 0.5;
      if (this.shakeLeft === 0) this.shakeAmp = 0;
    }

    this.camera.fov = pose.fov;
    this.camera.position.copy(pose.pos);
    this.camera.lookAt(pose.look);
    this.camera.updateProjectionMatrix();
  }

  /** Where the camera is aimed, for the things that follow it: the sun, the shadow, the haze. */
  focusPoint(): THREE.Vector3 {
    return this.rig === 'street' && !this.custom ? this.focus : this.fixed;
  }

  /** World units of screen height at the focus, after zoom and aspect. */
  visibleSpan(): number {
    return this.spanFor(this.active(), this.camera.aspect || 1);
  }

  /** What the camera is doing, readable from the console. */
  describe(): Record<string, number | string> {
    const rig = this.active();
    const aspect = this.camera.aspect || 1;
    return {
      rig: this.rig,
      yaw: +((this.yaw * 180) / Math.PI).toFixed(1),
      aspect: +aspect.toFixed(2),
      zoom: +this.zoom.toFixed(2),
      pitch: rig.pitch,
      fov: rig.fov,
      span: +this.spanFor(rig, aspect).toFixed(2),
      focusX: +this.focus.x.toFixed(2),
      focusZ: +this.focus.z.toFixed(2),
      camY: +this.camera.position.y.toFixed(2),
      camZ: +this.camera.position.z.toFixed(2),
    };
  }
}
