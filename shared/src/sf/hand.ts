import { CARD_BY_ID } from '../cards.ts';
import { NULL_ELEMENT } from './element.ts';
import { battleCard, countClass, fitsLock, type BattleCard } from './card.ts';
import type { Element } from '../types.ts';

/**
 * The Hand.
 *
 * In Star Force the Hand Charge fills while you fight, and when it is full you open the Hand
 * Screen and take cards. That screen is the whole of the game's deck-building decision, and its
 * depth is entirely in what it will *not* let you do:
 *
 *   - **The first card you take sets the element.** Everything after it has to be that element,
 *     or be NULL. So a turn is not six independent picks, it is one decision — which element is
 *     this turn? — and then how much of it you can afford.
 *   - **One MEGA card per turn.** You may carry several in the deck; you may only spend one.
 *     Taking the Mega is refusing the other Mega.
 *   - **One GIGA in the deck, and one use per battle.** A Giga is a build, not a card. Spend
 *     it and the rest of the fight is fought without it.
 *   - **No duplicates.** One copy of a card per turn, which is the rule that makes a deck of
 *     twelve different cards better than a deck of twelve copies of the best one.
 *
 * A Tribe On lifts the element lock, which is the single reason to chase one.
 *
 * The order you pick in is the order they fire in, and that is a decision too: cards land
 * staggered, so the card you take first is the card that is in the air when the anomaly starts
 * its next wind-up — which is how you earn a counter.
 */

export const HAND_ROWS = 3;
export const HAND_COLS = 2;
export const HAND_CELLS = HAND_ROWS * HAND_COLS;

/** Star Force's own cap on a selection. Chogs start below it and grow into it. */
export const SELECT_CAP = 6;

export interface Candidate {
  /** Index into the 3x2 panel, row-major. */
  cell: number;
  row: number;
  col: number;
  cardId: string;
  /**
   * Overrides the catalogue's might for this cell. Set only for the basic attack, whose number
   * belongs to the token pressing it rather than to the card (`sf/loadout.ts basicMight`).
   *
   * It rides on the candidate rather than on the card so the substitution happens exactly once,
   * on the server, before `view()` — the client receives an ordinary `BattleCard` and has no way
   * to compute a different one, which is the only arrangement in which "when the two diverge the
   * player is being cheated" stays false.
   */
  might?: number;
}

export interface Caps {
  /** How many cards this Chog may take in one turn. 3 at first, 6 at the top. */
  slots: number;
  /** How many MEGA cards may be taken in one turn. Star Force's answer is one. */
  mega: number;
  /** How many GIGA cards may be taken in one turn. Also one, and the deck only holds one. */
  giga: number;
}

export interface HandState {
  cells: Candidate[];
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
  row: Math.floor(index / HAND_COLS),
  col: index % HAND_COLS,
});

export const emptyHand = (transformed = false): HandState => ({
  cells: [],
  queue: [],
  lock: null,
  transformed,
  gigaSpent: false,
});

const cardAt = (s: HandState, cell: number): BattleCard | null => {
  const c = s.cells.find((h) => h.cell === cell);
  if (!c) return null;
  const base = battleCard(c.cardId);
  if (!base || c.might === undefined) return base;
  return { ...base, might: c.might, power: c.might };
};

/** The cards currently taken, in firing order. */
export function taken(s: HandState): BattleCard[] {
  const out: BattleCard[] = [];
  for (const cell of s.queue) {
    const c = cardAt(s, cell);
    if (c) out.push(c);
  }
  return out;
}

/** The element rule as it stands: what the next pick has to be. */
export function lockOf(s: HandState): Element | null {
  return s.transformed ? null : s.lock;
}

/**
 * May this cell be taken next?
 *
 * The same function runs on the client (to grey the card out and say why) and on the server (to
 * refuse a program that could not have been built). If those two ever disagree the player is
 * being cheated, which is the only reason this file lives in `shared`.
 */
export function canPick(s: HandState, cell: number, caps: Caps): Verdict {
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
export function pick(s: HandState, cell: number, caps: Caps): { ok: boolean; reason?: LockReason; state: HandState } {
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
export function undo(s: HandState): HandState {
  if (!s.queue.length) return s;
  const queue = s.queue.slice(0, -1);
  const lock = queue.length ? lockFor(s, queue) : null;
  return { ...s, queue, lock };
}

export function clear(s: HandState): HandState {
  return { ...s, queue: [], lock: null };
}

function lockFor(s: HandState, queue: readonly number[]): Element | null {
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
 * Draw six candidates from the deck, **variety first**.
 *
 * Deck entries are card ids with repeats, so a Chog holding five copies of Emberpaw owns five
 * Emberpaws — that is what the Body trait's copy count is for, and it stays meaningful below.
 * But the deal is built distinct-first and only then topped up with second copies, because a
 * deck of three cards drawn with replacement shows the same three six times and the Hand
 * Screen has nothing to decide. The comment that used to sit on the 24-card born deck said
 * exactly this and was right: *the screen draws six candidates, so a deck of three is a deck
 * of three*.
 *
 * That is also what makes the basic attack reachable at all. Drawing with replacement meant a
 * one-card deck filled the whole panel by itself, so the empty cells the design leans on
 * (`docs/THE-LINE.md` §4.2) would never have appeared.
 *
 * `bonus` is Star Force's Bonus Card: a counter hit pays you in cards, and those cards turn up
 * here, on top of the six, so the screen can hold more than a hand's worth.
 */
export function drawCandidates(deck: readonly string[], rand: () => number, bonus: readonly string[] = []): Candidate[] {
  const out: Candidate[] = [];
  const push = (cardId: string): void => {
    if (out.length >= HAND_CELLS) return;
    const { row, col } = cellOf(out.length);
    out.push({ cell: out.length, row, col, cardId });
  };
  // A counter-hit card is dealt first and face-up: the reward for reading the wind-up is that
  // the card you are paid is one you get to see.
  for (const id of bonus.slice(0, HAND_CELLS)) push(id);

  // Round one is one of every distinct card, round two a second copy, and so on, so the copy
  // count still decides how many times a card may appear across the hand.
  const pool = deck.filter((id) => CARD_BY_ID.has(id));
  const taken = new Map<string, number>();
  let progressed = true;
  while (out.length < HAND_CELLS && progressed) {
    progressed = false;
    for (const id of pool) {
      if (out.length >= HAND_CELLS) break;
      const have = taken.get(id) ?? 0;
      if (have >= pool.filter((x) => x === id).length) continue;
      taken.set(id, have + 1);
      push(id);
      progressed = true;
    }
  }
  return out;
}

/**
 * A hand that sometimes *offers* a Giga.
 *
 * A deck holds at most one Giga and a hand is six draws, so left to chance the best card a
 * Chog owns would turn up about one screen in twelve and a player could go a whole evening
 * without seeing it. When the deck carries a Giga and this screen has not spent one yet, one
 * hand in four lays it down. It is a nudge, not a gift: the player still has to build a legal
 * program around it, and with one Mega allowed they may not be able to.
 */
/**
 * A hand that is always a full hand.
 *
 * `drawCandidates` deals what the deck holds and stops when it runs out. This tops the rest of
 * the 3x2 panel with `basic` — the token's own element attack, priced off its attributes — so the
 * Hand is six cells from the first fight to the last, and a Chog holding one card still
 * knows how to open a program.
 *
 * This is the join that makes "the deck is out there to be found" work. A deck of one is not a
 * smaller game, it is the same game with one cell that matters and five that are the floor:
 *
 *   deck 1  ->  1 signature + 5 basic   you are learning the board
 *   deck 6  ->  up to 6 distinct        your first real decision
 *   deck 18 ->  6 of 18                the deck is finally a deck
 *
 * So a bigger deck is felt as *choice per turn* rather than as a bigger number, which is the
 * same rule the level ladder obeys, applied to the thing that replaced it. See `docs/THE-LINE.md`
 * §4.2.
 *
 * The basic cells are marked with `might` so the substituted number survives all the way to the
 * client, and they are ordinary cards otherwise: they take a cell, they set the element lock like
 * anything else, and taking five of them in one turn is a legal (if dull) program.
 */
export function drawHand(
  deck: readonly string[],
  rand: () => number,
  opts: { bonus?: readonly string[]; gigaChance?: number; basic?: BattleCard } = {},
): Candidate[] {
  const hand = drawCandidates(deck, rand, opts.bonus ?? []);
  if (hand.length >= HAND_CELLS) return gigaNudge(hand, deck, rand, opts.gigaChance);
  if (!opts.basic) return hand;
  // Fill what is left with the basic attack, carrying its own element so the lock rule reads it
  // as a card rather than as a special case nobody downstream knows about.
  while (hand.length < HAND_CELLS) {
    const { row, col } = cellOf(hand.length);
    hand.push({ cell: hand.length, row, col, cardId: opts.basic.id, might: opts.basic.might });
  }
  return gigaNudge(hand, deck, rand, opts.gigaChance);
}

/** One hand in four lays the deck's Giga down, when it is holding one and has not spent it. */
function gigaNudge(hand: Candidate[], deck: readonly string[], rand: () => number, chance: number | undefined): Candidate[] {
  if (hand.length < HAND_CELLS) return hand;
  const giga = deck.map((id) => battleCard(id)).find((c) => c?.cls === 'giga');
  if (!giga) return hand;
  if (rand() >= (chance ?? 0.25)) return hand;
  const at = Math.floor(rand() * HAND_CELLS) % HAND_CELLS;
  hand[at] = { ...hand[at]!, cardId: giga.id, might: undefined };
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

export interface HandPreview {
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

export function view(s: HandState, caps: Caps): CellView[] {
  return s.cells.map((h) => {
    // Through `cardAt`, not `battleCard`: this is where the basic attack's substituted number
    // becomes the number the client draws. Reading the catalogue here would ship `power: 1`.
    const c = cardAt(s, h.cell)!;
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

export function preview(s: HandState, caps: Caps): HandPreview {
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

/**
 * The same refusals at the size a card can wear.
 *
 * A tile's badge has room for two words, not a sentence: "LOCKED · only one MEGA per turn" spilled
 * out of the corner and covered the art. The long form still lives in the tooltip and the aria
 * label, where there is room to be a sentence.
 */
export const REFUSAL_SHORT: Record<LockReason, string> = {
  empty: 'EMPTY',
  already: 'TAKEN',
  full: 'FULL',
  duplicate: 'DUPLICATE',
  element: 'WRONG ELEMENT',
  mega: 'ONE MEGA',
  giga: 'ONE GIGA',
  'giga-spent': 'GIGA SPENT',
};
