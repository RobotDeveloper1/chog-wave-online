/**
 * What is that violet column? Enter a fold, then list everything in the scene that stands above
 * the floor, with its type, size and material colour.
 *
 * node tools/probe-fold-objects.mjs [baseUrl] [tokenId] [dungeonId]
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5176';
const TOKEN = process.argv[3] ?? '1';
const DUNGEON = process.argv[4] ?? 'd-ember';
const LOG = 'C:/Users/Kauker/Desktop/chog/tools/tmp/objects.log';
fs.writeFileSync(LOG, '');
const log = (s) => { fs.appendFileSync(LOG, s + '\n'); };

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
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
  await wait(4000);

  // Clear any run first, through the tab.
  await page.evaluate(() => window.__menu('dungeons'));
  await wait(900);
  if (await page.evaluate(() => !!document.querySelector('[data-a="leave"]'))) {
    await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
    for (let i = 0; i < 80; i++) { await tick(); await wait(40); if (await page.evaluate(() => !window.__state().busy)) break; }
  }
  await page.evaluate(() => window.__menu());
  await wait(400);

  const gate = await page.evaluate(() => window.__anchors().find((a) => a.kind === 'fold'));
  await page.evaluate((g) => window.__tp(g.x, g.z), gate);
  for (let i = 0; i < 60; i++) { await tick(); await wait(40); }
  await wait(1200);
  await page.evaluate((id) => window.__net.loop('area.open', { dungeonId: id }), DUNGEON);
  for (let i = 0; i < 200; i++) { await tick(); await wait(40); if (await page.evaluate(() => !!window.__dungeon())) break; }
  await wait(2500);
  log('in fold: ' + JSON.stringify(await page.evaluate(() => !!window.__dungeon())));
  log('mood: ' + JSON.stringify(await page.evaluate(() => {
    const st = window.__chog?.stage;
    if (!st) return 'no stage';
    const fog = st.scene.fog;
    return {
      moodFogK: st.mood?.fogK ?? null,
      fog: fog ? { near: +fog.near.toFixed(1), far: +fog.far.toFixed(1), color: '#' + fog.color.getHexString() } : null,
      camDist: +st.camera.position.distanceTo(st.director.focusPoint()).toFixed(1),
      focusY: +st.director.focusPoint().y.toFixed(1),
    };
  })));

  const rows = await page.evaluate(() => {
    const stage = window.__chog?.stage;
    if (!stage) return [{ err: 'no stage on __chog' }];
    const d = window.__dungeon();
    const px = d?.pos?.x ?? 0;
    const pz = d?.pos?.z ?? 0;
    const out = [];
    stage.scene.traverse((o) => {
      const m = o;
      if (!m.isMesh && !m.isSprite) return;
      const w = new m.position.constructor();
      m.getWorldPosition(w);
      // Anything within a room of the player, however it is placed.
      if (Math.hypot(w.x - px, w.z - pz) > 14) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const col = mat && mat.color ? `#${mat.color.getHexString()}` : '-';
      const sc = m.scale;
      const chain = [];
      for (let p = m.parent; p && chain.length < 8; p = p.parent) chain.push(p.name || p.type);
      out.push({
        type: m.type, vis: m.visible, parentVis: m.parent?.visible ?? null,
        chain: chain.join(' < '),
        y: +w.y.toFixed(2), dx: +(w.x - px).toFixed(1), dz: +(w.z - pz).toFixed(1),
        sx: +sc.x.toFixed(2), sy: +sc.y.toFixed(2), sz: +sc.z.toFixed(2),
        col, geo: m.geometry?.type ?? '-', blend: mat?.blending ?? '-',
      });
    });
    return out.sort((a, b) => b.y - a.y).slice(0, 40);
  });
  log('objects above y=2.2:');
  for (const r of rows) log('  ' + JSON.stringify(r));
  await ctx.close();
} finally {
  await browser.close();
}
