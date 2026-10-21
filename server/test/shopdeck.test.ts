import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CARD_BY_ID, stockForChips } from '@chog/shared';

let dir: string;
let World: typeof import('../src/world.ts').World;
let shelfSeed: (now: number) => number;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-shopdeck-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  ({ World } = await import('../src/world.ts'));
  ({ shelfSeed } = await import('../src/profiles.ts'));
});
afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); }
  catch { /* SQLite handles can remain open on Windows. */ }
});

let nextToken = 8100;
type Seat = { world: InstanceType<typeof World>; p: ReturnType<InstanceType<typeof World>['join']>; tokenId: number; build: { signature: string; loadout: { weakness: string } } };
function seat(): Seat {
  const world = new World();
  const tokenId = nextToken++;
  const p = world.join(`p${tokenId}`, { tokenId, transferCount: 0, daysHeld: 0 }, 'ashflat', null);
  world.profiles.grant(tokenId, { wav: 999_999 });
  return { world, p, tokenId, build: p.build as Seat['build'] };
}

/** Plain commons this Chog may field, for grants. */
function commons(s: Seat, n: number): string[] {
  return [...CARD_BY_ID.values()]
    .filter((c) => !c.klass && !c.signature && c.element !== (s.build.loadout.weakness as string))
    .slice(0, n)
    .map((c) => c.id);
}

/** A card on today's shelf this wallet can afford, does not hold, and may field. */
function shelfCard(s: Seat): string {
  const lines = stockForChips(shelfSeed(Date.now()), { mon: 3000 }, 'ashflat');
  const owned = new Set(s.world.saves.get(s.tokenId).cards);
  const line = lines.find((l) => {
    if (owned.has(l.stockId)) return false;
    const c = CARD_BY_ID.get(l.stockId);
    return !!c && !c.klass && !c.signature && c.element !== s.build.loadout.weakness && (l.price ?? 0) <= 999_999;
  });
  if (!line) throw new Error('no fittable shelf card today');
  return line.stockId;
}

describe('shop cards join the deck', () => {
  it('a bought card lands in a saved deck that has empty slots', () => {
    const s = seat();
    const held = commons(s, 1)[0]!;
    s.world.profiles.giveCards(s.tokenId, [held]);
    // A deliberate one-card build: legal, saved, and short.
    expect(s.world.loop(s.p.id, { action: 'deck.save', cards: [held] }).ok).toBe(true);
    const id = shelfCard(s);
    const bought = s.world.profiles.buy(s.tokenId, 'ashflat', 'card', id, 3000, Date.now(), []);
    expect(bought.ok).toBe(true);
    const deck = s.world.profiles.deckFor(s.tokenId, s.p.build);
    // The player's pick survives, in place — and the new card joins it.
    expect(deck[0]).toBe(held);
    expect(deck).toContain(id);
  });

  it('a full saved deck is left alone', () => {
    const s = seat();
    s.world.profiles.giveCards(s.tokenId, commons(s, 4));
    s.world.loop(s.p.id, { action: 'deck.auto' });
    const before = [...s.world.profiles.deckFor(s.tokenId, s.p.build)];
    const size = s.world.profiles.slots(s.tokenId);
    expect(before.length).toBe(size);
    const id = shelfCard(s);
    expect(s.world.profiles.buy(s.tokenId, 'ashflat', 'card', id, 3000, Date.now(), []).ok).toBe(true);
    // Full means curated: the buy lands in the collection, not over the build.
    expect(s.world.profiles.deckFor(s.tokenId, s.p.build)).toEqual(before);
    expect(s.world.saves.get(s.tokenId).cards).toContain(id);
  });
});
