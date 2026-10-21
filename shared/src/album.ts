import { ALBUM_CATEGORIES, ALBUM_SAMPLE, ALBUM_TOTAL, ALBUM_UNIVERSE } from './albumData.ts';
import { xpForSighting } from './progress.ts';

/**
 * The trait Album — the collection used as a Pokédex.
 *
 * This is the piece that makes the NFT *essential* rather than cosmetic in the MMO
 * sense: the only entries you are guaranteed are the ones your own token wears, and
 * everything else has to be *seen on someone else*. With 272 values across 13
 * categories and 1,969 tokens, filling it means meeting a lot of holders, which is
 * the standard MMO reason to keep logging in, now sourced from an actual collector
 * base instead of a fictional one.
 *
 * Values carry their real frequency from the scanned sample, so finding a Chog with
 * `Base: 1:1` (1 of 493) pays eight times what a 474-of-493 Origin does. Rarity is
 * measured, not asserted.
 */

export type AlbumUniverse = Record<string, Record<string, number>>;

/** A sighting key is category + value, so "Radioactive" in Background and Base do not collide. */
export const albumKey = (category: string, value: string): string => `${category}:${value}`;

export const ALBUM_UNIVERSE_SIZE = ALBUM_TOTAL;

export function albumCategoryNames(): string[] {
  return ALBUM_CATEGORIES as unknown as string[];
}

/** Everything a token proves just by existing. */
export function keysOfSource(attributes?: Record<string, string>): string[] {
  if (!attributes) return [];
  const out: string[] = [];
  for (const [cat, table] of Object.entries(ALBUM_UNIVERSE)) {
    const raw = attributes[cat];
    if (!raw) continue;
    // Match case-insensitively but store the canonical spelling from the universe.
    const hit = Object.keys(table).find((v) => v.toLowerCase() === String(raw).trim().toLowerCase());
    if (hit) out.push(albumKey(cat, hit));
  }
  return out;
}

export function countOf(key: string): number {
  const [cat, value] = splitKey(key);
  return ALBUM_UNIVERSE[cat]?.[value] ?? 0;
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(':');
  return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)];
}

/** 1 for a value half the collection wears, 8 for a one-of-1969. */
export function rarityWeight(count: number): number {
  if (count <= 0) return 1;
  const w = Math.log2(Math.max(1, ALBUM_SAMPLE / count));
  return Math.max(1, Math.min(8, Math.round(w)));
}

export interface SightResult {
  seen: string[];
  added: string[];
  xp: number;
  /** The rarest thing that walk landed this session, for the tape to announce. */
  best: { key: string; weight: number } | null;
}

/** Fold a Chog's traits into the log. Idempotent: re-meeting costs nothing and pays nothing. */
export function sight(seen: string[], keys: string[]): SightResult {
  const have = new Set(seen);
  const added: string[] = [];
  let xp = 0;
  let best: { key: string; weight: number } | null = null;
  for (const k of keys) {
    if (have.has(k)) continue;
    have.add(k);
    added.push(k);
    const w = rarityWeight(countOf(k));
    xp += xpForSighting(w >= 5) + w;
    if (!best || w > best.weight) best = { key: k, weight: w };
  }
  return { seen: [...have], added, xp, best };
}

export interface CategoryStat {
  category: string;
  have: number;
  need: number;
  pct: number;
  complete: boolean;
}

export interface AlbumStat {
  categories: CategoryStat[];
  have: number;
  need: number;
  pct: number;
  complete: boolean;
  /** Value names still missing from one category, for the "what do I need" panel. */
  gapsFor: (category: string) => string[];
}

export function albumStat(seen: string[]): AlbumStat {
  const have = new Set(seen);
  const categories: CategoryStat[] = (ALBUM_CATEGORIES as string[]).map((cat) => {
    const values = Object.keys(ALBUM_UNIVERSE[cat] ?? {});
    const got = values.filter((v) => have.has(albumKey(cat, v))).length;
    return {
      category: cat,
      have: got,
      need: values.length,
      pct: values.length ? got / values.length : 0,
      complete: got === values.length && values.length > 0,
    };
  });
  const totalHave = categories.reduce((s, c) => s + c.have, 0);
  const totalNeed = categories.reduce((s, c) => s + c.need, 0);
  return {
    categories,
    have: totalHave,
    need: totalNeed,
    pct: totalNeed ? totalHave / totalNeed : 0,
    complete: totalHave === totalNeed,
    gapsFor: (category: string) =>
      Object.keys(ALBUM_UNIVERSE[category] ?? {}).filter((v) => !have.has(albumKey(category, v))),
  };
}

/**
 * Category completions pay a card, which is the only way to own a card without
 * holding the Chog that grants it — a deliberate pressure valve: the Album is a
 * path for players with no NFT, but it is a *slow* one, so holding the token still
 * matters more.
 */
const CATEGORY_PRIZE: Record<string, string> = {
  Aura: 'chognova',
  Background: 'spectrum',
  Base: 'stormchomp',
  Body: 'glacierhowl',
  Eyes: 'arcsnap',
  Form: 'rimeclaw',
  Head: 'ripplebite',
  Mouth: 'staticnip',
  Naked: 'refract',
  Side: 'undertow',
  Skin: 'cinderfang',
  Tier: 'tsunamichog',
  Accessory: 'eclipse',
};

export function categoryPrize(category: string): string | null {
  return CATEGORY_PRIZE[category] ?? null;
}

/** Entries claimed already, so a completion pays once and not again on reload. */
export interface AlbumState {
  seen: string[];
  claimed: string[];
}

export function emptyAlbum(): AlbumState {
  return { seen: [], claimed: [] };
}

export interface Completion {
  category: string;
  card: string | null;
  wav: number;
}

/** Which categories just became complete and are not yet paid out. */
export function pendingCompletions(state: AlbumState): Completion[] {
  const stat = albumStat(state.seen);
  return stat.categories
    .filter((c) => c.complete && !state.claimed.includes(c.category))
    .map((c) => ({ category: c.category, card: categoryPrize(c.category), wav: 120 + c.need * 6 }));
}

export function markClaimed(state: AlbumState, categories: string[]): AlbumState {
  return { ...state, claimed: [...new Set([...state.claimed, ...categories])] };
}

/** The rank the Album drives, shown in the roster so collecting is visible to others. */
export function albumRank(seen: string[]): { title: string; pct: number } {
  const pct = albumStat(seen).pct;
  const title =
    pct >= 1 ? 'CURATOR OF THE LINEAGE'
    : pct >= 0.6 ? 'TRIBE CARTOGRAPHER'
    : pct >= 0.35 ? 'FIELD SURVEYOR'
    : pct >= 0.15 ? 'WAVE TOURIST'
    : pct > 0 ? 'FIRST CONTACT'
    : 'UNKNOWN SIGNAL';
  return { title, pct };
}
