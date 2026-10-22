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
  await page.evaluate(() => window.__net.loop('line.travel', { region: 'tolls' }));
  await page.waitForFunction(() => window.__line().line === 'tolls', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 12; i++) {
    if (!(await page.evaluate(() => window.__state().dialogue))) break;
    await page.keyboard.press('e'); await page.waitForTimeout(450);
    await page.keyboard.press('1'); await page.waitForTimeout(450);
  }
  const m0 = await page.evaluate(() => {
    const m = window.__lastMobs().find((x) => x.alive);
    return { x: m.x, z: m.z, id: m.id };
  });
  console.log('mob0:', JSON.stringify(m0));
  await page.evaluate(([x, z]) => window.__tp(x, z), [m0.x + 3, m0.z + 3]);
  await page.waitForTimeout(1000);
  console.log('me:', JSON.stringify(await page.evaluate(() => window.__pos())));
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1500);
    console.log(`t${i}:`, await page.evaluate((id) => {
      const m = window.__lastMobs().find((x) => x.id === id);
      return m ? `${m.x.toFixed(1)},${m.z.toFixed(1)}` : 'gone';
    }, m0.id), 'duel:', await page.evaluate(() => window.__state().duel));
  }
} finally {
  await browser.close();
}
