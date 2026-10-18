// Drive all the way to the fold entrance and open it, so we know whether the door works and the
// problem is only that it is 152 units away and unmarked, or whether it is actually broken.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 120 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(7000);

  const me = window.__pos();
  const fold = window.__anchors().find((a) => a.kind === 'fold');
  const out = [`spawn=${JSON.stringify(me)}`, `fold=${JSON.stringify(fold)}`];
  out.push(`objective=${JSON.stringify(document.getElementById('hud-next')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) ?? 'none')}`);

  // Walk in short legs and re-aim, because a single 3s drive never covers 152 units.
  for (let leg = 0; leg < 26; leg++) {
    const p = window.__pos();
    const d = Math.hypot(fold.x - p.x, fold.z - p.z);
    if (d < 3.2) break;
    window.__drive(fold.x, fold.z, 1.2);
    await wait(1500);
  }
  const arrived = window.__pos();
  out.push(`arrived=${JSON.stringify(arrived)} dist=${Math.hypot(fold.x - arrived.x, fold.z - arrived.z).toFixed(1)}`);

  // At the door: try every plausible interact key until something opens.
  let opened = null;
  for (const k of ['e', 'Enter', 'f', ' ']) {
    window.__key([k]);
    await wait(2000);
    const st = window.__state();
    if (st.inside || st.busy) { opened = k; break; }
  }
  out.push(`openedWith=${opened ?? 'nothing'} state=${JSON.stringify(window.__state())}`);

  // With a run open, enter the map.
  try {
    await wait(1200);
    out.push(`enter=${JSON.stringify(window.__enterDungeon())}`);
    await wait(2600);
    out.push(`dungeon=${JSON.stringify(window.__dungeon())}`);
  } catch (e) {
    out.push(`enter THREW ${String(e.message).slice(0, 80)}`);
  }

  out.push(`jsErrors=${errors.length ? errors.slice(0, 2).join(' || ') : 'none'}`);
  return out.join('\n  ');
})();
