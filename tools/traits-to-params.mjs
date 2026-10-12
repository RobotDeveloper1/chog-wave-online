/**
 * Turns real Chog Genesis metadata into mesh parameters for blender/chog.py.
 *
 * This replaces the hashed stand-in palette: colour, headgear, eye style, aura
 * and form now come from the on-chain attributes, which is what "replicating the
 * traits" actually means. Unknown values fall back to a deterministic hue so a
 * new trait still renders differently instead of collapsing to grey.
 *
 *   node tools/traits-to-params.mjs > blender/params.json
 */
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Single source of truth for the mane silhouette, shared with the client's dots.
import { MANE_SPIKES } from '../shared/src/types.ts';

const DIR = '.data/metadata';

/**
 * Colours sampled from the real artwork by blender/sample_colours.py. Used in
 * preference to parsing the trait name, because values like "CWO", "Guko" or
 * "Mon Hoodie" contain no colour word and hashing them invents a hue the art
 * does not have.
 */
let SAMPLED = {};
try {
  SAMPLED = JSON.parse(readFileSync('.data/art-colours.json', 'utf8'));
} catch {
  console.error('warning: .data/art-colours.json missing, falling back to name parsing');
}

const CURATED = {
  // Skin / face
  pink: [0.93, 0.42, 0.62],
  origin: [0.94, 0.93, 0.86],
  black: [0.13, 0.11, 0.16],
  yellow: [0.96, 0.83, 0.16],
  red: [0.87, 0.13, 0.17],
  white: [0.96, 0.95, 0.93],
  // Suit / body
  cream: [0.9, 0.84, 0.72],
  grey: [0.52, 0.52, 0.56],
  gray: [0.52, 0.52, 0.56],
  green: [0.35, 0.68, 0.42],
  blue: [0.28, 0.42, 0.8],
  purple: [0.45, 0.28, 0.68],
  violet: [0.5, 0.3, 0.75],
  aqua: [0.35, 0.78, 0.78],
  mint: [0.55, 0.88, 0.72],
  orange: [0.92, 0.55, 0.22],
  gold: [0.85, 0.68, 0.2],
  brown: [0.45, 0.32, 0.24],
  pinkish: [0.88, 0.55, 0.66],
};

const NAMED = {
  'kings robe': [0.55, 0.42, 0.85],
  wizard: [0.24, 0.2, 0.55],
  inmate: [0.85, 0.82, 0.75],
  guko: [0.7, 0.25, 0.3],
  'mon hoodie': [0.3, 0.22, 0.5],
  'red trackset': [0.75, 0.18, 0.22],
  'black trackset': [0.14, 0.12, 0.17],
  'black shirt': [0.13, 0.12, 0.16],
  'cream tuxedo': [0.9, 0.85, 0.74],
  'yellow 143 jersey': [0.93, 0.78, 0.18],
  'red tee': [0.78, 0.2, 0.24],
  'grey shirt': [0.52, 0.52, 0.56],
  // Acronyms carry no colour word, so the hash fallback would paint them any hue.
  mcga: [0.55, 0.30, 0.80],
  'clown nose': [0.88, 0.12, 0.16],
  tism: [0.85, 0.82, 0.78],
};

function hashHue(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 360) / 360;
}

function hsl2rgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/** Curated exact match first, then colour words inside the name, then a hash. */
function colourOf(value, sat = 0.55, light = 0.45) {
  const v = String(value ?? '').toLowerCase().trim();
  if (!v) return null;
  for (const [k, rgb] of Object.entries(NAMED)) if (v === k) return rgb;
  for (const [k, rgb] of Object.entries(CURATED)) if (v === k) return rgb;
  for (const [k, rgb] of Object.entries(NAMED)) if (v.includes(k)) return rgb;
  for (const [k, rgb] of Object.entries(CURATED)) if (v.includes(k)) return rgb;
  return hsl2rgb(hashHue(v), sat, light);
}

/**
 * Only a real colour word counts. colourOf always answers, inventing a hue from
 * a hash when the name says nothing, so its output cannot be trusted as evidence
 * — "Yellow 143 Jersey" and "Black Trackset" name their colour and beat any
 * pixel sample, while "MCGA" or "Mon Hoodie" do not and fall through to the art.
 */
function namedColour(value) {
  const v = String(value ?? '').toLowerCase().trim();
  if (!v) return null;
  for (const [k, rgb] of Object.entries(NAMED)) if (v.includes(k)) return rgb;
  for (const [k, rgb] of Object.entries(CURATED)) if (v === k || v.includes(k)) return rgb;
  return null;
}

const has = (v, ...needles) => needles.some((n) => String(v ?? '').toLowerCase().includes(n));

/**
 * 41 Eyes values -> distinct shapes. The previous version matched a handful of
 * keywords and dumped everything else into 'flat', which silently collapsed 23
 * different eyes into one look.
 */
function eyeStyle(eyes) {
  const v = String(eyes ?? '').toLowerCase();
  if (v.includes('laser')) return 'laser';
  if (v.includes('visor')) return 'visor';
  if (v.includes('vr')) return 'vr';
  if (v.includes('glass') || v.includes('spectacl')) return 'glasses';
  if (v.includes('thug')) return 'glasses';
  if (v.includes('cry') || v.includes('tear')) return 'crying';
  if (v.includes('closed')) return 'closed';
  if (v.includes('dead') || v.includes('xd')) return 'dead';
  if (v.includes('heart')) return 'heart';
  if (v.includes('happy')) return 'happy';
  if (v.includes('angry') || v.includes('viper')) return 'angry';
  if (v.includes('tired')) return 'tired';
  if (v.includes('worried')) return 'worried';
  if (v.includes('smirk')) return 'smirk';
  if (v.includes('side')) return 'side';
  if (v.includes('clown')) return 'clown';
  if (v.includes('vertical')) return 'vertical';
  if (v.includes('frog')) return 'frog';
  if (v.includes('round')) return 'round';
  if (v.includes('retard') || v.includes('mog')) return 'derp';
  return 'flat';
}

/**
 * Trait value -> an accessory *family*, not a bespoke model. ~150 distinct trait
 * values collapse into a handful of buildable families, which is what lets one
 * generator cover the whole collection.
 */
/**
 * Head trait -> shape, read off the reference sheets one value at a time.
 *
 * This is deliberately an explicit table and not keyword matching. Substring
 * rules looked plausible and were wrong: "Horny Cap" contains "horn" so it grew
 * chifres, "Red Peace Cap" contains "peace" so it became a headband. 24 of the 47
 * values are the same baseball cap and differ only in colour and lettering.
 */
const HEAD_SHAPE = {
  'mcga': 'cap', 'chog cap': 'cap', 'red peace cap': 'cap', 'thunder cap': 'cap',
  'star cap': 'cap', 'tism cap': 'cap', 'horny cap': 'cap', 'mon cap': 'cap',
  'mega chog': 'cap', 'dollar cap': 'cap', 'orange bucket cap': 'cap',
  'retard cap': 'cap', 'wagmi cap': 'cap', 'boob cap': 'cap', 'mmga cap': 'cap',
  'buttcoin cap': 'cap', '10k tps cap': 'cap', 'peace hat': 'cap', 'jeet cap': 'cap',
  'gray bucket cap': 'cap', 'btc cap': 'cap', 'choggie cap': 'cap', 'neet': 'cap',
  'balls cap': 'cap',
  'btc beanie': 'beanie', 'wizard beanie': 'beanie', 'choggie beanie': 'beanie',
  'rh beanie': 'beanie', 'mon beanie': 'beanie',
  'wizard hat': 'wizard', 'rainbow wig': 'wig',
  'japan headband': 'headband', 'red headband': 'headband',
  'bob hair': 'hair', 'russian hat': 'ushanka', 'durag': 'durag',
  'crown': 'crown', 'spartan helmet': 'helmet', 'plumber': 'cap',
  'clown nose': 'clownNose', 'robber': 'balaclava', 'silver thorn': 'thorn',
  '3rd eye': 'thirdeye', 'purple horn': 'horns', 'blue bucket cap': 'capvisor',
  'cloud cap': 'cap',
};

/** Values whose lettering is legible enough to be worth drawing. */
const HEAD_TEXT = {
  mcga: ['MAKE CHOG', 'GREAT AGAIN'], tism: ['TISM'], dollar: ['$'],
  'boob cap': ['BOO'], mmga: ['MMGA'], buttcoin: ['Buttcoin'],
  '10k tps': ['10K', 'TPS'], jeet: ['JEET'], wagmi: ['WAGMI'], neet: ['NEET'],
  chog: ['CHOG'],
};

function hatOf(head) {
  const v = String(head ?? '').toLowerCase().trim();
  if (!v || v === 'none') return null;
  const style = HEAD_SHAPE[v];
  if (!style) {
    // Unseen value: fall back to the modal shape rather than inventing one.
    return { style: 'cap', text: null, unmapped: true };
  }
  const text = Object.entries(HEAD_TEXT).find(([k]) => v.includes(k))?.[1] ?? null;
  return { style, text };
}

/** 15 Mouth values -> buildable shapes. */
function mouthOf(mouth) {
  const v = String(mouth ?? '').toLowerCase();
  if (v.includes('drool')) return 'drool';
  if (v.includes('bubble')) return 'bubble';
  if (v.includes('rainbow') || v.includes('puke')) return 'rainbow';
  if (v.includes('lip bite')) return 'lipbite';
  if (v.includes('gold')) return 'gold';
  if (v.includes('coin')) return 'coin';
  if (v.includes('clown')) return 'clown';
  if (v.includes('grit')) return 'grit';
  if (v.includes('worried')) return 'worried';
  if (v === 'wo' || v.includes('sad')) return 'frown';
  if (v.includes('smile') && !v.includes('normal')) return 'smile';
  if (v.includes('flat')) return 'flat';
  return 'smile';
}

/** 8 Accessory values -> held objects. */
function heldOf(accessory) {
  const v = String(accessory ?? '').toLowerCase();
  if (!v || v === 'none') return null;
  if (v.includes('fwog') || v.includes('frog')) return { style: 'fwog' };
  if (v.includes('pepe')) return { style: 'pepe' };
  if (v.includes('heart')) return { style: 'heart' };
  if (v.includes('knife') || v.includes('sb')) return { style: 'knife' };
  if (v.includes('cigar')) return { style: 'cigar' };
  if (v.includes('candle')) return { style: 'candle' };
  return { style: 'coin' };
}

function eyewearOf(eyes) {
  const v = String(eyes ?? '').toLowerCase();
  if (v.includes('btc')) return { style: 'coins', colour: [0.91, 0.63, 0.13] };
  if (v.includes('visor') || v.includes('vr') || v.includes('sunset')) {
    // Visors read as dark lenses with a coloured rim. Hashing at full lightness
    // turned "Modern VR" into a bright green bar.
    return { style: 'visor', colour: colourOf(eyes, 0.55, 0.20) };
  }
  if (v.includes('glass') || v.includes('spectacl')) return { style: 'round', colour: colourOf(eyes, 0.5, 0.4) };
  return null;
}

function laserOf(eyes) {
  const v = String(eyes ?? '').toLowerCase();
  if (!v.includes('laser')) return null;
  return colourOf(v.replace(/laser/g, ''), 0.85, 0.55) ?? [0.35, 0.95, 0.35];
}

/**
 * 78 Body values -> clothing families. Chosen by reading the reference sheets,
 * not the names: what separates these garments at sprite size is the collar and
 * chest furniture, so that is what each family has to produce.
 */
function clothingOf(body) {
  const v = String(body ?? '').toLowerCase();
  const accent = colourOf(body, 0.5, 0.75) ?? [0.94, 0.93, 0.86];
  const number = v.match(/\d{2,4}/)?.[0] ?? null;

  // A Chog with no Body attribute is bare, which is not the same as wearing a
  // plain tee — giving both the same mesh put a shirt on 27 naked Chogs.
  if (!v) return { family: 'bare', accent, number };
  if (v.includes('hoodie')) return { family: 'hoodie', accent, number };
  if (v.includes('tuxedo') || v.includes('gangster') || v.includes('suit') && !v.includes('toad'))
    return { family: 'tuxedo', accent, number };
  if (v.includes('chinese') || v.includes('yukata')) return { family: 'wrap', accent, number };
  if (v.includes('trackset')) return { family: 'trackset', accent, number };
  if (v.includes('army') || v.includes('cwo')) return { family: 'tactical', accent, number };
  if (v.includes('vest')) return { family: 'vest', accent, number };
  if (v.includes('robe')) return { family: 'robe', accent, number };
  if (v.includes('armor') || v.includes('sci fi') || v.includes('astro'))
    return { family: 'armor', accent, number };
  if (v.includes('prisoner') || v.includes('inmate') || v.includes('stripe'))
    return { family: 'striped', accent, number };
  if (v.includes('homeless')) return { family: 'coat', accent, number };
  if (v.includes('toad') || v.includes('banana') || v.includes('shark') || v.includes('dragon'))
    return { family: 'onesie', accent, number };
  if (v.includes('hawaiian') || v.includes('polo')) return { family: 'polo', accent, number };
  if (v.includes('sleeveless') || v.includes('tank') || v.includes('jersey'))
    return { family: 'tank', accent, number };
  if (v.includes('jacket')) return { family: 'trackset', accent, number };
  // The red jumpsuit is one of the largest single looks in the pass and shares
  // no word with any existing family, so it needs its own.
  if (v.includes('squid')) return { family: 'jumpsuit', accent, number };
  // "Jesus" is the robed figure; the name carries no garment word at all.
  if (v.includes('jesus')) return { family: 'robe', accent, number };
  return { family: 'tee', accent, number };
}

function paramsFor(meta, id) {
  const a = {};
  for (const t of meta.attributes ?? []) a[t.trait_type] = t.value;

  // Pixels fill the gaps the vocabulary leaves; a colour word in the name is the
  // stronger evidence of the two, because the art crop often hides the garment
  // behind a hand, and the sampler cannot see what the name already says.
  const sampled = SAMPLED[id] ?? {};

  const skin = colourOf(a.Skin, 0.42, 0.72) ?? [0.93, 0.86, 0.76];
  const naked = String(a.Naked ?? '').toLowerCase() === 'yes';
  const suit = namedColour(a.Body) ?? sampled.body
    ?? (naked ? skin : (colourOf(a.Body, 0.5, 0.4) ?? [0.36, 0.19, 0.55]));
  const aura = colourOf(a.Aura, 0.7, 0.55);
  const skull = String(a.Form ?? '').toLowerCase() === 'skull';
  const tier = String(a.Tier ?? 'Common');
  const tierGlow = tier === 'Rare' ? 0.9 : tier === 'Uncommon' ? 0.35 : 0.0;

  const laser = laserOf(a.Eyes);
  const clothing = clothingOf(a.Body);
  // `accent` is the garment's own fill, not a trim — the families use it for the
  // hood, collar, lapels and coat body. Pointing it at the sampled face colour
  // made every garment cream, which is why the coats and vests read as bibs.
  clothing.accent = suit;
  const hat = hatOf(a.Head);
  if (hat) hat.colour = namedColour(a.Head) ?? sampled.hat ?? colourOf(a.Head, 0.55, 0.45);

  return {
    name: meta.name ?? '',
    // Skin drives the mane and limbs; the face plate stays cream. Feeding Skin
    // into the face is what made the earlier renders read all-pink.
    suit,
    face: skull ? [0.93, 0.92, 0.88] : (colourOf(a.Base, 0.25, 0.85) ?? [0.94, 0.93, 0.86]),
    skin,
    glove: [0.786, 0.214, 0.500],
    eye: laser ?? [0.09, 0.05, 0.13],
    nose: [0.69, 0.23, 0.41],
    aura,
    tierGlow,
    skull,
    eyeStyle: eyeStyle(a.Eyes),
    mouthStyle: mouthOf(a.Mouth),
    laser: Boolean(laser),
    hat,
    eyewear: eyewearOf(a.Eyes),
    held: heldOf(a.Accessory),
    clothing,
    chestText: clothing.number,
    headTrait: a.Head ?? null,
    accessory: a.Accessory ?? null,
    traits: a,
    // Every Chog Genesis shares the same body and the same mane — only the
    // traits differ. Hashing bulk / spike count / brow angle in here invented
    // silhouette variation that does not exist in the art, which is what made
    // some of them render as a mohawk. Fixed values are the accurate ones.
    bulk: 1,
    crest: 5,
    spike: MANE_SPIKES,
    aggression: 0.5,
    brow: 0.5,
  };
}

const files = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'index.json')
  : [];

if (!files.length) {
  console.error('no metadata in .data/metadata — run tools/fetch-metadata.mjs first');
  process.exit(1);
}

const SUPPLY = 1969;

/** Same hash and PRNG as shared/src/derive.ts, so the 2D and 3D views of a token
 *  with no metadata agree on which Chog it is. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Metadata is only downloaded for part of the collection, but the judge plays
 * with their own Chog, so every one of the 1969 has to resolve to a model. The
 * missing ones are drawn from the observed trait frequencies rather than from a
 * flat list — a uniform draw would hand every synthetic Chog a rare aura and
 * make the population look nothing like the collection.
 */
function frequencies(metas) {
  const table = {};
  for (const m of metas) {
    for (const t of m.attributes ?? []) {
      const row = (table[t.trait_type] ??= new Map());
      row.set(t.value, (row.get(t.value) ?? 0) + 1);
    }
  }
  return table;
}

function synthMeta(id, freq, rng) {
  const attributes = [];
  for (const [trait, row] of Object.entries(freq)) {
    const total = [...row.values()].reduce((s, n) => s + n, 0);
    let pick = rng() * total;
    let value = [...row.keys()].pop();
    for (const [v, n] of row) {
      pick -= n;
      if (pick <= 0) { value = v; break; }
    }
    attributes.push({ trait_type: trait, value });
  }
  return { name: `CHOG #${1461 + Number(id)}`, attributes };
}

const realMetas = files.map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
const FREQ = frequencies(realMetas);

const out = {};
for (const f of files) {
  const id = Number(f.replace('.json', ''));
  out[id] = paramsFor(JSON.parse(readFileSync(join(DIR, f), 'utf8')), id);
}

let synth = 0;
// 1..1969, matching the contract. Generating 0..1968 left the last Chog in the
// pass with no model and invented a token that does not exist.
for (let id = 1; id <= SUPPLY; id++) {
  if (out[id]) continue;
  out[id] = paramsFor(synthMeta(id, FREQ, mulberry32(fnv1a(`chog:${id}`))), id);
  synth++;
}

const styles = {};
for (const v of Object.values(out)) styles[v.eyeStyle] = (styles[v.eyeStyle] ?? 0) + 1;

/**
 * A palette-only sidecar for the client's habitat swarm.
 *
 * The dots used to invent their own hue from a token hash, so the Chog you
 * clicked in the habitat was a different colour from the Chog that then walked
 * into battle. 1969 x three hex colours is 52KB, which is cheap enough to ship
 * whole and keeps one source of truth for what every Chog looks like.
 */
const hex = (c) => (c ?? [0, 0, 0]).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
const palette = {};
for (const [id, e] of Object.entries(out)) palette[id] = `${hex(e.skin)}${hex(e.suit)}${hex(e.face)}`;
mkdirSync('client/public', { recursive: true });
writeFileSync('client/public/pal.json', JSON.stringify(palette));

console.error(`exported ${Object.keys(out).length} tokens (${synth} synthesised) · eye styles ${JSON.stringify(styles)}`);
process.stdout.write(JSON.stringify(out) + '\n');
