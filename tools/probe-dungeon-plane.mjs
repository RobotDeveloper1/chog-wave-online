/**
 * Walks into a fold and reports the one thing a screenshot cannot tell you: where each half of the
 * world is standing.
 *
 * The complaint was "I walk in and it is all black" — and then "when I reach the second room and
 * interact, things start appearing". Both of those are a *plane* problem dressed up as a lighting
 * one: a field and a chog that have drifted apart. The dark is not the mood (`setDungeonMood`
 * carries a hemi + key + fill worth ~4.5), it is the floor being six hundred units away from the
 * shoes. So this prints the fold's plane, the field's world y, the chog's world y and the lens's
 * world y, before anything has been touched and again after the first `area.step` — because a
 * re-laid platform is the one moment the plane can be dropped.
 *
 * It also walks to the second node and reports whether the proximity prompt appears at all, which
 * is the second complaint, and takes a shot at each stop so the picture can be judged.
 *
 * node tools/probe-dungeon-plane.mjs [baseUrl] [tokenId] [dungeonId]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5176';
const TOKEN = process.argv[3] ?? '1';
const DUNGEON = process.argv[4] ?? 'd-ember';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

/** Mean luminance of a shot: 0 is a black frame, ~0.2-0.5 is a lit one. */
function luma(file) {
  try {
    const buf = fs.readFileSync(file);
    // PNG is zlib; pull it apart just enough to read the raw samples. Too fiddly — use the
    // browser instead, which is what `mean` below does.
    return buf.length;
  } catch {
    return -1;
  }
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tick = () => page.evaluate(() => { window.__frame(1 / 60); return window.__intro(); });
  // Read in the render task, from the renderer's own canvas — never from an outside task, which
  // always reads black on a WebGL canvas and would diagnose the wrong end of this entirely.
  const dims = () => page.evaluate(() => window.__luma());

  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const demoTab = page.locator('.pk-tab', { hasText: 'DEMO' }).first();
  await demoTab.waitFor({ state: 'visible', timeout: 60000 });
  await demoTab.click();
  await page.waitForSelector('.pk-demo-input', { state: 'visible', timeout: 30000 });
  await page.evaluate((id) => {
    const i = document.querySelector('.pk-demo-input');
    i.focus(); i.value = String(id);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, TOKEN);
  await page.waitForFunction('typeof window.__net === "object"', null, { timeout: 30000 });
  await wait(3000);
  console.log('joined as', await page.evaluate(() => window.__me()));

  if (await page.evaluate(() => !!window.__dungeon())) {
    console.log('abandoning the stale run from a previous session');
    await page.evaluate(() => window.__menu('dungeons'));
    await wait(700);
    await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
    for (let i = 0; i < 80; i++) {
      await tick(); await wait(40);
      if (await page.evaluate(() => !window.__dungeon() && !window.__state().busy)) break;
    }
    await page.evaluate(() => window.__menu());
    await wait(400);
  } else {
    // A fresh page is a visit, not a resumption: the server may still hold an open run while the
    // client stands in the city. It shows up as the run page on the DUNGEONS tab.
    await page.evaluate(() => window.__menu('dungeons'));
    await wait(900);
    const leave = await page.evaluate(() => !!document.querySelector('[data-a="leave"]'));
    if (leave) {
      console.log('abandoning the run the server still holds');
      await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
      for (let i = 0; i < 80; i++) {
        await tick(); await wait(40);
        if (await page.evaluate(() => !window.__state().busy)) break;
      }
    }
    await page.evaluate(() => window.__menu());
    await wait(400);
  }

  // The front door: stand on the gate, press E, take the offered dungeon.
  const gate = await page.evaluate(() => window.__anchors().find((a) => a.kind === 'fold'));
  if (!gate) throw new Error('no fold anchor in this sector');
  await page.evaluate((g) => window.__tp(g.x, g.z), gate);
  for (let i = 0; i < 40; i++) {
    await tick(); await wait(40);
    if (await page.evaluate(() => window.__state().target === 'a-fold')) break;
  }
  await page.evaluate(() => window.__key('e'));
  await wait(900);
  const streetLuma = await dims();
  console.log(`\nstreet luma (control): ${JSON.stringify(streetLuma)}`);
  await page.screenshot({ path: path.join(OUT, `plane-${DUNGEON}-street.png`), timeout: 20000 }).catch(() => {});
  // The gate is a door: with a fold still open it walks straight back in, otherwise it opens the
  // list of six. Both are the same instruction from here -- get into the fold.
  if (!(await page.evaluate(() => !!window.__dungeon()))) {
    await page.evaluate((id) => document.querySelector(`[data-a="dungeon"][data-id="${id}"]`)?.click(), DUNGEON);
  }

  for (let i = 0; i < 200; i++) {
    await tick(); await wait(40);
    if (await page.evaluate(() => !!window.__dungeon())) break;
  }
  // Let the entry cinematic finish: the handover is when the walk rig takes the lens.
  for (let i = 0; i < 300; i++) {
    const st = await tick(); await wait(40);
    if (st && !st.custom && st.k >= 1) break;
  }
  await wait(800);

  const report = async (tag) => {
    const d = await page.evaluate(() => window.__dungeon());
    const st = await page.evaluate(() => window.__state());
    const mean = await dims();
    // What the city's tracker is still saying, if it is still saying anything. This is the
    // "the dungeon still has the city's markers" complaint in one string.
    const tracker = await page.evaluate(() => {
      const el = document.getElementById('hud-next');
      return el && el.classList.contains('on') ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '(off)';
    });
    await page.screenshot({ path: path.join(OUT, `plane-${DUNGEON}-${tag}.png`), timeout: 20000 }).catch(() => {});
    console.log(`\n[${tag}]`);
    if (!d) { console.log('  no field'); return d; }
    console.log(`  plane=${d.plane}  group.y=${d.groupY}  chog.y=${d.playerY}  lens.y=${d.camY}  lights=${d.lights}`);
    console.log(`  chog ${d.pos.x},${d.pos.z}  prompt="${st.target ?? ''}"  frame=${JSON.stringify(mean)}`);
    console.log(`  tracker: ${tracker}`);
    return d;
  };

  // Control: the street is a lit place, so if *it* reads black the measurement is broken, not the
  // fold. Everything below is judged against this number.
  const street = await report('street (control)');

  const first = await report('entry');
  if (!first) throw new Error('never entered the fold');

  // Walk to the node the run has opened next to the entry: that is where the second complaint
  // lives, because the re-lay of the platforms is the one moment the plane can be dropped.
  const next = await page.evaluate(() => {
    const d = window.__dungeon();
    const here = d.nodes.find((n) => n.here);
    const room = d.nodes.find((n) => n.reachable && !n.cleared && !n.here && here);
    return room ?? null;
  });
  console.log(`\nwalking to ${next ? `${next.label} (${next.x},${next.z})` : 'nothing reachable'}`);
  if (next) {
    await page.evaluate((t) => window.__drive(t.x, t.z, 8), next);
    await report('at-next-node');
    await page.evaluate(() => window.__key('e'));
    await wait(1200);
    for (let i = 0; i < 60; i++) {
      await tick(); await wait(40);
      if (await page.evaluate(() => window.__state().target)) break;
    }
    await report('after-step');
  }

  console.log(`\npage errors: ${errors.length ? errors.slice(0, 6).join(' | ') : 'none'}`);
  await ctx.close();
} finally {
  await browser.close();
}
