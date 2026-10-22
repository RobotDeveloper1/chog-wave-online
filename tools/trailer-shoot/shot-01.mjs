/** 01-login (tease): gate vista, connect click, real Privy popup, hold. No approval. */
import { launchGate, startRec, stopRec, saveShot, closeFast } from './lib.mjs';

const c = await launchGate(false);
await c.page.waitForTimeout(2500); // gate vista settle
const rec = await startRec(c.page, c.birth);
await c.page.waitForTimeout(7000); // clean gate hold (popup needs allowlisted origin + wallet)
const take = await stopRec(c.page, rec);
await closeFast(c.browser, c.page);
console.log('wrote', await saveShot(take, '01-login'));
process.exit(0);
