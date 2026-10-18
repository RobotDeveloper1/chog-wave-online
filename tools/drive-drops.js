// Look at the whole new loot language: a money pile, a card and an epic, all with their name
// plates always visible, and the hover tooltip open on the money.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 120 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(7000);

  window.__drops([
    { kind: 'wav', key: undefined, amount: 4200, name: '4,200 WAV', rarity: 'common' },
    {},
    { rarity: 'epic', key: 'chognova', name: 'Chog Nova', klass: 'G', element: 'prism' },
  ]);
  await wait(1600);

  const labels = [...document.querySelectorAll('.drop-label')];
  const visible = labels.filter((l) => l.style.display !== 'none');
  const canvas = document.querySelector('canvas');
  const r = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent('pointermove', {
    clientX: r.left + r.width / 2 - 20, clientY: r.top + r.height * 0.5, bubbles: true,
  }));
  await wait(900);

  const tip = document.getElementById('drop-tip');
  return `labels=${labels.length} visible=${visible.length} | texts=${JSON.stringify(visible.map((l) => l.textContent.replace(/\s+/g, ' ').trim().slice(0, 34)))} | tip=${JSON.stringify((tip?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60))} | errors=${errors.length ? errors[0] : 'none'}`;
})();
