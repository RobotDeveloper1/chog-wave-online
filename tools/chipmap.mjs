import { readFileSync, writeFileSync } from 'node:fs';

const s = readFileSync('shared/src/chips.ts', 'utf8');
// The chip table is one object per entry; id, element and klass appear in that neighbourhood.
const re = /id:\s*'([^']+)'[\s\S]{0,220}?element:\s*'([^']+)'[\s\S]{0,120}?klass:\s*'([^']+)'/g;
const out = [];
let m;
while ((m = re.exec(s))) out.push(`${m[1]}:${m[2]}:${m[3]}`);

const by: Record<string, { S: string[]; M: string[]; G: string[] }> = {};
for (const x of out) {
  const [id, e, c] = x.split(':');
  if (!id || !e || !c) continue;
  (by[e] ??= { S: [], M: [], G: [] })[c].push(id);
}
console.log('total', out.length);
for (const e of Object.keys(by)) {
  console.log(`${e}  S:${by[e].S.length}  M:${by[e].M.length}  G:${by[e].G.length}`);
  console.log(`   M: ${by[e].M.join(' ')}`);
  console.log(`   G: ${by[e].G.join(' ')}`);
}
writeFileSync('outputs/chip-map.txt', JSON.stringify(by, null, 1));
