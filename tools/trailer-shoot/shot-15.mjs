/** 15-party: A invites headless B, B accepts, duo walks. */
import { launch, startRec, stopRec, saveShot, closeFast } from './lib.mjs';

const A = await launch(65);
const B = await launch(66, true);
let take;
try {
  await A.page.evaluate(() => window.__menu('party'));
  await A.page.waitForTimeout(1500);
  const rec = await startRec(A.page, A.birth);
  console.log('rec:', rec.a, rec.m);
  await A.page.waitForTimeout(800);
  await A.page.evaluate(() => document.querySelector('[data-p="invite"]')?.click());
  await B.page.waitForSelector('[data-p="accept"]', { timeout: 15000 });
  await B.page.evaluate(() => document.querySelector('[data-p="accept"]')?.click());
  const two = await A.page.waitForFunction(
    () => /PARTY\s*2\/4/.test(document.body.innerText), null, { timeout: 15000 })
    .then(() => true).catch(() => false);
  console.log('party-2/4:', two);
  await A.page.waitForTimeout(2500);
  await A.page.evaluate(() => {
    document.querySelector('button[data-a="close"]')?.click();
  });
  await A.page.waitForTimeout(500);
  const t = await A.page.evaluate(() => { const p = window.__pos(); return [p.x + 12, p.z + 4]; });
  await Promise.all([
    A.page.evaluate(([x, z]) => window.__walkTo(x, z, 5), t),
    B.page.evaluate(([x, z]) => window.__walkTo(x, z, 5), t),
  ]);
  take = await stopRec(A.page, rec);
} finally {
  await closeFast(A.browser, A.page);
  await closeFast(B.browser, B.page);
}
console.log('wrote', await saveShot(take, '15-party'));
console.log('errors:', A.errors.length ? A.errors.slice(0, 3) : 'none');
process.exit(0);
