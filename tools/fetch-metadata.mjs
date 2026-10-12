/**
 * One-time backfill of Chog Genesis metadata.
 *
 * tokenURI is SHUFFLED on-chain (id 1 -> 1462.json), so baseURI + id + ".json"
 * silently returns the WRONG Chog. Every id must be resolved through tokenURI().
 *
 *   node tools/fetch-metadata.mjs            # full collection
 *   node tools/fetch-metadata.mjs --limit 50 # smoke test
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const RPCS = ['https://rpc2.monad.xyz', 'https://rpc.monad.xyz', 'https://rpc-mainnet.monadinfra.com'];
const NFT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
const SUPPLY = 1969;
const GATEWAYS = ['https://gateway.pinata.cloud/ipfs/', 'https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/'];
const TOKEN_URI_SEL = '0xc87b56dd';

const OUT = '.data/metadata';
const args = process.argv.slice(2);
const limit = Number(args.find((a) => a.startsWith('--limit'))?.split(' ')[1] ?? args[args.indexOf('--limit') + 1] ?? SUPPLY);

const decodeStr = (hex) => {
  const off = 64;
  const len = Number(BigInt('0x' + hex.slice(2 + off, 2 + off + 64)));
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(hex.slice(2 + off + 64 + i * 2, 2 + off + 64 + i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
};

async function rpcBatch(method, params) {
  for (const rpc of RPCS) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params.map((p, i) => ({ jsonrpc: '2.0', id: i, method, params: p }))),
      });
      const j = await r.json();
      if (Array.isArray(j)) return j.sort((a, b) => a.id - b.id).map((x) => x.result);
      return [j.result];
    } catch {
      continue;
    }
  }
  throw new Error('all rpcs failed');
}

async function resolveUris(ids) {
  const map = new Map();
  const CHUNK = 50;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const calls = slice.map((id) => [{ to: NFT, data: TOKEN_URI_SEL + BigInt(id).toString(16).padStart(64, '0') }, 'latest']);
    const res = await rpcBatch('eth_call', calls);
    res.forEach((hex, k) => {
      if (!hex || hex === '0x') return;
      try {
        map.set(slice[k], decodeStr(hex));
      } catch {
        /* revert */
      }
    });
    if (i % 400 === 0) console.log(`  tokenURI ${i + slice.length}/${ids.length}`);
  }
  return map;
}

async function fetchJson(url, tries = 3) {
  for (let g = 0; g < GATEWAYS.length; g++) {
    for (let t = 0; t < tries; t++) {
      try {
        const r = await fetch(GATEWAYS[g] + url, { signal: AbortSignal.timeout(20000) });
        if (r.status === 429) {
          await new Promise((s) => setTimeout(s, 1200 * (t + 1)));
          continue;
        }
        if (!r.ok) break;
        return await r.json();
      } catch {
        await new Promise((s) => setTimeout(s, 600 * (t + 1)));
      }
    }
  }
  return null;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const ids = Array.from({ length: Math.min(limit, SUPPLY) }, (_, i) => i + 1);
  const missing = ids.filter((id) => !existsSync(join(OUT, `${id}.json`)));
  console.log(`${ids.length} ids, ${missing.length} to fetch`);

  const index = existsSync(join(OUT, 'index.json'))
    ? JSON.parse(await readFile(join(OUT, 'index.json'), 'utf8'))
    : {};

  if (missing.length) {
    console.log('resolving tokenURI on-chain...');
    const uris = await resolveUris(missing);
    console.log(`resolved ${uris.size} uris (shuffled mapping applied)`);

    let done = 0;
    let failed = 0;
    const queue = missing.filter((id) => uris.has(id));
    const CONC = 6;

    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        const cid = uris.get(id).replace(/^ipfs:\/\//, '');
        const meta = await fetchJson(cid);
        if (meta) {
          await writeFile(join(OUT, `${id}.json`), JSON.stringify(meta));
          index[id] = cid;
          done++;
        } else failed++;
        if ((done + failed) % 100 === 0) console.log(`  ${done + failed}/${queue.length + done + failed} ok=${done} fail=${failed}`);
      }
    };
    await Promise.all(Array.from({ length: CONC }, worker));
    await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 0));
    console.log(`fetched ok=${done} fail=${failed}`);
  }

  const traits = {};
  let counted = 0;
  for (const id of ids) {
    const file = join(OUT, `${id}.json`);
    if (!existsSync(file)) continue;
    const m = JSON.parse(await readFile(file, 'utf8'));
    counted++;
    for (const a of m.attributes ?? []) {
      traits[a.trait_type] ??= {};
      traits[a.trait_type][a.value] = (traits[a.trait_type][a.value] ?? 0) + 1;
    }
  }

  const summary = Object.fromEntries(
    Object.entries(traits).map(([k, v]) => [
      k,
      { distinct: Object.keys(v).length, values: Object.fromEntries(Object.entries(v).sort((a, b) => b[1] - a[1])) },
    ]),
  );
  await writeFile('.data/traits.json', JSON.stringify(summary, null, 2));
  console.log(`\nmetadata read: ${counted}`);
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(12)} ${String(v.distinct).padStart(4)} values`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
