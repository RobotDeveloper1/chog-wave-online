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
/** OPTIONS tab's Effects slider, 0..1. Multiplies the base, never replaces it. */
let sfxLevel = 1;
const MASTER_BASE = 0.32;

function applyMaster(): void {
  if (master) master.gain.value = muted ? 0 : MASTER_BASE * sfxLevel;
}

export function unlock(): void {
  if (unlocked) return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_BASE * sfxLevel;
  master.connect(ctx.destination);
  unlocked = true;
  if (wanted) { const pending = wanted; wanted = null; setAmbience(pending); }
}

export function toggleMute(): boolean {
  muted = !muted;
  applyMaster();
  return muted;
}

/** Live volume for every synth voice. Safe before unlock — applies on unlock. */
export function setSfxVolume(v: number): void {
  sfxLevel = Math.min(1, Math.max(0, v));
  applyMaster();
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
  /**
   * Loot of each rarity, as a sound.
   *
   * One chime for everything was the old rule, and it meant a GIGA and a starter card arrived with
   * the same two notes — so rarity was a colour on a beam and nothing you heard. Now the pitch and
   * the length of the run climb with the tier, which is the whole point of a tier: it should be
   * audible without looking at the screen.
   */
  lootCommon: () => tone(660, 0.08, 'square', 0.2),
  lootRare: () => {
    tone(784, 0.1, 'square', 0.26);
    setTimeout(() => tone(1047, 0.12, 'square', 0.22), 80);
  },
  lootEpic: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.13, 'square', 0.3), i * 65));
  },
  /** Money, which is not a card and should not sound like one: a soft, falling clink. */
  lootMoney: () => {
    tone(1180, 0.06, 'triangle', 0.22);
    setTimeout(() => tone(1560, 0.09, 'triangle', 0.18), 55);
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
  /** The charge fills: a bright double ping. */
  handReady: () => {
    tone(784, 0.08, 'triangle', 0.26);
    setTimeout(() => tone(1175, 0.14, 'triangle', 0.26), 80);
  },
  handOpen: () => {
    tone(330, 0.08, 'square', 0.2, 660);
    setTimeout(() => tone(660, 0.1, 'triangle', 0.22, 990), 70);
  },
  handClose: () => tone(520, 0.1, 'triangle', 0.2, 260),
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

// ------------------------------------------------------------------ ambience
//
// Generative beds and music, one per place. No loops to license and nothing to fetch: a
// A bed of air, a low pad for weight, and a looping melody per place — an 8-step phrase,
// not a random walk: phrases resolve, so the ear reads music instead of weather. The whole
// score rides one bus at 0.35 into the master, so it sits far under the effects, and
// crossfades between places over a bar, so walking through a door never clicks.

export type AmbienceId = 'city' | 'line' | 'tolls' | 'dungeon' | 'duel';

interface AmbienceConfig {
  bed: { type: BiquadFilterType; freq: number; gain: number; lfoHz: number; lfoDepth: number };
  pad: { root: number; gain: number; cutoff: number };
/** A looping phrase: scale-degree indices, -1 for a rest. What makes it music. */
motif: { scale: number[]; stepMs: number; gain: number; decay: number; phrase: number[] };
  pulse: { everyMs: number; freq: number; gain: number } | null;
}

/** Pure: the whole character of a place, unit-testable without an AudioContext. */
export function ambienceConfig(id: AmbienceId): AmbienceConfig {
  switch (id) {
    case 'city':
      return {
bed: { type: 'lowpass', freq: 260, gain: 0.02, lfoHz: 0.05, lfoDepth: 100 },
pad: { root: 146.81, gain: 0.03, cutoff: 500 },
motif: { scale: [0, 2, 4, 7, 9, 12], stepMs: 430, gain: 0.045, decay: 0.9, phrase: [4, 3, 2, 1, 2, 3, 4, -1] },
        pulse: null,
      };
    case 'line':
      return {
bed: { type: 'lowpass', freq: 280, gain: 0.018, lfoHz: 0.08, lfoDepth: 120 },
pad: { root: 146.83, gain: 0.03, cutoff: 500 },
motif: { scale: [0, 3, 5, 7, 10, 12], stepMs: 460, gain: 0.045, decay: 1.0, phrase: [2, 1, 0, 1, 2, 3, 2, -1] },
        pulse: null,
      };
    case 'tolls':
      return {
bed: { type: 'lowpass', freq: 180, gain: 0.025, lfoHz: 0.04, lfoDepth: 80 },
pad: { root: 110, gain: 0.04, cutoff: 420 },
motif: { scale: [0, 3, 5, 7, 10, 12, 15], stepMs: 560, gain: 0.04, decay: 1.4, phrase: [3, 2, 1, 0, -1, 0, 1, -1] },
pulse: { everyMs: 5000, freq: 55, gain: 0.03 },
      };
    case 'dungeon':
      return {
bed: { type: 'lowpass', freq: 130, gain: 0.03, lfoHz: 0.03, lfoDepth: 50 },
pad: { root: 98, gain: 0.045, cutoff: 340 },
motif: { scale: [0, 3, 5, 7, 10, 12], stepMs: 620, gain: 0.04, decay: 1.2, phrase: [0, -1, 1, -1, 0, -1, 2, 1] },
pulse: { everyMs: 2600, freq: 65, gain: 0.045 },
      };
    case 'duel':
      return {
bed: { type: 'bandpass', freq: 600, gain: 0.016, lfoHz: 0.12, lfoDepth: 200 },
pad: { root: 130.81, gain: 0.035, cutoff: 900 },
motif: { scale: [0, 3, 5, 7, 10, 12], stepMs: 300, gain: 0.05, decay: 0.35, phrase: [0, 0, 2, 1, 0, 3, 2, 1] },
pulse: { everyMs: 1200, freq: 75, gain: 0.05 },
      };
  }
}

let wanted: AmbienceId | null = null;
/** The ambience bus: every bed, pad, pluck and thump rides it. SFX never touch it. */
let amb: GainNode | null = null;
let bedGain: GainNode | null = null;
let bedFilter: BiquadFilterNode | null = null;
let padGain: GainNode | null = null;
let padFilter: BiquadFilterNode | null = null;
let padOsc: OscillatorNode[] = [];
let ambTimer: number | null = null;
let nextMotif = 0;
let nextPulse = 0;
let step = 0;

const semi = (root: number, st: number): number => root * 2 ** (st / 12);

function ambienceNodes(): boolean {
  if (!ctx || !master) return false;
  if (bedGain) return true;
  if (!amb && master) {
    amb = ctx.createGain();
    amb.gain.value = 0.35;
    amb.connect(master);
  }
  // Two seconds of noise, looped: the air every bed breathes through.
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  bedFilter = ctx.createBiquadFilter();
  bedGain = ctx.createGain();
  bedGain.gain.value = 0;
  src.connect(bedFilter).connect(bedGain).connect(amb ?? master);
  src.start();
  // The bed's slow weather: a low LFO wandering the filter cutoff.
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.05;
  lfoGain.gain.value = 100;
  lfo.connect(lfoGain).connect(bedFilter.frequency);
  lfo.start();
  padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padGain = ctx.createGain();
  padGain.gain.value = 0;
  padFilter.connect(padGain).connect(amb ?? master);
  for (const [mult, type] of [[1, 'sine'], [1.5, 'triangle'], [2.003, 'sine']] as const) {
    const o = ctx.createOscillator();
    o.type = type as OscillatorType;
    o.frequency.value = 110 * mult;
    o.connect(padFilter);
    o.start();
    padOsc.push(o);
  }
  return true;
}

function pluck(freq: number, gain: number, decay: number): void {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const env = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(env).connect(amb ?? master);
  o.start(t);
  o.stop(t + decay + 0.05);
}

function thump(freq: number, gain: number): void {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const env = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.6), t + 0.18);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(env).connect(amb ?? master);
  o.start(t);
  o.stop(t + 0.35);
}

function ambienceTick(): void {
  if (!wanted || !ctx) return;
  const cfg = ambienceConfig(wanted);
  const now = performance.now();
  if (now >= nextMotif) {
    nextMotif = now + cfg.motif.stepMs * (0.97 + Math.random() * 0.06);
    const note = cfg.motif.phrase[step % cfg.motif.phrase.length] ?? -1;
    step += 1;
    if (note >= 0) {
      const st = cfg.motif.scale[note] ?? 0;
      pluck(semi(cfg.pad.root, st + 12), cfg.motif.gain, cfg.motif.decay);
    }
  }
  if (cfg.pulse && now >= nextPulse) {
    nextPulse = now + cfg.pulse.everyMs;
    thump(cfg.pulse.freq, cfg.pulse.gain);
  }
}

/** Fade the one persistent graph toward a place. Null parks it at silence. */
export function setAmbience(id: AmbienceId | null): void {
  if (id === wanted) return;
  wanted = id;
  if (!ambienceNodes() || !ctx) return;
  const t = ctx.currentTime;
  const cfg = id ? ambienceConfig(id) : null;
  bedGain!.gain.setTargetAtTime(cfg ? cfg.bed.gain : 0, t, 0.6);
  bedFilter!.type = cfg ? cfg.bed.type : 'lowpass';
  bedFilter!.frequency.setTargetAtTime(cfg ? cfg.bed.freq : 200, t, 0.6);
  padGain!.gain.setTargetAtTime(cfg ? cfg.pad.gain : 0, t, 0.6);
  padFilter!.frequency.setTargetAtTime(cfg ? cfg.pad.cutoff : 400, t, 0.6);
  padOsc.forEach((o, i) => {
    const mult = [1, 1.5, 2.003][i] ?? 1;
    o.frequency.setTargetAtTime((cfg ? cfg.pad.root : 110) * mult, t, 0.6);
  });
  step = 0;
  nextMotif = performance.now() + 400;
  nextPulse = performance.now() + 600;
  if (id && ambTimer === null) {
    ambTimer = window.setInterval(ambienceTick, 240);
  } else if (!id && ambTimer !== null) {
    window.clearInterval(ambTimer);
    ambTimer = null;
  }
}
