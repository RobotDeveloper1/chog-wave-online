import * as THREE from 'three';
import { mulberry32 } from '@chog/shared';
import type { DistrictArt } from '../art.ts';

/**
 * Every surface of the city, painted at runtime.
 *
 * Nothing is fetched: a facade is a canvas, drawn once per district from that district's
 * own palette, so the concept art's colours survive into the texture instead of being
 * approximated by a box with a colour. Walls are *atlases* of cells — one window, one
 * shopfront, one door each — which the builder samples per bay, so a ten-storey tower is a
 * grid of different windows rather than one window repeated. The lit windows live in a
 * second canvas (the emissive map), which is what bloom and the night flicker work on.
 *
 * A cell is 128px for 3.2 world units across: ~40 px per unit, which is about what the
 * isometric camera resolves at its default zoom.
 */

export const CELL = 128;
export const WALL_COLS = 4;
export const WALL_ROWS = 4;
export const GND_COLS = 4;
export const GND_ROWS = 2;

export type FacadeStyle = 'brick' | 'steel' | 'concrete';

export interface Atlas {
  map: THREE.CanvasTexture;
  emi: THREE.CanvasTexture;
}

export interface Textures {
  wall: Atlas[];
  gnd: Atlas[];
  roof: Record<'slate' | 'tar' | 'metal' | 'green', THREE.CanvasTexture>;
  ground: Record<'asphalt' | 'walk' | 'plaza' | 'grass' | 'dirt' | 'gravel' | 'cobble' | 'floor', THREE.CanvasTexture>;
  ao: THREE.CanvasTexture;
  pool: THREE.CanvasTexture;
}

const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};

const _a = new THREE.Color();
const _b = new THREE.Color();

/** Lighten (+) or darken (−) a colour by `amt` in lightness, with a touch of hue drift. */
function shade(hex: string, amt: number, hue = 0): string {
  _a.set(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  _a.getHSL(hsl);
  _a.setHSL((hsl.h + hue + 1) % 1, hsl.s, Math.min(1, Math.max(0, hsl.l + amt)));
  return `#${_a.getHexString()}`;
}

function mix(a: string, b: string, t: number): string {
  _a.set(a);
  _b.set(b);
  return `#${_a.lerp(_b, t).getHexString()}`;
}

function finish(c: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  else t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** Speckle: thousands of tiny translucent rects, the cheapest convincing grain there is. */
function speckle(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, n: number, r: () => number, light = 0.07, dark = 0.1): void {
  for (let i = 0; i < n; i++) {
    const v = r();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(r() * light).toFixed(3)})` : `rgba(0,0,0,${(r() * dark).toFixed(3)})`;
    g.fillRect(x + r() * w, y + r() * h, 1 + r() * 2.4, 1 + r() * 2.4);
  }
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

interface Pal {
  wall: string;
  wall2: string;
  trim: string;
  stone: string;
  frame: string;
  accent: string;
  cloth: string;
  metal: string;
  dark: string;
  lit: string;
  litB: string;
  neon: string;
  leaf: string;
}

function palette(a: DistrictArt, variant: number): Pal {
  const wall = a.wall[[0, 1, 3][variant % 3]!]!;
  return {
    wall,
    wall2: a.wall[(variant + 2) % a.wall.length]!,
    trim: a.trim,
    stone: a.stone,
    frame: shade(a.trim, -0.1),
    accent: a.accent,
    cloth: a.cloth,
    metal: a.metal,
    dark: a.dark,
    lit: a.window,
    litB: shade(a.window, -0.14, 0.02),
    neon: a.neon,
    leaf: a.leaf,
  };
}

interface Cell {
  g: CanvasRenderingContext2D;
  e: CanvasRenderingContext2D;
  x: number;
  y: number;
  r: () => number;
  p: Pal;
}

/** Brick courses with per-brick tone, mortar and a little soot toward the bottom. */
function brick(c: Cell, base: string, mortar: string): void {
  const { g, x, y, r } = c;
  g.fillStyle = mortar;
  g.fillRect(x, y, CELL, CELL);
  const bh = 8;
  const bw = 21;
  for (let row = 0; row * bh < CELL; row++) {
    const off = (row % 2) * (bw / 2);
    for (let col = -1; col * bw < CELL + bw; col++) {
      const t = (r() - 0.5) * 0.09;
      g.fillStyle = shade(base, t, (r() - 0.5) * 0.012);
      g.fillRect(x + col * bw + off + 0.8, y + row * bh + 0.8, bw - 1.6, bh - 1.6);
    }
  }
  speckle(g, x, y, CELL, CELL, 260, r, 0.05, 0.12);
  const soot = g.createLinearGradient(0, y, 0, y + CELL);
  soot.addColorStop(0, 'rgba(0,0,0,0)');
  soot.addColorStop(0.7, 'rgba(0,0,0,0)');
  soot.addColorStop(1, 'rgba(10,6,12,0.28)');
  g.fillStyle = soot;
  g.fillRect(x, y, CELL, CELL);
}

/** Stucco: a flat painted wall with a mottled coat and a hairline or two of cracks. */
function stucco(c: Cell, base: string): void {
  const { g, x, y, r } = c;
  g.fillStyle = base;
  g.fillRect(x, y, CELL, CELL);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${(0.02 + r() * 0.045).toFixed(3)})`;
    g.beginPath();
    g.ellipse(x + r() * CELL, y + r() * CELL, 8 + r() * 26, 6 + r() * 20, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  speckle(g, x, y, CELL, CELL, 380, r, 0.05, 0.08);
  if (r() > 0.6) {
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    let cx = x + r() * CELL;
    let cy = y;
    g.moveTo(cx, cy);
    for (let i = 0; i < 6; i++) {
      cx += (r() - 0.5) * 12;
      cy += 12 + r() * 10;
      g.lineTo(cx, cy);
    }
    g.stroke();
  }
}

type WinKind = 'sash' | 'arched' | 'shuttered' | 'boxed' | 'ac' | 'blinds' | 'narrow';

/**
 * A window, drawn into the albedo and (when lit) the emissive canvas. The unlit glass
 * carries the dusk — a cool reflection graded to violet — so an unlit window still reads
 * as glass, and the lit one reads as a room with a light on.
 */
function window(c: Cell, kind: WinKind, lit: boolean, opts: { w?: number; h?: number; cy?: number } = {}): void {
  const { g, e, x, y, r, p } = c;
  const w = opts.w ?? (kind === 'narrow' ? 34 : 52);
  const h = opts.h ?? (kind === 'narrow' ? 76 : 66);
  const cx = x + CELL / 2;
  const cy = y + (opts.cy ?? CELL / 2 + 2);
  const gx = cx - w / 2;
  const gy = cy - h / 2;

  // Reveal: a dark recess round the frame, which is what gives a flat wall depth.
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fillRect(gx - 7, gy - 7, w + 14, h + 14);

  // Lintel and sill in stone.
  g.fillStyle = p.stone;
  if (kind === 'arched') {
    g.beginPath();
    g.arc(cx, gy + 2, w / 2 + 6, Math.PI, 0);
    g.lineTo(cx + w / 2 + 6, gy + h + 4);
    g.lineTo(cx - w / 2 - 6, gy + h + 4);
    g.closePath();
    g.fill();
  } else {
    g.fillRect(gx - 6, gy - 9, w + 12, 7);
  }
  g.fillStyle = shade(p.stone, -0.08);
  g.fillRect(gx - 8, gy + h + 3, w + 16, 6);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(gx - 8, gy + h + 8, w + 16, 2);

  // Frame.
  g.fillStyle = p.frame;
  if (kind === 'arched') {
    g.beginPath();
    g.arc(cx, gy + 2, w / 2 + 3, Math.PI, 0);
    g.lineTo(cx + w / 2 + 3, gy + h + 3);
    g.lineTo(cx - w / 2 - 3, gy + h + 3);
    g.closePath();
    g.fill();
  } else {
    g.fillRect(gx - 3, gy - 3, w + 6, h + 6);
  }

  // Glass.
  const glass = g.createLinearGradient(gx, gy, gx + w * 0.3, gy + h);
  if (lit) {
    glass.addColorStop(0, shade(p.litB, -0.34));
    glass.addColorStop(1, shade(p.litB, -0.46));
  } else {
    glass.addColorStop(0, mix('#6a7ca4', p.dark, 0.25));
    glass.addColorStop(0.55, mix('#3b3a63', p.dark, 0.35));
    glass.addColorStop(1, mix('#241f3d', p.dark, 0.2));
  }
  g.fillStyle = glass;
  if (kind === 'arched') {
    g.beginPath();
    g.arc(cx, gy + 2, w / 2, Math.PI, 0);
    g.lineTo(cx + w / 2, gy + h);
    g.lineTo(cx - w / 2, gy + h);
    g.closePath();
    g.fill();
  } else {
    g.fillRect(gx, gy, w, h);
  }
  // A diagonal sheen across the glass.
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.beginPath();
  g.moveTo(gx + w * 0.55, gy);
  g.lineTo(gx + w * 0.85, gy);
  g.lineTo(gx + w * 0.25, gy + h);
  g.lineTo(gx - w * 0.05, gy + h);
  g.closePath();
  g.fill();

  if (lit) {
    // The room: warm light, a curtain edge and the dark shape of something in it.
    const eg = e.createLinearGradient(gx, gy, gx, gy + h);
    eg.addColorStop(0, p.lit);
    eg.addColorStop(1, p.litB);
    e.fillStyle = eg;
    if (kind === 'arched') {
      e.beginPath();
      e.arc(cx, gy + 2, w / 2, Math.PI, 0);
      e.lineTo(cx + w / 2, gy + h);
      e.lineTo(cx - w / 2, gy + h);
      e.closePath();
      e.fill();
    } else {
      e.fillRect(gx, gy, w, h);
    }
    e.fillStyle = 'rgba(0,0,0,0.45)';
    const side = r() > 0.5 ? gx : gx + w - w * 0.28;
    e.fillRect(side, gy, w * 0.28, h * (0.55 + r() * 0.4));
    if (r() > 0.45) {
      e.fillStyle = 'rgba(0,0,0,0.5)';
      e.beginPath();
      e.ellipse(cx + (r() - 0.5) * w * 0.3, gy + h - 8, 7, 12, 0, 0, Math.PI * 2);
      e.fill();
    }
    // Mullion shadows break the glow into panes.
    e.fillStyle = 'rgba(0,0,0,0.85)';
    e.fillRect(cx - 1.5, gy, 3, h);
    e.fillRect(gx, gy + h * 0.46, w, 3);
  }

  // Mullions in the albedo.
  g.fillStyle = p.frame;
  g.fillRect(cx - 1.5, gy, 3, h);
  g.fillRect(gx, gy + h * 0.46, w, 3);

  if (kind === 'shuttered') {
    const sc = r() > 0.5 ? p.accent : p.cloth;
    for (const dir of [-1, 1]) {
      const sx = dir < 0 ? gx - 20 : gx + w + 2;
      g.fillStyle = shade(sc, -0.05);
      g.fillRect(sx, gy - 2, 18, h + 4);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      for (let k = 0; k < 9; k++) g.fillRect(sx + 2, gy + 2 + k * (h / 9), 14, 1.4);
    }
  }
  if (kind === 'boxed') {
    g.fillStyle = shade(p.metal, 0.02);
    g.fillRect(gx - 4, gy + h + 5, w + 8, 12);
    for (let k = 0; k < 9; k++) {
      g.fillStyle = shade(p.leaf, (r() - 0.5) * 0.12);
      g.beginPath();
      g.arc(gx + 2 + k * ((w - 2) / 8), gy + h + 4, 4 + r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    if (r() > 0.4) {
      g.fillStyle = p.accent;
      for (let k = 0; k < 4; k++) g.fillRect(gx + 6 + r() * (w - 12), gy + h - 2 + r() * 4, 3, 3);
    }
  }
  if (kind === 'ac') {
    g.fillStyle = shade(p.stone, 0.06);
    g.fillRect(gx + w + 4, gy + h * 0.55, 30, 20);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let k = 0; k < 5; k++) g.fillRect(gx + w + 8, gy + h * 0.55 + 4 + k * 3, 22, 1.4);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(gx + w + 4, gy + h * 0.55 + 20, 30, 3);
  }
  if (kind === 'blinds') {
    g.fillStyle = lit ? 'rgba(0,0,0,0.0)' : 'rgba(255,255,255,0.22)';
    for (let k = 0; k < 11; k++) g.fillRect(gx, gy + k * (h / 11), w, 2.2);
    if (lit) {
      e.fillStyle = 'rgba(0,0,0,0.55)';
      for (let k = 0; k < 11; k++) e.fillRect(gx, gy + 3 + k * (h / 11), w, 2.2);
    }
  }
}

/** A wall cell: masonry plus zero or one window. Used to fill an atlas. */
function wallCell(c: Cell, style: FacadeStyle, i: number): void {
  const { p, r } = c;
  const lit = r() < 0.34;
  if (style === 'brick') {
    if (i % 4 === 3) stucco(c, shade(p.wall2, 0.02));
    else brick(c, shade(p.wall, (r() - 0.5) * 0.04), shade(p.wall, 0.16));
    const kinds: WinKind[] = ['sash', 'arched', 'shuttered', 'boxed', 'ac', 'blinds', 'sash', 'narrow'];
    window(c, kinds[Math.floor(r() * kinds.length)]!, lit);
    return;
  }
  if (style === 'concrete') {
    concrete(c);
    const kinds: WinKind[] = ['sash', 'blinds', 'ac', 'boxed', 'sash'];
    window(c, kinds[Math.floor(r() * kinds.length)]!, lit, { w: 58, h: 62 });
    if (r() > 0.45) ivy(c);
    return;
  }
  steel(c, lit);
}

function concrete(c: Cell): void {
  const { g, x, y, r, p } = c;
  g.fillStyle = shade(p.wall, (r() - 0.5) * 0.05);
  g.fillRect(x, y, CELL, CELL);
  speckle(g, x, y, CELL, CELL, 520, r, 0.05, 0.1);
  // Panel joints and tie-holes, the signature of poured concrete.
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(x, y + CELL - 3, CELL, 3);
  g.fillRect(x + CELL - 2, y, 2, CELL);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (const [tx, ty] of [[12, 12], [CELL - 14, 12], [12, CELL - 14], [CELL - 14, CELL - 14]] as const) {
    g.beginPath();
    g.arc(x + tx, y + ty, 2.2, 0, Math.PI * 2);
    g.fill();
  }
  // Rain streaks and a stain from the sill above.
  for (let i = 0; i < 5; i++) {
    const sx = x + 8 + r() * (CELL - 16);
    const sg = g.createLinearGradient(0, y, 0, y + CELL);
    sg.addColorStop(0, `rgba(30,40,30,${(0.04 + r() * 0.08).toFixed(3)})`);
    sg.addColorStop(1, 'rgba(30,40,30,0)');
    g.fillStyle = sg;
    g.fillRect(sx, y, 2 + r() * 5, CELL);
  }
}

function ivy(c: Cell): void {
  const { g, x, y, r, p } = c;
  const side = r() > 0.5;
  for (let i = 0; i < 46; i++) {
    const t = r();
    const px = x + (side ? t * 34 : CELL - t * 34) + (r() - 0.5) * 14;
    const py = y + CELL * (0.35 + r() * 0.65);
    g.fillStyle = shade(p.leaf, (r() - 0.5) * 0.14, (r() - 0.5) * 0.02);
    g.beginPath();
    g.ellipse(px, py, 3 + r() * 5, 2 + r() * 3.5, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
}

/** Voltgrid: dark glazed panels, slab lines, and floors that are lit in cyan, white or magenta. */
function steel(c: Cell, lit: boolean): void {
  const { g, e, x, y, r, p } = c;
  g.fillStyle = shade(p.wall, (r() - 0.5) * 0.03);
  g.fillRect(x, y, CELL, CELL);
  // The glazing: a grid of panes inside a mullion frame.
  const inset = 6;
  const gw = CELL - inset * 2;
  const gh = CELL - 22;
  const gy = y + 14;
  const sky = g.createLinearGradient(0, gy, 0, gy + gh);
  sky.addColorStop(0, mix('#2a3a58', p.dark, 0.2));
  sky.addColorStop(1, mix('#101a2a', p.dark, 0.2));
  g.fillStyle = sky;
  g.fillRect(x + inset, gy, gw, gh);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.beginPath();
  g.moveTo(x + inset + gw * 0.5, gy);
  g.lineTo(x + inset + gw * 0.8, gy);
  g.lineTo(x + inset + gw * 0.3, gy + gh);
  g.lineTo(x + inset, gy + gh);
  g.closePath();
  g.fill();
  const cols = 4;
  g.fillStyle = shade(p.metal, 0.04);
  for (let k = 0; k <= cols; k++) g.fillRect(x + inset + (k * gw) / cols - 1.5, gy, 3, gh);
  g.fillRect(x + inset, gy + gh * 0.5 - 1.5, gw, 3);
  // The spandrel band between floors, with a seam of trim on the bottom edge.
  g.fillStyle = shade(p.wall, 0.07);
  g.fillRect(x, y + CELL - 8, CELL, 8);
  g.fillStyle = shade(p.trim, -0.1);
  g.fillRect(x, y + CELL - 3, CELL, 2);
  speckle(g, x, y, CELL, CELL, 140, r, 0.03, 0.06);

  const mode = r();
  const hue = mode < 0.5 ? p.lit : mode < 0.78 ? p.neon : mode < 0.9 ? '#ff4fd8' : '#ffffff';
  if (lit) {
    for (let k = 0; k < cols; k++) {
      if (r() < 0.16) continue;
      const px = x + inset + (k * gw) / cols + 3;
      const pw = gw / cols - 6;
      for (const half of [0, 1]) {
        if (r() < 0.2) continue;
        const py = gy + 3 + half * (gh / 2);
        e.fillStyle = shade(hue, (r() - 0.5) * 0.18);
        e.fillRect(px, py, pw, gh / 2 - 6);
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(px, py, pw, gh / 2 - 6);
      }
    }
  }
}

/** A shopfront for the ground floor: a big window under a sign band, awning optional. */
function shopCell(c: Cell, style: FacadeStyle, i: number): void {
  const { g, e, x, y, r, p } = c;
  if (style === 'brick') brick(c, shade(p.wall, -0.03), shade(p.wall, 0.15));
  else if (style === 'concrete') concrete(c);
  else {
    g.fillStyle = shade(p.wall, 0.02);
    g.fillRect(x, y, CELL, CELL);
  }
  // Stone plinth.
  g.fillStyle = shade(p.stone, -0.12);
  g.fillRect(x, y + CELL - 12, CELL, 12);

  const gx = x + 9;
  const gw = CELL - 18;
  const gy = y + 36;
  const gh = CELL - 36 - 14;
  // Sign band.
  const bandCol = [p.accent, p.cloth, shade(p.accent, -0.2), p.metal][i % 4]!;
  g.fillStyle = shade(bandCol, -0.12);
  g.fillRect(x + 4, y + 8, CELL - 8, 24);
  g.fillStyle = bandCol;
  g.fillRect(x + 6, y + 10, CELL - 12, 20);
  g.fillStyle = 'rgba(255,255,255,0.28)';
  for (let k = 0; k < 4; k++) g.fillRect(x + 14 + k * 26, y + 16, 16, 3);
  e.fillStyle = style === 'steel' ? p.neon : p.lit;
  e.globalAlpha = style === 'steel' ? 0.9 : 0.5;
  e.fillRect(x + 6, y + 10, CELL - 12, 20);
  e.globalAlpha = 1;

  // Display window and its lit interior.
  g.fillStyle = p.frame;
  g.fillRect(gx - 4, gy - 4, gw + 8, gh + 8);
  g.fillStyle = mix('#1a1426', p.dark, 0.5);
  g.fillRect(gx, gy, gw, gh);
  const eg = e.createLinearGradient(gx, gy, gx, gy + gh);
  eg.addColorStop(0, style === 'steel' ? '#bff6ff' : p.lit);
  eg.addColorStop(1, style === 'steel' ? p.neon : p.litB);
  e.fillStyle = eg;
  e.fillRect(gx + 2, gy + 2, gw - 4, gh - 4);
  // Goods on shelves: dark silhouettes against the glow.
  e.fillStyle = 'rgba(0,0,0,0.55)';
  for (let k = 0; k < 6; k++) {
    const sw = 8 + r() * 14;
    e.fillRect(gx + 6 + r() * (gw - sw - 12), gy + gh - 20 - r() * 16, sw, 20 + r() * 12);
  }
  e.fillRect(gx + 2, gy + gh * 0.5, gw - 4, 2.5);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.moveTo(gx + gw * 0.5, gy);
  g.lineTo(gx + gw * 0.85, gy);
  g.lineTo(gx + gw * 0.35, gy + gh);
  g.lineTo(gx, gy + gh);
  g.closePath();
  g.fill();
}

function doorCell(c: Cell, style: FacadeStyle): void {
  const { g, e, x, y, r, p } = c;
  if (style === 'brick') brick(c, shade(p.wall, -0.03), shade(p.wall, 0.15));
  else if (style === 'concrete') concrete(c);
  else {
    g.fillStyle = shade(p.wall, 0.02);
    g.fillRect(x, y, CELL, CELL);
  }
  const dw = 52;
  const dh = 92;
  const dx = x + (CELL - dw) / 2;
  const dy = y + CELL - dh - 6;
  g.fillStyle = shade(p.stone, 0.02);
  g.fillRect(dx - 8, dy - 10, dw + 16, dh + 12);
  g.fillStyle = shade(p.frame, -0.1);
  g.fillRect(dx - 3, dy - 3, dw + 6, dh + 3);
  const door = style === 'steel' ? '#0c1620' : [p.accent, p.cloth, shade(p.wall, -0.25)][Math.floor(r() * 3)]!;
  g.fillStyle = door;
  g.fillRect(dx, dy, dw, dh);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(dx + 6, dy + 8, dw - 12, dh * 0.4);
  g.fillRect(dx + 6, dy + dh * 0.55, dw - 12, dh * 0.36);
  // Transom light over the door, lit.
  g.fillStyle = '#242038';
  g.fillRect(dx + 6, dy + 8, dw - 12, 18);
  e.fillStyle = style === 'steel' ? p.neon : p.lit;
  e.fillRect(dx + 6, dy + 8, dw - 12, 18);
  e.fillStyle = 'rgba(0,0,0,0.8)';
  e.fillRect(dx + dw / 2 - 1.5, dy + 8, 3, 18);
  g.fillStyle = shade(p.metal, 0.3);
  g.beginPath();
  g.arc(dx + dw - 9, dy + dh * 0.58, 3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shade(p.stone, -0.1);
  g.fillRect(dx - 12, y + CELL - 6, dw + 24, 6);
}

function archCell(c: Cell, style: FacadeStyle): void {
  const { g, e, x, y, r, p } = c;
  concrete(c);
  const aw = 84;
  const ah = 100;
  const ax = x + (CELL - aw) / 2;
  const ay = y + CELL - ah;
  g.fillStyle = shade(p.stone, 0.04);
  g.beginPath();
  g.arc(x + CELL / 2, ay + aw / 2, aw / 2 + 6, Math.PI, 0);
  g.lineTo(ax + aw + 6, y + CELL);
  g.lineTo(ax - 6, y + CELL);
  g.closePath();
  g.fill();
  const inner = g.createLinearGradient(0, ay, 0, y + CELL);
  inner.addColorStop(0, '#0d1512');
  inner.addColorStop(1, '#233029');
  g.fillStyle = inner;
  g.beginPath();
  g.arc(x + CELL / 2, ay + aw / 2, aw / 2, Math.PI, 0);
  g.lineTo(ax + aw, y + CELL);
  g.lineTo(ax, y + CELL);
  g.closePath();
  g.fill();
  // A lit shop deep in the arcade, and a hanging plant.
  e.fillStyle = r() > 0.4 ? p.lit : p.litB;
  e.fillRect(ax + 12, ay + 40, aw - 24, 44);
  e.fillStyle = 'rgba(0,0,0,0.6)';
  e.fillRect(ax + 12, ay + 40 + 20, aw - 24, 2);
  for (let k = 0; k < 7; k++) {
    g.fillStyle = shade(p.leaf, (r() - 0.5) * 0.12);
    g.beginPath();
    g.arc(ax + 6 + r() * (aw - 12), ay + 6 + r() * 28, 4 + r() * 5, 0, Math.PI * 2);
    g.fill();
  }
  void style;
}

function groundWindowCell(c: Cell, style: FacadeStyle, bars: boolean): void {
  const { g, x, y, p, r } = c;
  if (style === 'brick') brick(c, shade(p.wall, -0.04), shade(p.wall, 0.15));
  else if (style === 'concrete') concrete(c);
  else {
    g.fillStyle = shade(p.wall, 0.02);
    g.fillRect(x, y, CELL, CELL);
  }
  g.fillStyle = shade(p.stone, -0.12);
  g.fillRect(x, y + CELL - 12, CELL, 12);
  if (style === 'steel') {
    steel(c, r() < 0.5);
    return;
  }
  window(c, bars ? 'sash' : 'blinds', r() < 0.4, { cy: CELL / 2 - 4 });
  if (bars) {
    g.fillStyle = shade(p.metal, 0.05);
    for (let k = 0; k < 6; k++) g.fillRect(x + CELL / 2 - 26 + k * 10.4, y + CELL / 2 - 40, 2.2, 66);
  }
}

// ---------------------------------------------------------------------------
// Atlas builders
// ---------------------------------------------------------------------------

export function buildAtlas(kind: 'wall' | 'gnd', style: FacadeStyle, a: DistrictArt, variant: number): Atlas {
  const cols = kind === 'wall' ? WALL_COLS : GND_COLS;
  const rows = kind === 'wall' ? WALL_ROWS : GND_ROWS;
  const [c, g] = canvas(cols * CELL, rows * CELL);
  const [ce, e] = canvas(cols * CELL, rows * CELL);
  e.fillStyle = '#000';
  e.fillRect(0, 0, ce.width, ce.height);
  const r = mulberry32(variant * 977 + (kind === 'wall' ? 11 : 73) + style.length * 31);
  const p = palette(a, variant);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell: Cell = { g, e, x: col * CELL, y: row * CELL, r, p };
      const i = row * cols + col;
      if (kind === 'wall') wallCell(cell, style, i);
      else if (row === 0) {
        // Shopfronts, with the door-bearing one in the first column.
        if (style === 'concrete' && col === 3) archCell(cell, style);
        else if (col === 0) doorCell(cell, style);
        else shopCell(cell, style, i);
      } else if (col === 0) doorCell(cell, style);
      else if (style === 'concrete' && col === 3) archCell(cell, style);
      else groundWindowCell(cell, style, col === 2);
    }
  }
  return { map: finish(c, { srgb: true }), emi: finish(ce, { srgb: true }) };
}

// ---------------------------------------------------------------------------
// Roofs and the ground: tileable, painted once
// ---------------------------------------------------------------------------

function slate(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(5);
  // Roofs are half of what an isometric camera sees, and a near-black roof in shadow is a
  // hole in the picture: lifted to a mid slate so it keeps its colour in the shade. Lifted
  // toward the district's own stone, not toward a fixed violet — but only a little: pulled
  // too far to grey, a slope facing away from the sun (lit by the violet ambient alone)
  // loses its hue entirely and reads as bare cardboard.
  const base = shade(mix(a.roof[0]!, mix(a.stone, '#808080', 0.5), 0.22), 0.05);
  g.fillStyle = shade(base, -0.05);
  g.fillRect(0, 0, 256, 256);
  const rh = 16;
  const rw = 21;
  for (let row = 0; row * rh < 256 + rh; row++) {
    const off = (row % 2) * (rw / 2);
    for (let col = -1; col * rw < 256 + rw; col++) {
      // Wider per-tile tone spread than a flat sheet: a real tiled roof is thousands of
      // slightly different tiles, and the spread is what gives the slope its relief.
      const mossy = r() < 0.05;
      const tone = (r() - 0.5) * 0.13;
      g.fillStyle = mossy ? shade(mix(base, a.leaf, 0.35), tone) : shade(base, tone, (r() - 0.5) * 0.02);
      g.beginPath();
      g.roundRect(col * rw + off + 0.8, row * rh - 8 + 0.8, rw - 1.6, rh * 1.4, 3);
      g.fill();
      // Shadow under each course's lip, and a light catch on its top edge: the two together
      // are what make the rows read as overlapping tiles instead of printed stripes.
      g.fillStyle = 'rgba(0,0,0,0.26)';
      g.fillRect(col * rw + off + 0.8, row * rh + rh - 9, rw - 1.6, 2.5);
      g.fillStyle = 'rgba(255,255,255,0.09)';
      g.fillRect(col * rw + off + 1.6, row * rh - 7, rw - 3.2, 1.6);
    }
  }
  speckle(g, 0, 0, 256, 256, 900, r, 0.06, 0.12);
  return finish(c, { repeat: true });
}

/**
 * Bitumen and gravel: the flat-roof surface an isometric camera spends half its time on.
 *
 * The old version was a violet-grey sheet with a dozen large soft ellipses, and from above
 * those ellipses read as mould — the whole roof looked damp and dirty. A real built-up roof
 * is *gravel*: thousands of tiny stones in two tones over a dark bitumen flood coat, with a
 * few darker rectangles where a leak was patched and a lighter walkway pad to the hatch.
 * So the wear here is fine grain, and the large shapes are deliberate rectangles, not blobs.
 */
function tar(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(7);
  // Flood coat: a warm mid bitumen. Pulled hard toward a brown-grey so no violet survives —
  // violet on a horizontal surface reads as shadow-mould at this camera height — and kept a
  // step light, because a dark flood coat mips down to a black void and the gravel is lost.
  g.fillStyle = mix(a.roof[1]!, '#6b635a', 0.8);
  g.fillRect(0, 0, 256, 256);
  // Very faint cloud, an order of subtler than before: enough to stop it being a flat sheet.
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${(0.012 + r() * 0.02).toFixed(3)})`;
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 20 + r() * 40, 14 + r() * 30, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // Gravel: two-tone cards, dense. This is the texture's whole character from above.
  for (let i = 0; i < 5200; i++) {
    const v = r();
    g.fillStyle = v > 0.62 ? `rgba(224,216,200,${(0.18 + r() * 0.3).toFixed(3)})` : v > 0.3 ? `rgba(128,120,110,${(0.16 + r() * 0.26).toFixed(3)})` : `rgba(24,20,17,${(0.16 + r() * 0.26).toFixed(3)})`;
    const s = 1.2 + r() * 2.2;
    g.fillRect(r() * 256, r() * 256, s, s * (0.7 + r() * 0.6));
  }
  // Patched leaks: darker bitumen rectangles with a trowelled edge, the roof's history.
  for (let i = 0; i < 3; i++) {
    const px = r() * 200;
    const py = r() * 200;
    const pw = 26 + r() * 46;
    const ph = 20 + r() * 36;
    g.fillStyle = 'rgba(28,24,20,0.5)';
    g.fillRect(px - 2, py - 2, pw + 4, ph + 4);
    g.fillStyle = 'rgba(58,52,46,0.75)';
    g.fillRect(px, py, pw, ph);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(px, py, pw, 2);
  }
  // A pale walkway pad from one edge toward the middle: where people actually step.
  g.fillStyle = 'rgba(190,182,168,0.16)';
  g.fillRect(0, 118, 150, 22);
  speckle(g, 0, 0, 256, 256, 500, r, 0.05, 0.08);
  // Seams between membrane sheets, plus the lap shadow beside each.
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, 126, 256, 2);
  g.fillRect(127, 0, 2, 256);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.fillRect(0, 128, 256, 1);
  g.fillRect(129, 0, 1, 256);
  return finish(c, { repeat: true });
}

function metalRoof(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(9);
  const base = mix(a.metal, a.stone, 0.35);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    const grad = g.createLinearGradient(x, 0, x + 16, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.3)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 16, 256);
  }
  speckle(g, 0, 0, 256, 256, 500, r, 0.06, 0.1);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(120,70,40,${(0.04 + r() * 0.08).toFixed(3)})`;
    g.fillRect(r() * 256, r() * 256, 6 + r() * 30, 3 + r() * 10);
  }
  return finish(c, { repeat: true });
}

function greenRoof(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(13);
  g.fillStyle = shade(a.leaf, -0.12);
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = shade(a.leaf, (r() - 0.5) * 0.2, (r() - 0.5) * 0.03);
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 2 + r() * 5, 1.5 + r() * 3.5, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = r() > 0.5 ? '#e8e4a0' : '#ffd0e0';
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  return finish(c, { repeat: true });
}

function asphalt(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  const r = mulberry32(21);
  // Dry roads are lifted a step so they read as asphalt and not as a hole in the map;
  // wet ones stay dark because their light comes from the neon painted on them below.
  g.fillStyle = a.wet ? a.asphalt : mix(shade(a.asphalt, 0.13), '#4f4e4b', 0.4);
  g.fillRect(0, 0, 512, 512);
  // Large soft blotches read as cloud or fog from a camera this high, and a road is the
  // biggest surface in the picture — so the wear is mostly fine grain, with the blotches
  // kept very faint.
  for (let i = 0; i < 16; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${(0.008 + r() * 0.016).toFixed(3)})`;
    g.beginPath();
    g.ellipse(r() * 512, r() * 512, 30 + r() * 90, 20 + r() * 60, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  speckle(g, 0, 0, 512, 512, 7000, r, 0.07, 0.13);
  // Patched tarmac and hairline cracks.
  for (let i = 0; i < 6; i++) {
    g.fillStyle = 'rgba(0,0,0,0.06)';
    g.fillRect(r() * 480, r() * 480, 20 + r() * 50, 12 + r() * 30);
  }
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    let x = r() * 512;
    let y = r() * 512;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 40;
      y += (r() - 0.5) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  if (a.wet) {
    // Wet roads mirror the neon: long vertical smears of each light, and standing puddles.
    const hues = [a.neon, '#ff4fd8', a.window, '#7ffcff'];
    for (let i = 0; i < 34; i++) {
      const x = r() * 512;
      const w = 5 + r() * 16;
      const grad = g.createLinearGradient(0, 0, 0, 512);
      const hue = hues[Math.floor(r() * hues.length)]!;
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.4, `${hue}3a`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x, 0, w, 512);
    }
    for (let i = 0; i < 9; i++) {
      g.fillStyle = 'rgba(120,190,255,0.16)';
      g.beginPath();
      g.ellipse(r() * 512, r() * 512, 22 + r() * 44, 8 + r() * 16, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  return finish(c, { repeat: true });
}

/** Pavement: slabs with joints, wear and the odd stain. */
function walk(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(31);
  g.fillStyle = a.pavement;
  g.fillRect(0, 0, 256, 256);
  const n = 4;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = shade(a.pavement, (r() - 0.5) * 0.05);
      g.fillRect(i * (256 / n) + 1.5, j * (256 / n) + 1.5, 256 / n - 3, 256 / n - 3);
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let i = 0; i <= n; i++) {
    g.fillRect((i * 256) / n - 1.5, 0, 3, 256);
    g.fillRect(0, (i * 256) / n - 1.5, 256, 3);
  }
  speckle(g, 0, 0, 256, 256, 900, r, 0.06, 0.1);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(40,30,20,0.08)';
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 10 + r() * 24, 7 + r() * 14, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  if (a.wet) {
    g.fillStyle = 'rgba(90,150,200,0.1)';
    g.fillRect(0, 0, 256, 256);
  }
  return finish(c, { repeat: true });
}

/** Cobbles: rounded stones in a staggered pattern, for squares. */
function cobble(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(41);
  g.fillStyle = shade(a.pavement, -0.12);
  g.fillRect(0, 0, 256, 256);
  const sw = 21;
  const sh = 16;
  for (let row = 0; row * sh < 256 + sh; row++) {
    const off = (row % 2) * (sw / 2);
    for (let col = -1; col * sw < 256 + sw; col++) {
      g.fillStyle = shade(a.pavement, (r() - 0.5) * 0.1, (r() - 0.5) * 0.015);
      g.beginPath();
      g.roundRect(col * sw + off + 1.5, row * sh + 1.5, sw - 3, sh - 3, 5);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(col * sw + off + 4, row * sh + 3, sw - 9, 2);
    }
  }
  speckle(g, 0, 0, 256, 256, 600, r, 0.04, 0.1);
  return finish(c, { repeat: true });
}

function floorTiles(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(51);
  g.fillStyle = shade(a.stone, -0.04);
  g.fillRect(0, 0, 256, 256);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = (i + j) % 2 ? shade(a.stone, 0.05) : shade(a.stone, -0.06);
      g.fillRect(i * 64, j * 64, 64, 64);
    }
  }
  g.strokeStyle = 'rgba(0,0,0,0.32)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64, 256);
    g.moveTo(0, i * 64);
    g.lineTo(256, i * 64);
    g.stroke();
  }
  speckle(g, 0, 0, 256, 256, 700, r, 0.05, 0.08);
  return finish(c, { repeat: true });
}

function grass(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(61);
  g.fillStyle = shade(a.leaf, -0.1);
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,255,200' : '0,40,0'},${(0.03 + r() * 0.06).toFixed(3)})`;
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 12 + r() * 40, 8 + r() * 26, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 2600; i++) {
    g.strokeStyle = shade(a.leaf, (r() - 0.45) * 0.22, (r() - 0.5) * 0.03);
    g.lineWidth = 1;
    const x = r() * 256;
    const y = r() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 5);
    g.stroke();
  }
  for (let i = 0; i < 24; i++) {
    g.fillStyle = r() > 0.5 ? '#f3efb0' : '#ffc4d8';
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  return finish(c, { repeat: true });
}

function dirt(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(71);
  g.fillStyle = mix(a.dark, '#5a4632', 0.5);
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '200,170,130' : '10,6,2'},${(0.04 + r() * 0.07).toFixed(3)})`;
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 10 + r() * 36, 7 + r() * 22, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  speckle(g, 0, 0, 256, 256, 1500, r, 0.1, 0.16);
  for (let i = 0; i < 80; i++) {
    g.fillStyle = shade('#6a6258', (r() - 0.5) * 0.2);
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 2.4, 0, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c, { repeat: true });
}

function gravel(a: DistrictArt): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(81);
  g.fillStyle = mix(a.dark, '#6c6660', 0.45);
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = shade('#7a7468', (r() - 0.5) * 0.3);
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 1 + r() * 2.6, 1 + r() * 2, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // Sleepers: the regular dark bars that say "railway" from a long way off.
  g.fillStyle = 'rgba(40,24,12,0.7)';
  for (let x = 6; x < 256; x += 32) g.fillRect(x, 0, 10, 256);
  return finish(c, { repeat: true });
}

/** A soft rounded-rectangle shadow, stretched under a footprint: the contact shadow. */
function aoTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 20, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return finish(c, { srgb: false, aniso: 1 });
}

function poolTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return finish(c, { srgb: false, aniso: 1 });
}

/** The facade style a district is built in. */
export function styleFor(sector: string): FacadeStyle {
  return sector === 'voltgrid' ? 'steel' : sector === 'hollow' ? 'concrete' : 'brick';
}

export function makeTextures(a: DistrictArt, sector: string): Textures {
  const style = styleFor(sector);
  return {
    wall: [0, 1, 2].map((v) => buildAtlas('wall', style, a, v)),
    gnd: [0, 1, 2].map((v) => buildAtlas('gnd', style, a, v)),
    roof: { slate: slate(a), tar: tar(a), metal: metalRoof(a), green: greenRoof(a) },
    ground: {
      asphalt: asphalt(a),
      walk: walk(a),
      plaza: cobble(a),
      grass: grass(a),
      dirt: dirt(a),
      gravel: gravel(a),
      cobble: cobble(a),
      floor: floorTiles(a),
    },
    ao: aoTexture(),
    pool: poolTexture(),
  };
}

export function disposeTextures(t: Textures): void {
  const all: THREE.Texture[] = [
    ...t.wall.flatMap((a) => [a.map, a.emi]),
    ...t.gnd.flatMap((a) => [a.map, a.emi]),
    ...Object.values(t.roof),
    ...Object.values(t.ground),
    t.ao,
    t.pool,
  ];
  for (const x of all) x.dispose();
}
