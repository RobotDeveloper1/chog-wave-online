import * as THREE from 'three';
import { buildBoss } from './app/duel/boss.ts';

// Temporary mob lineup: every Line archetype wearing its canonical element.
// Deleted after the screenshot; not part of the game.
const MOBS: { arch: string; element: string; sub: string }[] = [
  { arch: 'spark', element: 'volt', sub: 'all six regions' },
  { arch: 'imp', element: 'burn', sub: 'tolls' },
  { arch: 'glitch', element: 'prism', sub: 'ashpine · relay' },
  { arch: 'wisp', element: 'frost', sub: 'marsh' },
  { arch: 'husk', element: 'void', sub: 'causeway · static' },
  { arch: 'baron', element: 'prism', sub: 'warden 1 · 2 · 6' },
  { arch: 'front', element: 'wave', sub: 'warden 3' },
  { arch: 'surge', element: 'burn', sub: 'warden 4' },
  { arch: 'mirror', element: 'void', sub: 'warden 5' },
];

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0616);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 3.2, 26);
camera.lookAt(0, 2.2, 0);

const avatars = MOBS.map((m, i) => {
  const a = buildBoss(m.arch, m.element, 'node');
  a.moveTo((i - (MOBS.length - 1) / 2) * 6);
  scene.add(a.root);
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.innerHTML = `${m.arch.toUpperCase()}<small>${m.element} · ${m.sub}</small>`;
  document.body.appendChild(tag);
  return { a, tag };
});

const v = new THREE.Vector3();
let t = 0;
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  for (const { a, tag } of avatars) {
    a.update(dt, t, { phase: 1, warn: 0, hp: 1 });
    v.set(a.root.position.x, 0.4, a.root.position.z).project(camera);
    tag.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    tag.style.top = `${((-v.y + 1) / 2) * innerHeight}px`;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Signal the screenshot driver once a few frames are in.
setTimeout(() => {
  (window as unknown as { __ready?: boolean }).__ready = true;
}, 2500);
