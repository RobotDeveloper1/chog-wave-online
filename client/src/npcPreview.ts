import * as THREE from 'three';
import { loadChogNFT, type PartsModel } from './app/chogLoader.ts';

// Temporary NPC lineup: every city NPC with its exact deterministic traits.
// ?page=0&per=8 — deleted after the NPC audit.
const MODEL: PartsModel = {
  baseUrl: '/models/chog-base.glb',
  partsUrl: '/models/trait-parts.json',
  colorsUrl: '/models/trait-colors.json',
  skinsUrl: '/models/skins.json',
};

const IDS = ['a-dealer','a-nurse','a-operator','a-scribe','a-archivist','a-watchman','a-baker','a-noodle','a-clock','a-elder','a-gardener','a-fisher','a-engineer','a-scrapper','a-hertz','a-courier','v-dealer','v-nurse','v-operator','v-scribe','v-archivist','v-watchman','v-noodle','v-hacker','v-spire','v-vendor','v-driver','v-roof','v-hertz','h-dealer','h-nurse','h-operator','h-scribe','h-archivist','h-watchman','h-tea','h-gardener','h-ferryman','h-foreman','h-vendor','h-wanderer','h-hertz'];

const hashOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const q = new URLSearchParams(location.search);
const page = Number(q.get('page') ?? 0);
const per = Number(q.get('per') ?? 8);
const batch = IDS.slice(page * per, page * per + per);

const index = (await fetch(MODEL.partsUrl).then((r) => r.json())) as { parts: Record<string, Record<string, string>> };
const skins = (await fetch(MODEL.skinsUrl).then((r) => r.json())) as Record<string, unknown>;

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141021);
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
interface Cell { root: THREE.Group; tag: HTMLDivElement }
const cells: Cell[] = [];
await Promise.all(
  batch.map(async (id, i) => {
    let seed = hashOf(id) || 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pick = (obj: Record<string, unknown>) => {
      const keys = Object.keys(obj);
      return keys[Math.floor(rnd() * keys.length)]!;
    };
    const traits = {
      Skin: pick(skins),
      Body: pick(index.parts.Body ?? {}),
      Head: pick(index.parts.Head ?? {}),
      Eyes: pick(index.parts.Eyes ?? {}),
      Mouth: pick(index.parts.Mouth ?? {}),
    };
    const chog = await loadChogNFT({ ...MODEL, traits, tokenId: 1 + (hashOf(id) % 1900) });
    const cx = batch.length === 1 ? 0 : (i % COLS - (COLS - 1) / 2) * DX;
    const cz = (Math.floor(i / COLS) - 1) * DZ;
    chog.root.position.x += cx;
    chog.root.position.z += cz;
    scene.add(chog.root);
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `${id}<small>${traits.Head} / ${traits.Body}</small>`;
    document.body.appendChild(tag);
    cells.push({ root: chog.root, tag });
  }),
);

const rows = Math.max(1, Math.ceil(batch.length / COLS));
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
{
  const r = (2 + rows * DZ * 0.85) / 1;
  camera.position.set(0, 4.6, r);
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
(window as unknown as { __ready?: boolean }).__ready = true;
