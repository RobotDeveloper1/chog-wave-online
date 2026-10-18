// Get to the street so the city vitals card — portrait, HP bar and its numbers — can be read.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 120 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(9000);

  const plate = document.getElementById('hud-player');
  const hp = plate?.querySelector('.meter.hp');
  const num = plate?.querySelector('.meter.hp span');
  const img = plate?.querySelector('.portrait .ring .img');
  const r = hp?.getBoundingClientRect();
  const nr = num?.getBoundingClientRect();
  return `art=${img ? JSON.stringify(img.style.backgroundImage) : 'GLYPH'} | hpHeight=${r ? Math.round(r.height) : '-'}px | hpWidth=${r ? Math.round(r.width) : '-'}px | numText=${JSON.stringify(num?.textContent ?? '')} | numFont=${nr ? Math.round(nr.height) : '-'}px tall | errors=${errors.length ? errors[0] : 'none'}`;
})();
