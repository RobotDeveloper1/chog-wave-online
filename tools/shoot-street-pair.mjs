/**
 * Photographs two different Chogs standing together on the street.
 *
 * The bug this closes: a remote avatar was built by a parameterless factory with an empty trait
 * bag, so every other player rendered as the base mesh — indistinguishable from the world thinking
 * everyone is the same person. The fix threads the snapshot's `attributes`/`tokenId` through, so
 * this joins two tokens at once, stands them three units apart on ground the local player is known
 * to occupy, and shoots the street from the first one's eyes.
 *
 * `__tp` only moves bodies; it is a fixture, not the thing under test. What is under test is what
 * each client *builds* for the other, which is the real render path.
 *
 * node tools/shoot-street-pair.mjs [baseUrl] [tokenA] [tokenB] [tag]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5176';
const TOKEN_A = process.argv[3] ?? '1';
const TOKEN_B = process.argv[4] ?? '7';
const TAG = process.argv[5] ?? `pair-${TOKEN_A}-${TOKEN_B}`;
const OUT = 'C:/Users/Kauker/Desktop/chog/outputs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio'],
});

/**
 * Boot one page into the world as one token, through the picker's own buttons.
 *
 * The picker has no `?chog=` deep link and no ghost card: the way in is the DEMO tab, then the id
 * in the box, then Enter -- which is `submitDemo()`, the same code path a person uses.
 */
async function join(tokenId) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const demoTab = page.locator('.pk-tab', { hasText: 'DEMO' }).first();
  await demoTab.waitFor({ state: 'visible', timeout: 60000 });
  await demoTab.click();
  await page.waitForSelector('.pk-demo-input', { state: 'visible', timeout: 30000 });
  await page.evaluate((id) => {
    const input = document.querySelector('.pk-demo-input');
    input.focus();
    input.value = String(id);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Enter is the submit, and it goes straight to `submitDemo()` -- no button to mistype at.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, tokenId);
  // A server without DEV_TOKENS refuses here, and that is a real outcome worth reporting.
  const joined = await Promise.race([
    page.waitForFunction('typeof window.__net === "object"', null, { timeout: 30000 }).then(() => true).catch(() => false),
    page.waitForSelector('.pk-refusal, .pk-note.bad', { timeout: 30000 }).then(() => false).catch(() => false),
  ]);
  if (!joined) {
    const note = await page.evaluate(() => document.querySelector('.pk-refusal, .pk-note')?.textContent ?? '');
    throw new Error(`#${tokenId} join refused: ${note.trim()}`);
  }
  await page.waitForTimeout(3000);
  const me = await page.evaluate(() => window.__me());

  // A run the server still holds is restored on every load, so the page boots *inside* the fold
  // and never shows the street. Leaving is the only way out, and it is also the only way the
  // avatar under test is standing on the street where it can be seen.
  const bootedIn = await page.evaluate(() => window.__dungeon()?.name ?? null);
  if (bootedIn) {
    console.log(`  #${tokenId} booted inside ${bootedIn} — abandoning the stale run`);
    await page.evaluate(() => window.__menu('dungeons'));
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(120);
      const clear = await page.evaluate(() => !window.__dungeon() && !window.__state()?.busy);
      if (clear) break;
    }
    await page.evaluate(() => window.__menu());
    await page.waitForTimeout(500);
    const still = await page.evaluate(() => window.__dungeon()?.name ?? null);
    if (still) throw new Error(`#${tokenId} is still inside ${still} — the street cannot be photographed`);
  }
  return { ctx, page, me };
}

try {
  const A = await join(TOKEN_A);
  const B = await join(TOKEN_B);
  console.log(`A is ${JSON.stringify(A.me)}`);
  console.log(`B is ${JSON.stringify(B.me)}`);

  // A's own copy of the world is the thing being photographed, so B's row is read out of it.
  // Waited on rather than clocked: the world is broadcast on the server's own tick, and a fixed
  // sleep reads a snapshot that predates B's arrival.
  const seen = await A.page.evaluate(async () => {
    const rows = () => (window.__net?.world?.players ?? []);
    const meId = () => window.__net?.me?.id;
    const deadline = Date.now() + 15000;
    let other = null;
    while (Date.now() < deadline) {
      other = rows().find((p) => p.id !== meId()) ?? null;
      if (other) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    // My own row, not `__me()` -- that helper returns a callsign string, so it carries no
    // position and every offset built from it was NaN.
    const own = rows().find((p) => p.id === meId()) ?? null;
    return {
      n: rows().length,
      room: window.__net?.world?.room ?? null,
      meId: meId() ?? null,
      rowIds: rows().map((p) => p.id),
      b: other ? { id: other.id, tokenId: other.tokenId, name: other.name, x: other.x, y: other.y, attrs: other.attributes ?? null } : null,
      mine: own ? { x: own.x, y: own.y, tokenId: own.tokenId } : null,
    };
  });
  console.log(`A's snapshot: room=${seen.room} rows=${seen.n} me=${seen.meId} ids=[${seen.rowIds.join(',')}]`);
  console.log(`  B's row: ${seen.b ? `#${seen.b.tokenId} ${seen.b.name} at (${seen.b.x}, ${seen.b.y}) with ${seen.b.attrs ? Object.keys(seen.b.attrs).length + ' traits' : 'NO TRAITS'}` : 'ABSENT'}`);

  if (!seen.b) throw new Error('B is not in A\'s snapshot — different rooms, so the pair cannot be photographed');
  if (!seen.b.attrs) throw new Error('the snapshot row carries no traits, so no client could build B in their own identity');

  // Stand B three units from where A already stands. A's own position is ground the local player
  // is known to occupy, which makes it the one place neither body can be inside rock.
  const ax = seen.mine?.x ?? 0, az = seen.mine?.y ?? 0;
  await B.page.evaluate(([x, z]) => window.__tp(x, z), [ax + 3, az]);
  await A.page.waitForTimeout(2200);
  await A.page.evaluate(() => { window.__key('escape'); window.__key('escape'); });

  const after = await A.page.evaluate(() => {
    const rows = (window.__net?.world?.players ?? []);
    const meId = window.__net?.me?.id;
    const own = rows.find((p) => p.id === meId) ?? null;
    const other = rows.find((p) => p.id !== meId) ?? null;
    return { b: other ? { x: other.x, y: other.y } : null, me: own ? { x: own.x, y: own.y } : null };
  });
  const gap = after.b && after.me ? Math.hypot(after.b.x - after.me.x, after.b.y - after.me.y) : -1;
  console.log(`standing ${gap.toFixed(1)} apart`);

  await A.page.waitForTimeout(1200);
  const camAt = await A.page.evaluate(() => window.__intro ? window.__intro() : null);
  await A.page.screenshot({ path: path.join(OUT, `${TAG}.png`) });
  console.log(`saved ${TAG}.png`);
  if (camAt) console.log(`  at the shutter: fov=${camAt.fov} cam=[${(camAt.cam ?? []).map((v) => v.toFixed(1)).join(', ')}] custom=${camAt.custom} introK=${camAt.k}`);

  // The two trait bags, side by side, so the picture can be checked against the data rather than
  // read off the frame.
  const traits = await A.page.evaluate(() => {
    const rows = window.__net?.world?.players ?? [];
    return rows.map((p) => ({ tokenId: p.tokenId, name: p.name, a: p.attributes ?? {} }));
  });
  const keys = ['Head', 'Eyes', 'Mouth', 'Body', 'Skin'];
  console.log('\ntraits the local client was handed, for the bodies it built:');
  for (const t of traits) {
    console.log(`  #${t.tokenId} ${t.name}  ${keys.map((k) => `${k}=${t.a[k] ?? '-'}`).join('  ')}`);
  }
  const pick = keys.map((k) => JSON.stringify(traits.map((t) => t.a[k] ?? '')));
  const differ = pick.some((v, i) => pick.some((w, j) => i !== j && v !== w));
  console.log(`\n${differ ? 'PASS' : 'FAIL'} — the two avatars are built from ${differ ? 'different' : 'identical'} traits, so the street shows two Chogs and not one twice.`);

  await A.ctx.close();
  await B.ctx.close();
} finally {
  await browser.close();
}
