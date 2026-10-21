/**
 * Photographs the band standing in the rooms.
 *
 * `client/dungeon-debug.html` builds the real `buildDungeonField()` from the real `makeDungeon()`
 * map, so what this captures is the actual place -- the generated Meshy bodies, their patrol, and
 * the lock ring filling toward red as the stand-in player walks into their notice.
 *
 * cam=band  circle the first room with something alive in it
 * cam=hunt  walk a stand-in at the room, so the whole lock-and-charge can be watched
 * cam=top   the whole carved layout, to read how much bigger the fold got
 *
 * node tools/shoot-dungeon-band.mjs [baseUrl] [cam] [dungeonId] [extraQuery] [tag]
 *
 * `extraQuery` is appended verbatim, which is how a framing found with `&pos`/`&look`/`&fov` is
 * re-shot without editing this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5173';
const CAM = process.argv[3] ?? 'band';
const DUNGEON = process.argv[4] ?? 'd-ember';
const EXTRA = process.argv[5] ?? '';
const TAG = process.argv[6] ?? CAM;
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}/dungeon-debug.html?d=${DUNGEON}&cam=${CAM}${EXTRA}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 45000 }).catch((e) => console.log('wait:', e.message));

  // Long enough for the generated meshes to arrive, the patrol to sweep and any charge to land.
  await page.waitForTimeout(CAM === 'hunt' ? 16000 : 6000);

  const out = path.join(OUT, `band-${TAG}-${DUNGEON}.png`);
  await page.screenshot({ path: out });
  console.log('saved', path.basename(out));
  console.log(JSON.stringify(await page.evaluate(() => window.__info()), null, 1));
  if (errors.length) console.log('page errors:\n' + errors.slice(0, 6).join('\n'));
  await ctx.close();
} finally {
  await browser.close();
}
