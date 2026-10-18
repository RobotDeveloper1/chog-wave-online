/**
 * Generates one SVG skill icon per card: a proper ability emblem (flame, fang, shard, bolt, wave,
 * prism, void orb...) on a dark plate with the element's glow, an embossed emblem and a neon rim.
 *
 *   node tools/card-icons.mjs
 *
 * Writes client/public/cards/<cardId>.svg for every card in shared/src/cards.ts, plus a contact
 * sheet at client/icons.html. The per-element PNGs stay as the fallback.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'client/public/cards');
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- palettes

const ELEM = {
  burn: { hot: '#ffb347', mid: '#ff5a1e', deep: '#3d0d02', rim: '#ff8a3c' },
  frost: { hot: '#dff4ff', mid: '#54b8f0', deep: '#062338', rim: '#8fe0ff' },
  volt: { hot: '#fff3b0', mid: '#ffd23f', deep: '#3a2a02', rim: '#ffe066' },
  wave: { hot: '#b9fff2', mid: '#2fc7b4', deep: '#02262a', rim: '#5fe8d4' },
  prism: { hot: '#f0dcff', mid: '#b07bff', deep: '#25084a', rim: '#d9a0ff' },
  void: { hot: '#d9b6ff', mid: '#7b3ddb', deep: '#0d0420', rim: '#b06bff' },
};

const STEEL = { a: '#e6edf7', b: '#a9b8cc', c: '#66748a' };
const GOLD = { a: '#ffe9a0', b: '#ffc23d', c: '#9a6b00' };

// ---------------------------------------------------------------- emblems
// Each returns SVG drawn inside a 128x128 box, centred on (64, 64).

const P = (n) => Number(n.toFixed(1));

function emblem(kind, e) {
  const H = e.hot;
  const M = e.mid;
  const D = e.deep;
  const W = '#ffffff';
  switch (kind) {
    case 'flame':
      return `
        <path d="M64 16 C86 40 96 54 96 72 a32 32 0 0 1 -64 0 C32 54 42 40 64 16 Z" fill="${M}"/>
        <path d="M64 34 C78 52 84 62 84 74 a20 20 0 0 1 -40 0 C44 62 50 52 64 34 Z" fill="${H}"/>
        <path d="M64 52 C70 62 73 68 73 76 a9 9 0 0 1 -18 0 C55 68 58 62 64 52 Z" fill="#fffbe8" opacity=".92"/>`;
    case 'fang':
      return `
        <path d="M28 40 h72 a6 6 0 0 1 6 6 v10 a44 44 0 0 1 -84 0 V46 a6 6 0 0 1 6 -6 Z" fill="${D}" stroke="${M}" stroke-width="3"/>
        <path d="M40 46 L50 92 L58 46 Z" fill="${STEEL.a}"/>
        <path d="M70 46 L78 92 L86 46 Z" fill="${STEEL.a}"/>
        <path d="M40 46 L50 92 L54 46 Z" fill="${STEEL.c}" opacity=".55"/>
        <path d="M70 46 L78 92 L82 46 Z" fill="${STEEL.c}" opacity=".55"/>`;
    case 'magma':
      return `
        <circle cx="64" cy="66" r="30" fill="${D}"/>
        <path d="M34 66 a30 30 0 0 0 60 0 c-8 8 -16 -2 -22 6 c-6 8 -14 -4 -22 2 c-6 5 -12 -6 -16 -8 Z" fill="${M}"/>
        <path d="M46 78 q6 10 2 20 q-8 -4 -8 -14 Z" fill="${H}"/>
        <path d="M74 80 q7 9 3 18 q-9 -3 -9 -13 Z" fill="${H}"/>
        <path d="M52 44 l8 -8 l6 10 l10 -8 l2 12" stroke="${H}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case 'paw':
      return `
        <ellipse cx="64" cy="80" rx="24" ry="20" fill="${M}"/>
        <circle cx="40" cy="56" r="10" fill="${H}"/>
        <circle cx="58" cy="46" r="10" fill="${H}"/>
        <circle cx="78" cy="48" r="10" fill="${H}"/>
        <circle cx="92" cy="62" r="9" fill="${H}"/>
        <ellipse cx="58" cy="76" rx="9" ry="6" fill="#fffbe8" opacity=".5"/>`;
    case 'shard':
      return `
        <path d="M64 14 L88 60 L64 114 L40 60 Z" fill="${M}"/>
        <path d="M64 14 L64 114 L40 60 Z" fill="${H}" opacity=".85"/>
        <path d="M64 14 L76 60 L64 114 Z" fill="${W}" opacity=".35"/>
        <path d="M40 60 L88 60" stroke="${W}" stroke-width="2" opacity=".45"/>
        <path d="M30 40 l10 8 l-10 8" stroke="${H}" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M98 78 l-10 -8 l10 -8" stroke="${H}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    case 'claw':
      return `
        <g stroke="${H}" stroke-width="9" fill="none" stroke-linecap="round">
          <path d="M34 26 C52 46 60 70 58 104"/>
          <path d="M60 20 C78 42 86 68 84 104"/>
          <path d="M86 26 C102 48 108 72 106 104"/>
        </g>
        <g stroke="${W}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".55">
          <path d="M36 30 C53 49 61 72 59 102"/>
          <path d="M62 24 C79 45 87 69 85 102"/>
        </g>`;
    case 'howl':
      return `
        <g fill="none" stroke="${H}" stroke-width="5" stroke-linecap="round">
          <path d="M46 42 a30 30 0 0 1 0 44"/>
          <path d="M34 32 a44 44 0 0 1 0 64"/>
          <path d="M82 42 a30 30 0 0 0 0 44"/>
          <path d="M94 32 a44 44 0 0 0 0 64"/>
        </g>
        <path d="M64 34 l7 14 l15 2 l-11 11 l3 15 l-14 -7 l-14 7 l3 -15 l-11 -11 l15 -2 Z" fill="${W}" opacity=".9"/>`;
    case 'snow':
      return `
        <g stroke="${H}" stroke-width="6" stroke-linecap="round">
          <line x1="64" y1="20" x2="64" y2="108"/>
          <line x1="26" y1="42" x2="102" y2="86"/>
          <line x1="102" y1="42" x2="26" y2="86"/>
        </g>
        <g stroke="${W}" stroke-width="2.5" stroke-linecap="round" opacity=".7">
          <line x1="64" y1="32" x2="54" y2="42"/><line x1="64" y1="32" x2="74" y2="42"/>
          <line x1="64" y1="96" x2="54" y2="86"/><line x1="64" y1="96" x2="74" y2="86"/>
        </g>
        <circle cx="64" cy="64" r="8" fill="${W}"/>`;
    case 'bolt':
      return `
        <path d="M74 12 L34 68 h22 L52 116 L94 56 H70 Z" fill="${M}"/>
        <path d="M74 12 L34 68 h22 L52 116 Z" fill="${H}"/>
        <path d="M70 24 L46 62 h14 Z" fill="${W}" opacity=".7"/>`;
    case 'arc':
      return `
        <path d="M40 16 L24 64 h20 L34 112" stroke="${M}" stroke-width="9" fill="none" stroke-linejoin="round"/>
        <path d="M88 16 L104 64 H84 L94 112" stroke="${M}" stroke-width="9" fill="none" stroke-linejoin="round"/>
        <path d="M40 16 L24 64 h20 L34 112" stroke="${H}" stroke-width="4" fill="none" stroke-linejoin="round"/>
        <path d="M88 16 L104 64 H84 L94 112" stroke="${H}" stroke-width="4" fill="none" stroke-linejoin="round"/>
        <circle cx="64" cy="64" r="10" fill="${W}" opacity=".85"/>
        <g stroke="${W}" stroke-width="2.5" opacity=".6"><line x1="52" y1="64" x2="76" y2="64"/><line x1="64" y1="52" x2="64" y2="76"/></g>`;
    case 'storm':
      return `
        <path d="M36 74 a18 18 0 0 1 2 -34 a24 24 0 0 1 46 -6 a16 16 0 0 1 6 32 Z" fill="${STEEL.b}"/>
        <path d="M36 74 a18 18 0 0 1 2 -34 a24 24 0 0 1 20 -10 a20 20 0 0 0 -14 20 Z" fill="${STEEL.a}" opacity=".7"/>
        <path d="M68 60 L50 92 h14 L58 116 L82 80 H66 Z" fill="${H}"/>`;
    case 'spark':
      return `
        <g stroke="${H}" stroke-width="6" stroke-linecap="round">
          <line x1="64" y1="18" x2="64" y2="40"/><line x1="64" y1="88" x2="64" y2="110"/>
          <line x1="18" y1="64" x2="40" y2="64"/><line x1="88" y1="64" x2="110" y2="64"/>
          <line x1="32" y1="32" x2="46" y2="46"/><line x1="82" y1="82" x2="96" y2="96"/>
          <line x1="96" y1="32" x2="82" y2="46"/><line x1="46" y1="82" x2="32" y2="96"/>
        </g>
        <circle cx="64" cy="64" r="15" fill="${M}"/>
        <circle cx="64" cy="64" r="8" fill="${W}"/>`;
    case 'wave':
      return `
        <path d="M14 92 C34 46 62 30 92 34 C74 44 66 58 68 74 C78 62 92 58 104 62 C94 74 88 88 90 102 H14 Z" fill="${M}"/>
        <path d="M14 92 C34 52 58 36 84 38 C70 50 64 62 66 76 C62 66 50 62 42 66 C34 74 26 84 24 94 Z" fill="${H}" opacity=".9"/>
        <path d="M22 102 q16 -10 32 0 q16 10 32 0 q10 -6 18 -2" stroke="${W}" stroke-width="4" fill="none" opacity=".8"/>`;
    case 'ripple':
      return `
        <g fill="none" stroke="${M}" stroke-width="7">
          <circle cx="64" cy="64" r="18"/><circle cx="64" cy="64" r="34"/><circle cx="64" cy="64" r="50"/>
        </g>
        <g fill="none" stroke="${H}" stroke-width="3">
          <circle cx="64" cy="64" r="18"/><circle cx="64" cy="64" r="34"/><circle cx="64" cy="64" r="50"/>
        </g>
        <circle cx="64" cy="64" r="9" fill="${H}"/>`;
    case 'tsunami':
      return `
        <path d="M12 100 C28 44 66 24 106 34 C92 46 84 62 88 80 C96 70 108 66 118 70 C108 82 102 94 104 108 H12 Z" fill="${M}"/>
        <path d="M12 100 C28 54 60 36 96 40 C82 54 76 68 78 84 C70 72 56 68 46 74 C36 82 26 92 22 102 Z" fill="${H}"/>
        <g fill="${W}" opacity=".8"><circle cx="52" cy="88" r="5"/><circle cx="72" cy="96" r="4"/><circle cx="38" cy="100" r="4"/></g>`;
    case 'spiral':
      return `
        <path d="M64 64 m0 -8 a8 8 0 1 1 -8 8 a16 16 0 1 0 16 -16 a26 26 0 1 0 26 26 a36 36 0 1 1 -36 -36"
              fill="none" stroke="${M}" stroke-width="9" stroke-linecap="round"/>
        <path d="M64 64 m0 -8 a8 8 0 1 1 -8 8 a16 16 0 1 0 16 -16 a26 26 0 1 0 26 26 a36 36 0 1 1 -36 -36"
              fill="none" stroke="${H}" stroke-width="3.5" stroke-linecap="round"/>`;
    case 'prism':
      return `
        <path d="M64 20 L98 92 H30 Z" fill="${M}"/>
        <path d="M64 20 L64 92 H30 Z" fill="${H}" opacity=".8"/>
        <path d="M20 56 H44" stroke="${W}" stroke-width="7" stroke-linecap="round"/>
        <g stroke-width="5" stroke-linecap="round">
          <line x1="86" y1="62" x2="114" y2="46" stroke="#ff5a5a"/>
          <line x1="86" y1="70" x2="116" y2="70" stroke="#5fe08a"/>
          <line x1="86" y1="78" x2="114" y2="94" stroke="#5aa0ff"/>
        </g>`;
    case 'fan':
      return `
        <g stroke-width="9" stroke-linecap="round" fill="none">
          <path d="M64 100 L64 24" stroke="#ff5a5a"/>
          <path d="M64 100 L40 30" stroke="#ffd23f"/>
          <path d="M64 100 L88 30" stroke="#5fe08a"/>
          <path d="M64 100 L26 52" stroke="#5aa0ff"/>
          <path d="M64 100 L102 52" stroke="#c48cff"/>
        </g>
        <circle cx="64" cy="100" r="10" fill="${W}" opacity=".9"/>`;
    case 'nova':
      return `
        <g stroke="${M}" stroke-width="8" stroke-linecap="round">
          ${[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]
            .map((d) => {
              const a = (d * Math.PI) / 180;
              return `<line x1="${P(64 + Math.cos(a) * 20)}" y1="${P(64 + Math.sin(a) * 20)}" x2="${P(64 + Math.cos(a) * 46)}" y2="${P(64 + Math.sin(a) * 46)}"/>`;
            })
            .join('')}
        </g>
        <g stroke="${H}" stroke-width="3" stroke-linecap="round">
          ${[15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345]
            .map((d) => {
              const a = (d * Math.PI) / 180;
              return `<line x1="${P(64 + Math.cos(a) * 18)}" y1="${P(64 + Math.sin(a) * 18)}" x2="${P(64 + Math.cos(a) * 34)}" y2="${P(64 + Math.sin(a) * 34)}"/>`;
            })
            .join('')}
        </g>
        <circle cx="64" cy="64" r="16" fill="${H}"/>
        <circle cx="64" cy="64" r="8" fill="${W}"/>`;
    case 'orb':
      return `
        <ellipse cx="64" cy="64" rx="46" ry="16" fill="none" stroke="${M}" stroke-width="5" transform="rotate(-20 64 64)"/>
        <circle cx="64" cy="64" r="30" fill="#07030f"/>
        <circle cx="64" cy="64" r="30" fill="none" stroke="${H}" stroke-width="3"/>
        <path d="M46 50 a30 30 0 0 1 20 -14" stroke="${H}" stroke-width="3" fill="none" opacity=".7"/>`;
    case 'eclipse':
      return `
        <circle cx="64" cy="64" r="40" fill="${H}" opacity=".35"/>
        <circle cx="64" cy="64" r="34" fill="none" stroke="${H}" stroke-width="3" opacity=".8"/>
        <circle cx="64" cy="64" r="28" fill="#07030f"/>
        <path d="M64 36 a28 28 0 0 1 0 56 a20 20 0 0 0 0 -56" fill="${H}" opacity=".85"/>`;
    case 'flat':
      return `
        <path d="M12 64 h22 l8 -26 l10 52 l8 -26 h56" fill="none" stroke="${M}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="M12 64 h22 l8 -26 l10 52 l8 -26 h56" fill="none" stroke="${H}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="104" cy="64" r="6" fill="${W}"/>`;
    case 'hole':
      return `
        <circle cx="64" cy="64" r="42" fill="none" stroke="${M}" stroke-width="4" opacity=".55"/>
        <circle cx="64" cy="64" r="30" fill="#04010a"/>
        <circle cx="64" cy="64" r="30" fill="none" stroke="${H}" stroke-width="4"/>
        <circle cx="64" cy="64" r="16" fill="#000"/>
        <g fill="${H}" opacity=".85"><circle cx="30" cy="40" r="4"/><circle cx="100" cy="46" r="3"/><circle cx="36" cy="94" r="3.5"/></g>`;
    case 'frog':
      return `
        <path d="M24 76 a40 34 0 0 1 80 0 v14 a10 10 0 0 1 -10 10 H34 a10 10 0 0 1 -10 -10 Z" fill="#3f9e4a"/>
        <circle cx="44" cy="46" r="14" fill="#3f9e4a"/><circle cx="84" cy="46" r="14" fill="#3f9e4a"/>
        <circle cx="44" cy="46" r="7" fill="#0d1a0d"/><circle cx="84" cy="46" r="7" fill="#0d1a0d"/>
        <circle cx="46" cy="43" r="2.5" fill="#fff"/><circle cx="86" cy="43" r="2.5" fill="#fff"/>
        <path d="M40 82 q24 16 48 0" stroke="#0d1a0d" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    case 'knife':
      return `
        <g transform="rotate(-32 64 64)">
          <rect x="18" y="58" width="66" height="14" rx="3" fill="${STEEL.b}"/>
          <path d="M84 52 L118 65 L84 78 Z" fill="${STEEL.a}"/>
          <path d="M84 58 L108 65 L84 72 Z" fill="#fff" opacity=".55"/>
          <rect x="18" y="58" width="24" height="14" rx="3" fill="${STEEL.c}"/>
          <circle cx="30" cy="65" r="4" fill="#2b3242"/>
        </g>`;
    case 'coin':
      return `
        <circle cx="64" cy="64" r="36" fill="${GOLD.c}"/>
        <circle cx="64" cy="64" r="32" fill="${GOLD.b}"/>
        <circle cx="64" cy="64" r="32" fill="none" stroke="${GOLD.a}" stroke-width="3"/>
        <path d="M64 40 v48 M50 54 h28 M50 74 h28" stroke="${GOLD.c}" stroke-width="6" stroke-linecap="round"/>
        <path d="M44 42 a32 32 0 0 1 16 -10" stroke="#fff" stroke-width="4" fill="none" opacity=".6"/>`;
    case 'heart':
      return `
        <path d="M64 106 C24 78 16 56 30 42 C42 30 58 34 64 48 C70 34 86 30 98 42 C112 56 104 78 64 106 Z" fill="#d8283f"/>
        <path d="M64 96 C36 74 30 58 40 48 C48 40 58 44 64 56 Z" fill="#ff5a70" opacity=".9"/>
        <path d="M46 46 a10 10 0 0 1 10 -6" stroke="#fff" stroke-width="4" fill="none" opacity=".7"/>`;
    case 'candle':
      return `
        <rect x="48" y="52" width="32" height="58" rx="6" fill="#efe6c8"/>
        <rect x="48" y="52" width="12" height="58" rx="6" fill="#fff8e0" opacity=".7"/>
        <path d="M64 18 C76 34 80 42 80 50 a16 16 0 0 1 -32 0 C48 42 52 34 64 18 Z" fill="${M}"/>
        <path d="M64 30 C70 40 72 44 72 50 a8 8 0 0 1 -16 0 C56 44 58 40 64 30 Z" fill="${H}"/>`;
    case 'cigar':
      return `
        <g transform="rotate(-18 64 64)">
          <rect x="22" y="56" width="66" height="20" rx="6" fill="#6b4a2a"/>
          <rect x="22" y="56" width="66" height="8" rx="4" fill="#8a6238"/>
          <rect x="78" y="56" width="22" height="20" rx="6" fill="${M}"/>
          <path d="M98 60 q10 4 8 12" stroke="${H}" stroke-width="4" fill="none"/>
        </g>
        <g stroke="${STEEL.b}" stroke-width="3" fill="none" opacity=".75">
          <path d="M96 34 q10 -10 20 -2 q8 8 -2 14"/>
        </g>`;
    case 'tower':
      return `
        <path d="M58 108 L62 46 h4 l4 62 Z" fill="${STEEL.b}"/>
        <g stroke="${STEEL.a}" stroke-width="4"><line x1="46" y1="72" x2="82" y2="72"/><line x1="52" y1="56" x2="76" y2="56"/></g>
        <circle cx="64" cy="34" r="8" fill="${H}"/>
        <g stroke="${H}" stroke-width="4" fill="none" stroke-linecap="round">
          <path d="M46 26 a26 26 0 0 1 36 0"/><path d="M34 16 a42 42 0 0 1 60 0"/>
        </g>`;
    case 'drop':
      return `
        <path d="M64 18 C86 50 96 66 96 78 a32 32 0 0 1 -64 0 C32 66 42 50 64 18 Z" fill="${M}"/>
        <path d="M64 34 C80 58 86 70 86 78 a22 22 0 0 1 -22 22 C58 96 54 84 54 74 C54 62 58 50 64 34 Z" fill="${H}" opacity=".85"/>
        <ellipse cx="52" cy="74" rx="7" ry="11" fill="#fff" opacity=".6"/>`;
    case 'bubbles':
      return `
        <circle cx="46" cy="74" r="24" fill="${M}" opacity=".9"/>
        <circle cx="86" cy="52" r="16" fill="${H}" opacity=".9"/>
        <circle cx="90" cy="92" r="11" fill="${H}" opacity=".75"/>
        <g fill="#fff" opacity=".7"><circle cx="38" cy="66" r="6"/><circle cx="80" cy="46" r="4"/><circle cx="87" cy="88" r="3"/></g>`;
    case 'rainbow':
      return `
        <g fill="none" stroke-width="10">
          <path d="M18 96 a46 46 0 0 1 92 0" stroke="#ff5a5a"/>
          <path d="M30 96 a34 34 0 0 1 68 0" stroke="#ffd23f"/>
          <path d="M42 96 a22 22 0 0 1 44 0" stroke="#5fe08a"/>
          <path d="M54 96 a10 10 0 0 1 20 0" stroke="#5aa0ff"/>
        </g>`;
    case 'tooth':
      return `
        <path d="M32 40 q32 -14 64 0 q6 30 -10 56 q-8 12 -14 0 l-8 -22 l-8 22 q-6 12 -14 0 Q26 70 32 40 Z" fill="${GOLD.b}"/>
        <path d="M32 40 q32 -14 64 0 q2 10 0 20 q-32 -12 -64 0 q-2 -10 0 -20 Z" fill="${GOLD.a}"/>
        <path d="M44 44 q6 -4 10 0" stroke="#fff" stroke-width="4" fill="none" opacity=".7"/>`;
    case 'laugh':
      return `
        <path d="M28 46 q36 -22 72 0 q-10 44 -36 56 Q38 90 28 46 Z" fill="${M}"/>
        <path d="M38 52 q26 -14 52 0 q-8 32 -26 42 Q46 84 38 52 Z" fill="${D}"/>
        <path d="M38 52 q26 -14 52 0 q-2 8 -4 12 q-22 -12 -44 0 q-2 -4 -4 -12 Z" fill="#fff"/>
        <path d="M40 78 q24 16 48 0 q-8 16 -24 20 Q48 94 40 78 Z" fill="#e0507a" opacity=".85"/>`;
    case 'lips':
      return `
        <path d="M22 66 q22 -18 42 0 q20 -18 42 0 q-20 26 -42 26 q-22 0 -42 -26 Z" fill="#d8283f"/>
        <path d="M22 66 q22 -18 42 0 q-20 6 -42 0 Z" fill="#ff6b80"/>
        <path d="M64 66 q20 -18 42 0 q-20 6 -42 0 Z" fill="#ff6b80"/>
        <path d="M56 64 l6 10 l6 -10 Z" fill="#fff"/>`;
    case 'teeth':
      return `
        <rect x="20" y="44" width="88" height="40" rx="8" fill="${D}" stroke="${M}" stroke-width="3"/>
        <g fill="${STEEL.a}">
          <rect x="24" y="48" width="12" height="32" rx="2"/><rect x="40" y="48" width="12" height="32" rx="2"/>
          <rect x="56" y="48" width="12" height="32" rx="2"/><rect x="72" y="48" width="12" height="32" rx="2"/>
          <rect x="88" y="48" width="12" height="32" rx="2"/>
        </g>
        <g fill="${STEEL.c}" opacity=".5">
          <rect x="34" y="48" width="3" height="32"/><rect x="50" y="48" width="3" height="32"/>
          <rect x="66" y="48" width="3" height="32"/><rect x="82" y="48" width="3" height="32"/>
        </g>`;
    case 'sound':
      return `
        <g stroke="${H}" stroke-width="6" fill="none" stroke-linecap="round">
          <path d="M30 44 a26 26 0 0 1 0 40"/><path d="M44 34 a40 40 0 0 1 0 60"/>
          <path d="M58 24 a54 54 0 0 1 0 80"/>
        </g>
        <circle cx="88" cy="64" r="16" fill="${M}"/>
        <circle cx="88" cy="64" r="9" fill="${D}"/>
        <circle cx="92" cy="60" r="3" fill="#fff"/>`;
    case 'brow':
      return `
        <path d="M24 62 q20 -20 44 -8" stroke="${M}" stroke-width="8" fill="none" stroke-linecap="round"/>
        <path d="M68 54 q16 -6 32 8" stroke="${M}" stroke-width="8" fill="none" stroke-linecap="round"/>
        <circle cx="44" cy="80" r="9" fill="${D}"/><circle cx="82" cy="80" r="9" fill="${D}"/>
        <path d="M64 88 q-8 14 2 22 q10 -8 2 -22 Z" fill="${H}"/>`;
    case 'smile':
      return `
        <circle cx="64" cy="64" r="38" fill="${M}" opacity=".9"/>
        <path d="M36 60 q28 30 56 0" stroke="${D}" stroke-width="9" fill="none" stroke-linecap="round"/>
        <circle cx="46" cy="48" r="7" fill="${D}"/><circle cx="82" cy="48" r="7" fill="${D}"/>
        <path d="M40 34 a30 30 0 0 1 20 -8" stroke="#fff" stroke-width="4" fill="none" opacity=".55"/>`;
    case 'eyeLaser':
      return `
        <path d="M18 64 q46 -34 92 0 q-46 34 -92 0 Z" fill="${D}" stroke="${M}" stroke-width="3"/>
        <circle cx="64" cy="64" r="18" fill="${H}"/>
        <circle cx="64" cy="64" r="8" fill="${D}"/>
        <g stroke="#ff3a3a" stroke-width="7" stroke-linecap="round"><line x1="46" y1="58" x2="14" y2="40"/><line x1="82" y1="58" x2="114" y2="40"/></g>`;
    case 'eyeVisor':
      return `
        <rect x="18" y="46" width="92" height="34" rx="14" fill="${D}" stroke="${M}" stroke-width="4"/>
        <rect x="28" y="54" width="34" height="12" rx="6" fill="${H}"/>
        <rect x="70" y="54" width="22" height="12" rx="6" fill="${H}" opacity=".7"/>`;
    case 'eyeVr':
      return `
        <rect x="16" y="42" width="96" height="48" rx="18" fill="#2b2340" stroke="${M}" stroke-width="4"/>
        <rect x="28" y="54" width="30" height="22" rx="8" fill="${H}"/>
        <rect x="70" y="54" width="30" height="22" rx="8" fill="${H}" opacity=".8"/>
        <path d="M16 52 q-10 4 -6 16" stroke="${STEEL.b}" stroke-width="4" fill="none"/>`;
    case 'eyeWide':
      return `
        <circle cx="64" cy="64" r="40" fill="#f2f4ff"/>
        <circle cx="64" cy="64" r="17" fill="${D}"/>
        <circle cx="58" cy="58" r="6" fill="#fff"/>
        <circle cx="64" cy="64" r="40" fill="none" stroke="${M}" stroke-width="4"/>`;
    case 'eyeNarrow':
      return `
        <path d="M18 64 q46 -22 92 0 q-46 22 -92 0 Z" fill="#f2f4ff"/>
        <ellipse cx="64" cy="64" rx="8" ry="13" fill="${D}"/>
        <path d="M18 64 q46 -22 92 0" stroke="${M}" stroke-width="4" fill="none"/>`;
    case 'eyeTear':
      return `
        <path d="M18 56 q46 -30 92 0 q-46 30 -92 0 Z" fill="#f2f4ff"/>
        <circle cx="64" cy="56" r="13" fill="${D}"/>
        <circle cx="60" cy="52" r="4" fill="#fff"/>
        <path d="M64 74 C74 88 78 96 78 102 a14 14 0 0 1 -28 0 C50 96 54 88 64 74 Z" fill="${H}"/>`;
    case 'eyeHollow':
      return `
        <path d="M18 64 q46 -30 92 0 q-46 30 -92 0 Z" fill="${D}" stroke="${M}" stroke-width="3"/>
        <circle cx="64" cy="64" r="12" fill="#000"/>
        <circle cx="64" cy="64" r="12" fill="none" stroke="${H}" stroke-width="2" opacity=".8"/>`;
    case 'eyeWild':
      return `
        <path d="M18 64 q46 -34 92 0 q-46 34 -92 0 Z" fill="#f2f4ff" stroke="${M}" stroke-width="3"/>
        <path d="M64 50 m0 -6 a6 6 0 1 1 -6 6 a12 12 0 1 0 12 -12" fill="none" stroke="${D}" stroke-width="4"/>
        <path d="M28 40 l10 6 M100 40 l-10 6" stroke="${H}" stroke-width="4" stroke-linecap="round"/>`;
    case 'bell':
      return `
        <path d="M34 88 q6 -34 10 -44 a20 20 0 0 1 40 0 q4 10 10 44 Z" fill="${GOLD.b}"/>
        <path d="M34 88 q6 -34 10 -44 a20 20 0 0 1 18 -12 q-10 14 -12 56 Z" fill="${GOLD.a}" opacity=".8"/>
        <rect x="28" y="88" width="72" height="10" rx="5" fill="${GOLD.c}"/>
        <circle cx="64" cy="104" r="8" fill="${GOLD.c}"/>`;
    case 'skull':
      return `
        <path d="M64 20 a36 32 0 0 1 36 32 q0 18 -8 26 v14 a8 8 0 0 1 -8 8 H44 a8 8 0 0 1 -8 -8 V78 q-8 -8 -8 -26 A36 32 0 0 1 64 20 Z" fill="#e8e2d0"/>
        <ellipse cx="50" cy="56" rx="11" ry="13" fill="#140f1e"/><ellipse cx="78" cy="56" rx="11" ry="13" fill="#140f1e"/>
        <path d="M64 68 l-7 14 h14 Z" fill="#140f1e"/>
        <g fill="#140f1e"><rect x="52" y="88" width="6" height="12"/><rect x="61" y="88" width="6" height="12"/><rect x="70" y="88" width="6" height="12"/></g>`;
    case 'radioactive':
      return `
        <circle cx="64" cy="64" r="10" fill="${H}"/>
        <g fill="${M}">
          <path d="M64 64 L96 46 A38 38 0 0 1 96 82 Z"/>
          <path d="M64 64 L32 82 A38 38 0 0 1 32 46 Z"/>
        </g>
        <g fill="${H}" opacity=".85">
          <path d="M64 64 L92 52 A34 34 0 0 1 92 76 Z"/>
          <path d="M64 64 L36 76 A34 34 0 0 1 36 52 Z"/>
        </g>
        <circle cx="64" cy="64" r="40" fill="none" stroke="${H}" stroke-width="3" opacity=".6"/>`;
    case 'star':
      return `
        <path d="M64 14 l15 34 l37 4 l-28 25 l8 36 l-32 -19 l-32 19 l8 -36 l-28 -25 l37 -4 Z" fill="${GOLD.b}"/>
        <path d="M64 14 l15 34 l37 4 l-28 25 l8 36 l-32 -19 Z" fill="${GOLD.a}"/>
        <path d="M64 30 l8 18 l20 2 l-15 14 l4 19 l-17 -10 Z" fill="#fff" opacity=".35"/>`;
    case 'meteor':
      return `
        <g stroke="${M}" stroke-width="10" stroke-linecap="round" opacity=".9">
          <line x1="16" y1="24" x2="52" y2="52"/><line x1="30" y1="16" x2="58" y2="40"/><line x1="12" y1="44" x2="44" y2="66"/>
        </g>
        <circle cx="76" cy="78" r="26" fill="${D}"/>
        <path d="M76 52 a26 26 0 0 1 26 26 q-14 -10 -26 -6 q-12 -4 -26 6 a26 26 0 0 1 26 -26 Z" fill="${H}"/>
        <circle cx="66" cy="88" r="5" fill="#000" opacity=".5"/><circle cx="86" cy="80" r="4" fill="#000" opacity=".5"/>`;
    case 'ring':
      return `
        <circle cx="64" cy="64" r="38" fill="none" stroke="${M}" stroke-width="12"/>
        <circle cx="64" cy="64" r="38" fill="none" stroke="${H}" stroke-width="4"/>
        <g fill="${H}">
          <path d="M64 16 l9 18 l-18 0 Z"/><path d="M64 112 l9 -18 l-18 0 Z"/>
          <path d="M16 64 l18 9 l0 -18 Z"/><path d="M112 64 l-18 9 l0 -18 Z"/>
        </g>
        <circle cx="64" cy="64" r="12" fill="${H}" opacity=".7"/>`;
    case 'cathedral':
      return `
        <path d="M40 108 V58 a24 24 0 0 1 48 0 v50 Z" fill="${D}" stroke="${M}" stroke-width="4"/>
        <path d="M64 34 L64 108" stroke="${H}" stroke-width="4"/>
        <path d="M40 76 q24 -18 48 0" stroke="${H}" stroke-width="4" fill="none"/>
        <g stroke="${H}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".9">
          <path d="M34 48 a34 34 0 0 1 12 -20"/><path d="M94 48 a34 34 0 0 0 -12 -20"/>
        </g>`;
    case 'drownedbell':
      return `
        <path d="M40 84 q4 -30 8 -38 a18 18 0 0 1 32 0 q4 8 8 38 Z" fill="${GOLD.b}"/>
        <rect x="34" y="84" width="60" height="9" rx="4" fill="${GOLD.c}"/>
        <g stroke="${H}" stroke-width="5" fill="none" stroke-linecap="round">
          <path d="M18 100 q14 -8 28 0 q14 8 28 0 q14 -8 28 0"/>
          <path d="M18 112 q14 -8 28 0 q14 8 28 0 q14 -8 28 0"/>
        </g>`;
    case 'choir':
      return `
        <g stroke-width="8" stroke-linecap="round" fill="none">
          <path d="M34 96 L52 32" stroke="#5aa0ff"/>
          <path d="M50 100 L64 28" stroke="#5fe08a"/>
          <path d="M66 100 L76 28" stroke="#ffd23f"/>
          <path d="M82 96 L90 32" stroke="#ff5a5a"/>
        </g>
        <circle cx="64" cy="64" r="52" fill="none" stroke="${H}" stroke-width="3" opacity=".5"/>`;
    case 'scythe':
      return `
        <path d="M34 108 L76 28" stroke="${STEEL.c}" stroke-width="10" stroke-linecap="round"/>
        <path d="M74 28 C96 30 108 48 106 70 C96 52 84 44 66 44 Z" fill="${STEEL.a}"/>
        <path d="M74 30 C92 34 102 48 102 64 C94 50 84 44 70 42 Z" fill="#fff" opacity=".45"/>
        <circle cx="64" cy="64" r="44" fill="none" stroke="${H}" stroke-width="3" opacity=".45" stroke-dasharray="6 8"/>`;
    case 'bloom':
      return `
        <g stroke="${M}" stroke-width="7" stroke-linecap="round">
          ${[0, 45, 90, 135, 180, 225, 270, 315]
            .map((d) => {
              const a = (d * Math.PI) / 180;
              return `<line x1="${P(64 + Math.cos(a) * 14)}" y1="${P(64 + Math.sin(a) * 14)}" x2="${P(64 + Math.cos(a) * 42)}" y2="${P(64 + Math.sin(a) * 42)}"/>`;
            })
            .join('')}
        </g>
        <g fill="${H}">
          ${[22, 67, 112, 157, 202, 247, 292, 337]
            .map((d) => {
              const a = (d * Math.PI) / 180;
              return `<circle cx="${P(64 + Math.cos(a) * 40)}" cy="${P(64 + Math.sin(a) * 40)}" r="7"/>`;
            })
            .join('')}
        </g>
        <circle cx="64" cy="64" r="14" fill="${H}"/><circle cx="64" cy="64" r="7" fill="#fff"/>`;
    case 'train':
      return `
        <rect x="18" y="52" width="76" height="40" rx="8" fill="${STEEL.b}"/>
        <rect x="18" y="52" width="76" height="14" rx="7" fill="${STEEL.a}"/>
        <rect x="86" y="34" width="26" height="26" rx="6" fill="${STEEL.c}"/>
        <rect x="30" y="66" width="18" height="16" rx="3" fill="${H}"/>
        <rect x="54" y="66" width="18" height="16" rx="3" fill="${H}"/>
        <circle cx="34" cy="98" r="9" fill="#22202e"/><circle cx="78" cy="98" r="9" fill="#22202e"/>
        <rect x="8" y="92" width="112" height="6" rx="3" fill="${STEEL.c}"/>`;
    case 'mirror':
      return `
        <path d="M44 20 h40 v58 a20 20 0 0 1 -40 0 Z" fill="${M}"/>
        <path d="M44 20 h20 v58 a20 20 0 0 0 20 20 a20 20 0 0 1 -40 -20 Z" fill="${H}" opacity=".8"/>
        <path d="M52 28 L74 48 L52 56 Z" fill="#fff" opacity=".55"/>
        <rect x="60" y="80" width="8" height="22" rx="3" fill="${STEEL.c}"/>
        <g stroke="${H}" stroke-width="3" fill="none" opacity=".7"><path d="M92 34 l10 -8"/><path d="M96 56 l12 -4"/><path d="M36 34 l-10 -8"/><path d="M32 56 l-12 -4"/></g>`;
    default:
      return `<circle cx="64" cy="64" r="26" fill="${M}"/><circle cx="64" cy="64" r="13" fill="${H}"/>`;
  }
}

// ---------------------------------------------------------------- the icon

function icon(chip) {
  const e = ELEM[chip.element] ?? ELEM.prism;
  const grade = chip.klass === 'G' ? '#ffd23f' : chip.klass === 'M' ? '#5fe8d4' : null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <radialGradient id="well" cx="50%" cy="44%" r="66%">
      <stop offset="0%" stop-color="${e.mid}" stop-opacity=".85"/>
      <stop offset="55%" stop-color="${e.deep}"/>
      <stop offset="100%" stop-color="#07050d"/>
    </radialGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#39334f"/>
      <stop offset="100%" stop-color="#100d1c"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff" stop-opacity=".16"/>
      <stop offset="60%" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="128" height="128" rx="18" fill="url(#plate)"/>
  <rect x="5" y="5" width="118" height="118" rx="14" fill="url(#well)"/>
  <g opacity=".14" stroke="${e.hot}" stroke-width="1">
    <line x1="5" y1="43" x2="123" y2="43"/><line x1="5" y1="85" x2="123" y2="85"/>
    <line x1="43" y1="5" x2="43" y2="123"/><line x1="85" y1="5" x2="85" y2="123"/>
  </g>
  <g filter="url(#soft)">${emblem(chip.art, e)}</g>
  <rect x="5" y="5" width="118" height="118" rx="14" fill="url(#sheen)"/>
  <rect x="5" y="5" width="118" height="118" rx="14" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="2"/>
  <rect x="2.5" y="2.5" width="123" height="123" rx="16" fill="none" stroke="${e.rim}" stroke-width="2.5" opacity=".7"/>
  ${grade ? `<g><circle cx="110" cy="18" r="12" fill="#0b0716" stroke="${grade}" stroke-width="2.5"/><text x="110" y="24" font-family="monospace" font-size="15" font-weight="bold" fill="${grade}" text-anchor="middle">${chip.klass}</text></g>` : ''}
</svg>`;
}

// ---------------------------------------------------------------- the art per card

/** What each card's emblem is. The element picks the palette; this picks the picture. */
const ART = {
  // burn — fire, teeth and things that melt
  emberpaw: 'flame', cinderfang: 'fang', magmachog: 'magma',
  cindercoat: 'flame', slagmaw: 'fang',
  // frost — control
  rimeclaw: 'claw', hoarbar: 'shard', glacierhowl: 'howl',
  deepchill: 'snow', whiteout: 'howl',
  // volt — burst
  staticnip: 'spark', arcsnap: 'arc', stormchomp: 'storm',
  // wave — sustain
  undertow: 'spiral', ripplebite: 'ripple', tsunamichog: 'tsunami',
  tidewall: 'wave',
  // prism — the catalyst
  refract: 'prism', spectrum: 'fan', chognova: 'nova',
  aegisnap: 'bell',
  // void — the expensive half
  nullfur: 'hole', eclipse: 'eclipse', signaldeath: 'flat',
  // signatures — the held accessories
  fwog_buddy: 'frog', switchblade: 'knife', lucky_coin: 'coin', hot_heart: 'heart',
  green_candle: 'candle', red_candle: 'candle', cigar_steady: 'cigar', sb_signal: 'tower', pepe_curse: 'frog',
  // voice cards — the Mouth trait
  v_bubblegum: 'bubbles', v_rainfall: 'drop', v_drool: 'drop', v_puke: 'rainbow', v_goldtooth: 'tooth',
  v_clownlaugh: 'laugh', v_btccoin: 'coin', v_moncoin: 'coin', v_lipbite: 'lips', v_grit: 'teeth',
  v_wo: 'sound', v_flatline: 'flat', v_smile: 'smile', v_worried: 'brow', v_normsmile: 'smile',
  // style cards — the Eye trait
  e_laser: 'eyeLaser', e_visor: 'eyeVisor', e_vr: 'eyeVr', e_wide: 'eyeWide',
  e_narrow: 'eyeNarrow', e_tear: 'eyeTear', e_dead: 'eyeHollow', e_wild: 'eyeWild',
  // form cards — the Base trait
  b_origin: 'bell', b_skull: 'skull', b_radio: 'radioactive', b_one: 'star',
  // fusion cards
  ga_cinderfall: 'meteor', ga_hollowwinter: 'ring', ga_arccathedral: 'cathedral', ga_drownedbell: 'drownedbell',
  ga_prismchoir: 'choir', ga_quietdeath: 'scythe', ga_staticbloom: 'bloom', ga_lasttrain: 'train',
  ga_moltenmirror: 'mirror',
};

// ---------------------------------------------------------------- read the roster

const cardsSrc = readFileSync(join(root, 'shared/src/cards.ts'), 'utf8');
const cards = [];
for (const m of cardsSrc.matchAll(/\{ id: '([a-z0-9_]+)', name: '([^']+)', element: '(\w+)'/g)) {
  cards.push({ id: m[1], name: m[2], element: m[3], klass: null });
}
for (const m of cardsSrc.matchAll(/\{ id: '([a-z0-9_]+)',[^}]*?klass: '(S|M|G)'/g)) {
  const c = cards.find((x) => x.id === m[1]);
  if (c) c.klass = m[2];
}

let written = 0;
const plain = [];
for (const c of cards) {
  const art = ART[c.id];
  if (!art) plain.push(c.id);
  writeFileSync(join(outDir, `${c.id}.svg`), icon({ ...c, art: art ?? 'orb' }));
  written++;
}

const sheet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>skill icons</title>
<style>body{margin:0;background:#0b0814;color:#ece6fb;font:12px ui-monospace,monospace}
.g{display:grid;grid-template-columns:repeat(9,1fr);gap:8px;padding:12px}
figure{margin:0;text-align:center}img{width:100%;display:block;border-radius:12px}
figcaption{margin-top:3px;color:#b9aee0;font-size:10px;line-height:1.2}</style></head><body>
<div class="g">${cards.map((c) => `<figure><img src="/cards/${c.id}.svg" alt="${c.name}"><figcaption>${c.name}${c.klass ? ` · ${c.klass}` : ''}</figcaption></figure>`).join('')}</div>
</body></html>`;
writeFileSync(join(root, 'client/icons.html'), sheet);

console.log(`wrote ${written} icons to client/public/cards/`);
if (plain.length) console.log(`no emblem mapped (default orb): ${plain.join(', ')}`);
