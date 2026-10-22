import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_WAGER, WITHDRAW_DAILY_MAX } from '@chog/shared';

/**
 * Automatic $CHOG payouts: queued withdrawals become real transfers.
 *
 * The claims worth defending:
 *
 *  - **a row is paid once, however often the pump runs** — the claim is an
 *    atomic `pending -> sending` flip, so overlapping pumps and restarts pay
 *    nothing twice;
 *  - **a failed transfer refunds the ledger** — the debit happened at request
 *    time, so a revert or an RPC outage must put the coins back and say why;
 *  - **an empty float waits instead of failing** — the row goes back to
 *    `pending`, keeping its place in the day's cap, until the vault is topped up;
 *  - **the daily cap counts everything outstanding** — queued, in flight and
 *    paid, so rapid-fire requests cannot slip past the pump; only refunded
 *    (`failed`) rows stop counting;
 *  - **a PvP bid is covered before it is clamped** — a 2000 bid from a 1000
 *    wallet is refused, not silently shrunk to a bet the player never named;
 *    a coverable over-cap bid becomes exactly MAX_WAGER.
 *
 * Processor tests each get a fresh database directory; world tests share one
 * directory with unique wallets per test.
 */

const VAULT = '0x1111111111111111111111111111111111111111';
const ALICE = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BETO = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CAROL = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const DAVE = '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';

let dir: string;
let World: typeof import('../src/world.ts').World;
let SaveStore: typeof import('../src/save.ts').SaveStore;
let Profiles: typeof import('../src/profiles.ts').Profiles;
let PayoutProcessor: typeof import('../src/payouts.ts').PayoutProcessor;

type PayoutSender = import('../src/payouts.ts').PayoutSender;
type PayoutEvent = import('../src/payouts.ts').PayoutEvent;

/** A chain that does what the test says. Records every transfer attempt. */
function fakeSender(opts: { float?: number; failSend?: string; receipts?: Map<string, boolean | null> } = {}): PayoutSender & {
  sends: { to: string; whole: number }[];
} {
  const sends: { to: string; whole: number }[] = [];
  let n = 0;
  return {
    sends,
    async balance(): Promise<number> {
      return opts.float ?? 10_000;
    },
    async send(to: string, whole: number): Promise<string> {
      sends.push({ to, whole });
      if (opts.failSend) throw new Error(opts.failSend);
      n += 1;
      return `0xtx${n}`;
    },
    async receiptOk(tx: string): Promise<boolean | null> {
      return opts.receipts?.get(tx) ?? null;
    },
  };
}

const stores: { close(): void }[] = [];
function freshStore(): InstanceType<typeof SaveStore> {
  const s = new SaveStore(mkdtempSync(join(tmpdir(), 'chog-payouts-')));
  stores.push(s);
  return s;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-payouts-world-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  process.env.VAULT_ADDRESS = VAULT;
  process.env.CHAIN_ID = '143';
  // No HOT_WALLET_KEY on purpose: the world must run with payouts off,
  // queuing visibly instead of starting a pump.
  ({ World } = await import('../src/world.ts'));
  ({ SaveStore } = await import('../src/save.ts'));
  ({ Profiles } = await import('../src/profiles.ts'));
  ({ PayoutProcessor } = await import('../src/payouts.ts'));
});

afterEach(() => {
  while (stores.length) {
    try {
      stores.pop()!.close();
    } catch {
      /* already closed */
    }
  }
});

afterAll(() => {
  delete process.env.DATA_DIR;
  delete process.env.META_DIR;
  delete process.env.FEED;
  delete process.env.VAULT_ADDRESS;
  delete process.env.CHAIN_ID;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* windows keeps the sqlite handle a moment */
  }
});

describe('PayoutProcessor', () => {
  it('pays each pending row once, oldest first, and records the tx', async () => {
    const saves = freshStore();
    const profiles = new Profiles(saves);
    const sender = fakeSender();
    const events: PayoutEvent[] = [];
    const pump = new PayoutProcessor(saves, profiles, sender, (e) => events.push(e));
    const w = ALICE.toLowerCase();
    saves.withdrawReqPut(w, 40, w);
    saves.withdrawReqPut(w, 60, w);

    await pump.pump();
    // A second run — a restart, an overlapping tick — pays nothing again.
    await pump.pump();

    expect(sender.sends).toEqual([
      { to: w, whole: 40 },
      { to: w, whole: 60 },
    ]);
    const rows = saves.withdrawReqAll();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ amount: 40, status: 'done', tx: '0xtx1' });
    expect(rows[1]).toMatchObject({ amount: 60, status: 'done', tx: '0xtx2' });
    expect(events).toEqual([
      expect.objectContaining({ amount: 40, ok: true, tx: '0xtx1' }),
      expect.objectContaining({ amount: 60, ok: true, tx: '0xtx2' }),
    ]);
  });

  it('pays once when two pumps overlap', async () => {
    const saves = freshStore();
    const profiles = new Profiles(saves);
    const sender = fakeSender();
    const pump = new PayoutProcessor(saves, profiles, sender);
    const w = BETO.toLowerCase();
    saves.withdrawReqPut(w, 25, w);

    await Promise.all([pump.pump(), pump.pump()]);

    expect(sender.sends).toHaveLength(1);
    expect(saves.withdrawReqAll()[0]!.status).toBe('done');
  });

  it('claims atomically: whoever is second gets nothing', () => {
    const saves = freshStore();
    const id = saves.withdrawReqPut(CAROL.toLowerCase(), 10, CAROL.toLowerCase());
    expect(saves.withdrawClaim(id)).toBe(true);
    expect(saves.withdrawClaim(id)).toBe(false);
  });

  it('refunds the ledger when the transfer fails, and says why', async () => {
    const saves = freshStore();
    const profiles = new Profiles(saves);
    const sender = fakeSender({ failSend: 'transfer reverted' });
    const events: PayoutEvent[] = [];
    const pump = new PayoutProcessor(saves, profiles, sender, (e) => events.push(e));
    const w = DAVE.toLowerCase();
    const before = profiles.chogOf(w);
    // The world debits at request time; the pump only ever refunds.
    profiles.addChog(w, -120);
    expect(profiles.chogOf(w)).toBe(before - 120);
    saves.withdrawReqPut(w, 120, w);

    await pump.pump();

    expect(saves.withdrawReqAll()[0]).toMatchObject({ status: 'failed', note: 'transfer reverted' });
    expect(profiles.chogOf(w)).toBe(before);
    expect(events).toEqual([expect.objectContaining({ amount: 120, ok: false, note: 'transfer reverted' })]);
  });

  it('requeues when the float is too low, without paying or refunding', async () => {
    const saves = freshStore();
    const profiles = new Profiles(saves);
    const sender = fakeSender({ float: 5 });
    const events: PayoutEvent[] = [];
    const pump = new PayoutProcessor(saves, profiles, sender, (e) => events.push(e));
    const w = ALICE.toLowerCase();
    const before = profiles.chogOf(w);
    profiles.addChog(w, -120);
    saves.withdrawReqPut(w, 120, w);

    await pump.pump();

    expect(sender.sends).toHaveLength(0);
    expect(saves.withdrawReqAll()[0]!.status).toBe('pending');
    expect(profiles.chogOf(w)).toBe(before - 120);
    expect(events).toEqual([expect.objectContaining({ ok: false, note: 'vault float too low, requeued' })]);
  });

  it('recover returns crash-orphaned rows to the queue, and the pump then pays them', async () => {
    const saves = freshStore();
    const profiles = new Profiles(saves);
    const sender = fakeSender();
    const pump = new PayoutProcessor(saves, profiles, sender);
    const w = BETO.toLowerCase();
    const id = saves.withdrawReqPut(w, 30, w);
    // A dead process claimed the row and died before the transfer: no tx.
    expect(saves.withdrawClaim(id)).toBe(true);

    await pump.recover();
    expect(saves.withdrawReqAll()[0]!.status).toBe('pending');

    await pump.pump();
    expect(sender.sends).toEqual([{ to: w, whole: 30 }]);
    expect(saves.withdrawReqAll()[0]!.status).toBe('done');
  });
});

describe('withdraw daily cap', () => {
  it(`refuses once the day's queued and paid passes ${WITHDRAW_DAILY_MAX}`, () => {
    const world = new World();
    world.join('pw', { tokenId: 92001, transferCount: 0, daysHeld: 0 }, 'ashflat', CAROL);
    const w = CAROL.toLowerCase();
    world.creditDeposits([{ txHash: '0xcap1', from: w, amount: 2500, block: 1 }]);
    type LoopRes = { ok: boolean; reason?: string; amount?: number };
    expect((world.loop('pw', { action: 'chog.withdraw', amount: 1500 }) as LoopRes).ok).toBe(true);
    // Still-queued rows count: 1500 + 500 lands exactly on the cap.
    expect((world.loop('pw', { action: 'chog.withdraw', amount: 500 }) as LoopRes).ok).toBe(true);
    const over = world.loop('pw', { action: 'chog.withdraw', amount: 1 }) as LoopRes;
    expect(over.ok).toBe(false);
    expect(over.reason).toContain(String(WITHDRAW_DAILY_MAX));
  });
});

describe('wager cover-before-clamp', () => {
  it('refuses a bid the wallet cannot cover, and clamps a coverable one', () => {
    const world = new World();
    world.join('pa', { tokenId: 92002, transferCount: 0, daysHeld: 0 }, 'ashflat', ALICE);
    world.join('pb', { tokenId: 92003, transferCount: 0, daysHeld: 0 }, 'ashflat', BETO);
    const inboxA: Record<string, unknown>[] = [];
    const inboxB: Record<string, unknown>[] = [];
    world.onPush('pa', (m) => inboxA.push(m));
    world.onPush('pb', (m) => inboxB.push(m));

    // 1000 in the wallet, 2000 named: refused, not silently shrunk.
    world.pvpAction('pa', { action: 'challenge', with: 'pb', wager: 2000 });
    expect(inboxA).toContainEqual({ t: 'pvp', refused: 'you cannot cover that' });
    expect(inboxB).toHaveLength(0);

    // Coverable but over the cap: the rival sees exactly MAX_WAGER.
    world.pvpAction('pa', { action: 'challenge', with: 'pb', wager: MAX_WAGER + 100 });
    expect(inboxB).toContainEqual({
      t: 'pvp',
      challenge: expect.objectContaining({ from: 'pa', wager: MAX_WAGER }),
    });
  });
});

describe('withdrawal provenance', () => {
  it('refuses paper: only deposited $CHOG can leave, floored per tx', () => {
    const world = new World();
    world.join('px', { tokenId: 92004, transferCount: 0, daysHeld: 0 }, 'ashflat', ALICE);
    world.join('py', { tokenId: 92005, transferCount: 0, daysHeld: 0 }, 'ashflat', BETO);
    type LoopRes = { ok: boolean; reason?: string };
    // ALICE holds the 1000 starting grant and nothing deposited: refused.
    const paper = world.loop('px', { action: 'chog.withdraw', amount: 1 }) as LoopRes;
    expect(paper.ok).toBe(false);
    expect(paper.reason).toContain('only deposited');
    // BETO deposits 5.9: five whole coins of allowance, dust ignored.
    world.creditDeposits([{ txHash: '0xprov1', from: BETO.toLowerCase(), amount: 5.9, block: 4 }]);
    expect((world.loop('py', { action: 'chog.withdraw', amount: 5 }) as LoopRes).ok).toBe(true);
    const over = world.loop('py', { action: 'chog.withdraw', amount: 1 }) as LoopRes;
    expect(over.ok).toBe(false);
    expect(over.reason).toContain('only deposited');
  });

  it('counts dust as nothing: two 0.5 deposits buy no withdrawal', () => {
    const world = new World();
    world.join('pz', { tokenId: 92006, transferCount: 0, daysHeld: 0 }, 'ashflat', DAVE);
    const w = DAVE.toLowerCase();
    world.creditDeposits([
      { txHash: '0xprov2', from: w, amount: 0.5, block: 5 },
      { txHash: '0xprov3', from: w, amount: 0.5, block: 6 },
    ]);
    // floor(0.5) + floor(0.5) = 0, not floor(1.0) = 1.
    expect((world.loop('pz', { action: 'chog.withdraw', amount: 1 }) as { ok: boolean }).ok).toBe(false);
  });
});
