/** Recon: click a deck row, dump selection + add states. */
import { launch, closeFast } from './lib.mjs';

const { browser, page, errors } = await launch(60);
try {
  await page.evaluate(() => window.__menu('deck'));
  await page.waitForTimeout(1200);
  const dump = () => page.evaluate(() => ({
    rows: [...document.querySelectorAll('.fd-col:first-child .fdr')].map((r) => `${r.getAttribute('data-id')}[${r.className}]`),
    adds: [...document.querySelectorAll('[data-add]')].map((b) => `${b.getAttribute('data-add')}:${b.disabled ? 'off' : 'ON'}`),
    msg: document.querySelector('.fd-msg')?.textContent?.trim() ?? '',
  }));
  console.log('before:', JSON.stringify(await dump()));
  await page.evaluate(() => document.querySelector('.fd-col:first-child .fdr')?.click());
  await page.waitForTimeout(800);
  console.log('after-click:', JSON.stringify(await dump()));
} finally {
  await closeFast(browser, page);
}
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
