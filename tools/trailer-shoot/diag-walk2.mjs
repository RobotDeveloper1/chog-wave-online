import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');
const EXEC = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath: EXEC, headless: false,
  args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.goto('http://localhost:5173/?chog=42&debug=1&capture=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.pk-enter', { timeout: 20000, state: 'attached' });
  await page.evaluate(() => { document.querySelector('.pk-enter')?.click(); });
  await page.waitForFunction(() => typeof window.__duel === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  const t0 = Date.now();
  const wp = page.evaluate(() => window.__walkTo(window.__pos().x + 20, window.__pos().z, 10));
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(50);
    samples.push(await page.evaluate(() => window.__pos().moving));
  }
  console.log('elapsed-start:', Date.now() - t0, 'moving-samples:', samples.join(''));
  console.log('walk says:', await wp, 'total-ms:', Date.now() - t0);
} finally {
  await browser.close();
}
