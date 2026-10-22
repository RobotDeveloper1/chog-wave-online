import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CFG } from './config.ts';
import { seasonKey, type SaveView } from '@chog/shared';

export type SaveRow = SaveView;

/** A save key: the signer's wallet address, or a bare token id for callers without one. */
export type SaveKeyInput = number | string;

/** One row of the withdraw queue: requested on the ledger, settled on chain. */
export interface WithdrawRow {
  id: number;
  wallet: string;
  amount: number;
  status: string;
  made: number;
  savekey: string;
  tx: string;
  note: string;
  done: number;
}

/**
 * Every save belongs to a wallet. A bare token id is the anonymous fallback —
 * a visitor playing without signing in keeps the old per-token behaviour under
 * `token:<id>`, which is also where pre-migration rows land, so nothing saved
 * before the wallet change stops loading.
 */
export function normalizeKey(id: SaveKeyInput): string {
  return typeof id === 'number' ? `token:${id}` : id;
}

/** The name a board prints for a save nobody online owns: `#id`, or a short wallet. */
export function saveDisplayName(key: string): string {
  const legacy = /^token:(\d+)$/.exec(key);
  if (legacy) return `#${legacy[1]}`;
  return key.length === 42 && key.startsWith('0x') ? `${key.slice(0, 6)}…${key.slice(-4)}` : key;
}

/** Soft curve — early kills feel meaningful, the top of the board is hard to move. */
export const levelOf = (kills: number) => 1 + Math.floor(Math.sqrt(kills));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS saves (
  key        TEXT PRIMARY KEY,
  kills      INTEGER NOT NULL DEFAULT 0,
  storm_kills INTEGER NOT NULL DEFAULT 0,
  cards      TEXT    NOT NULL DEFAULT '[]',
  peak_wave  REAL    NOT NULL DEFAULT 0,
  streak     INTEGER NOT NULL DEFAULT 0,
  season     TEXT    NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chapters (
  key    TEXT    NOT NULL,
  ts     INTEGER NOT NULL,
  kind   TEXT    NOT NULL,
  detail TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS war (
  week   TEXT PRIMARY KEY,
  ledger TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token   TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  made    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS escrow (
  key        TEXT PRIMARY KEY,
  challenger TEXT NOT NULL,
  rival      TEXT NOT NULL,
  wager      INTEGER NOT NULL,
  made       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deposits (
  tx     TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  amount REAL NOT NULL,
  block  INTEGER NOT NULL,
  made   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS withdraw (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  savekey TEXT NOT NULL DEFAULT '',
  tx TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  made   INTEGER NOT NULL
);
`;

/**
 * Progression lives in one JSON column rather than in eight new ones. It changes
 * every time a system is added, and a migration per feature is how a hackathon
 * project ends up with a schema nobody can read.
 */
export class SaveStore {
  private db: DatabaseSync;

  constructor(dir = CFG.dataDir) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(join(dir, 'chog-wave.db'));
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * `CREATE TABLE IF NOT EXISTS` cannot add a column to a database that already exists —
   * and a write naming a missing column kills the process on a timer, mid-demo. So every
   * column `write()` names is ensured here: old databases heal in place with defaults.
   *
   * The wallet migration runs here too. A database whose saves are still keyed by
   * `token_id` is rebuilt once into key-keyed tables, with every old row carried
   * over as `token:<id>` — the same key an unsigned visitor writes today, so the
   * rows stay readable instead of being orphaned by the rename.
   */
  private migrate(): void {
    const cols = new Set(
      (this.db.prepare('PRAGMA table_info(saves)').all() as { name: string }[]).map((c) => c.name),
    );
    const want: Record<string, string> = {
      kills: 'INTEGER NOT NULL DEFAULT 0',
      storm_kills: 'INTEGER NOT NULL DEFAULT 0',
      cards: "TEXT NOT NULL DEFAULT '[]'",
      peak_wave: 'REAL NOT NULL DEFAULT 0',
      streak: 'INTEGER NOT NULL DEFAULT 0',
      season: "TEXT NOT NULL DEFAULT ''",
      updated_at: 'INTEGER NOT NULL DEFAULT 0',
      progress: "TEXT NOT NULL DEFAULT '{}'",
    };
    for (const [name, decl] of Object.entries(want)) {
      if (!cols.has(name)) this.db.exec(`ALTER TABLE saves ADD COLUMN ${name} ${decl}`);
    }
    let migrated = false;
    if (cols.has('token_id')) {
    this.db.exec(`
      CREATE TABLE saves_new (
        key TEXT PRIMARY KEY,
        kills INTEGER NOT NULL DEFAULT 0,
        storm_kills INTEGER NOT NULL DEFAULT 0,
        cards TEXT NOT NULL DEFAULT '[]',
        peak_wave REAL NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0,
        season TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT 0,
        progress TEXT NOT NULL DEFAULT '{}'
      );
      INSERT INTO saves_new (key, kills, storm_kills, cards, peak_wave, streak, season, updated_at, progress)
        SELECT 'token:' || token_id, kills, storm_kills, cards, peak_wave, streak, season, updated_at, progress FROM saves;
      DROP TABLE saves;
      ALTER TABLE saves_new RENAME TO saves;
    `);
    migrated = true;
    }
    const chapterCols = new Set(
      (this.db.prepare('PRAGMA table_info(chapters)').all() as { name: string }[]).map((c) => c.name),
    );
    if (chapterCols.has('token_id')) {
    this.db.exec(`
        CREATE TABLE chapters_new (key TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
        INSERT INTO chapters_new (key, ts, kind, detail)
          SELECT 'token:' || token_id, ts, kind, detail FROM chapters;
        DROP TABLE chapters;
        ALTER TABLE chapters_new RENAME TO chapters;
        CREATE INDEX chapters_key ON chapters (key, ts);
      `);
    }
    const escrowCols = new Set(
      (this.db.prepare('PRAGMA table_info(escrow)').all() as { name: string }[]).map((c) => c.name),
    );
    if (escrowCols.size) {
      const challengerType = (
        this.db.prepare('PRAGMA table_info(escrow)').all() as { name: string; type: string }[]
      ).find((c) => c.name === 'challenger')?.type;
      if (challengerType === 'INTEGER') {
        this.db.exec(`
          CREATE TABLE escrow_new (
            key TEXT PRIMARY KEY, challenger TEXT NOT NULL, rival TEXT NOT NULL,
            wager INTEGER NOT NULL, made INTEGER NOT NULL
          );
          INSERT INTO escrow_new (key, challenger, rival, wager, made)
            SELECT key, 'token:' || challenger, 'token:' || rival, wager, made FROM escrow;
          DROP TABLE escrow;
          ALTER TABLE escrow_new RENAME TO escrow;
        `);
      }
    }
    const withdrawCols = new Set(
      (this.db.prepare('PRAGMA table_info(withdraw)').all() as { name: string }[]).map((c) => c.name),
    );
    const withdrawWant: Record<string, string> = {
      savekey: "TEXT NOT NULL DEFAULT ''",
      tx: "TEXT NOT NULL DEFAULT ''",
      note: "TEXT NOT NULL DEFAULT ''",
      done: 'INTEGER NOT NULL DEFAULT 0',
    };
    for (const [name, decl] of Object.entries(withdrawWant)) {
      if (!withdrawCols.has(name)) this.db.exec(`ALTER TABLE withdraw ADD COLUMN ${name} ${decl}`);
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS chapters_key ON chapters (key, ts)');
    if (migrated) console.log('[saves] migrated token-keyed rows to wallet keys');
  }

  get(id: SaveKeyInput, now = Date.now()): SaveRow {
    const key = normalizeKey(id);
    const season = seasonKey(now);
    const row = this.db
      .prepare('SELECT * FROM saves WHERE key = ?')
      .get(key) as Record<string, unknown> | undefined;

    if (!row) {
      return { key, kills: 0, stormKills: 0, cards: [], peakWave: 0, streak: 0, season, updatedAt: 0 };
    }
    const storedSeason = String(row.season ?? '');
    return {
      key,
      // A new season resets the board but never the wallet's own history.
      kills: storedSeason === season ? Number(row.kills) : 0,
      stormKills: Number(row.storm_kills),
      cards: JSON.parse(String(row.cards ?? '[]')) as string[],
      peakWave: Number(row.peak_wave),
      streak: storedSeason === season ? Number(row.streak) : 0,
      season,
      updatedAt: Number(row.updated_at),
    };
  }

  private write(s: SaveRow): void {
    this.db
      .prepare(
        `INSERT INTO saves (key, kills, storm_kills, cards, peak_wave, streak, season, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           kills = excluded.kills, storm_kills = excluded.storm_kills, cards = excluded.cards,
           peak_wave = excluded.peak_wave, streak = excluded.streak, season = excluded.season,
           updated_at = excluded.updated_at`,
      )
      .run(s.key, s.kills, s.stormKills, JSON.stringify(s.cards), s.peakWave, s.streak, s.season, s.updatedAt);
  }

  recordClear(id: SaveKeyInput, tier: string, peakWave: number, loot: string[], now = Date.now()): SaveRow {
    const key = normalizeKey(id);
    const s = this.get(key, now);
    s.kills += 1;
    if (tier === 'storm') s.stormKills += 1;
    s.streak += 1;
    s.peakWave = Math.max(s.peakWave, peakWave);
    s.cards = [...new Set([...s.cards, ...loot])];
    s.updatedAt = now;
    this.write(s);
    this.chapter(key, 'clear', `${tier} x${s.kills} streak${s.streak}`, now);
    return s;
  }

  /** Only the deck changes; kills and streak are untouched. */
  setChips(id: SaveKeyInput, cards: string[], now = Date.now()): SaveRow {
    const key = normalizeKey(id);
    const s = this.get(key, now);
    s.cards = [...new Set(cards)];
    s.updatedAt = now;
    this.write(s);
    return s;
  }

  recordRout(id: SaveKeyInput, now = Date.now()): SaveRow {
    const key = normalizeKey(id);
    const s = this.get(key, now);
    s.streak = 0;
    s.updatedAt = now;
    this.write(s);
    this.chapter(key, 'rout', 'failed the sector', now);
    return s;
  }

  /** The read-only story the wallet carries: every season left a mark. */
  chapter(id: SaveKeyInput, kind: string, detail: string, now = Date.now()): void {
    this.db.prepare('INSERT INTO chapters (key, ts, kind, detail) VALUES (?, ?, ?, ?)').run(
      normalizeKey(id),
      now,
      kind,
      detail,
    );
  }

  chapters(id: SaveKeyInput, limit = 12): { ts: number; kind: string; detail: string }[] {
    return this.db
      .prepare('SELECT ts, kind, detail FROM chapters WHERE key = ? ORDER BY ts DESC LIMIT ?')
      .all(normalizeKey(id), limit) as { ts: number; kind: string; detail: string }[];
  }

  leaderboard(limit = 20, now = Date.now()): { key: string; name: string; kills: number; streak: number }[] {
    const season = seasonKey(now);
    const rows = this.db
      .prepare(
        `SELECT key, kills, streak FROM saves
         WHERE season = ? AND kills > 0 ORDER BY kills DESC, streak DESC LIMIT ?`,
      )
      .all(season, limit) as { key: string; kills: number; streak: number }[];
    return rows.map((r) => ({ ...r, name: saveDisplayName(r.key) }));
  }

  /**
   * Read the progression blob. The merge is deliberately shallow: a persisted
   * subsystem replaces its default outright rather than half-inheriting it, and the
   * writer always stores the full document, so nothing is ever partially saved.
   */
  readProgress<T extends object>(id: SaveKeyInput, defaults: T): T {
    const row = this.db
      .prepare('SELECT progress FROM saves WHERE key = ?')
      .get(normalizeKey(id)) as { progress?: string } | undefined;
    let raw: Record<string, unknown> = {};
    try {
      raw = row?.progress ? (JSON.parse(row.progress) as Record<string, unknown>) : {};
    } catch {
      raw = {};
    }
    return { ...defaults, ...raw } as T;
  }

  writeProgress(id: SaveKeyInput, doc: unknown, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO saves (key, progress, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET progress = excluded.progress, updated_at = excluded.updated_at`,
      )
      .run(normalizeKey(id), JSON.stringify(doc), now);
  }

  /**
   * Every progression blob on disk, for the RANKS tab. The board is small and the
   * ask is on tab-open, so a full scan beats four maintained indexes.
   */
  allProgress(): { key: string; progress: string }[] {
    return this.db
      .prepare('SELECT key, progress FROM saves WHERE progress IS NOT NULL')
      .all() as { key: string; progress: string }[];
  }

  readWar<T>(week: string): T | null {
    const row = this.db.prepare('SELECT ledger FROM war WHERE week = ?').get(week) as { ledger?: string } | undefined;
    if (!row?.ledger) return null;
    try {
      return JSON.parse(row.ledger) as T;
    } catch {
      return null;
    }
  }

  writeWar(week: string, ledger: unknown): void {
    this.db
      .prepare('INSERT INTO war (week, ledger) VALUES (?, ?) ON CONFLICT(week) DO UPDATE SET ledger = excluded.ledger')
      .run(week, JSON.stringify(ledger));
  }

  // ---------------------------------------------------------------------------
  // Auth sessions: a restart stops logging everyone out.
  // ---------------------------------------------------------------------------

  sessionPut(token: string, address: string, made: number): void {
    this.db
      .prepare('INSERT INTO sessions (token, address, made) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET address = excluded.address, made = excluded.made')
      .run(token, address, made);
  }

  sessionDel(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  sessionPrune(olderThan: number): void {
    this.db.prepare('DELETE FROM sessions WHERE made < ?').run(olderThan);
  }

  sessionsAll(): { token: string; address: string; made: number }[] {
    return this.db.prepare('SELECT token, address, made FROM sessions').all() as { token: string; address: string; made: number }[];
  }

  // ---------------------------------------------------------------------------
  // PvP escrow: stakes deducted at accept live here until the bout settles, so a
  // restart refunds them instead of eating them.
  // ---------------------------------------------------------------------------

  escrowPut(key: string, challenger: SaveKeyInput, rival: SaveKeyInput, wager: number, made = Date.now()): void {
    this.db
      .prepare('INSERT INTO escrow (key, challenger, rival, wager, made) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET challenger = excluded.challenger, rival = excluded.rival, wager = excluded.wager, made = excluded.made')
      .run(key, normalizeKey(challenger), normalizeKey(rival), wager, made);
  }

  escrowDel(key: string): void {
    this.db.prepare('DELETE FROM escrow WHERE key = ?').run(key);
  }

  escrowAll(): { key: string; challenger: string; rival: string; wager: number }[] {
    return this.db.prepare('SELECT key, challenger, rival, wager FROM escrow').all() as { key: string; challenger: string; rival: string; wager: number }[];
  }

  // ---------------------------------------------------------------------------
  // Real $CHOG: vault deposits in, manual payouts out. Every applied Transfer is
  // recorded by tx hash first, so a re-polled window or a restart pays nothing twice.
  // ---------------------------------------------------------------------------

  depositSeen(tx: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM deposits WHERE tx = ?').get(tx);
  }

  depositPut(tx: string, wallet: string, amount: number, block: number, made = Date.now()): void {
    this.db.prepare('INSERT OR IGNORE INTO deposits (tx, wallet, amount, block, made) VALUES (?, ?, ?, ?, ?)').run(tx, wallet, amount, block, made);
  }

  /**
   * Whole $CHOG a wallet ever deposited — floored per tx, exactly like the
   * credit. The ceiling on lifetime withdrawals: the starting grant and paper
   * winnings are play money and must never leave as real coins.
   */
  depositedBy(wallet: string): number {
    const rows = this.db.prepare('SELECT amount FROM deposits WHERE wallet = ?').all(wallet) as { amount: number }[];
    let total = 0;
    for (const r of rows) total += Math.floor(Number(r.amount) || 0);
    return total;
  }

  withdrawReqPut(wallet: string, amount: number, saveKey = '', made = Date.now()): number {
    const r = this.db.prepare("INSERT INTO withdraw (wallet, amount, status, made, savekey) VALUES (?, ?, 'pending', ?, ?)").run(wallet, amount, made, saveKey);
    return Number(r.lastInsertRowid);
  }

  withdrawReqAll(): WithdrawRow[] {
    return this.db.prepare('SELECT id, wallet, amount, status, made, savekey, tx, note, done FROM withdraw ORDER BY id').all() as unknown as WithdrawRow[];
  }

  withdrawPending(): WithdrawRow[] {
    return this.db.prepare("SELECT id, wallet, amount, status, made, savekey, tx, note, done FROM withdraw WHERE status = 'pending' ORDER BY id").all() as unknown as WithdrawRow[];
  }

  /** Atomically claim a pending row for payout. False means someone else got it. */
  withdrawClaim(id: number): boolean {
    const r = this.db.prepare("UPDATE withdraw SET status = 'sending' WHERE id = ? AND status = 'pending'").run(id);
    return Number(r.changes ?? 0) > 0;
  }

  withdrawSettle(id: number, status: 'done' | 'failed', tx = '', note = '', done = Date.now()): void {
    this.db.prepare('UPDATE withdraw SET status = ?, tx = ?, note = ?, done = ? WHERE id = ?').run(status, tx, note, done, id);
  }

  withdrawRequeue(id: number): void {
    this.db.prepare("UPDATE withdraw SET status = 'pending' WHERE id = ?").run(id);
  }

  /** Whole $CHOG a wallet already has queued, in flight or paid since `since` (UTC-day spend). Failed rows refunded, so they stop counting. */
  withdrawDailyTotal(wallet: string, since: number): number {
    const r = this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM withdraw WHERE wallet = ? AND status IN ('pending', 'sending', 'done') AND made >= ?").get(wallet, since) as { total: number };
    return Number(r.total) || 0;
  }

  close(): void {
    this.db.close();
  }
}
