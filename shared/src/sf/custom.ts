import { CHIP_BY_ID } from '../chips.ts';
import { NULL_ELEMENT } from './element.ts';
import { battleCard, countClass, fitsLock, type BattleCard } from './card.ts';
import type { Element } from '../types.ts';

/**
 * The Custom Screen.
 *
 * In Star Force the Custom Gauge fills while you fight, and when it is full you open the Custom
 * Screen and take cards. That screen is the whole of the game's deck-building decision, and its
 * depth is entirely in what it will *not* let you do:
 *
 *   - **The first card you take sets the element.** Everything after it has to be that element,
 *     or be NULL. So a turn is not six independent picks, it is one decision — which element is
 *     this turn? — and then how much of it you can afford.
 *   - **One MEGA card per turn.** You may carry several in the folder; you may only spend one.
 *     Taking the Mega is refusing the other Mega.
 *   - **One GIGA in the folder, and one use per battle.** A Giga is a build, not a card. Spend
 *     it and the rest of the fight is fought without it.
 *   - **No duplicates.** One copy of a card per turn, which is the rule that makes a folder of
 *     twelve different cards better than a folder of twelve copies of the best one.
 *
 * A Tribe On lifts the element lock, which is the single reason to chase one.
 *
 * The order you pick in is the order they fire in, and that is a decision too: cards land
 * staggered, so the card you take first is the card that is in the air when the anomaly starts
 * its next wind-up — which is how you earn a counter.
 */

export const CUSTOM_ROWS = 3;
export const CUSTOM_COLS = 2;
export const CUSTOM_CELLS = CUSTOM_ROWS * CUSTOM_COLS;

/** Star Force's own cap on a selection. Chogs start below it and grow into it. */
export const SELECT_CAP = 6;

export interface Candidate {
  /** Index into the 3x2 panel, row-major. */
  cell: number;
  row: number;
  col: number;
  chipId: string;
}

export interface Caps {
  /** How many cards this Chog may take in one turn. 3 at first, 6 at the top. */
  slots: number;
  /** How many MEGA cards may be taken in one turn. Star Force's answer is one. */
  mega: number;
  /** How many GIGA cards may be taken in one turn. Also one, and the folder only holds one. */
  giga: number;
}

export interface CustomState {
  hand: Candidate[];
  /** Cells in the order they were taken. The firing order. */
  queue: number[];
  /** The element the first pick locked in. Null until something is taken. */
  lock: Element | null;
  /** Tribe On: the element lock is lifted for this screen. */
  transformed: boolean;
  /** Whether this battle's one Giga has already been spent. */
  gigaSpent: boolean;
}

export type LockReason =
  | 'empty'
  | 'already'
  | 'full'
  | 'duplicate'
  | 'element'
  | 'mega'
  | 'giga'
  | 'giga-spent';

export interface Verdict {
  ok: boolean;
  reason?: LockReason;
}

export const cellOf = (index: number): { row: number; col: number } => ({
  row: Math.floor(index / CUSTOM_COLS),
  col: index % CUSTOM_COLS,
});

export const emptyCustom = (transformed = false): CustomState => ({
  hand: [],
  queue: [],
  lock: null,
  transformed,
  gigaSpent: false,
});

const cardAt = (s: CustomState, cell: number): BattleCard | null => {
  const c = s.hand.find((h) => h.cell === cell);
  return c ? battleCard(c.chipId) : null;
};

/** The cards currently taken, in firing order. */
export function taken(s: CustomState): BattleCard[] {
  const out: BattleCard[] = [];
  for (const cell of s.queue) {
    const c = cardAt(s, cell);
    if (c) out.push(c);
  }
  return out;
}

/** The element rule as it stands: what the next pick has to be. */
export function lockOf(s: CustomState): Element | null {
  return s.transformed ? null : s.lock;
}

/**
 * May this cell be taken next?
 *
 * The same function runs on the client (to grey the card out and say why) and on the server (to
 * refuse a program that could not have been built). If those two ever disagree the player is
 * being cheated, which is the only reason this file lives in `shared`.
 */
export function canPick(s: CustomState, cell: number, caps: Caps): Verdict {
  const c = cardAt(s, cell);
  if (!c) return { ok: false, reason: 'empty' };
  if (s.queue.includes(cell)) return { ok: false, reason: 'already' };
  const picked = taken(s);
  if (s.queue.length >= Math.min(SELECT_CAP, caps.slots)) return { ok: false, reason: 'full' };
  if (picked.some((p) => p.id === c.id)) return { ok: false, reason: 'duplicate' };
  if (!fitsLock(c, lockOf(s), s.transformed)) return { ok: false, reason: 'element' };
  if (c.cls === 'mega' && countClass(picked, 'mega') >= Math.max(0, caps.mega)) return { ok: false, reason: 'mega' };
  if (c.cls === 'giga') {
    if (s.gigaSpent) return { ok: false, reason: 'giga-spent' };
    if (countClass(picked, 'giga') >= Math.max(0, caps.giga)) return { ok: false, reason: 'giga' };
  }
  return { ok: true };
}

/**
 * Take a cell. The first pick sets the element lock — unless it is NULL, which is precisely
 * what a NULL card is *for*: opening a turn without committing it.
 */
export function pick(s: CustomState, cell: number, caps: Caps): { ok: boolean; reason?: LockReason; state: CustomState } {
  const v = canPick(s, cell, caps);
  if (!v.ok) return { ok: false, ...(v.reason ? { reason: v.reason } : {}), state: s };
  const c = cardAt(s, cell)!;
  const first = s.queue.length === 0;
  return {
    ok: true,
    state: {
      ...s,
      queue: [...s.queue, cell],
      lock: first && c.element !== NULL_ELEMENT ? c.element : s.lock,
    },
  };
}

/** Take back the last pick. The lock goes with it when it was the card that set it. */
export function undo(s: CustomState): CustomState {
  if (!s.queue.length) return s;
  const queue = s.queue.slice(0, -1);
  const lock = queue.length ? lockFor(s, queue) : null;
  return { ...s, queue, lock };
}

export function clear(s: CustomState): CustomState {
  return { ...s, queue: [], lock: null };
}

function lockFor(s: CustomState, queue: readonly number[]): Element | null {
  for (const cell of queue) {
    const c = cardAt(s, cell);
    if (c && c.element !== NULL_ELEMENT) return c.element;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------

/**
 * Draw six candidates from the folder. Folder entries are card ids with repeats, so a Chog
 * holding five copies of Emberpaw sees it five times as often — which is what the Body trait's
 * copy count is actually for.
 *
 * `bonus` is Star Force's Bonus Card: a counter hit pays you in cards, and those cards turn up
 * here, on top of the six, so the screen can hold more than a hand's worth.
 */
export function drawCandidates(folder: readonly string[], rand: () => number, bonus: readonly string[] = []): Candidate[] {
  const pool = folder.filter((id) => CHIP_BY_ID.has(id));
  if (!pool.length && !bonus.length) return [];
  const out: Candidate[] = [];
  // A counter-hit card is dealt first and face-up: the reward for reading the wind-up is that
  // the card you are paid is one you get to see.
  for (const id of bonus.slice(0, CUSTOM_CELLS)) {
    if (out.length >= CUSTOM_CELLS) break;
    const { row, col } = cellOf(out.length);
    out.push({ cell: out.length, row, col, chipId: id });
  }
  while (out.length < CUSTOM_CELLS && pool.length) {
    const chipId = pool[Math.floor(rand() * pool.length) % pool.length]!;
    const { row, col } = cellOf(out.length);
    out.push({ cell: out.length, row, col, chipId });
  }
  return out;
}

/**
 * A hand that sometimes *offers* a Giga.
 *
 * A folder holds at most one Giga and a hand is six draws, so left to chance the best card a
 * Chog owns would turn up about one screen in twelve and a player could go a whole evening
 * without seeing it. When the folder carries a Giga and this screen has not spent one yet, one
 * hand in four lays it down. It is a nudge, not a gift: the player still has to build a legal
 * program around it, and with one Mega allowed they may not be able to.
 */
export function drawHand(
  folder: readonly string[],
  rand: () => number,
  opts: { bonus?: readonly string[]; gigaChance?: number } = {},
): Candidate[] {
  const hand = drawCandidates(folder, rand, opts.bonus ?? []);
  if (hand.length < CUSTOM_CELLS) return hand;
  const giga = folder.map((id) => battleCard(id)).find((c) => c?.cls === 'giga');
  if (!giga) return hand;
  const chance = opts.gigaChance ?? 0.25;
  if (rand() >= chance) return hand;
  const at = Math.floor(rand() * CUSTOM_CELLS) % CUSTOM_CELLS;
  hand[at] = { ...hand[at]!, chipId: giga.id };
  return hand;
}

// ---------------------------------------------------------------------------
// What the screen says
// ---------------------------------------------------------------------------

export interface CellView {
  cell: number;
  card: BattleCard;
  /** Why it is greyed out. Nothing means it can be taken. */
  locked: LockReason | null;
  picked: boolean;
  /** Position in the firing order, 1-based. */
  order: number;
}

export interface CustomPreview {
  cards: BattleCard[];
  /** Raw might of the program, before element, chain, counter or attack. */
  might: number;
  /** The element the turn is locked into, for the banner. */
  lock: Element | null;
  /** How many picks are left. */
  left: number;
  /** The biggest class in the program, which is what the EXECUTE button brags about. */
  top: 'standard' | 'mega' | 'giga';
}

export function view(s: CustomState, caps: Caps): CellView[] {
  return s.hand.map((h) => {
    const c = battleCard(h.chipId)!;
    const v = canPick(s, h.cell, caps);
    const order = s.queue.indexOf(h.cell);
    return {
      cell: h.cell,
      card: c,
      locked: v.ok ? null : v.reason ?? 'empty',
      picked: order >= 0,
      order: order + 1,
    };
  });
}

export function preview(s: CustomState, caps: Caps): CustomPreview {
  const cards = taken(s);
  let top: 'standard' | 'mega' | 'giga' = 'standard';
  for (const c of cards) {
    if (c.cls === 'giga') top = 'giga';
    else if (c.cls === 'mega' && top !== 'giga') top = 'mega';
  }
  return {
    cards,
    might: cards.reduce((n, c) => n + c.might, 0),
    lock: lockOf(s),
    left: Math.max(0, Math.min(SELECT_CAP, caps.slots) - s.queue.length),
    top,
  };
}

/** One line for the refusal, because "element" is not a sentence a player can act on. */
export const REFUSAL_TEXT: Record<LockReason, string> = {
  empty: 'no card there',
  already: 'already taken',
  full: 'no slots left',
  duplicate: 'one copy per turn',
  element: 'wrong element for this turn',
  mega: 'only one MEGA per turn',
  giga: 'only one GIGA per turn',
  'giga-spent': 'your GIGA is spent for this battle',
};
