import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');
const EXEC = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath: EXEC, headless: false,
  args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  for (const r of ['ashpine', 'marsh', 'relay', 'causeway', 'static']) {
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173/?chog=42&debug=1&capture=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.pk-enter', { timeout: 20000, state: 'attached' });
    await page.evaluate(() => { document.querySelector('.pk-enter')?.click(); });
    await page.waitForFunction(() => typeof window.__duel === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.evaluate((x) => window.__net.loop('line.travel', { region: x }), r);
    try {
      await page.waitForFunction((x) => window.__line().line === x, r, { timeout: 20000 });
    } catch {
      console.log(r, 'TRAVEL-FAIL');
      await page.close();
      continue;
    }
    await page.waitForTimeout(2500);
    const trio = await page.evaluate(() => {
      const ms = window.__lastMobs().filter((m) => m.alive);
      const by = new Map();
      for (const m of ms) {
        if (!by.has(m.encounterId)) by.set(m.encounterId, []);
        by.get(m.encounterId).push(m);
      }
      for (const [id, g] of by) if (g.length >= 3) return { id, n: g.length, x: g[0].x, z: g[0].z, arch: g[0].archetype };
      return ms.length ? { id: 'none', n: 0, x: ms[0].x, z: ms[0].z, arch: ms[0].archetype } : null;
    });
    console.log(r, JSON.stringify(trio));
    if (trio) {
      await page.evaluate(([x, z]) => window.__tp(x + 10, z + 10), [trio.x, trio.z]);
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: `C:/tmp/reg-${r}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
