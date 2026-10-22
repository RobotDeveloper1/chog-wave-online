/** 12-trade: buy the cheapest card, balance moves. */
import { launch, startRec, stopRec, saveShot, closeFast } from './lib.mjs';

const { browser, page, errors, birth } = await launch(52);
let take;
try {
  await page.evaluate(() => window.__menu('shop'));
  await page.waitForTimeout(1500);
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document.querySelector('button[data-a="buy"][data-id="deepchill"]')?.click();
  });
  await page.waitForTimeout(3000);
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, '12-trade'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
