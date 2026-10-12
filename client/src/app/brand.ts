/**
 * The game's face: its name, its mark, the chain it runs on, and the street it is set in.
 *
 * Everything here is drawn from constants — the wordmark is a hand-cut 5x7 pixel alphabet
 * rather than a font, because a logo that is also a typeface stops being a logo, and the
 * letters have to survive a 2px favicon and a projector at once. The busts are the real
 * baked sprite atlases, so the faces on the gate are the faces in the world.
 *
 * The one rule worth keeping: the wave ribbon under the name is the screen's state lamp.
 * Mint means it is ready, gold means the chain is still talking, rose means the server said
 * no. That is the same colour grammar the HUD already spends, applied to the logo instead of
 * inventing a second language for the front door.
 */

const PIXELS: Record<string, string[]> = {
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '.#.#.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
};

/** Two up, two flat, two down: the shape the ribbon repeats along the name. */
const RIBBON = [0, 1, 2, 3, 3, 2, 1, 0];

/**
 * The name, as SVG rects on the pixel grid.
 *
 * `cell` is the only size knob: the same call draws the 6px hero lockup and the 3px one
 * that sits in the header once a Chog has been chosen.
 */
export function wordmark(lines: string[], { cell = 6, ink = '#ffffff', ribbon = '#43e2a8', wave = true } = {}): string {
  const px: [number, number][] = [];
  lines.forEach((line, li) => {
    let col = 0;
    for (const ch of line) {
      if (ch === ' ') {
        col += 7;
        continue;
      }
      const glyph = PIXELS[ch];
      if (!glyph) throw new Error(`the wordmark has no glyph for ${ch}`);
      glyph.forEach((row, y) => {
        for (const [x, on] of [...row].entries()) if (on === '#') px.push([col + x, li * 8 + y]);
      });
      col += 7;
    }
  });
  const w = Math.max(...px.map((p) => p[0])) + 1;
  const h = lines.length * 8 - 1;
  let out = px.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${ink}"/>`).join('');
  let height = h;
  if (wave) {
    for (let x = 0; x < w; x++) out += `<rect x="${x}" y="${h + 3 + (RIBBON[x % RIBBON.length] ?? 0)}" width="1" height="1" fill="${ribbon}"/>`;
    height = h + 6;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height}" width="${w * cell}" height="${height * cell}" role="img" aria-label="Chog Wave" shape-rendering="crispEdges">${out}</svg>`;
}

/**
 * The five Chogs that front the gate.
 *
 * These are the current renders (`blender/out/traits/tokenN_head.png`, copied in as a
 * snapshot on 2026-10-11), not the old baked atlases the world still walks around in.
 * They are chosen by looking at the art: #1 wears the chain id on its shirt, which is
 * about as on-brand as a genesis token gets.
 */
export const BRAND_CAST: [number, string][] = [
  [1, 'the 143 shirt'],
  [4, 'bolt helmet'],
  [13, 'bucket hat'],
  [26, 'pizza beanie'],
  [111, 'the skull'],
];

/**
 * The street, painted.
 *
 * A login screen with nothing behind it is a modal, so the gate draws its own horizon:
 * an isometric grid receding to a glow, blocks with a few lit windows, warm lamp pools,
 * and one mint wave sweeping across the tiles every nine seconds — the name made into
 * scenery. It is a 2D canvas rather than the 3D world on purpose: the world is built
 * after the join, and the gate cannot ask for it.
 *
 * Repainted at ~12fps, which is plenty for a drift, and `stop()` belongs in the caller's
 * teardown so a screen nobody is looking at never keeps a loop alive.
 */
export function street(canvas: HTMLCanvasElement): { stop(): void } {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { stop() {} };
  const TILE_W = 96;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Deterministic, so a screenshot of the street is comparable with the last one. */
  const hash = (a: number, b: number) => {
    let h = (a * 73856093) ^ (b * 19349663);
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  };

  let raf = 0;
  let last = 0;
  const started = performance.now();

  const paint = (t: number) => {
    const dpr = devicePixelRatio;
    const W = (canvas.width = canvas.clientWidth * dpr);
    const H = (canvas.height = canvas.clientHeight * dpr);
    const horizon = H * 0.44;

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b0718');
    sky.addColorStop(0.42, '#150e28');
    sky.addColorStop(0.5, '#1d1435');
    sky.addColorStop(1, '#050309');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.5, horizon, 0, W * 0.5, horizon, W * 0.6);
    glow.addColorStop(0, 'rgba(154,114,234,.30)');
    glow.addColorStop(0.5, 'rgba(154,114,234,.07)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const cols = Math.ceil(W / TILE_W) + 6;
    const rows = Math.ceil((H - horizon) / (TILE_W * 0.19)) + 4;
    const drift = (t / 26000) % 1;
    const waveX = (t / 9000) % 1;

    for (let r = rows; r >= 0; r--) {
      // Depth does the work: tiles shrink, brighten and gain detail as they come forward.
      const depth = 1 - r / (rows + 5);
      const tw = TILE_W * (0.42 + depth * 0.9) * dpr;
      const th = tw / 2;
      const y = horizon - th * 0.2 + r * th * 0.62;
      const shade = 0.16 + depth * 0.84;

      for (let c = -2; c < cols; c++) {
        const x = (c + drift) * tw - tw * 0.5 + (r % 2 ? tw / 2 : 0);
        const rnd = hash(c, r);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + tw / 2, y + th / 2);
        ctx.lineTo(x, y + th);
        ctx.lineTo(x - tw / 2, y + th / 2);
        ctx.closePath();
        ctx.fillStyle = `rgba(${rnd < 0.14 ? '44,34,72' : '15,11,27'},${(0.4 + shade * 0.6).toFixed(3)})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(120,92,190,${(0.015 + shade * 0.055).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        const near = 1 - Math.abs((c + drift) / cols - waveX);
        if (near > 0.978) {
          ctx.fillStyle = `rgba(67,226,168,${(0.05 + shade * 0.13).toFixed(3)})`;
          ctx.fill();
        }
        const lamp = hash(c + 11, r + 5);
        if (lamp > 0.955 && depth > 0.3) {
          const pool = ctx.createRadialGradient(x, y + th * 0.5, 0, x, y + th * 0.5, tw * 0.7);
          pool.addColorStop(0, `rgba(245,195,67,${(0.22 * shade).toFixed(3)})`);
          pool.addColorStop(1, 'transparent');
          ctx.fillStyle = pool;
          ctx.fillRect(x - tw, y - th * 0.5, tw * 2, th * 2);
        }
        ctx.restore();

        if (rnd > 0.8 && depth > 0.22) {
          const bh = (0.8 + hash(c + 7, r) * 2.6) * th * 2.2 * shade;
          const bw = tw * 0.42;
          ctx.fillStyle = `rgba(21,15,38,${(0.9 + shade * 0.1).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(x - bw, y + th / 2);
          ctx.lineTo(x, y + th);
          ctx.lineTo(x + bw, y + th / 2);
          ctx.lineTo(x + bw, y + th / 2 - bh);
          ctx.lineTo(x, y + th - bh);
          ctx.lineTo(x - bw, y + th / 2 - bh);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(8,5,17,.96)';
          ctx.beginPath();
          ctx.moveTo(x - bw, y + th / 2 - bh);
          ctx.lineTo(x, y + th - bh);
          ctx.lineTo(x, y + th);
          ctx.lineTo(x - bw, y + th / 2);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(28,21,50,.96)';
          ctx.beginPath();
          ctx.moveTo(x, y + th - bh);
          ctx.lineTo(x + bw, y + th / 2 - bh);
          ctx.lineTo(x + bw, y + th / 2);
          ctx.lineTo(x, y + th);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(46,35,78,.98)';
          ctx.strokeStyle = 'rgba(140,110,210,.22)';
          ctx.beginPath();
          ctx.moveTo(x - bw, y + th / 2 - bh);
          ctx.lineTo(x, y + th - bh);
          ctx.lineTo(x + bw, y + th / 2 - bh);
          ctx.lineTo(x, y - bh + th / 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          for (let i = 0; i < 3; i++) {
            const wr = hash(c * 3 + i, r * 5);
            if (wr < 0.55) continue;
            ctx.fillStyle = wr < 0.75 ? 'rgba(245,195,67,.75)' : wr < 0.9 ? 'rgba(67,226,168,.6)' : 'rgba(106,210,230,.6)';
            ctx.fillRect(x - bw * 0.55 + wr * bw * 0.9, y + th * 0.2 - bh * (0.25 + wr * 0.4), 2 * dpr, 2 * dpr);
          }
        }
      }
    }

    ctx.fillStyle = 'rgba(0,0,0,.16)';
    for (let y = 0; y < H; y += 3 * dpr) ctx.fillRect(0, y, W, 1 * dpr);
    const vig = ctx.createRadialGradient(W * 0.42, H * 0.42, H * 0.2, W * 0.5, H * 0.5, H * 0.95);
    vig.addColorStop(0, 'transparent');
    vig.addColorStop(1, 'rgba(3,2,7,.92)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  };

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (now - last < 82) return;
    last = now;
    paint(now - started);
  };

  if (still) paint(0);
  else raf = requestAnimationFrame(loop);

  return {
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
