// Drive script for tools/cdp-shot.mjs: walk in as a foster, stand next to an NPC, press E, and let
// the dialogue open — so the portrait can be checked in the real game.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];

  document.querySelector('.pk-foster')?.click();

  for (let i = 0; i < 200 && !window.__anchors; i++) await wait(250);
  if (!window.__anchors) return 'debug API never appeared';

  // Let the district build and the player settle.
  await wait(6000);

  const anchors = window.__anchors();
  const npcs = anchors.filter((a) => a.kind === 'npc');
  log.push(`npcs=${npcs.length}`);
  const npc = npcs[0];
  if (!npc) return log.join(' ');

  // Stand just south of them, inside interact reach.
  window.__tp(npc.x, npc.z + 1.7);
  log.push(`tp -> ${JSON.stringify(npc)}`);

  // The avatar streams in by distance; give the GLB a moment before asking for its face.
  await wait(3500);
  log.push(`state before E ${JSON.stringify(window.__state())}`);

  window.__key('e');
  await wait(1500);
  log.push(`state after E ${JSON.stringify(window.__state())}`);

  // Give the late-face poll (8 x 350ms) room to land, then hold for the screenshot.
  await wait(4000);

  const face = document.querySelector('#hud-dialogue .face');
  log.push(`dialogue=${!!document.querySelector('#hud-dialogue.on')} face=${!!face} bg=${face ? (face.style.backgroundImage || 'none').slice(0, 40) : '-'}`);
  return log.join(' | ');
})();
