import type { CellShape, Element } from '../types.ts';
import type { CardClass, CardKind } from './card.ts';

/**
 * The Wave Field.
 *
 * Star Force fights on a panel grid seen in perspective: a few columns running left to right
 * and five lanes running away from the camera, the enemy owning the far lanes and Mega owning
 * the near ones. Nothing jumps, nothing dashes — you step between panels and the fight is
 * about being somewhere else when the attack lands.
 *
 *     lane 0 ┌───┬───┬───┐  ← the far wall
 *     lane 1 │   │   │   │     ENEMY AREA: the anomaly lives here
 *     lane 2 ├───┼───┼───┤
 *     lane 3 │   │   │   │     PLAYER AREA: you live here
 *     lane 4 └───┴───┴───┘  ← under your feet
 *            f0  f1  f2
 *
 * Two things are Chog's own on top of that shape:
 *
 *   - **The floor is as wide as the Chog standing on it.** A Chog dealt a three-slot panel
 *     fights across three files; one with six fights across six. Dodging room *is* progression,
 *     and it is the reason a bigger Chog is not simply a bigger number.
 *   - **A card aims by where you stand.** A card's footprint is laid on the board with its
 *     anchor on your file, so a wide card fired from the flank reaches further across than the
 *     same card fired from the edge. There is no placement grid: the grid was a second minigame
 *     bolted onto the first, and Star Force never had one.
 */

export const LANES = 5;
/** Lanes the anomaly owns. Lane 0 is the far wall, lane 2 the near edge of its half. */
export const ENEMY_LANES = 3;
/** Lanes a player may stand on. */
export const PLAYER_LANES = 2;
export const FIRST_PLAYER_LANE = LANES - PLAYER_LANES;

export const MIN_COLS = 3;
export const MAX_COLS = 6;

/** Milliseconds a shot takes to cross the board. Long enough to watch, short enough to commit. */
export const SHOT_FLIGHT_MS = 260;
/** Milliseconds of invulnerability after taking a hit, so one attack cannot chain into you. */
export const HITSTUN_MS = 300;

export type Team = 'player' | 'boss';

export interface FieldBody {
  id: string;
  team: Team;
  /** The column, 0..cols-1. */
  file: number;
  /** The depth row: 0..ENEMY_LANES-1 for a boss, FIRST_PLAYER_LANE..LANES-1 for a player. */
  lane: number;
  hp: number;
  maxHp: number;
  element: Element;
}

/** A panel, addressed the way a player reads it. */
export interface Panel {
  file: number;
  lane: number;
}

/**
 * A card in the air.
 *
 * Everything about how hard it hits was decided by the server at the moment it was fired —
 * element, chain, counter, class — because a number the client computed and the server then
 * contradicted is the one lie a player cannot forgive. What is left for the flight to decide is
 * the only honest question: **is the anomaly standing on a file this card covers?**
 */
export interface Shot {
  id: number;
  owner: string;
  chipId: string;
  element: Element;
  cls: CardClass;
  kind: CardKind;
  /** Files this shot's footprint covers, anchored on the file its owner stood on. */
  files: number[];
  /** What it deals if it connects. Decided at fire time, not here. */
  damage: number;
  /** Hit into a wind-up: double, and it pays a bonus card. */
  counter: boolean;
  /** Milliseconds in the air. */
  t: number;
  travel: number;
}

/** What the anomaly is about to do, drawn on the panels it will hit. */
export interface Hazard {
  /** The panels it has marked, and which lanes they are in. */
  panels: Panel[];
  /** The files, for the strip under the board. */
  files: number[];
  /** Milliseconds left before it lands, and how long the whole warning was. */
  left: number;
  total: number;
  /** The named move, so a player learns a pattern and not a number. */
  move: string;
  /** The name on the banner. */
  label: string;
  damage: number;
  /**
   * Body ids standing on a marked panel at the moment it flashed.
   *
   * A dodge is only a dodge if you were in it and got out. Counting "was not hit" would pay a
   * player for standing on the one file the attack never looked at.
   */
  on: string[];
}

export interface WaveField {
  /** How many files this floor is cut into. */
  cols: number;
  boss: FieldBody;
  shots: Shot[];
  /** The warning currently on the floor, if any. This is the counter-hit window. */
  hazard: Hazard | null;
  /** A file the anomaly has walled off: cards anchored on it are absorbed. */
  blocked: number | null;
}

export type FieldEvent =
  | { type: 'shot-fired'; owner: string; chipId: string; files: number[]; damage: number; counter: boolean; cls: CardClass; kind: CardKind; element: Element }
  | { type: 'hit'; owner: string; chipId: string; damage: number; counter: boolean; weak: number; chain: number; element: Element; cls: CardClass; kind: CardKind }
  | { type: 'miss'; owner: string; chipId: string; files: number[] }
  | { type: 'blocked'; owner: string; chipId: string; file: number }
  | { type: 'telegraph'; panels: Panel[]; files: number[]; ms: number; move: string; label: string; damage: number; atFile: number }
  | { type: 'strike'; panels: Panel[]; files: number[]; move: string; label: string }
  | { type: 'took-hit'; owner: string; damage: number; file: number }
  | { type: 'dodge'; owner: string; file: number }
  | { type: 'drain'; owner: string; amount: number }
  | { type: 'stun'; owner: string; ms: number }
  | { type: 'knock'; owner: string; file: number }
  | { type: 'guard-break'; owner: string }
  | { type: 'bonus-card'; owner: string }
  | { type: 'buster'; owner: string; damage: number; charged: boolean }
  | { type: 'custom'; owner: string; open: boolean }
  | { type: 'phase'; phase: number }
  | { type: 'boss-down' }
  | { type: 'down'; owner: string; left: number }
  | { type: 'revived'; owner: string; by?: string }
  | { type: 'lost'; owner: string };

/** A floor is as wide as the widest panel standing on it, and never narrower than three. */
export const clampCols = (n: number): number =>
  Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(n)));

/** Clamp a file to this floor. Every file clamp in the game has to read `cols`, never a literal. */
export const clampFile = (f: number, cols: number): number =>
  Math.max(0, Math.min(cols - 1, Math.round(f)));

/** The file in the middle of the floor, which is where everything that wants the centre goes. */
export const centreFile = (cols: number): number => Math.floor((cols - 1) / 2);

/**
 * The files a card's footprint covers when it is fired from `anchor`.
 *
 * This is the whole of aiming. There is no reticle and no grid: you stand somewhere, you fire,
 * and the card's shape decides how far across the floor it reaches. A one-cell card fired from
 * the edge hits one file; a three-wide card fired from the middle hits three.
 */
export function coverFiles(shape: CellShape, anchor: number, cols: number): number[] {
  const a = clampFile(anchor, cols);
  const out = new Set<number>();
  for (const [, dc] of shape) {
    const f = a + dc;
    if (f >= 0 && f < cols) out.add(f);
  }
  return [...out].sort((x, y) => x - y);
}

/** Does this shot reach the anomaly where it is standing right now? */
export function reaches(shot: Shot, boss: FieldBody, blocked: number | null): boolean {
  if (!shot.files.includes(boss.file)) return false;
  // A walled file eats anything anchored on it; a Sword is the one card that goes through.
  if (blocked !== null && shot.files.includes(blocked) && shot.kind !== 'sword') return false;
  return true;
}

export function makeBoss(args: { hp: number; element: Element; file: number; cols: number }): FieldBody {
  return {
    id: 'boss',
    team: 'boss',
    file: clampFile(args.file, args.cols),
    // The anomaly holds the near edge of its own half, so every part of a card's footprint
    // can reach it: what the Custom Screen promises is what lands.
    lane: ENEMY_LANES - 1,
    hp: args.hp,
    maxHp: args.hp,
    element: args.element,
  };
}

export function makeField(boss: FieldBody, cols: number): WaveField {
  return { cols: clampCols(cols), boss, shots: [], hazard: null, blocked: null };
}

/**
 * Widen the floor. Only ever grows, and every file that already existed keeps its index, so a
 * body standing at 2 is still at 2 and the new room opens to its right.
 */
export function widen(field: WaveField, cols: number): number {
  const next = clampCols(cols);
  if (next <= field.cols) return field.cols;
  field.cols = next;
  field.boss.file = clampFile(field.boss.file, next);
  return next;
}

/** Is this panel in a player's half? */
export const isPlayerLane = (lane: number): boolean => lane >= FIRST_PLAYER_LANE;

/** The anomaly's phase, 1..4: a dying boss swings sooner. */
export function bossPhase(boss: FieldBody): number {
  const frac = 1 - boss.hp / Math.max(1, boss.maxHp);
  return Math.max(1, Math.min(4, 1 + Math.floor(frac * 4)));
}

let seq = 0;
export const nextShotId = (): number => ++seq;
export const resetShotIds = (): void => {
  seq = 0;
};
