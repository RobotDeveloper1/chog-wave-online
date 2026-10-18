import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANOMALY_CARDS,
  DUNGEON_CARDS,
  DUNGEONS_AT_CARDS,
  ENCOUNTERS,
  LINE_BASE_SLOTS,
  LINE_MAX_SLOTS,
  REGIONS,
  REGION_BY_ID,
  wardenOf,
} from '@chog/shared';
import { SF } from '@chog/shared';

/**
 * The Line, on a live `World`.
 *
 * These are the assertions that matter for the whole design, because they are the ones a client
 * would be tempted to fake: *can this encounter even be cleared right now*, *does a repeat clear
 * pay again*, and *does a card land in the deck the moment it is earned*. Everything here is
 * pure in `shared/test/line.test.ts`; this file is the same promises with a server in front of
 * them, which is the only place "the client asked nicely" stops being the answer.
 *
 * `DATA_DIR` has to be redirected **before** `world.ts` is imported, because `SaveStore` reads it
 * when it is constructed. Importing `World` statically instead writes every test's clears into the
 * real `.data/chog-wave.db` â€” which is how the first run of this file banked all fifty Line cards
 * onto tokens 9100-9118 and made every later run fail against its own leftovers.
 */

let dir: string;
let World: typeof import('../src/world.ts').World;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-line-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  ({ World } = await import('../src/world.ts'));
});

afterAll(() => {
  // The SQLite handle is still open on Windows, so the wipe is best-effort â€” a leftover temp
  // directory is not worth failing a green suite over, and `duel.test.ts` does the same.
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* still locked */ }
});

let nextToken = 9100;

function seat() {
  const world = new World();
  const tokenId = nextToken++;
  const p = world.join(`line${tokenId}`, { tokenId, transferCount: 0, daysHeld: 0 }, 'ashflat', null);
  return { world, p, tokenId, build: p.build };
}

/** Clear a whole region the long way, so the next one is genuinely open. */
function clearRegion(s: ReturnType<typeof seat>, regionId: string): void {
  const r = REGION_BY_ID.get(regionId as never)!;
  for (const e of r.encounters) {
    const res = s.world.profiles.lineCleared(s.tokenId, [e.id], s.build);
    expect(res.ok, `${e.id}: ${res.reason}`).toBe(true);
  }
}

describe('line â€” a fresh Chog', () => {
  it('owns nothing and has two empty slots to walk into', () => {
    const s = seat();
    expect(s.world.profiles.slots(s.tokenId)).toBe(LINE_BASE_SLOTS);
    expect(s.world.profiles.lineCards(s.tokenId)).toEqual([]);
    expect(s.build.deck).toEqual([]);
    expect(s.build.signature).toBeTruthy();
  });

  it('starts with the dungeons shut and says which warden is in the way', () => {
    const s = seat();
    const view = s.world.profiles.lineView(s.tokenId);
    expect(view.dungeons.open).toBe(false);
    expect(view.dungeons.reason).toContain('Line');
    expect(view.anomalies.open).toBe(false);
  });

  it('has exactly one region open and five sealed', () => {
    const view = seat().world.profiles.lineView(nextToken - 1);
    expect(view.regions.filter((r) => r.state === 'open').map((r) => r.id)).toEqual(['tolls']);
    expect(view.regions.filter((r) => r.state === 'sealed')).toHaveLength(5);
  });
});

describe('line â€” clearing an encounter', () => {
  it('refuses an encounter the world does not hold', () => {
    const s = seat();
    expect(s.world.profiles.lineCleared(s.tokenId, ['tolls.99'], s.build).ok).toBe(false);
    expect(s.world.profiles.lineCleared(s.tokenId, ['atlantis.1'], s.build).ok).toBe(false);
  });

  it('refuses a region behind a standing warden, and names it', () => {
    const s = seat();
    const res = s.world.profiles.lineCleared(s.tokenId, ['ashpine.1'], s.build);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('TOLLS');
  });

  it('pays the named cards on the first clear and nothing on the second', () => {
    const s = seat();
    const first = s.world.profiles.lineCleared(s.tokenId, ['tolls.1'], s.build);
    expect(first.ok).toBe(true);
    expect(first.cards).toEqual(['emberpaw', 'splashback']);
    expect(s.world.profiles.lineCards(s.tokenId)).toEqual(['emberpaw', 'splashback']);

    const again = s.world.profiles.lineCleared(s.tokenId, ['tolls.1'], s.build);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('already cleared');
    // Two cards, once â€” not two copies of them.
    expect(s.world.profiles.lineCards(s.tokenId)).toEqual(['emberpaw', 'splashback']);
  });

  it('never hands the same card over twice across the whole Line', () => {
    const s = seat();
    const paid: string[] = [];
    for (const r of REGIONS) {
      for (const e of r.encounters) {
        const res = s.world.profiles.lineCleared(s.tokenId, [e.id], s.build);
        if (res.ok) paid.push(...(res.cards ?? []));
      }
    }
    expect(new Set(paid).size, 'a card was handed over twice').toBe(paid.length);
    expect(paid).toHaveLength(51);
  });

  it('leaves the eight anomaly cards and the eleven dungeon cards to their own systems', () => {
    const s = seat();
    for (const r of REGIONS) for (const e of r.encounters) s.world.profiles.lineCleared(s.tokenId, [e.id], s.build);
    const held = s.world.profiles.lineCards(s.tokenId);
    for (const id of [...ANOMALY_CARDS, ...DUNGEON_CARDS]) expect(held, id).not.toContain(id);
  });
});

describe('line â€” the deck follows the world', () => {
  it('grows as regions go down and stops at the cap', () => {
    const s = seat();
    const before = s.world.profiles.slots(s.tokenId);
    clearRegion(s, 'tolls');
    const after = s.world.profiles.slots(s.tokenId);
    expect(after).toBeGreaterThan(before);

    for (const r of REGIONS.slice(1)) clearRegion(s, r.id);
    expect(s.world.profiles.slots(s.tokenId)).toBe(LINE_MAX_SLOTS);
  });

  it('keeps a deck legal at every step, so a card is usable the moment it lands', () => {
    const s = seat();
    for (const r of REGIONS) {
      for (const e of r.encounters) {
        s.world.profiles.lineCleared(s.tokenId, [e.id], s.build);
        const deck = s.world.profiles.deckFor(s.tokenId, s.build);
        const view = s.world.profiles.deckView(s.tokenId, s.build);
        expect(view.check.errors, `${e.id}`).toEqual([]);
        expect(deck.length, `${e.id}`).toBeLessThanOrEqual(view.rules.size);
      }
    }
  });

  it('fills the new slots from what the Line just handed over', () => {
    const s = seat();
    clearRegion(s, 'tolls');
    const view = s.world.profiles.deckView(s.tokenId, s.build);
    expect(view.rules.size).toBeGreaterThan(LINE_BASE_SLOTS);
    s.world.profiles.autoDeck(s.tokenId, s.build);
    const deck = s.world.profiles.deckFor(s.tokenId, s.build);
    expect(deck.length).toBe(view.rules.size);
    expect(deck).toContain(s.build.signature);
  });

  it('holds every card the Line paid for once the whole Line is walked', () => {
    const s = seat();
    for (const r of REGIONS) clearRegion(s, r.id);
    const pool = new Set(s.world.profiles.pool(s.tokenId, s.build));
    // Fifty-one cards against a base bag of thirty-two: without the pinned flag on a Line clear the
    // last nineteen encounters would have refunded their reward into WAV and the player would be
    // quietly short a fifth of the world.
    expect(s.world.profiles.lineCards(s.tokenId)).toHaveLength(51);
    const missing = s.world.profiles
      .lineCards(s.tokenId)
      .filter((id) => !pool.has(id))
      // A card of the Chog's own weakness is never in the pool â€” that is `cardPool`'s rule, not a
      // reward that went missing.
      .filter((id) => SF.battleCard(id)!.element !== s.build.loadout.weakness);
    expect(missing).toEqual([]);
  });
});

describe('line â€” phase two opens where the design says', () => {
  it('is shut after one region however many cards the player has', () => {
    const s = seat();
    clearRegion(s, 'tolls');
    const view = s.world.profiles.lineView(s.tokenId);
    // One region is seven encounters' worth of cards, which is under the ten the dungeons want:
    // the point is that seven cannot buy phase two however far the region pushes the bar.
    expect(view.cards.length).toBeGreaterThan(0);
    expect(view.cards.length).toBeLessThan(DUNGEONS_AT_CARDS);
    expect(view.dungeons.open).toBe(false);
    expect(view.dungeons.reason).toContain('warden');
  });

  it('opens once two regions are crossed', () => {
    const s = seat();
    clearRegion(s, 'tolls');
    clearRegion(s, 'ashpine');
    expect(s.world.profiles.lineView(s.tokenId).dungeons.open).toBe(true);
  });

  it('opens the anomalies at the third region, not before', () => {
    const s = seat();
    clearRegion(s, 'tolls');
    clearRegion(s, 'ashpine');
    expect(s.world.profiles.lineView(s.tokenId).anomalies.open).toBe(false);
    clearRegion(s, 'marsh');
    expect(s.world.profiles.lineView(s.tokenId).anomalies.open).toBe(true);
  });

  it('never counts a warden twice, so grinding one region cannot open the next', () => {
    const s = seat();
    clearRegion(s, 'tolls');
    for (let i = 0; i < 10; i++) s.world.profiles.lineCleared(s.tokenId, [wardenOf('tolls').id], s.build);
    expect(s.world.profiles.lineView(s.tokenId).regions.filter((r) => r.state === 'done')).toHaveLength(1);
    expect(s.world.profiles.lineView(s.tokenId).dungeons.open).toBe(false);
  });
});

describe('line â€” a forged clear cannot open a region', () => {
  it('refuses to bank a warden that was never reached', () => {
    const s = seat();
    // Every id in one message, in one call: the server must not take a batch on trust.
    const res = s.world.profiles.lineCleared(s.tokenId, ENCOUNTERS.map((e) => e.id), s.build);
    expect(res.ok).toBe(false);
    expect(s.world.profiles.lineCards(s.tokenId)).toEqual([]);
  });

  it('takes the whole message or none of it, so a forged batch banks nothing', () => {
    const s = seat();
    // Tolls' seven encounters plus the first five of Ash Pine. Validated against one snapshot,
    // the road is refused at the second id â€” tolls.1 is not banked yet, so tolls.2 is out of
    // order â€” and not one id is committed.
    // A partial commit would be worse than the original bug: it lets a client push a region
    // forward one id at a time and learn the gate by probing.
    const res = s.world.profiles.lineCleared(s.tokenId, ENCOUNTERS.slice(0, 12).map((e) => e.id), s.build);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('walk the road in order');
    expect(s.world.profiles.lineView(s.tokenId).regions.filter((r) => r.state === 'done')).toHaveLength(0);
    expect(s.world.profiles.lineCards(s.tokenId)).toEqual([]);
  });

  it('persists the Line so a restart does not hand the cards back out', () => {
    const s = seat();
    s.world.profiles.lineCleared(s.tokenId, ['tolls.1'], s.build);
    const saved = JSON.stringify(s.world.profiles.doc(s.tokenId).line);
    expect(saved).toContain('tolls.1');
  });
});
