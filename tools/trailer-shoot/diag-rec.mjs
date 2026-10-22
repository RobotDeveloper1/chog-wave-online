import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const EXEC = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath: EXEC, headless: false });
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.goto('http://localhost:5173/?chog=42&debug=1&capture=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.pk-enter', { timeout: 20000, state: 'attached' });
  await page.evaluate(() => { document.querySelector('.pk-enter')?.click(); });
  await page.waitForFunction(() => typeof window.__duel === 'function', null, { timeout: 60000 });
  await page.mouse.click(960, 540);
  await page.waitForTimeout(1500);
  console.log(await page.evaluate(() => (async () => {
    const out = { master: !!window.__master, ctxState: window.__master?.context?.state ?? null };
    const canvas = document.querySelector('canvas');
    const vs = canvas.captureStream(30);
    const vt = vs.getVideoTracks()[0];
    out.track = { state: vt.readyState, muted: vt.muted };
    // video-only recorder, 2s
    const rec = new MediaRecorder(vs, { mimeType: 'video/webm;codecs=vp9' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data.size);
    rec.start(250);
    await new Promise((r) => setTimeout(r, 2000));
    rec.stop();
    await new Promise((r) => { rec.onstop = r; });
    out.videoOnly = { chunks: chunks.length, bytes: chunks.reduce((a, b) => a + b, 0) };
    return out;
  })()));
} finally {
  await browser.close();
}
