/** 10-sheet: the album — NFT traits logged as progression. */
import { launch, startRec, stopRec, saveShot, closeFast } from './lib.mjs';

const { browser, page, errors, birth } = await launch(61);
let take;
try {
  await page.evaluate(() => window.__menu('album'));
  await page.waitForTimeout(1500);
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  await page.mouse.move(1400, 700);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(2500);
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, '10-sheet'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
