/** 11-deck: swap a card out, save, hold the signature. Chog 60 already
 * holds loot + shop cards; the row must be picked BEFORE the add enables. */
import { launch, startRec, stopRec, saveShot, closeFast } from './lib.mjs';

const { browser, page, errors, birth } = await launch(60);
let take;
try {
  await page.evaluate(() => window.__menu('deck'));
  await page.waitForTimeout(1200);
  console.log('pool:', await page.evaluate(() =>
    [...document.querySelectorAll('[data-add]')].map((b) => b.getAttribute('data-add')).join(',')));
  const rec = await startRec(page, birth);
  console.log('rec:', rec.a, rec.m);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('.fd-col:first-child .fdr')?.click());
  await page.waitForTimeout(800);
  const swappable = await page.evaluate(() => {
    const inDeck = new Set([...document.querySelectorAll('.fd-col:first-child .fdr')].map((b) => b.getAttribute('data-id')));
    const add = [...document.querySelectorAll('[data-add]')].find((b) => !inDeck.has(b.getAttribute('data-add')) && !b.disabled);
    return add?.getAttribute('data-add') ?? null;
  });
  console.log('swappable:', swappable);
  if (swappable) {
    await page.evaluate((id) => document.querySelector(`[data-add="${id}"]`)?.click(), swappable);
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('[data-act="save"]')?.click());
    await page.waitForTimeout(2500);
  }
  take = await stopRec(page, rec);
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, '11-deck'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
