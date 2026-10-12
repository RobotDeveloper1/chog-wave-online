import {
  SECTORS,
  board,
  controlOf,
  credit,
  emptyLedger,
  mvp,
  rolloverLabel,
  msUntilWeekRollover,
  warWeek,
  weeklyPrizes,
  type Element,
  type SectorId,
  type WarLedger,
} from '@chog/shared';
import type { SaveStore } from './save.ts';

/**
 * The Tribe War, kept on the server.
 *
 * One ledger per ISO week, persisted after every credit. It is deliberately a thin
 * wrapper: the arithmetic that decides who holds which sector lives in `shared/tribe.ts`
 * where a test can prove it, and this file only owns the storage, the rollover, and the
 * fact that nobody gets to grade their own contribution.
 */

export class War {
  private ledger: WarLedger;
  private week: string;

  private readonly saves: SaveStore;

  constructor(saves: SaveStore, now = Date.now()) {
    this.saves = saves;
    this.week = warWeek(now);
    this.ledger = this.saves.readWar<WarLedger>(this.week) ?? emptyLedger(this.week, [...SECTORS]);
  }

  /** Roll the board when the calendar does, without losing the previous week's record. */
  private roll(now: number): void {
    const week = warWeek(now);
    if (week === this.week) return;
    this.week = week;
    this.ledger = this.saves.readWar<WarLedger>(week) ?? emptyLedger(week, [...SECTORS]);
  }

  add(args: { tokenId: number; tribe: Element; sector: SectorId; points: number; clear?: boolean }, now = Date.now()): void {
    this.roll(now);
    if (!Number.isFinite(args.points) || args.points <= 0) return;
    this.ledger = credit(this.ledger, args);
    this.saves.writeWar(this.week, this.ledger);
  }

  view(now = Date.now()): {
    week: string;
    rows: ReturnType<typeof board>;
    control: Partial<Record<SectorId, Element>>;
    prizes: ReturnType<typeof weeklyPrizes>;
    mvp: ReturnType<typeof mvp>;
    rolloverIn: string;
  } {
    this.roll(now);
    return {
      week: this.week,
      rows: board(this.ledger),
      control: controlOf(this.ledger),
      prizes: weeklyPrizes(this.ledger),
      mvp: mvp(this.ledger),
      rolloverIn: rolloverLabel(msUntilWeekRollover(now)),
    };
  }

  /** Points already banked by one token, for its own panel. */
  of(tokenId: number): { points: number; clears: number; tribe: Element | null } {
    const r = this.ledger.runners.find((x) => x.tokenId === tokenId);
    return r ? { points: r.points, clears: r.clears, tribe: r.tribe } : { points: 0, clears: 0, tribe: null };
  }

  raw(): WarLedger {
    return this.ledger;
  }
}
