// Open the BAG so the card icons can be seen in situ, and report whether any failed to load.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 120 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(4500);

  window.__menu("folder");
  await wait(1500);

  const imgs = [...document.querySelectorAll('img.card-art, img.chip-art, img.item-art')];
  const broken = imgs.filter((i) => !i.complete || i.naturalWidth === 0);
  const srcs = [...new Set(imgs.map((i) => i.getAttribute('src')))].slice(0, 6);
  return `artImgs=${imgs.length} | broken=${broken.length} | srcs=${JSON.stringify(srcs)} | errors=${errors.length ? errors[0] : 'none'}`;
})();
