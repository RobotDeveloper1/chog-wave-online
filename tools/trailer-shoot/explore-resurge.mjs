/** Recon: does a re-surge pop a fresh banner while a storm is active? */
import { launch, closeFast } from './lib.mjs';

const { browser, page, errors } = await launch(58);
try {
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:/tmp/re-a.png' });
  await fetch('http://localhost:8787/api/dev/surge?n=12', { method: 'POST' });
  await page.waitForTimeout(3000);
  console.log('texts:', JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll('.toast, .banner, .notice, [role="alert"]')]
      .map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 6))));
  await page.screenshot({ path: 'C:/tmp/re-b.png' });
} finally {
  await closeFast(browser, page);
}
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
