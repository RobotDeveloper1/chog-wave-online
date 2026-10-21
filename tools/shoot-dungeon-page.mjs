/** Screenshot the DUNGEONS tab with a foster login. Be patient: the picker wants a click. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5174';
const OUT = process.argv[3] ?? 'C:/Users/Kauker/Desktop/chog/outputs/dungeon-page.png';
const CHOG = process.argv[4] ?? '42';
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(`${BASE}/?chog=${CHOG}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.pk-foster', { timeout: 60000 });
  await page.click('.pk-foster');
  // The world handshake takes a beat; wait for the sheet to actually open, not the global flag.
  await page.waitForSelector('[data-t="dungeons"]', { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.click('[data-t="dungeons"]');
  await page.waitForSelector('.dg-detail', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT });
  console.log('saved', OUT);
  const rows = await page.$$eval('.dg-detail dt', (ds) => ds.map((d) => d.textContent));
  const foldKey = await page.$eval('.dg-detail dd:last-of-type', (d) => d.textContent).catch(() => '');
  console.log('detail rows:', rows.join(' | '));
  console.log('fold key text:', foldKey);
  if (errors.length) console.log('CONSOLE ERRORS:', errors.slice(0, 8));
} catch (e) {
  console.log('FAILED:', e.message);
  await page.screenshot({ path: OUT }).catch(() => {});
} finally {
  await browser.close();
}
