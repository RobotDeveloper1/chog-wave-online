/**
 * A second body on the field, so the party face of the duel HUD can be looked at.
 *
 * The browser can only be one player, and every rule worth verifying in co-op — the cover
 * hold, the body on the floor, the cross-link word over the head — is decided by the server
 * from a *roster*. So this opens a real second socket, walks it to the Wave Station, steps it
 * onto the same field instance as the browser and then does the one thing a partner has to do
 * for the test to mean anything: it stands still in its file and lets the anomaly hit it.
 *
 *   DEV_TOKENS=1 PORT=8799 node server/src/index.ts &
 *   WS=ws://localhost:8799/ws node tools/party-partner.mjs
 *
 * `COL` chooses which file it stands in (default 1, the middle), `TOKEN` which Chog it plays.
 *
 * `FIRE=<ms>` makes it an actual partner instead of a dummy: it opens the Custom Screen and fires
 * one card every <ms>, which is the only way the cross-link can land, because a link is measured
 * between two players' volleys. `REENTER=1` steps back onto the field after a wipe, so a long
 * browser session does not have to be re-driven every time the party is knocked over.
 */
import { chip, cityOf } from '../shared/src/index.ts';

const WSURL = process.env.WS ?? 'ws://localhost:8787/ws';
const TOKEN = Number(process.env.TOKEN ?? 2);
const COL = Number(process.env.COL ?? 1);
const SECTOR = process.env.SECTOR ?? 'ashflat';
const FIRE_MS = Number(process.env.FIRE ?? 0);
const REENTER = process.env.REENTER === '1';
/**
 * A link is only decided between two volleys carrying the same element, so the harness has to be
 * able to promise one: `ELEMENT=burn` makes it fire a burn card whenever the deal holds one.
 */
const ELEMENT = process.env.ELEMENT ?? '';
/**
 * Which grid column the card is laid in. A link's adjacency bonus is measured between the two
 * programs' files, not the two players' standing files, so the column is the harness's lever on
 * it. Keep it at 0 for a wide chip: nothing may hang off the edge of a 3x3 grid.
 */
const PLACE = Number(process.env.PLACE ?? 0);

/** Wall clock on every line: a link is a 1500 ms race, so the log has to be readable as a timeline. */
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 23)} partner ${TOKEN}]`, ...a);

const ws = new WebSocket(WSURL);
let me = null;
let station = null;
/** When the harness last asked for a hand, so FIRE_MS is a floor and not a clock. */
let lastFire = 0;
/**
 * A refusal is usually a moment, not a verdict: the wave is quiet until the next boss rolls, and a
 * downed body is in recovery for a few seconds. Giving up there means every take has to be launched
 * by hand, so the harness keeps asking on `RETRY` instead.
 */
const RETRY_MS = Number(process.env.RETRY ?? 5000);
let retryAt = null;
let lastRefusal = '';

const send = (m) => ws.send(JSON.stringify(m));

/** The server walks a position jump at run speed, so a long trip is a run of short hops. */
function walkTo(x, z) {
  const from = { x: me.x, z: me.y };
  const dx = x - from.x;
  const dz = z - from.z;
  const d = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(d / 5));
  for (let i = 1; i <= n; i++) {
    setTimeout(() => send({ t: 'move', x: from.x + (dx * i) / n, y: from.z + (dz * i) / n, vx: 0, anim: 'walk', place: 'street' }), i * 240);
  }
  return n * 240;
}

ws.addEventListener('open', () => {
  station = cityOf(SECTOR).anchors.find((a) => a.kind === 'door' && a.sub === 'station');
  send({ t: 'join', tokenId: TOKEN, sector: SECTOR });
});

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.t === 'rejected') {
    log(`join refused: ${m.reason}`);
    process.exitCode = 2;
    ws.close();
    return;
  }
  if (m.t === 'welcome') {
    // `welcome.you` is the player's identity, not their position — the street coordinates come
    // with the world snapshot, which is where the client reads them too.
    const at = (m.world?.players ?? []).find((q) => q.id === m.you.id);
    me = { id: m.you.id, x: at?.x ?? 0, y: at?.y ?? 0, level: m.you.level };
    log(`joined as #${m.you.tokenId} (${m.signin?.as}) at ${me.x},${me.y} — level ${m.you.level}`);
    setTimeout(() => {
      const ms = walkTo(station.x, station.z - 3);
      log(`walking to the Wave Station at ${station.x},${station.z} (${Math.round(ms / 240)} hops)`);
      setTimeout(() => {
        send({ t: 'duel', action: 'enter', mode: 'anomaly' });
        log('asked to step onto the field');
      }, ms + 700);
    }, 400);
    return;
  }
  if (m.t === 'world') {
    const at = (m.players ?? []).find((q) => q.id === me?.id);
    if (at) {
      me.x = at.x;
      me.y = at.y;
    }
    return;
  }
  if (m.t === 'duel' && m.kind === 'refused') {
    if (!REENTER) return log(`field refused: ${m.reason}`);
    if (m.reason !== lastRefusal) log(`field refused: ${m.reason} — asking again in ${RETRY_MS / 1000}s`);
    lastRefusal = m.reason;
    clearTimeout(retryAt);
    retryAt = setTimeout(() => send({ t: 'duel', action: 'enter', mode: 'anomaly' }), RETRY_MS);
    return;
  }
  if (m.t === 'duel' && (m.kind === 'start' || m.kind === 'tick')) {
    const v = m.kind === 'start' ? m.view : m.view;
    if (!v) return log(`duel ${m.kind}: ${JSON.stringify(m).slice(0, 160)}`);
    if (m.kind === 'start') {
      lastRefusal = '';
      log(`on the field: ${v.boss.name} ${v.boss.hp}hp, roster ${v.players.length}${FIRE_MS > 0 ? `, firing when the gauge fills (>=${FIRE_MS}ms apart)` : ''}`);
    }
    for (const e of m.events ?? []) {
      if (e.type === 'down') log(`DOWN ${e.owner === me.id ? '(me)' : e.owner}`);
      if (e.type === 'revived') log(`REVIVED ${e.owner === me.id ? '(me)' : e.owner}`);
      if (e.type === 'lost') log(`LOST ${e.owner === me.id ? '(me)' : e.owner}`);
    }
    const mine = v.players.find((p) => p.id === me.id);
    if (mine && mine.col !== COL) {
      send({ t: 'duel', action: 'move', col: COL });
    }
    // Fire as soon as the gauge is full rather than on a timer: a timer just asks for refusals,
    // and the two partners drifting onto the same seven-second cycle is what makes a link land.
    if (FIRE_MS > 0 && v.you && !v.you.down && !v.you.revive && v.you.readyIn <= 0 && Date.now() - lastFire > FIRE_MS) {
      lastFire = Date.now();
      send({ t: 'duel', action: 'open' });
    }
    const link = v.you?.link;
    log(
      `hp ${v.players.map((p) => `${p.id === me.id ? '>' : ' '}${p.name}:${Math.round(p.hp)}${p.down ? ' DOWN' : ''}@c${p.col}`).join(' ')} | boss ${Math.round(v.boss.hp)} | ${v.you?.revive ? 'COVERING ' + v.you.revive.name.slice(-4) + ' ' + Math.round(v.you.revive.fraction * 100) + '%' : 'holding'}${link ? ' | ' + (link.tag ?? 'link x' + link.mult) : ''}`,
    );
    return;
  }
  if (m.t === 'duel' && m.kind === 'revive') return log(`revive reply: ${JSON.stringify(m)}`);
  if (m.t === 'duel' && m.kind === 'hand') {
    if (!m.ok) return log(`custom screen refused: ${m.reason}`);
    const dealt = (m.hand ?? []).map((c) => ({ ...c, element: chip(c.chipId)?.element ?? '?' }));
    if (!dealt.length) return log('dealt an empty hand');
    // A link only reads between two volleys carrying the same element, so `ELEMENT` makes the harness
    // deal again rather than fire something that cannot resonate. Closing and reopening the screen is
    // exactly what a player does with a hand that does not fit the party.
    const card = ELEMENT ? dealt.find((c) => c.element === ELEMENT) : dealt[0];
    if (!card) return log(`hand ${dealt.map((c) => `${c.chipId}:${c.element}`).join(' ')} — no ${ELEMENT}, dealing again`);
    log(`hand ${dealt.map((c) => `${c.chipId}:${c.element}`).join(' ')} -> firing ${card.chipId}:${card.element}@c${card.cell}`);
    // Every chip shape is at most three cells from the origin and the grid is never under 3x3,
    // so the top-left corner is the one placement that cannot be off-grid.
    send({ t: 'duel', action: 'fire', queue: [card.cell], placements: [{ chipId: card.chipId, row: 0, col: PLACE }] });
    return;
  }
  if (m.t === 'duel' && m.kind === 'program') {
    if (!m.ok) return log(`program refused: ${m.reason}${m.detail ? ' (' + m.detail + ')' : ''}`);
    return log(
      `program out: ${m.cards.length} card(s), potential ${m.potential}${m.warded ? ' WARDED' : ''}${m.link ? ' ' + m.link.tag + ' x' + m.link.mult : ''}`,
    );
  }
  if (m.t === 'duel' && m.kind === 'end') {
    if (REENTER) {
      log(`fight over (${m.won ? 'cleared' : m.reason}) — stepping back on in 4s`);
      setTimeout(() => send({ t: 'duel', action: 'enter', mode: 'anomaly' }), 4000);
    }
    return;
  }
});

ws.addEventListener('close', () => {
  log('socket closed');
  process.exitCode = 0;
});
ws.addEventListener('error', (e) => log('socket error', e.message ?? ''));

setTimeout(() => {
  log('still on the field — Ctrl-C to leave');
}, 12000);
