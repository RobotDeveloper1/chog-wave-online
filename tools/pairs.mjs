/**
 * Build the comparison manifest: real artwork beside the model built from the
 * same traits. Picks one token per trait family so the sheet exercises the
 * geometry rather than sampling randomly.
 *
 *   node tools/pairs.mjs > .data/pairs.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Blender's own cwd is not the shell's, so relative paths in this manifest fail
// to resolve at render time.
const ART = resolve('.data/art');
const MINE = resolve('blender/out/grid');
const META = '.data/metadata';

const params = JSON.parse(readFileSync('blender/params.json', 'utf8'));

const seen = new Set();
const picked = [];

/** one representative per (family-kind, value) so every branch gets drawn */
function take(id, key) {
  if (seen.has(key)) return;
  const ref = join(ART, `${id}.png`);
  const mine = join(MINE, `chog_${id}.png`);
  if (!existsSync(ref)) return;
  seen.add(key);
  const p = params[id];
  picked.push({
    id: Number(id),
    label: `#${id} ${p.headTrait || 'noHead'} / ${p.mouthStyle} / ${(p.held && p.held.style) || 'none'}`,
    ref,
    mine: existsSync(mine) ? mine : null,
  });
}

for (const [id, p] of Object.entries(params)) {
  take(id, `head:${(p.hat && p.hat.style) || 'none'}`);
  take(id, `mouth:${p.mouthStyle}`);
  take(id, `held:${(p.held && p.held.style) || 'none'}`);
  take(id, `eyes:${p.eyeStyle}`);
  take(id, `ew:${(p.eyewear && p.eyewear.style) || 'none'}`);
  take(id, `skin:${p.traits && p.traits.Skin}`);
  take(id, `form:${p.skull ? 'skull' : 'chog'}`);
}

// token 1 is the approved reference render; always include it as a regression pin
if (existsSync(join(ART, '1.png'))) {
  picked.unshift({
    id: 1,
    label: '#1 MCGA / smile / fwog  [GOLD STANDARD]',
    ref: join(ART, '1.png'),
    mine: existsSync(join(MINE, 'chog_1.png')) ? join(MINE, 'chog_1.png') : null,
  });
}

process.stdout.write(JSON.stringify(picked, null, 2) + '\n');
process.stderr.write(`${picked.length} pairs · ${picked.filter((x) => x.mine).length} have renders yet\n`);
