import * as THREE from 'three';
import type { SF } from '@chog/shared';
import { Particles, Rings, Shots } from './fx.ts';
import { FILES, LANES, MAX_FILES, MAX_LANES, PANEL, PITCH, fileX, isEnemyLane, laneZ, type Palette } from './theme.ts';

/**
 * The battle network: a floating board of glowing panels in a void of moving light.
 *
 * Three to six files wide, five lanes deep — six across a PvP field. Your side is warm and near, the anomaly's cool and far.
 * Panels are one instanced draw call and one shader with five states: idle, danger on an exact
 * warned panel, wall on an enemy file, occupancy, and a downed body on its authoritative panel.
 * The floor itself tells you what is about to happen, before any text
 * does. The backdrop is a dome, a ring of rising light streams and a few huge slow rings: movement
 * at the edge of the picture, so the eye stays on the board.
 */

const PANEL_VERT = /* glsl */ `
  attribute vec3 aTint; attribute float aState; attribute float aPulse; attribute float aDanger;
  varying vec2 vUv; varying vec3 vTint; varying float vState; varying float vPulse; varying float vDanger;
  void main() {
    vUv = uv; vTint = aTint; vState = aState; vPulse = aPulse; vDanger = aDanger;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;

const PANEL_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv; varying vec3 vTint; varying float vState; varying float vPulse; varying float vDanger;
  void main() {
    vec2 p = vUv - 0.5;
    float edge = max(abs(p.x), abs(p.y));
    float rim = smoothstep(0.395, 0.455, edge) * (1.0 - smoothstep(0.455, 0.5, edge));
    // corner brackets: brighter where both axes are near the border
    float corner = smoothstep(0.30, 0.42, abs(p.x)) * smoothstep(0.30, 0.42, abs(p.y));
    vec3 col = vTint * (0.10 + 0.09 * (0.5 + 0.5 * sin(vUv.y * 9.0 - uTime * 1.1)));
    col += vTint * 0.13 * smoothstep(0.5, 0.0, edge);
    col += vTint * (rim * 1.5 + corner * 1.1);
    if (vState > 0.5 && vState < 1.5) {
      float stripes = step(0.5, fract((vUv.x + vUv.y) * 5.0 - uTime * 2.6));
      float blink = 0.55 + 0.45 * sin(uTime * (9.0 + vDanger * 20.0));
      col = mix(col, vec3(1.0, 0.16, 0.22) * 1.2 * blink, 0.28 + 0.22 * stripes + 0.26 * vDanger);
      col += vec3(1.0, 0.25, 0.25) * (rim * 1.6 + corner * 0.8);
    } else if (vState > 1.5 && vState < 2.5) {
      float hatch = step(0.5, fract((vUv.x - vUv.y) * 7.0));
      col = mix(col, vec3(0.7, 0.85, 1.0) * 1.3, 0.16 + 0.26 * hatch);
      col += vec3(0.7, 0.85, 1.0) * rim;
    } else if (vState > 2.5 && vState < 3.5) {
      col += vTint * 0.4 + vTint * (rim * 1.6 + corner);
    } else if (vState > 3.5) {
      // A partner down on this panel, breathing, waiting to be reached.
      float breathe = 0.45 + 0.55 * sin(uTime * 2.4);
      float figure = smoothstep(0.34, 0.30, abs(p.y)) * smoothstep(0.30, 0.26, abs(p.x));
      col = vTint * 0.12 + vec3(1.0, 0.3, 0.42) * (0.1 + 0.15 * breathe + figure * 0.55);
      col += vec3(1.0, 0.35, 0.45) * (rim * 1.3 + corner * 0.6) * breathe;
    }
    col += vec3(1.4, 1.2, 1.0) * vPulse * (1.0 - edge * 1.1);
    gl_FragColor = vec4(col, 0.97);
  }`;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop; uniform vec3 uLow; uniform vec3 uAccent; uniform float uTime;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uLow, uTop, pow(h, 0.55));
    col += uAccent * 0.26 * exp(-abs(d.y) * 6.5);
    float az = atan(d.z, d.x);
    vec2 sp = vec2(az * 46.0, d.y * 70.0);
    vec2 id = floor(sp);
    float star = step(0.986, hash(id));
    col += star * (0.5 + 0.5 * sin(uTime * 3.0 + hash(id + 1.0) * 6.28)) * smoothstep(0.05, 0.4, d.y) * 1.4;
    float band = 0.5 + 0.5 * sin(d.y * 26.0 - uTime * 0.5 + az * 2.0);
    col += uAccent * 0.07 * band * exp(-abs(d.y) * 2.2);
    gl_FragColor = vec4(col * 0.72, 1.0);
  }`;


const STREAM_VERT = /* glsl */ `
  attribute float aPhase; attribute float aSpeed;
  uniform float uTime;
  varying float vFade;
  void main() {
    vec3 p = position;
    float span = 46.0;
    p.y = mod(p.y + uTime * aSpeed + aPhase * span, span) - 14.0;
    vFade = smoothstep(-14.0, -6.0, p.y) * (1.0 - smoothstep(14.0, 32.0, p.y));
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  }`;

const STREAM_FRAG = /* glsl */ `
  uniform vec3 uColor; varying float vFade;
  void main() { gl_FragColor = vec4(uColor * 1.3, vFade * 0.32); }`;

export class Arena {
  readonly group = new THREE.Group();
  readonly particles = new Particles(1600);
  readonly rings = new Rings();
  readonly shots: Shots;
  readonly palette: Palette;

  private readonly panels: THREE.InstancedMesh;
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly state: THREE.InstancedBufferAttribute;
  private readonly pulse: THREE.InstancedBufferAttribute;
  private readonly danger: THREE.InstancedBufferAttribute;
  private readonly panelMat: THREE.ShaderMaterial;
  private readonly bossMark: THREE.Group;
  private readonly bossMarkMat: THREE.MeshBasicMaterial;
  private markX = 0;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly streamMat: THREE.ShaderMaterial;
  private readonly bigRings: THREE.Mesh[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private telegraph: { panels: Set<number>; p: number } | null = null;
  private wall: number | null = null;
  private mine: number | null = null;
  private allies = new Set<number>();
  private bodies = new Set<number>();
  /** The authoritative width can grow when another body joins. */
  private files = FILES;
  /** The authoritative depth: five lanes PvE, six PvP. */
  private lanes = LANES;
  private deck!: THREE.Group;
  private readonly pulses = new Float32Array(MAX_FILES * MAX_LANES);

  constructor(palette: Palette) {
    this.palette = palette;
    const pal = this.palette;
    const track = <T extends { dispose(): void }>(o: T): T => {
      this.disposables.push(o);
      return o;
    };

    // ---------------------------------------------------------------- the panels
    const geo = track(new THREE.PlaneGeometry(PANEL, PANEL));
    geo.rotateX(-Math.PI / 2);
    this.panelMat = track(
      new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: PANEL_VERT, fragmentShader: PANEL_FRAG, transparent: true }),
    );
    const n = MAX_FILES * MAX_LANES;
    this.panels = track(new THREE.InstancedMesh(geo, this.panelMat, n));
    this.panels.frustumCulled = false;
    const tint = new Float32Array(n * 3);
    const mine = new THREE.Color(pal.mine);
    const theirs = new THREE.Color(pal.theirs);
    for (let lane = 0; lane < MAX_LANES; lane++) {
      for (let file = 0; file < MAX_FILES; file++) {
        const c = isEnemyLane(lane) ? theirs : mine;
        tint.set([c.r, c.g, c.b], (lane * MAX_FILES + file) * 3);
      }
    }
    // Positions are laid out rather than baked, so a wider partner can grow the floor mid-fight.
    this.layoutPanels();
    this.tint = new THREE.InstancedBufferAttribute(tint, 3);
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.pulse = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.danger = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    for (const a of [this.state, this.pulse, this.danger]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTint', this.tint);
    geo.setAttribute('aState', this.state);
    geo.setAttribute('aPulse', this.pulse);
    geo.setAttribute('aDanger', this.danger);
    this.group.add(this.panels);

    // ---------------------------------------------------------------- the boss's mark
    // it hovers, so the body alone does not say which row it stands on: a ring on the floor does
    this.bossMarkMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.3, 0.35), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.bossMark = new THREE.Group();
    const markRing = new THREE.Mesh(track(new THREE.RingGeometry(0.86, 0.98, 48)), this.bossMarkMat);
    const markCore = new THREE.Mesh(track(new THREE.RingGeometry(0.36, 0.42, 32)), this.bossMarkMat);
    const tickGeo = track(new THREE.PlaneGeometry(0.14, 0.5));
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(tickGeo, this.bossMarkMat);
      const ang = (i * Math.PI) / 2;
      tick.position.set(Math.cos(ang) * 1.18, 0, Math.sin(ang) * 1.18);
      tick.rotation.set(-Math.PI / 2, 0, -ang + Math.PI / 2);
      this.bossMark.add(tick);
    }
    markRing.rotation.x = markCore.rotation.x = -Math.PI / 2;
    this.bossMark.add(markRing, markCore);
    this.bossMark.position.set(0, 0.17, laneZ(1) - 0.2);
    this.group.add(this.bossMark);

    // ---------------------------------------------------------------- the slab under them
    // Built at the widest the floor can be and scaled to the width it has, so growing the arena is
    // one number rather than new geometry in the middle of a fight.
    const w = MAX_FILES * PITCH + 1.4;
    const d = MAX_LANES * PITCH + 1.4;
    const deck = new THREE.Group();
    const slab = new THREE.Mesh(track(new THREE.BoxGeometry(w, 0.7, d)), track(new THREE.MeshLambertMaterial({ color: 0x0c0a1a })));
    slab.position.y = -0.36;
    deck.add(slab);
    const edges = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(slab.geometry)),
      track(new THREE.LineBasicMaterial({ color: new THREE.Color(pal.accent).multiplyScalar(2), toneMapped: false })),
    );
    edges.position.y = -0.36;
    deck.add(edges);
    // the island keeps going down: a hex keel with lit seams, so the board floats rather than sits
    const keel = new THREE.Mesh(track(new THREE.CylinderGeometry(w * 0.5, 1.2, 7, 6, 1, true)), track(new THREE.MeshLambertMaterial({ color: 0x120e24, side: THREE.DoubleSide })));
    keel.position.y = -4.2;
    keel.rotation.y = Math.PI / 6;
    deck.add(keel);
    const keelLines = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(keel.geometry)),
      track(new THREE.LineBasicMaterial({ color: new THREE.Color(pal.accent2).multiplyScalar(1.3), transparent: true, opacity: 0.55, toneMapped: false })),
    );
    keelLines.position.y = -4.2;
    keelLines.rotation.y = Math.PI / 6;
    deck.add(keelLines);
    this.group.add(deck);
    this.deck = deck;

    // ---------------------------------------------------------------- the dome
    this.skyMat = track(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uTop: { value: new THREE.Color(pal.top) }, uLow: { value: new THREE.Color(pal.low) }, uAccent: { value: new THREE.Color(pal.accent) }, uTime: { value: 0 } },
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
      }),
    );
    const dome = new THREE.Mesh(track(new THREE.SphereGeometry(240, 40, 24)), this.skyMat);
    dome.renderOrder = -100;
    this.group.add(dome);

    // ---------------------------------------------------------------- rising streams
    const STREAMS = 70;
    const sgeo = track(new THREE.BoxGeometry(0.05, 9, 0.05));
    this.streamMat = track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(pal.accent) } },
        vertexShader: STREAM_VERT,
        fragmentShader: STREAM_FRAG,
      }),
    );
    const streams = track(new THREE.InstancedMesh(sgeo, this.streamMat, STREAMS));
    streams.frustumCulled = false;
    const phase = new Float32Array(STREAMS);
    const speed = new Float32Array(STREAMS);
    const at = new THREE.Matrix4();
    for (let i = 0; i < STREAMS; i++) {
      // only ever behind and beside the board: a light that rises *past* the camera is a wall
      const a = Math.PI + (Math.random() - 0.5) * Math.PI * 0.95;
      const r = 30 + Math.random() * 45;
      at.makeTranslation(Math.cos(a) * r, 0, Math.sin(a) * r - 4);
      streams.setMatrixAt(i, at);
      phase[i] = Math.random();
      speed[i] = 2.5 + Math.random() * 5;
    }
    sgeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    sgeo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speed, 1));
    this.group.add(streams);

    // ---------------------------------------------------------------- slow, huge rings
    // face-on halos far behind the boss, like the rings of a targeting display
    for (const [r, y, tilt, col] of [
      [9, 3.2, 0, pal.accent],
      [14, 3.2, 0, pal.accent2],
      [21, 3.2, 0, pal.accent],
    ] as const) {
      const ring = new THREE.Mesh(
        track(new THREE.TorusGeometry(r, 0.07, 6, 120)),
        track(new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(1.5), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
      );
      // behind the boss, and the lens looks along -x: face-on to it
      ring.position.set(-30, y, 0);
      ring.rotation.set(tilt, Math.PI / 2, 0);
      this.bigRings.push(ring);
      this.group.add(ring);
    }


    this.group.add(this.particles.points, this.rings.group);
    this.shots = new Shots(this.particles, this.rings);
    this.group.add(this.shots.group);
    this.applyStates();
  }

  /** The centre of a panel, lifted a little, for anything that wants to stand or burst there. */
  panelAt(file: number, lane: number, y = 0.1): THREE.Vector3 {
    return new THREE.Vector3(fileX(file, this.files), y, laneZ(lane, this.lanes));
  }

  /** Both axes follow the server's boss panel. */
  setBossMark(panel: SF.Panel, show = true): void {
    this.markX = fileX(panel.file, this.files);
    this.bossMark.position.set(this.markX, 0.17, laneZ(panel.lane, this.lanes));
    this.bossMark.visible = show;
  }

  /** Never expand a one-lane warning into an entire file. */
  setTelegraph(panels: readonly SF.Panel[] | null, progress = 0): void {
    this.telegraph = panels?.length ? { panels: new Set(panels.map((p) => p.lane * MAX_FILES + p.file)), p: progress } : null;
    this.applyStates();
  }

  /** A Front's wall: cards anchored on this file are absorbed. */
  setWall(file: number | null): void {
    if (this.wall === file) return;
    this.wall = file;
    this.applyStates();
  }

  setMine(panel: SF.Panel | null): void {
    const next = panel ? panel.lane * MAX_FILES + panel.file : null;
    if (this.mine === next) return;
    this.mine = next;
    this.applyStates();
  }

  setAllies(panels: readonly SF.Panel[]): void {
    this.allies = new Set(panels.map((p) => p.lane * MAX_FILES + p.file));
    this.applyStates();
  }

  /** Downed bodies keep their actual panel. */
  setBodies(panels: readonly SF.Panel[]): void {
    const next = new Set(panels.map((p) => p.lane * MAX_FILES + p.file));
    if (next.size === this.bodies.size && [...next].every((f) => this.bodies.has(f))) return;
    this.bodies = next;
    this.applyStates();
  }

  /**
   * Position every panel for the floor's current width. Files past that width are collapsed to
   * nothing, so widening the arena is a re-layout rather than new geometry mid-fight.
   */
  private layoutPanels(): void {
    const m = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const on = new THREE.Vector3(1, 1, 1);
    const off = new THREE.Vector3(0, 0, 0);
    for (let lane = 0; lane < MAX_LANES; lane++) {
      for (let file = 0; file < MAX_FILES; file++) {
        m.compose(at.set(fileX(file, this.files), 0.08, laneZ(lane, this.lanes)), q, file < this.files && lane < this.lanes ? on : off);
        this.panels.setMatrixAt(lane * MAX_FILES + file, m);
      }
    }
    this.panels.instanceMatrix.needsUpdate = true;
    if (this.deck) this.deck.scale.x = (this.files * PITCH + 1.4) / (MAX_FILES * PITCH + 1.4);
    if (this.deck) this.deck.scale.z = (this.lanes * PITCH + 1.4) / (MAX_LANES * PITCH + 1.4);
  }

  /** Match the snapshot's field width without rebuilding owned geometry. */
  setFiles(n: number, lanes: number = this.lanes): void {
    const next = Math.max(FILES, Math.min(MAX_FILES, Math.round(n)));
    const nextLanes = Math.max(LANES, Math.min(MAX_LANES, Math.round(lanes)));
    if (next === this.files && nextLanes === this.lanes) return;
    this.files = next;
    this.lanes = nextLanes;
    this.layoutPanels();
    this.applyStates();
  }

  flash(file: number, lane: number, strength = 1): void {
    const i = lane * MAX_FILES + file;
    this.pulses[i] = Math.max(this.pulses[i]!, strength);
  }


  private applyStates(): void {
    const s = this.state.array as Float32Array;
    const dg = this.danger.array as Float32Array;
    for (let lane = 0; lane < MAX_LANES; lane++) {
      for (let file = 0; file < MAX_FILES; file++) {
        const i = lane * MAX_FILES + file;
        // Files past this floor's width are written out rather than left stale, so a shrink after a
        // partner leaves cannot leave a lit panel floating in the void.
        if (file >= this.files || lane >= this.lanes) { s[i] = 0; dg[i] = 0; this.pulses[i] = 0; continue; }
        let st = 0;
        let d = 0;
        if (this.wall === file && isEnemyLane(lane)) st = 2;
        if (this.telegraph?.panels.has(i)) {
          st = 1;
          d = this.telegraph.p;
        } else if (this.bodies.has(i)) st = 4;
        else if (i === this.mine || this.allies.has(i)) st = 3;
        s[i] = st;
        dg[i] = d;
      }
    }
    this.state.needsUpdate = true;
    this.danger.needsUpdate = true;
  }

  update(dt: number, t: number, camera: THREE.Camera, viewHeight: number, fov: number): void {
    this.panelMat.uniforms.uTime!.value = t;
    this.skyMat.uniforms.uTime!.value = t;
    this.streamMat.uniforms.uTime!.value = t;
    const p = this.pulse.array as Float32Array;
    for (let i = 0; i < p.length; i++) p[i] = Math.max(0, this.pulses[i]! - dt * 3.2), (this.pulses[i] = p[i]!);
    this.pulse.needsUpdate = true;
    if (this.telegraph) {
      // the warning intensifies while it lasts
      const d = this.danger.array as Float32Array;
      for (const i of this.telegraph.panels) d[i] = this.telegraph.p;
      this.danger.needsUpdate = true;
    }
    this.bossMark.rotation.y += dt * 0.7;
    this.bossMarkMat.opacity = 0.55 + 0.2 * Math.sin(t * 3);
    this.bigRings.forEach((r, i) => {
      r.rotation.z += dt * (0.05 + i * 0.03) * (i % 2 ? -1 : 1);
    });
    // drifting motes, so the air is never still
    if (Math.random() < 0.55) {
      this.particles.emit(new THREE.Vector3((Math.random() - 0.5) * 22, Math.random() * 8 - 1, laneZ(2) + (Math.random() - 0.5) * 22), new THREE.Color(this.palette.accent).multiplyScalar(0.9), {
        vy: 0.3 + Math.random() * 0.5,
        life: 3.5,
        size: 0.08 + Math.random() * 0.1,
        drag: 0.2,
      });
    }
    this.particles.setView(viewHeight, fov);
    this.particles.update(dt);
    this.rings.update(dt, camera);
    this.shots.update(dt, t);
  }

  dispose(): void {
    // Shots owns shared geometry, but its live projectile materials need explicit release.
    const shotMaterials = new Set<THREE.Material>();
    this.shots.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) shotMaterials.add(material);
    });
    this.shots.onImpact = null;
    this.shots.dispose();
    for (const material of shotMaterials) material.dispose();
    this.particles.dispose();
    this.rings.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.telegraph = null;
    this.allies.clear();
    this.bodies.clear();
    this.group.removeFromParent();
    this.group.clear();
  }
}
