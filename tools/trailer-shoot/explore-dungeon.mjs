/** Recon: enter Ember Foundry, map nodes, find combat. */
import { launch, closeFast } from './lib.mjs';

const { browser, page, errors } = await launch(63);
try {
  await page.evaluate(() => window.__menu('dungeons'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document.querySelector('button[data-a="dungeon"][data-id="d-ember"]')?.click();
  });
  await page.waitForTimeout(2500);
  console.log('state:', JSON.stringify(await page.evaluate(() => window.__state())));
  console.log('dungeon:', JSON.stringify(await page.evaluate(() => window.__dungeon())));
  await page.screenshot({ path: 'C:/tmp/dng0.png' });
  const nodes = await page.evaluate(() => window.__stuck?.()?.nodes ?? window.__nodes?.() ?? null);
  console.log('nodes:', JSON.stringify(nodes)?.slice(0, 800));
} finally {
  await closeFast(browser, page);
}
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
