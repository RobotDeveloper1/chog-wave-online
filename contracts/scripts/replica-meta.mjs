import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = join(root, '.data', 'metadata');
const outDir = join(root, '.data', 'metadata-testnet');

/**
 * Give the testnet replica real faces.
 *
 * Usage: node scripts/replica-meta.mjs <mainnetId> [<mainnetId> ...]
 *
 * The first mainnet id becomes testnet #1, the second #2, and so on — the
 * same order `deploy.mjs` mints in, so testnet #N wears mainnet <id>'s
 * traits. Only the `name` is rewritten (`CHOG #<mainnetId>` → `CHOG #<N>`);
 * the attributes travel untouched, because the trait index keys by the real
 * id in `name` and the filename is only where the file lives.
 *
 * Nothing on mainnet is touched. Files land in `.data/metadata-testnet`,
 * which the server reads instead of `.data/metadata` whenever
 * CHOG_GENESIS_CONTRACT points at the replica.
 */

const wanted = process.argv.slice(2).map(Number);
if (!wanted.length || wanted.some((n) => !Number.isInteger(n) || n < 1)) {
  console.error('usage: node scripts/replica-meta.mjs <mainnetId> [<mainnetId> ...]');
  console.error('example: node scripts/replica-meta.mjs 1462 88 1204   (become testnet #1 #2 #3)');
  process.exit(1);
}

let files;
try {
  files = readdirSync(srcDir).filter((f) => f.endsWith('.json'));
} catch {
  console.error(`no local mainnet metadata at ${srcDir}`);
  process.exit(1);
}
const byRealId = new Map();
for (const f of files) {
  try {
    const doc = JSON.parse(readFileSync(join(srcDir, f), 'utf8'));
    const m = /#\s*(\d+)/.exec(doc.name ?? '');
    if (m) byRealId.set(Number(m[1]), doc);
  } catch { /* unreadable file: skipped like the server skips it */ }
}

mkdirSync(outDir, { recursive: true });
const artDir = join(root, '.data', 'art');
const artOutDir = join(root, '.data', 'art-testnet');
mkdirSync(artOutDir, { recursive: true });
wanted.forEach((mainnetId, i) => {
  const testnetId = i + 1;
  const doc = byRealId.get(mainnetId);
  if (!doc) {
    console.error(`mainnet #${mainnetId} has no local metadata — nothing written, fix the list and re-run.`);
    process.exit(1);
  }
  const copy = { ...doc, name: `CHOG #${testnetId}` };
  // The face travels with the traits: testnet #N shows mainnet <id>'s art.
  const srcPng = join(artDir, `${mainnetId}.png`);
  if (existsSync(srcPng)) copyFileSync(srcPng, join(artOutDir, `${testnetId}.png`));
  else console.log(`  (no local art for mainnet #${mainnetId} — run: node tools/fetch-art.mjs ${mainnetId})`);
  writeFileSync(join(outDir, `${testnetId}.json`), JSON.stringify(copy, null, 2));
  const cats = (doc.attributes ?? []).map((a) => `${a.trait_type}=${a.value}`).slice(0, 4).join(' ');
  console.log(`testnet #${testnetId} <- mainnet #${mainnetId}  (${cats}…)`);
});
console.log(`${wanted.length} trait file(s) in ${outDir} — mint at least ${wanted.length} (MINT_COUNT=${wanted.length})`);
