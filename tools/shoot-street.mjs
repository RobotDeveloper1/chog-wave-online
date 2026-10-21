/**
 * Photographs the street the old isometric was standing on.
 *
 * The lens used to be nailed to a corner of the world, so the only way to judge the city was from
 * above it. Behind the back, the same buildings have to read from a body's height — which is a
 * different test, and the one the game is actually played at.
 *
 * It walks the Chog rather than teleporting it, because the point of the shot is the gait: the
 * walk, the run, and the moment the lens swings round behind the shoulders as the Chog turns.
 *
 * node tools/shoot-street.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5176';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const drive = async (n) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__frame(1 / 60)); await wait(8); } };

  await page.goto(`${BASE}/?chog=1&debug=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction("!!document.querySelector('.pk-ghost')", null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const c = document.querySelector('.pk-ghost');
    if (c && !c.classList.contains('sel')) c.click();
  });
  await page.evaluate(() => document.querySelector('.pk-enter')?.click());
  await page.waitForFunction('typeof window.__net === "object"', null, { timeout: 30000 });
  await page.waitForTimeout(3500);
  await drive(6);

  // The welcome run restored by the server, if there is one, has to be dropped or the Chog is
  // standing in a fold instead of on its own street.
  if (await page.evaluate(() => !!window.__dungeon())) {
    await page.evaluate(() => window.__menu('dungeons'));
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
    for (let i = 0; i < 60 && (await page.evaluate(() => !!window.__dungeon() || window.__state().busy)); i++) {
      await page.evaluate(() => window.__frame(1 / 60));
      await wait(60);
    }
    await page.evaluate(() => window.__menu());
  }
  await page.evaluate(() => { window.__key('escape'); window.__key('escape'); });
  await wait(500);

  console.log('town:', JSON.stringify(await page.evaluate(() => window.__town())));
  console.log('at boot, cam =', JSON.stringify(await page.evaluate(() => window.__cam())));

  await page.screenshot({ path: path.join(OUT, 'street-a-spawn.png') });

  // A short walk, held long enough for the gait to settle and the lens to come round behind the
  // shoulders. Then a long run, which is the case the old code could not express.
  await page.evaluate(() => window.__drive(-6, 18, 1.1));
  await drive(10);
  await page.screenshot({ path: path.join(OUT, 'street-b-walk.png') });

  await page.evaluate(() => window.__drive(-30, 60, 2.2));
  await drive(14);
  const pos = await page.evaluate(() => window.__pos());
  await page.screenshot({ path: path.join(OUT, 'street-c-run.png') });
  console.log('after the run:', JSON.stringify(pos), 'cam =', JSON.stringify(await page.evaluate(() => window.__cam())));

  // And the turn: the lens is behind the back now, so the body has to lead and the view follow.
  await page.evaluate(() => window.__key('q'));
  await drive(8);
  await page.screenshot({ path: path.join(OUT, 'street-d-turn.png') });
  console.log('after the turn, cam =', JSON.stringify(await page.evaluate(() => window.__cam())));

  if (errors.length) console.log('page errors:\n' + errors.slice(0, 8).join('\n'));
  await ctx.close();
} catch (e) {
  console.log('FAILED:', e.message);
} finally {
  await browser.close();
}
