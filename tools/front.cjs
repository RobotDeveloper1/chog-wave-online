// Brings the tab at index TAB (default 0) to the front of its window, so a hidden page starts running
// its animation frames again. Used when a visual check needs the scene to keep moving.
//   TAB=1 node tools/front.cjs
const http = require('http');
const PORT = 9333;

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let s = '';
      r.on('data', (d) => (s += d));
      r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const pages = (await getJson('/json')).filter((t) => t.type === 'page');
  const p = pages[Number(process.env.TAB || 0)];
  if (!p) throw new Error('no page');
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  let id = 0;
  const waits = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waits.has(d.id)) { const w = waits.get(d.id); waits.delete(d.id); d.error ? w.rej(new Error(JSON.stringify(d.error))) : w.res(d.result); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waits.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const v = await send('Runtime.evaluate', { expression: 'document.visibilityState + " focus=" + document.hasFocus()', returnByValue: true });
  console.log('visibility:', v.result.value);
  ws.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
