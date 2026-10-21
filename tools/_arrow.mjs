import { cityOf, QUEST_BY_ID } from '../shared/src/index.ts';
for (const sec of ['ashflat']) {
  const lay = cityOf(sec);
  const anchors = lay.anchors;
  console.log(`${sec}: ${anchors.length} anchors`);
  for (const a of anchors) console.log(`  ${a.id.padEnd(22)} kind=${String(a.kind).padEnd(5)} sub=${String(a.sub).padEnd(9)} at ${a.x.toFixed(0)},${a.z.toFixed(0)} area=${a.area}`);
}
console.log('\n--- quest track targets ---');
const want = new Set();
for (const [id, q] of QUEST_BY_ID) {
  for (const g of [q.giver, q.turnIn]) if (g) want.add(g);
}
console.log('givers/turnIns referenced by quests:', [...want].sort().join(', '));
const have = new Set(cityOf('ashflat').anchors.map(a => a.id));
console.log('\nanchors that ARE a quest giver:', [...want].filter(w => have.has(w)).join(', ') || '(none)');
console.log('quest ids with NO anchor:', [...want].filter(w => !have.has(w)).join(', ') || '(none)');
