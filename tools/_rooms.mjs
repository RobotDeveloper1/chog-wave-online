import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('C:/Users/Kauker/Desktop/chog/node_modules/ws/index.js');
const URL = 'ws://localhost:8800/ws';
const open = (t) => new Promise((res, rej) => {
  const ws = new WebSocket(URL);
  const timer = setTimeout(() => rej(new Error('timeout')), 15000);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', tokenId: t, sector: 'ashflat' })));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'rejected') { clearTimeout(timer); rej(new Error(m.reason)); }
    if (m.t === 'welcome') { clearTimeout(timer); res({ ws, you: m.you, world: m.world }); }
  });
  ws.on('error', rej);
});
const read = (ws) => new Promise((res) => {
  const timer = setTimeout(() => res(null), 6000);
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.t === 'world') { clearTimeout(timer); res(m); } });
});
const a = await open(1), b = await open(7);
console.log('A:', JSON.stringify({ tokenId: a.you?.tokenId, sector: a.you?.sector, room: a.you?.room ?? a.world?.room }));
console.log('B:', JSON.stringify({ tokenId: b.you?.tokenId, sector: b.you?.sector, room: b.you?.room ?? b.world?.room }));
const w = await read(b.ws);
console.log('B sees room', w?.room, '->', (w?.players ?? []).map(p => `#${p.tokenId}@${p.x},${p.y}`).join(' | '));
a.ws.close(); b.ws.close();
