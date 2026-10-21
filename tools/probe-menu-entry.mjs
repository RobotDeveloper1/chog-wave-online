/**
 * Can a fold be entered from the MENU, from anywhere? That is the whole ask.
 *
 * Join, open the DUNGEONS tab where the player spawns, click ENTER, and report whether the fold
 * opened -- no teleport, no gate, no dialogue-clearing. Then, if the server already held a run,
 * click the run page's RETURN TO THE FOLD instead.
 *
 * node tools/probe-menu-entry.mjs [baseUrl] [tokenId] [dungeonId]
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5176';
const TOKEN = process.argv[3] ?? '1';
const DUNGEON = process.argv[4] ?? 'd-ember';
const LOG = 'C:/Users/Kauker/Desktop/chog/tools/tmp/menu-entry.log';
fs.writeFileSync(LOG, '');
const log = (s) => { fs.appendFileSync(LOG, s + '\n'); };

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('PAGEERROR ' + e.message.split('\n')[0]));
  const tick = () => page.evaluate(() => { window.__frame(1 / 60); return 'f'; });

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
    window.__net.on('loop', (m) => { if (m.action === 'area.open') window.__netlog.push({ ok: m.ok, reason: m.reason ?? null }); });
  });
  await wait(4500);
  const spawn = await page.evaluate(() => window.__pos());
  log(`joined at ${spawn.x},${spawn.z} (area "${spawn.area}")`);

  // The player's own flow: the DUNGEONS tab, wherever they are standing.
  await page.evaluate(() => window.__menu('dungeons'));
  await wait(1600);
  log('tab dump: ' + JSON.stringify(await page.evaluate(() => ({
    menuOpen: window.__menu(),
    hasDgs: !!document.querySelector('.dgs'),
    text: (document.querySelector('.dgs')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 140),
    buttons: [...document.querySelectorAll('[data-a]')].map((b) => b.dataset.a),
    replies: window.__netlog.slice(-3),
  }))));
  const kind = await page.evaluate(() => {
    if (document.querySelector('[data-a="dungeon"]')) return 'list';
    if (document.querySelector('[data-a="leave"]')) return 'run';
    return 'neither';
  });
  log(`dungeons tab shows: ${kind}`);

  // A dead run blocks the list, which is correct -- so leave it first, then enter from the list.
  if (kind === 'run') {
    await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
    for (let i = 0; i < 60; i++) { await tick(); await wait(60); if (await page.evaluate(() => !window.__state().busy)) break; }
    await page.evaluate(() => window.__menu('dungeons'));
    await wait(1600);
    log('after leaving, tab: ' + JSON.stringify(await page.evaluate(() => ({
      buttons: [...document.querySelectorAll('[data-a]')].map((b) => b.dataset.a),
      text: (document.querySelector('.dgs')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 90),
    }))));
  }

  const sel = `[data-a="dungeon"][data-id="${DUNGEON}"]`;
  const clicked = await page.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel);
  log(`clicked ${sel}: ${clicked}`);
  for (let i = 0; i < 60; i++) { await tick(); await wait(50); if (await page.evaluate(() => !!window.__dungeon())) break; }
  const inFold = await page.evaluate(() => !!window.__dungeon());
  log(`in fold: ${inFold}`);
  log('area.open replies: ' + JSON.stringify(await page.evaluate(() => window.__netlog.slice(-3))));
  if (!inFold) log('state: ' + JSON.stringify(await page.evaluate(() => window.__state())));
  await page.screenshot({ path: 'C:/Users/Kauker/Desktop/chog/outputs/menu-entry.png', timeout: 30000 }).catch(() => {});
  await ctx.close();
} finally {
  await browser.close();
}
