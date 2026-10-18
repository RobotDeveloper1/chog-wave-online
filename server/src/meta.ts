import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CFG } from './config.ts';
import { ALBUM_UNIVERSE, CHOG_GENESIS_ADDRESS } from '@chog/shared';

/**
 * The trait index.
 *
 * Two facts make this file necessary rather than trivial:
 *
 * 1. `tokenURI` is shuffled. `.data/metadata/<X>.json` is named after the *requested*
 *    number, and only the `name` field carries the real id — keying by filename gives
 *    every player the wrong Chog, silently.
 * 2. Only part of the collection is cached locally, and the public IPFS gateways that
 *    would fill the rest are rate-limited to unusable. So a token with no local record
 *    still has to be playable, and the honest way to do that is to *predict* its
 *    traits from the id and say so out loud in `source`.
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
  private byToken = new Map<number, Record<string, string>>();

  constructor(dir = CFG.metaDir) {
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
      this.byToken.set(id, attrs);
      real++;
    }
    console.log(`[meta] ${real} tokens with real traits${skipped ? `, ${skipped} unreadable` : ''}`);
  }

  get size(): number {
    return this.byToken.size;
  }

  /** Every locally-known id, so the Album can offer a "browse the collection" list. */
  knownIds(limit = 200): number[] {
    return [...this.byToken.keys()].sort((a, b) => a - b).slice(0, limit);
  }

  has(tokenId: number): boolean {
    return this.byToken.has(tokenId);
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
    const real = this.byToken.get(tokenId);
    if (real) return { tokenId, attributes: real, source: 'real' };
    return { tokenId, attributes: this.predict(tokenId), source: 'predicted' };
  }
}

/**
 * Which map the world reads. The replica's ids start at 1, exactly where
 * mainnet's do, so sharing one map would hand testnet #1 mainnet #1's face.
 * The contract address is fixed before boot (the server restarts to switch
 * chains), so choosing here, once, cannot drift mid-session.
 */
function traitDir(): string {
  const contract = (process.env.CHOG_GENESIS_CONTRACT ?? '').toLowerCase();
  if (contract && contract !== CHOG_GENESIS_ADDRESS.toLowerCase()) return CFG.metaTestnetDir;
  return CFG.metaDir;
}

export const traits = new TraitIndex(traitDir());
