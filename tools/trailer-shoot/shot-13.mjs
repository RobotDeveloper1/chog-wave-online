/** 13-anomaly (raw): surge → banner → station → pulse in → user fights.
 * Saves the raw take; the final ≤25s window is cut after review. */
import { launch, startRec, stopRec, saveShot, closeFast } from './lib.mjs';

const { browser, page, errors, birth } = await launch(62);
let take;
try {
  await fetch('http://localhost:8787/api/dev/surge?n=12', { method: 'POST' });
  await page.waitForTimeout(2500);
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  await page.waitForTimeout(2000);
  console.log('walk:', await page.evaluate(() => window.__walkTo(-2, -44.8, 25)));
  await page.keyboard.press('e');
  await page.waitForTimeout(1200);
  let pulsed = false;
  for (let i = 0; i < 6 && !pulsed; i++) {
    const opts = await page.evaluate(() => [...document.querySelectorAll('button')]
      .map((b) => (b.textContent ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 12));
    console.log('opts:', JSON.stringify(opts));
    pulsed = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /pulse into the anomaly/i.test(x.textContent ?? ''));
      if (b) { b.click(); return true; }
      return false;
    });
    if (!pulsed) {
      await page.keyboard.press('e');
      await page.waitForTimeout(1000);
    }
  }
  console.log('pulsed:', pulsed);
  if (!pulsed) throw new Error('NO-ANOMALY-OPTION');
  await page.waitForFunction(() => window.__state().duel === true, null, { timeout: 20000 });
  console.log('USER-PLAY');
  await page.waitForTimeout(22000);
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, 'zz-13-raw'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
