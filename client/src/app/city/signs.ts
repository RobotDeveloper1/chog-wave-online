import * as THREE from 'three';
import type { DistrictArt } from '../art.ts';
import { makeSignMaterial } from './materials.ts';

/**
 * Every door's name, painted once into an atlas.
 *
 * A sign is a quad on a facade that samples one cell of this atlas, so a district's whole
 * signage is a single material and a single texture, and a label is lit by the same
 * emissive pass as the windows beside it.
 */

const CW = 256;
const CH = 64;
const COLS = 4;

export interface SignAtlas {
  material: THREE.Material;
  uv: Map<string, [number, number, number, number]>;
  dispose(): void;
}

export function makeSignAtlas(labels: string[], art: DistrictArt): SignAtlas {
  const unique = [...new Set(labels)];
  const rows = Math.max(1, Math.ceil(unique.length / COLS));
  // Round the height up to a power of two so mipmaps behave.
  let h = 64;
  while (h < rows * CH) h *= 2;
  const w = COLS * CW;

  const a = document.createElement('canvas');
  a.width = w;
  a.height = h;
  const g = a.getContext('2d')!;
  const e = document.createElement('canvas');
  e.width = w;
  e.height = h;
  const ge = e.getContext('2d')!;
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, w, h);

  const uv = new Map<string, [number, number, number, number]>();
  unique.forEach((label, i) => {
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    const x = c * CW;
    const y = r * CH;
    // Panel: a dark plate with a lit border.
    g.fillStyle = '#0c0816';
    g.fillRect(x, y, CW, CH);
    g.fillStyle = art.metal;
    g.fillRect(x + 3, y + 3, CW - 6, CH - 6);
    g.fillStyle = '#120c1e';
    g.fillRect(x + 7, y + 7, CW - 14, CH - 14);
    // Fit the text.
    let size = 34;
    g.font = `bold ${size}px ui-monospace, Consolas, monospace`;
    while (g.measureText(label).width > CW - 36 && size > 12) {
      size -= 2;
      g.font = `bold ${size}px ui-monospace, Consolas, monospace`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = art.neon;
    g.fillText(label, x + CW / 2, y + CH / 2 + 2);
    ge.font = g.font;
    ge.textAlign = 'center';
    ge.textBaseline = 'middle';
    ge.fillStyle = art.neon;
    ge.fillText(label, x + CW / 2, y + CH / 2 + 2);
    ge.strokeStyle = art.accent;
    ge.lineWidth = 3;
    ge.strokeRect(x + 8, y + 8, CW - 16, CH - 16);
    uv.set(label, [x / w + 0.002, 1 - (y + CH) / h + 0.002, (x + CW) / w - 0.002, 1 - y / h - 0.002]);
  });

  const map = new THREE.CanvasTexture(a);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const emi = new THREE.CanvasTexture(e);
  emi.colorSpace = THREE.SRGBColorSpace;
  emi.anisotropy = 8;
  return {
    material: makeSignMaterial(map, emi),
    uv,
    dispose() {
      map.dispose();
      emi.dispose();
    },
  };
}
