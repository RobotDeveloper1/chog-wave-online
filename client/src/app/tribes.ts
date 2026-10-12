import * as THREE from 'three';

/**
 * One model, six tribes.
 *
 * The Chog GLB carries three repaintable materials — mane, jersey and cap — and a tribe is
 * just a choice of those three colours. That is what lets a street of named people read as
 * six families instead of a clone army, without a second model.
 */

export const TRIBE_COLOUR: Record<string, string> = {
  burn: '#ff7a45',
  frost: '#7fd8ff',
  volt: '#ffe066',
  wave: '#43e2a8',
  prism: '#cbb2f2',
  void: '#a874ff',
};

// mane, jersey, cap — the material names the live model actually carries. The loader
// prepends its own `#`, so tints are bare hex; a second `#` made every tribe white.
const bare = (c: string): string => c.replace('#', '');
const tribeTint = (mane: string, suit: string, cap: string): Record<string, string> => ({
  'M_Pink.001': bare(mane),
  M_Pink: bare(mane),
  'M_Jersey_#EAB308': bare(suit),
  M_Cap_MCGA: bare(cap),
  M_MCGA_Purple: bare(cap),
});

export const TRIBE_TINT: Record<string, Record<string, string>> = {
  burn: tribeTint('#ff8a5c', '#e04a2f', '#7a2140'),
  frost: tribeTint('#a8e6ff', '#2f6fa8', '#1d3a6b'),
  volt: tribeTint('#ffe680', '#c9a227', '#4a3b12'),
  wave: tribeTint('#8fe8cf', '#2f8f7a', '#14504a'),
  prism: tribeTint('#f0e6ff', '#b06bff', '#4a2a8c'),
  void: tribeTint('#6b5f8a', '#1a1428', '#3b1a52'),
};

/** A nameplate: dark plate, tribe-coloured border and text, drawn once into a sprite. */
export function nameplate(text: string, colour: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,6,20,.86)';
  g.beginPath();
  g.roundRect(4, 4, c.width - 8, c.height - 8, 18);
  g.fill();
  g.strokeStyle = colour;
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = colour;
  g.font = 'bold 44px ui-monospace, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 18), c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(4.4, 0.83, 1);
  s.renderOrder = 20;
  return s;
}

export type MarkKind = 'offer' | 'turnin' | 'progress';

const MARK: Record<MarkKind, { glyph: string; colour: string }> = {
  offer: { glyph: '!', colour: '#f5c343' },
  turnin: { glyph: '?', colour: '#43e2a8' },
  progress: { glyph: '…', colour: '#a093c2' },
};

const markCache = new Map<MarkKind, THREE.CanvasTexture>();

/** The ! or ? that floats over a quest-giver. */
export function questMark(kind: MarkKind): THREE.Sprite {
  let tex = markCache.get(kind);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const m = MARK[kind];
    g.fillStyle = m.colour;
    g.strokeStyle = '#1a1030';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(64, 64, 50, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#1a1030';
    g.font = 'bold 84px ui-monospace, Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(m.glyph, 64, 70);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    markCache.set(kind, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(1.5, 1.5, 1);
  s.renderOrder = 21;
  return s;
}
