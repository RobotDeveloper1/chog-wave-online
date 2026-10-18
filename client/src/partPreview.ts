import * as THREE from 'three';
import { hullMaterial, loadChogNFT, type PartsModel } from './app/chogLoader.ts';

// Temporary trait-part lineup: base chog wearing one trait value per cell.
// ?cat=Head|Body|Eyes|Mouth&page=0&per=12 — deleted after the audit.
const MODEL: PartsModel = {
  baseUrl: '/models/chog-base.glb',
  partsUrl: '/models/trait-parts.json',
  colorsUrl: '/models/trait-colors.json',
  skinsUrl: '/models/skins.json',
};

const q = new URLSearchParams(location.search);
const cat = q.get('cat') ?? 'Head';
const page = Number(q.get('page') ?? 0);
const per = Number(q.get('per') ?? 8);

const index = (await fetch(MODEL.partsUrl).then((r) => r.json())) as {
  parts: Record<string, Record<string, string>>;
};
const values = Object.keys(index.parts[cat] ?? {});
const batch = values.slice(page * per, page * per + per);

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(q.get('bg') ? `#${q.get('bg')}` : 0x141021);
scene.add(new THREE.AmbientLight(0xffffff, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(4, 8, 6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x8f7fff, 0.7);
rim.position.set(-5, 4, -6);
scene.add(rim);

const COLS = 4;
const DX = 4.2;
const DZ = 6.5;
interface Cell { root: THREE.Group; tag: HTMLDivElement; label: string }
const cells: Cell[] = [];
await Promise.all(
  batch.map(async (value, i) => {
    const chog = await loadChogNFT({ ...MODEL, traits: { [cat]: value } as Record<string, string> });
    const cx = batch.length === 1 ? 0 : (i % COLS - (COLS - 1) / 2) * DX;
    const cz = (Math.floor(i / COLS) - 1) * DZ;
    chog.root.position.x += cx;
    chog.root.position.z += cz;
    if (q.get('nohull')) chog.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material === hullMaterial) mesh.visible = false;
    });
    const hide = (q.get('hide') ?? '').split(',').filter(Boolean);
    if (hide.length) chog.root.traverse((o) => {
      if (hide.some((h) => o.name.includes(h))) o.visible = false;
    });
    if (q.get('flat')) chog.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material !== hullMaterial) {
        mesh.material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      }
    });
    if (q.get('wire')) chog.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
      }
    });
    scene.add(chog.root);
    const tag = document.createElement('div');
    tag.className = 'tag';
    const file = index.parts[cat]![value] ?? '?';
    tag.innerHTML = `${value}<small>${file}</small>`;
    document.body.appendChild(tag);
    cells.push({ root: chog.root, tag, label: value });
  }),
);

const rows = Math.max(1, Math.ceil(batch.length / COLS));
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
const zoom = Number(q.get('zoom') ?? 1);
const yaw = Number(q.get('yaw') ?? 0);
{
  const r = (2 + rows * DZ * 0.85) / zoom;
  camera.position.set(Math.sin(yaw) * r, 4.6 / zoom, Math.cos(yaw) * r);
}
camera.lookAt(0, 1.1, 0);

const v = new THREE.Vector3();
function frame(): void {
  for (const c of cells) {
    v.set(c.root.position.x, 0.15, c.root.position.z).project(camera);
    c.tag.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    c.tag.style.top = `${((-v.y + 1) / 2) * innerHeight}px`;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
if (q.get('ray')) {
  const rc = new THREE.Raycaster();
  const hits: string[] = [];
  for (const [nx, ny] of [[0.21, 0.25], [0.21, 0.1], [0.21, -0.05], [0.21, -0.2]]) {
    rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hit = rc.intersectObjects(scene.children, true)[0];
    hits.push(hit ? `${(hit.object as THREE.Mesh).name}@${hit.point.toArray().map((v) => v.toFixed(2)).join(',')}` : 'miss');
  }
  document.title = 'RAY:' + hits.join(' | ');
}
(window as unknown as { __ready?: boolean }).__ready = true;
(window as unknown as { __count?: number }).__count = cells.length;
