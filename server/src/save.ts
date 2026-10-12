import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CFG } from './config.ts';
import { seasonKey, type SaveView } from '@chog/shared';

export type SaveRow = SaveView;

/** Soft curve — early kills feel meaningful, the top of the board is hard to move. */
export const levelOf = (kills: number) => 1 + Math.floor(Math.sqrt(kills));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS saves (
  token_id   INTEGER PRIMARY KEY,
  kills      INTEGER NOT NULL DEFAULT 0,
  storm_kills INTEGER NOT NULL DEFAULT 0,
  chips      TEXT    NOT NULL DEFAULT '[]',
  peak_wave  REAL    NOT NULL DEFAULT 0,
  streak     INTEGER NOT NULL DEFAULT 0,
  season     TEXT    NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chapters (
  token_id INTEGER NOT NULL,
  ts       INTEGER NOT NULL,
  kind     TEXT    NOT NULL,
  detail   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS chapters_token ON chapters (token_id, ts);
CREATE TABLE IF NOT EXISTS war (
  week   TEXT PRIMARY KEY,
  ledger TEXT NOT NULL
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

  /** `CREATE TABLE IF NOT EXISTS` cannot add a column to a database that already exists. */
  private migrate(): void {
    const cols = this.db.prepare('PRAGMA table_info(saves)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'progress')) {
      this.db.exec("ALTER TABLE saves ADD COLUMN progress TEXT NOT NULL DEFAULT '{}'");
    }
  }

  get(tokenId: number, now = Date.now()): SaveRow {
    const season = seasonKey(now);
    const row = this.db
      .prepare('SELECT * FROM saves WHERE token_id = ?')
      .get(tokenId) as Record<string, unknown> | undefined;

    if (!row) {
      return { tokenId, kills: 0, stormKills: 0, chips: [], peakWave: 0, streak: 0, season, updatedAt: 0 };
    }
    const storedSeason = String(row.season ?? '');
    return {
      tokenId,
      // A new season resets the board but never the token's own history.
      kills: storedSeason === season ? Number(row.kills) : 0,
      stormKills: Number(row.storm_kills),
      chips: JSON.parse(String(row.chips ?? '[]')) as string[],
      peakWave: Number(row.peak_wave),
      streak: storedSeason === season ? Number(row.streak) : 0,
      season,
      updatedAt: Number(row.updated_at),
    };
  }

  private write(s: SaveRow): void {
    this.db
      .prepare(
        `INSERT INTO saves (token_id, kills, storm_kills, chips, peak_wave, streak, season, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(token_id) DO UPDATE SET
           kills = excluded.kills, storm_kills = excluded.storm_kills, chips = excluded.chips,
           peak_wave = excluded.peak_wave, streak = excluded.streak, season = excluded.season,
           updated_at = excluded.updated_at`,
      )
      .run(s.tokenId, s.kills, s.stormKills, JSON.stringify(s.chips), s.peakWave, s.streak, s.season, s.updatedAt);
  }

  recordClear(tokenId: number, tier: string, peakWave: number, loot: string[], now = Date.now()): SaveRow {
    const s = this.get(tokenId, now);
    s.kills += 1;
    if (tier === 'storm') s.stormKills += 1;
    s.streak += 1;
    s.peakWave = Math.max(s.peakWave, peakWave);
    s.chips = [...new Set([...s.chips, ...loot])];
    s.updatedAt = now;
    this.write(s);
    this.chapter(tokenId, 'clear', `${tier} x${s.kills} streak${s.streak}`, now);
    return s;
  }

  /** Only the folder changes; kills and streak are untouched. */
  setChips(tokenId: number, chips: string[], now = Date.now()): SaveRow {
    const s = this.get(tokenId, now);
    s.chips = [...new Set(chips)];
    s.updatedAt = now;
    this.write(s);
    return s;
  }

  recordRout(tokenId: number, now = Date.now()): SaveRow {
    const s = this.get(tokenId, now);
    s.streak = 0;
    s.updatedAt = now;
    this.write(s);
    this.chapter(tokenId, 'rout', 'failed the sector', now);
    return s;
  }

  /** The read-only story the token carries: every owner left a mark. */
  chapter(tokenId: number, kind: string, detail: string, now = Date.now()): void {
    this.db.prepare('INSERT INTO chapters (token_id, ts, kind, detail) VALUES (?, ?, ?, ?)').run(
      tokenId,
      now,
      kind,
      detail,
    );
  }

  chapters(tokenId: number, limit = 12): { ts: number; kind: string; detail: string }[] {
    return this.db
      .prepare('SELECT ts, kind, detail FROM chapters WHERE token_id = ? ORDER BY ts DESC LIMIT ?')
      .all(tokenId, limit) as { ts: number; kind: string; detail: string }[];
  }

  leaderboard(limit = 20, now = Date.now()): { tokenId: number; kills: number; streak: number }[] {
    const season = seasonKey(now);
    return this.db
      .prepare(
        `SELECT token_id AS tokenId, kills, streak FROM saves
         WHERE season = ? AND kills > 0 ORDER BY kills DESC, streak DESC LIMIT ?`,
      )
      .all(season, limit) as { tokenId: number; kills: number; streak: number }[];
  }

  /**
   * Read the progression blob. The merge is deliberately shallow: a persisted
   * subsystem replaces its default outright rather than half-inheriting it, and the
   * writer always stores the full document, so nothing is ever partially saved.
   */
  readProgress<T extends object>(tokenId: number, defaults: T): T {
    const row = this.db
      .prepare('SELECT progress FROM saves WHERE token_id = ?')
      .get(tokenId) as { progress?: string } | undefined;
    let raw: Record<string, unknown> = {};
    try {
      raw = row?.progress ? (JSON.parse(row.progress) as Record<string, unknown>) : {};
    } catch {
      raw = {};
    }
    return { ...defaults, ...raw } as T;
  }

  writeProgress(tokenId: number, doc: unknown, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO saves (token_id, progress, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(token_id) DO UPDATE SET progress = excluded.progress, updated_at = excluded.updated_at`,
      )
      .run(tokenId, JSON.stringify(doc), now);
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

  close(): void {
    this.db.close();
  }
}
