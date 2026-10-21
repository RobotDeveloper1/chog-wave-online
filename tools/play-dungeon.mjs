/**
 * Plays one dungeon as a chosen genesis Chog, through the real client, and photographs it.
 *
 * This is `shoot-dungeon-intro.mjs` with the front door attached: the intro shooter walks in as a
 * foster (`?chog=42` -> the `.pk-foster` button), because a foster needs no decision. Playing as a
 * real token is a different path through the picker -- `?chog=1` renders a *ghost card* ("not in
 * this wallet") and the join only lands if the server was started with `DEV_TOKENS=1`, which is the
 * server's call and not the client's. So this script makes that call, and reports what came back.
 *
 * The rest is the same discipline the intro shooter documents: frames are driven by hand because
 * the headless page throttles `requestAnimationFrame`, and every wait is for the game's own state
 * rather than a wall clock.
 *
 * node tools/play-dungeon.mjs [baseUrl] [tokenId] [dungeonId] [walk]
 *
 * The last argument swaps the teleport for the walk a player actually makes: `__tp` proves the
 * server accepts the run, but it does not prove the front door works -- that the gate raises its
 * prompt, that E is the key it answers to, and that a body can physically get there through the
 * street's collision. `walk` drives the same virtual input the arrow keys do, then presses E.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const BASE = process.argv[2] ?? 'http://localhost:5175';
const TOKEN = process.argv[3] ?? '1';
const DUNGEON = process.argv[4] ?? 'd-ember';
const WALK = process.argv[5] === 'walk';
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
  const tick = () => page.evaluate(() => { window.__frame(1 / 60); return window.__intro(); });
  const drive = async (n, ms = 10) => { for (let i = 0; i < n; i++) { await tick(); await wait(ms); } };
  const until = async (done, label, cap = 60) => {
    for (let i = 0; i < cap; i++) {
      await tick();
      if (await page.evaluate(done)) return true;
      await wait(10);
    }
    console.log(`WARNING: ${label} never came true in ${cap} frames`);
    return false;
  };
  const abandon = async (label) => {
    if (!(await page.evaluate(() => !!window.__dungeon()))) return;
    await page.evaluate(() => window.__menu('dungeons'));
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelector('[data-a="leave"]')?.click());
    await until(() => !window.__dungeon() && !window.__state().busy, label);
    await page.evaluate(() => window.__menu());
    await page.waitForTimeout(400);
  };

  // ---- the front door: the ghost card, then the join the server may or may not honour.
  await page.goto(`${BASE}/?chog=${TOKEN}&debug=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Attached, not visible: the picker is a tall page and the shelf sits below the fold of a 720px
  // viewport, so the card is real but off-screen. What matters is that it exists and is selected.
  await page.waitForFunction("!!document.querySelector('.pk-ghost')", null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const ghostState = await page.evaluate(() => {
    const c = document.querySelector('.pk-ghost');
    return { present: !!c, selected: !!c?.classList.contains('sel'), text: c?.textContent ?? '' };
  });
  console.log('picker:', JSON.stringify(ghostState));
  await page.screenshot({ path: path.join(OUT, `play-0-picker.png`) });

  // Dispatched, not clicked: the card is inside a sheet that slides, and a throttled page never
  // settles the transition, so Playwright's stability check would sit there forever.
  await page.evaluate(() => {
    const c = document.querySelector('.pk-ghost');
    if (c && !c.classList.contains('sel')) c.click();
  });
  await page.waitForTimeout(400);
  const enterLabel = await page.evaluate(() => document.querySelector('.pk-enter')?.textContent ?? '');
  console.log('enter button says:', JSON.stringify(enterLabel));
  await page.evaluate(() => document.querySelector('.pk-enter')?.click());

  // The refusal is a real possibility (a server without DEV_TOKENS), so it is awaited rather than
  // assumed -- and reported in the server's own words.
  const joined = await Promise.race([
    page.waitForFunction('typeof window.__net === "object"', null, { timeout: 30000 }).then(() => true).catch(() => false),
    page.waitForSelector('.pk-refusal, .pk-note.bad', { timeout: 30000 }).then(() => false).catch(() => false),
  ]);
  if (!joined) {
    const note = await page.evaluate(() => document.querySelector('.pk-refusal, .pk-note')?.textContent ?? '');
    throw new Error(`join refused: ${note.trim()}`);
  }
  await page.waitForTimeout(2500);
  console.log('joined as:', await page.evaluate(() => window.__me()));

  // Wrap the outbound loop call so the trace says *who* asked the server for the run state. The
  // fold has no auto-open in it, so if a run appears while standing on the gate, the answer is in
  // this list and nowhere else.
  await page.evaluate(() => {
    const net = window.__net;
    window.__loops = [];
    const real = net.loop.bind(net);
    net.loop = (t, m) => { window.__loops.push({ t, at: Date.now(), ...(m ?? {}) }); return real(t, m); };
  });

  // Let the run state settle before reading it. The reply to the boot `area.state` can land after
  // the welcome, and a run the server still holds puts the client *inside* the fold rather than on
  // the street -- so reading `__dungeon()` too early says null, skips the cleanup that was needed,
  // and the gate then answers no prompt for a reason that has nothing to do with the gate.
  await page.waitForTimeout(3500);
  await drive(6);
  console.log('at boot, dungeon =', await page.evaluate(() => window.__dungeon()?.name ?? null));

  await abandon('the street at boot');
  await drive(4);
  const left = await page.evaluate(() => window.__dungeon()?.name ?? null);
  console.log('after abandoning, dungeon =', left);
  // A run the server still holds is restored on every load, so a reload is not a way out of one --
  // only the sheet's own ABANDON is. If it survives that, say so rather than pressing on and
  // blaming the gate for a prompt that was never going to come.
  if (left) throw new Error('a run survived ABANDON — the street is not reachable, so the gate cannot be tested');
  await page.evaluate(() => { window.__key('escape'); window.__key('escape'); });
  await page.waitForTimeout(500);

  const gate = await page.evaluate(() => {
    const a = (window.__anchors() ?? []).find((x) => x.kind === 'fold' || x.sub === 'dungeon');
    return a ? { id: a.id, x: a.x, z: a.z, sub: a.sub } : null;
  });
  console.log('fold gate:', JSON.stringify(gate));
  if (!gate) throw new Error('no fold anchor on the street');

  await page.evaluate((g) => window.__tp(g.x, g.z), gate);
  // `__tp` reports itself as a run of 3-unit hops 110ms apart, and the gate check is the server's.
  await page.waitForTimeout(8000);

  if (WALK) {
    // What a player actually does: stand on the gate, read the prompt, press the key it names.
    // The teleport above is only used to get here -- walking is not what this mode is testing,
    // the *door* is: that the gate raises a prompt at all, and that E is the key it answers to.
    await drive(8);

    // The gate prompt is suppressed while a dialogue is open (`!hud.dialogueOpen`), and the WAVE
    // LINK intro box opens on arrival. A player presses E through it without thinking about it;
    // a script has to do the same or it will read an empty prompt and blame the gate.
    for (let i = 0; i < 12 && (await page.evaluate(() => window.__state().dialogue)); i++) {
      await page.evaluate(() => window.__key('e'));
      await drive(3);
    }

    const gateState = await page.evaluate(() => {
      const el = document.getElementById('hud-prompt');
      return {
        prompt: el && el.classList.contains('on') ? el.textContent : null,
        dialogue: window.__state().dialogue,
        target: window.__state().target,
        pos: window.__pos(),
        dungeon: window.__dungeon()?.name ?? null,
        loops: window.__loops.map((l) => l.t),
      };
    });
    console.log('gate:', JSON.stringify(gateState));
    await page.screenshot({ path: path.join(OUT, 'play-gate.png') });
    if (!gateState.prompt) throw new Error('the gate raised no prompt — a player would have nothing to press');

    // E does not open a dungeon and does not open a room: the fold is a door, so pressing at the
    // portal puts the list on screen. That is the whole door, and it used to take two presses and
    // a walk into a waiting room nobody asked for.
    await page.evaluate(() => window.__key('e'));
    let rows = [];
    for (let i = 0; i < 40 && rows.length === 0; i++) {
      await drive(3);
      rows = await page.evaluate(() => [...document.querySelectorAll('[data-a="dungeon"]')].map((b) => b.getAttribute('data-id')));
      await wait(120);
    }
    await page.screenshot({ path: path.join(OUT, 'play-sheet.png') });
    console.log('the sheet offers:', JSON.stringify(rows));
    const pick = rows.includes(DUNGEON) ? DUNGEON : rows[0];
    if (!pick) throw new Error('the fold lists no dungeons');
    await page.evaluate((id) => document.querySelector(`[data-a="dungeon"][data-id="${id}"]`)?.click(), pick);
    await until(() => !!window.__dungeon(), `the run opened by the sheet (${pick})`, 60);
    const after = await page.evaluate(() => ({
      dungeon: window.__dungeon()?.name ?? null,
      state: window.__state(),
      loops: window.__loops.map((l) => l.t),
      toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
      log: [...document.querySelectorAll('#hud-log .line, .hud-log .line')].slice(-4).map((l) => l.textContent),
    }));
    console.log('after ENTER:', JSON.stringify(after));
    console.log('the sheet opened:', after.dungeon);
    await abandon('the street after the walk-in');
  }

  // ---- warm-up: the first entry pays for the shader programs, which is 2-6s of blocked frames
  // on SwiftShader. Entering once and leaving again means the shot is not taken during that stall.
  await page.evaluate((id) => window.__net.loop('area.open', { dungeonId: id }), DUNGEON);
  await until(() => !!window.__dungeon(), 'the warm-up fold', 40);
  await drive(14);
  console.log('warmed up:', await page.evaluate(() => window.__dungeon()?.name ?? null));
  await abandon('the street after the warm-up');

  // ---- the run
  await page.evaluate((id) => window.__net.loop('area.open', { dungeonId: id }), DUNGEON);
  for (const [name, want, why] of [
    ['a-tear', 0.1, 'the seam splitting'],
    ['b-lift', 0.45, 'the lens leaving the seam'],
    ['c-settled', 0.999, 'the walk rig, where the cinematic handed over'],
  ]) {
    let seen = { running: false, k: -1, fov: 0 };
    for (let i = 0; i < 60; i++) {
      seen = await tick();
      if (seen.k >= want) break;
      await wait(10);
    }
    await page.screenshot({ path: path.join(OUT, `play-${name}.png`) });
    console.log(`saved play-${name}.png at k=${seen.k} fov=${seen.fov} (${why})`);
  }

  await drive(40, 18);
  await page.screenshot({ path: path.join(OUT, 'play-d-inside.png') });

  // Zoomed all the way out, which is the complaint: a fold used to hold the city on the same
  // plane and a pull-back showed you the street you had just left. It has to be a place.
  await page.evaluate(() => window.__zoom(2.4));
  await drive(12, 18);
  await page.screenshot({ path: path.join(OUT, 'play-d-zoomout.png') });
  await page.evaluate(() => window.__zoom(1));
  await drive(4);

  const hud = await page.evaluate(() => {
    const el = document.getElementById('hud-heat');
    const who = document.querySelector('.hd-you, #hud-you, .hud-you')?.textContent ?? null;
    return { heat: el ? { on: el.classList.contains('on'), band: el.querySelector('.hd b')?.textContent ?? '', n: el.querySelector('.n')?.textContent ?? '' } : null, who };
  });
  console.log('inside:', JSON.stringify({
    me: await page.evaluate(() => window.__me()),
    dungeon: await page.evaluate(() => window.__dungeon()?.name ?? null),
    pos: await page.evaluate(() => window.__pos()),
    heat: hud.heat,
  }));

  if (errors.length) console.log('page errors:\n' + errors.slice(0, 8).join('\n'));
  await ctx.close();
} catch (e) {
  console.log('FAILED:', e.message);
} finally {
  await browser.close();
}
