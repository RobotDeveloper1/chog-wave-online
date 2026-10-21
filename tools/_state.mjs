import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');
const browser = await chromium.launch({
  executablePath: 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5176/?debug=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
const demoTab = page.locator('.pk-tab', { hasText: 'DEMO' }).first();
await demoTab.waitFor({ state: 'visible', timeout: 60000 });
await demoTab.click();
await page.waitForSelector('.pk-demo-input', { state: 'visible', timeout: 30000 });
await page.evaluate(() => {
  const i = document.querySelector('.pk-demo-input');
  i.focus(); i.value = '1';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await page.waitForFunction('typeof window.__net === "object"', null, { timeout: 30000 });
await page.waitForTimeout(4000);
const dump = await page.evaluate(() => ({
  dungeon: window.__dungeon()?.name ?? null,
  state: window.__state ? window.__state() : null,
  intro: window.__intro ? window.__intro() : null,
  own: (window.__net?.world?.players ?? []).find(p => p.id === window.__net?.me?.id) ?? null,
  rows: (window.__net?.world?.players ?? []).length,
}));
console.log(JSON.stringify(dump, null, 1));
await browser.close();
