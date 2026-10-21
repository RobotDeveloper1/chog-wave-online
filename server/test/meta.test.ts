import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TraitIndex } from '../src/meta.ts';

/**
 * The trait index keys by the real id in `name`, never the filename — mainnet
 * tokenURIs are shuffled, so the filename is where a file lives, not who it
 * is. Replica ids are mainnet ids, so the one map serves both chains.
 */

function dirWith(docs: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'chog-meta-'));
  for (const [file, doc] of Object.entries(docs)) {
    writeFileSync(join(dir, file), typeof doc === 'string' ? doc : JSON.stringify(doc));
  }
  return dir;
}

describe('trait index', () => {
  it('trusts the name, not the filename', () => {
    const dir = dirWith({
      '1.json': { name: 'CHOG #1462', attributes: [{ trait_type: 'Skin', value: 'Pink' }] },
    });
    try {
      const idx = new TraitIndex(dir);
      expect(idx.for(1462)).toMatchObject({ source: 'real', attributes: { Skin: 'Pink' } });
      expect(idx.for(1).source).toBe('predicted');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('predicts honestly when nothing is on disk, and skips the unreadable', () => {
    const dir = dirWith({
      'broken.json': 'not json{{{',
      'empty.json': { name: 'CHOG #5', attributes: [] },
      'noname.json': { name: 'no number here', attributes: [{ trait_type: 'Skin', value: 'x' }] },
    });
    try {
      const idx = new TraitIndex(dir);
      expect(idx.size).toBe(0);
      const p = idx.for(5);
      expect(p.source).toBe('predicted');
      expect(Object.keys(p.attributes).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('translates shuffled token ids through the token map', () => {
    const dir = dirWith({
      '1635.json': { name: 'CHOG #1635', attributes: [{ trait_type: 'Skin', value: 'Pink' }] },
    });
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ '174': 1635 }));
    try {
      const idx = new TraitIndex(dir, mapPath);
      // No 174.json exists: token 174 resolves only via the map.
      expect(idx.for(174)).toMatchObject({ source: 'real', attributes: { Skin: 'Pink' } });
      expect(idx.has(174)).toBe(true);
      expect(idx.knownIds()).toEqual([174]);
      expect(idx.for(999).source).toBe('predicted');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
