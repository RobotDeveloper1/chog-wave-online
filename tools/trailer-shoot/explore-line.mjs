/** Explore: line travel, mob shapes, ambush, duel object. No recording. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');
const EXEC = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await chromium.launch({ executablePath: EXEC, headless: false,
  args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
  await page.goto('http://localhost:5173/?chog=42&debug=1&capture=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.pk-enter', { timeout: 20000, state: 'attached' });
  await page.evaluate(() => { document.querySelector('.pk-enter')?.click(); });
  await page.waitForFunction(() => typeof window.__duel === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('l');
  await page.waitForTimeout(1200);
  console.log('line-tab-btns:', await page.evaluate(() =>
    [...document.querySelectorAll('button[data-a="travel"]')].map((b) => b.getAttribute('data-id'))));
  await page.evaluate(() => window.__net.loop('line.travel', { region: 'tolls' }));
  await page.waitForTimeout(4000);
  console.log('line:', JSON.stringify(await page.evaluate(() => window.__line())).slice(0, 500));
  console.log('mobs:', JSON.stringify(await page.evaluate(() => window.__lastMobs())).slice(0, 800));
  console.log('pos:', JSON.stringify(await page.evaluate(() => window.__pos())));
} finally {
  await browser.close();
}
