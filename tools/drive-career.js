// Open the CAREER tab so the ladder and the next rung can be read in situ.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 120 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(6000);
  window.__menu('career');
  await wait(1800);
  const rungs = document.querySelectorAll('.lr').length;
  const next = document.querySelector('.lr.next');
  const done = document.querySelectorAll('.lr.done').length;
  return `rungs=${rungs} | done=${done} | next=${next ? JSON.stringify(next.textContent.replace(/\s+/g,' ').trim().slice(0,60)) : 'none'}`;
})();
