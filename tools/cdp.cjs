// A tiny CDP client for a headless Edge started with --remote-debugging-port=9333.
//   node cdp.cjs launch                      start Edge (background) and wait for the port
//   node cdp.cjs nav <url> [w] [h]           open the url (resets the viewport)
//   node cdp.cjs eval "<js>"                 evaluate in the page (async body; `return` to give a value)
//   node cdp.cjs shot <file.png> [w] [h]     screenshot the viewport
//   node cdp.cjs kill                        close the browser
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 9333;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = path.join(process.env.TEMP || '.', 'chog-edge-profile');
const NL = String.fromCharCode(10);

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let s = '';
      r.on('data', (d) => (s += d));
      r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

async function page() {
  const list = await getJson('/json');
  const pages = list.filter((t) => t.type === 'page');
  // PAGE_ID picks a tab by its id, which does not move when other tabs open or close; TAB is the list index
  const p = process.env.PAGE_ID ? pages.find((t) => t.id === process.env.PAGE_ID) : pages[Number(process.env.TAB || 0)];
  if (!p) throw new Error('no page');
  return p;
}

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    let id = 0;
    const waits = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && waits.has(d.id)) { const w = waits.get(d.id); waits.delete(d.id); d.error ? w.rej(new Error(JSON.stringify(d.error))) : w.res(d.result); }
    };
    ws.onopen = () => res({
      send: (method, params = {}) => new Promise((rs, rj) => { const i = ++id; waits.set(i, { res: rs, rej: rj }); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => ws.close(),
    });
    ws.onerror = (e) => rej(e);
  });
}

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'launch') {
    try { await getJson('/json/version'); console.log('already running'); return; } catch (e) { /* not yet */ }
    const child = spawn(EDGE, [
      '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', 'about:blank',
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 60; i++) {
      try { await getJson('/json/version'); console.log('up'); return; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
    }
    throw new Error('edge did not start');
  }
  if (cmd === 'kill') {
    try { const c2 = await connect((await getJson('/json/version')).webSocketDebuggerUrl); await c2.send('Browser.close'); } catch (e) { /* gone */ }
    console.log('closed');
    return;
  }
  if (cmd === 'newtab') {
    const c2 = await connect((await getJson('/json/version')).webSocketDebuggerUrl);
    const r = await c2.send('Target.createTarget', { url: a || 'about:blank' });
    c2.close();
    console.log('tab', r.targetId);
    return;
  }
  const p = await page();
  const cl = await connect(p.webSocketDebuggerUrl);
  try {
    if (cmd === 'nav') {
      const w = Number(b) || 1100, h = Number(c) || 800;
      await cl.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await cl.send('Page.enable');
      // Vite dev serves ESM at unhashed URLs, so a headless profile can replay a stale module
      // from its HTTP cache on a plain navigate and silently render last week's city.
      await cl.send('Network.enable');
      await cl.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cl.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__bootErrs = []; addEventListener('error', function (e) { __bootErrs.push(e.message + ' @' + e.filename + ':' + e.lineno); }); addEventListener('unhandledrejection', function (e) { __bootErrs.push('R:' + ((e.reason && e.reason.stack) || e.reason)); });" });
      await cl.send('Page.navigate', { url: a });
      await new Promise((r) => setTimeout(r, 800));
      console.log('navigated');
    } else if (cmd === 'eval') {
      const code = a.indexOf('return') >= 0 || a.indexOf(';') >= 0 ? a : 'return (' + a + ')';
      const r = await cl.send('Runtime.evaluate', { expression: '(async () => {' + code + NL + '})()', awaitPromise: true, returnByValue: true, timeout: 60000 });
      if (r.exceptionDetails) console.log('EXC', JSON.stringify((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
      else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value));
    } else if (cmd === 'seq') {
      // a list of steps in one connection: {eval: code} | {wait: ms} | {shot: file}
      const steps = JSON.parse(fs.readFileSync(a, 'utf8'));
      await cl.send('Emulation.setDeviceMetricsOverride', { width: Number(b) || 1100, height: Number(c) || 800, deviceScaleFactor: 1, mobile: false });
      for (const st of steps) {
        if (st.eval) { const r = await cl.send('Runtime.evaluate', { expression: '(async () => {' + st.eval + String.fromCharCode(10) + '})()', awaitPromise: true, returnByValue: true, timeout: 60000 }); console.log(r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description) : JSON.stringify(r.result.value)); }
        else if (st.wait) await new Promise((r) => setTimeout(r, st.wait));
        else if (st.shot) { const r = await cl.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(st.shot, Buffer.from(r.data, 'base64')); console.log('saved', st.shot); }
      }
    } else if (cmd === 'shot') {
      if (b) await cl.send('Emulation.setDeviceMetricsOverride', { width: Number(b), height: Number(c) || 800, deviceScaleFactor: 1, mobile: false });
      const r = await cl.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(a, Buffer.from(r.data, 'base64'));
      console.log('saved', a);
    }
  } finally {
    cl.close();
  }
}
main().catch((e) => { console.error('ERR', (e && e.message) || e); process.exit(1); });
