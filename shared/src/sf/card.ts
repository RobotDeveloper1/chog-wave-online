import { anyCard, card as catalogCard, isBasicId } from '../cards.ts';
import type { CellShape, Card, Element } from '../types.ts';
import { NULL_ELEMENT } from './element.ts';

/**
 * A Battle Card.
 *
 * Star Force's cards come in three classes and that is the whole of their rarity system:
 *
 *   - **STANDARD** — anything goes. Most of a deck is these.
 *   - **MEGA** — one per Hand. You may hold several in a deck (the deck licence
 *     decides how many) but you may only ever *select* one at a time, which is what makes the
 *     decision a decision: taking the Mega means not taking the other Mega.
 *   - **GIGA** — one per deck, full stop. A Giga is a build, not a card.
 *
 * The class is already on the card where the set declares one (`klass: 'S' | 'M' | 'G'`) and
 * derived from its might where it does not, so the whole existing catalogue keeps working and
 * the deck rules the game already enforces now mean something on the field.
 *
 * `kind` is the card's *verb*, which Star Force spells on the card face (Sword, Break,
 * Recover...) instead of hiding in a tooltip. Chog's cards have always carried one of these —
 * `pierce`, `stun`, `drain`, `knock`, `chain` — and until now nothing on the field read it.
 */

export type CardClass = 'standard' | 'mega' | 'giga';

export type CardKind = 'shot' | 'sword' | 'break' | 'stun' | 'drain' | 'chain' | 'burn' | 'freeze' | 'barrier';

export interface BattleCard {
  id: string;
  name: string;
  element: Element;
  cls: CardClass;
  kind: CardKind;
  /** Damage before any multiplier, per hit. */
  power: number;
  /** How many times it lands. Might is `power * hits`. */
  hits: number;
  might: number;
  /** Negative on a void card: it pushes the district's Wave Index *up*. */
  waveDrain: number;
  /** The footprint, as [laneOffset, fileOffset] from where the player stands. */
  shape: CellShape;
  /** How many files this card covers at its widest — its spread on the board. */
  spread: number;
}

const CLASS_OF: Record<'S' | 'M' | 'G', CardClass> = { S: 'standard', M: 'mega', G: 'giga' };

/** A card's might, which is what the class ladder is cut on. */
export const mightOf = (c: Card): number => c.power * c.hits;

/** Where a card sits on the class ladder. Declared class wins; otherwise might decides. */
export function cardClass(c: Card): CardClass {
  if (c.klass) return CLASS_OF[c.klass];
  const m = mightOf(c);
  if (m >= 420) return 'giga';
  if (m >= 200) return 'mega';
  return 'standard';
}

/**
 * The verb, in Star Force's spelling.
 *
 * `pierce` is a Sword (it goes through a wall), `knock` is a Break (it moves the thing and
 * strips a guard), `stun` and `drain` are what they say, `chain` is the card that carries
 * whatever element you are already running instead of its own, `burn` lights the anomaly up,
 * `freeze` runs its clock slow, and `barrier` is a charge that eats a landed hit.
 */
export function cardKind(c: Card): CardKind {
  switch (c.effect) {
    case 'pierce':
      return 'sword';
    case 'knock':
      return 'break';
    case 'stun':
      return 'stun';
    case 'drain':
      return 'drain';
    case 'chain':
      return 'chain';
    case 'burn':
      return 'burn';
    case 'freeze':
      return 'freeze';
    case 'barrier':
      return 'barrier';
    default:
      return 'shot';
  }
}

export const CLASS_LABEL: Record<CardClass, string> = { standard: 'STD', mega: 'MEGA', giga: 'GIGA' };

export const KIND_LABEL: Record<CardKind, string> = {
  shot: 'SHOT',
  sword: 'SWORD',
  break: 'BREAK',
  stun: 'STUN',
  drain: 'DRAIN',
  chain: 'CHAIN',
  burn: 'BURN',
  freeze: 'FREEZE',
  barrier: 'BARRIER',
};

/** One line, in the field manual's voice: what this verb does on the board. */
export const KIND_READ: Record<CardKind, string> = {
  shot: 'straight damage down the files it covers',
  sword: 'goes through the wall and any guard',
  break: 'shoves the anomaly onto the file it was fired from',
  stun: 'steals warning time off its next attack',
  drain: 'pays a share of the damage back as your integrity',
  chain: 'counts as whatever element you are already running',
  burn: 'lights it up: ticks of damage after the hit',
  freeze: 'runs its whole clock slow for a while',
  barrier: 'a charge that eats one landed hit',
};

const spreadOf = (shape: CellShape): number => {
  let lo = 0;
  let hi = 0;
  for (const [, dc] of shape) {
    if (dc < lo) lo = dc;
    if (dc > hi) hi = dc;
  }
  return hi - lo + 1;
};

/** Read a card off the shelf. Null for an id the catalogue does not hold. */
export function battleCard(id: string): BattleCard | null {
  const c = anyCard(id);
  return c ? ofCard(c) : null;
}

/** The same read, for a card the caller already has. */
export function ofCard(c: Card): BattleCard {
  return {
    id: c.id,
    name: c.name,
    element: c.element,
    cls: cardClass(c),
    kind: cardKind(c),
    power: c.power,
    hits: c.hits,
    might: mightOf(c),
    waveDrain: c.waveDrain,
    shape: c.shape,
    spread: spreadOf(c.shape),
  };
}

/** Strict: throws on an unknown id, for the code paths that already validated it. */
export function card(id: string): BattleCard {
  return ofCard(catalogCard(id));
}

/**
 * May this card be picked into a Hand whose lock is `lock`?
 *
 * Star Force's rule, and the whole of the Hand's depth: the **first card you take
 * sets the element**, and everything after it has to be that element or be NULL. So a hand is
 * not six independent choices, it is one choice (which element is this turn?) followed by
 * which cards of that element you can afford to spend.
 *
 * A Tribe On / Star Break lifts the lock entirely, which is what makes it a prize rather than
 * a bigger number.
 */
export function fitsLock(c: BattleCard, lock: Element | null, transformed: boolean): boolean {
  if (transformed || lock === null) return true;
  if (c.element === NULL_ELEMENT) return true;
  // The basic attack is filler, not a commitment: it chains with any element, which is
  // what the Line budgets price (`line/budget.ts` fills unfilled picks with basics).
  if (isBasicId(c.id)) return true;
  return c.element === lock;
}

/** The biggest class in a set of cards, which is what the "one Mega" rule is written against. */
export function topClass(cards: readonly BattleCard[]): CardClass {
  let out: CardClass = 'standard';
  for (const c of cards) {
    if (c.cls === 'giga') return 'giga';
    if (c.cls === 'mega') out = 'mega';
  }
  return out;
}

export const countClass = (cards: readonly BattleCard[], cls: CardClass): number =>
  cards.reduce((n, c) => n + (c.cls === cls ? 1 : 0), 0);
