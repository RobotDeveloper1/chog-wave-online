/** Explore: ambush a mob, dump duel object shape + UI selectors. */
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
  await page.evaluate(() => window.__net.loop('line.travel', { region: 'tolls' }));
  await page.waitForTimeout(4000);
  for (let i = 0; i < 12; i++) {
    const d = await page.evaluate(() => window.__state().dialogue);
    if (!d) break;
    await page.keyboard.press('e');
    await page.waitForTimeout(500);
    await page.keyboard.press('1');
    await page.waitForTimeout(500);
  }
  console.log('dialogue-clear:', await page.evaluate(() => window.__state().dialogue));
  const trio = await page.evaluate(() => {
    const by = new Map();
    for (const m of window.__lastMobs()) {
      if (!by.has(m.encounterId)) by.set(m.encounterId, []);
      by.get(m.encounterId).push(m);
    }
    for (const [id, ms] of by) if (ms.length >= 3) return { id, x: ms[0].x, z: ms[0].z };
    return null;
  });
  console.log('trio:', JSON.stringify(trio));
  console.log('walk:', await page.evaluate(([x, z]) => window.__walkTo(x, z, 60), [trio.x, trio.z]));
  await page.waitForFunction(() => window.__state().duel === true, null, { timeout: 30000 });
  console.log('DUEL OPEN');
  await page.waitForTimeout(3000);
  console.log('duelobj:', await page.evaluate(() => {
    const d = window.__duelobj();
    const v = d?.view;
    return JSON.stringify({ keys: d ? Object.keys(d) : null,
      boss: v?.boss ? { hp: v.boss.hp, max: v.boss.maxHp, name: v.boss.name } : null,
      hand: v?.you?.hand ? { open: v.you.hand.open, cells: v.you.hand.cells?.length } : null,
      over: d?.phase ?? null });
  }));
  console.log('hand-ui:', await page.evaluate(() =>
    ['.customopen', '.d-hand', '.sf-hand', '.handopen', '.d-cells', '.deck']
      .map((s) => `${s}=${document.querySelectorAll(s).length}`).join(' ')));
} finally {
  await browser.close();
}
