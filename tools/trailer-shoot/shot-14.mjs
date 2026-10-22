/** 14-dungeon: enter Ember Foundry, hold the title card + node map. */
import { launch, startRec, stopRec, saveShot, closeFast } from './lib.mjs';

const { browser, page, errors, birth } = await launch(64);
let take;
try {
  await page.evaluate(() => window.__menu('dungeons'));
  await page.waitForTimeout(1200);
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    document.querySelector('button[data-a="dungeon"][data-id="d-ember"]')?.click();
  });
  await page.waitForTimeout(8000);
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, '14-dungeon'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
