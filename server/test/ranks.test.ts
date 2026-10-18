import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SF, progressOf, type RanksView } from '@chog/shared';

/**
 * The RANKS tab, from the server's side: four boards read off every save on disk.
 *
 * The claims worth defending:
 *
 *  - **every board is ordered, and the vault is not a player** — token 0 holds the
 *    team's rake, so it must never top the $CHOG board;
 *  - **a finished brawl is a win and a loss**, recorded by the same `endBrawl` that
 *    pays the wager — while a declined challenge records nothing;
 *  - **names are live**: whoever is standing on the street shows their callsign,
 *    and a save with nobody attached shows its token number.
 *
 * Every test in this file shares one database directory, so tokens are unique per
 * test and assertions find their own rows rather than assuming the boards' length.
 */

let dir: string;
let World: typeof import('../src/world.ts').World;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-ranks-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  ({ World } = await import('../src/world.ts'));
});
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* windows keeps the sqlite handle a moment */
  }
});

function twoOnStreet(aToken: number, bToken: number) {
  const world = new World();
  const a = world.join('p' + aToken, { tokenId: aToken, transferCount: 0, daysHeld: 0 }, 'ashflat');
  const b = world.join('p' + bToken, { tokenId: bToken, transferCount: 0, daysHeld: 0 }, 'ashflat');
  return { world, a, b };
}

function ranksOf(world: InstanceType<typeof World>, id: string): RanksView {
  const res = world.loop(id, { action: 'ranks' }) as { ok: boolean; ranks?: RanksView };
  expect(res.ok).toBe(true);
  return res.ranks!;
}

function finishPvp(world: InstanceType<typeof World>, id: string): void {
  const field = world.sessionOf(id)!;
  const st = field.state;
  const body = st.players.find((p) => p.id === id)!;
  const loser = st.players.find((p) => p.id !== id)!;
  loser.hp = 1;
  body.file = loser.file;
  for (const b of st.players) { b.chargeMs = 100_000; b.charge = 0; }
  field.field.hazards = [];
  body.handOpen = false;
  body.program = null;
  SF.openHand(st, body);
  const hand = body.hand!;
  const cell = hand.cells.find((c) => SF.canPick(hand, c.cell, SF.capsOf(body)).ok);
  expect(cell, 'a pickable card').toBeDefined();
  expect(SF.pickCard(st, id, cell!.cell)).toBe(true);
  expect(SF.execute(st, id)).toBe(true);
  for (let t = 0; t < 8000 && !st.over; t += 100) world.stepSessions(100);
  expect(field.state.result).toBe('win');
  expect(field.state.winnerId).toBe(id);
}

describe('ranks — four boards off every save', () => {
  it('orders level, money and road progress, and never seats the vault', () => {
    const { world, a, b } = twoOnStreet(4301, 4302);
    world.profiles.grant(a.tokenId, { xp: 200 });
    world.profiles.addChog(b.tokenId, 50);
    // The road progress is written the way a clear would leave it, then flushed:
    // `ranks` reads the disk, not the cache.
    world.profiles.doc(a.tokenId).line.cleared = ['tolls.1', 'tolls.2'];
    world.profiles.grant(a.tokenId, {});
    // The vault holds rake, so without the exclusion it would top the money board.
    world.profiles.addChog(0, 10_000);

    const view = ranksOf(world, a.id);
    expect(view.you).toBe(a.tokenId);
    const lv = view.level.map((r) => r.tokenId);
    expect(lv.indexOf(a.tokenId)).toBeLessThan(lv.indexOf(b.tokenId));
    // Joining already pays album XP for the token's own traits, so the level is read
    // off whatever the grant left behind — the board's job is the curve, not the sum.
    const rowA = view.level.find((r) => r.tokenId === a.tokenId)!;
    expect(rowA.xp).toBe(world.profiles.doc(a.tokenId).xp);
    expect(rowA.level).toBe(progressOf(rowA.xp).level);
    const money = view.chog.map((r) => r.tokenId);
    expect(money.indexOf(b.tokenId)).toBeLessThan(money.indexOf(a.tokenId));
    expect(view.chog.find((r) => r.tokenId === 0)).toBeUndefined();
    const road = view.line.find((r) => r.tokenId === a.tokenId)!;
    expect(road.lineCleared).toBe(2);
    expect(road.lineRegion).toBe('TOLLS');
    // Both are standing on the street, so both show their callsigns.
    expect(view.level.find((r) => r.tokenId === a.tokenId)!.name).toBe(a.build.callsign);
  });

  it('banks a win and a loss when a brawl ends, and nothing when one is refused', () => {
    const { world, a, b } = twoOnStreet(4311, 4312);
    world.pvpAction(a.id, { action: 'challenge', with: b.id });
    world.pvpAction(b.id, { action: 'decline' });
    world.pvpAction(a.id, { action: 'challenge', with: b.id });
    world.pvpAction(b.id, { action: 'accept' });
    finishPvp(world, a.id);

    const view = ranksOf(world, b.id);
    expect(view.pvp.find((r) => r.tokenId === a.tokenId)).toMatchObject({ pvpWins: 1, pvpLosses: 0 });
    expect(view.pvp.find((r) => r.tokenId === b.tokenId)).toMatchObject({ pvpWins: 0, pvpLosses: 1 });
  });

  it('shows the token number for a save with nobody standing on it', () => {
    const { world, a } = twoOnStreet(4321, 4322);
    // `profiles.ranks` is the boards before the street fills in the live names.
    const bare = world.profiles.ranks();
    expect(bare.you).toBe(-1);
    expect(bare.level.find((r) => r.tokenId === a.tokenId)!.name).toBe('#4321');
  });
});
