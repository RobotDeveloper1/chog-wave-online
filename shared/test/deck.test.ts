import { describe, expect, it } from 'vitest';
import { LINE_BASE_SLOTS, LINE_MAX_SLOTS } from '../src/line/index.ts';
import { deriveBuild } from '../src/derive.ts';
import { CARD_BY_ID, GA_CARDS, anyCard } from '../src/cards.ts';
import {
  autoDeck,
  canAdd,
  cardPool,
  checkDeck,
  defaultDeck,
  deckRules,
  deckStats,
  repairDeck,
} from '../src/deck.ts';

const TIERS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
const BODIES = ['Kings Robe', 'Tuxedo', 'Banana suit', 'Blue jacket', 'Golden Armor', 'Army Vest'];
const AURAS = ['Fire', 'Ice', 'Electric', 'Water', 'Rainbow', 'Void'];

const build = (id: number) =>
  deriveBuild({
    tokenId: id,
    transferCount: 0,
    daysHeld: 0,
    attributes: {
      Tier: TIERS[id % TIERS.length]!,
      Body: BODIES[id % BODIES.length]!,
      Aura: AURAS[(id * 7) % AURAS.length]!,
      Eyes: 'Laser',
      Mouth: 'Smile',
      Base: 'Origin',
    },
  });

/**
 * Slots a Chog with two regions of the Line crossed owns. Deck *size* stopped being a
 * function of the token (`folderSlots` is gone — `docs/THE-LINE.md` §4.4), so every test that
 * wants a deck with room in it has to say how much of the Line has been walked.
 */
const WALKED = 12;

describe('the born deck', () => {
  it('is empty — the signature is earned, not born', () => {
    for (let id = 1; id <= 240; id++) {
      const b = build(id);
      expect(b.deck, `token ${id}`).toEqual([]);
      expect(b.library).toEqual([]);
      expect(b.signature, `token ${id}`).toBeTruthy();
    }
  });

  it('is a legal deck for every kind of Chog, with room to grow', () => {
    for (let id = 1; id <= 240; id++) {
      const b = build(id);
      const rules = deckRules(b);
      const deck = defaultDeck(b);
      const res = checkDeck(rules, deck, new Set(cardPool(b, [])));
      expect(res.errors, `token ${id} (${b.loadout.profile}, ${b.loadout.element})`).toEqual([]);
      expect(res.ok).toBe(true);
      // Empty in two slots is the normal state of a Chog that has not left Camp Zero. Every
      // *empty* slot is the next place to walk, so the check reports room instead of
      // calling it an error.
      expect(res.room).toBe(rules.size);
    }
  });

  it('leaves the signature out until it is earned, then carries it', () => {
    for (let id = 1; id <= 240; id++) {
      const b = build(id);
      expect(defaultDeck(b)).toEqual([]);
      const pool = cardPool(b, [b.signature]);
      expect(autoDeck(b, pool)).toContain(b.signature);
    }
  });

  it('does not decide the deck size — the Line does', () => {
    const b = build(7);
    expect(deckRules(b).size).toBe(LINE_BASE_SLOTS);
    expect(deckRules(b, undefined, LINE_MAX_SLOTS).size).toBe(LINE_MAX_SLOTS);
    expect(deckRules(b).size).not.toBe(b.deck.length);
  });

  it('still lets the Body trait decide how many copies fit, once the Line has paid for room', () => {
    const b = build(7);
    const pool = new Set(cardPool(b, [...CARD_BY_ID.keys()]));
    expect(deckRules(b, undefined, WALKED).copies).toBeGreaterThanOrEqual(2);
    expect(canAdd(deckRules(b, undefined, WALKED), [b.signature], b.signature, pool)).toBe(true);
  });
});

describe('what may go in', () => {
  const b = build(3);
  const rules = deckRules(b, undefined, WALKED);
  const firstPlain = [...CARD_BY_ID.values()].find((c) => (!c.klass || c.klass === 'S') && c.element !== b.loadout.weakness)!.id;
  const pool = new Set(cardPool(b, [firstPlain]));

  it('never offers the element the Chog is weak to, except the signature', () => {
    const owned = [...CARD_BY_ID.values()].map((c) => c.id);
    for (const id of cardPool(b, owned)) {
      const c = anyCard(id)!;
      if (id !== b.signature) expect(c.element).not.toBe(b.loadout.weakness);
    }
  });

  it('refuses a card the player does not own', () => {
    const stranger = [...CARD_BY_ID.keys()].find((id) => !pool.has(id) && anyCard(id)!.element !== rules.banned)!;
    expect(canAdd(rules, [], stranger, pool)).toBe(false);
    const withIt = new Set([...pool, stranger]);
    expect(canAdd(rules, [], stranger, withIt)).toBe(true);
  });

  it('stops at the copy limit', () => {
    const plain = [...pool].find((id) => {
      const c = anyCard(id)!;
      return !c.klass || c.klass === 'S';
    })!;
    const deck = Array(rules.copies).fill(plain) as string[];
    expect(canAdd(rules, deck, plain, pool)).toBe(false);
    expect(canAdd(rules, deck.slice(1), plain, pool)).toBe(true);
  });

  it('enforces the Mega cap across different cards', () => {
    const owned = [...CARD_BY_ID.values()].filter((c) => c.klass === 'M' && c.element !== rules.banned).map((c) => c.id);
    const p = new Set(cardPool(b, owned));
    const deck: string[] = [];
    for (const id of owned) while (canAdd({ ...rules, copies: 5 }, deck, id, p) && deck.length < 40) deck.push(id);
    const mega = deck.filter((id) => id !== b.signature && anyCard(id)!.klass === 'M').length;
    expect(mega).toBe(rules.megaCap);
  });

  it('gives fused cards their own allowance and makes them singletons', () => {
    const ga = GA_CARDS.find((c) => c.element !== rules.banned)!;
    const p = new Set(cardPool(b, [ga.id]));
    expect(p.has(ga.id)).toBe(true);
    expect(canAdd(rules, [], ga.id, p)).toBe(true);
    expect(canAdd(rules, [ga.id], ga.id, p)).toBe(false);
    // A Chog with no Giga allowance can still carry its fused cards.
    expect(rules.fusedCap).toBe(1 + rules.gigaCap);
  });
});

describe('checkDeck says why', () => {
  const b = build(11);
  const rules = deckRules(b);
  const pool = new Set(cardPool(b, []));

it('rejects an over-full deck, a dropped signature and a stranger in one pass', () => {
    const res = checkDeck(rules, ['definitely-not-a-card'], pool);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/not a card/);
    // Empty is legal while the signature is still out there to be earned.
    expect(checkDeck(rules, [], pool).ok).toBe(true);
    // But a signature left out of a deck that holds it is a fault.
    const owned = new Set([...pool, b.signature]);
    const dropped = checkDeck(rules, [], owned);
    expect(dropped.ok).toBe(false);
    expect(dropped.errors.join(' ')).toMatch(/signature/);
    // Not /exactly/: being *under* full is no longer a fault. A Chog that has cleared one
    // encounter holds one card and has two slots, and that is a legal deck.
    const room = checkDeck(rules, [b.signature], owned);
    expect(room.ok).toBe(true);
    expect(room.room).toBe(rules.size - 1);
    // Over-full still is, because that is how a licence would be silently over-spent.
    expect(checkDeck(rules, Array(WALKED + 2).fill(b.signature), pool).ok).toBe(false);
  });
});

describe('autoDeck and repairDeck', () => {
  it('builds a legal deck from nothing, and fields the signature once earned', () => {
    for (let id = 1; id <= 120; id++) {
      const b = build(id);
      const pool = cardPool(b, []);
      const deck = autoDeck(b, pool);
      const res = checkDeck(deckRules(b, undefined, WALKED), deck, new Set(pool));
      expect(res.errors, `token ${id}`).toEqual([]);
      expect(deck).toEqual([]);
      const earned = autoDeck(b, [...pool, b.signature]);
      expect(earned).toContain(b.signature);
      expect(checkDeck(deckRules(b, undefined, WALKED), earned, new Set([...pool, b.signature])).ok).toBe(true);
    }
  });

  it('uses what the player earned: a stronger card in the pool raises the deck', () => {
    const b = build(5);
    const base = cardPool(b, []);
    const best = [...CARD_BY_ID.values()]
      .filter((c) => c.element !== b.loadout.weakness && (!c.klass || c.klass === 'S') && !base.includes(c.id))
      .sort((x, y) => y.power * y.hits - x.power * x.hits)[0]!;
    const before = deckStats(autoDeck(b, base)).avgPower;
    const after = deckStats(autoDeck(b, [...base, best.id])).avgPower;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(autoDeck(b, [...base, best.id])).toContain(best.id);
  });

  it('keeps the player\'s choices and tops up when a card is sold', () => {
    const b = build(9);
    const owned = [...CARD_BY_ID.values()].filter((c) => (!c.klass || c.klass === 'S') && c.element !== b.loadout.weakness).map((c) => c.id);
    const pool = cardPool(b, owned);
    const mine = autoDeck(b, pool, undefined, WALKED);
    const sold = mine.find((id) => id !== b.signature && !b.library.includes(id)) ?? mine.find((id) => id !== b.signature)!;
    const without = pool.filter((id) => id !== sold || b.library.includes(id));
    const fixed = repairDeck(b, mine, without, undefined, WALKED);
    const res = checkDeck(deckRules(b, undefined, WALKED), fixed, new Set(without));
    expect(res.errors).toEqual([]);
    expect(fixed).toHaveLength(WALKED);
    // Most of the player's own deck survives a single sale.
    const survivors = fixed.filter((id) => mine.includes(id)).length;
    expect(survivors).toBeGreaterThan(mine.length * 0.7);
  });

  it('repairs a hopeless deck into a legal one', () => {
    const b = build(14);
    const pool = cardPool(b, []);
    const fixed = repairDeck(b, ['nope', 'nope2'], pool, undefined, WALKED);
    expect(checkDeck(deckRules(b, undefined, WALKED), fixed, new Set(pool)).ok).toBe(true);
  });
});

describe('deckStats', () => {
  it('counts the elements and the average', () => {
    const s = deckStats(['emberpaw', 'emberpaw', 'rimeclaw']);
    expect(s.byElement).toEqual({ burn: 2, frost: 1 });
    expect(s.distinct).toBe(2);
    expect(s.avgPower).toBe(Math.round((90 + 90 + 70) / 3));
  });
});
