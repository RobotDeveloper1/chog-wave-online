/**
 * Drives one boss from full health to death and reports which attack phases
 * actually played. The phase formula silently capped at 3 once, and nothing else
 * in the suite would notice — the client only reads whatever the server says.
 *
 *   node tools/phase-check.mjs
 */
import { WebSocket } from 'ws';

const URL = process.env.WS ?? 'ws://localhost:8787/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(URL);
let me = null;
let sector = null;
const phases = new Set();
let boss = null;
let closed = false;

const send = (body) => {
  if (!closed && ws.readyState === ws.OPEN) ws.send(JSON.stringify(body));
};

ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.t === 'welcome') me = m.you;
  // The world broadcast flattens the snapshot onto the message, so sectors sit
  // at m.sectors rather than m.world.sectors.
  if (m.t === 'world') {
    const s = (m.sectors ?? []).find((x) => x.sector === sector);
    if (!s) return;
    if (s.boss) {
      boss = s.boss;
      phases.add(s.boss.phase);
    }
  }
};
ws.onclose = () => {
  closed = true;
};

await new Promise((r) => ws.on('open', r));

// Take the hottest sector that has a boss; storm is the one worth testing.
send({ t: 'join', tokenId: 1, sector: 'ashflat' });
await sleep(400);
let probe = await fetch('http://localhost:8787/api/world').then((r) => r.json());
sector = (probe.sectors.find((s) => s.boss) ?? {}).sector;
for (let i = 0; !sector && i < 6; i++) {
  await fetch('http://localhost:8787/api/dev/surge?n=12', { method: 'POST' });
  await sleep(1200);
  probe = await fetch('http://localhost:8787/api/world').then((r) => r.json());
  sector = (probe.sectors.find((s) => s.boss) ?? {}).sector;
}
if (!sector) {
  console.error('no boss to test against — is the server up?');
  process.exit(2);
}
// Read the target off the probe rather than the socket: `sector` is still null
// while the first broadcasts are arriving, so nothing has been captured yet.
const target = probe.sectors.find((x) => x.sector === sector);
console.log(`boss sector: ${sector} tier=${target.boss.tier} hp=${target.boss.hp}`);

send({ t: 'switch', sector });
await sleep(300);

const prog = me.build.library.slice(0, me.build.linkSlots).map((chipId, i) => ({ chipId, row: i, col: 0 }));
for (let i = 0; i < 40 && boss && boss.hp > 0; i++) {
  send({ t: 'fire', sector, placements: prog });
  await sleep(150);
}

const seen = [...phases].sort((a, b) => a - b);
console.log(`phases observed: ${seen.join(', ') || 'none'}`);
ws.close();

if (!seen.includes(4)) {
  console.error('FAIL: phase 4 never played');
  process.exit(1);
}
console.log('PASS: boss escalated through all four phases');
