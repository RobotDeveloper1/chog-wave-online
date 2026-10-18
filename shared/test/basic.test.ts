import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASIC_CARDS, BASIC_IDS, anyCard, isBasicId } from '../src/cards.ts';
import { deriveBuild } from '../src/derive.ts';
import { BASIC_BASE, BASIC_PWR, BASIC_SPD, FOSTER_BASIC_SHARE, basicCard, basicCardFor, basicMight } from '../src/sf/loadout.ts';
import { HAND_CELLS, drawHand, view } from '../src/sf/hand.ts';
import { CARDS_ALL } from '../src/cards.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * The basic attack, which is the whole of what a Chog owns before it walks anywhere.
 *
 * The design claim in `docs/THE-LINE.md` §4.2 and §4.3 is specific and falsifiable:
 *
 *  - a hand is **always six cells**, whatever the deck holds;
 *  - the cells the deck cannot fill are the token's own element attack;
 *  - that number comes from the six attributes, so **the token's quality is the early game**;
 *  - and the client is told the substituted number, not the catalogue's placeholder.
 *
 * Each of those is asserted below against something that could go the other way.
 */

const metaDir = join(process.cwd(), '..', '.data', 'metadata');

/** The 493 real tokens, read the way `server/src/meta.ts` reads them: by `name`, not filename. */
function realTokens(): { id: number; attrs: Record<string, string> }[] {
  let files: string[];
  try {
    files = readdirSync(metaDir);
  } catch {
    return [];
  }
  const out: { id: number; attrs: Record<string, string> }[] = [];
  for (const f of files) {
    let j: { name?: string; attributes?: { trait_type: string; value: string }[] };
    try {
      j = JSON.parse(readFileSync(join(metaDir, f), 'utf8'));
    } catch {
      continue;
    }
    const id = Number(/(\d+)/.exec(j.name ?? '')?.[1] ?? 0);
    if (!id) continue;
    const attrs: Record<string, string> = {};
    for (const a of j.attributes ?? []) attrs[a.trait_type] = a.value;
    out.push({ id, attrs });
  }
  return out;
}

describe('the basic attack — six cards, one per element', () => {
  it('has exactly one per element and a name for each', () => {
    expect(BASIC_CARDS).toHaveLength(6);
    expect(new Set(BASIC_CARDS.map((c) => c.element)).size).toBe(6);
    for (const c of BASIC_CARDS) expect(anyCard(c.id), c.id).toBeTruthy();
  });

  it('is in the catalogue, so it renders, prices and draws an icon like any card', () => {
    for (const c of BASIC_CARDS) {
      expect(CARDS_ALL.map((x) => x.id), c.id).toContain(c.id);
      expect(isBasicId(c.id)).toBe(true);
      expect(BASIC_IDS[c.element]).toBe(c.id);
    }
  });

  it('is one panel, plain damage, and cannot drain the wave', () => {
    for (const c of BASIC_CARDS) {
      expect(c.shape, c.id).toEqual([[0, 0]]);
      expect(c.hits, c.id).toBe(1);
      expect(c.effect, c.id).toBe('none');
      expect(c.waveDrain, c.id).toBe(0);
      expect(c.klass, c.id).toBeUndefined();
    }
  });

  it('carries a placeholder power, because the real number belongs to the token', () => {
    for (const c of BASIC_CARDS) {
      expect(c.power, `${c.id} must not hard-code damage`).toBe(1);
      expect(basicCard(c.element, basicMight({ PWR: 10, SPD: 10 })).power).toBeGreaterThan(1);
    }
  });

  it('resolves to a neutral card for an element it does not know', () => {
    // `basicCard` is total: a bad element degrades to burn rather than returning undefined and
    // taking a hand down with it.
    expect(basicCardFor('nonsense' as never, { PWR: 5, SPD: 5 }).id).toBe('basic_burn');
  });
});

describe('the basic attack — the number is the token', () => {
  it('is the formula it claims to be', () => {
    for (const p of [2, 4, 7, 10]) {
      for (const s of [2, 4, 7, 10]) {
        expect(basicMight({ PWR: p, SPD: s })).toBe(Math.round(BASIC_BASE + p * BASIC_PWR + s * BASIC_SPD));
      }
    }
  });

  it('weighs PWR far above SPD, so a heavy and a sharp token are different builds', () => {
    expect(BASIC_PWR).toBeGreaterThan(BASIC_SPD * 3);
  });

  it('never returns zero, whatever the attributes', () => {
    expect(basicMight({ PWR: 0, SPD: 0 })).toBeGreaterThanOrEqual(1);
    expect(basicMight({ PWR: -5, SPD: -5 })).toBeGreaterThanOrEqual(1);
  });

  it('is monotonic in both attributes, up to what rounding allows', () => {
    // Non-decreasing, not increasing: `basicMight({PWR:2, SPD:9})` and `{PWR:2, SPD:10}` are
    // both 10, because `6 + 1.8 + 2.25` and `6 + 1.8 + 2.5` round to the same integer. A strict
    // assertion would be asserting that rounding does not exist.
    expect(basicMight({ PWR: 10, SPD: 2 })).toBeGreaterThanOrEqual(basicMight({ PWR: 9, SPD: 2 }));
    expect(basicMight({ PWR: 2, SPD: 10 })).toBeGreaterThanOrEqual(basicMight({ PWR: 2, SPD: 9 }));
    // Across the full attribute range, though, both clearly matter.
    expect(basicMight({ PWR: 10, SPD: 2 })).toBeGreaterThan(basicMight({ PWR: 2, SPD: 2 }));
    expect(basicMight({ PWR: 2, SPD: 10 })).toBeGreaterThan(basicMight({ PWR: 2, SPD: 2 }));
  });

  it('opens a real gap across the real collection, and no more than it claims', () => {
    const tokens = realTokens();
    if (!tokens.length) return; // no local metadata: the pure assertions above still ran
    const mights = tokens
      .map((t) => deriveBuild({ tokenId: t.id, transferCount: 1, daysHeld: 120, attributes: t.attrs }).basicMight)
      .sort((a, b) => a - b);
    const q = (p: number) => mights[Math.floor(p * (mights.length - 1))]!;
    // `docs/THE-LINE.md` §4.3 quotes these numbers. If the formula moves, this fails and the
    // document has to be corrected rather than the test loosened.
    expect(mights[0]).toBeGreaterThanOrEqual(9);
    expect(mights[mights.length - 1]!).toBeLessThanOrEqual(16);
    expect(q(0.9) / q(0.1)).toBeGreaterThanOrEqual(1.3);
    expect(q(0.9) / q(0.1)).toBeLessThanOrEqual(1.5);
  });

  it('costs a foster Chog real damage, which is the point', () => {
    const attrs = { Aura: 'Fire', Body: 'Kings Robe', Tier: 'Legendary', Eyes: 'Laser', Mouth: 'Smile', Base: 'Origin' };
    const held = deriveBuild({ tokenId: 7, transferCount: 0, daysHeld: 400, attributes: attrs });
    const foster = deriveBuild({ tokenId: 7, transferCount: 0, daysHeld: 400, attributes: attrs, foster: true });
    expect(foster.basicMight).toBeLessThan(held.basicMight);
    expect(foster.basicMight).toBeGreaterThan(0);
    // Exactly `FOSTER_BASIC_SHARE` of the uncapped token's, by construction.
    expect(foster.basicMight).toBe(Math.floor(held.basicMight * FOSTER_BASIC_SHARE));
    // And the ceiling, not the cap, is what does it. `capShares` handed this Foster's surplus
    // into PWR, which the basic attack reads — so computing from the *capped* attributes made a
    // free Chog hit harder (17) than the token it was borrowing (16). This is the regression the
    // assertion exists for.
    expect(foster.attrs.PWR).toBeGreaterThan(held.attrs.PWR);
    expect(basicMight(foster.attrs)).toBeGreaterThanOrEqual(foster.basicMight);
  });
});

describe('the hand is always a full hand', () => {
  const basic = basicCard('burn', basicMight({ PWR: 7, SPD: 6 }));
  const rand = () => 0.5;

  it('is six cells with an empty deck', () => {
    expect(drawHand([], rand, { basic })).toHaveLength(HAND_CELLS);
  });

  it('is six cells with one card', () => {
    expect(drawHand(['emberpaw'], rand, { basic })).toHaveLength(HAND_CELLS);
  });

  it('is six cells with a deck full enough to fill it on its own', () => {
    const full = ['emberpaw', 'rimeclaw', 'staticnip', 'undertow', 'refract', 'nullfur'];
    expect(drawHand(full, rand, { basic }).filter((h) => h.cardId.startsWith('basic_'))).toHaveLength(0);
  });

  it('is still short when there is no basic to fall back on', () => {
    // The one case where the screen is not full: no basic was supplied. `dealHand` always
    // supplies one, so this is the guard on the wiring rather than a rule about play.
    expect(drawHand(['emberpaw'], rand)).toHaveLength(1);
  });

  it('turns the empty cells into basics carrying its own element and number', () => {
    const hand = drawHand(['emberpaw'], rand, { basic });
    const fillers = hand.filter((h) => h.cardId === basic.id);
    expect(fillers).toHaveLength(HAND_CELLS - 1);
    for (const f of fillers) expect(f.might).toBe(basic.might);
  });

  it('gives a bigger deck fewer basics, which is what "more choice" means', () => {
    const basicsIn = (deck: string[]) => drawHand(deck, rand, { basic }).filter((h) => h.cardId === basic.id).length;
    expect(basicsIn([])).toBe(6);
    expect(basicsIn(['emberpaw'])).toBe(5);
    expect(basicsIn(['emberpaw', 'rimeclaw', 'staticnip'])).toBe(3);
    expect(basicsIn(['emberpaw', 'rimeclaw', 'staticnip', 'undertow', 'refract'])).toBe(1);
  });

  it('never puts two of the same card in one cell, and indexes the panel row-major', () => {
    const hand = drawHand(['emberpaw', 'emberpaw', 'emberpaw'], rand, { basic });
    expect(hand.map((h) => h.cell)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const h of hand) expect(h.row).toBe(Math.floor(h.cell / 2));
  });
});

describe('the client is told the substituted number', () => {
  it('sends the token\'s damage, not the catalogue placeholder', () => {
    const basic = basicCard('volt', basicMight({ PWR: 9, SPD: 7 }));
    const hand = drawHand([], () => 0.5, { basic });
    const state = { cells: hand, queue: [], lock: null, transformed: false, gigaSpent: false };
    const cells = view(state, { slots: 6, mega: 1, giga: 1 });
    expect(cells).toHaveLength(HAND_CELLS);
    for (const c of cells) {
      expect(c.card.power, 'client would draw power: 1').toBe(basic.might);
      expect(c.card.might).toBe(basic.might);
      expect(c.card.element).toBe('volt');
    }
  });

  it('leaves an ordinary card\'s power alone', () => {
    const hand = drawHand(['emberpaw'], () => 0.5, { basic: basicCard('burn', basicMight({ PWR: 9, SPD: 7 })) });
    const state = { cells: hand, queue: [], lock: null, transformed: false, gigaSpent: false };
    const cells = view(state, { slots: 6, mega: 1, giga: 1 });
    expect(cells[0]!.card.power).toBe(anyCard('emberpaw')!.power);
  });

  it('keeps the two numbers identical, so preview and hit cannot disagree', () => {
    // The failure this guards against is silent and expensive: the client showing "12" on the
    // card and the server landing 33. Both go through `view()`, so there is one number.
    const basic = basicCard('burn', basicMight({ PWR: 10, SPD: 10 }));
    const hand = drawHand([], () => 0.5, { basic });
    const state = { cells: hand, queue: [], lock: null, transformed: false, gigaSpent: false };
    const shown = view(state, { slots: 6, mega: 1, giga: 1 })[0]!.card.might;
    expect(shown).toBe(basicMight({ PWR: 10, SPD: 10 }));
  });
});