import type Phaser from 'phaser';
import { MANE_SPIKES, type Personality } from '@chog/shared';

export interface ChogLook {
  mane: string;
  /** Real suit colour when the exported palette covers this token. */
  suit?: string;
  face: string;
  paw: string;
  eye: string;
  spike: number;
  bulk: number;
  brow: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const rgb = (r: number, g: number, b: number) =>
  `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

/**
 * Real per-token colours exported by tools/traits-to-params.mjs alongside the
 * Blender params, as nine hex digits: mane, suit, face.
 *
 * The habitat dots used to invent a hue from a token hash, so the Chog you
 * clicked was a different colour from the Chog that walked into battle.
 */
let PAL: Record<string, string> | null = null;

export async function loadPalette(): Promise<void> {
  if (PAL) return;
  try {
    const r = await fetch('/pal.json');
    if (r.ok) PAL = (await r.json()) as Record<string, string>;
  } catch {
    /* the hashed fallback is still a recognisable Chog */
  }
}

const hexPart = (hex: string, i: number): [number, number, number] => {
  // rgb() takes 0..255 and the hex pair already is 0..255 — scaling again here
  // produced values in the tens of thousands and washed every dot to white.
  const n = parseInt(hex.slice(i * 6, i * 6 + 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Palette is seeded from the token, so every Chog is recognisably itself. */
export function lookFor(tokenId: number, p: Personality): ChogLook {
  const h = (n: number) => ((Math.imul(tokenId + 1, 0x9e3779b1) >>> n) & 0xff) / 255;
  const hue = h(3) * 360;
  const real = PAL?.[String(tokenId)];
  if (real && real.length >= 18) {
    const [mr, mg, mb] = hexPart(real, 0);
    const [sr, sg, sb] = hexPart(real, 1);
    const [fr, fg, fb] = hexPart(real, 2);
    return {
      mane: rgb(mr, mg, mb),
      // The suit is not drawn in the habitat, but keeping it out of the mane
      // would make the dot disagree with the model.
      face: rgb(fr, fg, fb),
      paw: rgb(mr * 0.75, mg * 0.75, mb * 0.75),
      eye: rgb(20 + h(7) * 30, 12, 30),
      spike: MANE_SPIKES,
      bulk: 1,
      brow: mix(0.15, 0.9, p.aggression),
      suit: rgb(sr, sg, sb),
    };
  }
  const mane = hsl(hue, 0.45 + p.aggression * 0.25, 0.32 + p.curiosity * 0.18);
  return {
    mane,
    face: hsl((hue + 30) % 360, 0.45, 0.86),
    paw: hsl((hue + 320) % 360, 0.62, 0.55),
    eye: rgb(20 + h(7) * 30, 12, 30),
    spike: 5 + Math.floor(h(11) * 5),
    bulk: mix(0.82, 1.18, p.stamina),
    brow: mix(0.15, 0.9, p.aggression),
  };
}

function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return rgb(f(0) * 255, f(8) * 255, f(4) * 255);
}

/**
 * The full creature: spiky mane ring, cream face, angry brows, pink paws.
 * `t` is seconds, used for squash/bob so it reads as alive without sprite frames.
 */
export function drawChog(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  look: ChogLook,
  t: number,
  facing = 1,
  mood: 'idle' | 'run' | 'hit' | 'charge' = 'idle',
): void {
  const bob = Math.sin(t * (mood === 'run' ? 12 : 3.2)) * size * 0.045;
  const squash = mood === 'charge' ? 1.12 : 1 + Math.sin(t * 3.2) * 0.03;
  const s = size;

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(facing * squash, 2 - squash);

  // mane
  ctx.fillStyle = look.mane;
  ctx.beginPath();
  for (let i = 0; i < look.spike; i++) {
    const a0 = (i / look.spike) * Math.PI * 2;
    const a1 = ((i + 0.5) / look.spike) * Math.PI * 2;
    const r0 = s * 0.62 * look.bulk;
    const r1 = s * 0.92 * look.bulk;
    ctx.lineTo(Math.cos(a0) * r0, Math.sin(a0) * r0 * 0.9);
    ctx.lineTo(Math.cos(a1) * r1, Math.sin(a1) * r1 * 0.9 - s * 0.06);
  }
  ctx.closePath();
  ctx.fill();

  // paws
  ctx.fillStyle = look.paw;
  const swing = mood === 'run' ? Math.sin(t * 12) * s * 0.1 : 0;
  ctx.beginPath();
  ctx.arc(-s * 0.3, s * 0.42 + swing, s * 0.19, 0, Math.PI * 2);
  ctx.arc(s * 0.3, s * 0.42 - swing, s * 0.19, 0, Math.PI * 2);
  ctx.fill();

  // face
  ctx.fillStyle = look.face;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.44, s * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // ears
  ctx.beginPath();
  ctx.moveTo(-s * 0.4, -s * 0.24);
  ctx.lineTo(-s * 0.3, -s * 0.62);
  ctx.lineTo(-s * 0.12, -s * 0.34);
  ctx.moveTo(s * 0.4, -s * 0.24);
  ctx.lineTo(s * 0.3, -s * 0.62);
  ctx.lineTo(s * 0.12, -s * 0.34);
  ctx.fill();

  // blush
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = look.paw;
  ctx.beginPath();
  ctx.ellipse(-s * 0.26, s * 0.1, s * 0.1, s * 0.055, 0, 0, Math.PI * 2);
  ctx.ellipse(s * 0.26, s * 0.1, s * 0.1, s * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // eyes + brows carry the temperament
  const glare = mood === 'hit' ? 0.35 : 1;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(-s * 0.16, -s * 0.05, s * 0.1, s * 0.11 * glare, 0, 0, Math.PI * 2);
  ctx.ellipse(s * 0.16, -s * 0.05, s * 0.1, s * 0.11 * glare, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = look.eye;
  ctx.beginPath();
  ctx.arc(-s * 0.15 + facing * s * 0.02, -s * 0.04, s * 0.045, 0, Math.PI * 2);
  ctx.arc(s * 0.17 + facing * s * 0.02, -s * 0.04, s * 0.045, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = look.eye;
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(-s * 0.27, -s * 0.2 + look.brow * s * 0.06);
  ctx.lineTo(-s * 0.05, -s * 0.26 + look.brow * s * 0.14);
  ctx.moveTo(s * 0.27, -s * 0.2 + look.brow * s * 0.06);
  ctx.lineTo(s * 0.05, -s * 0.26 + look.brow * s * 0.14);
  ctx.stroke();

  ctx.restore();
}

/** Cheap stand-in for the 1,969-strong swarm: mane silhouette + two eyes. */
export function drawChogDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  look: ChogLook,
  agitated: number,
): void {
  ctx.fillStyle = look.mane;
  ctx.beginPath();
  const spikes = look.spike;
  for (let i = 0; i < spikes; i++) {
    const a0 = (i / spikes) * Math.PI * 2;
    const a1 = ((i + 0.5) / spikes) * Math.PI * 2;
    const wob = 1 + agitated * 0.25 * Math.sin(a0 * 3);
    ctx.lineTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    ctx.lineTo(x + Math.cos(a1) * r * 1.5 * wob, y + Math.sin(a1) * r * 1.5 * wob);
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = look.face;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.fill();

  if (r > 3) {
    ctx.fillStyle = look.eye;
    ctx.fillRect(x - r * 0.3, y - r * 0.15, r * 0.18, r * 0.18);
    ctx.fillRect(x + r * 0.12, y - r * 0.15, r * 0.18, r * 0.18);
  }
}

/**
 * Animation frames generated at runtime, so the whole art pipeline stays in text
 * files an agent can edit. `phase` walks a cycle; facing is handled with setFlipX.
 */
export function buildChogFrames(scene: Phaser.Scene, key: string, look: ChogLook, size = 72, frames = 8): void {
  if (scene.textures.exists(key)) return;
  const cw = Math.ceil(size * 1.5);
  const ch = Math.ceil(size * 1.5);
  const cv = document.createElement('canvas');
  cv.width = cw * frames;
  cv.height = ch;
  const ctx = cv.getContext('2d')!;

  for (let i = 0; i < frames; i++) {
    const t = (i / frames) * (Math.PI * 2 / 3);
    ctx.save();
    ctx.translate(i * cw + cw / 2, ch / 2);
    drawChog(ctx, 0, 0, size * 0.42, look, t, 1, i % 4 < 2 ? 'idle' : 'run');
    ctx.restore();
  }

  const tex = scene.textures.addCanvas(key, cv)!;
  for (let i = 0; i < frames; i++) tex.add(String(i), 0, i * cw, 0, cw, ch);
}

/**
 * The procedural sprite has one 8-frame cycle and no attack or hit poses, so
 * those actions fall back to the cycle running faster rather than silently
 * doing nothing. Kept here so Battle can call it without knowing which visual a
 * token ended up with.
 */
export function playFallback(
  sprite: { anims: PhaserLikeAnims; play: (k: string, start?: boolean) => unknown },
  action: 'idle' | 'walk' | 'attack' | 'hit',
  vx: number,
): void {
  if (action === 'idle' && vx === 0) {
    sprite.anims.pause();
    return;
  }
  sprite.play('chog-run', true);
  sprite.anims.timeScale = action === 'attack' || action === 'hit' ? 2.2 : 1;
}

/** The slice of Phaser's animation state this module needs. */
interface PhaserLikeAnims {
  pause: () => unknown;
  timeScale: number;
}

export function drawAnomaly(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, phase: number): void {
  ctx.save();
  ctx.translate(x, y);
  const wob = 1 + Math.sin(t * 2.4) * 0.06;
  for (let ring = 3; ring >= 1; ring--) {
    ctx.globalAlpha = 0.16 * ring;
    ctx.fillStyle = ring === 3 ? '#b04dff' : ring === 2 ? '#5a2b8f' : '#1a0a2e';
    ctx.beginPath();
    const rr = r * (0.55 + ring * 0.28) * wob;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + t * (i % 2 ? 0.6 : -0.4);
      const jag = rr * (i % 2 ? 1 : 0.72) * (1 + phase * 0.08);
      ctx.lineTo(Math.cos(a) * jag, Math.sin(a) * jag);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ff4d6d';
  const blink = Math.sin(t * 5) > -0.7 ? 1 : 0.15;
  ctx.fillRect(-r * 0.34, -r * 0.12, r * 0.2, r * 0.2 * blink);
  ctx.fillRect(r * 0.14, -r * 0.12, r * 0.2, r * 0.2 * blink);
  ctx.restore();
}
