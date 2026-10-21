import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * What a restart keeps: login sessions and PvP stakes.
 *
 * Everything else ephemeral — parties, invitations, the fights themselves —
 * evaporates with the process, and that is the honest design: they reform in
 * seconds. But a session that dies on every deploy logs the whole street out,
 * and stakes deducted at accept must come home when the bout never settles.
 * Both live in sqlite now, and the boot refunds the stranded pots before the
 * first connection.
 */

let dir: string;
let World: typeof import('../src/world.ts').World;
let SaveStore: typeof import('../src/save.ts').SaveStore;
let Auth: typeof import('../src/auth.ts').Auth;
let Ownership: typeof import('../src/owners.ts').Ownership;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-persist-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  ({ World } = await import('../src/world.ts'));
  ({ SaveStore } = await import('../src/save.ts'));
  ({ Auth } = await import('../src/auth.ts'));
  ({ Ownership } = await import('../src/owners.ts'));
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* windows keeps the sqlite handle a moment */
  }
});

describe('pvp escrow', () => {
  it('holds the pot on disk until the bout settles', () => {
    const saves = new SaveStore(dir);
    saves.escrowPut('pvp:a:b', '0xaaaa000000000000000000000000000000000001', '0xbbbb000000000000000000000000000000000002', 40);
    expect(saves.escrowAll()).toEqual([{ key: 'pvp:a:b', challenger: '0xaaaa000000000000000000000000000000000001', rival: '0xbbbb000000000000000000000000000000000002', wager: 40 }]);
    saves.escrowDel('pvp:a:b');
    expect(saves.escrowAll()).toEqual([]);
    saves.close();
  });

  it('refunds stranded stakes on boot, before the first connection', () => {
    const w1 = new World();
    const start = w1.profiles.chogOf(5001);
    // The crash, staged: both stakes deducted, the pot written, no settle.
    expect(w1.profiles.addChog(5001, -40)).toBe(true);
    expect(w1.profiles.addChog(5002, -40)).toBe(true);
    w1.saves.escrowPut('pvp:gone:gone', 5001, 5002, 40);
    expect(w1.profiles.chogOf(5001)).toBe(start - 40);
    w1.saves.close();
    const w2 = new World();
    expect(w2.profiles.chogOf(5001)).toBe(start);
    expect(w2.profiles.chogOf(5002)).toBe(start);
    expect(w2.saves.escrowAll()).toEqual([]);
    w2.saves.close();
  });
});

describe('auth sessions', () => {
  it('survives a restart, and forgets a logout', () => {
    const saves = new SaveStore(dir);
    const a1 = new Auth(new Ownership(), saves);
    const token = a1.adoptPrivy('0xABCDEF0000000000000000000000000000000001');
    expect(a1.addressFor(token)).toBe('0xabcdef0000000000000000000000000000000001');
    const a2 = new Auth(new Ownership(), saves);
    expect(a2.addressFor(token)).toBe('0xabcdef0000000000000000000000000000000001');
    a2.signOut(token);
    const a3 = new Auth(new Ownership(), saves);
    expect(a3.addressFor(token)).toBeNull();
    saves.close();
  });

  it('never replays a dead session from disk', () => {
    const saves = new SaveStore(dir);
    saves.sessionPut('old', '0x0000000000000000000000000000000000000002', Date.now() - 7 * 3600_000);
    const a = new Auth(new Ownership(), saves);
    expect(a.addressFor('old')).toBeNull();
    expect(saves.sessionsAll().some((s) => s.token === 'old')).toBe(false);
    saves.close();
  });
});

describe('schema drift', () => {
  it('heals a database from before the cards column instead of dying on it', () => {
    // The live server once died on a timer this way: a 19/10 database met a write
    // naming `cards`, sqlite refused, and the process exited mid-demo. migrate()
    // now ensures every column write() names, so old files heal with defaults.
    const legacy = mkdtempSync(join(tmpdir(), 'chog-legacy-'));
    try {
      const raw = new DatabaseSync(join(legacy, 'chog-wave.db'));
      raw.exec('CREATE TABLE saves (token_id INTEGER PRIMARY KEY, kills INTEGER NOT NULL DEFAULT 0)');
      raw.exec('INSERT INTO saves (token_id, kills) VALUES (4242, 7)');
      raw.close();
      const store = new SaveStore(legacy);
      const row = store.recordRout(4242);
      expect(row.streak).toBe(0);
      expect(store.get(4242).cards).toEqual([]);
      store.close();
    } finally {
      rmSync(legacy, { recursive: true, force: true });
    }
  });
});

describe('wallet saves', () => {
  it('shares one save across the wallets tokens and keeps it across restarts', () => {
    const addr = '0xwallet000000000000000000000000000000000001';
    const w1 = new World();
    const a = w1.join('wa', { tokenId: 5201, transferCount: 0, daysHeld: 0 }, 'ashflat', addr);
    expect(a.saveKey).toBe(addr);
    w1.profiles.grant(a.saveKey, { xp: 120 });
    const xp = w1.profiles.doc(addr).xp;
    w1.saves.close();
    const w2 = new World();
    const b = w2.join('wb', { tokenId: 5202, transferCount: 0, daysHeld: 0 }, 'ashflat', addr);
    expect(b.saveKey).toBe(addr);
    // Greater-or-equal, not equal: the second join pays album XP for token 5202's
    // own traits on top of the carried progress. What must never happen is less.
    expect(w2.profiles.doc(addr).xp).toBeGreaterThanOrEqual(xp);
    w2.saves.close();
  });

  it('keeps strangers out of each others saves', () => {
    const world = new World();
    const a = world.join('sa', { tokenId: 5211, transferCount: 0, daysHeld: 0 }, 'ashflat', '0xaaa00000000000000000000000000000000000001');
    const b = world.join('sb', { tokenId: 5212, transferCount: 0, daysHeld: 0 }, 'ashflat', '0xbbb00000000000000000000000000000000000002');
    world.profiles.grant(a.saveKey, { xp: 500 });
    expect(world.profiles.doc(b.saveKey).xp).toBeLessThan(world.profiles.doc(a.saveKey).xp);
    world.saves.close();
  });

  it('carries legacy token rows over as token:<id>', () => {
    const legacy = mkdtempSync(join(tmpdir(), 'chog-legacy-wallet-'));
    try {
      const raw = new DatabaseSync(join(legacy, 'chog-wave.db'));
      raw.exec('CREATE TABLE saves (token_id INTEGER PRIMARY KEY, kills INTEGER NOT NULL DEFAULT 0, progress TEXT NOT NULL DEFAULT \'{}\')');
      raw.exec('INSERT INTO saves (token_id, kills, progress) VALUES (4243, 3, \'{"xp":321}\')');
      raw.close();
      const store = new SaveStore(legacy);
      expect(store.readProgress(4243, { xp: 0 }).xp).toBe(321);
      expect(store.readProgress('token:4243', { xp: 0 }).xp).toBe(321);
      expect(store.get('0xnobody0000000000000000000000000000000003').kills).toBe(0);
      store.close();
    } finally {
      rmSync(legacy, { recursive: true, force: true });
    }
  });
});

describe('roster cadence', () => {
  it('rebuilds on headcount change, not on every snapshot', () => {
    const world = new World();
    world.join('ra', { tokenId: 5101, transferCount: 0, daysHeld: 0 }, 'ashflat');
    expect(world.roster().length).toBe(1);
    const first = world.roster();
    expect(world.roster()).toBe(first);
    world.join('rb', { tokenId: 5102, transferCount: 0, daysHeld: 0 }, 'ashflat');
    expect(world.roster().length).toBe(2);
    world.saves.close();
  });
});
