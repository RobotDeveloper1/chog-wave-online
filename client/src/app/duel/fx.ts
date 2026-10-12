import * as THREE from 'three';
import { ELEMENT_HEX, clamp, easeOut } from './theme.ts';

/**
 * The duel's effects: sparks, shock rings, lightning, the cards in flight, and the numbers
 * that rise off a hit.
 *
 * Everything is cheap on purpose — one `Points` for every spark on screen, a small pool of
 * rings, a handful of meshes for the shots — because the interesting thing about the duel's
 * look is *light*, and light here is bloom on emissive colour, not real lights. Every colour
 * is pushed above 1.0 so the grade's bloom pass has something to take.
 */

// ---------------------------------------------------------------------------
// Sparks
// ---------------------------------------------------------------------------

export interface SparkOpts {
  /** Initial velocity and its random spread. */
  vx?: number;
  vy?: number;
  vz?: number;
  spread?: number;
  size?: number;
  life?: number;
  drag?: number;
  gravity?: number;
  /** Size growth per second (a puff of smoke grows, a spark does not). */
  grow?: number;
}

export class Particles {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly total: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly grow: Float32Array;
  private readonly base: Float32Array;
  private head = 0;
  private live = 0;
  private readonly uniforms = { uPx: { value: 400 } };

  constructor(max = 1400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.total = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.base = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uPx;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(0.0, aSize * uPx / max(0.5, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * (0.9 + a), a * a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  /** Tell the shader how many pixels one world unit is at distance 1, so size survives resizes. */
  setView(heightPx: number, fovDeg: number): void {
    this.uniforms.uPx.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(at: THREE.Vector3, colour: THREE.Color, o: SparkOpts = {}): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.live = Math.min(this.max, this.live + 1);
    const s = o.spread ?? 0;
    this.pos[i * 3] = at.x;
    this.pos[i * 3 + 1] = at.y;
    this.pos[i * 3 + 2] = at.z;
    this.vel[i * 3] = (o.vx ?? 0) + (Math.random() - 0.5) * 2 * s;
    this.vel[i * 3 + 1] = (o.vy ?? 0) + (Math.random() - 0.5) * 2 * s;
    this.vel[i * 3 + 2] = (o.vz ?? 0) + (Math.random() - 0.5) * 2 * s;
    this.col[i * 3] = colour.r;
    this.col[i * 3 + 1] = colour.g;
    this.col[i * 3 + 2] = colour.b;
    this.base[i] = o.size ?? 0.22;
    this.size[i] = this.base[i]!;
    this.life[i] = this.total[i] = o.life ?? 0.6;
    this.drag[i] = o.drag ?? 1.5;
    this.grav[i] = o.gravity ?? 0;
    this.grow[i] = o.grow ?? 0;
    this.alpha[i] = 1;
  }

  /** A ball of sparks flying outward from a point. */
  burst(at: THREE.Vector3, colour: THREE.Color, count: number, speed: number, life = 0.7, size = 0.24, extra: SparkOpts = {}): void {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.35 + Math.random() * 0.65);
      this.emit(at, colour, {
        vx: Math.sin(b) * Math.cos(a) * v,
        vy: Math.cos(b) * v,
        vz: Math.sin(b) * Math.sin(a) * v,
        life: life * (0.6 + Math.random() * 0.6),
        size: size * (0.6 + Math.random() * 0.8),
        ...extra,
      });
    }
  }

  update(dt: number): void {
    const n = this.max;
    for (let i = 0; i < n; i++) {
      const l = this.life[i]!;
      if (l <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const nl = l - dt;
      this.life[i] = nl;
      if (nl <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const k = Math.max(0, 1 - this.drag[i]! * dt);
      this.vel[i * 3] = this.vel[i * 3]! * k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * k - this.grav[i]! * dt;
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2]! * k;
      this.pos[i * 3] = this.pos[i * 3]! + this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt;
      const t = nl / this.total[i]!;
      this.alpha[i] = Math.min(1, t * 2.2) * Math.min(1, (1 - t) * 14 + 0.25);
      this.size[i] = this.base[i]! * (t * 0.7 + 0.3) + this.grow[i]! * (1 - t) * this.total[i]!;
    }
    const g = this.points.geometry;
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  size: number;
  free: boolean;
}

/** Expanding shock rings, flat on the floor or standing up facing the lens. */
export class Rings {
  readonly group = new THREE.Group();
  private readonly pool: Ring[] = [];

  constructor(n = 14) {
    const geo = new THREE.RingGeometry(0.82, 1, 56);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 18;
      this.group.add(mesh);
      this.pool.push({ mesh, t: 0, life: 1, size: 1, free: true });
    }
  }

  spawn(at: THREE.Vector3, colour: THREE.Color, size = 3, life = 0.5, flat = true): void {
    const r = this.pool.find((x) => x.free) ?? this.pool[0]!;
    r.free = false;
    r.t = 0;
    r.life = life;
    r.size = size;
    r.mesh.visible = true;
    r.mesh.position.copy(at);
    r.mesh.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    (r.mesh.material as THREE.MeshBasicMaterial).color.copy(colour).multiplyScalar(1.7);
  }

  update(dt: number, camera: THREE.Camera): void {
    for (const r of this.pool) {
      if (r.free) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        r.free = true;
        r.mesh.visible = false;
        continue;
      }
      const e = easeOut(k);
      r.mesh.scale.setScalar(0.2 + r.size * e);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
      if (r.mesh.rotation.x === 0) r.mesh.lookAt(camera.position);
    }
  }

  dispose(): void {
    this.pool[0]?.mesh.geometry.dispose();
    for (const r of this.pool) (r.mesh.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// Lightning
// ---------------------------------------------------------------------------

/** A jittering bolt between two points, redrawn every frame so it crawls. */
export class Bolt {
  readonly line: THREE.Line;
  private readonly seg: number;
  private readonly arr: Float32Array;
  from = new THREE.Vector3();
  to = new THREE.Vector3();
  amp = 0.35;

  constructor(colour: THREE.Color, segments = 9) {
    this.seg = segments;
    this.arr = new Float32Array((segments + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.arr, 3).setUsage(THREE.DynamicDrawUsage));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: colour.clone().multiplyScalar(2.2), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.line.frustumCulled = false;
    this.line.renderOrder = 19;
  }

  redraw(): void {
    for (let i = 0; i <= this.seg; i++) {
      const t = i / this.seg;
      const edge = Math.sin(t * Math.PI);
      this.arr[i * 3] = this.from.x + (this.to.x - this.from.x) * t + (Math.random() - 0.5) * this.amp * edge;
      this.arr[i * 3 + 1] = this.from.y + (this.to.y - this.from.y) * t + (Math.random() - 0.5) * this.amp * edge;
      this.arr[i * 3 + 2] = this.from.z + (this.to.z - this.from.z) * t + (Math.random() - 0.5) * this.amp * edge;
    }
    (this.line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

interface Floater {
  el: HTMLElement;
  at: THREE.Vector3;
  born: number;
  life: number;
}

/** Damage numbers and call-outs, as DOM text pinned to a point in the world. */
export class Floaters {
  private readonly host: HTMLElement;
  private readonly items: Floater[] = [];
  private readonly v = new THREE.Vector3();

  constructor(host: HTMLElement) {
    this.host = host;
  }

  add(at: THREE.Vector3, text: string, cls = '', life = 1.1): void {
    const el = document.createElement('div');
    el.className = `dfloat ${cls}`;
    el.innerHTML = `<span>${text}</span>`;
    this.host.appendChild(el);
    this.items.push({ el, at: at.clone(), born: performance.now(), life: life * 1000 });
    // Never let a long fight leave hundreds of nodes behind.
    while (this.items.length > 40) this.items.shift()!.el.remove();
  }

  update(camera: THREE.Camera, w: number, h: number): void {
    const now = performance.now();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i]!;
      if (now - f.born > f.life) {
        f.el.remove();
        this.items.splice(i, 1);
        continue;
      }
      this.v.copy(f.at).project(camera);
      const on = this.v.z < 1 && Math.abs(this.v.x) < 1.4 && Math.abs(this.v.y) < 1.4;
      f.el.style.display = on ? '' : 'none';
      f.el.style.left = `${((this.v.x + 1) / 2) * w}px`;
      f.el.style.top = `${((1 - this.v.y) / 2) * h}px`;
    }
  }

  clear(): void {
    for (const f of this.items) f.el.remove();
    this.items.length = 0;
  }
}

// ---------------------------------------------------------------------------
// The cards in flight
// ---------------------------------------------------------------------------

export interface ShotSpec {
  chipId: string;
  element: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Three or more hits, or a Mega: drawn bigger and louder. */
  big: boolean;
  /** A fused card: bigger still, with a ring. */
  fused: boolean;
  /** Seconds to cross the field. */
  flight: number;
}

export interface ShotOutcome {
  hit: boolean;
  damage?: number;
  weak?: number;
  chain?: number;
  blocked?: boolean;
}

interface Shot {
  id: number;
  spec: ShotSpec;
  group: THREE.Group;
  core: THREE.Mesh;
  extra: THREE.Object3D[];
  bolt: Bolt | null;
  t: number;
  state: 'flight' | 'wait' | 'hit' | 'miss' | 'done';
  waited: number;
  fade: number;
  outcome: ShotOutcome | null;
  colour: THREE.Color;
  hue: number;
}

/**
 * The visual half of a program. The server decides whether each card lands; the shot flies
 * the field at once, parks at the boss, and the moment the server's verdict arrives it either
 * bursts there or carries on past it and fizzles. So what you see is what was scored, and a
 * miss is *visibly* a miss.
 */
export class Shots {
  readonly group = new THREE.Group();
  private readonly shots: Shot[] = [];
  private nextId = 1;
  onImpact: ((s: ShotSpec, o: ShotOutcome, at: THREE.Vector3) => void) | null = null;
  private readonly fx: Particles;
  private readonly rings: Rings;
  private readonly sphere = new THREE.SphereGeometry(0.5, 20, 14);
  private readonly octa = new THREE.OctahedronGeometry(0.6, 0);
  private readonly torus = new THREE.TorusGeometry(0.5, 0.12, 10, 28);
  private readonly capsule = new THREE.CapsuleGeometry(0.28, 1.1, 6, 12);

  constructor(fx: Particles, rings: Rings) {
    this.fx = fx;
    this.rings = rings;
  }

  fire(spec: ShotSpec): number {
    const colour = new THREE.Color(ELEMENT_HEX[spec.element] ?? 0xffffff);
    const group = new THREE.Group();
    const mat = (c: THREE.Color, k = 2): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), toneMapped: false });
    const scale = (spec.fused ? 2.1 : spec.big ? 1.5 : 1) * 0.8;
    let core: THREE.Mesh;
    const extra: THREE.Object3D[] = [];
    let bolt: Bolt | null = null;
    switch (spec.element) {
      case 'frost':
        core = new THREE.Mesh(this.octa, mat(colour));
        break;
      case 'wave':
        core = new THREE.Mesh(this.torus, mat(colour));
        core.rotation.x = Math.PI / 2;
        extra.push(new THREE.Mesh(this.sphere, mat(colour, 1.2)));
        extra[0]!.scale.setScalar(0.55);
        break;
      case 'prism':
        core = new THREE.Mesh(this.capsule, mat(colour));
        core.rotation.x = Math.PI / 2;
        break;
      case 'void': {
        core = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: 0x0a0414, toneMapped: false }));
        const halo = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(2.2), side: THREE.BackSide, toneMapped: false }));
        halo.scale.setScalar(1.28);
        extra.push(halo);
        break;
      }
      case 'volt':
        core = new THREE.Mesh(this.sphere, mat(colour, 2.4));
        core.scale.setScalar(0.6);
        bolt = new Bolt(colour);
        group.add(bolt.line);
        break;
      default: {
        core = new THREE.Mesh(this.sphere, mat(colour, 2.2));
        const white = new THREE.Mesh(this.sphere, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 2), toneMapped: false }));
        white.scale.setScalar(0.5);
        extra.push(white);
      }
    }
    group.add(core, ...extra);
    group.scale.setScalar(scale);
    group.position.copy(spec.from);
    this.group.add(group);
    const shot: Shot = { id: this.nextId++, spec, group, core, extra, bolt, t: 0, state: 'flight', waited: 0, fade: 1, outcome: null, colour, hue: Math.random() };
    this.shots.push(shot);
    return shot.id;
  }

  /** The first parked or flying shot of this card, so the verdict finds its own projectile. */
  resolve(chipId: string, outcome: ShotOutcome): boolean {
    const s = this.shots.find((x) => x.spec.chipId === chipId && !x.outcome && (x.state === 'flight' || x.state === 'wait'));
    if (!s) return false;
    s.outcome = outcome;
    return true;
  }

  get busy(): boolean {
    return this.shots.length > 0;
  }

  update(dt: number, time: number): void {
    for (const s of this.shots) {
      s.t += dt;
      const p = s.group.position;
      const k = clamp(s.t / s.spec.flight, 0, 1);
      if (s.state === 'flight') {
        const e = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
        p.lerpVectors(s.spec.from, s.spec.to, e);
        p.y += Math.sin(k * Math.PI) * 0.7;
        if (k >= 1) s.state = 'wait';
      } else if (s.state === 'wait') {
        s.waited += dt;
        p.copy(s.spec.to);
        // hover and pulse at the target until the server's verdict arrives
        s.group.scale.setScalar((s.spec.fused ? 2.1 : s.spec.big ? 1.5 : 1) * 0.8 * (1 + 0.1 * Math.sin(time * 40)));
        if (s.outcome || s.waited > 0.85) {
          const o = s.outcome ?? { hit: false };
          s.outcome = o;
          s.state = o.hit ? 'hit' : 'miss';
        }
      }

      // each element moves differently
      switch (s.spec.element) {
        case 'frost':
          s.core.rotation.y += dt * 9;
          s.core.rotation.x += dt * 6;
          break;
        case 'wave':
          s.core.scale.setScalar(1 + 0.18 * Math.sin(time * 22));
          break;
        case 'prism':
          s.hue = (s.hue + dt * 1.8) % 1;
          (s.core.material as THREE.MeshBasicMaterial).color.setHSL(s.hue, 0.8, 0.62).multiplyScalar(2.3);
          break;
        case 'volt':
          if (s.bolt) {
            s.bolt.from.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6));
            s.bolt.to.copy(p);
            s.bolt.line.position.copy(p).multiplyScalar(-1);
            s.bolt.redraw();
          }
          break;
        case 'void':
          s.core.rotation.y += dt * 4;
          this.fx.emit(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4)), s.colour.clone().multiplyScalar(1.4), { vx: (p.x - p.x) * 0, life: 0.35, size: 0.2, drag: 3 });
          break;
        default:
          break;
      }

      // trail
      if (s.state === 'flight' || s.state === 'wait') {
        this.fx.emit(p, s.colour.clone().multiplyScalar(1.5), { spread: 0.8, life: 0.45, size: s.spec.big ? 0.34 : 0.24, drag: 2.2, grow: 0.25 });
        if (s.spec.fused) this.fx.emit(p, new THREE.Color(2, 1.8, 1.6), { spread: 1.2, life: 0.6, size: 0.3 });
      }

      if (s.state === 'hit') {
        const o = s.outcome!;
        this.fx.burst(p, s.colour.clone().multiplyScalar(1.6), s.spec.big ? 46 : 26, s.spec.big ? 9 : 6, 0.7, 0.3);
        this.fx.burst(p, new THREE.Color(2.5, 2.3, 2), 10, 4, 0.35, 0.26);
        this.rings.spawn(p, s.colour, s.spec.big ? 5.5 : 3.8, 0.5, false);
        this.onImpact?.(s.spec, o, p.clone());
        s.state = 'done';
      } else if (s.state === 'miss') {
        // carry on past the boss, thinning out: a miss that disappears reads as a bug
        s.fade -= dt * 2.2;
        p.z -= dt * 14;
        s.group.scale.multiplyScalar(Math.max(0.2, 1 - dt * 2.4));
        if (s.fade <= 0) {
          this.fx.burst(p, s.colour, 6, 3, 0.4, 0.18);
          this.onImpact?.(s.spec, s.outcome ?? { hit: false }, p.clone());
          s.state = 'done';
        }
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      if (this.shots[i]!.state === 'done') {
        const s = this.shots[i]!;
        this.group.remove(s.group);
        s.bolt?.dispose();
        for (const o of [s.core, ...s.extra]) (((o as THREE.Mesh).material) as THREE.Material).dispose();
        this.shots.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const s of this.shots) {
      this.group.remove(s.group);
      s.bolt?.dispose();
    }
    this.shots.length = 0;
    this.sphere.dispose();
    this.octa.dispose();
    this.torus.dispose();
    this.capsule.dispose();
  }
}
