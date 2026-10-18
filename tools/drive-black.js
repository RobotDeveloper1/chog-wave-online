// Probe: measure the ACTUAL brightness of the 3D canvas every 200ms while dodging, and log the game
// state whenever the field goes dark. The canvas is readable because preload-preserve.js forced
// preserveDrawingBuffer. The field region is sampled on the left, where only the 3D shows.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 200 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(6000);

  const gl = document.getElementById('gl');
  const probe = document.createElement('canvas');
  probe.width = 64;
  probe.height = 36;
  const pctx = probe.getContext('2d', { willReadFrequently: true });

  const luminance = () => {
    try {
      pctx.drawImage(gl, 0, 0, 64, 36);
    } catch (e) {
      return -1;
    }
    const d = pctx.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    let n = 0;
    // Left third only: that region is the field, never a HUD panel.
    for (let y = 6; y < 30; y++) {
      for (let x = 2; x < 20; x++) {
        const i = (y * 64 + x) * 4;
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++;
      }
    }
    return sum / n;
  };

  // Sanity: the street should be bright.
  await wait(1200);
  const streetLum = luminance();

  window.__duel('train');
  for (let i = 0; i < 60 && !window.__duelobj(); i++) await wait(250);
  await wait(1500);

  const samples = [];
  const dodge = (key) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })), 260);
  };

  for (let i = 0; i < 90; i++) {
    const v = window.__duelobj()?.view;
    const you = v?.you;
    const lum = luminance();
    samples.push({
      t: i,
      lum: Math.round(lum),
      frozen: !!you?.frozen,
      custom: !!you?.custom,
      hazard: !!v?.hazard,
      down: !!you?.down,
      hand: !!document.querySelector('.cs-charge'),
    });
    dodge(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][i % 4]);
    await wait(200);
  }

  const lums = samples.map((s) => s.lum);
  const sorted = [...lums].sort((a, b) => a - b);
  const dark = samples.filter((s) => s.lum < 12);
  const out = [
    `streetLum=${Math.round(streetLum)}`,
    `duelLum min=${sorted[0]} p25=${sorted[Math.floor(sorted.length * 0.25)]} med=${sorted[Math.floor(sorted.length / 2)]} max=${sorted[sorted.length - 1]}`,
    `darkFrames(<12)=${dark.length}/${samples.length}`,
  ];
  // The six darkest frames and what the game was doing in them.
  [...samples].sort((a, b) => a.lum - b.lum).slice(0, 6).forEach((s) =>
    out.push(`darkest@${s.t}: lum=${s.lum} frozen=${s.frozen} custom=${s.custom} hazard=${s.hazard} down=${s.down} hand=${s.hand}`));
  return out.join(' | ');
})();
