/**
 * Exports the *actual* lookFor() output from the client so the 3D generator and
 * the 2D renderer can never disagree about what a given tokenId looks like.
 * Reimplementing the hash in Python would guarantee drift the first time either
 * side changes.
 *
 *   node tools/export-params.mjs 418 7 1900 > blender/params.json
 */
import { lookFor } from '../client/src/sprites.ts';
import { deriveBuild, GENESIS_SUPPLY } from '@chog/shared';

const parseRgb = (css) => {
  const m = css.match(/rgb\(([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/);
  if (!m) throw new Error(`unparsed colour: ${css}`);
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
};

const ids = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--'))
  .map(Number)
  .filter(Number.isFinite);

const tokens = ids.length
  ? ids
  : Array.from({ length: GENESIS_SUPPLY }, (_, i) => i + 1);

const out = {};
for (const tokenId of tokens) {
  if (tokenId < 1 || tokenId > GENESIS_SUPPLY) continue;
  const build = deriveBuild({
    tokenId,
    transferCount: tokenId % 7,
    daysHeld: (tokenId * 13) % 400,
  });
  const look = lookFor(tokenId, build.personality);
  out[tokenId] = {
    mane: parseRgb(look.mane),
    face: parseRgb(look.face),
    paw: parseRgb(look.paw),
    eye: parseRgb(look.eye),
    spike: look.spike,
    bulk: look.bulk,
    brow: look.brow,
    personality: build.personality,
    linkSlots: build.linkSlots,
    callsign: build.callsign,
  };
}

process.stdout.write(
  (process.argv.includes('--min') ? JSON.stringify(out) : JSON.stringify(out, null, 2)) + '\n',
);
