/**
 * Asks the running game server one question: would it let an unsigned visitor wear a given token?
 *
 * The picker will happily offer "try chog #1 anyway" no matter what the server thinks, because
 * the decision is the server's (`DEV_TOKENS`). Guessing from the env is not the same as asking:
 * the server that is actually listening may have been started by another session, with another
 * environment. So this joins, waits for `welcome` or `rejected`, and prints which one came back.
 *
 * node tools/probe-join.mjs [tokenId|foster] [wsUrl]
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('C:/Users/Kauker/Desktop/chog/node_modules/ws/index.js');

const WHAT = process.argv[2] ?? '1';
const URL = process.argv[3] ?? 'ws://localhost:8787/ws';
const tokenId = WHAT === 'foster' ? null : Number(WHAT);

const ws = new WebSocket(URL);
const done = (code, text) => {
  console.log(text);
  try { ws.close(); } catch {}
  process.exit(code);
};

const timer = setTimeout(() => done(2, 'TIMEOUT: no welcome and no rejection in 12s'), 12_000);

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'join', tokenId, sector: 'ashflat' }));
});

ws.on('message', (raw) => {
  let m;
  try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.t === 'rejected') {
    clearTimeout(timer);
    done(1, `REJECTED: ${m.reason}`);
  }
  if (m.t === 'welcome') {
    clearTimeout(timer);
    done(0, `WELCOME: as=${m.signin?.as} token=#${m.you?.tokenId} callsign=${m.you?.callsign ?? '?'}`);
  }
});

ws.on('error', (e) => {
  clearTimeout(timer);
  done(2, `ERROR: ${e.message}`);
});
