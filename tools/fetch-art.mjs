/**
 * Download the real Chog Genesis artwork for a set of tokens.
 *
 * Two hops, both plain HTTP, no API key and no browser:
 *   1. GET the OpenSea item page. The RSC payload embeds the canonical CDN url
 *      (i2c.seadn.io/monad/<contract>/<h1>/<h2>.webp).
 *   2. GET that url with ?w=<size>.
 *
 * The tempting shortcut that does NOT work: /opengraph-image returns OpenSea's
 * generated social card (name, price, blurred backdrop) — not the artwork. Every
 * token looks identical through it. Verified the hard way.
 *
 * IPFS is also not an option: every public gateway 429s within minutes.
 *
 *   node tools/fetch-art.mjs 1 100 186
 *   node tools/fetch-art.mjs --from-refs      # one token per trait value
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CONTRACT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
const OUT = '.data/art';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const WIDTH = 800;
const CONC = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bigEnough(p, min = 20000) {
  try {
    const s = await stat(p);
    return s.size > min;
  } catch {
    return false;
  }
}

/** Pull the canonical CDN url out of the server-rendered page. */
function extractCdnUrl(html) {
  const flat = html.replace(/\\\//g, '/');
  const re = new RegExp(
    `https://i\\dc\\.seadn\\.io/monad/${CONTRACT}/[0-9a-f]{20,}/[0-9a-f]{20,}\\.webp`,
    'i',
  );
  const m = flat.match(re);
  return m ? `${m[0]}?w=${WIDTH}` : null;
}

async function fetchOne(id) {
  const png = join(OUT, `${id}.png`);
  if (await bigEnough(png)) return 'cached';

  let cdn = null;
  for (let a = 0; a < 3 && !cdn; a++) {
    try {
      const r = await fetch(`https://opensea.io/item/monad/${CONTRACT}/${id}`, {
        headers: { 'user-agent': UA, accept: 'text/html' },
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429) {
        await sleep(5000 * (a + 1));
        continue;
      }
      if (!r.ok) return `page${r.status}`;
      cdn = extractCdnUrl(await r.text());
    } catch {
      await sleep(2000 * (a + 1));
    }
  }
  if (!cdn) return 'noimg';

  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(cdn, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) {
        await sleep(3000 * (a + 1));
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const isWebp = buf.length > 20 && buf.subarray(0, 4).toString('ascii') === 'RIFF'
        && buf.subarray(8, 12).toString('ascii') === 'WEBP';
      if (!isWebp) return 'badimg';
      await writeFile(join(OUT, `${id}.webp`), buf);
      return 'webp';
    } catch {
      await sleep(2000 * (a + 1));
    }
  }
  return 'imgfail';
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const args = process.argv.slice(2);
  let ids;
  if (args.includes('--from-refs')) {
    const refs = JSON.parse(await readFile('.data/trait-refs.json', 'utf8'));
    ids = [...new Set(refs.sheets.flat().map((e) => e.id))];
  } else {
    ids = args.map(Number).filter(Number.isFinite);
  }
  if (!ids.length) {
    console.error('give token ids, or --from-refs');
    process.exit(1);
  }

  const queue = [...ids];
  const tally = {};
  let done = 0;

  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      const res = await fetchOne(id);
      tally[res] = (tally[res] ?? 0) + 1;
      if (++done % 25 === 0) console.log(`  ${done}/${ids.length} ${JSON.stringify(tally)}`);
      await sleep(700);
    }
  };

  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(`fetch done: ${JSON.stringify(tally)}`);
  console.log('webp files still need converting: node tools/convert-art.mjs');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
