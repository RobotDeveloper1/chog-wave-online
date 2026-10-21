/**
 * Photographs the real thing: the actual client, entered through the actual Fold Gate.
 *
 * `dungeon-debug.html` builds the field on its own, which proves the place. This proves the
 * *game*: the shell's entry cinematic, the forge meter, and the band standing in the corridor --
 * every one of which lives in `shell.ts` and none of which the debug page can reach.
 *
 * It boots as a foster Chog (`?chog=42`), walks the avatar onto the Fold Gate, opens the fold
 * through the same loop call the DUNGEONS tab makes, and shoots the tear.
 *
 * Three things about headless make this harder than it looks, and all three are dealt with rather
 * than worked around:
 *
 *   1. Everything inside the page is starved. `requestAnimationFrame` runs about once a second and
 *      `setTimeout` is throttled with it, so the beat would be over before it drew a frame. The
 *      frames are therefore driven from here through `__frame()`, and each mark waits for the
 *      cinematic's *own* progress (`__intro().k`) instead of a wall clock.
 *   2. The software renderer blocks for two to six seconds on the frames that compile a program, and
 *      the cinematic is a wall-clock cut -- so one block can carry it from the tear to the end. The
 *      first fold is entered and abandoned again to pay for the programs, and the marks are
 *      thresholds rather than instants: each shot reports the `k` it actually caught.
 *   3. A foster profile keeps whatever run the last session left open, and the server pushes it back
 *      on login. A stale run would mean the fold is already open at boot and the cinematic is over
 *      before the first mark, so any open run is abandoned first -- through the sheet's own button,
 *      because a bare `area.close` does not put the client back on the street.
 *
 * node tools/shoot-dungeon-intro.mjs [baseUrl] [dungeonId]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5173';
const DUNGEON = process.argv[3] ?? 'd-ember';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /** One driven frame, and the cinematic's state after it. */
  const tick = () => page.evaluate(() => { window.__frame(1 / 60); return window.__intro(); });
  const drive = async (n, ms = 10) => { for (let i = 0; i < n; i++) { await tick(); await wait(ms); } };
  const heat = () => page.evaluate(() => {
    const el = document.getElementById('hud-heat');
    return el ? { on: el.classList.contains('on'), band: el.querySelector('.hd b')?.textContent ?? '', n: el.querySelector('.n')?.textContent ?? '' } : null;
  });
  /** Drive frames until the game itself says `done`. Every step the game takes is a page timer. */
  const until = async (done, label, cap = 60) => {
    for (let i = 0; i < cap; i++) {
      await tick();
      if (await page.evaluate(done)) return true;
      await wait(10);
    }
    console.log(`WARNING: ${label} never came true in ${cap} frames`);
    return false;
  };
  /** Walk out of a fold the way a player does: the sheet's own ABANDON button. */
  const abandon = async (label) => {
    if (!(await page.evaluate(() => !!window.__dungeon()))) return;
    await page.evaluate(() => window.__menu('dungeons'));
    await page.waitForTimeout(700);
    // Dispatched rather than clicked: the sheet slides up on a CSS transition, and in a page this
    // throttled the animation never settles, so Playwright's stability check would never pass.
    await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
    await until(() => !window.__dungeon() && !window.__state().busy, label);
    await page.evaluate(() => window.__menu());
    await page.waitForTimeout(400);
  };

  await page.goto(`${BASE}/?chog=42&debug=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.pk-foster', { timeout: 60000 });
  await page.click('.pk-foster');
  await page.waitForFunction('typeof window.__net === "object"', null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  await abandon('the street at boot');
  await page.evaluate(() => { window.__key('escape'); window.__key('escape'); });
  await page.waitForTimeout(500);
  console.log('start: dungeon =', await page.evaluate(() => window.__dungeon()?.name ?? null));

  // The gate: a fold is a door, so the server will only open one for an avatar standing on it.
  const gate = await page.evaluate(() => {
    const a = (window.__anchors() ?? []).find((x) => x.kind === 'fold' || x.sub === 'dungeon');
    return a ? { id: a.id, x: a.x, z: a.z, sub: a.sub, area: a.area } : null;
  });
  console.log('gate:', JSON.stringify(gate));
  if (!gate) throw new Error('no fold anchor on the street');

  await page.evaluate((g) => window.__tp(g.x, g.z), gate);
  // `__tp` reports itself to the server as a run of 3-unit hops 110ms apart, and the gate check is
  // the server's: a 150-unit jump is 50 hops, so this is not a one-frame wait.
  await page.waitForTimeout(8000);

  // ---- warm-up: enter once, pay for the shader programs, abandon, and enter again for the shot.
  await page.evaluate((id) => window.__net.loop('area.open', { dungeonId: id }), DUNGEON);
  await until(() => !!window.__dungeon(), 'the warm-up fold', 40);
  await drive(14);
  console.log('warmed up, dungeon =', await page.evaluate(() => window.__dungeon()?.name ?? null));
  await abandon('the street after the warm-up');
  console.log('street again: dungeon =', await page.evaluate(() => window.__dungeon()?.name ?? null));

  // ---- the shot
  await page.evaluate((id) => window.__net.loop('area.open', { dungeonId: id }), DUNGEON);
  const marks = [
    ['a-tear', 0.1, 'the seam splitting, the flash coming up'],
    ['b-lift', 0.45, 'the lens leaving the seam'],
    ['c-settled', 0.999, 'the walk rig, exactly where the cinematic handed over'],
  ];
  for (const [name, want, why] of marks) {
    let seen = { running: false, k: -1 };
    for (let i = 0; i < 60; i++) {
      seen = await tick();
      if (seen.k >= want) break;
      await wait(10);
    }
    const out = path.join(OUT, `intro-${name}.png`);
    await page.screenshot({ path: out });
    console.log(`saved ${path.basename(out)} at k=${seen.k} (${why})`, JSON.stringify({
      cam: seen.cam, fov: seen.fov, custom: seen.custom,
      dungeon: await page.evaluate(() => window.__dungeon()?.name ?? null),
      heat: await heat(),
    }));
  }

  // ---- and then let it breathe: the forge cycles, the meter climbs, the band walks.
  await drive(45, 18);
  await page.screenshot({ path: path.join(OUT, 'intro-d-forge.png') });
  console.log('saved intro-d-forge.png', JSON.stringify({
    dungeon: await page.evaluate(() => window.__dungeon()?.name ?? null),
    pos: await page.evaluate(() => window.__pos()),
    heat: await heat(),
  }));

  if (errors.length) console.log('page errors:\n' + errors.slice(0, 8).join('\n'));
  await ctx.close();
} catch (e) {
  console.log('FAILED:', e.message);
} finally {
  await browser.close();
}
