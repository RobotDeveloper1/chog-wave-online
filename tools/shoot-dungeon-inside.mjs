/**
 * Captures each fold from the inside, using the real dungeon field.
 *
 * `client/dungeon-debug.html` builds the same `buildDungeonField()` the shell builds when you
 * walk into a fold, so this is the actual place and not a mock-up. `cam=walk` puts the camera
 * at eye level in a room; `cam=close` pulls back enough to read the layout of the room.
 *
 * node tools/shoot-dungeon-inside.mjs [baseUrl] [cam]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5174';
const CAM = process.argv[3] ?? 'walk';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

const ELEMENTS = ['burn', 'frost', 'volt', 'wave', 'prism', 'void'];

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

try {
  for (const el of ELEMENTS) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dungeon-debug.html?el=${el}&cam=${CAM}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__ready === true', null, { timeout: 45000 }).catch((e) => console.log(el, 'wait:', e.message));
    // Let the motes drift and the props animate before the shutter.
    await page.waitForTimeout(3000);
    const out = path.join(OUT, `inside-${CAM}-${el}.png`);
    await page.screenshot({ path: out });
    const tag = await page.$eval('#tag', (e) => e.textContent);
    console.log('saved', path.basename(out), '|', tag.trim());
    await ctx.close();
  }
} finally {
  await browser.close();
}
