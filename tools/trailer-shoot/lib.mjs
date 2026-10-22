/** Trailer capture lib: Playwright video (composited page) + in-page audio.
 *
 * Video is Playwright's recorder: the full composite (canvas AND DOM UI — a
 * canvas tap misses the hand, menus and picker) at uniform 25fps, independent
 * of window visibility. Audio comes from in-page recorders on the game's own
 * sfx master (?capture=1 exposes window.__master) and music analyser
 * (window.__musicTap). ffmpeg trims the video to the take and muxes it all.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const EXEC = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const SHOTS = 'C:/Users/Kauker/Desktop/chog/docs/trailer/shots';

export const ffmpeg = () => execFileSync('python',
  ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],
  { encoding: 'utf8' }).trim();

export async function launchGate(headless = false) {
  const browser = await chromium.launch({ executablePath: EXEC, headless,
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'] });
  mkdirSync(SHOTS, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: SHOTS, size: { width: 1920, height: 1080 } } });
  const page = await ctx.newPage();
  const birth = Date.now();
  await page.goto('http://localhost:5173/?debug=1&capture=1', { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('.pk-connect') ?? window.__state, null, { timeout: 30000 });
  return { browser, page, birth };
}

export async function launch(chog = 42, headless = false) {
  const browser = await chromium.launch({ executablePath: EXEC, headless,
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'] });
  mkdirSync(SHOTS, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: SHOTS, size: { width: 1920, height: 1080 } } });
  const page = await ctx.newPage();
  const birth = Date.now();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(`http://localhost:5173/?chog=${chog}&debug=1&capture=1`,
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.pk-enter', { timeout: 20000, state: 'attached' });
  await page.evaluate(() => {
    const re = new RegExp('#' + new URLSearchParams(location.search).get('chog'));
    const ghost = [...document.querySelectorAll('[class*="pk-"]')].find((e) => re.test(e.textContent ?? ''));
    if (document.querySelector('.pk-enter')?.disabled) ghost?.click();
    document.querySelector('.pk-enter')?.click();
  });
  await page.waitForFunction(() => typeof window.__duel === 'function', null, { timeout: 60000 });
  // A real click: synthetic evaluate-clicks grant no user activation, and the
  // AudioContext (hence window.__master) only unlocks on a real gesture.
  await page.mouse.click(960, 540);
  await page.waitForFunction(() => !!window.__master, null, { timeout: 15000 }).catch(() => 'no-master');
  await page.waitForTimeout(1500);
  return { browser, page, errors, birth };
}

const SETUP_REC = `(() => {
  let a = 0;
  const master = window.__master;
  if (master?.context) {
    const dest = master.context.createMediaStreamDestination();
    // Pinned: an unreferenced destination is GC'd mid-take (fast on busy
    // scenes), which ends the audio track and starves the mix.
    window.__dest = dest;
    master.connect(dest);
    const recA = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
    window.__chunksA = [];
    recA.ondataavailable = (e) => { if (e.data.size) window.__chunksA.push(e.data); };
    recA.start(250);
    window.__recA = recA;
    a = 1;
  }
  // Music lives in its own AudioContext (untappable from the sfx graph), so it
  // gets its own recorder; ffmpeg mixes the beds below.
  let m = 0;
  const tap = window.__musicTap;
  if (tap?.context) {
    const destM = tap.context.createMediaStreamDestination();
    window.__destM = destM;
    tap.connect(destM);
    const recM = new MediaRecorder(destM.stream, { mimeType: 'audio/webm;codecs=opus' });
    window.__chunksM = [];
    recM.ondataavailable = (e) => { if (e.data.size) window.__chunksM.push(e.data); };
    recM.start(250);
    window.__recM = recM;
    m = 1;
  }
  return { a, m };
})()`;

export async function startRec(page, birth) {
  const t0 = Date.now();
  const info = await page.evaluate(SETUP_REC);
  // The page video runs since birth; the take is trimmed to [t0, stop] below.
  return { ...info, t0, offset: (t0 - birth) / 1000 };
}

async function pullChunks(page, key) {
  const n = await page.evaluate((k) => (window[k] ?? []).length, key);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const b64 = await page.evaluate(([k, idx]) => new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(window[k][idx]);
    }), [key, i]);
    parts.push(Buffer.from(b64, 'base64'));
  }
  return Buffer.concat(parts);
}

export async function stopRec(page, rec) {
  const t = Date.now();
  const stamp = (m) => console.log(`[stopRec] ${m} +${Date.now() - t}ms`);
  // One evaluate per chunk: a whole take as a single base64 string corrupts
  // over CDP, while ~250ms slices (~400KB) pass through intact.
  // The onstop wait is raced: the timeslice chunks are already pushed by
  // ondataavailable, so a stuck stop event must not hang the take.
  await Promise.race([
    page.evaluate(() => new Promise((res) => {
      const recs = [window.__recA, window.__recM].filter(Boolean);
      if (!recs.length) return res(0);
      let left = recs.length;
      for (const r of recs) { r.onstop = () => { if (--left === 0) res(0); }; r.stop(); }
    })),
    new Promise((res) => setTimeout(() => res('onstop-timeout'), 10000)),
  ]).then((v) => stamp(v === 'onstop-timeout' ? 'onstop TIMEOUT' : 'onstop ok'));
  await page.waitForTimeout(400);
  const dur = (Date.now() - rec.t0) / 1000;
  const video = page.video();
  const audio = await pullChunks(page, '__chunksA');
  stamp(`audio ${audio.length}b`);
  const music = await pullChunks(page, '__chunksM');
  stamp(`music ${music.length}b`);
  return { video, offset: rec.offset, dur, audio, music };
}

export async function clearDialogue(page, rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    const d = await page.evaluate(() => window.__state().dialogue);
    if (!d) return true;
    await page.keyboard.press('e');
    await page.waitForTimeout(450);
    await page.keyboard.press('1');
    await page.waitForTimeout(450);
  }
  return !(await page.evaluate(() => window.__state().dialogue));
}

export async function gotoLine(page, region = 'tolls') {
  await page.evaluate((r) => window.__net.loop('line.travel', { region: r }), region);
  await page.waitForFunction((r) => window.__line().line === r, region, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await clearDialogue(page);
}

/** Walk into the nearest trio until teeth meet: re-reads live positions each
 *  leg, because a stale centroid frames trees while the pack wanders off. */
export async function huntTrio(page, legs = 6) {
  for (let i = 0; i < legs; i++) {
    if (await page.evaluate(() => window.__state().duel)) return 'ambushed';
    const trio = await trioCentroid(page);
    if (!trio) return 'no-trio';
    await page.evaluate(([x, z]) => window.__walkTo(x, z, 8), [trio.x, trio.z]);
  }
  return (await page.evaluate(() => window.__state().duel)) ? 'ambushed' : 'missed';
}

export const trioCentroid = (page) => page.evaluate(() => {
  const by = new Map();
  for (const m of window.__lastMobs()) {
    if (!m.alive) continue;
    if (!by.has(m.encounterId)) by.set(m.encounterId, []);
    by.get(m.encounterId).push(m);
  }
  let best = null;
  for (const [id, ms] of by) {
    if (ms.length >= 3 && (!best || ms.length > best.n)) {
      const x = ms.reduce((s, m) => s + m.x, 0) / ms.length;
      const z = ms.reduce((s, m) => s + m.z, 0) / ms.length;
      best = { id, n: ms.length, x, z };
    }
  }
  return best;
});

export const bossHp = (page) => page.evaluate(() => {
  const v = window.__duelobj()?.view;
  return v?.boss ? { hp: v.boss.hp, max: v.boss.maxHp, name: v.boss.name } : null;
});

export const handOpen = (page) => page.evaluate(() => !!window.__duelobj()?.view?.you?.hand?.open);

export async function waitHand(page, timeout = 20000) {
  await page.waitForFunction(() => !!window.__duelobj()?.view?.you?.hand?.open, null, { timeout });
}

export async function fightProgram(page, picks = ['1', '2']) {
  await waitHand(page);
  await page.waitForTimeout(600);
  for (const k of picks) {
    await page.keyboard.press(k);
    await page.waitForTimeout(700);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4500);
  return bossHp(page);
}

export async function waitDuelEnd(page, timeout = 60000) {
  await page.waitForFunction(() => window.__state().duel === false, null, { timeout });
}

/** Play a duel to the end: each hand waits for the charge (picks fired
 * during HAND IN are ignored and the screen refuses to execute), programs
 * three cards and fires. Returns 'won' when the duel closes. */
export async function fightToWin(page, maxHands = 12, picks = ['1', '2', '3']) {
  for (let h = 0; h < maxHands; h++) {
    if (!(await page.evaluate(() => window.__state().duel))) return 'won';
    await waitHand(page);
    await page.waitForFunction(() => !document.body.innerText.includes('HAND IN'), null, { timeout: 25000 });
    for (const k of picks) {
      await page.keyboard.press(k);
      await page.waitForTimeout(600);
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3500);
  }
  return (await page.evaluate(() => window.__state().duel)) ? 'stalled' : 'won';
}

export async function closeFast(browser, page) {
  const t = Date.now();
  try { await Promise.race([page.context().close().then(() => console.log(`[close] ctx +${Date.now() - t}ms`)), new Promise(r => setTimeout(() => { console.log(`[close] ctx TIMEOUT +${Date.now() - t}ms`); r(0); }, 20000))]); } catch (e) { console.log('[close] ctx err', String(e).slice(0, 80)); }
  try { await Promise.race([browser.close().then(() => console.log(`[close] browser +${Date.now() - t}ms`)), new Promise(r => setTimeout(() => { console.log(`[close] browser TIMEOUT +${Date.now() - t}ms`); r(0); }, 10000))]); } catch (e) { console.log('[close] browser err', String(e).slice(0, 80)); }
}

export async function saveShot(take, name, grade = null) {
  const t = Date.now();
  mkdirSync(SHOTS, { recursive: true });
  const mp4 = `${SHOTS}/${name}.mp4`;
  const src = await take.video.path();
  console.log(`[save] path +${Date.now() - t}ms: ${src}`);
  // Pass 1: trim the page video to [offset, offset+dur]. Input -ss jumps
  // to the nearest seek point (fast no matter how late the take starts) and
  // a small output -ss finishes the cut frame-accurately. The beds already
  // start at the take, so only the picture is cut here.
  // -nostdin: with inherited stdio ffmpeg blocks reading interactive stdin
  // from the managed shell pipe and the take hangs forever.
  const vfs = ['scale=1920:1080'];
  if (grade === 'tolls') vfs.push('eq=brightness=0.10:contrast=1.12:saturation=1.25');
  const cut = `${SHOTS}/${name}.cut.mp4`;
  const pre = Math.max(0, take.offset - 3);
  execFileSync(ffmpeg(), ['-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-ss', pre.toFixed(2), '-i', src,
    '-map', '0:v', '-vf', vfs.join(','), '-ss', (take.offset - pre).toFixed(2), '-t', take.dur.toFixed(2),
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-an', '-movflags', '+faststart', cut], { stdio: ['ignore', 'inherit', 'inherit'] });
  console.log(`[save] pass1 +${Date.now() - t}ms`);
  // Pass 2: beds mix, then pad with silence to the picture; -shortest ends
  // the endlessly-padded bed exactly at the last video frame.
  const input = ['-i', cut];
  const beds = [];
  if (take.audio.length) {
    const a = `${SHOTS}/${name}.a.webm`;
    writeFileSync(a, take.audio);
    beds.push(input.filter((x) => x === '-i').length);
    input.push('-i', a);
  }
  if (take.music.length) {
    const m = `${SHOTS}/${name}.m.webm`;
    writeFileSync(m, take.music);
    beds.push(input.filter((x) => x === '-i').length);
    input.push('-i', m);
  }
  const D = take.dur.toFixed(2);
  const filter = beds.length === 0 ? null
    : beds.length === 1 ? `[${beds[0]}:a]apad=whole_dur=${D}[aout]`
    : `[${beds[0]}:a][${beds[1]}:a]amix=inputs=2:duration=longest:dropout_transition=0[mix];[mix]apad=whole_dur=${D}[aout]`;
  const extra = filter ? ['-filter_complex', filter, '-map', '[aout]'] : ['-an'];
  execFileSync(ffmpeg(), ['-y', '-nostdin', '-hide_banner', '-loglevel', 'error', ...input,
    '-map', '0:v', ...extra, '-c:v', 'copy', '-c:a', 'aac', '-t', D,
    '-movflags', '+faststart', mp4], { stdio: ['ignore', 'inherit', 'inherit'] });
  console.log(`[save] pass2 +${Date.now() - t}ms`);
  try { unlinkSync(src); } catch {}
  try { unlinkSync(cut); } catch {}
  return mp4;
}
