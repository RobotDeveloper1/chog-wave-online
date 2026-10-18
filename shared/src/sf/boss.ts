import { FIRST_PLAYER_LANE, LANES, centreFile, clampFile, type Panel } from './field.ts';
import type { Element } from '../types.ts';
import { quirkOf } from '../line/quirks.ts';

/**
 * What stands on the far side of the field.
 *
 * Star Force bosses are not health bars with a damage number on the end: each one is a small
 * vocabulary of *named* attacks you learn to read, and a harder boss is one with more words, not
 * one with a shorter fuse. That is the whole reason a warning you can read in 400 ms is fair —
 * you are not reacting to a random column, you are recognising a thing you have seen before.
 *
 * Which files an attack marks is decided by the move, and the move is picked from the boss's
 * pool by two gates:
 *
 *   - `from` — the phase the boss has to have grown into (a dying boss reaches deeper), and
 *   - `depth` — how far up the ladder the fight is. A tier-1 fold only ever contains the two
 *     words it exists to teach you; a dungeon core at difficulty 6 speaks all of them.
 *
 * The pool's **first entry is the boss's signature and is weighted to lead**, so a tier-1 Surge
 * is still a Surge. A difficulty gate adds vocabulary, it never takes an identity away.
 */

export type Spread = 'own' | 'you' | 'adjacent' | 'centre' | 'pincer' | 'flank' | 'row' | 'diagonal' | 'spiral';

/** Which player lanes an attack reaches. `near` is under your feet, `far` is the row above it. */
export type Reach = 'near' | 'far' | 'both';

export interface BossMove {
  id: string;
  /** The name on the banner. */
  name: string;
  spread: Spread;
  reach: Reach;
  /**
   * Multiplier on the warning. A big wind-up reads long; a jab reads short.
   *
   * There is deliberately no damage multiplier here. A move that marks five panels already
   * costs five times the chance of landing, and the bite is the number the map solved from the
   * integrity it is allowed to spend — multiplying it again by the shape would quietly un-price
   * every dungeon in the game.
   */
  tell: number;
  /** The boss's phase from which it reaches for this. */
  from: number;
  /** How deep in the ladder the fight has to be to teach it at all. */
  depth: number;
  /** One line in the field manual's voice: what to watch for, and where the escape is. */
  read: string;
}

/**
 * The vocabulary.
 *
 * None of these are borrowed from a fighting game. They are named for what the market does to
 * you, because that is what is actually on the other side of the field: a thing that moved
 * money and now owns the room. Each name also describes its own shape, so a player learns the
 * pattern by reading the banner and not by dying to it twice.
 *
 *   BAGHOLDER · FRONTRUN · MIDCURVE · DOUBLE SPEND · MARGIN CALL
 *   SANDWICH · RUG PULL · WICK · CANDLESTICK · GOD CANDLE
 *   STOP LOSS · REORG · CIRCUIT BREAKER · SUNK COST · NIBBLE · TOLL
 *
 * The last six are the Line's own signatures, each teaching the dodge its ground
 * already taught. A walker cuts where you stand because the farm track taught you to
 * step; a tollkeeper counts to four because the gate taught you to count; a husk sinks
 * three files because the causeway taught you the low row is the argument.
 */
export const MOVES: Record<string, BossMove> = {
  bagholder: {
    id: 'bagholder', name: 'BAGHOLDER', spread: 'own', reach: 'near', tell: 1.0, from: 1, depth: 1,
    read: 'it drops the bag it is standing on. One file, one lane. Step once, either way.',
  },
  frontrun: {
    id: 'frontrun', name: 'FRONTRUN', spread: 'you', reach: 'both', tell: 1.05, from: 1, depth: 1,
    read: 'it aims where you are, not where it is. Move after the flash, not before.',
  },
  midcurve: {
    id: 'midcurve', name: 'MIDCURVE', spread: 'centre', reach: 'both', tell: 0.95, from: 1, depth: 2,
    read: 'the centre file, heavy and early. Live on the flanks and it hits nothing.',
  },
  'double-spend': {
    id: 'double-spend', name: 'DOUBLE SPEND', spread: 'adjacent', reach: 'both', tell: 1.2, from: 1, depth: 2,
    read: 'two files: the one it owns and the next. The far edge is the only answer.',
  },
  'margin-call': {
    id: 'margin-call', name: 'MARGIN CALL', spread: 'row', reach: 'near', tell: 1.3, from: 2, depth: 3,
    read: 'the whole row under your feet. Step back a lane, not sideways.',
  },
  sandwich: {
    id: 'sandwich', name: 'SANDWICH', spread: 'pincer', reach: 'both', tell: 1.1, from: 3, depth: 3,
    read: 'your file and its own, both at once. It is ending the argument, not having one.',
  },
  'rug-pull': {
    id: 'rug-pull', name: 'RUG PULL', spread: 'flank', reach: 'near', tell: 1.25, from: 3, depth: 4,
    read: 'everything except where it stands. Walk into it — the safe file is under it.',
  },
  wick: {
    id: 'wick', name: 'WICK', spread: 'diagonal', reach: 'both', tell: 1.15, from: 3, depth: 5,
    read: 'a thin stair across the board. Which lane you are on decides which stair it is.',
  },
  candlestick: {
    id: 'candlestick', name: 'CANDLESTICK', spread: 'spiral', reach: 'both', tell: 1.15, from: 3, depth: 5,
    read: 'the body and both wicks: three files. The corners are the only room left.',
  },
  'god-candle': {
    id: 'god-candle', name: 'GOD CANDLE', spread: 'flank', reach: 'both', tell: 1.5, from: 4, depth: 6,
    read: 'the whole board but its own file. There is one answer and it is to walk in.',
  },
  'stop-loss': {
    id: 'stop-loss', name: 'STOP LOSS', spread: 'you', reach: 'near', tell: 1.0, from: 1, depth: 1,
    read: 'it cuts where you stand, low. Step anywhere once.',
  },
  reorg: {
    id: 'reorg', name: 'REORG', spread: 'pincer', reach: 'near', tell: 1.1, from: 1, depth: 2,
    read: 'your file and its own, both low. Step back a lane — the low row is the argument.',
  },
  'circuit-breaker': {
    id: 'circuit-breaker', name: 'CIRCUIT BREAKER', spread: 'row', reach: 'far', tell: 1.2, from: 1, depth: 2,
    read: 'the whole far row halts. Step home — low is the only room.',
  },
  'sunk-cost': {
    id: 'sunk-cost', name: 'SUNK COST', spread: 'spiral', reach: 'near', tell: 1.35, from: 1, depth: 2,
    read: 'three files sink around it, low. Step back a lane, or far around the edges.',
  },
  nibble: {
    id: 'nibble', name: 'NIBBLE', spread: 'own', reach: 'near', tell: 0.85, from: 1, depth: 1,
    read: 'a quick bite on its own file, and the warning is short because the answer is: do not stand there.',
  },
  toll: {
    id: 'toll', name: 'TOLL', spread: 'row', reach: 'near', tell: 1.35, from: 1, depth: 1,
    read: 'the whole low row, exact change only. Step back a lane — sideways buys nothing.',
  },
};

export type Archetype = 'spark' | 'baron' | 'front' | 'mirror' | 'surge' | 'glitch' | 'dummy' | 'imp' | 'wisp' | 'husk' | 'mite' | 'walker' | 'tollkeeper';

export interface ArchetypeInfo {
  name: string;
  element: Element;
  /** The move it is named for, and reaches for first. */
  pool: string[];
  /**
   * An armoured boss eats this share of every card until a BREAK card strips it. It is the one
   * thing on the field that makes a card's *verb* matter more than its number.
   */
  guard: number;
  /** True when the boss walls off a file for the whole fight rather than as a move. */
  walls: boolean;
  /** True when it answers with your own last program. */
  mirrors: boolean;
  /** One sentence, in the field manual's voice: what it does and how to beat it. */
  blurb: string;
}

export const ARCHETYPES: Record<Archetype, ArchetypeInfo> = {
  spark: {
    name: 'SPARK', element: 'volt', pool: ['bagholder', 'frontrun', 'double-spend', 'rug-pull'], guard: 0, walls: false, mirrors: false,
    blurb: 'Fast and thin: one file at a time, little health. Punish it between volleys.',
  },
  surge: {
    name: 'SURGE', element: 'burn', pool: ['double-spend', 'frontrun', 'bagholder', 'sandwich'], guard: 0, walls: false, mirrors: false,
    blurb: 'Collection-wide volume. It spends two files at once, so the safe file is the third.',
  },
  baron: {
    name: 'BARON', element: 'prism', pool: ['midcurve', 'bagholder', 'double-spend', 'sandwich'], guard: 0.4, walls: false, mirrors: false,
    blurb: 'One whale fill. Armoured — bring a BREAK card or every hit costs you 40%.',
  },
  front: {
    name: 'FRONT', element: 'wave', pool: ['bagholder', 'frontrun', 'double-spend', 'midcurve'], guard: 0, walls: true, mirrors: false,
    blurb: 'A run of small buys. It walls off one file: cards anchored there are absorbed.',
  },
  mirror: {
    name: 'MIRROR', element: 'void', pool: ['frontrun', 'bagholder', 'sandwich'], guard: 0, walls: false, mirrors: true,
    blurb: 'A wash trade. It fires your own last program back down the files you used.',
  },
  glitch: {
    name: 'GLITCH', element: 'prism', pool: ['reorg', 'bagholder', 'frontrun', 'double-spend', 'midcurve'], guard: 0, walls: false, mirrors: false,
    blurb: 'A loose signal. It shorts your file and its own, low — step back a lane when it flashes.',
  },
  imp: {
    name: 'IMP', element: 'burn', pool: ['stop-loss', 'frontrun', 'rug-pull', 'bagholder', 'double-spend'], guard: 0, walls: false, mirrors: false,
    blurb: 'A fast little exit. It leads with the cut at your feet, so the first warning is always under you.',
  },
  wisp: {
    name: 'WISP', element: 'frost', pool: ['circuit-breaker', 'bagholder', 'frontrun', 'double-spend'], guard: 0, walls: true, mirrors: false,
    blurb: 'A thin ring that walls one file for the whole fight, and halts the far row when it speaks. Everything else about it is smoke.',
  },
  husk: {
    name: 'HUSK', element: 'void', pool: ['sunk-cost', 'bagholder', 'midcurve', 'double-spend', 'sandwich'], guard: 0.25, walls: false, mirrors: false,
    blurb: 'Dead weight with a shell. It sinks the three files around it; a BREAK card strips it, but even bare fists get through.',
  },
  dummy: {
    name: 'TRAINING SIM', element: 'prism', pool: ['bagholder'], guard: 0, walls: false, mirrors: false,
    blurb: 'A slow practice signal. It warns early and hits soft. Nothing here can hurt you for long.',
  },
  mite: {
    name: 'MITE', element: 'burn', pool: ['nibble', 'bagholder', 'frontrun'], guard: 0, walls: false, mirrors: false,
    blurb: 'Small and skittish. It never stands where it stood — aim at the file, not the animal.',
  },
  walker: {
    name: 'WALKER', element: 'burn', pool: ['stop-loss', 'frontrun', 'bagholder'], guard: 0, walls: false, mirrors: false,
    blurb: 'It cuts where you stand and runs where you fled. Dodge twice, in two directions.',
  },
  tollkeeper: {
    name: 'TOLLKEEPER', element: 'burn', pool: ['toll', 'stop-loss', 'frontrun', 'bagholder'], guard: 0.4, walls: false, mirrors: false,
    blurb: 'The gate. Armoured, planted, and every fourth volley is the whole low row. Bring something piercing and count to four.',
  },
};

export function archetypeOf(raw: string | undefined): Archetype {
  return raw && raw in ARCHETYPES ? (raw as Archetype) : 'glitch';
}

/** How much more often a boss leads with its own move than with one the map merely taught it. */
const LEAD_WEIGHT = 2.2;

/**
 * The move this boss reaches for now: everything its archetype knows, filtered by the phase it
 * has grown into and by the depth of the fight, then weighted so the late words are not free.
 *
 * `rand` is injected because a boss that picks its hardest option at random is the one thing a
 * duel must not be able to blame on the player.
 */
/**
 * What the boss remembers between volleys. The session owns it and hands it back on every
 * pick, so a pattern is a fact about the fight rather than a mood of the random number
 * generator — the fourth volley is the TOLL because three came before it, not because a die
 * said so.
 */
export interface PickMem {
  lastMove: string | null;
  /** How many times in a row `lastMove` has been picked. */
  streak: number;
  /** Volleys telegraphed so far this fight. */
  volleys: number;
  /** The encounter quirk, when the fight is one — null everywhere else. */
  quirk: string | null;
}

export function pickMove(archetype: string, phase: number, depth: number, rand: () => number, mem?: PickMem): BossMove {
  let pool = (ARCHETYPES[archetypeOf(archetype)] ?? ARCHETYPES.glitch)
    .pool.map((id) => MOVES[id]!)
    .filter((m) => m.from <= phase && m.depth <= Math.max(1, depth));
  const fallback = pool.find((m) => m.id === 'bagholder') ?? MOVES.bagholder!;
  if (pool.length <= 1) return fallback;
  const q = quirkOf(mem?.quirk);
  const knows = (id: string): boolean => pool.some((m) => m.id === id);
  const volleys = mem?.volleys ?? 0;
  // The tollkeeper counts: every fourth volley is the TOLL, on the count.
  if (q.toll && volleys % 4 === 3 && knows('toll')) return MOVES.toll!;
  // Cornered past half: every other volley comes at you personally.
  if (q.cornered && phase >= 3 && volleys % 2 === 1 && knows('frontrun')) return MOVES.frontrun!;
  // Bloodscent: after the cut, run down where you fled.
  if (q.bloodscent && mem?.lastMove === 'stop-loss' && knows('frontrun') && rand() < 0.65) {
    return MOVES.frontrun!;
  }
  // No three-in-a-row: a boss that repeats itself is a metronome, not a hunter.
  if (mem && mem.streak >= 2 && mem.lastMove) {
    const rest = pool.filter((m) => m.id !== mem.lastMove);
    if (rest.length) pool = rest;
  }
  const weights = pool.map((m, i) => (i === 0 ? LEAD_WEIGHT : 1) + (m.from - 1) * 0.45 + (m.depth - 1) * 0.35);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rand() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

const laneOf = (reach: Reach): number[] => {
  const near = LANES - 1;
  const far = FIRST_PLAYER_LANE;
  if (reach === 'near') return [near];
  if (reach === 'far') return [far];
  return [far, near];
};

const panelsFor = (files: number[], reach: Reach): Panel[] => {
  const lanes = laneOf(reach);
  const out: Panel[] = [];
  for (const lane of lanes) for (const file of files) out.push({ file, lane });
  return out;
};

/**
 * The panels a move marks.
 *
 * Everything is expressed as a share of the floor, so a SWEEP across three files and a SWEEP
 * across six are the same *decision*: two files out of the room you were given.
 */
export function movePanels(
  move: BossMove,
  ctx: { cols: number; bossFile: number; youFile: number },
): Panel[] {
  const { cols } = ctx;
  const boss = clampFile(ctx.bossFile, cols);
  const you = clampFile(ctx.youFile, cols);
  const all = Array.from({ length: cols }, (_, i) => i);
  const clamp = (f: number) => clampFile(f, cols);

  let files: number[];
  switch (move.spread) {
    case 'own':
      files = [boss];
      break;
    case 'you':
      files = [you];
      break;
    case 'centre':
      files = [centreFile(cols)];
      break;
    case 'adjacent':
      files = [...new Set([boss, clamp(boss + 1)])];
      break;
    case 'pincer':
      files = [...new Set([boss, you])];
      break;
    case 'flank':
      files = all.filter((f) => f !== boss);
      break;
    case 'row':
      files = all;
      break;
    case 'diagonal':
      // A stair: the boss's file in one lane and the file beside it in the other, so which row
      // you are standing on decides which stair it is.
      return [
        { file: boss, lane: FIRST_PLAYER_LANE },
        { file: clamp(boss + 1), lane: LANES - 1 },
      ];
    case 'spiral':
      files = [...new Set([boss, clamp(boss - 1), clamp(boss + 1)])];
      break;
    default:
      files = [boss];
  }
  return panelsFor(files, move.reach);
}

/**
 * A Mirror throws your own last program back at you, which is a move of its own: the files you
 * fired down are the files it marks, so dodging the way you aimed is the answer and the fight
 * teaches you what you just did.
 */
export function mirroredPanels(programFiles: readonly number[], cols: number): Panel[] {
  const files = [...new Set(programFiles.map((f) => clampFile(f, cols)))];
  if (!files.length) return [];
  return panelsFor(files, 'both');
}
