/**
 * Walks the new Genesis and photographs it, from the frame a player is born in to the fold gate.
 *
 * A city is a claim about what you can see from where you are standing, and no layout file can
 * prove that. So this joins as a real token, stands where the plan puts the spawn, and reports
 * what the *engine* says about the district -- areas, anchors, solids, triangles, build time --
 * then walks the spine south and shoots every stop. The two things it is looking for are a
 * district that is walkable end to end (the fold gate is the whole point of the street) and a
 * skyline that is not one long building.
 *
 * node tools/shoot-city.mjs [baseUrl] [tokenId]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5176';
const TOKEN = process.argv[3] ?? '1';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text().slice(0, 160)); });

  const tick = () => page.evaluate(() => { window.__frame(1 / 60); return 'f'; });

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
  await wait(4000);

  // A run the server still holds open puts us *inside a fold* a second after the join -- which
  // is correct behaviour for a player, and poison for a tour of the street: every stop is then a
  // teleport inside a dungeon nobody is looking at. Out first, then look at the city.
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
    if (await page.evaluate(() => !!window.__dungeon())) throw new Error('could not leave the stale run');
  }

  const town = await page.evaluate(() => window.__town());
  console.log('town:', JSON.stringify(town, null, 1));

  const spawn = await page.evaluate(() => window.__anchors().find((a) => a.kind === 'spawn'));
  const fold = await page.evaluate(() => window.__anchors().find((a) => a.kind === 'fold'));
  const district = await page.evaluate(() => new Set(window.__anchors().map((a) => a.area)).size);
  console.log(`\nspawn ${JSON.stringify(spawn)}\nfold  ${JSON.stringify(fold)}\nareas name-check: ${district}`);

  // Walk the spine: from the station square, south along the avenue to the fold gate. A plan can
  // say the two are on a sightline; only a walk proves there is road between them.
  const stops = [];
  if (spawn) stops.push({ tag: 'spawn', x: spawn.x, z: spawn.z });
  // Halfway down the avenue, and the gate itself.
  if (fold && spawn) stops.push({ tag: 'mid-spine', x: (spawn.x + fold.x) / 2, z: (spawn.z + fold.z) / 2 - 6 });
  if (fold) stops.push({ tag: 'fold-gate', x: fold.x, z: fold.z });
  // And the west bank, to prove the river does not eat a whole half of the district.
  const oldTown = await page.evaluate(() => window.__anchors().find((a) => a.id === 'a-elder'));
  if (oldTown) stops.push({ tag: 'west-bank', x: oldTown.x, z: oldTown.z });

  for (const s of stops) {
    await page.evaluate((t) => window.__tp(t.x, t.z), s);
    for (let i = 0; i < 120; i++) {
      await tick(); await wait(30);
      const p = await page.evaluate(() => window.__pos());
      if (Math.abs(p.x - s.x) < 1.5 && Math.abs(p.z - s.z) < 1.5) break;
    }
    // A few frames of settling, so the isometric lands on its own pose.
    for (let i = 0; i < 30; i++) { await tick(); await wait(16); }
    const p = await page.evaluate(() => window.__pos());
    const luma = await page.evaluate(() => window.__luma());
    await page.screenshot({ path: path.join(OUT, `city-${s.tag}.png`), timeout: 25000 }).catch((e) => console.log(`(no shot: ${e.message.split('\n')[0]})`));
    console.log(`\n[${s.tag}] chog ${p.x},${p.z} area="${p.area}" luma=${JSON.stringify(luma)}`);
  }

  // The whole spine on one walk: the gate is the point of the city, and a player who cannot reach
  // it on foot has been given a picture, not a place.
  if (fold) {
    await page.evaluate((t) => window.__drive(t.x, t.z, 30), fold);
    const end = await page.evaluate(() => window.__pos());
    const d = Math.hypot((end.x ?? 0) - (fold.x ?? 0), (end.z ?? 0) - (fold.z ?? 0));
    console.log(`\nafter driving at the gate: chog ${end.x},${end.z} — ${d.toFixed(1)} units short`);
  }

  console.log(`\npage errors: ${errors.length ? errors.slice(0, 8).join(' | ') : 'none'}`);
  await ctx.close();
} finally {
  await browser.close();
}
