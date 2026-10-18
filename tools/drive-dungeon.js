// Probe: get inside the dungeon and dump the camera / stage state to explain the black screen.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];

  document.querySelector('.pk-foster')?.click();
  for (let i = 0; i < 200 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'no debug API';
  await wait(7000);

  log.push(`street cam: ${JSON.stringify(window.__cam())}`);
  log.push(`street debug: ${JSON.stringify(window.__debug())}`);

  const gate = window.__anchors().find((a) => a.kind === 'fold');
  window.__tp(gate.x, gate.z + 1.8);
  await wait(5000);
  window.__key('e');
  await wait(3000);
  window.__drive(3.4, -2.4, 4);
  await wait(1000);
  window.__key('e');
  await wait(2500);
  const sheet = document.getElementById('sheet');
  const enter = [...sheet.querySelectorAll('button')].find((b) => /ENTER/i.test(b.textContent));
  if (enter && !enter.disabled) { enter.click(); await wait(6000); }
  for (let i = 0; i < 4; i++) { window.__key('Escape'); await wait(400); }
  await wait(2500);

  log.push(`dungeon cam: ${JSON.stringify(window.__cam())}`);
  log.push(`dungeon debug: ${JSON.stringify(window.__debug())}`);
  log.push(`zoom: ${window.__zoom()}`);
  log.push(`pos: ${JSON.stringify(window.__pos())}`);
  log.push(`spawn: ${JSON.stringify(window.__dungeon()?.spawn)}`);
  log.push(`bounds: ${JSON.stringify(window.__dungeon()?.bounds)}`);
  return log.join(' | ');
})();
