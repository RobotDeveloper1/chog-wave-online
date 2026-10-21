/**
 * Photograph a fold. Small and deterministic: stand on the gate, ask the server for the run, wait
 * out the tear, then walk the first corridor and shoot it.
 *
 * The full plane probe goes through the gate's own interaction, which is the right way to test the
 * gate but a bad way to test the *field* -- one flaky click and there is no picture at all.
 *
 * node tools/shoot-fold.mjs [baseUrl] [tokenId] [dungeonId]
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
// Node buffers stdout when it is a pipe or a file, and a probe that is killed loses whatever was
// still in the buffer -- which is how a run that got all the way into the fold reports "joined"
// and nothing else. Append synchronously instead, so the log on disk is the truth as it happens.
const LOG = 'C:/Users/Kauker/Desktop/chog/tools/tmp/fold-live.log';
const log = (...parts) => {
  const line = parts.join(' ');
  fs.appendFileSync(LOG, line + '\n');
};
// Every console.log in this file goes to disk synchronously, so a killed run still leaves a trail.
const realLog = console.log.bind(console);
console.log = (...parts) => { log(...parts); realLog(...parts); };

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  const tick = () => page.evaluate(() => { window.__frame(1 / 60); return window.__intro(); });
  const dims = () => page.evaluate(() => window.__luma());

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
  console.log('joined');

  // Any run the server still holds, out of the way first.
  await page.evaluate(() => window.__menu('dungeons'));
  await wait(900);
  if (await page.evaluate(() => !!document.querySelector('[data-a="leave"]'))) {
    console.log('abandoning an open run');
    await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
    for (let i = 0; i < 80; i++) { await tick(); await wait(40); if (await page.evaluate(() => !window.__state().busy)) break; }
  }
  await page.evaluate(() => window.__menu());
  await wait(400);

  // Stand on the gate and let the server see it.
  const gate = await page.evaluate(() => window.__anchors().find((a) => a.kind === 'fold'));
  if (!gate) throw new Error('no fold anchor');
  await page.evaluate((g) => window.__tp(g.x, g.z), gate);
  for (let i = 0; i < 60; i++) { await tick(); await wait(40); }
  await wait(1200);

  await page.evaluate((id) => window.__net.loop('area.open', { dungeonId: id }), DUNGEON);
  for (let i = 0; i < 200; i++) { await tick(); await wait(40); if (await page.evaluate(() => !!window.__dungeon())) break; }
  if (!(await page.evaluate(() => !!window.__dungeon()))) {
    console.log('never entered. state:', JSON.stringify(await page.evaluate(() => window.__state())));
    throw new Error('no fold');
  }
  for (let i = 0; i < 300; i++) {
    const st = await tick(); await wait(40);
    if (st && !st.custom && st.k >= 1) break;
  }
  await wait(900);

  const report = async (tag) => {
    const d = await page.evaluate(() => window.__dungeon());
    const cam = await page.evaluate(() => window.__cam());
    const mean = await dims();
    await page.screenshot({ path: path.join(OUT, `fold-${DUNGEON}-${tag}.png`), timeout: 25000 }).catch(() => {});
    console.log(`\n[${tag}] rig=${cam.rig} lens.y=${d.camY} chog ${d.pos.x},${d.pos.z} lights=${d.lights} luma=${JSON.stringify(mean)}`);
    console.log(`  mood: ${JSON.stringify(await page.evaluate(() => {
      const st = window.__chog?.stage;
      const fog = st?.scene?.fog;
      return { fogK: st?.mood?.fogK ?? null, far: fog ? +fog.far.toFixed(0) : null, dist: st ? +st.camera.position.distanceTo(st.director.focusPoint()).toFixed(0) : null };
    }))}`);
    return d;
  };

  await report('entry');

  // Walk to the room the run opened next to the mouth, and shoot the corridor on the way.
  const next = await page.evaluate(() => {
    const d = window.__dungeon();
    const here = d.nodes.find((n) => n.here);
    return d.nodes.find((n) => n.reachable && !n.cleared && !n.here && here) ?? null;
  });
  if (next) {
    await page.evaluate((t) => window.__drive(t.x, t.z, 6), next);
    await report('corridor');
    for (let i = 0; i < 60; i++) { await tick(); await wait(40); }
    await report('at-room');
  }
  console.log(`\npage errors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`);
  await ctx.close();
} finally {
  await browser.close();
}
