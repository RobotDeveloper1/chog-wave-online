/**
 * Every sound is synthesised. There is no audio asset to license, no fetch to
 * wait on, and the whole palette still fits in one file.
 *
 * The browser refuses an AudioContext until a gesture, so the first call is
 * deferred until `unlock()` runs from a keypress or a click.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let muted = false;

export function unlock(): void {
  if (unlocked) return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
  unlocked = true;
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.32;
  return muted;
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = 'square',
  gain = 0.5,
  slideTo?: number,
): void {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, gain = 0.3, hp = 400): void {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = hp;
  const env = ctx.createGain();
  env.gain.value = gain;
  src.connect(filt).connect(env).connect(master);
  src.start(t);
}

export const sfx = {
  jump: () => tone(320, 0.14, 'square', 0.28, 620),
  step: () => noise(0.03, 0.05, 1200),
  pick: () => tone(880, 0.05, 'square', 0.2),
  place: () => tone(520, 0.07, 'triangle', 0.3, 660),
  deny: () => tone(150, 0.16, 'sawtooth', 0.28, 90),
  link: () => tone(660, 0.09, 'triangle', 0.24, 990),
  /** The release: a rising chirp that reads as "the program ran". */
  fire: () => {
    tone(220, 0.1, 'square', 0.3, 880);
    setTimeout(() => tone(880, 0.12, 'square', 0.24, 1400), 60);
  },
  hitBoss: (big: number) => {
    noise(0.08, 0.22, 900);
    tone(big > 2 ? 130 : 180, 0.16, 'sawtooth', 0.3, 60);
  },
  hurt: () => {
    noise(0.12, 0.3, 300);
    tone(200, 0.2, 'sawtooth', 0.3, 70);
  },
  /** Laser eyes: long, bright, and deliberately over the top. */
  laser: () => {
    tone(1200, 0.5, 'sawtooth', 0.34, 180);
    tone(1800, 0.5, 'square', 0.16, 260);
    noise(0.42, 0.16, 1800);
  },
  spawn: () => {
    tone(90, 0.7, 'sawtooth', 0.34, 320);
    setTimeout(() => tone(120, 0.5, 'square', 0.2, 420), 120);
  },
  cleared: () => {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.3), i * 90));
  },
  loot: () => {
    [784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'square', 0.24), i * 70));
  },
  ui: () => tone(700, 0.04, 'square', 0.14),
  /** Someone says something: two soft notes, like a small bell. */
  talk: () => {
    tone(660, 0.07, 'triangle', 0.2);
    setTimeout(() => tone(880, 0.09, 'triangle', 0.18), 70);
  },
  /** A quest taken: a firm step up. */
  accept: () => {
    tone(392, 0.1, 'square', 0.22);
    setTimeout(() => tone(587, 0.16, 'square', 0.22), 90);
  },
  /** A quest handed in: the full rising arpeggio, the biggest sound in the street. */
  quest: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.3), i * 85));
  },
  /** A place found: a bright shimmer over a low note. */
  discover: () => {
    tone(196, 0.5, 'sine', 0.22);
    [988, 1319, 1760].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'sine', 0.16), 120 + i * 90));
  },
  /** A Mystery Wave caught: a droplet rising into a chime. */
  wave: () => {
    tone(300, 0.12, 'sine', 0.24, 900);
    setTimeout(() => tone(1568, 0.3, 'sine', 0.2), 110);
  },
  door: () => {
    noise(0.07, 0.2, 200);
    tone(110, 0.14, 'triangle', 0.24, 70);
  },
  /** A gate: a long sweep, up and out. */
  travel: () => {
    tone(180, 0.6, 'sawtooth', 0.2, 900);
    noise(0.5, 0.1, 1500);
  },
  level: () => {
    [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'square', 0.26), i * 100));
  },
  visualizer: (on: boolean) => tone(on ? 500 : 800, 0.18, 'sine', 0.2, on ? 1000 : 400),
  routed: () => {
    [400, 320, 240, 150].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'sawtooth', 0.28), i * 110));
  },

  // ------------------------------------------------------------------ the duel
  /** The boss warns: two falling alarm notes, urgent and not annoying. */
  warn: () => {
    tone(880, 0.09, 'square', 0.2, 660);
    setTimeout(() => tone(660, 0.12, 'square', 0.2, 440), 110);
  },
  /** The strike lands on the files it marked: a low hit and a crack. */
  strike: () => {
    noise(0.16, 0.34, 250);
    tone(90, 0.28, 'sawtooth', 0.34, 40);
  },
  dodge: () => {
    tone(700, 0.06, 'triangle', 0.2, 1500);
    noise(0.06, 0.1, 2500);
  },
  /** The gauge fills: a bright double ping. */
  customReady: () => {
    tone(784, 0.08, 'triangle', 0.26);
    setTimeout(() => tone(1175, 0.14, 'triangle', 0.26), 80);
  },
  customOpen: () => {
    tone(330, 0.08, 'square', 0.2, 660);
    setTimeout(() => tone(660, 0.1, 'triangle', 0.22, 990), 70);
  },
  customClose: () => tone(520, 0.1, 'triangle', 0.2, 260),
  /** A card leaves the program: per-element, because the colour is also a sound. */
  shot: (element: string) => {
    switch (element) {
      case 'burn':
        noise(0.14, 0.2, 700);
        tone(240, 0.18, 'sawtooth', 0.24, 520);
        break;
      case 'frost':
        tone(1500, 0.14, 'triangle', 0.2, 2300);
        tone(1100, 0.2, 'sine', 0.14, 1900);
        break;
      case 'volt':
        noise(0.12, 0.22, 3000);
        tone(180, 0.1, 'square', 0.22, 1400);
        break;
      case 'wave':
        tone(300, 0.2, 'sine', 0.26, 700);
        break;
      case 'void':
        tone(110, 0.3, 'sawtooth', 0.26, 38);
        break;
      default:
        tone(520, 0.16, 'triangle', 0.24, 1040);
    }
  },
  crit: () => {
    tone(1319, 0.08, 'square', 0.24);
    setTimeout(() => tone(1760, 0.14, 'square', 0.24), 60);
  },
  /** A fusion: a held chord that opens up. */
  fusion: () => {
    [392, 523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.45 - i * 0.04, 'triangle', 0.22), i * 55));
    setTimeout(() => noise(0.3, 0.14, 2200), 260);
  },
  phase: () => {
    tone(100, 0.5, 'sawtooth', 0.3, 260);
    noise(0.3, 0.16, 500);
  },
  defeat: () => {
    [330, 262, 196, 130].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sawtooth', 0.26), i * 140));
  },
};
