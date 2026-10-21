/**
 * Shoot one dungeon room from several framings in a single browser session.
 *
 * Finding a camera in a chamber is guesswork -- the room is 16 across, the rock around it is 8
 * tall, and the crystals are exactly where you want to stand. Each framing costs a page load and a
 * warm-up, so this does them all in one launch and writes `sweep/<tag>-<i>.png`.
 *
 * node tools/sweep-band-framing.mjs [dungeonId] [cam] [tag] [ "pos|look|fov" ... ]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = 'http://localhost:5173';
const DUNGEON = process.argv[2] ?? 'd-frost';
const CAM = process.argv[3] ?? 'band';
const TAG = process.argv[4] ?? 'sweep';
const SHOTS = process.argv.slice(5);
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs/sweep';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (let i = 0; i < SHOTS.length; i++) {
    const [pos, look, fov] = SHOTS[i].split('|');
    const q = `d=${DUNGEON}&cam=${CAM}&pos=${pos}&look=${look}&fov=${fov}`;
    await page.goto(`${BASE}/dungeon-debug.html?${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__ready === true', null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(4500);
    const out = path.join(OUT, `${TAG}-${i}.png`);
    await page.screenshot({ path: out });
    console.log(`saved ${path.basename(out)}  pos=${pos} look=${look} fov=${fov}`);
  }
  console.log(JSON.stringify(await page.evaluate(() => window.__info())));
  await ctx.close();
} finally {
  await browser.close();
}
