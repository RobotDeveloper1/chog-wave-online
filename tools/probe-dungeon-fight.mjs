/**
 * Fights a mob in a fold and reports what the three complaints actually are.
 *
 * The complaints, in the player's words: "when I kill it it keeps following me", "the screen still
 * goes black after an attack", and "is it normal that I cannot dodge after the attack locks".
 * A screenshot cannot answer any of them -- a stale field, a rig left on the street and a frozen
 * body are all invisible in a picture. So this joins, walks into a chamber, fights one volley,
 * tries to step out of the way, abandons, and then reads the engine: the rig, the plane, the mood,
 * the frame brightness, the band's own positions, and every `area.state` the server sent.
 *
 * node tools/probe-dungeon-fight.mjs [baseUrl] [tokenId] [dungeonId]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5176';
const TOKEN = process.argv[3] ?? '1';
const DUNGEON = process.argv[4] ?? 'd-ember';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  const tick = () => page.evaluate(() => { window.__frame(1 / 60); return window.__intro(); });
  // Read in the render task: a WebGL drawing buffer is cleared the moment the compositor takes it.
  const dims = () => page.evaluate(() => window.__luma());

  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const demoTab = page.locator('.pk-tab', { hasText: 'DEMO' }).first();
  await demoTab.waitFor({ state: 'visible', timeout: 60000 });
  await demoTab.click();
  await page.waitForSelector('.pk-demo-input', { state: 'visible', timeout: 30000 });
  await page.evaluate((id) => {
    const i = document.querySelector('.pk-demo-input');
    i.focus(); i.value = String(id);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, TOKEN);
  await page.waitForFunction('typeof window.__net === "object"', null, { timeout: 30000 });
  await wait(3000);

  // Everything the server says about the run, from here on: the one place the truth about a
  // cleared node lives.
  await page.evaluate(() => {
    window.__netlog = [];
    window.__net.on('area.state', (m) => window.__netlog.push({ t: 'area.state', ok: m.ok, run: m.run ?? null }));
    window.__net.on('area.kill', (m) => window.__netlog.push({ t: 'area.kill', ok: m.ok, reason: m.reason ?? null }));
    window.__net.on('area.step', (m) => window.__netlog.push({ t: 'area.step', ok: m.ok, fights: !!m.fights, enemy: m.enemy ? m.enemy.name : null }));
    window.__net.on('duel', (m) => window.__netlog.push({ t: 'duel', kind: m.kind, won: m.won ?? null, reason: m.reason ?? null }));
  });

  if (await page.evaluate(() => !!window.__dungeon())) {
    console.log('abandoning the stale run from a previous session');
    await page.evaluate(() => window.__menu('dungeons'));
    await wait(700);
    await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
    for (let i = 0; i < 80; i++) {
      await tick(); await wait(40);
      if (await page.evaluate(() => !window.__dungeon() && !window.__state().busy)) break;
    }
    await page.evaluate(() => window.__menu());
    await wait(400);
  }

  const gate = await page.evaluate(() => window.__anchors().find((a) => a.kind === 'fold'));
  if (!gate) throw new Error('no fold anchor in this sector');
  await page.evaluate((g) => window.__tp(g.x, g.z), gate);
  for (let i = 0; i < 40; i++) {
    await tick(); await wait(40);
    if (await page.evaluate(() => window.__state().target === 'a-fold')) break;
  }
  // The server opens a fold only for a Chog standing on the gate, and it learns the position from
  // walked hops -- so wait until *its* copy of the player has arrived, not just the client's.
  for (let i = 0; i < 40; i++) {
    await wait(500);
    const ok = await page.evaluate((g) => {
      const me = (window.__net.world?.players ?? []).find((p) => p.id === window.__net.me?.id);
      return !!me && Math.hypot(me.x - g.x, me.y - g.z) < 2.5;
    }, gate);
    if (ok) break;
  }
  await page.evaluate(() => window.__chog?.hud?.closeDialogue?.());
  await wait(300);
  await page.evaluate(() => window.__key('e'));
  await wait(900);
  await page.evaluate((id) => document.querySelector(`[data-a="dungeon"][data-id="${id}"]`)?.click(), DUNGEON);

  for (let i = 0; i < 200; i++) {
    await tick(); await wait(40);
    if (await page.evaluate(() => !!window.__dungeon())) break;
  }
  for (let i = 0; i < 300; i++) {
    const st = await tick(); await wait(40);
    if (st && !st.custom && st.k >= 1) break;
  }
  await wait(800);

  const report = async (tag) => {
    const d = await page.evaluate(() => window.__dungeon());
    const st = await page.evaluate(() => window.__state());
    const cam = await page.evaluate(() => window.__cam());
    const mean = await dims();
    await page.screenshot({ path: path.join(OUT, `fight-${DUNGEON}-${tag}.png`), timeout: 25000 }).catch(() => {});
    console.log(`\n[${tag}]`);
    if (!d) { console.log('  no field'); return d; }
    console.log(`  plane=${d.plane} group.y=${d.groupY} chog.y=${d.playerY} lens.y=${d.camY} lights=${d.lights}`);
    console.log(`  rig=${cam.rig} camY=${cam.camY} luma=${JSON.stringify(mean)}`);
    console.log(`  chog ${d.pos.x},${d.pos.z} duel=${st.duel} dialogue=${st.dialogue}`);
    console.log(`  bodies: ${d.bodies.map((b) => `${b.nodeId}:${b.mobId}@${b.x},${b.z}`).join(' | ')}`);
    return d;
  };

  // Control: the fold at rest is a lit place.
  await report('entry');

  // A fight chamber: reachable, uncleared, and a room the server will answer with a band.
  const room = await page.evaluate(() => {
    const d = window.__dungeon();
    return d.nodes.find((n) => n.reachable && !n.cleared && !n.here && (n.kind === 'elite' || n.kind === 'wave' || n.kind === 'boss'))
      ?? d.nodes.find((n) => n.reachable && !n.cleared && !n.here) ?? null;
  });
  console.log(`\nfighting room: ${room ? `${room.label} (${room.kind}) ${room.x},${room.z}` : 'nothing reachable'}`);
  if (!room) throw new Error('no reachable room to fight in');

  await page.evaluate((t) => window.__tp(t.x, t.z), room);
  for (let i = 0; i < 120; i++) { await tick(); await wait(30); }
  await page.evaluate(() => window.__key('e'));
  for (let i = 0; i < 60; i++) {
    await tick(); await wait(40);
    const s = await page.evaluate(() => window.__state());
    if (s.dialogue || s.duel) break;
  }
  const st1 = await page.evaluate(() => window.__state());
  console.log(`after E: dialogue=${st1.dialogue} duel=${st1.duel}`);
  if (st1.dialogue) {
    // The encounter prompt's first option is "step in alone".
    await page.evaluate(() => window.__key('1'));
    for (let i = 0; i < 90; i++) {
      await tick(); await wait(40);
      if (await page.evaluate(() => window.__state().duel)) break;
    }
  }
  const inDuel = await page.evaluate(() => window.__state().duel);
  if (!inDuel) {
    console.log('NO DUEL STARTED — net log:', JSON.stringify(await page.evaluate(() => window.__netlog.slice(-6)), null, 1));
    throw new Error('the fight never started');
  }
  await wait(320);
  console.log('\n[in-fight]');
  console.log('  ' + JSON.stringify(await page.evaluate(() => {
    const d = window.__duelobj();
    return { phase: d?.phase, you: d?.view?.you && { file: d.view.you.file, lane: d.view.you.lane, hp: d.view.you.hp, frozen: d.view.you.frozen, down: d.view.you.down }, boss: d?.view?.boss && { hp: d.view.boss.hp, maxHp: d.view.boss.maxHp, file: d.view.boss.file } };
  })));
  const fightLuma = await dims();
  console.log(`  luma=${JSON.stringify(fightLuma)}`);
  await page.screenshot({ path: path.join(OUT, `fight-${DUNGEON}-in-fight.png`), timeout: 25000 }).catch(() => {});

  // One attack: hold the buster for a moment and let go, the way a tap fires.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })));
  await wait(140);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true })));
  await wait(900);
  console.log('\n[after-attack]');
  console.log('  ' + JSON.stringify(await page.evaluate(() => {
    const d = window.__duelobj();
    return { phase: d?.phase, you: d?.view?.you && { file: d.view.you.file, lane: d.view.you.lane, frozen: d.view.you.frozen, down: d.view.you.down }, boss: d?.view?.boss && { hp: d.view.boss.hp } };
  })));
  const afterAttack = await dims();
  console.log(`  luma=${JSON.stringify(afterAttack)}`);
  await page.screenshot({ path: path.join(OUT, `fight-${DUNGEON}-after-attack.png`), timeout: 25000 }).catch(() => {});

  // The dodge: step every direction, and read the frame in the same task as the draw, right
  // after the step lands -- a black frame that lasts one frame is only visible if you look then.
  for (const [tag, key] of [['left', 'a'], ['right', 'd'], ['up', 'w'], ['down', 's']]) {
    const pre = await page.evaluate(() => ({ you: (() => { const d = window.__duelobj(); return d?.view?.you ? { file: d.view.you.file, lane: d.view.you.lane } : null; })(), luma: window.__luma() }));
    await page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: `Key${k.toUpperCase()}`, bubbles: true })), key);
    await wait(120);
    const mid = await page.evaluate(() => window.__luma());
    await page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: `Key${k.toUpperCase()}`, bubbles: true })), key);
    await wait(600);
    const post = await page.evaluate(() => ({ you: (() => { const d = window.__duelobj(); return d?.view?.you ? { file: d.view.you.file, lane: d.view.you.lane } : null; })(), luma: window.__luma() }));
    console.log(`\n[dodge ${tag}] ${JSON.stringify(pre.you)} -> ${JSON.stringify(post.you)}`);
    console.log(`   luma pre=${pre.luma.mean} mid=${mid.mean} (peak ${mid.peak}) post=${post.luma.mean} (peak ${post.luma.peak})`);
    await page.screenshot({ path: path.join(OUT, `dodge-${tag}.png`), timeout: 25000 }).catch(() => {});
    await wait(300);
  }

  // Abandon: the same disposition the win and the wipe both take.
  await page.evaluate(() => window.__key('Escape'));
  await wait(200);
  await page.evaluate(() => window.__key('Escape'));
  for (let i = 0; i < 150; i++) {
    await tick(); await wait(40);
    if (!(await page.evaluate(() => window.__state().duel))) break;
  }
  await wait(2500);
  const after = await report('after-fight');
  console.log('  net log:', JSON.stringify(await page.evaluate(() => window.__netlog.slice(-8)), null, 1));

  // The follow: a body that should be dead drifting toward the player is the complaint, and it
  // only shows over time -- so sample the band twice, a second apart, standing still.
  const sample = () => page.evaluate(() => window.__dungeon()?.bodies ?? []);
  const s1 = await sample();
  await wait(1200);
  const s2 = await sample();
  if (s1.length && s2.length) {
    const moved = s1.map((b, i) => {
      const n = s2[i];
      if (!n) return null;
      const d = Math.hypot(n.x - b.x, n.z - b.z);
      return d > 0.3 ? `${b.mobId} moved ${d.toFixed(1)}u toward ${n.x},${n.z}` : null;
    }).filter(Boolean);
    console.log(`  band drift: ${moved.length ? moved.join(' | ') : 'nothing moved'}`);
  }

  console.log(`\npage errors: ${errors.length ? errors.slice(0, 6).join(' | ') : 'none'}`);
  await ctx.close();
} finally {
  await browser.close();
}
