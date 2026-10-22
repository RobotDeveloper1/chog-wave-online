import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const EXEC = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath: EXEC, headless: false });
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  await page.goto('http://localhost:5173/?chog=42&debug=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.pk-enter', { timeout: 20000, state: 'attached' });
  await page.evaluate(() => {
    const ghost = [...document.querySelectorAll('[class*="pk-"]')].find((e) => /#42/.test(e.textContent ?? ''));
    if (document.querySelector('.pk-enter')?.disabled) ghost?.click();
    document.querySelector('.pk-enter')?.click();
  });
  await page.waitForFunction(() => typeof window.__duel === 'function', null, { timeout: 60000 });
  console.log('booted');
  const info = await page.evaluate(() => new Promise((res) => {
    const c = document.querySelector('canvas');
    let frames = 0;
    const t0 = performance.now();
    const tick = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res({ w: c?.width ?? 0, h: c?.height ?? 0, fps: frames / 2 }); };
    requestAnimationFrame(tick);
  }));
  console.log('canvas/fps:', JSON.stringify(info));
  console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
} finally {
  await browser.close();
}
