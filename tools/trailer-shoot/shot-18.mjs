/** 18-bout: net-protocol challenge, A aligns files and KOs B. A POV. */
import { launch, startRec, stopRec, saveShot, closeFast, clearDialogue } from './lib.mjs';

const A = await launch(77, false);
const B = await launch(78, true);
await Promise.all([clearDialogue(A.page), clearDialogue(B.page)]);
await A.page.waitForFunction(() => window.__social.nearby.length > 0, null, { timeout: 25000 });
const bid = await A.page.evaluate(() => window.__social.nearby.find(p => p.tokenId === 78)?.id ?? null);
await A.page.evaluate((b) => window.__net.send('pvp', { action: 'challenge', with: b, wager: 50 }), bid);
await B.page.waitForFunction(() => /to a brawl/i.test(document.body.innerText), null, { timeout: 15000 });
await B.page.evaluate(() => window.__net.send('pvp', { action: 'accept' }));
await A.page.waitForFunction(() => window.__state().duel === true, null, { timeout: 20000 });
console.log('A in duel, rec on');
const rec = await startRec(A.page, A.birth);
for (let round = 1; round <= 8; round++) {
  if (!(await A.page.evaluate(() => window.__state().duel))) { console.log('KO confirmed'); break; }
  // Align files while the charge fills (stepping with an open hand drops the shield).
  let key = 'd';
  for (let s = 0; s < 6; s++) {
    const st = await A.page.evaluate(() => {
      const v = window.__duelobj()?.view;
      return v?.you && v?.boss ? { yf: v.you.file, bf: v.boss.file, open: !!v.you.hand?.open } : null;
    });
    if (!st || st.open || st.yf === st.bf) break;
    key = st.yf < st.bf ? 'd' : 'a';
    await A.page.keyboard.press(key);
    await A.page.waitForTimeout(700);
    const after = await A.page.evaluate(() => window.__duelobj()?.view?.you?.file ?? -1);
    if (after !== -1 && Math.abs(after - st.bf) > Math.abs(st.yf - st.bf)) key = key === 'd' ? 'a' : 'd';
  }
  const open = await A.page.waitForFunction(() => /HAND · YOUR MOVE/.test(document.body.innerText), null, { timeout: 40000 })
    .then(() => true).catch(() => false);
  if (!open) { console.log('no hand, round', round); break; }
  await A.page.waitForTimeout(600);
  // Same-element picks only: the first card locks the element, mixed screens get refused.
  const picks = await A.page.evaluate(() => {
    const cells = window.__duelobj()?.view?.you?.hand?.cells ?? [];
    if (!cells.length) return ['1'];
    const el = cells[0].card.element;
    return cells.filter(c => c.card.element === el).slice(0, 3).map(c => String(c.cell + 1));
  });
  console.log('picks', picks.join(','));
  for (const k of picks) { await A.page.keyboard.press(k); await A.page.waitForTimeout(300); }
  await A.page.keyboard.press('Enter');
  console.log('fired', round);
  await A.page.waitForTimeout(3000);
}
await A.page.waitForTimeout(4000);
const take = await stopRec(A.page, rec);
await closeFast(A.browser, A.page);
await closeFast(B.browser, B.page);
console.log('wrote', await saveShot(take, '18-bout'));
process.exit(0);
