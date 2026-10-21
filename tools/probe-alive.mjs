/**
 * Is the page alive? Join, then poke it once a second and print whatever it throws.
 *
 * node tools/probe-alive.mjs [baseUrl] [tokenId]
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5176';
const TOKEN = process.argv[3] ?? '1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });

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
  console.log('joined');
  await wait(4000);

  for (let i = 0; i < 6; i++) {
    try {
      const state = await page.evaluate(() => ({ ok: true, state: window.__state(), dungeon: !!window.__dungeon() }), { timeout: 2500 });
      console.log(`t=${i}s`, JSON.stringify(state));
    } catch (e) {
      console.log(`t=${i}s BLOCKED: ${e.message.split('\n')[0]}`);
    }
    await wait(1000);
  }

  try {
    console.log('calling __menu("dungeons")...');
    await page.evaluate(() => window.__menu('dungeons'), { timeout: 4000 });
    console.log('menu ok');
  } catch (e) {
    console.log('menu BLOCKED:', e.message.split('\n')[0]);
  }
  await ctx.close();
} finally {
  await browser.close();
}
