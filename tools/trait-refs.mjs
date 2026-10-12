/**
 * Builds the trait reference manifest: one representative token per distinct
 * (trait_type, value) pair. ~150 entries, not 1969 — the unit of work is the
 * trait, so the unit of reference should be too.
 *
 *   node tools/trait-refs.mjs > .data/trait-refs.json
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.data/metadata';
const ART = '.data/art';
const SHEET_SIZE = 16;

if (!existsSync(DIR)) {
  console.error('run tools/fetch-metadata.mjs first');
  process.exit(1);
}

const ids = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => Number(f.replace('.json', '')))
  .sort((a, b) => a - b);

/** value -> best token id holding it */
const best = new Map();

for (const id of ids) {
  const meta = JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8'));
  for (const a of meta.attributes ?? []) {
    const key = `${a.trait_type}:${a.value}`;
    if (best.has(key)) continue;
    best.set(key, { id, category: a.trait_type, value: a.value });
  }
}

const entries = [...best.values()].sort(
  (x, y) => x.category.localeCompare(y.category) || x.value.localeCompare(y.value),
);

const withArt = entries.filter((e) => existsSync(join(ART, `${e.id}.png`)));
const missing = entries.length - withArt.length;

// Sheet over every trait, not just the ones already downloaded — filtering here
// made --from-refs unable to ever request the missing ones.
const sheets = [];
for (let i = 0; i < entries.length; i += SHEET_SIZE) {
  sheets.push(entries.slice(i, i + SHEET_SIZE));
}

writeFileSync(
  '.data/trait-refs.json',
  JSON.stringify({ total: entries.length, withArt: withArt.length, missing, sheets }, null, 2),
);

const byCat = {};
for (const e of entries) byCat[e.category] = (byCat[e.category] ?? 0) + 1;
console.log(`traits: ${entries.length} distinct values across ${Object.keys(byCat).length} categories`);
for (const [k, v] of Object.entries(byCat)) console.log(`  ${k.padEnd(11)} ${v}`);
console.log(`art ready: ${withArt.length} · missing: ${missing} · sheets: ${sheets.length}`);
