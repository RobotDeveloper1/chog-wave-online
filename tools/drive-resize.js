// Is a mid-fight black screen caused by the bloom chain being rebuilt? Count the real
// reallocations that happen while a duel is running, and correlate them with the Hand opening.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 120 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(5000);

  const boot = window.__resizes();
  window.__duel('train');
  await wait(2500);
  const afterEnter = window.__resizes();

  // Watch until the Hand opens, sampling the reallocation counter every 200ms.
  const trail = [];
  let openedAt = -1;
  for (let i = 0; i < 70; i++) {
    const r = window.__resizes();
    const you = window.__duelobj()?.view?.you;
    const open = !!you?.custom?.open;
    if (open && openedAt < 0) { openedAt = i; trail.push(`OPENED@${i * 200}ms resizes=${r.count}`); break; }
    if (r.count !== afterEnter.count) trail.push(`resize@${i * 200}ms -> ${r.count}`);
    await wait(200);
  }
  await wait(2500);
  const afterOpen = window.__resizes();

  // Now dodge a few times and watch the counter during the dodges themselves.
  const dodgeStart = window.__resizes().count;
  for (let i = 0; i < 14; i++) { window.__key(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][i % 4]); await wait(180); }
  const duringDodge = window.__resizes().count;

  return [
    `boot=${boot.count}`,
    `observeBoot=${boot.observeHits}`,
    `enterDelta=${afterEnter.count - boot.count}`,
    `observeDelta=${afterEnter.observeHits - boot.observeHits}`,
    `openDelta=${afterOpen.count - afterEnter.count}`,
    `observeAtOpen=${afterOpen.observeHits - afterEnter.observeHits}`,
    `dodgeDelta=${duringDodge - dodgeStart}`,
    `observeAtDodge=${window.__resizes().observeHits - afterOpen.observeHits}`,
    `final=${afterOpen.count}`,
    `errors=${errors.length ? errors[0] : 'none'}`,
  ].join(' | ');
})();
