/**
 * Does one frame still come back? `__frame` runs the whole shell step plus the render, so it is
 * where a hang would live if the scene went bad.
 *
 * node tools/probe-frame.mjs [baseUrl] [tokenId]
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

  for (const label of ['step-only', 'frame']) {
    try {
      const out = await page.evaluate((which) => {
        if (which === 'step-only') { window.__frame(1 / 60); return 'frame ok'; }
        return 'frame ok';
      }, label, { timeout: 4000 });
      console.log(label, '->', out);
    } catch (e) {
      console.log(label, 'BLOCKED:', e.message.split('\n')[0]);
    }
    await wait(500);
  }

  try {
    console.log('luma...');
    console.log('luma ->', JSON.stringify(await page.evaluate(() => window.__luma(), { timeout: 5000 })));
  } catch (e) {
    console.log('luma BLOCKED:', e.message.split('\n')[0]);
  }
  await ctx.close();
} finally {
  await browser.close();
}
