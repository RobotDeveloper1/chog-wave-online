/** Recon: party tab buttons with two players online. */
import { launch, closeFast } from './lib.mjs';

const A = await launch(65);
const B = await launch(66, true);
try {
  await A.page.evaluate(() => window.__menu('party'));
  await A.page.waitForTimeout(1500);
  console.log('data-p:', JSON.stringify(await A.page.evaluate(() =>
    [...document.querySelectorAll('[data-p]')].map((b) =>
      `${b.getAttribute('data-p')}:${b.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40)}`))));
  await A.page.screenshot({ path: 'C:/tmp/party2.png' });
} finally {
  await closeFast(A.browser, A.page);
  await closeFast(B.browser, B.page);
}
console.log('errors:', A.errors.length ? A.errors.slice(0, 3) : 'none');
process.exit(0);
