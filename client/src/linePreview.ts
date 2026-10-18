import * as THREE from 'three';

import { buildLineField } from './app/line/field.ts';
import { moodOf } from './app/line/theme.ts';
import type { RegionId } from '@chog/shared';

// Temporary Line map lineup: one region per load, framed like the game camera.
// ?region=tolls|ashpine|marsh|relay|causeway|static&at=spawn|site0..6|aerial&yaw=0&d=26&h=9
// — deleted after the map pass.
const q = new URLSearchParams(location.search);
const region = (q.get('region') ?? 'tolls') as RegionId;
const at = q.get('at') ?? 'spawn';
const yaw = Number(q.get('yaw') ?? 0);
const dist = Number(q.get('d') ?? 26);
const h = Number(q.get('h') ?? 9);

const field = buildLineField(region);
field.setMobs([]);

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const mood = moodOf(region);
scene.background = new THREE.Color(mood.skyTop);
scene.fog = new THREE.Fog(new THREE.Color(mood.fog).getHex(), 26, 150 + (1 - mood.haze) * 320);
const hemi = new THREE.HemisphereLight(mood.hemi, mood.bounce, mood.hemiI);
scene.add(hemi);
const key = new THREE.DirectionalLight(mood.key, mood.keyI);
key.position.set(40, 80, 25);
scene.add(key);
const fill = new THREE.DirectionalLight(mood.fill, mood.fillI);
fill.position.set(-30, 20, -40);
scene.add(fill);
scene.add(field.group);

const target = new THREE.Vector3();
if (at === 'aerial') {
  target.set(field.spawn.x, 0, field.spawn.z + 60);
} else if (at.startsWith('site')) {
  const s = field.sites[Number(at.slice(4))];
  if (s) target.set(s.x, 0, s.z);
  else target.set(field.spawn.x, 0, field.spawn.z);
} else {
  target.set(field.spawn.x, 0, field.spawn.z);
}

const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 1, 900);
const aerial = at === 'aerial';
const dd = aerial ? 120 : dist;
const hh = aerial ? 90 : h;
camera.position.set(target.x + Math.sin(yaw) * dd, target.y + hh, target.z + Math.cos(yaw) * dd);
camera.lookAt(target.x, target.y + (aerial ? 0 : 1.5), target.z);

const focus = new THREE.Vector3(target.x, 1.1, target.z);
const t0 = performance.now();
function frame(): void {
  field.update((performance.now() - t0) / 1000, focus);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { __ready?: boolean }).__ready = true;
