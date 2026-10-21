/**
 * Photographs the entry cinematic's tear, frame by frame, on a frozen clock.
 *
 * The real client cannot be photographed mid-tear in headless: the software renderer blocks for
 * seconds on the frames that compile a program, and the beat is a wall-clock cut -- so a single
 * block carries it from the tear to the settled pose, and the capture only ever sees the end. The
 * debug page builds the same field and plays the same `introPose()`, but it can be told what time
 * it is (`&at=<ms>`), which is the only way to look at a 2.7s move one moment at a time.
 *
 * The one thing this does not show is the shell's own camera move, which is verified by the driven
 * frames in `shoot-dungeon-intro.mjs` (they caught it at k=0.481, mid-lift, fov 52.7).
 *
 * node tools/shoot-dungeon-tear.mjs [baseUrl] [dungeonId]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5173';
const DUNGEON = process.argv[3] ?? 'd-ember';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

// `at` is milliseconds into the beat, which starts at 240 (the door fade) and runs 2,700.
const MARKS = [
  ['a-tear', 400, 'the seam splits, the flash at its peak'],
  ['b-open', 700, 'the tear at full height'],
  ['c-fade', 1100, 'the light gone, the band starting to rise'],
  ['d-lift', 1700, 'the lens leaving the seam'],
  ['e-closed', 2600, 'the seam shut, the band standing'],
  ['f-settled', 3300, 'the walk rig, where the game hands over'],
];

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  for (const [name, at, why] of MARKS) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/dungeon-debug.html?d=${DUNGEON}&cam=intro&at=${at}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__ready === true', null, { timeout: 45000 }).catch(() => {});
    // The band arrives asynchronously (a GLB per body); the rise is driven by the frozen clock, so
    // once the meshes are in they are already standing where `at` says they should be.
    await page.waitForFunction('window.__info().band > 0', null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const out = path.join(OUT, `tear-${name}.png`);
    await page.screenshot({ path: out });
    const info = await page.evaluate(() => window.__info());
    console.log(`saved ${path.basename(out)} at=${at} k=${((at - 240) / 2700).toFixed(2)} (${why}) band=${info.band}`);
    if (errors.length) console.log('  errors:', errors.slice(0, 3));
    await page.close();
  }
} catch (e) {
  console.log('FAILED:', e.message);
} finally {
  await browser.close();
}
