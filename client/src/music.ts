import { setAmbience, type AmbienceId } from './audio.ts';
import type { RegionId } from '@chog/shared';

/**
 * Real music: file-backed tracks, one slot per place.
 *
 * The synthesiser in `audio.ts` stays exactly what it is good at — effects and, where no
 * track exists yet, the generative bed it already plays. Everything else moved here: the
 * gate plays the project's own `CHOG WORLD ORDER` render (`public/audio/`), the world
 * plays licensed Kevin MacLeod MP3s (`public/music/`), this keeps at most one playing,
 * and switches crossfade over two seconds so walking through a door never clicks.
 *
 * Missing files are normal, not an error. A slot whose file 404s falls back down its chain
 * (a region falls back to the shared `line` track) and, with nothing left to play, parks on
 * the generative ambience that place always had. So the game sounds exactly like today until
 * the first MP3 lands, and every file dropped in takes its scene over on the next refresh.
 * Track switches and 404s are logged, so integration is one console read, not a guessing game.
 *
 * See `docs/MUSIC.md` for the slot table, the file spec, and the licensing rule (only ship
 * files the project owns or licenses — nothing here may hotlink the internet).
 */

export type MusicSlot = 'title' | 'city' | 'duel' | 'dungeon' | 'line' | RegionId;

const FILE: Record<MusicSlot, string> = {
  title: '/audio/chog-wave-login.ogg',
  city: '/music/city.mp3',
  duel: '/music/duel.mp3',
  dungeon: '/music/dungeon.mp3',
  line: '/music/line.mp3',
  tolls: '/music/tolls.mp3',
  ashpine: '/music/ashpine.mp3',
  marsh: '/music/marsh.mp3',
  relay: '/music/relay.mp3',
  causeway: '/music/causeway.mp3',
  static: '/music/static.mp3',
};

const REGIONS: ReadonlySet<string> = new Set([
  'tolls', 'ashpine', 'marsh', 'relay', 'causeway', 'static',
]);

/** What the generative bed plays when a slot has no file. Title had silence; it keeps it. */
const fallbackAmbience = (slot: MusicSlot): AmbienceId | null =>
  slot === 'city' ? 'city'
  : slot === 'duel' ? 'duel'
  : slot === 'dungeon' ? 'dungeon'
  : slot === 'tolls' ? 'tolls'
  : slot === 'title' ? null
  : 'line';

const VOL_KEY = 'chog:music-vol';
const XFADE_MS = 2000;
const TICK_MS = 100;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.35);

let vol = 0.35;
try {
  const raw = localStorage.getItem(VOL_KEY);
  if (raw !== null) vol = clamp01(parseFloat(raw));
} catch {
  // Private mode or blocked storage: forget persistence, keep playing.
}

let muted = false;
let unlocked = false;
let pending: MusicSlot | null = null;
let gen = 0;

interface Layer {
  el: HTMLAudioElement;
  slot: MusicSlot;
  /** 1 while this is the music, draining to 0 once replaced. */
  level: number;
}

let active: Layer | null = null;
let fading: Layer[] = [];
const missing = new Set<string>();
let ticker: number | null = null;

const applyVolumes = (): void => {
  const out = (l: Layer): void => {
    l.el.volume = clamp01(l.level * (muted ? 0 : vol));
    l.el.muted = muted;
  };
  if (active) out(active);
  for (const l of fading) out(l);
};

const tick = (): void => {
  const step = TICK_MS / XFADE_MS;
  if (active) active.level = Math.min(1, active.level + step);
  fading = fading.filter((l) => {
    l.level = Math.max(0, l.level - step);
    if (l.level <= 0) {
      l.el.pause();
      l.el.removeAttribute('src');
      l.el.load();
      return false;
    }
    return true;
  });
  applyVolumes();
  if (!active && fading.length === 0 && ticker !== null) {
    window.clearInterval(ticker);
    ticker = null;
  }
};

const ensureTicker = (): void => {
  if (ticker === null) ticker = window.setInterval(tick, TICK_MS);
};

const parkActive = (): void => {
  if (active) {
    fading.push(active);
    active = null;
    ensureTicker();
  }
};

/** The file a slot resolves to, after the region→line fallback. Null means generative bed. */
const resolveFile = (slot: MusicSlot): string | null => {
  const direct = FILE[slot];
  if (!missing.has(direct)) return direct;
  if (REGIONS.has(slot) && !missing.has(FILE.line)) return FILE.line;
  return null;
};

const startFile = (slot: MusicSlot, file: string, g: number): void => {
  const el = new Audio();
  el.preload = 'auto';
  el.loop = true;
  el.volume = 0;
  el.addEventListener('canplaythrough', () => {
    if (g !== gen) return;
    void el.play().catch(() => {
      // The gesture race: unlock() had not landed yet. Park and wait for it.
      pending = slot;
    });
    parkActive();
    active = { el, slot, level: 0 };
    ensureTicker();
    applyVolumes();
    setAmbience(null);
    console.info(`[music] playing ${file} for ${slot}`);
  }, { once: true });
  el.addEventListener('error', () => {
    if (g !== gen) return;
    missing.add(file);
    console.info(`[music] ${file} missing, falling back`);
    void playMusic(slot);
  }, { once: true });
  el.src = file;
  el.load();
};

/**
 * Score a scene. Idempotent: calling it with the playing slot is a no-op, so scene
 * transitions can call it unconditionally the way they called `setAmbience`.
 */
export function playMusic(slot: MusicSlot): void {
  gen += 1;
  if (active?.slot === slot || pending === slot) return;
  if (!unlocked) {
    pending = slot;
    return;
  }
  pending = null;
  const file = resolveFile(slot);
  if (!file) {
    parkActive();
    setAmbience(fallbackAmbience(slot));
    active = null;
    return;
  }
  startFile(slot, file, gen);
}

/** Silence everything musical. The generative bed parks too; the next playMusic restores. */
export function stopMusic(): void {
  gen += 1;
  pending = null;
  parkActive();
  setAmbience(null);
}

/** Mirrors the master mute. Called next to `toggleMute()` wherever that runs. */
export function setMusicMuted(m: boolean): void {
  muted = m;
  applyVolumes();
}

export function setMusicVolume(v: number): void {
  vol = clamp01(v);
  try {
    localStorage.setItem(VOL_KEY, String(vol));
  } catch {
    // Private mode or blocked storage: this session only.
  }
  applyVolumes();
}

/** Runs next to `unlock()`: browsers refuse audio before a gesture, files included. */
export function unlockMusic(): void {
  if (unlocked) return;
  unlocked = true;
  if (pending) {
    const slot = pending;
    pending = null;
    playMusic(slot);
  }
}

/** Console debugging: what is scored, what is playing, what 404d. */
export function musicStatus(): { slot: MusicSlot | null; file: string | null; missing: string[] } {
  return {
    slot: active?.slot ?? pending,
    file: active ? active.el.currentSrc || active.el.src : null,
    missing: [...missing],
  };
}
