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
  console.log('state:', JSON.stringify(await page.evaluate(() => window.__state())));
  console.log('busy:', await page.evaluate(() => window.__busy()));
  await page.keyboard.press('w');
  await page.waitForTimeout(300);
  console.log('after-w state:', JSON.stringify(await page.evaluate(() => window.__state())));
  console.log('pos:', JSON.stringify(await page.evaluate(() => window.__pos())));
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  console.log('held-w pos:', JSON.stringify(await page.evaluate(() => window.__pos())));
  await page.keyboard.up('w');
} finally {
  await browser.close();
}
