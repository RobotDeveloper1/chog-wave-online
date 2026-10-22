/** 17-callout: A right-clicks B, wagers $CHOG, B accepts, bout opens. */
import { launch, startRec, stopRec, saveShot, closeFast, clearDialogue } from './lib.mjs';

const A = await launch(67);
const B = await launch(68, true);
let take;
try {
  await Promise.all([clearDialogue(A.page), clearDialogue(B.page)]);
  const rec = await startRec(A.page, A.birth);
  console.log('rec:', rec.a, rec.m);
  await A.page.waitForTimeout(1000);
  await A.page.mouse.click(960, 560, { button: 'right' });
  await A.page.waitForTimeout(1200);
  const menu = await A.page.evaluate(() => !!document.querySelector('#player-menu'));
  console.log('menu:', menu);
  if (!menu) {
    await A.page.screenshot({ path: 'C:/tmp/pvp-fail.png' });
    throw new Error('NO-PLAYER-MENU');
  }
  await A.page.evaluate(() => document.querySelector('button[data-a="pvp"]')?.click());
  await A.page.waitForTimeout(1200);
  const hold = await A.page.evaluate(() => document.querySelector('#wager-picker')?.textContent?.replace(/\s+/g, ' ').slice(0, 120) ?? 'NO-PICKER');
  console.log('picker:', hold);
  await A.page.evaluate(() => {
    const m = (document.querySelector('#wager-picker')?.textContent ?? '').match(/hold ([\d.]+)/i);
    const bal = m ? parseFloat(m[1]) : 0;
    if (bal >= 50) {
      document.querySelector('#wager-picker [data-w="50"]')?.click();
    } else {
      const input = document.querySelector('#wager-picker input');
      if (input) { input.focus(); input.value = '1'; input.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  });
  await A.page.waitForTimeout(600);
  await A.page.evaluate(() => document.querySelector('#wager-picker [data-t="send"]')?.click());
  await B.page.waitForFunction(() => /to a brawl/i.test(document.body.innerText), null, { timeout: 15000 });
  await B.page.waitForTimeout(800);
  await B.page.keyboard.press('y');
  await A.page.waitForFunction(() => window.__state().duel === true, null, { timeout: 20000 });
  console.log('bout open');
  await A.page.waitForTimeout(2500);
  take = await stopRec(A.page, rec);
} finally {
  await closeFast(A.browser, A.page);
  await closeFast(B.browser, B.page);
}
console.log('wrote', await saveShot(take, '17-callout'));
console.log('errors:', A.errors.length ? A.errors.slice(0, 3) : 'none');
process.exit(0);
