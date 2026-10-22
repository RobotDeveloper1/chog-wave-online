/** Recon: screenshot every menu tab + list its action buttons. */
import { launch, closeFast } from './lib.mjs';

const TABS = ['home', 'career', 'bag', 'deck', 'library', 'shop', 'album', 'war', 'dungeons', 'ranks', 'party', 'social', 'jobs', 'map'];
const { browser, page, errors } = await launch(49);
try {
  for (const t of TABS) {
    await page.evaluate((x) => window.__menu(x), t);
    await page.waitForTimeout(1200);
    const btns = await page.evaluate(() => [...document.querySelectorAll('button[data-a]')]
      .map((b) => `${b.getAttribute('data-a')}${b.getAttribute('data-id') ? ':' + b.getAttribute('data-id') : ''}`).slice(0, 25));
    console.log(`### ${t}: ${btns.join(' | ')}`);
    await page.screenshot({ path: `C:/tmp/tab-${t}.png` });
  }
} finally {
  await closeFast(browser, page);
}
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
