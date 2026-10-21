/**
 * Prints where the Fold Gate actually is, and what is standing around it.
 *
 * The layout is generated, so "the gate is buried in buildings" is not something to argue about by
 * eye -- the landmark has a position, the door has an anchor, and the solids have rectangles. This
 * dumps all three for one sector so the numbers can disagree with the screenshot.
 *
 * node tools/probe-city.mjs [sector] [anchorId]
 */
import { cityOf } from '../shared/src/city/zones.ts';

const SECTOR = process.argv[2] ?? 'ashflat';
const ANCHOR = process.argv[3] ?? 'a-fold';
const NEAR = 14;

const layout = cityOf(SECTOR);
const a = layout.anchors.find((x) => x.id === ANCHOR);
console.log(`sector ${SECTOR} · ${layout.blocks.length} blocks · ${layout.solids.length} solids · ${layout.landmarks.length} landmarks`);
console.log(`anchor ${ANCHOR}:`, a ? `(${a.x.toFixed(1)}, ${a.z.toFixed(1)}) r=${a.radius} kind=${a.kind} area="${a.area}"` : 'NOT FOUND');

for (const lm of layout.landmarks) {
  const dist = a ? Math.hypot(lm.x - a.x, lm.z - a.z) : NaN;
  console.log(`landmark ${lm.kind} at (${lm.x.toFixed(1)}, ${lm.z.toFixed(1)}) ${lm.w.toFixed(1)}x${lm.d.toFixed(1)} h${lm.h} face=${lm.face} block=[${lm.block}] — ${dist.toFixed(1)} from the anchor`);
}

if (!a) process.exit(0);

// Anything whose rectangle comes within NEAR of the anchor. A door anchor that is inside a solid
// is a door nobody can stand at, and the ones beside it are what jams the camera.
const hits = layout.solids
  .map((s) => ({ s, d: Math.max(0, Math.hypot(s.x - a.x, s.z - a.z) - Math.hypot(s.halfW, s.halfD)) }))
  .filter((h) => h.d < NEAR)
  .sort((p, q) => p.d - q.d);
console.log(`\n${hits.length} solids within ${NEAR} of the anchor:`);
for (const { s, d } of hits.slice(0, 12)) {
  const inside = Math.abs(a.x - s.x) < s.halfW && Math.abs(a.z - s.z) < s.halfD;
  console.log(`  ${d.toFixed(1)} away  (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) ${(s.halfW * 2).toFixed(1)}x${(s.halfD * 2).toFixed(1)}${inside ? '   <-- THE ANCHOR IS INSIDE THIS' : ''}`);
}

const block = layout.blocks.find((b) => b.rect.x0 <= a.x && a.x <= b.rect.x1 && b.rect.z0 <= a.z && a.z <= b.rect.z1);
if (block) {
  console.log(`\nblock [${block.c},${block.r}] "${block.def.name}" style=${block.def.style} landmark=${block.def.landmark ?? '-'}`);
  console.log(`  rect x ${block.rect.x0.toFixed(1)}..${block.rect.x1.toFixed(1)}  z ${block.rect.z0.toFixed(1)}..${block.rect.z1.toFixed(1)}`);
  console.log(`  inner x ${block.inner.x0.toFixed(1)}..${block.inner.x1.toFixed(1)}  z ${block.inner.z0.toFixed(1)}..${block.inner.z1.toFixed(1)}`);
  const cx = (block.inner.x0 + block.inner.x1) / 2;
  const cz = (block.inner.z0 + block.inner.z1) / 2;
  console.log(`  inner centre (${cx.toFixed(1)}, ${cz.toFixed(1)}) — anchor is ${Math.hypot(a.x - cx, a.z - cz).toFixed(1)} from it`);
}
