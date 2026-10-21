import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CFG, dataFile } from './config.ts';
import { ALBUM_UNIVERSE } from '@chog/shared';

/**
 * The trait index.
 *
 * Two facts make this file necessary rather than trivial:
 *
 * 1. `tokenURI` is shuffled: token id T (what wallets hold) serves metadata file
 *    M (what `name`, traits and art use), and T != M for almost every Chog
 *    (e.g. token 174 -> 1635.json). Local files are metadata-numbered, so every
 *    token-id lookup translates through `.data/token_map.json` first.
 * 2. A token with no local record still has to be playable, and the honest way
 *    to do that is to *predict* its traits from the id and say so out loud in
 *    `source`. With the full collection cached this only triggers for corrupt
 *    records.
 *
 * The testnet replica mints the same ids as mainnet, and a replica id IS its
 * mainnet token: testnet #1 wears token #1's traits (MCGA, BTC Glass, Fwog),
 * not a predicted set and not a copy. So there is exactly one map and one
 * metadata dir, whichever chain the server points at — a second map is how
 * testnet #1 ended up with somebody else's face.
 *
 * Paths are repo-rooted (`dataFile`), not cwd-relative: the server boots with
 * cwd=server/, and a relative `.data/metadata` silently resolves to nothing,
 * which quietly downgrades the whole collection to predicted traits.
 *
 * Everything downstream — the build formula, the Album, the 3D model's colours — reads
 * traits through here, which is the only reason those three cannot disagree.
 */

export interface TokenTraits {
  tokenId: number;
  attributes: Record<string, string>;
  /** `real` came from the collection's own metadata; `predicted` was derived from the id. */
  source: 'real' | 'predicted';
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000019) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REAL_ID = /#\s*(\d+)/;

/** category → value, the shape `loadoutOf` and `deriveBuild` expect. */
function toAttributes(attributes: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(attributes)) return out;
  for (const a of attributes) {
    const trait = a?.trait_type ?? a?.traitType;
    const value = a?.value;
    if (typeof trait === 'string' && value !== undefined && value !== null) {
      out[trait] = String(typeof value === 'object' ? (value as { name?: string }).name ?? '' : value);
    }
  }
  return out;
}

export class TraitIndex {
  /** Metadata number -> attributes. Filenames and `name` agree; the name wins. */
  private byMeta = new Map<number, Record<string, string>>();
  /** Token id -> metadata number. Empty without a map file (identity fallback). */
  private tokenToMeta = new Map<number, number>();

  constructor(dir = dataFile(CFG.metaDir), mapPath: string | null = join(dir, '..', 'token_map.json')) {
    if (mapPath && existsSync(mapPath)) {
      try {
        const raw = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, number>;
        for (const [t, m] of Object.entries(raw)) {
          const ti = Number(t);
          const mi = Number(m);
          if (Number.isInteger(ti) && Number.isInteger(mi)) this.tokenToMeta.set(ti, mi);
        }
        console.log(`[meta] token map: ${this.tokenToMeta.size} pairs`);
      } catch {
        console.warn(`[meta] unreadable token map at ${mapPath} — identity fallback`);
      }
    }
    if (!existsSync(dir)) {
      console.warn(`[meta] no local metadata at ${dir} — every token will be predicted`);
      return;
    }
    let real = 0;
    let skipped = 0;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      let doc: { name?: string; attributes?: unknown };
      try {
        doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        skipped++;
        continue;
      }
      // The filename is the *requested* id; the name is the real one. Trust the name.
      const m = REAL_ID.exec(doc.name ?? '');
      const id = m ? Number(m[1]) : NaN;
      if (!Number.isInteger(id) || id < 1) {
        skipped++;
        continue;
      }
      const attrs = toAttributes(doc.attributes);
      if (!Object.keys(attrs).length) {
        skipped++;
        continue;
      }
      this.byMeta.set(id, attrs);
      real++;
    }
    console.log(`[meta] ${real} metadata records with real traits${skipped ? `, ${skipped} unreadable` : ``}`);
  }

  get size(): number {
    return this.byMeta.size;
  }

  /** Token id -> metadata number. Identity without a map (tests). */
  metaOf(tokenId: number): number {
    return this.tokenToMeta.get(tokenId) ?? tokenId;
  }

  /** Every locally-known token id, so the Album can offer a "browse the collection" list. */
  knownIds(limit = 200): number[] {
    const ids = this.tokenToMeta.size ? [...this.tokenToMeta.keys()] : [...this.byMeta.keys()];
    return ids.sort((a, b) => a - b).slice(0, limit);
  }

  has(tokenId: number): boolean {
    return this.byMeta.has(this.metaOf(tokenId));
  }

  /**
   * Predict a trait set from the id alone. Weighted by the real frequency table, so a
   * predicted Chog is statistically like a real one — `Base: Origin` shows up far more
   * than `Base: 1:1`, exactly as it does on chain.
   */
  predict(tokenId: number): Record<string, string> {
    const rand = mulberry32(fnv1a(`traits:${tokenId}`));
    const out: Record<string, string> = {};
    for (const [cat, table] of Object.entries(ALBUM_UNIVERSE)) {
      const entries = Object.entries(table);
      if (!entries.length) continue;
      const total = entries.reduce((s, [, n]) => s + Number(n), 0) || 1;
      let roll = rand() * total;
      let chosen = entries[0]![0];
      for (const [value, n] of entries) {
        roll -= Number(n);
        if (roll <= 0) {
          chosen = value;
          break;
        }
      }
      out[cat] = chosen;
    }
    return out;
  }

  for(tokenId: number): TokenTraits {
    const real = this.byMeta.get(this.metaOf(tokenId));
    if (real) return { tokenId, attributes: real, source: 'real' };
    return { tokenId, attributes: this.predict(tokenId), source: 'predicted' };
  }
}

/** One map for the process: replica ids are mainnet ids (see the note above). */
export const traits = new TraitIndex();

/** Token id -> metadata number for art/trait lookups (identity without a map). */
export function metaNumberFor(tokenId: number): number {
  return traits.metaOf(tokenId);
}
