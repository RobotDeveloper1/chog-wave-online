/**
 * Scratch harness: renders the same `faceUrl()` the dialogue uses, for a handful of tokens, and
 * puts each result on screen. Not part of the game — this exists so the portrait can be eyeballed
 * in a real browser instead of guessed at. Open /face-test.html with the dev server up.
 */
import * as THREE from 'three';
import { loadChogNFT, type PartsModel } from './chogLoader.ts';
import { faceUrl } from './portrait.ts';

const MODEL: PartsModel = {
  baseUrl: '/models/chog-base.glb',
  partsUrl: '/models/trait-parts.json',
  colorsUrl: '/models/trait-colors.json',
  skinsUrl: '/models/skins.json',
};

const TOKENS = [1, 42, 111, 900];
const FACE_PART = /eye|nose|mouth|blush|glint/i;

function countFaceParts(root: THREE.Group): number {
  root.updateMatrixWorld(true);
  let n = 0;
  root.traverse((o) => { if (FACE_PART.test(o.name)) n++; });
  return n;
}

(async () => {
  const wrap = document.getElementById('wrap')!;
  const lines: string[] = [];
  const add = (img: HTMLImageElement, label: string) => {
    const cell = document.createElement('figure');
    cell.style.margin = '0';
    cell.appendChild(img);
    const cap = document.createElement('figcaption');
    cap.textContent = label;
    cap.style.font = '11px ui-monospace, monospace';
    cap.style.color = '#b9aee0';
    cap.style.textAlign = 'center';
    cell.appendChild(cap);
    wrap.appendChild(cell);
  };

  // 1) A few different tokens.
  for (const tokenId of [42]) {
    const chog = await loadChogNFT({ ...MODEL, tokenId });
    chog.root.scale.setScalar(1);
    const parts = countFaceParts(chog.root);
    const url = faceUrl(chog.root);
    const img = document.createElement('img');
    if (url) img.src = url;
    add(img, `#${tokenId} parts=${parts}`);
    lines.push(`token ${tokenId}: parts=${parts} ${url ? 'ok' : 'NULL'}`);
  }

  // 2) The same Chog at four street yaws — the case that came out in profile or from behind.
  for (const [i, yaw] of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].entries()) {
    const chog = await loadChogNFT({ ...MODEL, tokenId: 42 });
    chog.root.scale.setScalar(1);
    chog.root.rotation.y = yaw;
    const url = faceUrl(chog.root);
    const img = document.createElement('img');
    if (url) img.src = url;
    add(img, `yaw ${i} (${Math.round((yaw * 180) / Math.PI)}°)`);
  }

  document.getElementById('log')!.textContent = lines.join('\n');
  document.title = 'READY';
})();
