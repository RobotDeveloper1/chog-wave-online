/** 04-line: open line tab, travel to the Tolls, close the panel, hold the
 * vista with a slow zoom. No walking: the road legs keep wandering into
 * packs and the take ends in a duel, which is shot 06's job. */
import { launch, startRec, stopRec, saveShot, closeFast } from './lib.mjs';

const { browser, page, errors, birth } = await launch(48);
let take;
try {
  await page.keyboard.press('l');
  await page.waitForTimeout(1200);
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  await page.evaluate(() => {
    document.querySelector('button[data-a="travel"][data-id="tolls"]')?.click();
  });
  await page.waitForFunction(() => window.__line().line === 'tolls', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 8; i++) {
    if (!(await page.evaluate(() => window.__state().dialogue))) break;
    await page.keyboard.press('e');
    await page.waitForTimeout(400);
    await page.keyboard.press('1');
    await page.waitForTimeout(400);
  }
  // Close the Line panel: explicit close button first, 'l' toggle as fallback.
  const closed = await page.evaluate(() => {
    const btn = document.querySelector('button[data-a="close"]');
    if (btn) { btn.click(); return 'btn'; }
    return 'none';
  });
  if (closed === 'none') await page.keyboard.press('l');
  await page.waitForTimeout(800);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(1800);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(3200);
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, '04-line', 'tolls'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
