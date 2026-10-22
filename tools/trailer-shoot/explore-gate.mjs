/** Recon: what does the gate picker offer the test wallet? */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: false });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await page.goto('http://localhost:5173/?chog=42&debug=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.pk-enter', { timeout: 20000, state: 'attached' });
await page.waitForTimeout(2500);
const cards = await page.evaluate(() => [...document.querySelectorAll('[class*="pk-"]')]
  .map((e) => (e.textContent ?? '').trim().replace(/\s+/g, ' ')).filter((t) => /#\d{3,}/.test(t)).slice(0, 12));
console.log('cards:', JSON.stringify(cards, null, 1));
console.log('enter-disabled:', await page.evaluate(() => document.querySelector('.pk-enter')?.disabled ?? 'missing'));
await page.screenshot({ path: 'C:/tmp/gate-picker.png' });
await browser.close();
process.exit(0);
