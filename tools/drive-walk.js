// REPRODUCE IT: walk the Chog across the field squares and watch for the canvas going black.
// This is the exact case the player reports — dodge to another square. After every step, read the
// renderer's stats and the frame memory, and screenshot the whole walk.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => { warns.push(a.map(String).join(' ').slice(0, 90)); origWarn(...a); };

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 120 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(6000);

  window.__duel('train');
  for (let i = 0; i < 80 && !window.__duelobj(); i++) await wait(250);
  if (!window.__duelobj()) return 'duel never opened';

  // Let the hand deal and open, so the field is live and movement is unblocked.
  for (let i = 0; i < 60; i++) {
    await wait(400);
    if (window.__duelobj()?.view?.you?.custom?.open) break;
  }
  await wait(1500);

  const duel = window.__duelobj();
  const before = { file: duel.view?.you?.file, lane: duel.view?.you?.lane };

  // Walk a circuit: left, right, back, forward, twice around. Every step is a real server action.
  const moves = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'];
  const log = [];
  for (let i = 0; i < moves.length; i++) {
    const k = moves[i];
    window.__key([k]);
    await wait(700);
    const d = window.__duelobj();
    const dbg = window.__stage?.debug?.() ?? {};
    const err = window.__lastFrameError?.() ?? null;
    log.push(`${k}: file/lane ${before.file}/${before.lane} -> ${d?.view?.you?.file}/${d?.view?.you?.lane} calls=${dbg.calls} tris=${dbg.triangles} err=${err ? err.message.split('\n')[0].slice(0, 40) : '-'}`);
  }

  await wait(900);
  const tail = [...warns].slice(-6).join(' || ') || 'no warns';
  return `moves:\n  ${log.join('\n  ')}\nframeWarnings=${tail}\njsErrors=${errors.length ? errors[0] : 'none'}`;
})();
