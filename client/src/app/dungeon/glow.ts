import * as THREE from 'three';

/**
 * A soft radial blob, used for flames, haloes, light pools and the glow around a body's head.
 *
 * One canvas, made once, shared by every sprite in a dungeon. A hundred additive sprites drawing
 * the same 128x128 gradient is one texture upload and a hundred quads, which is why the field can
 * afford to put a light on every chamber and a glow on every mob.
 */
let GLOW_TEX: THREE.Texture | null = null;

export function glowTexture(): THREE.Texture {
  if (GLOW_TEX) return GLOW_TEX;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.32, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  GLOW_TEX = new THREE.CanvasTexture(c);
  return GLOW_TEX;
}
