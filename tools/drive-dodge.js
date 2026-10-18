// Verify: dodging moves the body while the Hand is still closed (the window the player dodges in).
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 200 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(6000);

  window.__duel('train');
  for (let i = 0; i < 60 && !window.__duelobj(); i++) await wait(250);

  const seen = [];
  const frozenSeen = [];
  for (let i = 0; i < 26; i++) {
    const you = window.__duelobj()?.view?.you;
    if (you) {
      seen.push(`${you.file}:${you.lane}`);
      frozenSeen.push(you.frozen ? 'F' : '.');
    }
    window.__key(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][i % 4]);
    await wait(200);
  }
  return `positions=${new Set(seen).size}/${seen.length} | frozenTrace=${frozenSeen.join('')} | plateUp=${!!document.querySelector('.cs-charge')} | errors=${errors.length ? errors[0] : 'none'}`;
})();
