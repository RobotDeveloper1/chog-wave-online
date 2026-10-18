// Look at the new hand: get into a training duel, wait for the Charge to fill, pick two chips so
// the firing strip and the picked states are both on screen, then photograph it.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 120 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(6000);

  window.__duel('train');
  for (let i = 0; i < 80 && !window.__duelobj(); i++) await wait(250);
  if (!window.__duelobj()) return 'duel never opened';

  // Wait for the Custom Screen to deal and open on its own.
  let cards = 0;
  for (let i = 0; i < 90; i++) {
    await wait(500);
    const live = document.querySelectorAll('#cs.duel .sf-card:not(.waiting)').length;
    if (live) { cards = live; break; }
  }
  await wait(2500);

  // Pick the first two live chips. Re-query every time: the hand re-renders its own innerHTML on
  // each frame, so a node captured once is detached by the next click and the click vanishes.
  for (let i = 0; i < 2; i++) {
    const b = document.querySelector('#cs.duel button.sf-card.available:not(:disabled)');
    if (!b) break;
    b.click();
    await wait(450);
  }
  await wait(1200);

  const picked = document.querySelectorAll('#cs.duel .sf-card.picked').length;
  const qchips = document.querySelectorAll('#cs.duel .qchip').length;
  const veils = document.querySelectorAll('#cs.duel .chip-veil').length;
  const arts = document.querySelectorAll('#cs.duel img.card-art').length;
  const broken = [...document.querySelectorAll('#cs.duel img.card-art')].filter((i) => !i.complete || i.naturalWidth === 0);
  return `cards=${cards} | picked=${picked} | qchips=${qchips} | veils=${veils} | arts=${arts} | broken=${broken.length} | errors=${errors.length ? errors[0] : 'none'}`;
})();
