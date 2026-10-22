/** Recon: force a volume surge, catch the spawn banner, find the entry. */
import { launch, closeFast } from './lib.mjs';

const { browser, page, errors } = await launch(50);
try {
  console.log('anchors:', JSON.stringify(await page.evaluate(() => window.__anchors())));
  const r = await fetch('http://localhost:8787/api/dev/surge?n=12', { method: 'POST' });
  console.log('surge POST:', r.status);
  await page.waitForTimeout(3000);
  console.log('banner-text:', JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll('.toast, .banner, .notice, [role="alert"], .d-event')]
      .map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 6))));
  await page.screenshot({ path: 'C:/tmp/anom-banner.png' });
  console.log('state:', JSON.stringify(await page.evaluate(() => window.__state())));
} finally {
  await closeFast(browser, page);
}
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
