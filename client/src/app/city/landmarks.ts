import * as THREE from 'three';
import { mulberry32, type Anchor, type LandmarkLot } from '@chog/shared';
import type { DistrictArt } from '../art.ts';
import type { BuildEnv } from './buildings.ts';
import { KERB } from './ground.ts';

/**
 * The landmarks: the things you navigate by.
 *
 * Every district has one thing visible from anywhere in it, and it is the same thing in
 * all three — the Wave Station, a tower whose beam is the Wave Index made physical. A
 * player who has never read a number can look up and see how bad it is: a calm column of
 * light, or a red pulse. The rest are each district's own: the stopped clock, the relay
 * spire, the great dome.
 */

export interface Dynamic {
  object: THREE.Object3D;
  update(t: number, dt: number, state: DynamicState): void;
}

export interface DynamicState {
  /** 0..120, from the server. */
  wave: number;
  tier: 'normal' | 'glitch' | 'anomaly' | 'storm';
}

const TIER_COLOUR: Record<DynamicState['tier'], number> = {
  normal: 0x7ffcff,
  glitch: 0x8ad2a0,
  anomaly: 0xf0c060,
  storm: 0xff4a6e,
};

const box = (env: BuildEnv, cx: number, cy: number, cz: number, w: number, h: number, d: number, color: string | number, glow = 0): void =>
  env.B.box('solid', cx, cy, cz, w, h, d, color, glow);

const cyl = (env: BuildEnv, x: number, y: number, z: number, rt: number, rb: number, h: number, color: string | number, glow = 0, seg = 14): void =>
  env.B.geo('solid', new THREE.CylinderGeometry(rt, rb, h, seg), new THREE.Matrix4().makeTranslation(x, y, z), color, glow);

function waveStation(env: BuildEnv, lm: LandmarkLot, dyn: Dynamic[]): void {
  const { art, B } = env;
  const { x, z, w, d } = lm;
  const baseH = 4.4;
  // Podium with a glowing arch on the south face: this is the door the whole game turns on.
  box(env, x, baseH / 2, z, w, baseH, d, art.stone);
  box(env, x, baseH + 0.2, z, w + 0.8, 0.4, d + 0.8, art.trim);
  const doorW = 5.2;
  B.box('solid', x, 2.2, z + d / 2 + 0.05, doorW, 4.2, 0.2, art.neon, 1.6);
  B.box('solid', x, 2.0, z + d / 2 + 0.15, doorW - 1.0, 3.6, 0.2, '#07131d');
  for (let i = 0; i < 4; i++) B.box('solid', x, 0.18 + i * 0.16, z + d / 2 + 0.9 + (3 - i) * 0.4, doorW + 2, 0.18, 0.8, art.stone);
  for (const dx of [-3.4, 3.4]) box(env, x + dx, 2.5, z + d / 2 + 0.4, 0.5, 5, 0.5, art.trim);
  // Tapered tower in three stages, each wrapped in a lit band. Kept deliberately close in
  // scale to the tallest ordinary block — a landmark should be the thing you navigate by,
  // not a needle that shrinks the whole district to scenery.
  const stages: [number, number, number][] = [
    [w * 0.72, d * 0.72, 10],
    [w * 0.54, d * 0.54, 8],
    [w * 0.36, d * 0.36, 7],
  ];
  let y = baseH + 0.4;
  stages.forEach(([sw, sd, sh], i) => {
    box(env, x, y + sh / 2, z, sw, sh, sd, i % 2 ? art.wall[2]! : art.wall[0]!);
    // Window strips: tall emissive slits on every face, spaced so the tower reads as inhabited.
    for (let k = 0; k < 5; k++) {
      const t = (k + 0.5) / 5 - 0.5;
      B.box('solid', x + t * sw * 0.8, y + sh / 2, z + sd / 2 + 0.05, 0.4, sh * 0.7, 0.1, art.window, 0.38);
      B.box('solid', x + t * sw * 0.8, y + sh / 2, z - sd / 2 - 0.05, 0.4, sh * 0.7, 0.1, art.window, 0.38);
      B.box('solid', x + sw / 2 + 0.05, y + sh / 2, z + t * sd * 0.8, 0.1, sh * 0.7, 0.4, art.window, 0.38);
      B.box('solid', x - sw / 2 - 0.05, y + sh / 2, z + t * sd * 0.8, 0.1, sh * 0.7, 0.4, art.window, 0.38);
    }
    B.box('solid', x, y + sh, z, sw + 0.7, 0.3, sd + 0.7, art.neon, 0.8);
    y += sh;
  });
  // Spire and its beacon.
  cyl(env, x, y + 4, z, 0.12, 0.35, 7, art.metal);
  B.geo('solid', new THREE.SphereGeometry(0.5, 10, 8), new THREE.Matrix4().makeTranslation(x, y + 7.6, z), '#ffffff', 1.6);
  // Signboard on the podium.
  void d;

  // The ring: two gyroscope hoops round the top stage, turning against each other.
  const hoopMat = new THREE.MeshBasicMaterial({ color: art.neon, toneMapped: false });
  const g = new THREE.Group();
  g.position.set(x, y - 3, z);
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.2, 8, 48), hoopMat);
  const r2 = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.16, 8, 48), hoopMat);
  r1.rotation.x = Math.PI / 2;
  g.add(r1, r2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    n.position.set(Math.cos(a) * 4.4, 0, Math.sin(a) * 4.4);
    r1.add(n);
  }
  dyn.push({
    object: g,
    update(t) {
      r1.rotation.z = t * 0.6;
      r2.rotation.x = Math.PI / 2.6;
      r2.rotation.z = -t * 0.45;
      r2.rotation.y = t * 0.2;
    },
  });

  // The beam: the Wave Index as a column of light. It thickens and shifts colour with the
  // tier. Shorter and softer than it was — a 120-unit column of light over a 40-unit tower
  // read as a searchlight cutting the screen in half, not a beacon on a building.
  const beamMat = new THREE.MeshBasicMaterial({ color: TIER_COLOUR.normal, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.25, 62, 16, 1, true), beamMat);
  beam.position.set(x, y + 7 + 31, z);
  const halo = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.6, 62, 16, 1, true), beamMat.clone());
  halo.position.copy(beam.position);
  (halo.material as THREE.MeshBasicMaterial).opacity = 0.055;
  const bg = new THREE.Group();
  bg.add(beam, halo);
  dyn.push({
    object: bg,
    update(t, _dt, s) {
      const col = new THREE.Color(TIER_COLOUR[s.tier]);
      beamMat.color.copy(col);
      (halo.material as THREE.MeshBasicMaterial).color.copy(col);
      const heat = Math.min(1, s.wave / 120);
      const pulse = s.tier === 'storm' ? 0.5 + 0.5 * Math.sin(t * 7) : s.tier === 'anomaly' ? 0.5 + 0.5 * Math.sin(t * 3.4) : 0.6 + 0.4 * Math.sin(t * 1.1);
      beamMat.opacity = 0.14 + heat * 0.34 * (0.6 + 0.4 * pulse);
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.04 + heat * 0.16 * pulse;
      const k = 1 + heat * 0.9;
      beam.scale.set(k, 1, k);
      halo.scale.set(k, 1, k);
    },
  });
}

function clockFace(art: DistrictArt): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8dcc0';
  g.beginPath();
  g.arc(128, 128, 120, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#2a2018';
  g.lineWidth = 8;
  g.stroke();
  g.fillStyle = '#2a2018';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.save();
    g.translate(128 + Math.sin(a) * 100, 128 - Math.cos(a) * 100);
    g.rotate(a);
    g.fillRect(-3, -9, 6, 18);
    g.restore();
  }
  // Stopped at the first Anomaly.
  g.lineCap = 'round';
  g.strokeStyle = '#2a2018';
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(128, 128);
  g.lineTo(128 + Math.sin(2.1) * 62, 128 - Math.cos(2.1) * 62);
  g.stroke();
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(128, 128);
  g.lineTo(128 + Math.sin(5.6) * 88, 128 - Math.cos(5.6) * 88);
  g.stroke();
  g.fillStyle = art.accent;
  g.beginPath();
  g.arc(128, 128, 9, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function clocktower(env: BuildEnv, lm: LandmarkLot, dyn: Dynamic[]): void {
  const { art, B } = env;
  const { x, z, w, h } = lm;
  box(env, x, 1.2, z, w + 1.4, 2.4, w + 1.4, art.stone);
  box(env, x, 2.4 + (h - 12) / 2, z, w, h - 12 + 0.01, w, art.wall[0]!);
  // Belt courses.
  for (const y of [8, 15, 22]) box(env, x, y, z, w + 0.7, 0.5, w + 0.7, art.trim);
  // The clock chamber, then the open belfry, then the steeple.
  const cy = h - 9.5;
  box(env, x, cy, z, w + 0.9, 5.2, w + 0.9, art.wall[1]!);
  const face = clockFace(art);
  const faceMat = new THREE.MeshBasicMaterial({ map: face, toneMapped: false });
  const faces = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), faceMat);
    const a = (i * Math.PI) / 2;
    m.position.set(Math.sin(a) * (w / 2 + 0.52), cy, Math.cos(a) * (w / 2 + 0.52));
    m.rotation.y = a;
    faces.add(m);
  }
  faces.position.set(x, 0, z);
  dyn.push({ object: faces, update() {} });
  // Belfry: four posts and a roof.
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) box(env, x + dx * (w / 2 - 0.4), cy + 4.4, z + dz * (w / 2 - 0.4), 0.7, 3.6, 0.7, art.trim);
  B.box('solid', x, cy + 4.4, z, w - 1.4, 2.4, w - 1.4, '#150f22');
  const roofY = cy + 6.4;
  B.geo('solid', new THREE.ConeGeometry(w * 0.78, 5.8, 4), new THREE.Matrix4().makeRotationY(Math.PI / 4).setPosition(x, roofY + 2.9, z), art.roof[0]!);
  B.geo('solid', new THREE.SphereGeometry(0.4, 8, 6), new THREE.Matrix4().makeTranslation(x, roofY + 6.2, z), art.accent, 0.7);
  box(env, x, roofY + 7, z, 0.12, 1.8, 0.12, art.metal);
  // Warm light from the belfry.
  B.box('solid', x, cy + 4.4, z + w / 2 - 0.8, 1.6, 2.2, 0.1, art.window, 1.2);
  B.box('solid', x, cy + 4.4, z - w / 2 + 0.8, 1.6, 2.2, 0.1, art.window, 1.2);
}

function fountain(env: BuildEnv, lm: LandmarkLot): void {
  const { art, B } = env;
  const { x, z, w } = lm;
  const r = w / 2;
  const y = KERB + 0.02;
  B.geo('solid', new THREE.CylinderGeometry(r, r + 0.2, 0.7, 28), new THREE.Matrix4().makeTranslation(x, y + 0.35, z), art.stone);
  B.geo('water', new THREE.CylinderGeometry(r - 0.45, r - 0.45, 0.06, 28), new THREE.Matrix4().makeTranslation(x, y + 0.62, z), 0xffffff);
  B.geo('solid', new THREE.CylinderGeometry(1.1, 1.4, 1.6, 14), new THREE.Matrix4().makeTranslation(x, y + 1.3, z), art.stone);
  B.geo('solid', new THREE.CylinderGeometry(2.1, 1.0, 0.4, 20), new THREE.Matrix4().makeTranslation(x, y + 2.2, z), art.trim);
  B.geo('solid', new THREE.CylinderGeometry(0.4, 0.5, 1.4, 10), new THREE.Matrix4().makeTranslation(x, y + 3.0, z), art.stone);
  B.geo('glass', new THREE.ConeGeometry(0.22, 1.6, 8), new THREE.Matrix4().makeTranslation(x, y + 4.1, z), '#bfe6ff', 0.3);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    B.geo('glass', new THREE.ConeGeometry(0.12, 1.2, 6), new THREE.Matrix4().makeRotationZ(0).setPosition(x + Math.cos(a) * 1.6, y + 1.2, z + Math.sin(a) * 1.6), '#bfe6ff', 0.3);
  }
}

function monument(env: BuildEnv, lm: LandmarkLot): void {
  const { art, B } = env;
  const { x, z } = lm;
  const y = KERB + 0.02;
  box(env, x, y + 0.4, z, 5, 0.8, 5, art.stone);
  box(env, x, y + 1.0, z, 3.6, 0.5, 3.6, art.trim);
  // The shaft is the district's dark brick, not a second cream: cream-on-cream-on-cream made
  // the whole monument read as one white box from above. Contrast is what gives it parts.
  B.geo('solid', new THREE.CylinderGeometry(0.9, 1.3, 5.6, 4), new THREE.Matrix4().makeRotationY(Math.PI / 4).setPosition(x, y + 4.1, z), art.wall[2]!);
  B.geo('solid', new THREE.ConeGeometry(0.9, 1.4, 4), new THREE.Matrix4().makeRotationY(Math.PI / 4).setPosition(x, y + 7.6, z), art.accent, 0.5);
  // Inscription bands in painted trim rather than lit neon: glow washed the shaft out to white.
  for (const dy of [3, 4.6, 6.2]) B.box('solid', x, y + dy, z, 2.1 - (dy - 3) * 0.28, 0.14, 2.1 - (dy - 3) * 0.28, art.trim);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    B.geo('solid', new THREE.CylinderGeometry(0.25, 0.3, 0.7, 8), new THREE.Matrix4().makeTranslation(x + dx * 2.2, y + 1.15, z + dz * 2.2), art.metal);
    B.box('solid', x + dx * 2.2, y + 1.6, z + dz * 2.2, 0.3, 0.3, 0.3, art.window, 1.3);
  }
}

function holoPillar(env: BuildEnv, lm: LandmarkLot, dyn: Dynamic[]): void {
  const { art, B } = env;
  const { x, z, h } = lm;
  const y = KERB + 0.02;
  B.geo('solid', new THREE.CylinderGeometry(2.4, 2.8, 1.2, 20), new THREE.Matrix4().makeTranslation(x, y + 0.6, z), art.stone);
  B.geo('solid', new THREE.CylinderGeometry(0.9, 1.2, h - 6, 12), new THREE.Matrix4().makeTranslation(x, y + (h - 6) / 2 + 1.2, z), art.wall[2]!);
  for (let i = 0; i < 6; i++) B.box('solid', x, y + 4 + i * ((h - 10) / 5), z, 2.4, 0.14, 2.4, art.neon, 1.4);
  const hue = new THREE.Color(art.neon);
  const mat = new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const g = new THREE.Group();
  g.position.set(x, y + h - 2, z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.1, 6, 40), mat);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.1, 6, 40), mat);
  const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), new THREE.MeshBasicMaterial({ color: 0xff4fd8, wireframe: true, toneMapped: false }));
  g.add(ring, ring2, globe);
  dyn.push({
    object: g,
    update(t) {
      ring.rotation.x = Math.PI / 2 + Math.sin(t * 0.5) * 0.3;
      ring.rotation.z = t * 0.7;
      ring2.rotation.y = t * 0.9;
      ring2.rotation.x = Math.PI / 3;
      globe.rotation.y = t * 0.8;
      globe.rotation.x = t * 0.3;
    },
  });
}

function bandstand(env: BuildEnv, lm: LandmarkLot): void {
  const { art, B } = env;
  const { x, z } = lm;
  const y = KERB + 0.02;
  B.geo('solid', new THREE.CylinderGeometry(4, 4.3, 0.9, 8), new THREE.Matrix4().makeTranslation(x, y + 0.45, z), art.stone);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    B.box('solid', x + Math.cos(a) * 3.5, y + 2.6, z + Math.sin(a) * 3.5, 0.3, 3.4, 0.3, art.trim);
  }
  B.geo('solid', new THREE.ConeGeometry(4.6, 2.2, 8), new THREE.Matrix4().makeTranslation(x, y + 5.2, z), art.roof[0]!);
  B.geo('solid', new THREE.CylinderGeometry(3.7, 3.7, 0.35, 8), new THREE.Matrix4().makeTranslation(x, y + 4.1, z), art.trim);
  B.box('solid', x, y + 6.5, z, 0.12, 0.8, 0.12, art.metal);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    B.box('solid', x + Math.cos(a) * 3.9, y + 3.9, z + Math.sin(a) * 3.9, 0.2, 0.2, 0.2, art.window, 1.3);
  }
}

function dome(env: BuildEnv, lm: LandmarkLot): void {
  const { art, B } = env;
  const { x, z, w, d } = lm;
  const r = Math.min(w, d) / 2;
  const y = KERB + 0.02;
  B.geo('solid', new THREE.CylinderGeometry(r, r + 0.4, 2.4, 28), new THREE.Matrix4().makeTranslation(x, y + 1.2, z), art.stone);
  B.geo('glass', new THREE.SphereGeometry(r - 0.2, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.Matrix4().makeTranslation(x, y + 2.4, z), '#cfeadf', 0.25);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI;
    const geo = new THREE.TorusGeometry(r - 0.2, 0.09, 4, 24, Math.PI);
    B.geo('solid', geo, new THREE.Matrix4().makeRotationY(a).setPosition(x, y + 2.4, z), art.trim);
  }
  B.geo('solid', new THREE.TorusGeometry(r - 0.2, 0.18, 6, 32), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, y + 2.4, z), art.trim);
  // The jungle inside, visible through the glass.
  const rand = mulberry32(lm.seed);
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const rr = rand() * (r - 2);
    const hh = 1.5 + rand() * 4.5;
    B.geo('foliage', new THREE.IcosahedronGeometry(1.1 + rand() * 1.2, 0), new THREE.Matrix4().makeTranslation(x + Math.cos(a) * rr, y + 2.4 + hh, z + Math.sin(a) * rr), rand() > 0.5 ? art.leaf : '#7fa04a');
    B.box('solid', x + Math.cos(a) * rr, y + 2.4 + hh / 2, z + Math.sin(a) * rr, 0.25, hh, 0.25, art.trunk);
  }
  B.box('solid', x, y + 1.3, z + r + 0.1, 3, 2.6, 0.2, art.window, 1.0);
}

function oldStation(env: BuildEnv, lm: LandmarkLot): void {
  const { art, B } = env;
  const { x, z, w, d, h } = lm;
  const y = KERB + 0.02;
  box(env, x, y + h / 2, z, w, h, d, art.wall[2]!);
  box(env, x, y + h + 0.2, z, w + 0.8, 0.4, d + 0.8, art.trim);
  B.quad('roofSlate', [x - w / 2 - 0.5, y + h + 0.4, z + d / 2 + 0.5], [x + w / 2 + 0.5, y + h + 0.4, z + d / 2 + 0.5], [x + w / 2 + 0.5, y + h + 2.2, z], [x - w / 2 - 0.5, y + h + 2.2, z], [0, 0, 6, 1]);
  B.quad('roofSlate', [x + w / 2 + 0.5, y + h + 0.4, z - d / 2 - 0.5], [x - w / 2 - 0.5, y + h + 0.4, z - d / 2 - 0.5], [x - w / 2 - 0.5, y + h + 2.2, z], [x + w / 2 + 0.5, y + h + 2.2, z], [0, 0, 6, 1]);
  // Arched windows and doors along the platform face.
  const n = Math.max(3, Math.round(w / 4.2));
  for (let i = 0; i < n; i++) {
    const t = x - w / 2 + ((i + 0.5) * w) / n;
    B.box('solid', t, y + 3.2, z + d / 2 + 0.05, 1.7, 3.6, 0.1, art.window, 0.8);
  }
  // Platform canopy on posts.
  const cw = w + 6;
  for (let i = 0; i <= 5; i++) B.box('solid', x - cw / 2 + (i * cw) / 5, y + 2.2, z + d / 2 + 3.4, 0.25, 4.4, 0.25, art.metal);
  B.box('solid', x, y + 4.5, z + d / 2 + 3.4, cw, 0.3, 3.4, art.accent);
  B.box('solid', x, y + 4.2, z + d / 2 + 3.4, cw, 0.1, 3.0, art.window, 0.9);
  // The clock over the entrance.
  B.geo('solid', new THREE.CylinderGeometry(1, 1, 0.3, 20), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, y + h - 1.4, z + d / 2 + 0.3), '#e8dcc0', 0.3);
  // A parked train on the near track: three cars.
  void B;
}

/**
 * The Fold Gate: the way down into the data area.
 *
 * It used to be a door on a warehouse in a yard behind three stacks of containers — the
 * one entrance the whole dungeon half of the game points at, and the least visible object
 * in the district, which is exactly why it could not be found. So it is now a landmark:
 * a lit portal frame standing in the open middle of its yard, tall enough to read over
 * the rooftops of its own block, with the rift inside it glowing the same orange as the
 * marker that floats over it on the map. Stand anywhere in the district and you can see
 * which way the folds are.
 */
function foldGate(env: BuildEnv, lm: LandmarkLot, dyn: Dynamic[]): void {
  const { art, B } = env;
  const { x, z, w, d, h } = lm;
  const y = KERB + 0.02;
  const pylon = Math.max(1.8, w * 0.18);
  const span = w - pylon * 2;
  const RIFT = 0xff9a3c;

  // A plinth, so the gate stands on something and the ground under it reads as a threshold.
  box(env, x, y + 0.45, z, w + 1.4, 0.9, d + 1.4, art.stone);

  // Two pylons, each lit down both of its street-facing edges.
  for (const s of [-1, 1]) {
    const px = x + s * (w / 2 - pylon / 2);
    box(env, px, y + 0.9 + h / 2, z, pylon, h, d, art.wall[2]!);
    box(env, px, y + 0.9 + h + 0.35, z, pylon + 0.9, 0.6, d + 0.9, art.trim);
    B.box('solid', px, y + 0.9 + h * 0.5, z + d / 2 + 0.06, 0.4, h * 0.74, 0.12, art.neon, 1.5);
    B.box('solid', px, y + 0.9 + h * 0.5, z - d / 2 - 0.06, 0.4, h * 0.74, 0.12, art.neon, 1.5);
  }

  // The lintel: the bar that makes it a gate rather than two towers.
  box(env, x, y + 0.9 + h + 1.5, z, w, 2.1, d * 0.92, art.wall[0]!);
  box(env, x, y + 0.9 + h + 2.6, z, w + 0.7, 0.4, d * 0.92 + 0.7, art.trim);
  // Chevrons on the lintel, pointing down into the fold.
  for (let i = 0; i < 3; i++) {
    B.box('solid', x, y + 0.9 + h + 0.7 + i * 0.55, z + d / 2 + 0.09, w * 0.46, 0.24, 0.12, RIFT, 1.7);
    B.box('solid', x, y + 0.9 + h + 0.7 + i * 0.55, z - d / 2 - 0.09, w * 0.46, 0.24, 0.12, RIFT, 1.7);
  }

  // The rift: a lit plane between the pylons, breathing the way the Index does.
  const riftMat = new THREE.MeshBasicMaterial({ color: RIFT, transparent: true, opacity: 0.46, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const rift = new THREE.Mesh(new THREE.PlaneGeometry(span, h * 0.84), riftMat);
  rift.position.set(x, y + 0.9 + h * 0.46, z);
  const glowMat = riftMat.clone();
  glowMat.opacity = 0.15;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(span + 4, h * 0.96), glowMat);
  glow.position.set(x, y + 0.9 + h * 0.5, z);
  const g = new THREE.Group();
  g.add(rift, glow);

  // Two low steps up to the threshold, on both faces so it reads as a way through.
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      box(env, x, 0.12 + i * 0.15, z + s * (d / 2 + 1.5 + (3 - i) * 0.5), span, 0.3, 1, art.stone);
    }
  }

  dyn.push({
    object: g,
    update(t) {
      riftMat.opacity = 0.32 + 0.2 * Math.sin(t * 1.9);
      glowMat.opacity = 0.09 + 0.09 * Math.sin(t * 1.9 + 1);
      rift.scale.y = 1 + 0.04 * Math.sin(t * 2.6);
    },
  });
}

function gate(env: BuildEnv, a: Anchor, dyn: Dynamic[], extentSideX: number): void {
  const { art, B } = env;
  const { x, z } = a;
  const y = 0;
  const dir = extentSideX < 0 ? -1 : 1;
  // A portal frame over the road: two pylons, a lintel and a lit plane the Chog walks through.
  for (const dz of [-6.2, 6.2]) {
    B.box('solid', x, y + 4, z + dz, 1.6, 8, 1.6, art.wall[2]!);
    B.box('solid', x, y + 8.2, z + dz, 2.1, 0.5, 2.1, art.trim);
    B.box('solid', x, y + 4, z + dz, 0.3, 7.4, 0.3, art.neon, 1.5);
  }
  B.box('solid', x, y + 8.9, z, 1.6, 1.7, 14.4, art.wall[0]!);
  B.box('solid', x, y + 8.9, z, 1.7, 0.22, 14.5, art.neon, 1.6);
  const uv = env.sign(a.label);
  if (uv) {
    for (const s of [-1, 1]) {
      B.quad('signs', [x + s * 0.9, y + 8.3, z + 6], [x + s * 0.9, y + 8.3, z - 6], [x + s * 0.9, y + 9.5, z - 6], [x + s * 0.9, y + 9.5, z + 6], s > 0 ? uv : uv, 0xffffff, 0, 0);
    }
  }
  const mat = new THREE.MeshBasicMaterial({ color: art.neon, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 7.4), mat);
  plane.rotation.y = Math.PI / 2;
  plane.position.set(x, 3.8, z);
  // Arrows on the road pointing the way out.
  const chev = new THREE.Group();
  chev.position.set(x, 0.06, z);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.5), new THREE.MeshBasicMaterial({ color: art.neon, transparent: true, opacity: 0.8, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(dir * (2 + i * 1.6), 0, (i % 2 ? 1 : -1) * 0);
    chev.add(m);
  }
  const g = new THREE.Group();
  g.add(plane, chev);
  dyn.push({
    object: g,
    update(t) {
      mat.opacity = 0.16 + 0.1 * Math.sin(t * 2.2);
      plane.scale.y = 1 + 0.03 * Math.sin(t * 3);
      chev.children.forEach((c, i) => {
        ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.55 * Math.max(0, Math.sin(t * 3 - i * 0.8));
      });
    },
  });
}

export function buildLandmarks(env: BuildEnv, landmarks: LandmarkLot[], anchors: Anchor[], extentX: number): Dynamic[] {
  const dyn: Dynamic[] = [];
  for (const lm of landmarks) {
    switch (lm.kind) {
      case 'waveStation':
        waveStation(env, lm, dyn);
        break;
      case 'clocktower':
        clocktower(env, lm, dyn);
        break;
      case 'fountain':
        fountain(env, lm);
        break;
      case 'monument':
        monument(env, lm);
        break;
      case 'holoPillar':
        holoPillar(env, lm, dyn);
        break;
      case 'bandstand':
        bandstand(env, lm);
        break;
      case 'dome':
        dome(env, lm);
        break;
      case 'oldStation':
        oldStation(env, lm);
        break;
      case 'foldGate':
        foldGate(env, lm, dyn);
        break;
      default:
        break;
    }
  }
  for (const a of anchors) if (a.kind === 'gate') gate(env, a, dyn, a.x < 0 ? -extentX : extentX);
  return dyn;
}
