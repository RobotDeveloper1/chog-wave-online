import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Bolt } from './fx.ts';
import { ELEMENT_HEX, clamp, laneZ } from './theme.ts';

/**
 * The anomaly, drawn.
 *
 * It is a *signal that learned to look like something*: a body that is mostly displaced
 * light, a skin of scanlines, a tear that slides across it, two colour-split ghosts that
 * never quite line up. One shader does most of it (`glitch`), and the archetypes are the
 * same creature dressed differently — the Baron grows armour, the Mirror grows a reflection,
 * the Surge grows a storm — because the fight is already different and the picture only has
 * to say so at a glance. Nothing here loads a model: it is all geometry and light, which is
 * also why it can be as loud as it likes.
 */

export interface BossState {
  phase: number;
  /** 0..1 while the boss is warning, so it can gather itself. */
  warn: number;
  /** 0..1 of its health left. */
  hp: number;
}

export interface BossAvatar {
  root: THREE.Group;
  update(dt: number, t: number, s: BossState): void;
  moveTo(x: number): void;
  hurt(power: number): void;
  lunge(): void;
  die(): void;
  readonly dead: boolean;
  /** Where its face is, for effects that should come out of it. */
  eye(): THREE.Vector3;
  dispose(): void;
}

const GLITCH_VERT = /* glsl */ `
  uniform float uTime; uniform float uGlitch;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 p = position;
    float n = noise(p * 2.3 + uTime * 0.9);
    p += normal * (n - 0.5) * (0.18 + uGlitch * 0.55);
    // The tear: whole slabs of the body slide sideways for a frame.
    float slice = floor((p.y + 3.0) * 5.0);
    float tick = floor(uTime * 9.0);
    float tear = step(0.93 - uGlitch * 0.3, hash(vec3(slice, tick, 3.1)));
    p.x += tear * (hash(vec3(slice, tick, 7.7)) - 0.5) * (0.45 + uGlitch * 1.4);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    vP = p;
    gl_Position = projectionMatrix * mv;
  }`;

const GLITCH_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uColor2; uniform float uTime; uniform float uHurt; uniform float uWarn; uniform float uChrome;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    vec3 N = normalize(vN); vec3 V = normalize(vV);
    float fres = pow(1.0 - max(0.0, dot(N, V)), 2.2);
    float scan = 0.5 + 0.5 * sin(vP.y * 36.0 - uTime * 5.0);
    float bands = step(0.5, fract(vP.y * 2.6 + uTime * 0.5));
    vec3 col = mix(uColor2, uColor, 0.4 + 0.4 * scan);
    col += fres * uColor * 2.4;
    col += bands * 0.07 * uColor;
    // chrome: a hard horizon in the reflection, for the Mirror
    float horizon = smoothstep(-0.1, 0.1, N.y + 0.2 * sin(uTime * 0.7));
    col = mix(col, mix(vec3(0.05, 0.05, 0.1), vec3(1.8), horizon) * (0.6 + fres), uChrome);
    col = mix(col, vec3(3.2), uHurt);
    col += uWarn * vec3(1.9, 0.25, 0.3) * (0.45 + 0.55 * sin(uTime * 30.0));
    gl_FragColor = vec4(col, 1.0);
  }`;

function glitchMaterial(colour: THREE.Color, colour2: THREE.Color, chrome = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGlitch: { value: 0.2 },
      uColor: { value: colour.clone() },
      uColor2: { value: colour2.clone() },
      uHurt: { value: 0 },
      uWarn: { value: 0 },
      uChrome: { value: chrome },
    },
    vertexShader: GLITCH_VERT,
    fragmentShader: GLITCH_FRAG,
  });
}

/** A soft round glow, drawn once and shared. */
let glowTex: THREE.CanvasTexture | null = null;
function glow(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** The practice dummy's face: a target, so the first fight is a thing you can read. */
function targetTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#141028';
  g.fillRect(0, 0, 256, 256);
  const rings = ['#ff4f6a', '#f4f0ff', '#ff4f6a', '#f4f0ff', '#ff4f6a'];
  rings.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(128, 128, 118 - i * 22, 0, Math.PI * 2);
    g.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildBoss(archetype: string, element: string, tier: string): BossAvatar {
  const colour = new THREE.Color(ELEMENT_HEX[element] ?? 0xa874ff);
  const dark = colour.clone().multiplyScalar(0.18);
  const rose = new THREE.Color(0xff3a5a);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const dummy = archetype === 'dummy';
  const baron = archetype === 'baron';
  const mirror = archetype === 'mirror';
  const spark = archetype === 'spark';
  const surge = archetype === 'surge';
  const front = archetype === 'front';
  const imp = archetype === 'imp';
  const wisp = archetype === 'wisp';
  const husk = archetype === 'husk';
  const big = tier === 'storm' ? 1.12 : 1;
  const size = (baron ? 1.3 : husk ? 1.05 : spark ? 0.82 : imp ? 0.68 : wisp ? 0.9 : dummy ? 0.95 : 1) * big;

  const mats: THREE.ShaderMaterial[] = [];
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };

  // ---------------------------------------------------------------- the body
  let coreGeo: THREE.BufferGeometry;
  if (dummy) coreGeo = track(new RoundedBoxGeometry(2.2, 2.2, 2.2, 5, 0.32));
  else if (baron) coreGeo = track(new THREE.DodecahedronGeometry(1.35, 1));
  else if (spark) coreGeo = track(new THREE.IcosahedronGeometry(1.0, 2));
  else if (front) coreGeo = track(new RoundedBoxGeometry(1.5, 3.0, 1.5, 4, 0.25));
  else if (imp) coreGeo = track(new THREE.TetrahedronGeometry(1.2, 1));
  else if (wisp) coreGeo = track(new THREE.TorusGeometry(0.85, 0.3, 12, 28));
  else if (husk) coreGeo = track(new RoundedBoxGeometry(1.8, 1.8, 1.8, 3, 0.12));
  else coreGeo = track(new THREE.IcosahedronGeometry(1.35, 3));

  const coreMat = glitchMaterial(colour, dark, mirror ? 0.85 : 0);
  mats.push(coreMat);
  const cores: THREE.Mesh[] = [];
  if (front) {
    // three pillars side by side: a wall that stands in all the files at once
    for (const x of [-2.2, 0, 2.2]) {
      const m = new THREE.Mesh(coreGeo, coreMat);
      m.position.x = x;
      cores.push(m);
      body.add(m);
    }
  } else {
    const m = new THREE.Mesh(coreGeo, coreMat);
    cores.push(m);
    body.add(m);
  }

  // The training dummy is the first thing a new Chog meets, and it has to read as a
  // training device, not a bare cube: a bullseye target on the front and a signal antenna
  // on top, so the body sweep is a scanner instead of a mystery spin.
  if (dummy) {
    const targetMat = track(new THREE.MeshBasicMaterial({ map: targetTexture() }));
    const target = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), targetMat);
    target.position.z = 1.12;
    body.add(target);
    const antMat = track(new THREE.MeshBasicMaterial({ color: 0xffd070 }));
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 8), antMat);
    ant.position.y = 1.5;
    body.add(ant);
    const tipMat = track(new THREE.MeshBasicMaterial({ color: 0xff5a2a }));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), tipMat);
    tip.position.y = 1.85;
    body.add(tip);
  }

  // colour-split ghosts: the cheapest way to make a thing look like a broken signal
  const ghostGeo = coreGeo;
  const ghosts: THREE.Mesh[] = [];
  if (!dummy) {
    for (const [c, k] of [[0xff3050, -1], [0x30d0ff, 1]] as const) {
      const m = new THREE.Mesh(
        ghostGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.6), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      m.userData.k = k;
      m.scale.setScalar(1.03);
      ghosts.push(m);
      body.add(m);
      track(m.material as THREE.Material);
    }
  }

  // the target face of the practice dummy
  if (dummy) {
    const face = new THREE.Mesh(track(new THREE.CircleGeometry(0.95, 40)), track(new THREE.MeshBasicMaterial({ map: targetTexture(), toneMapped: false })));
    face.position.z = 1.12;
    body.add(face);
    const rim = new THREE.Mesh(track(new THREE.TorusGeometry(1.0, 0.06, 8, 40)), track(new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(2), toneMapped: false })));
    rim.position.z = 1.12;
    body.add(rim);
  }

  // ---------------------------------------------------------------- eyes
  const eyeMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3), toneMapped: false }));
  const eyes: THREE.Mesh[] = [];
  if (!dummy) {
    const eyeGeo = track(new THREE.CapsuleGeometry(0.075, 0.5, 4, 8));
    for (const x of front ? [-2.2, 2.2] : wisp ? [-0.62, 0.62] : [-0.42, 0.42]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.rotation.z = Math.PI / 2 + (x < 0 ? 0.28 : -0.28);
      e.position.set(x, 0.22, front ? 0.78 : wisp ? 0.35 : 1.2);
      eyes.push(e);
      body.add(e);
    }
    if (front) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.rotation.z = Math.PI / 2;
      e.position.set(0, 0.22, 0.78);
      eyes.push(e);
      body.add(e);
    }
  }

  // ---------------------------------------------------------------- orbiting parts
  const ringMat = track(new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(1.8), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const ringA = new THREE.Mesh(track(new THREE.TorusGeometry(wisp ? 2.6 : 2.25, 0.045, 8, 80)), ringMat);
  const ringB = new THREE.Mesh(track(new THREE.TorusGeometry(wisp ? 3.0 : 2.7, 0.03, 8, 80)), ringMat);
  ringA.rotation.x = Math.PI / 2.4;
  ringB.rotation.x = Math.PI / 1.9;
  ringB.rotation.y = 0.6;
  if (!dummy) body.add(ringA, ringB);

  const SHARDS = 14;
  const shardGeo = track(new THREE.OctahedronGeometry(0.2, 0));
  const shardMat = track(new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(2.2), toneMapped: false }));
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, SHARDS);
  shards.frustumCulled = false;
  if (!dummy) body.add(shards);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const ps = new THREE.Vector3();

  // armour plates for the Baron (gold) and the Husk (rust, fewer)
  const plates: THREE.Mesh[] = [];
  if (baron || husk) {
    const plateGeo = track(new RoundedBoxGeometry(1.5, 0.55, 0.22, 3, 0.07));
    const plateMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(husk ? 0xb05028 : 0xffc23d).multiplyScalar(1.7), toneMapped: false }));
    for (let i = 0; i < (husk ? 2 : 4); i++) {
      const p = new THREE.Mesh(plateGeo, plateMat);
      p.userData.a = (i / (husk ? 2 : 4)) * Math.PI * 2;
      plates.push(p);
      body.add(p);
    }
  }

  // lightning for the Spark, the Surge and the Imp
  const bolts: Bolt[] = [];
  if (spark || surge || imp) {
    for (let i = 0; i < (surge ? 5 : spark ? 3 : 2); i++) {
      const b = new Bolt(colour, 8);
      b.amp = surge ? 0.7 : spark ? 0.45 : 0.32;
      bolts.push(b);
      body.add(b.line);
    }
  }

  // a reflection below, for the Mirror
  let reflection: THREE.Mesh | null = null;
  if (mirror) {
    reflection = new THREE.Mesh(coreGeo, track(new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(1.4), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    reflection.scale.y = -1;
    reflection.position.y = -4.2;
    body.add(reflection);
  }

  // an aura behind it, always facing the lens
  const auraMat = track(new THREE.MeshBasicMaterial({ map: glow(), color: colour.clone().multiplyScalar(1.0), transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const aura = new THREE.Mesh(track(new THREE.PlaneGeometry(7, 7)), auraMat);
  // behind it as the lens sees it: the lens looks along -x now
  aura.position.set(-1.6, 0, 0);
  aura.rotation.y = Math.PI / 2;
  aura.renderOrder = 1;
  root.add(aura);

  // ---------------------------------------------------------------- the state
  const homeZ = laneZ(1) - 0.2;
  const baseY = 2.55;
  root.position.set(0, baseY, homeZ);
  body.scale.setScalar(size);
  let targetX = 0;
  let vx = 0;
  let hurtV = 0;
  let lungeT = 0;
  let dying = 0;
  let dead = false;
  let squash = 0;
  const tmp = new THREE.Color();

  return {
    root,
    get dead() {
      return dead;
    },
    moveTo(x) {
      targetX = x;
    },
    hurt(power) {
      hurtV = Math.max(hurtV, clamp(power, 0.35, 1));
      squash = Math.max(squash, 0.5 + power * 0.5);
    },
    lunge() {
      lungeT = 0.001;
    },
    die() {
      if (!dying) dying = 0.001;
    },
    eye() {
      return new THREE.Vector3(root.position.x, root.position.y + 0.3 * size, root.position.z + 1.4 * size);
    },
    update(dt, t, s) {
      // glide to the target file with a little overshoot, which reads as weight
      const dx = targetX - root.position.x;
      vx += dx * 60 * dt;
      vx *= Math.max(0, 1 - 9 * dt);
      root.position.x += vx * dt;

      const phase = clamp(s.phase, 1, 4);
      const glitch = clamp(0.14 + (phase - 1) * 0.16 + (1 - s.hp) * 0.1 + dying * 1.2, 0, 1.4);
      hurtV = Math.max(0, hurtV - dt * 4);
      squash = Math.max(0, squash - dt * 5);
      const warn = clamp(s.warn, 0, 1);
      // phases drift the colour toward alarm
      tmp.copy(colour).lerp(rose, (phase - 1) / 5);
      for (const m of mats) {
        m.uniforms.uTime!.value = t;
        m.uniforms.uGlitch!.value = glitch;
        m.uniforms.uHurt!.value = hurtV;
        m.uniforms.uWarn!.value = warn * 0.55;
        (m.uniforms.uColor!.value as THREE.Color).copy(tmp);
      }
      ringMat.color.copy(tmp).multiplyScalar(1.8);
      shardMat.color.copy(tmp).multiplyScalar(2.2);
      auraMat.color.copy(tmp).multiplyScalar(0.9 + warn * 1.0);
      auraMat.opacity = 0.2 + warn * 0.35 + hurtV * 0.2;

      // The Training Sim has almost nothing else to say, so it has to read as alive on its own:
      // it hovers higher and sweeps like a radar looking for something to hit.
      const bob = Math.sin(t * 1.6) * (dummy ? 0.45 : 0.22);
      let lungeZ = 0;
      if (lungeT > 0) {
        lungeT += dt;
        lungeZ = Math.sin(clamp(lungeT / 0.32, 0, 1) * Math.PI) * 1.5;
        if (lungeT > 0.34) lungeT = 0;
      }
      root.position.y = baseY + bob - dying * 1.6;
      root.position.z = homeZ + lungeZ - warn * 0.6;
      // The wind-up has to be impossible to miss: the boss grows a fifth and the eyes flare
      // before the strike, so the 400 ms reading window is reading, not guessing.
      const charge = 1 + warn * 0.22 + Math.sin(t * 22) * warn * 0.05;
      const sq = 1 - squash * 0.1;
      body.scale.set(size * charge * (1 + squash * 0.06), size * charge * sq, size * charge * (1 + squash * 0.06));
      if (dying) {
        dying += dt;
        body.scale.multiplyScalar(Math.max(0, 1 - dying * 0.9));
        body.rotation.z = Math.sin(dying * 40) * 0.12;
        if (dying > 1.15) {
          dead = true;
          root.visible = false;
        }
      }

      // the body turns to face whoever it is warning, and breathes
      body.rotation.y = 0.55 + Math.sin(t * 0.5) * 0.18;
      for (const c of cores) if (!dummy && !front) c.rotation.y = t * 0.35;
      if (dummy) body.rotation.y = Math.sin(t * 0.7) * 0.9;
      for (const g of ghosts) {
        const k = g.userData.k as number;
        const j = 0.06 + glitch * 0.22;
        g.position.set(k * j * (0.6 + Math.sin(t * 13 + k) * 0.5), (Math.random() - 0.5) * glitch * 0.05, 0);
        (g.material as THREE.MeshBasicMaterial).opacity = 0.14 + glitch * 0.3;
      }
      const flare = warn > 0.01 ? 1 + warn * 1.2 : 1;
      eyeMat.color.setRGB(3 * flare, 3 - warn * 2.2, 3 - warn * 2.4);
      for (const ey of eyes) ey.scale.set(1, (Math.sin(t * 0.7 + ey.position.x) > 0.96 ? 0.15 : 1) * flare, 1);

      const speed = 0.6 + phase * 0.35 + warn * 2.4;
      ringA.rotation.z = t * speed;
      ringB.rotation.z = -t * speed * 0.7;
      ringA.visible = ringB.visible = !dummy;

      const shown = 6 + phase * 2;
      shards.count = Math.min(SHARDS, shown);
      for (let i = 0; i < shards.count; i++) {
        const a = t * (0.5 + phase * 0.12) + (i / SHARDS) * Math.PI * 2;
        const r = 2.55 + Math.sin(t * 1.3 + i) * 0.2;
        ps.set(Math.cos(a) * r, Math.sin(t * 0.9 + i * 1.7) * 1.2, Math.sin(a) * r);
        e.set(t + i, t * 0.7 + i, 0);
        q.setFromEuler(e);
        sc.setScalar(1 + Math.sin(t * 3 + i) * 0.3);
        shards.setMatrixAt(i, m4.compose(ps, q, sc));
      }
      shards.instanceMatrix.needsUpdate = true;

      plates.forEach((p) => {
        const a = (p.userData.a as number) + t * 0.45;
        p.position.set(Math.cos(a) * 2.1, Math.sin(t + (p.userData.a as number)) * 0.4, Math.sin(a) * 2.1);
        p.rotation.y = -a + Math.PI / 2;
      });

      bolts.forEach((b, i) => {
        const a = t * (1.2 + i * 0.3) + i * 1.7;
        const a2 = a + Math.PI * (0.6 + i * 0.1);
        b.from.set(Math.cos(a) * 2.1, Math.sin(a * 1.3) * 1.3, Math.sin(a) * 2.1);
        b.to.set(Math.cos(a2) * 2.1, Math.sin(a2 * 1.3) * 1.3, Math.sin(a2) * 2.1);
        if (surge) b.to.multiplyScalar(0.25);
        b.redraw();
      });

      if (reflection) reflection.rotation.y = t * 0.35;
      aura.quaternion.identity();
      aura.lookAt(aura.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2, 14)));
    },
    dispose() {
      for (const b of bolts) b.dispose();
      for (const m of mats) m.dispose();
      for (const d of disposables) d.dispose();
      eyeMat.dispose();
    },
  };
}
