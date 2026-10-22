import { launch, startRec, stopRec, saveShot } from './lib.mjs';
const { browser, page } = await launch(42);
try {
  console.log('rec:', JSON.stringify(await startRec(page)));
  console.log('walk:', await page.evaluate(() => window.__walkTo(window.__pos().x + 14, window.__pos().z + 6, 8)));
  console.log(await page.evaluate(() => ({
    v: window.__chunksV.length, vb: window.__chunksV.reduce((a, b) => a + b.size, 0),
    a: (window.__chunksA ?? []).length, ab: (window.__chunksA ?? []).reduce((a, b) => a + b.size, 0),
    stV: window.__recV.state, stA: window.__recA?.state ?? null,
    vis: document.visibilityState, hasFocus: document.hasFocus(),
  })));
  const take = await stopRec(page);
  console.log('take bytes:', take.video.length, take.audio.length);
  console.log('wrote', saveShot(take, '03-street'));
} finally {
  await browser.close();
}
