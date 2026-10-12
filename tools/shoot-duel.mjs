/**
 * Drives the real client in a real browser and photographs the new duel.
 *
 * The duel can only be entered from the Wave Station in person, so this walks there with the
 * shell's own debug hooks rather than faking a packet the server would refuse.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const EXEC = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.SHOOT_URL ?? 'http://127.0.0.1:5173/?chog=42&debug=1';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  shot', name);
};

const browser = await chromium.launch({ executablePath: EXEC, headless: false });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('loaded');

  // The picker sits at opacity/visibility 0 behind its own loading state, so drive it from the
  // DOM rather than waiting for Playwright to consider it clickable.
  try {
    await page.waitForSelector('.pk-enter', { timeout: 20000, state: 'attached' });
    console.log('picker:', await page.evaluate(() => {
      const b = document.querySelector('.pk-enter');
      const cs = getComputedStyle(b);
      const chain = [];
      for (let n = b, i = 0; n && i < 4; i++, n = n.parentElement) {
        const s = getComputedStyle(n);
        chain.push(`${n.className || n.tagName} display=${s.display} vis=${s.visibility} op=${s.opacity}`);
      }
      return { text: b.textContent, disabled: b.disabled, rect: b.getBoundingClientRect().toJSON(), chain };
    }));
    await page.evaluate(() => {
      const ghost = [...document.querySelectorAll('[class*="pk-"]')].find((e) => /#42/.test(e.textContent ?? ''));
      if (document.querySelector('.pk-enter')?.disabled) ghost?.click();
      document.querySelector('.pk-enter')?.click();
    });
    console.log('clicked enter');
  } catch (e) {
    console.log('picker:', e.message);
    await page.screenshot({ path: `${OUT}/debug-picker.png` }).catch(() => {});
  }

  await page.waitForFunction(() => typeof window.__duel === 'function', null, { timeout: 60000 });
  console.log('shell booted');
  await page.waitForTimeout(3000);
  await shot(page, '01-street');

  const anchors = await page.evaluate(() => window.__anchors());
  const st = anchors.find((a) => a.sub === 'station');
  console.log('station', st);

  console.log('tp', await page.evaluate(([x, z]) => window.__tp(x, z), [st.x, st.z]));
  await page.waitForTimeout(4500);
  console.log('pos', await page.evaluate(() => window.__pos()));

  console.log('duel ->', await page.evaluate(() => window.__duel('train')));
  await page.waitForFunction(() => window.__state().duel === true, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot(page, '02-duel-start');

  const manual = await page.evaluate(() => document.querySelector('.d-manual')?.innerText ?? null);
  console.log('MANUAL >>', (manual ?? '').replace(/\n+/g, ' | ').slice(0, 400));
  console.log('HAS BAGHOLDER:', (manual ?? '').includes('BAGHOLDER'));
  console.log('HAS OLD JAB:', /JAB|CROSS|SWEEP/.test(manual ?? ''));

  await page.waitForSelector('.customopen', { timeout: 25000 }).catch((e) => console.log('no custom:', e.message));
  await page.waitForTimeout(700);
  await shot(page, '03-custom');

  await page.keyboard.press('1');
  await page.waitForTimeout(800);
  await shot(page, '04-picked');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await shot(page, '05-program');

  await page.waitForSelector('.d-warn.on', { timeout: 25000 }).catch((e) => console.log('no warn:', e.message));
  await page.waitForTimeout(400);
  await shot(page, '06-telegraph');
  console.log('WARN >>', await page.evaluate(() => document.querySelector('.d-warn')?.innerText ?? null));

  console.log('CONSOLE ERRORS:', errors.slice(0, 15));
} catch (e) {
  console.log('FAILED:', e.message);
} finally {
  await browser.close();
}
