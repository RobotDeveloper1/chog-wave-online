/**
 * Asks the world snapshot one question: does a *stranger's* row carry enough to build their Chog?
 *
 * A remote avatar is only as good as the row the server puts in `players`. The renderer used to
 * build every visitor in an empty trait bag, so the street filled with the base mesh — but that is
 * half the story: if the snapshot itself drops `attributes` and `tokenId`, no client can do better.
 *
 * This joins two tokens at once and prints exactly what the snapshot hands the *other* client for
 * each of them, so the fix is settled on both sides of the wire rather than assumed.
 *
 * node tools/probe-remotes.mjs [wsUrl] [tokenA] [tokenB] [room]
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('C:/Users/Kauker/Desktop/chog/node_modules/ws/index.js');

const URL = process.argv[2] ?? 'ws://localhost:8800/ws';
const A = Number(process.argv[3] ?? 1);
const B = Number(process.argv[4] ?? 7);

const open = (tokenId) => new Promise((resolve, reject) => {
  const ws = new WebSocket(URL);
  const timer = setTimeout(() => reject(new Error(`token ${tokenId}: no welcome in 15s`)), 15_000);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', tokenId, sector: 'ashflat' })));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'rejected') { clearTimeout(timer); reject(new Error(`token ${tokenId} rejected: ${m.reason}`)); }
    if (m.t === 'welcome') { clearTimeout(timer); resolve({ ws, welcome: m }); }
    if (m.t === 'world') resolve.__catch_world ??= null;
  });
  ws.on('error', (e) => { clearTimeout(timer); reject(e); });
});

const readWorld = (ws, timeoutMs = 8000) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), timeoutMs);
  const on = (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'world') { clearTimeout(timer); ws.off('message', on); resolve(m); }
  };
  ws.on('message', on);
});

const a = await open(A);
const b = await open(B);
console.log(`joined A=#${a.welcome.you?.tokenId} (${a.welcome.signin?.as})  B=#${b.welcome.you?.tokenId} (${b.welcome.signin?.as})`);

// B is the observer: what does B's snapshot say about A?
const seen = await readWorld(b.ws);
const rows = (seen?.players ?? []).map((p) => ({
  id: p.id, tokenId: p.tokenId, name: p.name, level: p.level, tribe: p.tribe,
  keys: Object.keys(p).sort().join(','),
  attributes: p.attributes ?? null,
  nAttrs: p.attributes ? Object.keys(p.attributes).length : 0,
}));

console.log(`\nsnapshot rows: ${rows.length} (B sees ${rows.filter((r) => r.id !== b.welcome.you?.id).length} other player(s))`);
for (const r of rows) {
  console.log(`\n  id=${r.id} token=#${r.tokenId} name=${r.name} lvl=${r.level} tribe=${r.tribe}`);
  console.log(`  keys: ${r.keys}`);
  console.log(`  attributes: ${r.nAttrs ? JSON.stringify(r.attributes) : 'MISSING'}`);
}

const other = rows.find((r) => r.id !== b.welcome.you?.id);
const verdict = other && other.nAttrs > 0 && other.tokenId > 0
  ? `PASS — the snapshot carries ${other.nAttrs} traits and token #${other.tokenId}, so the avatar can be built in their own identity.`
  : 'FAIL — the snapshot row cannot identify this player, so every visitor renders as the base Chog.';
console.log(`\n${verdict}`);

a.ws.close(); b.ws.close();
