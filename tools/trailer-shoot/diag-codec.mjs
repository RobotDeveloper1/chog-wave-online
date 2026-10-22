import { launch } from './lib.mjs';
const { browser, page } = await launch(42);
try {
  await page.bringToFront();
  const walkP = page.evaluate(() => window.__walkTo(window.__pos().x + 14, window.__pos().z + 6, 8));
  console.log(await page.evaluate(() => (async () => {
    const vs = document.querySelector('canvas').captureStream(30);
    const t = vs.getVideoTracks()[0];
    const mk = (mime) => {
      const chunks = [];
      try {
        const r = new MediaRecorder(vs.clone(), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
        r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data.size); };
        r.start(500);
        return { r, chunks };
      } catch (e) { return { err: String(e) }; }
    };
    // NOTE: same-stream clones can starve each other; run sequentially.
    const out = { track: { state: t.readyState, muted: t.muted } };
    for (const mime of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
      const { r, chunks, err } = mk(mime);
      if (err) { out[mime] = { err }; continue; }
      await new Promise((res) => setTimeout(res, 2500));
      r.stop();
      await new Promise((res) => { r.onstop = res; });
      out[mime] = { n: chunks.length, bytes: chunks.reduce((a, b) => a + b, 0), state: r.state };
    }
    return out;
  })()));
  console.log('walk:', await walkP);
} finally {
  await browser.close();
}
