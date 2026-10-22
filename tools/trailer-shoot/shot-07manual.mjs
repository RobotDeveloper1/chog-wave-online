/** 07-duel-manual: the bot walks into the duel, a human plays it.
 * Run in background, then play in the Edge window when the arena opens.
 * Stops at KO (+5s drops hold), on the C:\tmp\stop07 flag, or after 240s.
 * If the window is closed mid-take, the picture so far is still salvaged.
 * Saves the raw take outside the assembly glob; finals (07/08) are cut
 * from it after review. */
import { launch, startRec, stopRec, saveShot, closeFast, gotoLine, trioCentroid } from './lib.mjs';
import { existsSync, unlinkSync } from 'node:fs';

const FLAG = 'C:\\tmp\\stop07';
try { unlinkSync(FLAG); } catch {}

const { browser, page, errors, birth } = await launch(47);
let take;
try {
  await gotoLine(page);
  const trio = await trioCentroid(page);
  console.log('trio:', JSON.stringify(trio));
  await page.evaluate(([x, z]) => window.__walkTo(x, z, 60), [trio.x, trio.z]);
  await page.waitForFunction(() => window.__state().duel === true, null, { timeout: 70000 });
  await page.waitForTimeout(1500);
  const rec = await startRec(page, birth);
  console.log('READY-PLAY rec:', rec.a, rec.m);
  let ended = false, stopped = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    if (existsSync(FLAG)) { stopped = true; break; }
    try {
      if (await page.evaluate(() => window.__state().duel === false)) { ended = true; break; }
    } catch { break; } // window closed mid-take: fall through to salvage
    await page.waitForTimeout(1000);
  }
  console.log('duel-ended:', ended, 'flag:', stopped);
  if (ended) await page.waitForTimeout(5000);
  try {
    take = await stopRec(page, rec);
  } catch (e) {
    console.log('stopRec failed, salvaging picture:', String(e).slice(0, 120));
    take = { video: page.video(), offset: rec.offset, dur: (Date.now() - rec.t0) / 1000,
      audio: Buffer.alloc(0), music: Buffer.alloc(0) };
  }
} finally {
  await closeFast(browser, page);
}
console.log('wrote', await saveShot(take, 'zz-07-raw'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
