// Verify the dodge readout reaches the DOM: the grace bar under the chain appears when a step
// escapes a marked panel, and the mint flash fires with it. Reads the live duel view, so it is
// checking the same number the HUD draws from.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 120 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API (boot never finished)';
  await wait(5000);

  window.__duel('train');
  for (let i = 0; i < 60 && !window.__duelobj()?.view; i++) await wait(250);
  if (!window.__duelobj()?.view) return 'duel never opened';

  let graceFrames = 0;
  let barFrames = 0;
  let flashFrames = 0;
  for (let i = 0; i < 24; i++) {
    const g = window.__duelobj()?.view?.you?.dodge;
    if (g && g.iframeMs > 0) graceFrames += 1;
    if (document.querySelector('.d-grace')) barFrames += 1;
    if (document.querySelector('.d-flash.dodge')) flashFrames += 1;
    window.__key(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][i % 4]);
    await wait(110);
  }

  const tail = window.__duelobj()?.view?.you?.dodge;
  return `graceFrames=${graceFrames} | barFrames=${barFrames} | dodgeFlash=${flashFrames} | graceMs=${tail?.graceMs} | iframeNow=${tail?.iframeMs} | errors=${errors.length ? errors[0] : 'none'}`;
})();
