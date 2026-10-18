// Walk with REAL held keys toward the nearest mob. __drive steers off the director's yaw, which is
// not the same frame on the Line rig, so it reads as "the player cannot move" when they can.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errs = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 120 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(7000);
  window.__menu('line');
  await wait(1500);
  [...document.querySelectorAll('button')].find((b) => /^TRAVEL$/i.test((b.textContent ?? '').trim()))?.click();
  await wait(9000);
  for (const k of ['Enter', 'Escape', 'Tab']) { window.__key([k]); await wait(600); }

  const mobs = (window.__lastMobs?.() ?? []).filter((m) => m.alive);
  const me = window.__pos();
  const near = [...mobs].sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
  if (!near) return 'no live mob';
  const d0 = Math.hypot(near.x - me.x, near.z - me.z);

  // Hold a direction and re-aim only when it stops closing.
  const keys = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
  let ki = 0;
  for (let leg = 0; leg < 40; leg++) {
    if (window.__state().duel) break;
    const p = window.__pos();
    const d = Math.hypot(near.x - p.x, near.z - p.z);
    if (d < 5) break;
    window.__key([keys[ki % 4]]);
    await wait(1100);
    const p2 = window.__pos();
    // If the last leg did not close the gap, try the next direction.
    if (Math.hypot(near.x - p2.x, near.z - p2.z) >= d - 0.2) ki++;
  }
  const st = window.__state();
  const p3 = window.__pos();
  return `mob=${near.name} | started ${d0.toFixed(1)}m | duel=${st.duel} | now ${Math.hypot(near.x - p3.x, near.z - p3.z).toFixed(1)}m away | moved=${Math.hypot(p3.x - me.x, p3.z - me.z).toFixed(1)}m | errors=${errs[0] ?? 'none'}`;
})();
