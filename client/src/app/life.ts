import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, type CityLayout, type Rect } from '@chog/shared';
import type { DistrictArt } from './art.ts';
import { KERB } from './city/ground.ts';

/**
 * A city is things happening that have nothing to do with you.
 *
 * Cars on the roads, people on the pavements, dust turning in the lamplight. None of it is
 * a mechanic and all of it is the difference between a level and a place. Everything is
 * *instanced* — one draw call for every car, four for every pedestrian — and runs off a
 * free clock with per-item offsets, because synchronised idle motion is the fastest way to
 * make a scene look like a screensaver.
 */

const paint = (geo: THREE.BufferGeometry, color: string | number): THREE.BufferGeometry => {
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
};

const part = (w: number, h: number, d: number, x: number, y: number, z: number, color: string | number): THREE.BufferGeometry =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

/** One car: body, cabin, glass, wheels, lamps — merged into a single geometry. */
function carGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    // Body is white so the instance colour tints it; everything else keeps its own colour.
    part(1.8, 0.7, 4.0, 0, 0.62, 0, 0xffffff),
    part(1.6, 0.55, 2.0, 0, 1.22, -0.15, 0xdfe6f0),
    part(1.64, 0.4, 1.7, 0, 1.24, -0.15, 0x3a4a68),
    ...[-1.2, 1.3].flatMap((z) => [-0.9, 0.9].map((x) => part(0.3, 0.64, 0.64, x, 0.32, z, 0x0c0a12))),
    ...[-0.6, 0.6].map((x) => part(0.34, 0.2, 0.08, x, 0.7, 2.02, 0xfff2c0)),
    ...[-0.6, 0.6].map((x) => part(0.34, 0.2, 0.08, x, 0.7, -2.02, 0xff3a4a)),
  ])!;
}

interface Car {
  rect: Rect;
  axis: 'x' | 'z';
  /** Lane offset from the street's centre line, and which way it drives. */
  lane: number;
  dir: 1 | -1;
  /** Position along the street. */
  s: number;
  /** The speed this car holds when nothing is in front of it. */
  cruise: number;
  /** The speed it is actually doing now; the brake moves this, not `s`. */
  v: number;
  /** Seconds spent waiting past the road end for a wrap that would pop in view. */
  hold: number;
  tint: THREE.Color;
}

/**
 * The brake corridors, in metres. A person counts as "in front" from a lane and a half
 * across, so stepping off the kerb already stops a car; a car counts from a six-and-a-half
 * metre gap. DECEL is what makes the stop read as a driver noticing, not a wall.
 */
const BRAKE_FOR_PLAYER = 11;
const BRAKE_FOR_PLAYER_LAT = 2.6;
const BRAKE_FOR_CAR = 6.5;
const BRAKE_FOR_CAR_LAT = 1.6;
const ACCEL = 6;
const DECEL = 18;

class Traffic {
  private readonly mesh: THREE.InstancedMesh;
  private readonly cars: Car[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  constructor(private readonly scene: THREE.Object3D, layout: CityLayout, art: DistrictArt, count: number) {
    const r = mulberry32(layout.sector.length * 977 + 1);
    const palette = ['#8c2f4f', '#2f6f8c', '#c9a227', '#3b3b4a', '#7a8a4a', '#d8d0c0', '#a84a2f', '#26324a', art.accent];
    const streets = layout.streets.filter((s) => (s.axis === 'x' ? s.rect.x1 - s.rect.x0 : s.rect.z1 - s.rect.z0) > 60);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(carGeometry(), mat, count);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      const st = streets[Math.floor(r() * streets.length)]!;
      const len = st.axis === 'x' ? st.rect.x1 - st.rect.x0 : st.rect.z1 - st.rect.z0;
      const dir = r() > 0.5 ? 1 : -1;
      const cruise = 5.5 + r() * 5;
      const car: Car = {
        rect: st.rect,
        axis: st.axis,
        lane: dir * (st.width * 0.2 + r() * 0.5),
        dir,
        s: r() * len,
        cruise,
        v: cruise,
        hold: 0,
        tint: new THREE.Color(palette[Math.floor(r() * palette.length)]!),
      };
      // Two cars born in the same spot drive stacked forever — the brake only sees what is
      // ahead of it, so a birth overlap is a collision nobody ever resolves. Re-roll until
      // this car is a car-length and a half clear of every car already on the road.
      for (let tries = 0; tries < 24; tries++) {
        const [x, z] = this.at(car);
        if (this.cars.every((o) => { const [ox, oz] = this.at(o); return (ox - x) ** 2 + (oz - z) ** 2 > 81; })) break;
        car.rect = streets[Math.floor(r() * streets.length)]!.rect;
        car.s = r() * (car.axis === 'x' ? car.rect.x1 - car.rect.x0 : car.rect.z1 - car.rect.z0);
      }
      this.cars.push(car);
      this.mesh.setColorAt(i, car.tint);
      this.write(i, car);
    }
    scene.add(this.mesh);
  }

  /** Where a car is, and which way its nose points, as flat numbers the brake can dot. */
  private at(c: Car): [number, number] {
    const along = (c.axis === 'x' ? c.rect.x0 : c.rect.z0) + c.s;
    const mid = c.axis === 'x' ? (c.rect.z0 + c.rect.z1) / 2 : (c.rect.x0 + c.rect.x1) / 2;
    return c.axis === 'x' ? [along, mid + c.lane] : [mid + c.lane, along];
  }

  private write(i: number, c: Car): void {
    const [x, z] = this.at(c);
    // The car is modelled along +z; turn it to its direction of travel.
    const yaw = c.axis === 'x' ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : c.dir > 0 ? 0 : Math.PI;
    this.q.setFromEuler(this.e.set(0, yaw, 0));
    this.m.compose(new THREE.Vector3(x, 0.02, z), this.q, new THREE.Vector3(1, 1, 1));
    this.mesh.setMatrixAt(i, this.m);
  }

  update(dt: number, player: THREE.Vector3): void {
    const n = this.cars.length;
    // Positions first, so every driver reads the same instant of the world.
    const px = new Float64Array(n);
    const pz = new Float64Array(n);
    const fx = new Float64Array(n);
    const fz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.cars[i]!;
      const [x, z] = this.at(c);
      px[i] = x; pz[i] = z;
      fx[i] = c.axis === 'x' ? c.dir : 0;
      fz[i] = c.axis === 'z' ? c.dir : 0;
    }
    for (let i = 0; i < n; i++) {
      const c = this.cars[i]!;
      let target = c.cruise;
      // A person standing in the corridor ahead: the car stops and waits.
      const dxp = player.x - px[i]!;
      const dzp = player.z - pz[i]!;
      const fwdP = dxp * fx[i]! + dzp * fz[i]!;
      const latP = Math.abs(dxp * -fz[i]! + dzp * fx[i]!);
      if ((fwdP > 0.3 && fwdP < BRAKE_FOR_PLAYER && latP < BRAKE_FOR_PLAYER_LAT) || Math.hypot(dxp, dzp) < 4) target = 0;
      // Any car in the forward cone, whatever street it came from: this is what makes a
      // crossing car get yielded to at a junction instead of driven through.
      if (target > 0) {
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const dx = px[j]! - px[i]!;
          const dz = pz[j]! - pz[i]!;
          const d = dx * fx[i]! + dz * fz[i]!;
          const lat = Math.abs(dx * -fz[i]! + dz * fx[i]!);
          if (d > -1 && d < BRAKE_FOR_CAR && lat < BRAKE_FOR_CAR_LAT) {
            target = 0;
            break;
          }
        }
      }
      c.v = target === 0 ? Math.max(0, c.v - DECEL * dt) : Math.min(c.cruise, c.v + ACCEL * dt);
      const len = c.axis === 'x' ? c.rect.x1 - c.rect.x0 : c.rect.z1 - c.rect.z0;
      c.s += c.v * dt * c.dir;
      // Wrapping is a teleport, and a teleport inside your view is a car spawning from
      // nothing. Past the road end the car waits at the junction instead, and only takes
      // the jump once the far end is out of your world — or once it has waited long
      // enough that the wait itself would be the odd thing.
      const over = c.s > len + 4 ? 1 : c.s < -4 ? -1 : 0;
      if (over !== 0) {
        const [ex, ez] = this.at(c);
        const near = (player.x - ex) ** 2 + (player.z - ez) ** 2 < 3600;
        if (near && c.hold < 8) {
          c.hold += dt;
          c.s = over > 0 ? len + 4 : -4;
          c.v = 0;
        } else {
          c.hold = 0;
          c.s = over > 0 ? -4 : len + 4;
        }
      } else c.hold = 0;
      this.write(i, c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** The same readout the old per-mesh traffic gave the debug hook, from the instances. */
  debug(): { x: number; z: number; v: number; cruise: number }[] {
    return this.cars.map((c) => {
      const [x, z] = this.at(c);
      return { x: +x.toFixed(1), z: +z.toFixed(1), v: +c.v.toFixed(2), cruise: +c.cruise.toFixed(2) };
    });
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

interface Walker {
  loop: Rect;
  perimeter: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  pause: number;
  phase: number;
  tint: THREE.Color;
  skin: THREE.Color;
}

/** People on the pavements, each walking a loop round one block and stopping now and then. */
class Pedestrians {
  private readonly body: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly legs: THREE.InstancedMesh;
  private readonly walkers: Walker[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private clock = 0;

  constructor(private readonly scene: THREE.Object3D, layout: CityLayout, art: DistrictArt, count: number) {
    const r = mulberry32(layout.sector.length * 421 + 9);
    const clothes = [art.accent, art.cloth, '#4a2f86', '#2f6f5a', '#8c2f4f', '#c9a227', '#3b4a8c', '#e8dcc0'];
    const skins = ['#f0eddb', '#e8b4c8', '#d9b08c', '#8fb37a', '#9fb6d4', '#d49a7a'];
    const cap = layout.blocks.filter((b) => b.def.kind !== 'water' && b.def.kind !== 'rail');
    for (let i = 0; i < count; i++) {
      const b = cap[Math.floor(r() * cap.length)]!;
      const inset = 1.5;
      const loop: Rect = { x0: b.rect.x0 + inset, z0: b.rect.z0 + inset, x1: b.rect.x1 - inset, z1: b.rect.z1 - inset };
      const perimeter = 2 * (loop.x1 - loop.x0 + (loop.z1 - loop.z0));
      this.walkers.push({
        loop,
        perimeter,
        s: r() * perimeter,
        dir: r() > 0.5 ? 1 : -1,
        speed: 1.3 + r() * 1.2,
        pause: 0,
        phase: r() * 6,
        tint: new THREE.Color(clothes[Math.floor(r() * clothes.length)]!),
        skin: new THREE.Color(skins[Math.floor(r() * skins.length)]!),
      });
    }
    const mat = (): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.3, 0.55, 3, 8).translate(0, 0.95, 0), mat(), count);
    this.head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.26, 10, 8).translate(0, 1.72, 0), mat(), count);
    this.legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.62, 0.22).translate(0, -0.31, 0), mat(), count * 2);
    this.walkers.forEach((w, i) => {
      this.body.setColorAt(i, w.tint);
      this.head.setColorAt(i, w.skin);
      this.legs.setColorAt(i * 2, new THREE.Color('#2a2438'));
      this.legs.setColorAt(i * 2 + 1, new THREE.Color('#2a2438'));
    });
    for (const m of [this.body, this.head, this.legs]) {
      m.castShadow = true;
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  /** Where along the loop, and which way it faces, for a distance `s` clockwise from the corner. */
  private at(w: Walker): { x: number; z: number; heading: number } {
    const { x0, z0, x1, z1 } = w.loop;
    const W = x1 - x0;
    const D = z1 - z0;
    let s = ((w.s % w.perimeter) + w.perimeter) % w.perimeter;
    let x: number;
    let z: number;
    let heading: number;
    if (s < W) {
      x = x0 + s;
      z = z0;
      heading = Math.PI / 2;
    } else if ((s -= W) < D) {
      x = x1;
      z = z0 + s;
      heading = 0;
    } else if ((s -= D) < W) {
      x = x1 - s;
      z = z1;
      heading = -Math.PI / 2;
    } else {
      s -= W;
      x = x0;
      z = z1 - s;
      heading = Math.PI;
    }
    return { x, z, heading: w.dir > 0 ? heading : heading + Math.PI };
  }

  update(dt: number): void {
    this.clock += dt;
    this.walkers.forEach((w, i) => {
      if (w.pause > 0) w.pause -= dt;
      else {
        w.s += w.dir * w.speed * dt;
        if (Math.random() < dt * 0.04) w.pause = 1 + Math.random() * 4;
      }
      const p = this.at(w);
      const walking = w.pause <= 0;
      const swing = walking ? Math.sin(this.clock * 7 + w.phase) : 0;
      const bob = walking ? Math.abs(swing) * 0.06 : 0;
      this.q.setFromEuler(this.e.set(0, p.heading, 0));
      const base = new THREE.Vector3(p.x, KERB + bob, p.z);
      this.m.compose(base, this.q, new THREE.Vector3(1, 1, 1));
      this.body.setMatrixAt(i, this.m);
      this.head.setMatrixAt(i, this.m);
      for (const [k, side] of [[0, -1], [1, 1]] as const) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(swing * 0.7 * side, p.heading, 0, 'YXZ'));
        const off = new THREE.Vector3(0.14 * side, 0.64, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.heading, 0)));
        this.m.compose(new THREE.Vector3(p.x + off.x, KERB + bob + off.y, p.z + off.z), q, new THREE.Vector3(1, 1, 1));
        this.legs.setMatrixAt(i * 2 + k, this.m);
      }
    });
    this.body.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.body, this.head, this.legs]) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }
}

/** Dust, pollen or rain: a few hundred points that follow the camera and drift. */
class Motes {
  private readonly pts: THREE.Points;
  private readonly home = new THREE.Vector3();

  constructor(private readonly scene: THREE.Object3D, sector: string, art: DistrictArt) {
    const n = sector === 'voltgrid' ? 420 : 260;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 70;
      pos[i * 3 + 1] = Math.random() * 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const colour = sector === 'voltgrid' ? 0x9fdcff : sector === 'hollow' ? 0xe8f0c8 : 0xffd9a0;
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ color: colour, size: sector === 'voltgrid' ? 0.07 : 0.14, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true }));
    this.pts.frustumCulled = false;
    this.rain = sector === 'voltgrid';
    scene.add(this.pts);
    void art;
  }

  private readonly rain: boolean;

  update(dt: number, t: number, focus: THREE.Vector3): void {
    this.home.copy(focus);
    this.pts.position.set(focus.x, 0, focus.z);
    const a = this.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i);
      if (this.rain) {
        y -= dt * 22;
        if (y < 0) y += 18;
        a.setY(i, y);
      } else {
        a.setY(i, y + Math.sin(t * 0.6 + i) * 0.004);
        a.setX(i, a.getX(i) + Math.sin(t * 0.3 + i * 1.7) * 0.01 + dt * 0.4);
        if (a.getX(i) > 35) a.setX(i, -35);
      }
    }
    a.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.pts);
    this.pts.geometry.dispose();
    (this.pts.material as THREE.Material).dispose();
  }
}

export class CityLife {
  private readonly group = new THREE.Group();
  private traffic: Traffic;
  private people: Pedestrians;
  private motes: Motes;
  private clock = Math.random() * 100;
  private paused = false;

  constructor(private readonly scene: THREE.Object3D, layout: CityLayout, art: DistrictArt) {
    scene.add(this.group);
    this.traffic = new Traffic(this.group, layout, art, 26);
    this.people = new Pedestrians(this.group, layout, art, 34);
    this.motes = new Motes(this.group, layout.sector, art);
  }

  /** Hidden during battle and inside rooms: traffic behind a fighting player is noise. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.group.visible = !paused;
  }

  update(dt: number, player: THREE.Vector3, focus: THREE.Vector3): void {
    if (this.paused) return;
    this.clock += dt;
    this.traffic.update(dt, player);
    this.people.update(dt);
    this.motes.update(dt, this.clock, focus);
  }

  /** The cars, for the debug hook: one population now, so one readout. */
  debugCars(): { x: number; z: number; v: number; cruise: number }[] {
    return this.traffic.debug();
  }

  dispose(): void {
    this.traffic.dispose();
    this.people.dispose();
    this.motes.dispose();
    this.scene.remove(this.group);
  }
}
