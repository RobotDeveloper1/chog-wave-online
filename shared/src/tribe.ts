import type { Element } from './types.ts';
import type { SectorId } from './wave.ts';
import { ELEMENTS } from './cards.ts';

/**
 * The Tribe War.
 *
 * Six elements, one week, three sectors to hold. It matters because it is the only
 * system where the *market itself* sets the terms: anomalies open when the collection
 * trades hard, the hot sector is where the points are, and every clear is banked to
 * the element your Chog was born wearing. A whale buying a Chog is not flavour text —
 * it moves the front line.
 *
 * Foster players (no NFT) carry the element the game assigned them, and their points
 * count the same, so the war is never an owners-only club. The token decides *who you
 * fight for*, not *whether you can fight*.
 */

export const TRIBE_NAMES: Record<Element, string> = {
  burn: 'EMBER LINE',
  frost: 'RIME LINE',
  volt: 'ARC LINE',
  wave: 'TIDE LINE',
  prism: 'PRISM LINE',
  void: 'NULL LINE',
};

const TIER_POINTS: Record<string, number> = { ambient: 2, glitch: 10, anomaly: 18, storm: 30 };

/** `scale` is `partyRewardScale(size, owners)` — a linked kill is worth more, and alts are worth less. */
export function pointsForClear(tier: string, scale = 1): number {
  const base = TIER_POINTS[tier] ?? TIER_POINTS.glitch!;
  return Math.round(base * scale);
}

export function pointsForRun(tier: number): number {
  return 6 + tier * 6;
}

/**
 * The multiplier that ties the war to real trading: the sector where the collection
 * is actually moving pays double. Everyone can see it happening on the ticker.
 */
export function sectorMultiplier(hot: SectorId, sector: SectorId, volumeMon: number): number {
  if (sector !== hot) return 1;
  return volumeMon > 20_000 ? 2 : 1.5;
}

/** Weeks roll on the same key the leaderboard uses, so reset day is not a magic date. */
export function warWeek(now: number): string {
  const d = new Date(now);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.floor((now - first.getTime()) / 604_800_000) + 1;
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function msUntilWeekRollover(now: number, weekStartUtcHour = 0): number {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const nextMonday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ((7 - day) % 7 || 7), weekStartUtcHour));
  return Math.max(0, nextMonday.getTime() - now);
}

export function rolloverLabel(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/** Flat, JSON-safe, and the shape the server persists per week. */
export interface WarLedger {
  week: string;
  /** element -> points */
  tribes: Partial<Record<Element, number>>;
  /** element -> members credited this week */
  members: Partial<Record<Element, number>>;
  /** sector -> element -> points, so control is provable per ground */
  sectors: Record<SectorId, Partial<Record<Element, number>>>;
  /** who is credited individually, for the MVP line */
  runners: { tokenId: number; tribe: Element; points: number; clears: number }[];
}

export function emptyLedger(week: string, sectors: SectorId[]): WarLedger {
  return { week, tribes: {}, members: {}, sectors: Object.fromEntries(sectors.map((s) => [s, {}])) as WarLedger['sectors'], runners: [] };
}

export interface Credit {
  tokenId: number;
  tribe: Element;
  sector: SectorId;
  points: number;
  clear?: boolean;
}

/** Add one contribution. Pure, so a test can prove the arithmetic and the UI cannot drift. */
export function credit(ledger: WarLedger, c: Credit): WarLedger {
  const tribes = { ...ledger.tribes };
  tribes[c.tribe] = (tribes[c.tribe] ?? 0) + c.points;

  const sectors = { ...ledger.sectors };
  const sec = { ...(sectors[c.sector] ?? {}) };
  sec[c.tribe] = (sec[c.tribe] ?? 0) + c.points;
  sectors[c.sector] = sec;

  const runners = ledger.runners.slice();
  const i = runners.findIndex((r) => r.tokenId === c.tokenId);
  if (i >= 0) {
    const r = runners[i]!;
    runners[i] = { ...r, points: r.points + c.points, clears: r.clears + (c.clear ? 1 : 0) };
  } else {
    runners.push({ tokenId: c.tokenId, tribe: c.tribe, points: c.points, clears: c.clear ? 1 : 0 });
  }
  runners.sort((a, b) => b.points - a.points);
  return { ...ledger, tribes, sectors, runners: runners.slice(0, 40) };
}

/** Distinct tokens that contributed, which is the honest "members" number. */
export function tribeMembers(ledger: WarLedger): Partial<Record<Element, number>> {
  const byTribe = new Map<Element, Set<number>>();
  for (const r of ledger.runners) {
    if (!byTribe.has(r.tribe)) byTribe.set(r.tribe, new Set());
    byTribe.get(r.tribe)!.add(r.tokenId);
  }
  const out: Partial<Record<Element, number>> = {};
  for (const [t, set] of byTribe) out[t] = set.size;
  return out;
}

export interface TribeRow {
  tribe: Element;
  name: string;
  points: number;
  members: number;
  share: number;
  holds: SectorId[];
  rank: number;
}

export function controlOf(ledger: WarLedger): Partial<Record<SectorId, Element>> {
  const out: Partial<Record<SectorId, Element>> = {};
  for (const [sector, byTribe] of Object.entries(ledger.sectors)) {
    let best: Element | null = null;
    let bestPoints = 0;
    for (const [tribe, points] of Object.entries(byTribe)) {
      // Ties leave the ground uncontested rather than awarding it to whoever posted last.
      if (points > bestPoints) {
        best = tribe as Element;
        bestPoints = points;
      } else if (points === bestPoints && points > 0) {
        best = null;
      }
    }
    if (best && bestPoints > 0) out[sector as SectorId] = best;
  }
  return out;
}

export function board(ledger: WarLedger): TribeRow[] {
  const members = tribeMembers(ledger);
  const total = Object.values(ledger.tribes).reduce((s, n) => s + (n ?? 0), 0) || 1;
  const control = controlOf(ledger);
  const holds = new Map<Element, SectorId[]>();
  for (const [sector, tribe] of Object.entries(control)) {
    if (!tribe) continue;
    if (!holds.has(tribe)) holds.set(tribe, []);
    holds.get(tribe)!.push(sector as SectorId);
  }
  return ELEMENTS
    .map((tribe) => ({
      tribe,
      name: TRIBE_NAMES[tribe],
      points: ledger.tribes[tribe] ?? 0,
      members: members[tribe] ?? 0,
      share: (ledger.tribes[tribe] ?? 0) / total,
      holds: holds.get(tribe) ?? [],
      rank: 0,
    }))
    .sort((a, b) => b.points - a.points || b.members - a.members)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

/** What the war pays the winners at rollover. Kept small: status is the reward. */
export function weeklyPrizes(ledger: WarLedger): { tribe: Element; wav: number; title: string }[] {
  const rows = board(ledger).filter((r) => r.points > 0);
  if (!rows.length) return [];
  return rows.slice(0, 3).map((r, i) => ({
    tribe: r.tribe,
    wav: [500, 300, 180][i] ?? 100,
    title: ['WAR LINEAGE', 'RUNNER-UP LINEAGE', 'THIRD LINEAGE'][i] ?? 'CONTENDED',
  }));
}

export function mvp(ledger: WarLedger): { tokenId: number; tribe: Element; points: number } | null {
  const r = ledger.runners[0];
  return r ? { tokenId: r.tokenId, tribe: r.tribe, points: r.points } : null;
}
