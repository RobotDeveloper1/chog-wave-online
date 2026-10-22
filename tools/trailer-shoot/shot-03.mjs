/** 03-street validation: 9s walking the city. */
import { launch, startRec, stopRec, saveShot, closeFast } from './lib.mjs';

const { browser, page, errors, birth } = await launch(42);
let take;
try {
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  // Fire-and-forget: the take runs a fixed 9s no matter how fast the walk ends.
  page.evaluate(() => { window.__walkTo(window.__pos().x + 16, window.__pos().z + 8, 9); });
  await page.waitForTimeout(9000);
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, '03-street'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
