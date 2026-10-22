/** Explore: click connect on the gate, see if a Privy modal/popup appears. */
import { launchGate, closeFast } from './lib.mjs';

const c = await launchGate(false);
await c.page.waitForTimeout(2500);
console.log('enter btn:', await c.page.evaluate(() => !!document.querySelector('.pk-enter')));
await c.page.evaluate(() => document.querySelector('.pk-enter')?.click());
await c.page.waitForTimeout(4000);
const dom = await c.page.evaluate(() => ({
  pages: 'n/a',
  iframes: [...document.querySelectorAll('iframe')].map(f => (f.src || f.title || '?').slice(0, 80)),
  privy: document.body.innerHTML.toLowerCase().includes('privy-modal'),
  overlays: [...document.querySelectorAll('[class*=modal],[class*=overlay],[role=dialog]')].map(e => e.className).slice(0, 8),
  text: document.body.innerText.slice(-400),
}));
console.log(JSON.stringify(dom, null, 1));
console.log('pages in ctx:', c.page.context().pages().length);
await c.page.screenshot({ path: 'C:/tmp/privy-click.png' });
await closeFast(c.browser, c.page);
process.exit(0);
