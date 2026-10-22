/** Explore PvP duel DOM on A's page after bout opens (mirrors shot-18). */
import { launch, clearDialogue, closeFast } from './lib.mjs';

const A = await launch(69, false);
const B = await launch(70, true);
await Promise.all([clearDialogue(A.page), clearDialogue(B.page)]);
await A.page.evaluate(() => window.__menu('party'));
await A.page.waitForFunction(
  () => /IN THE CITY\s*[1-9]/.test(document.body.innerText), null, { timeout: 20000 });
await A.page.evaluate(() => document.querySelector('button[data-a="close"]')?.click());
await A.page.waitForTimeout(800);
await A.page.mouse.click(960, 560, { button: 'right' });
await A.page.waitForTimeout(1200);
console.log('menu:', await A.page.evaluate(() => !!document.querySelector('#player-menu')));
await A.page.evaluate(() => document.querySelector('button[data-a="pvp"]')?.click());
await A.page.waitForTimeout(1200);
await A.page.evaluate(() => document.querySelector('#wager-picker [data-w="50"]')?.click());
await A.page.waitForTimeout(600);
await A.page.evaluate(() => document.querySelector('#wager-picker [data-t="send"]')?.click());
await B.page.waitForFunction(() => /to a brawl/i.test(document.body.innerText), null, { timeout: 15000 });
await B.page.keyboard.press('y');
await A.page.waitForFunction(() => window.__state().duel === true, null, { timeout: 20000 });
console.log('A in duel');
await A.page.waitForTimeout(8000);
const dom = await A.page.evaluate(() => ({
  state: (() => { try { return window.__state(); } catch { return 'n/a'; } })(),
  hand: !!document.querySelector('.duel-hand'),
  handBtns: document.querySelectorAll('.duel-hand button[data-i]').length,
  anyDatai: document.querySelectorAll('button[data-i]').length,
  allBtns: [...document.querySelectorAll('button')].map(b => (b.textContent || '').slice(0, 30)).slice(0, 30),
  classes: [...document.querySelectorAll('[class*=duel],[class*=pvp],[class*=bout],[class*=brawl],[class*=round]')]
    .map(e => e.className).filter(Boolean).slice(0, 20),
}));
console.log(JSON.stringify(dom, null, 1));
await A.page.screenshot({ path: 'C:/tmp/pvp-dom.png' });
console.log('shot C:/tmp/pvp-dom.png');
await closeFast(A.browser, A.page);
await closeFast(B.browser, B.page);
process.exit(0);
