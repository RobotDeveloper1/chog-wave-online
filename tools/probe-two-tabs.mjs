/**
 * Two clients, one street: what does the *other* player's avatar actually look like?
 *
 * The complaint: "the person who joins shows up with no clothes, no hair" and "on both screens the
 * chog is naked". The world snapshot carries the traits (probe-remotes proves it), so if the avatar
 * is still naked the failure is on the build side -- and there are two candidates a screenshot
 * cannot tell apart: a Chog built without its parts, and a body the duel left standing in the
 * scene. This joins two tabs as the SAME token (which is what the tester did), walks them
 * together, and dumps the scene of each: every top-level group, its position, and the meshes
 * inside it. A remote Chog is a `Scene`/`Group` child at the other player's position; a leftover
 * duel body is a child that was never removed.
 *
 * node tools/probe-two-tabs.mjs [baseUrl] [tokenId]
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
const tick = (page) => page.evaluate(() => { window.__frame(1 / 60); return 'f'; });

async function join(page, tag) {
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
  const me = await page.evaluate(() => window.__me());
  const pos = await page.evaluate(() => window.__pos());
  console.log(`[${tag}] joined as ${JSON.stringify({ id: me?.id, tokenId: me?.tokenId, level: me?.level })} at ${pos.x},${pos.z}`);
  return pos;
}

try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  const pa = await join(a, 'A');
  await join(b, 'B');

  // B stands where it spawned; A walks over to B so each sees the other.
  await a.evaluate((p) => window.__tp(p.x + 2.5, p.z + 0.5), pa);
  for (let i = 0; i < 200; i++) { await tick(a); await wait(30); }
  await wait(2500);
  for (let i = 0; i < 120; i++) { await tick(b); await wait(30); }

  for (const [tag, page] of [['A', a], ['B', b]]) {
    const world = await page.evaluate(() => {
      const w = window.__net?.world;
      return (w?.players ?? []).map((p) => ({ id: p.id, tokenId: p.tokenId, x: +p.x.toFixed(1), z: +p.y.toFixed(1), nAttrs: Object.keys(p.attributes ?? {}).length }));
    });
    const scene = await page.evaluate(() => window.__scene());
    console.log(`\n[${tag}] world players: ${JSON.stringify(world)}`);
    console.log(`[${tag}] scene children:`);
    for (const s of scene) console.log(`   ${s.tag} @ ${s.x},${s.y},${s.z} meshes=${s.meshes} ${s.names.slice(0, 4).join(' ')}`);
    await page.screenshot({ path: path.join(OUT, `twotab-${tag.toLowerCase()}.png`), timeout: 25000 }).catch(() => {});
  }
  await ctx.close();
} finally {
  await browser.close();
}
