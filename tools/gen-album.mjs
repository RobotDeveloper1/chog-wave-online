#!/usr/bin/env node
/**
 * Generate `shared/src/albumData.ts` from `.data/traits.json`.
 *
 * The Album is the collection itself used as a checklist, so its universe has to be
 * the real trait list rather than something typed by hand and quietly drifted. The
 * source also carries a per-value count, which is what makes "rare sighting worth
 * more XP" a measurement instead of a guess.
 *
 *   node tools/gen-album.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, '.data', 'traits.json');
const out = join(root, 'shared', 'src', 'albumData.ts');

if (!existsSync(src)) {
  console.error(`missing ${src}`);
  process.exit(1);
}

const traits = JSON.parse(readFileSync(src, 'utf8'));
const lines = [
  "import type { AlbumUniverse } from './album.ts';",
  '',
  '/**',
  ' * The collection as a checklist, lifted verbatim from `.data/traits.json`.',
  ' * Each value carries how many tokens in the scanned sample wear it, which is the',
  ' * rarity signal the Album pays out on. Generated — edit the JSON and re-run',
  ' * `node tools/gen-album.mjs`, not this file.',
  ' */',
  'export const ALBUM_UNIVERSE: AlbumUniverse = {',
];

let total = 0;
let sample = 0;
for (const [cat, info] of Object.entries(traits)) {
  const values = Array.isArray(info) ? info : info.values;
  if (!values || typeof values !== 'object') throw new Error(`no value list for ${cat}`);
  const entries = Object.entries(values);
  if (Number(info?.distinct) !== entries.length) {
    console.warn(`warning: ${cat} declares distinct=${info.distinct} but lists ${entries.length}`);
  }
  total += entries.length;
  const sum = entries.reduce((s, [, n]) => s + Number(n), 0);
  sample = Math.max(sample, sum);
  const body = entries.map(([v, n]) => `${JSON.stringify(String(v))}: ${Number(n)}`).join(', ');
  lines.push(`  ${JSON.stringify(cat)}: { ${body} },`);
}

lines.push('};', '');
lines.push('export const ALBUM_CATEGORIES = Object.keys(ALBUM_UNIVERSE) as (keyof AlbumUniverse)[];', '');
lines.push(`export const ALBUM_TOTAL = ${total};`, '');
lines.push('/** How many tokens the frequency counts were taken over. */');
lines.push(`export const ALBUM_SAMPLE = ${sample};`, '');

writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`wrote ${out}: ${total} values across ${Object.keys(traits).length} categories, sample ${sample}`);
