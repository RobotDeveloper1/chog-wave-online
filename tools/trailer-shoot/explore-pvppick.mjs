/** PvP via net protocol with social.nearby ids, then crack the loadout phase. */
import { launch, clearDialogue, closeFast } from './lib.mjs';

const A = await launch(71, false);
const B = await launch(72, true);
await Promise.all([clearDialogue(A.page), clearDialogue(B.page)]);
await A.page.waitForFunction(() => window.__social.nearby.length > 0, null, { timeout: 25000 });
const bid = await A.page.evaluate(() => window.__social.nearby.find(p => p.tokenId === 72)?.id ?? null);
console.log('bid:', bid);
await A.page.evaluate((b) => window.__net.send('pvp', { action: 'challenge', with: b, wager: 50 }), bid);
await B.page.waitForFunction(() => /to a brawl/i.test(document.body.innerText), null, { timeout: 15000 });
console.log('B prompted');
await B.page.evaluate(() => window.__net.send('pvp', { action: 'accept' }));
await A.page.waitForFunction(() => window.__state().duel === true, null, { timeout: 20000 });
console.log('A in duel');
await A.page.waitForTimeout(2000);
for (const [tag, pg] of [['A', A.page], ['B', B.page]]) {
  const r = await pg.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => /^\s*\d\d\s+\w/.test(b.textContent || ''));
    btns.forEach(b => b.click());
    return { clicked: btns.length, hand: !!document.querySelector('.duel-hand') };
  });
  console.log(tag, 'loadout clicks:', JSON.stringify(r));
}
await A.page.waitForTimeout(5000);
console.log('A after:', await A.page.evaluate(() => ({
  hand: !!document.querySelector('.duel-hand'),
  handBtns: document.querySelectorAll('.duel-hand button[data-i]').length,
  btns: [...document.querySelectorAll('button')].map(b => (b.textContent || '').slice(0, 24)).slice(0, 14),
})));
await A.page.screenshot({ path: 'C:/tmp/pvp-pick.png' });
console.log('shot C:/tmp/pvp-pick.png');
await closeFast(A.browser, A.page);
await closeFast(B.browser, B.page);
process.exit(0);
