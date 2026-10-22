/** 09-reward + 11-deck, user-played: you fight, the bot loots and builds.
 * Walk to the trio, hand the duel to the human, then claim, pick up the
 * drops, buy and drive the deck for both takes. Takes save after close. */
import { launch, startRec, stopRec, saveShot, closeFast, gotoLine, trioCentroid } from './lib.mjs';

const { browser, page, errors, birth } = await launch(60);
const takes = {};
try {
  await gotoLine(page);
  const trio = await trioCentroid(page);
  console.log('trio:', JSON.stringify(trio));
  await page.evaluate(([x, z]) => window.__walkTo(x, z, 60), [trio.x, trio.z]);
  await page.waitForFunction(() => window.__state().duel === true, null, { timeout: 70000 });
  await page.waitForTimeout(1500);
  console.log('USER-PLAY');
  try {
    await page.waitForFunction(() => window.__state().duel === false, null, { timeout: 240000 });
  } catch { console.log('PLAY-TIMEOUT'); }
  const claim = await page.evaluate((enc) => window.__net.loop('line.clear', { encounterId: enc }), trio.id);
  console.log('claim:', JSON.stringify(claim));
  await page.waitForTimeout(2000);
  const o = await page.evaluate(() => window.__pos());
  for (const [dx, dz] of [[3, 0], [0, 3], [-3, 0], [0, -3], [2, 2]]) {
    await page.evaluate(([x, z]) => window.__walkTo(x, z, 4), [o.x + dx, o.z + dz]);
    await page.mouse.click(960, 620);
    await page.keyboard.press('e');
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.__menu('shop'));
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document.querySelector('button[data-a="buy"][data-id="deepchill"]')?.click();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.querySelector('button[data-a="buy"][data-id="cinderfang"]')?.click();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__menu('deck'));
  await page.waitForTimeout(1200);
  console.log('pool:', await page.evaluate(() =>
    [...document.querySelectorAll('[data-add]')].map((b) => b.getAttribute('data-add')).join(',')));
  let rec = await startRec(page, birth);
  console.log('rec09:', rec.a, rec.m);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('[data-act="auto"]')?.click());
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('[data-act="save"]')?.click());
  await page.waitForTimeout(2500);
  takes.r09 = await stopRec(page, rec);
  const swappable = await page.evaluate(() => {
    const inDeck = new Set([...document.querySelectorAll('.fdr')].map((b) => b.getAttribute('data-id')));
    const add = [...document.querySelectorAll('[data-add]')].find((b) => !inDeck.has(b.getAttribute('data-add')) && !b.disabled);
    return add?.getAttribute('data-add') ?? null;
  });
  console.log('swappable:', swappable);
  if (swappable) {
    rec = await startRec(page, birth);
    console.log('rec11:', rec.a, rec.m);
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('.fdr')?.click());
    await page.waitForTimeout(800);
    await page.evaluate((id) => document.querySelector(`[data-add="${id}"]`)?.click(), swappable);
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelector('[data-act="save"]')?.click());
    await page.waitForTimeout(2500);
    takes.r11 = await stopRec(page, rec);
  }
} finally {
  await closeFast(browser, page);
}
if (takes.r09) console.log('wrote', await saveShot(takes.r09, '09-reward'));
if (takes.r11) console.log('wrote', await saveShot(takes.r11, '11-deck'));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
process.exit(0);
