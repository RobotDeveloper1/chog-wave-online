/**
 * Player-facing options: sound, graphics, accessibility.
 *
 * One versioned JSON blob in localStorage, validated field-by-field on load so
 * a corrupt or foreign value falls back to its own default instead of wiping
 * the rest. Writes go through `updateSettings`, which persists and notifies
 * subscribers — the shell applies the new values live, no reload.
 *
 * Mute is the deliberate exception: the audio graph owns the muted flag (it
 * must survive before the first unlock gesture), so toggling calls the audio
 * modules first and mirrors the result here for the next boot. Subscribers
 * must never re-apply mute, or they would double-toggle.
 */
export type Quality = 'performance' | 'balanced' | 'ultra';
export type UiScale = 'compact' | 'normal' | 'large';

export interface Settings {
  version: 1;
  sound: { muted: boolean; music: number; sfx: number };
  graphics: { quality: Quality; post: boolean };
  a11y: { reduceMotion: boolean; uiScale: UiScale };
}

/**
 * What each quality preset drives. Balanced pins today's behaviour (DPR cap
 * 1.75, shadows, post on) so existing players see no change at default.
 */
export const QUALITY_PRESET: Record<Quality, { pixelCap: number; shadows: boolean; post: boolean }> = {
  performance: { pixelCap: 1, shadows: false, post: false },
  balanced: { pixelCap: 1.75, shadows: true, post: true },
  ultra: { pixelCap: 2, shadows: true, post: true },
};

/** CSS `zoom` applied to the HUD and menu roots — the 3D canvas is untouched. */
export const UI_ZOOM: Record<UiScale, number> = { compact: 0.92, normal: 1, large: 1.12 };

export const DEFAULTS: Settings = {
  version: 1,
  sound: { muted: false, music: 0.35, sfx: 1 },
  graphics: { quality: 'balanced', post: true },
  a11y: { reduceMotion: false, uiScale: 'normal' },
};

const KEY = 'chog.options.v1';

function num(v: unknown, lo: number, hi: number, fb: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
}

function one<T extends string>(v: unknown, opts: readonly T[], fb: T): T {
  return typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : fb;
}

function bool(v: unknown, fb: boolean): boolean {
  return typeof v === 'boolean' ? v : fb;
}

function sanitize(raw: unknown): Settings {
  const out: Settings = {
    version: 1,
    sound: { ...DEFAULTS.sound },
    graphics: { ...DEFAULTS.graphics },
    a11y: { ...DEFAULTS.a11y },
  };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, Record<string, unknown> | undefined>;
  const sound = r.sound ?? {};
  out.sound.muted = bool(sound.muted, out.sound.muted);
  out.sound.music = num(sound.music, 0, 1, out.sound.music);
  out.sound.sfx = num(sound.sfx, 0, 1, out.sound.sfx);
  const graphics = r.graphics ?? {};
  out.graphics.quality = one(graphics.quality, ['performance', 'balanced', 'ultra'] as const, out.graphics.quality);
  out.graphics.post = bool(graphics.post, out.graphics.post);
  const a11y = r.a11y ?? {};
  out.a11y.reduceMotion = bool(a11y.reduceMotion, out.a11y.reduceMotion);
  out.a11y.uiScale = one(a11y.uiScale, ['compact', 'normal', 'large'] as const, out.a11y.uiScale);
  return out;
}

function firstRunQuality(): Settings {
  const s = sanitize(null);
  // A phone earns performance on day one: small screen, weak GPU, no fan. A stored
  // choice always wins — this only decides the very first boot.
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const small = Math.min(screen.width, screen.height) < 500;
    const thin = (navigator as { deviceMemory?: number }).deviceMemory !== undefined && (navigator as { deviceMemory?: number }).deviceMemory! < 4;
    if (coarse && (small || thin)) s.graphics.quality = 'performance';
  } catch {
    /* headless: balanced */
  }
  return s;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return firstRunQuality();
    return sanitize(JSON.parse(raw) as unknown);
  } catch {
    return sanitize(null);
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode or quota: options still apply live for this session.
  }
}

export function getSettings(): Settings {
  return current;
}

/** One-liner for render code that only cares about the motion flag. */
export function reduceMotion(): boolean {
  return current.a11y.reduceMotion;
}

export function updateSettings(mut: (draft: Settings) => void): Settings {
  mut(current);
  current = sanitize(current);
  save();
  for (const fn of listeners) fn();
  return current;
}

export function resetSettings(): Settings {
  current = sanitize(null);
  save();
  for (const fn of listeners) fn();
  return current;
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
