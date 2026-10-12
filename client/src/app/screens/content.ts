import * as THREE from 'three';

/**
 * What the screens show, and how a clip gets to them.
 *
 * A screen plays the clips named in `client/public/screens/playlist.json`, one per screen in
 * order, and the list wraps. Until a clip is ready (or when there is none) a screen shows the
 * house ad painted here: a canvas, so it costs next to nothing and is never blank.
 *
 * Clips are muted and loop. A file is decoded once however many screens show it, and it pauses
 * when the last screen that shows it has been taken down.
 */

export const SCREEN_ASPECT = 16 / 9;

const PLAYLIST = '/screens/playlist.json';
/** WebM is the format to use: small, and decoded by the GPU. MP4 still plays, as a fallback. */
const PLAYABLE = /\.(webm|mp4)$/i;
/** Past this a clip is too heavy for a street screen; the console says so, and it still plays. */
const HEAVY_BYTES = 3_000_000;

let list: Promise<string[]> | null = null;

/** The clip URLs the playlist names, read once per page. A missing or broken file means none. */
export function loadPlaylist(): Promise<string[]> {
  list ??= fetch(PLAYLIST, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
    .then((j) => {
      const names = j && typeof j === 'object' ? (j as { videos?: unknown }).videos : undefined;
      if (!Array.isArray(names)) return [];
      const urls: string[] = [];
      for (const n of names) {
        if (typeof n !== 'string') continue;
        if (!PLAYABLE.test(n)) {
          console.warn(`[screens] ${n}: não toca. Use .webm (converta GIF ou MP4 com tools/screen-encode.cjs)`);
          continue;
        }
        const url = `/screens/${encodeURIComponent(n)}`;
        urls.push(url);
        void weigh(url, n);
      }
      return urls;
    })
    .catch(() => []);
  return list;
}

/** Says so in the console when a clip is heavier than a street screen should carry. */
function weigh(url: string, name: string): Promise<void> {
  return fetch(url, { method: 'HEAD' })
    .then((r) => {
      const bytes = Number(r.headers.get('content-length') ?? 0);
      if (bytes > HEAVY_BYTES) console.warn(`[screens] ${name} tem ${(bytes / 1e6).toFixed(1)} MB: pesado pra telão, converta para um .webm menor`);
    })
    .catch(() => undefined);
}

/** One video file, decoded once and shared by every screen that plays it. */
export interface Clip {
  el: HTMLVideoElement;
  tex: THREE.VideoTexture | null;
  users: number;
}

const clips = new Map<string, Clip>();

export function clipFor(url: string): Clip {
  let c = clips.get(url);
  if (!c) {
    const el = document.createElement('video');
    el.src = url;
    el.muted = true;
    el.loop = true;
    el.playsInline = true;
    el.preload = 'auto';
    c = { el, tex: null, users: 0 };
    clips.set(url, c);
    void el.play().catch(() => undefined);
  }
  return c;
}

/** The clip as a texture, centre-cropped to 16:9 so that no clip is squashed. Call once it has loaded. */
export function textureFor(c: Clip): THREE.VideoTexture {
  if (!c.tex) {
    const tex = new THREE.VideoTexture(c.el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    cover(tex, c.el.videoWidth / c.el.videoHeight || SCREEN_ASPECT);
    c.tex = tex;
  }
  return c.tex;
}

/** A screen starts showing the clip. Browsers may hold back autoplay, so the first screen asks for playback. */
export function hold(c: Clip): void {
  c.users++;
  if (c.el.paused) void c.el.play().catch(() => undefined);
}

/** A screen stops showing it. The last one out pauses it and frees its texture. */
export function drop(c: Clip): void {
  c.users = Math.max(0, c.users - 1);
  if (c.users > 0) return;
  c.el.pause();
  c.tex?.dispose();
  c.tex = null;
}

function cover(tex: THREE.Texture, ratio: number): void {
  if (ratio > SCREEN_ASPECT) {
    const s = SCREEN_ASPECT / ratio;
    tex.repeat.set(s, 1);
    tex.offset.set((1 - s) / 2, 0);
  } else {
    const s = ratio / SCREEN_ASPECT;
    tex.repeat.set(1, s);
    tex.offset.set(0, (1 - s) / 2);
  }
}

/** The house ad: a canvas painted 12 times a second, shown until a clip is ready. */
export class HouseAd {
  readonly tex: THREE.CanvasTexture;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private last = -1;

  constructor() {
    this.canvas.width = 960;
    this.canvas.height = 540;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.paint(0);
  }

  tick(t: number): void {
    if (t - this.last < 1 / 12) return;
    this.last = t;
    this.paint(t);
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
  }

  private paint(t: number): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#120826');
    sky.addColorStop(0.65, '#3a1450');
    sky.addColorStop(1, '#8a3a4a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // three waves, in the colours of the first three elements
    ['#ff7a45', '#ffe066', '#6fe3c8'].forEach((col, i) => {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = H * (0.6 + i * 0.09) + Math.sin(x * 0.011 + t * (1.1 + i * 0.35) + i * 1.7) * (34 - i * 6);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = 6 - i;
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 24;
      ctx.stroke();
    });
    ctx.shadowBlur = 0;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 124px system-ui, "Segoe UI", sans-serif';
    ctx.shadowColor = '#ffb45e';
    ctx.shadowBlur = 40;
    ctx.fillStyle = '#fff3e0';
    ctx.fillText('CHOG WAVES', W / 2, H * 0.4);
    ctx.shadowBlur = 0;
    ctx.font = '600 30px system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffd9b0';
    ctx.fillText('GENESIS · 0.0.1', W / 2, H * 0.4 + 88);

    // a ticker along the bottom edge
    const msg = 'FOLD GATE OPEN   ·   SIX DUNGEONS   ·   WAVE STATION   ·   ';
    ctx.font = '700 30px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    const step = ctx.measureText(msg).width;
    for (let x = -((t * 90) % step); x < W; x += step) ctx.fillText(msg, x, H * 0.9);
  }
}
