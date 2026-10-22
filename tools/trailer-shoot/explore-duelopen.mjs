/** Recon: why won't the training sim open? Probe train vs anomaly. */
import { launch, closeFast } from './lib.mjs';

const { browser, page, errors } = await launch(57);
try {
  console.log('train says:', await page.evaluate(() => window.__duel('train')));
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    console.log(i, await page.evaluate(() => window.__state().duel));
  }
  console.log('toast:', JSON.stringify(await page.evaluate(() =>
    [...document.querySelectorAll('.toast, .notice')].map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 4))));
  await fetch('http://localhost:8787/api/dev/surge?n=12', { method: 'POST' });
  await page.waitForTimeout(2500);
  console.log('anomaly says:', await page.evaluate(() => window.__duel('anomaly')));
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1000);
    console.log('a' + i, await page.evaluate(() => window.__state().duel));
  }
  await page.screenshot({ path: 'C:/tmp/duel-probe.png' });
} finally {
  await closeFast(browser, page);
}
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
