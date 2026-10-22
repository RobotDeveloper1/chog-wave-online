/** Recon: deck DOM after buying 2 cards (row + add selectors, pool count). */
import { launch, closeFast } from './lib.mjs';

const { browser, page, errors } = await launch(59);
try {
  await page.evaluate(() => window.__menu('shop'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document.querySelector('button[data-a="buy"][data-id="deepchill"]')?.click();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.querySelector('button[data-a="buy"][data-id="cinderfang"]')?.click();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__menu('deck'));
  await page.waitForTimeout(1200);
  console.log('deck-html:', await page.evaluate(() =>
    document.querySelector('.fd-list')?.innerHTML.replace(/\s+/g, ' ').slice(0, 600) ?? 'none'));
  console.log('coll-html:', await page.evaluate(() =>
    [...document.querySelectorAll('[data-add]')].map((b) => b.getAttribute('data-add')).join(',')));
  await page.screenshot({ path: 'C:/tmp/deck-probe.png' });
} finally {
  await closeFast(browser, page);
}
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
