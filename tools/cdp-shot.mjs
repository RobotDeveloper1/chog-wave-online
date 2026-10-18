/**
 * Headless screenshot driver over the Chrome DevTools Protocol.
 *
 * The game needs a click before it shows anything (the picker), and `--screenshot` alone cannot
 * click. This launches the installed Edge with remote debugging, drives the page, runs optional JS
 * and captures a PNG. No extra dependencies: Node 22 ships a global WebSocket.
 *
 *   node tools/cdp-shot.mjs <url> <out.png> [jsToRunAfterLoad] [waitMs] [width] [height]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const argv = process.argv.slice(2);
/** `--preload <file>` injects a script before any page script runs (used to force
 *  preserveDrawingBuffer so the page can read back its own frames). */
const preloadIdx = argv.indexOf('--preload');
const preloadFile = preloadIdx >= 0 ? argv[preloadIdx + 1] : null;
const rest = preloadIdx >= 0 ? [...argv.slice(0, preloadIdx), ...argv.slice(preloadIdx + 2)] : argv;
const [url, out, jsArg = '', waitMsArg = '18000', widthArg = '1400', heightArg = '860'] = rest;
// `@file` reads the script from disk, so a long driver script stays readable and quotable.
const js = jsArg.startsWith('@') ? readFileSync(jsArg.slice(1), 'utf8') : jsArg;
const waitMs = Number(waitMsArg);
const port = 9333 + Math.floor(Math.random() * 200);

const proc = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-shot-'))}`,
    `--window-size=${widthArg},${heightArg}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('devtools endpoint never came up');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  return { ready, send, close: () => ws.close() };
}

try {
  const target = await targets();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  await cdp.send('Page.enable');
  if (preloadFile) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(preloadFile, 'utf8') });
  }
  await cdp.send('Page.navigate', { url });

  // Wait for the document, then for the caller's JS to report done.
  for (let i = 0; i < 80; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (r.result?.value === 'complete') break;
    await sleep(250);
  }

  if (js) {
    const r = await cdp.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) console.error('JS ERROR:', JSON.stringify(r.exceptionDetails).slice(0, 600));
    else console.log('JS ->', JSON.stringify(r.result?.value ?? null).slice(0, 600));
  }

  await sleep(waitMs);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('wrote', out);

  cdp.close();
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  proc.kill();
}
