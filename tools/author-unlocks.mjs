import { readFileSync, writeFileSync } from 'node:fs';

/**
 * The per-map unlock table, authored by hand rather than rolled.
 *
 * Every id here is verified to exist in `shared/src/chips.ts`. The curve is deliberate: the first
 * fold opens on two standards and one MEGA, the last opens on MEGAs and closes on a GIGA. Void has
 * no standards at all, so its fold skips straight to MEGA — which is the whole reason void is the
 * last map rather than the first.
 */
const UNLOCKS = {
  'd-ember': ['v_goldtooth', 'v_wo', 'cinderfang'],
  'd-frost': ['v_lipbite', 'v_grit', 'hoarbar'],
  'd-volt': ['v_clownlaugh', 'e_visor', 'arcsnap'],
  'd-wave': ['v_rainfall', 'v_smile', 'ripplebite', 'ga_drownedbell'],
  'd-prism': ['v_moncoin', 'v_normsmile', 'v_puke', 'spectrum'],
  'd-void': ['fwog_buddy', 'pepe_curse', 'e_dead', 'eclipse'],
};

let s = readFileSync('shared/src/dungeonData.ts', 'utf8');
const before = s;

// 1. The field, on the interface, next to what the first clear already pays.
s = s.replace(
  '  /** What the first clear pays on top of the rooms, and the title it earns. */',
  '  /**\n' +
  '   * The cards this map is the key to.\n' +
  '   *\n' +
  '   * A fold used to pay in cards rolled out of a bag, which meant the same map was worth a\n' +
  '   * different nothing on two runs and a player could never aim at a card they wanted. These are\n' +
  '   * the fixed unlock: clear the map and these are yours, permanently, on the first clear. The\n' +
  '   * duel items ARE these cards, so a Chog that has opened two maps has two maps of hand.\n' +
  '   */\n' +
  '  unlocks: readonly string[];\n' +
  '  /** What the first clear pays on top of the rooms, and the title it earns. */',
);

// 2. The data, one line per dungeon, placed just above its own firstClear.
for (const [id, cards] of Object.entries(UNLOCKS)) {
  const list = cards.map((c) => `'${c}'`).join(', ');
  const anchor = `    firstClear: {`;
  // Each dungeon's firstClear is the line after its boss; insert above it, matching on the id.
  const at = s.indexOf(`id: '${id}'`);
  if (at < 0) throw new Error(`no dungeon ${id}`);
  const next = s.indexOf(anchor, at);
  if (next < 0) throw new Error(`no firstClear after ${id}`);
  s = `${s.slice(0, next)}    unlocks: [${list}],\n${s.slice(next)}`;
}

writeFileSync('shared/src/dungeonData.ts', s);
console.log('changed:', before !== s, '| dungeons authored:', Object.keys(UNLOCKS).length);
