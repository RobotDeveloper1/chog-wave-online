import { CARDS, anyCard } from './cards.ts';
import { LINE_BASE_SLOTS } from './line/index.ts';
import type { DeckLicence } from './progress.ts';
import { deckShape } from './traits.ts';
import type { ChogBuild, Card, Element } from './types.ts';

/**
 * The Deck: the deck a Chog fights with.
 *
 * Until this existed the fight drew from `build.library` — the cards a token was *born*
 * with — and everything the player bought, won or fused went into a bag that no fight could
 * see. That made the whole economy decorative: a better card changed nothing. The deck is
 * the missing joint. The NFT still decides the *shape* of it (how many cards, how many
 * copies of one, how many Mega and Giga, which element it may never field), so a rare token
 * has a bigger, heavier deck and a flipped one cannot be out-built by money alone; the
 * player decides what goes in it, from what they have earned.
 *
 * Pure, so the server can refuse a deck the rules do not allow and the client can show
 * why before it asks.
 */

export interface DeckRules {
  /** Exactly this many cards. */
  size: number;
  /** Most copies of any one card (fused cards are singletons; Mega and Giga also share a total cap). */
  copies: number;
  /** Total Mega cards, copies included. */
  megaCap: number;
  /** Total Giga cards, copies included. */
  gigaCap: number;
  /** Total fused (GA) cards. They are earned, so they get their own allowance. */
  fusedCap: number;
  /** An element this Chog may not field: its own weakness. */
  banned: Element;
  /** The born card. It is always in the deck and does not count against a cap. */
  signature: string;
  /** How much of each cap above is a licence bought with levels rather than the Chog's shape. */
  licence: DeckLicence;
}

/** A Chog with no licences: the born deck, exactly as its traits draw it. */
export const NO_LICENCE: DeckLicence = { mega: 0, giga: 0, fused: 0 };

/**
 * The caps are two numbers added together, and that is the whole joint between the NFT and
 * the world. `deckShape` and the loadout set the born half — a rare token really does field a
 * heavier deck, and no amount of walking changes it — while `licence` is the half the level
 * ladder hands out, so a foster Chog can grow into its own attributes instead of being frozen at
 * whatever it was born able to hold.
 *
 * **`size` is neither of those.** It comes from the Line (`slotsFor`): two slots when a Chog
 * wakes up, eighteen once the whole Line is walked. It used to be `24 + tier * 2` from the
 * token, which handed every player a full deck before they took a step and left the first hour
 * with nothing to decide. Now the size is something the world paid for and the token only
 * decides the shape of what goes in it. See `docs/THE-LINE.md` §4.4.
 */
export function deckRules(
  build: ChogBuild,
  licence: DeckLicence = NO_LICENCE,
  slots: number = LINE_BASE_SLOTS,
): DeckRules {
  const shape = deckShape(build.loadout.profile);
  const giga = build.loadout.gigaCap + licence.giga;
  return {
    size: Math.max(1, slots),
    copies: shape.copies,
    megaCap: build.loadout.megaCap + licence.mega,
    gigaCap: giga,
    fusedCap: 1 + giga + licence.fused,
    banned: build.loadout.weakness,
    signature: build.signature,
    licence,
  };
}

type Klass = 'S' | 'M' | 'G' | 'F';
const classOf = (c: Card): Klass => (c.id.startsWith('ga_') ? 'F' : (c.klass ?? 'S'));
/** Fused cards are earned one at a time; every other card is limited by the Body trait. */
const copyLimit = (rules: DeckRules, c: Card): number => (classOf(c) === 'F' ? 1 : rules.copies);

/**
 * Every card this Chog could put in a deck: what it was born with, what it owns, and
 * nothing of the element it cannot hold. The signature is always allowed — it is the one
 * card nobody else can field, and its element is a feature, not a mistake.
 */
export function cardPool(build: ChogBuild, owned: readonly string[]): string[] {
  const banned = build.loadout.weakness;
  const out = new Set<string>();
  for (const id of [...build.library, ...owned]) {
    const c = anyCard(id);
    if (!c) continue;
    if (c.element === banned && id !== build.signature) continue;
    out.add(id);
  }
  return [...out];
}

/**
 * The card the Training Sim pays for its first clear: a common card of the Chog's own tribe
 * that it does not hold yet. The first thing a new player can do with a reward is put it in
 * the deck — which is exactly what the quest after the Sim asks for.
 */
export function starterCard(build: ChogBuild, owned: readonly string[]): string | null {
  const have = new Set([...build.library, ...owned]);
  const banned = build.loadout.weakness;
  const common = CARDS.filter((c) => !c.klass && !have.has(c.id) && c.element !== banned);
  const own = common.find((c) => c.element === build.loadout.element);
  const best = [...common].sort((a, b) => b.power * b.hits - a.power * a.hits)[0];
  return (own ?? best)?.id ?? null;
}

/** The born deck: empty. The signature joins when it is earned, not when the Chog wakes. */
export function defaultDeck(build: ChogBuild): string[] {
  const out = [...build.deck];
  if (!out.includes(build.signature) && out.length) out[out.length - 1] = build.signature;
  return out;
}

interface Tally {
  counts: Record<string, number>;
  mega: number;
  giga: number;
  fused: number;
}

function tally(rules: DeckRules, deck: readonly string[]): Tally {
  const t: Tally = { counts: {}, mega: 0, giga: 0, fused: 0 };
  for (const id of deck) {
    const c = anyCard(id);
    if (!c) continue;
    t.counts[id] = (t.counts[id] ?? 0) + 1;
    if (id === rules.signature) continue;
    const k = classOf(c);
    if (k === 'M') t.mega++;
    else if (k === 'G') t.giga++;
    else if (k === 'F') t.fused++;
  }
  return t;
}

/** Would one more copy of `id` break a rule other than the total size? */
export function canAdd(rules: DeckRules, deck: readonly string[], id: string, pool: ReadonlySet<string>): boolean {
  const c = anyCard(id);
  if (!c || !pool.has(id)) return false;
  if (c.element === rules.banned && id !== rules.signature) return false;
  const t = tally(rules, deck);
  // The signature is exempt from the class caps (a Giga born card fits a Chog whose cap is
  // zero) but not from the copy limit, which is what the Body trait sets.
  const limit = id === rules.signature ? rules.copies : copyLimit(rules, c);
  if ((t.counts[id] ?? 0) >= limit) return false;
  if (id === rules.signature) return true;
  const k = classOf(c);
  if (k === 'M' && t.mega >= rules.megaCap) return false;
  if (k === 'G' && t.giga >= rules.gigaCap) return false;
  if (k === 'F' && t.fused >= rules.fusedCap) return false;
  return true;
}

export interface DeckCheck {
  ok: boolean;
  errors: string[];
  size: number;
  mega: number;
  giga: number;
  fused: number;
  /** How many slots are still empty. All of them on a fresh Chog, which starts empty. */
  room: number;
  /** Copies of each card, for the editor to show. */
  counts: Record<string, number>;
}

export function checkDeck(rules: DeckRules, deck: readonly string[], pool: ReadonlySet<string>): DeckCheck {
  const errors: string[] = [];
  const t = tally(rules, deck);
  for (const id of deck) {
    const c = anyCard(id);
    if (!c) errors.push(`${id} is not a card`);
    else if (!pool.has(id)) errors.push(`${c.name} is not in your collection`);
  }
  // Over-full is a rule; under-full is a Tuesday. A fresh Chog holds nothing and that is a
  // legal deck — every empty slot is the next place to walk. Nothing in the save fills a gap
  // with a duplicate; the fight pads its own transient copy (`padWithCopies`).
  if (deck.length > rules.size) errors.push(`a deck holds ${rules.size} cards (${deck.length})`);
  for (const [id, n] of Object.entries(t.counts)) {
    const c = anyCard(id)!;
    const limit = id === rules.signature ? rules.copies : copyLimit(rules, c);
    if (n > limit) errors.push(`${c.name}: at most ${limit} cop${limit === 1 ? 'y' : 'ies'}`);
    if (c.element === rules.banned && id !== rules.signature) errors.push(`${c.name}: your Chog cannot field ${rules.banned}`);
  }
  if (t.mega > rules.megaCap) errors.push(`too many Mega cards (${t.mega}/${rules.megaCap})`);
  if (t.giga > rules.gigaCap) errors.push(`too many Giga cards (${t.giga}/${rules.gigaCap})`);
  if (t.fused > rules.fusedCap) errors.push(`too many fused cards (${t.fused}/${rules.fusedCap})`);
  if (!deck.includes(rules.signature) && pool.has(rules.signature)) errors.push('the signature card must stay in the deck');
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    size: deck.length,
    mega: t.mega,
    giga: t.giga,
    fused: t.fused,
    room: Math.max(0, rules.size - deck.length),
    counts: t.counts,
  };
}

/** How good a card is for a deck: raw output, with a nod to the Chog's own tribe. */
function worth(c: Card, element: Element): number {
  const raw = c.power * Math.max(1, c.hits);
  return raw * (c.element === element ? 1.2 : 1) * (1 + Math.min(4, Math.max(0, c.waveDrain)) * 0.02);
}

/**
 * Fill `deck` toward the rules' size from `pool`, strongest first - one of each, never a
 * second copy. This is the top-up a SAVED deck gets: the gaps stay gaps until a distinct
 * card arrives to fill them, which is why a bought, drafted or dropped card joins the deck
 * the moment it lands. Copies are the fight's business (`padWithCopies`), never the save's:
 * a filler duplicate in the save is indistinguishable from a curated one, and a deck that
 * looks full stops accepting new cards.
 */
function fill(build: ChogBuild, rules: DeckRules, start: string[], pool: readonly string[]): string[] {
  const set = new Set(pool);
  const out = [...start];
  const cards = pool
    .map((id) => anyCard(id))
    .filter((c): c is Card => !!c)
    .sort((a, b) => worth(b, build.loadout.element) - worth(a, build.loadout.element));
  for (const c of cards) {
    if (out.length < rules.size && !out.includes(c.id) && canAdd(rules, out, c.id, set)) out.push(c.id);
  }
  return out;
}

/**
 * The fight's copy of a deck: the saved cards plus copies of the best of them, up to the
 * size the Line paid for. Transient - never persisted - so filler can make a hand strong
 * without locking the save against the next card the player earns. Short decks still fight
 * (the hand pads with the basic attack), but a fuller hand is a stronger one.
 */
export function padWithCopies(
  build: ChogBuild,
  deck: readonly string[],
  pool: readonly string[],
  licence: DeckLicence = NO_LICENCE,
  slots: number = LINE_BASE_SLOTS,
): string[] {
  const rules = deckRules(build, licence, slots);
  const set = new Set(pool);
  const out = [...deck];
  const cards = pool
    .map((id) => anyCard(id))
    .filter((c): c is Card => !!c)
    .sort((a, b) => worth(b, build.loadout.element) - worth(a, build.loadout.element));
  for (const c of cards) {
    while (out.length < rules.size && canAdd(rules, out, c.id, set)) out.push(c.id);
  }
  return out;
}

/** The best distinct deck the rules allow from this pool. What a fresh save starts from. */
export function autoDeck(
  build: ChogBuild,
  pool: readonly string[],
  licence: DeckLicence = NO_LICENCE,
  slots: number = LINE_BASE_SLOTS,
): string[] {
  const rules = deckRules(build, licence, slots);
  return fill(build, rules, pool.includes(build.signature) ? [build.signature] : [], pool);
}

/**
 * After a card is sold or a rule changes: keep every card of the player's own choice that is
 * still legal, in order (the player's own duplicates survive), and top up the gaps with the
 * best distinct cards they hold. Gaps with nothing distinct to fill them stay gaps.
 */
export function repairDeck(
  build: ChogBuild,
  deck: readonly string[],
  pool: readonly string[],
  licence: DeckLicence = NO_LICENCE,
  slots: number = LINE_BASE_SLOTS,
): string[] {
  const rules = deckRules(build, licence, slots);
  const set = new Set(pool);
  const kept: string[] = [];
  const sequence = deck.includes(build.signature) ? [...deck] : [build.signature, ...deck];
  for (const id of sequence) {
    if (kept.length < rules.size && canAdd(rules, kept, id, set)) kept.push(id);
  }
  return fill(build, rules, kept, pool);
}

export interface DeckStats {
  avgPower: number;
  byElement: Record<string, number>;
  distinct: number;
}

export function deckStats(deck: readonly string[]): DeckStats {
  const byElement: Record<string, number> = {};
  let sum = 0;
  let n = 0;
  for (const id of deck) {
    const c = anyCard(id);
    if (!c) continue;
    byElement[c.element] = (byElement[c.element] ?? 0) + 1;
    sum += c.power * Math.max(1, c.hits);
    n++;
  }
  return { avgPower: n ? Math.round(sum / n) : 0, byElement, distinct: new Set(deck).size };
}
