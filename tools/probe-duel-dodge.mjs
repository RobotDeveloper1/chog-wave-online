/**
 * Does a dodge black the screen? Enter a fold, open a fight, then step and measure.
 *
 * "Quando eu dou dodge a tela fica preta" is a claim about one frame out of sixty, and a
 * screenshot cannot say which. So this reads the frame's own luminance in the render task
 * (`__luma`) immediately before the step, right after it, and again once it has settled --
 * plus the file/lane the server actually moved the body to.
 *
 * node tools/probe-duel-dodge.mjs [baseUrl] [tokenId] [dungeonId]
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5176';
const TOKEN = process.argv[3] ?? '1';
const DUNGEON = process.argv[4] ?? 'd-ember';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
const LOG = 'C:/Users/Kauker/Desktop/chog/tools/tmp/dodge.log';
fs.writeFileSync(LOG, '');
const log = (s) => { fs.appendFileSync(LOG, s + '\n'); };

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('PAGEERROR ' + e.message.split('\n')[0]));
  const tick = () => page.evaluate(() => { window.__frame(1 / 60); return 'f'; });
  const luma = () => page.evaluate(() => window.__luma());
  const me = () => page.evaluate(() => {
    const d = window.__duelobj();
    return d?.view?.you ? { file: d.view.you.file, lane: d.view.you.lane, frozen: d.view.you.frozen, down: d.view.you.down } : null;
  });

  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.pk-tab', { hasText: 'DEMO' }).first().click();
  await page.waitForSelector('.pk-demo-input', { state: 'visible', timeout: 30000 });
  await page.evaluate((id) => {
    const i = document.querySelector('.pk-demo-input');
    i.focus(); i.value = String(id);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, TOKEN);
  await page.waitForFunction('typeof window.__net === "object"', null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__netlog = [];
    window.__net.on('loop', (m) => { if (m.action === 'area.open' || m.action === 'area.state') window.__netlog.push({ a: m.action, ok: m.ok, reason: m.reason ?? null, run: !!m.run }); });
  });
  await wait(4500);
  log('joined');

  // Into the fold through the MENU -- the gate is no longer required, and the menu is the
  // path the player actually uses.
  for (let attempt = 0; attempt < 3 && !(await page.evaluate(() => !!window.__dungeon())); attempt++) {
    await page.evaluate(() => window.__menu('dungeons'));
    await wait(1400);
    if (await page.evaluate(() => !!document.querySelector('[data-a="leave"]'))) {
      await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
      for (let i = 0; i < 60; i++) { await tick(); await wait(60); if (await page.evaluate(() => !window.__state().busy)) break; }
      await page.evaluate(() => window.__menu('dungeons'));
      await wait(1400);
    }
    await page.evaluate((id) => document.querySelector(`[data-a="dungeon"][data-id="${id}"]`)?.click(), DUNGEON);
    for (let i = 0; i < 60; i++) { await tick(); await wait(50); if (await page.evaluate(() => !!window.__dungeon())) break; }
  }
  log('in fold: ' + await page.evaluate(() => !!window.__dungeon()));

  // A fight room: teleport onto it, clear any dialogue, step.
  const room = await page.evaluate(() => {
    const d = window.__dungeon();
    return d.nodes.find((n) => n.reachable && !n.cleared && !n.here && (n.kind === 'elite' || n.kind === 'wave' || n.kind === 'boss')) ?? null;
  });
  log('room: ' + JSON.stringify(room && { label: room.label, kind: room.kind, x: room.x, z: room.z }));
  await page.evaluate((t) => window.__tp(t.x, t.z), room);
  for (let i = 0; i < 20; i++) { await tick(); await wait(40); }
  await page.evaluate(() => window.__key('e'));
  for (let i = 0; i < 60; i++) {
    await tick(); await wait(40);
    const s = await page.evaluate(() => window.__state());
    if (s.dialogue || s.duel) break;
  }
  if (await page.evaluate(() => window.__state().dialogue)) {
    await page.evaluate(() => window.__key('1'));
    for (let i = 0; i < 90; i++) { await tick(); await wait(40); if (await page.evaluate(() => window.__state().duel)) break; }
  }
  log('duel: ' + await page.evaluate(() => window.__state().duel));
  await wait(1200);

  log('before: ' + JSON.stringify(await me()) + ' luma=' + JSON.stringify(await luma()));

  // The dodge: a step to the neighbouring file, the fight's own evade.
  for (const [tag, key] of [['left', 'a'], ['right', 'd'], ['up', 'w'], ['down', 's']]) {
    const before = await me();
    const pre = await luma();
    await page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: `Key${k.toUpperCase()}`, bubbles: true })), key);
    await wait(140);
    const mid = await luma();
    await page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: `Key${k.toUpperCase()}`, bubbles: true })), key);
    await wait(700);
    const after = await luma();
    const now = await me();
    log(`dodge ${tag}: ${JSON.stringify(before)} -> ${JSON.stringify(now)}`);
    log(`   luma pre=${pre.mean} mid=${mid.mean} (peak ${mid.peak}) post=${after.mean} (peak ${after.peak})`);
    await page.screenshot({ path: `${OUT}/dodge-${tag}.png`, timeout: 25000 }).catch(() => {});
    await wait(400);
  }
  await ctx.close();
} finally {
  await browser.close();
}
