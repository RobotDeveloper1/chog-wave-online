/** Recon: surge, walk to the Wave Station, enter, find the terminal. */
import { launch, closeFast } from './lib.mjs';

const { browser, page, errors } = await launch(51);
try {
  await fetch('http://localhost:8787/api/dev/surge?n=12', { method: 'POST' });
  await page.waitForTimeout(2500);
  console.log('walk1:', await page.evaluate(() => window.__walkTo(-2, -44.8, 25)));
  await page.keyboard.press('e');
  await page.waitForTimeout(1500);
  console.log('state:', JSON.stringify(await page.evaluate(() => window.__state())));
  await page.screenshot({ path: 'C:/tmp/st-inside.png' });
} finally {
  await closeFast(browser, page);
}
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
