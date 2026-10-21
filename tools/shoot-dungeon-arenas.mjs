/**
 * Captures the duel arena of each fold, lit by its own element.
 *
 * Uses `client/duel-debug.html`, which runs a whole duel in the page against the shared session —
 * no server, no sign-in. The mobs are the real roster entries the fold rolls (see
 * `tools/dump-dungeons.mjs`), so the picture matches what the map actually spawns.
 *
 * node tools/shoot-dungeon-arenas.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5174';
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

const FOLDS = [
  { id: 'd-ember', el: 'burn', boss: 'boss_foundry', mobs: 'ember_golem,ember_spark,ember_slug' },
  { id: 'd-frost', el: 'frost', boss: 'boss_librarian', mobs: 'frost_wolf,frost_shard,frost_snow' },
  { id: 'd-volt', el: 'volt', boss: 'boss_packet', mobs: 'volt_stalker,volt_arc,volt_spark' },
  { id: 'd-wave', el: 'wave', boss: 'boss_undertow', mobs: 'wave_shark,wave_bubble,wave_drip' },
  { id: 'd-prism', el: 'prism', boss: 'boss_twin', mobs: 'prism_knight,prism_dust,prism_shard' },
  { id: 'd-void', el: 'void', boss: 'boss_index', mobs: 'void_hunter,void_wisp,void_echo' },
];

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

try {
  for (const f of FOLDS) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const url = `${BASE}/duel-debug.html?el=${f.el}&boss=${f.boss}&mobs=${f.mobs}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__ready === true', null, { timeout: 45000 }).catch((e) => console.log(f.id, 'wait:', e.message));
    // Let the rings rise and the telegraphs blink a few times before the shutter.
    await page.waitForTimeout(2600);
    const out = path.join(OUT, `arena-${f.id}.png`);
    await page.screenshot({ path: out });
    const tag = await page.$eval('#tag', (e) => e.textContent.split('\n')[1] ?? '');
    console.log('saved', path.basename(out), '|', tag.trim());
    await ctx.close();
  }
} finally {
  await browser.close();
}
