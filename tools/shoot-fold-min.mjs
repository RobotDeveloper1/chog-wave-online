/**
 * The shortest path to a picture of a fold: join, stand on the gate, ask for the run, shoot.
 * No menu, no abandon, no driving -- when the server still holds a run, `area.open` simply
 * resumes it, which is exactly the state a screenshot wants anyway.
 *
 * node tools/shoot-fold-min.mjs [baseUrl] [tokenId] [dungeonId]
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5176';
const TOKEN = process.argv[3] ?? '1';
const DUNGEON = process.argv[4] ?? 'd-ember';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.split('\n')[0]));
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
    window.__net.on('loop', (m) => { if (m.action === 'area.open' || m.action === 'area.state') window.__netlog.push({ a: m.action, ok: m.ok, reason: m.reason ?? null }); });
  });
  await wait(4500);
  console.log('joined');

  if (await page.evaluate(() => !!window.__dungeon())) {
    console.log('already in a fold');
  } else {
    const gate = await page.evaluate(() => window.__anchors().find((a) => a.kind === 'fold'));
    // The server opens a fold only for a Chog standing on the gate, and it learns where the
    // player is from walked hops -- so the teleport needs a beat to land before the ask.
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.evaluate(() => window.__menu());
      await page.evaluate((g) => window.__tp(g.x, g.z), gate);
      for (let i = 0; i < 16; i++) { await tick(); await wait(40); }
      await wait(9000);
      // Any dialogue the boot left open eats the key, so clear it before knocking on the gate.
      await page.evaluate(() => window.__chog?.hud?.closeDialogue?.());
      await wait(300);
      // The gate is the door: with a run already open it walks straight back in, and with none
      // it opens the list. Press E, then take whichever of the two happened.
      await page.evaluate(() => window.__key('e'));
      for (let i = 0; i < 20; i++) { await tick(); await wait(40); if (await page.evaluate(() => !!window.__dungeon())) break; }
      if (!(await page.evaluate(() => !!window.__dungeon()))) {
        await page.evaluate((id) => document.querySelector(`[data-a="dungeon"][data-id="${id}"]`)?.click(), DUNGEON);
      }
      for (let i = 0; i < 40; i++) { await tick(); await wait(40); if (await page.evaluate(() => !!window.__dungeon())) break; }
      if (await page.evaluate(() => !!window.__dungeon())) break;
      const why = await page.evaluate((g) => ({
        log: window.__netlog.slice(-3),
        clientPos: window.__pos(),
        serverPos: (window.__net.world?.players ?? []).find((p) => p.id === window.__net.me?.id) ?? null,
        gate: g,
      }), gate);
      console.log(`attempt ${attempt + 1}: refused — ${JSON.stringify(why)}`);
    }
  }
  const inFold = await page.evaluate(() => !!window.__dungeon());
  console.log('in fold:', inFold);
  if (!inFold) console.log('state:', JSON.stringify(await page.evaluate(() => window.__state())));

  await wait(2500);
  for (let i = 0; i < 12; i++) { await tick(); await wait(30); }
  const info = await page.evaluate(() => ({
    d: window.__dungeon(), luma: window.__luma(),
    mood: (() => { const st = window.__chog?.stage; const f = st?.scene?.fog; return { fogK: st?.mood?.fogK, near: f ? +f.near.toFixed(0) : null, far: f ? +f.far.toFixed(0) : null }; })(),
  }));
  console.log('luma', JSON.stringify(info.luma), 'fog', JSON.stringify(info.mood));
  await page.screenshot({ path: `${OUT}/fold-min-${DUNGEON}.png`, timeout: 30000 });
  console.log('saved', `${OUT}/fold-min-${DUNGEON}.png`);
  await ctx.close();
} finally {
  await browser.close();
}
