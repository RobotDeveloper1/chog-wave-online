/** 16-ranks: open the boards, scroll to our row. */
import { launch, startRec, stopRec, saveShot, closeFast } from './lib.mjs';

const { browser, page, errors, birth } = await launch(56);
let take;
try {
  await page.keyboard.press('k');
  await page.waitForTimeout(1500);
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  await page.waitForTimeout(2000);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(2500);
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, '16-ranks'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
