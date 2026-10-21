/** Drives the real Hud dialogue box and reports the portrait lifecycle checks.
 *  node tools/shoot-dialogue-hud.mjs <url> <out.png> [w] [h] */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const URL = process.argv[2] ?? 'http://localhost:5174/dialogue-hud-test.html';
const OUT = process.argv[3] ?? 'C:/Users/Kauker/Desktop/chog/outputs/dialogue-portrait.png';
const W = Number(process.argv[4]) || 1400;
const H = Number(process.argv[5]) || 820;
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 60000 }).catch((e) => console.log('wait:', e.message));
  await page.screenshot({ path: OUT });
  console.log('saved', OUT);
  const log = await page.evaluate(() => window.__log ?? []);
  console.log('--- lifecycle ---');
  for (const line of log) console.log(line);
  const afterClose = await page.evaluate(() => window.__close?.() ?? '');
  console.log('--- after close ---');
  console.log(afterClose);
  // A context leak would show up as a console warning on the next portrait; report any.
  const leak = errors.filter((e) => /context/i.test(e));
  if (leak.length) console.log('CONTEXT WARNINGS:', leak.slice(0, 4));
  if (errors.length) console.log('CONSOLE ERRORS:', errors.slice(0, 6));
} catch (e) {
  console.log('FAILED:', e.message);
} finally {
  await browser.close();
}
