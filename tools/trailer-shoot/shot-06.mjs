/** 06-ambush: walk in from spawn, aggro, chase, contact, arena opens. */
import { launch, startRec, stopRec, saveShot, closeFast, gotoLine, trioCentroid } from './lib.mjs';

const { browser, page, errors, birth } = await launch(44);
let take;
try {
  await gotoLine(page);
  const trio = await trioCentroid(page);
  console.log('trio:', JSON.stringify(trio));
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  // No teleport: contact is server-side, and only a tracked walk from spawn
  // crosses live aggro. The road walk doubles as the take's opening.
  const walkP = page.evaluate(([x, z]) => window.__walkTo(x, z, 45), [trio.x, trio.z]);
  try {
    await page.waitForFunction(() => window.__state().duel === true, null, { timeout: 40000 });
    await page.waitForTimeout(2500);
  } catch {
    console.log('NO-CONTACT');
  }
  console.log('walk:', await walkP);
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, '06-ambush', 'tolls'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
