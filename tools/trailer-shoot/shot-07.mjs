/** 07-duel: hand, program, preview, execute. */
import { launch, startRec, stopRec, saveShot, closeFast, gotoLine, trioCentroid, fightProgram } from './lib.mjs';

const { browser, page, errors, birth } = await launch(45);
let take;
try {
  await gotoLine(page);
  const trio = await trioCentroid(page);
  await page.evaluate(([x, z]) => window.__walkTo(x, z, 60), [trio.x, trio.z]);
  await page.waitForFunction(() => window.__state().duel === true, null, { timeout: 70000 });
  await page.waitForTimeout(2000);
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  console.log('after-program:', JSON.stringify(await fightProgram(page)));
  await page.waitForTimeout(3000);
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, '07-duel'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
