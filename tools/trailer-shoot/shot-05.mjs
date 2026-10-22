/** 05-pack: approach a trio, stop short of contact. */
import { launch, startRec, stopRec, saveShot, closeFast, gotoLine, trioCentroid } from './lib.mjs';

const { browser, page, errors, birth } = await launch(43);
let take;
try {
  await gotoLine(page);
  let trio = await trioCentroid(page);
  const me = await page.evaluate(() => window.__pos());
  const dx = me.x - trio.x, dz = me.z - trio.z;
  const len = Math.hypot(dx, dz) || 1;
  await page.evaluate(([x, z]) => window.__tp(x, z), [trio.x + (dx / len) * 14, trio.z + (dz / len) * 14]);
  await page.waitForTimeout(1200);
  // Re-read: the pack wanders while we set up, and a stale centroid frames trees.
  trio = await trioCentroid(page);
  console.log('trio:', JSON.stringify(trio));
  const me2 = await page.evaluate(() => window.__pos());
  const dx2 = me2.x - trio.x, dz2 = me2.z - trio.z;
  const len2 = Math.hypot(dx2, dz2) || 1;
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  page.evaluate(([x, z]) => { window.__walkTo(x, z, 8); }, [trio.x + (dx2 / len2) * 6, trio.z + (dz2 / len2) * 6]);
  await page.waitForTimeout(3500);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(3500);
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, '05-pack', 'tolls'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
