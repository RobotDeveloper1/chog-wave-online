// Runs the build formula over whatever Chog metadata is on disk and prints the
// resulting attribute profiles, so the formula can be argued with using numbers
// rather than adjectives.
//   node --experimental-strip-types tools/formula-report.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { deriveBuild } from '../shared/src/derive.ts';
import { ATTRS } from '../shared/src/formula.ts';

const dir = '.data/metadata';
const rows = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  let meta;
  try {
    meta = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
  } catch {
    continue;
  }
  const attrs = meta?.attributes;
  if (!attrs?.length) continue;
  // The tokenURI is shuffled, so the real id is only in `name`.
  const id = Number(String(meta.name ?? '').replace(/\D/g, '')) || 1;
  const map = Object.fromEntries(attrs.map((a) => [a.trait_type, a.value]));
  const build = deriveBuild({
    tokenId: id,
    transferCount: id % 14,
    daysHeld: (id * 7) % 400,
    attributes: map,
  });
  rows.push({
    id,
    tier: String(map.Tier ?? '-'),
    tribe: build.loadout.element,
    weak: build.loadout.weakness,
    sig: build.loadout.signature ?? '-',
    ...build.attrs,
    aff: build.waveAffinity,
    clean: build.cleanSignal,
    ceiling: build.cleanCeiling,
    deck: build.library.length,
    grid: build.linkSlots,
  });
}

rows.sort((a, b) => b.id - a.id);
console.log(`tokens evaluated: ${rows.length}\n`);

const header = 'id      tier        tribe  weak   ' + ATTRS.map((a) => a.padStart(3)).join(' ') + '  aff   clean  cap  deck grid';
console.log(header);
const show = (r) =>
  String(r.id).padEnd(8) +
  r.tier.padEnd(12) +
  r.tribe.padEnd(6) +
  r.weak.padEnd(6) +
  ATTRS.map((a) => String(r[a]).padStart(3)).join(' ') +
  `  ${r.aff.toFixed(2)}  ${r.clean.toFixed(2)}  ${r.ceiling.toFixed(2)} ${String(r.deck).padStart(4)} ${String(r.grid).padStart(4)}`;

for (const tier of ['Legendary', 'Epic', 'Rare', 'Uncommon', 'Common']) {
  const one = rows.find((r) => r.tier === tier);
  if (one) console.log(show(one));
}
console.log('  …');
for (const r of rows.slice(0, 4)) console.log(show(r));

const budgetBy = {};
for (const r of rows) {
  const sum = ATTRS.reduce((s, a) => s + r[a], 0);
  const g = (budgetBy[r.tier] ??= { n: 0, sum: 0, max: 0 });
  g.n += 1;
  g.sum += sum;
  g.max = Math.max(g.sum === sum ? g.max : g.max, ...ATTRS.map((a) => r[a]));
}
console.log('\ntier          tokens   avg budget   single-attr ceiling');
for (const [t, g] of Object.entries(budgetBy)) {
  console.log(`  ${t.padEnd(12)} ${String(g.n).padStart(4)}   ${(g.sum / g.n).toFixed(1).padStart(6)}   ${String(g.max).padStart(4)}`);
}

const distinct = new Set(rows.map((r) => ATTRS.map((a) => r[a]).join(',')));
console.log(`\ndistinct attribute profiles across ${rows.length} tokens: ${distinct.size}`);
console.log(`decks of differing size: ${new Set(rows.map((r) => r.deck)).size}`);
console.log(`tribes present: ${[...new Set(rows.map((r) => r.tribe))].sort().join(', ')}`);
console.log(`held signature cards present: ${[...new Set(rows.map((r) => r.sig))].sort().join(', ')}`);
