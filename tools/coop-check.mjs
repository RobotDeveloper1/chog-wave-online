/**
 * SF integration checks against an isolated DEV_TOKENS=1 probe server.
 * Run with WS pointing at that server. This resets its dev world, then drives
 * real sockets through presence, authoritative movement and SF training fights.
 */
import { cityOf } from '../shared/src/index.ts';

const URL = process.env.WS ?? 'ws://localhost:8787/ws';
const HTTP = process.env.HTTP ?? URL.replace(/^ws/, 'http').replace(/\/ws\/?$/, '');
const clients = [];
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

class Client {
  constructor(tokenId, sector = 'ashflat') {
    clients.push(this);
    this.tokenId = tokenId;
    this.world = null;
    this.view = null;
    this.messages = [];
    this.events = [];
    this.waiters = new Set();
    this.ws = new WebSocket(URL);
    this.ws.onmessage = (event) => {
      const m = JSON.parse(String(event.data));
      this.messages.push(m);
      if (m.t === 'welcome') { this.you = m.you; this.world = m.world; }
      if (m.t === 'world') this.world = m;
      if (m.t === 'duel') {
        if (m.view) this.view = m.view;
        this.events.push(...(m.events ?? []));
      }
      for (const notify of this.waiters) notify();
    };
    this.ws.onopen = () => this.send({ t: 'join', tokenId, sector });
    this.ready = this.wait(() => this.you || this.messages.find((m) => m.t === 'rejected'), 'join').then((reply) => {
      if (reply.t === 'rejected') throw new Error(`Join refused: ${reply.reason}; use an isolated DEV_TOKENS=1 server`);
      return this;
    });
  }

  send(body) { this.ws.send(JSON.stringify(body)); }
  duel(action, args = {}) { this.send({ t: 'duel', action, ...args }); }
  player(id = this.you.id) { return this.world?.players.find((p) => p.id === id); }

  wait(read, label, ms = 12_000) {
    return new Promise((resolve, reject) => {
      const notify = () => {
        const value = read();
        if (!value) return;
        clearTimeout(timer);
        this.waiters.delete(notify);
        resolve(value);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(notify);
        reject(new Error(`Timed out waiting for ${label}`));
      }, ms);
      this.waiters.add(notify);
      notify();
    });
  }

  async walkTo(x, y) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const p = this.player();
      const distance = Math.hypot(p.x - x, p.y - y);
      if (distance < 1.5) return;
      const before = this.world;
      const step = Math.min(1, 2 / distance);
      this.send({ t: 'move', x: p.x + (x - p.x) * step, y: p.y + (y - p.y) * step, vx: 0, facing: 1, anim: 'walk', place: 'street' });
      await this.wait(() => this.world !== before, 'movement snapshot');
    }
    throw new Error('Could not reach the Wave Station');
  }

  close() { if (this.ws.readyState < WebSocket.CLOSING) this.ws.close(); }
}

async function main() {
  const reset = await fetch(`${HTTP}/api/dev/reset`, { method: 'POST' });
  if (!reset.ok) throw new Error(`Dev reset refused (${reset.status}); use a probe server`);
  const a = new Client(1);
  const b = new Client(37);
  const c = new Client(803, 'hollow');
  await Promise.all(clients.map((x) => x.ready));
  await Promise.all(clients.map((x) => x.wait(() => x.world?.players.length >= 3, 'shared roster')));
  const sets = clients.map((x) => x.world.players.map((p) => p.tokenId).sort((n, m) => n - m).join(','));
  check('three sockets share the same roster', sets.every((x) => x === sets[0]));
  check('identity follows the requested token', a.you.tokenId === 1 && b.you.tokenId === 37 && c.you.tokenId === 803);
  check('retired sector IDs clamp to the live city', c.you.sector === 'ashflat');

  const start = a.player();
  const hop = { x: start.x + 2, y: start.y + 1 };
  a.send({ t: 'move', ...hop, vx: 12, facing: 1, anim: 'walk', place: 'street' });
  const remote = await b.wait(() => {
    const p = b.player(a.you.id);
    return p && Math.abs(p.x - hop.x) < 0.5 ? p : null;
  }, 'peer movement');
  check('authoritative movement broadcasts to peers', Math.abs(remote.y - hop.y) < 0.5 && remote.anim === 'walk');

  const station = cityOf('ashflat').anchors.find((x) => x.kind === 'door' && x.sub === 'station');
  if (!station) throw new Error('City has no Wave Station');
  await a.walkTo(station.x, station.z);
  a.duel('enter', { mode: 'train' });
  const begun = await a.wait(() => a.messages.find((m) => m.t === 'duel' && (m.kind === 'start' || m.kind === 'refused')), 'SF entry');
  if (begun.kind === 'refused') throw new Error(begun.reason);
  check('SF starts with authoritative stats and field geometry', begun.view.you.stats.slots === begun.caps.slots && begun.view.boss.cols >= 3);
  const first = await a.wait(() => a.view?.you?.custom, 'Custom Screen');
  const legal = first.cells.find((cell) => !cell.locked);
  if (!legal) throw new Error('No legal SF card in the first hand');
  a.duel('pick', { cell: legal.cell });
  await a.wait(() => a.view?.you?.custom?.cells.find((cell) => cell.cell === legal.cell && cell.picked), 'picked card');
  const offset = a.messages.length;
  a.duel('pick', { cell: 99 });
  const refused = await a.wait(() => a.messages.slice(offset).find((m) => m.t === 'duel' && m.kind === 'pick'), 'invalid cell refusal');
  check('invented cells cannot enter a program', refused.ok === false);
  a.duel('execute');
  await a.wait(() => a.events.find((event) => event.type === 'shot-fired'), 'SF projectile');
  check('program damage comes from the authoritative SF field', a.events.some((event) => event.type === 'shot-fired' && event.chipId === legal.card.id));

  const deadline = Date.now() + 90_000;
  let end = null;
  while (Date.now() < deadline && !end) {
    const view = a.view;
    const you = view?.you;
    if (!you) throw new Error('Training body disappeared');
    if (you.custom) {
      const next = you.custom.cells.find((cell) => !cell.locked);
      if (next) a.duel('pick', { cell: next.cell });
      else a.duel('execute');
    } else if (!you.frozen && !you.down) {
      const hazard = view.hazard;
      const marked = (file, lane) => hazard?.panels.some((p) => p.file === file && p.lane === lane);
      if (marked(you.file, you.lane)) {
        const dirs = [
          ['left', you.file - 1, you.lane], ['right', you.file + 1, you.lane],
          ['back', you.file, you.lane - 1], ['forward', you.file, you.lane + 1],
        ];
        const safe = dirs.find(([, file, lane]) => file >= 0 && file < view.boss.cols && lane >= 3 && lane <= 4 && !marked(file, lane));
        if (safe) a.duel('step', { dir: safe[0] });
      } else if (you.file !== view.boss.file && !marked(view.boss.file, you.lane)) {
        a.duel('step', { dir: you.file < view.boss.file ? 'right' : 'left' });
      } else if (you.buster.ready) {
        a.duel('buster', { down: true });
        a.duel('buster', { down: false });
      }
    }
    const before = a.view;
    await a.wait(() => a.view !== before || a.messages.find((m) => m.t === 'duel' && m.kind === 'end'), 'next SF tick');
    end = a.messages.find((m) => m.t === 'duel' && m.kind === 'end');
  }
  check('SF training reaches an authoritative result', end?.won === true, end?.reason ?? 'timeout');
  check('Buster actions emit real SF events', a.events.some((event) => event.type === 'buster'));
  for (const client of clients) client.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error('coop-check failed:', error.message);
  for (const client of clients) client.close();
  process.exitCode = 2;
});
