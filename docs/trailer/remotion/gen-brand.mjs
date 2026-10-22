/** Generate the official CHOG WAVE wordmark SVG from the brand pixel alphabet. */
import { writeFileSync, mkdirSync } from 'node:fs';

const PIXELS = {
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '.#.#.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
};
const RIBBON = [0, 1, 2, 3, 3, 2, 1, 0];

function wordmark(lines, { cell = 6, ink = '#ffffff', ribbon = '#43e2a8', wave = true } = {}) {
  const px = [];
  lines.forEach((line, li) => {
    let col = 0;
    for (const ch of line) {
      if (ch === ' ') { col += 7; continue; }
      const glyph = PIXELS[ch];
      if (!glyph) throw new Error(`no glyph for ${ch}`);
      glyph.forEach((row, y) => {
        for (const [x, on] of [...row].entries()) if (on === '#') px.push([col + x, li * 8 + y]);
      });
      col += 7;
    }
  });
  const w = Math.max(...px.map((p) => p[0])) + 1;
  const h = lines.length * 8 - 1;
  let out = px.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${ink}"/>`).join('');
  let height = h;
  if (wave) {
    for (let x = 0; x < w; x++) out += `<rect x="${x}" y="${h + 3 + (RIBBON[x % RIBBON.length] ?? 0)}" width="1" height="1" fill="${ribbon}"/>`;
    height = h + 6;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height}" width="${w * cell}" height="${height * cell}" role="img" aria-label="Chog Wave" shape-rendering="crispEdges">${out}</svg>`;
}

mkdirSync('docs/trailer/remotion/public/brand', { recursive: true });
writeFileSync('docs/trailer/remotion/public/brand/wordmark.svg', wordmark(['CHOG', 'WAVE'], { cell: 12 }));
writeFileSync('docs/trailer/remotion/public/brand/wordmark-line.svg', wordmark(['CHOG WAVE'], { cell: 8 }));
console.log('brand ok');
