/**
 * Walks inside a dungeon and asks one question: does the lens actually track the Chog?
 *
 * The complaint was that the fold's camera stops following — you walk away and the shot stays
 * where it was. That is not a question you can answer by reading the rig, because the rig says
 * `follow: true`: what matters is whether the *pose* moves with the body once the entry cinematic
 * has handed the lens back. So this enters a real fold, waits for that handover, drives the chog a
 * long way across the chamber, and reports the camera's offset from it at several points along the
 * way. A follow rig keeps that offset roughly constant; a stuck one diverges without bound.
 *
 * node tools/probe-dungeon-cam.mjs [baseUrl] [tokenId] [dungeonId]
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

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tick = () => page.evaluate(() => { window.__frame(1 / 60); return window.__intro(); });

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

  // A run the server still holds is restored on boot and puts you inside the fold, so leaving is
  // the only way back to the street where the gate can be walked to.
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
  }

  // The front door: stand on the gate, press E, take the offered dungeon.
  const gate = await page.evaluate(() => window.__anchors().find((a) => a.kind === 'fold'));
  if (!gate) throw new Error('no fold anchor in this sector');
  console.log('fold gate:', JSON.stringify(gate));
  await page.evaluate((g) => window.__tp(g.x, g.z), gate);
  for (let i = 0; i < 40; i++) {
    await tick(); await wait(40);
    if (await page.evaluate(() => window.__state().target === 'a-fold')) break;
  }
  await page.evaluate(() => window.__key('e'));
  await wait(900);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-a="dungeon"]')].map((b) => b.getAttribute('data-id')));
  console.log('the sheet offers:', JSON.stringify(rows));
  await page.evaluate((id) => document.querySelector(`[data-a="dungeon"][data-id="${id}"]`)?.click(), DUNGEON);

  // Wait for the fold to be real, then for the entry cinematic to hand the lens back — that
  // handover is the moment a follow rig either starts working or doesn't.
  for (let i = 0; i < 200; i++) {
    await tick(); await wait(40);
    if (await page.evaluate(() => !!window.__dungeon())) break;
  }
  const inside = await page.evaluate(() => window.__dungeon());
  console.log('inside:', JSON.stringify(inside));
  for (let i = 0; i < 300; i++) {
    const st = await tick(); await wait(40);
    if (st && !st.custom && st.k >= 1) break;
  }
  await wait(700);

  const read = () => page.evaluate(() => ({
    pos: window.__pos(),
    cam: window.__cam(),
    intro: window.__intro(),
  }));

  const anchor = await read();
  console.log('\nat the rift, after the handover:');
  console.log(`  player ${anchor.pos.x},${anchor.pos.z}  rig=${anchor.cam.rig} pitch=${anchor.cam.pitch} fov=${anchor.cam.fov} span=${anchor.cam.span}`);
  console.log(`  cam ${anchor.pos.x.toFixed(1)}..  focusX=${anchor.cam.focusX} focusZ=${anchor.cam.focusZ} camZ=${anchor.cam.camZ} yaw=${anchor.cam.yaw}`);

  // Walk the chog somewhere else in the fold. `__drive` steps the real update loop with the real
  // virtual input, so the camera is driven exactly as it is by a player's own keys.
  const home = { x: anchor.pos.x, z: anchor.pos.z };
  const target = await page.evaluate(() => {
    const d = window.__dungeon();
    // Pick the node furthest from the spawn: a long walk is the only thing that separates a rig
    // that follows from one that is stuck.
    let best = null;
    for (const n of d.nodes) {
      if (!best || Math.hypot(n.x - d.spawn.x, n.z - d.spawn.z) > Math.hypot(best.x - d.spawn.x, best.z - d.spawn.z)) best = n;
    }
    return best ? { x: best.x, z: best.z } : { x: d.spawn.x, z: d.spawn.z };
  });
  console.log(`\nwalking to (${target.x.toFixed(1)}, ${target.z.toFixed(1)})`);

  // Sample along the way: a stuck camera shows up as a monotonically growing offset.
  const samples = [];
  await page.evaluate((t) => window.__drive(t.x, t.z, 6), target);
  for (let i = 0; i < 5; i++) {
    await page.evaluate((t) => window.__drive(t.x, t.z, 2.5), target);
    const s = await read();
    samples.push(s);
    await wait(150);
  }

  console.log('\nsamples along the walk (offset = camera focus minus the chog):');
  let worst = 0;
  for (const s of samples) {
    const dx = s.cam.focusX - s.pos.x;
    const dz = s.cam.focusZ - s.pos.z;
    const off = Math.hypot(dx, dz);
    worst = Math.max(worst, off);
    console.log(`  player ${s.pos.x},${s.pos.z}  focus ${s.cam.focusX},${s.cam.focusZ}  offset ${off.toFixed(2)}  (dx ${dx.toFixed(2)}, dz ${dz.toFixed(2)})`);
  }
  const moved = Math.hypot(samples[samples.length - 1].pos.x - home.x, samples[samples.length - 1].pos.z - home.z);
  console.log(`\nthe chog covered ${moved.toFixed(1)} units`);
  console.log(`worst focus offset along the way: ${worst.toFixed(2)} units`);

  // The rig claims `follow: true`; the pose has to agree. A few units of offset is the rig's own
  // lead smoothing toward the heading, which is by design. Dozens is a camera that stopped moving.
  const verdict = worst < 12
    ? `PASS — the lens tracks the chog (worst offset ${worst.toFixed(2)} units over a ${moved.toFixed(0)}-unit walk).`
    : `FAIL — the chog walked ${moved.toFixed(0)} units and the lens drifted ${worst.toFixed(2)} from it: the rig is not following.`;
  console.log(`\n${verdict}`);
  if (errors.length) console.log(`\npage errors:\n${errors.slice(0, 8).join('\n')}`);

  // The picture is a convenience. It is allowed to fail — a throttled headless page refusing to
  // settle its fonts must not take the measurement down with it — but say so when it does.
  try {
    await page.evaluate(() => window.__frame(1 / 60));
    await page.screenshot({ path: path.join(OUT, `cam-fold-${DUNGEON}.png`), timeout: 20000 });
    console.log(`saved cam-fold-${DUNGEON}.png`);
  } catch (e) {
    console.log(`(no screenshot: ${String(e && e.message ? e.message : e).split('\n')[0]})`);
  }

  await ctx.close();
} finally {
  await browser.close();
}
