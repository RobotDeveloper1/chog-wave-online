import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STARTING_CHOG } from '@chog/shared';

/**
 * Real $CHOG: vault deposits in, automatic payouts out.
 *
 * The claims worth defending:
 *
 *  - **a vault Transfer credits once, however often it is re-polled** — the tx
 *    hash is recorded before anything is credited, so restarts and overlapping
 *    windows pay nothing twice;
 *  - **only the vault counts** — a $CHOG move between strangers is market
 *    traffic, not a deposit, and dust under one whole coin is recorded but unpaid;
 *  - **withdrawals debit first and queue visibly** — the pump pays from the
 *    hot wallet, so a request without a debit would be free money;
 *  - **histories never cross chains** — a mainnet launch must not read testnet
 *    rows as provenance, so the ledger file is chain-namespaced when CHAIN_ID
 *    is set and keeps the legacy name when it is not.
 *
 * Every test in this file shares one database directory, so wallets are unique
 * per test and assertions find their own rows.
 */

const VAULT = '0x1111111111111111111111111111111111111111';
const ALICE = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BOB = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CAROL = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const DAVE = '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
const ERIN = '0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';

let dir: string;
let World: typeof import('../src/world.ts').World;
let depositOf: typeof import('../src/chain.ts').depositOf;
let nextWindow: typeof import('../src/chain.ts').nextWindow;
let TransferLedger: typeof import('../src/ledger.ts').TransferLedger;
let TRANSFER_TOPIC: string;

const pad32 = (addr: string): string => '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
const hexWei = (whole: number, frac = 0): string =>
  '0x' + (BigInt(whole) * 10n ** 18n + BigInt(frac)).toString(16).padStart(64, '0');

function tokenLog(to: string, amountData: string, tx = '0xabc', from: string = ALICE) {
  return {
    blockNumber: '0x64',
    transactionHash: tx,
    topics: [TRANSFER_TOPIC, pad32(from), pad32(to)],
    data: amountData,
    removed: false,
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-deposits-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  process.env.VAULT_ADDRESS = VAULT;
  process.env.CHAIN_ID = '143';
  ({ World } = await import('../src/world.ts'));
  ({ depositOf, nextWindow } = await import('../src/chain.ts'));
  ({ TransferLedger } = await import('../src/ledger.ts'));
  ({ TRANSFER_TOPIC } = await import('../src/rpc.ts'));
});

afterAll(() => {
  delete process.env.VAULT_ADDRESS;
  delete process.env.CHAIN_ID;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* windows keeps the sqlite handle a moment */
  }
});

type ProfilesOf = { profiles: { chogOf(k: string): number } };
type SavesOf = { saves: { withdrawReqAll(): { id: number; wallet: string; amount: number; status: string }[] } };
const profilesOf = (world: InstanceType<typeof World>) => (world as unknown as ProfilesOf).profiles;

describe('depositOf', () => {
  it('pulls a vault deposit out of a $CHOG Transfer log', () => {
    const dep = depositOf(tokenLog(VAULT, hexWei(5)) as never, VAULT);
    expect(dep).toMatchObject({ txHash: '0xabc', from: ALICE.toLowerCase(), block: 100 });
    expect(dep!.amount).toBeCloseTo(5, 10);
  });

  it('ignores moves that do not land in the vault, and an unset vault', () => {
    expect(depositOf(tokenLog(BOB, hexWei(5)) as never, VAULT)).toBeNull();
    expect(depositOf(tokenLog(VAULT, hexWei(5)) as never, '')).toBeNull();
    // The vault paying out is not a deposit.
    expect(depositOf(tokenLog(VAULT, hexWei(5), '0xdef', VAULT) as never, VAULT)).toBeNull();
  });
});

describe('nextWindow', () => {
  it('walks one window per tick and never skips a gap', () => {
    // Steady state: everything new in one window.
    expect(nextWindow(100, 105, 900)).toEqual({ from: 101, to: 105 });
    // Nothing new: no fetch.
    expect(nextWindow(105, 105, 900)).toBeNull();
    // A two-hour outage (7200 blocks) catches up 900 at a time, from the oldest.
    expect(nextWindow(0, 7200, 900)).toEqual({ from: 1, to: 900 });
    expect(nextWindow(900, 7200, 900)).toEqual({ from: 901, to: 1800 });
    expect(nextWindow(6300, 7200, 900)).toEqual({ from: 6301, to: 7200 });
  });
});

describe('creditDeposits', () => {
  it('credits whole coins once per tx, and records dust without paying it', () => {
    const world = new World();
    const w = ALICE.toLowerCase();
    world.join('pa', { tokenId: 91001, transferCount: 0, daysHeld: 0 }, 'ashflat', ALICE);
    const profiles = profilesOf(world);
    expect(profiles.chogOf(w)).toBe(STARTING_CHOG);
    world.creditDeposits([{ txHash: '0xt1', from: w, amount: 5.9, block: 1 }]);
    expect(profiles.chogOf(w)).toBe(STARTING_CHOG + 5);
    // A re-polled window replays the same Transfer: still paid once.
    world.creditDeposits([{ txHash: '0xt1', from: w, amount: 5.9, block: 1 }]);
    expect(profiles.chogOf(w)).toBe(STARTING_CHOG + 5);
    // Dust is recorded (no double-take later) but never credited.
    world.creditDeposits([{ txHash: '0xdust', from: w, amount: 0.5, block: 2 }]);
    expect(profiles.chogOf(w)).toBe(STARTING_CHOG + 5);
    world.creditDeposits([{ txHash: '0xdust', from: w, amount: 0.5, block: 2 }]);
    expect(profiles.chogOf(w)).toBe(STARTING_CHOG + 5);
  });

  it('credits a wallet that has never joined, under its lowercase key', () => {
    const world = new World();
    const w = BOB.toLowerCase();
    world.creditDeposits([{ txHash: '0xt2', from: w, amount: 2, block: 3 }]);
    const profiles = profilesOf(world);
    expect(profiles.chogOf(w)).toBe(STARTING_CHOG + 2);
    // ...and joining later with a checksummed address lands on the same save.
    const p = world.join('pb', { tokenId: 91002, transferCount: 0, daysHeld: 0 }, 'ashflat', BOB);
    expect(p.saveKey).toBe(w);
    expect(profiles.chogOf(p.saveKey)).toBe(STARTING_CHOG + 2);
  });
});

describe('chog.withdraw', () => {
  it('debits first and queues a visible request for the payout pump', () => {
    const world = new World();
    world.join('pc', { tokenId: 91003, transferCount: 0, daysHeld: 0 }, 'ashflat', CAROL);
    world.creditDeposits([{ txHash: '0xw1', from: CAROL.toLowerCase(), amount: 10, block: 9 }]);
    const res = world.loop('pc', { action: 'chog.withdraw', amount: 3 }) as { ok: boolean; request: number; amount: number };
    expect(res.ok).toBe(true);
    expect(res.amount).toBe(3);
    expect(profilesOf(world).chogOf(CAROL.toLowerCase())).toBe(STARTING_CHOG + 10 - 3);
    const rows = (world as unknown as SavesOf).saves.withdrawReqAll();
    expect(rows).toContainEqual(expect.objectContaining({ id: res.request, wallet: CAROL.toLowerCase(), amount: 3, status: 'pending' }));
  });

  it('refuses funny money: fosters, fractions, and overdrafts', () => {
    const world = new World();
    world.join('pd', { tokenId: 91004, transferCount: 0, daysHeld: 0 }, 'ashflat');
    expect((world.loop('pd', { action: 'chog.withdraw', amount: 1 }) as { ok: boolean }).ok).toBe(false);
    world.join('pe', { tokenId: 91005, transferCount: 0, daysHeld: 0 }, 'ashflat', DAVE);
    expect((world.loop('pe', { action: 'chog.withdraw', amount: 0 }) as { ok: boolean }).ok).toBe(false);
    expect((world.loop('pe', { action: 'chog.withdraw', amount: STARTING_CHOG + 1 }) as { ok: boolean }).ok).toBe(false);
  });

  it('reports the vault and the balance for the deposit screen', () => {
    const world = new World();
    world.join('pf', { tokenId: 91006, transferCount: 0, daysHeld: 0 }, 'ashflat', ERIN);
    const res = world.loop('pf', { action: 'chog.deposit' }) as { ok: boolean; vault: string; balance: number };
    expect(res.ok).toBe(true);
    expect(res.vault).toBe(VAULT);
    expect(res.balance).toBe(STARTING_CHOG);
  });
});

describe('chain-namespaced ledger', () => {
  it('keeps each chain its own transfers file, and the legacy name without CHAIN_ID', () => {
    const a = new TransferLedger(join(dir, 'transfers-143.json'));
    const b = new TransferLedger(join(dir, 'transfers-10143.json'));
    a.apply(7, '0x0000000000000000000000000000000000000000', ALICE.toLowerCase(), Date.now(), 101704037);
    a.flush();
    b.flush();
    expect(existsSync(join(dir, 'transfers-143.json'))).toBe(true);
    expect(b.history(7)).toBeNull();
    expect(existsSync(join(dir, 'transfers.json'))).toBe(false);
  });
});
