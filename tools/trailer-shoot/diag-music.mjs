import { launch } from './lib.mjs';
const { browser, page } = await launch(42);
try {
  console.log('street:', await page.evaluate(() => JSON.stringify({
    tap: !!window.__musicTap,
    audios: [...document.querySelectorAll('audio')].map((a) => ({ paused: a.paused, vol: a.volume, src: (a.currentSrc || '').split('/').pop() })),
  })));
} finally {
  await browser.close();
}
