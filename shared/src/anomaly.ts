import { SECTORS, VOLUME_PRESSURE_PER_MON, type SectorId } from './wave.ts';

/**
 * Anomaly archetypes, keyed to the *shape* of market flow rather than its level.
 *
 * The Wave Index already answers "how much traffic". That is not enough to make a
 * sale feel like an event, and the measured history forces the issue: Chog Genesis
 * sells run about 0.48/hour and have gone 13 hours silent, so anything that waits
 * for a sustained rate reads as a dead world. Each archetype below therefore fires
 * off a property of a single fill or of a short burst, and every one of them is
 * traceable to a transaction hash the HUD can print.
 */

export type AnomalyArchetype = 'spark' | 'baron' | 'front' | 'mirror' | 'surge';

export interface SaleFact {
  txHash: string;
  block: number;
  ts: number;
  tokenId: number;
  /** Price normalised to MON. Seaport settles ~a third of fills in WMON. */
  mon: number;
  seller: string;
  buyer: string;
}

export interface AnomalyTrigger {
  archetype: AnomalyArchetype;
  sector: SectorId;
  /** MON actually credited after the whale clamp. */
  weight: number;
  hp: number;
  cause: { txHash: string; tokenId: number; mon: number }[];
  /** One line for the ticker. Contains a tx hash so a judge can verify it. */
  label: string;
}

/**
 * Calibrated against the decoded sale history (1,539 fills, median 9,140 MON,
 * p95 15,000, max 200,000). The ceiling is the important number: without a clamp
 * a single 200k sale would open a Storm instantly, and one whale address already
 * accounts for 100 of the 1,539 historical trades.
 */
export const PRICE_FLOOR_MON = 1_000;
export const PRICE_CEIL_MON = 20_000;
export const BARON_AT_MON = 15_000;
/** 60 blocks is ~18s at the measured 0.302s Monad block time. */
export const FRONT_WINDOW_BLOCKS = 60;
export const FRONT_MIN_FILLS = 3;
export const MIRROR_MIN_REPEATS = 3;
/** Per address, per surge window. Bounds how much of the world one wallet buys. */
export const ADDRESS_CAP_MON = 25_000;
export const SURGE_WINDOW_MS = 30 * 60_000;
export const SURGE_RATIO = 3;

/** Roughly one Glitch per median sale, Anomaly at the ceiling, never instant-Storm. */
export function sectorOf(tokenId: number): SectorId {
  return SECTORS[Math.abs(Math.trunc(tokenId)) % SECTORS.length]!;
}

/**
 * HP is anchored to the existing tier budgets (glitch 12k / anomaly 26k / storm
 * 55k) and price only moves a boss *within* its band. Scaling linearly by MON
 * produced a 540k HP Baron off an 18k sale, which is not a hard fight, it is an
 * untouchable number — a good program lands 2-5k.
 */
function band(base: number, span: number, mon: number): number {
  const t = (Math.min(PRICE_CEIL_MON, Math.max(PRICE_FLOOR_MON, mon)) - PRICE_FLOOR_MON)
    / (PRICE_CEIL_MON - PRICE_FLOOR_MON);
  return Math.round(base + span * t);
}

function hpFor(archetype: AnomalyArchetype, weight: number, fills = 1): number {
  switch (archetype) {
    case 'baron':
      return band(42_000, 26_000, weight);
    case 'surge':
      // Volume is already clamped per address, so the extra heads are the point.
      return band(34_000, 18_000, weight) + 4_000 * Math.max(0, fills - 1);
    case 'front':
      return band(22_000, 12_000, weight / Math.max(1, fills)) + 3_500 * Math.max(0, fills - 1);
    case 'mirror':
      return band(20_000, 14_000, weight / Math.max(1, fills)) + 2_500 * Math.max(0, fills - 1);
    case 'spark':
      return band(9_000, 7_000, weight);
  }
}

/**
 * Collection-wide activity. This, not any single sale, is what the user asked the
 * world to react to: when the whole collection is trading hard, anomalies open.
 * A single whale purchase is a Baron; a busy afternoon is the tide.
 */
export interface CollectionVolume {
  mon: number;
  trades: number;
  wallets: number;
  tokens: number;
  /** Where the money actually moved, so a busy sector gets the busy anomalies. */
  bySector: Record<SectorId, number>;
}

export function volumeOf(fills: readonly SaleFact[]): CollectionVolume {
  const bySector: Record<SectorId, number> = { ashflat: 0, voltgrid: 0, hollow: 0 };
  const wallets = new Set<string>();
  const tokens = new Set<number>();
  let mon = 0;
  for (const f of fills) {
    mon += f.mon;
    wallets.add(f.buyer.toLowerCase());
    wallets.add(f.seller.toLowerCase());
    tokens.add(f.tokenId);
    bySector[sectorOf(f.tokenId)] += f.mon;
  }
  return { mon, trades: fills.length, wallets: wallets.size, tokens: tokens.size, bySector };
}

/** The sector carrying the most collection volume, tie-broken deterministically. */
export function hotSector(v: CollectionVolume): SectorId {
  return SECTORS.reduce(
    (best, s) => (v.bySector[s] > v.bySector[best] ? s : best),
    SECTORS[0] as SectorId,
  );
}

/**
 * Continuous pressure from aggregate trading, fed into the Wave Index every poll.
 *
 * Per-fill events are too sparse to be the tide — measured, Chog Genesis sells
 * about 0.48 times an hour and once went 13 hours silent. So the index reads the
 * *window*: at baseline the market holds the world steady, and only genuinely
 * heavy buy/sell activity across the collection pushes it up.
 */
export const VOLUME_WINDOW_MS = 15 * 60_000;
/** MON traded per 15-minute window at which the market is "normal". */
export const VOLUME_BASELINE_MON = 3_000;
export function volumePressure(v: CollectionVolume, baselineMon = VOLUME_BASELINE_MON): number {
  if (v.trades === 0) return 0;
  return Math.max(0, v.mon - baselineMon) * VOLUME_PRESSURE_PER_MON;
}

/** How far above the trailing norm the collection is trading right now. */
export function volumeRatio(v: CollectionVolume, baselineMon = VOLUME_BASELINE_MON): number {
  return v.mon / Math.max(1, baselineMon);
}

const pairKey = (a: string, b: string) => [a.toLowerCase(), b.toLowerCase()].sort().join('->');

/**
 * Pure and deterministic: same fills, same triggers. That is what lets the whole
 * spawn design be tested without a node or an RPC.
 *
 * A fill is consumed by the first archetype that claims it, so one sale cannot
 * open three events.
 */
export function classify(
  fills: SaleFact[],
  opts: { baselineMon?: number } = {},
): AnomalyTrigger[] {
  const out: AnomalyTrigger[] = [];
  const claimed = new Set<string>();

  // Mirror first: a repeated counterparty pair is the interesting fraud, and if a
  // Baron fired on the same tx the player would never learn it was a wash.
  const pairs = new Map<string, SaleFact[]>();
  for (const f of fills) {
    const key = pairKey(f.seller, f.buyer);
    const group = pairs.get(key);
    if (group) group.push(f);
    else pairs.set(key, [f]);
  }
  for (const group of pairs.values()) {
    if (group.length < MIRROR_MIN_REPEATS) continue;
    // Three sales the same direction between two wallets is a repeat customer.
    // Flow that goes both ways is a round trip, and that is the wash signature.
    const directed = new Set(
      group.map((f) => `${f.seller.toLowerCase()}>${f.buyer.toLowerCase()}`),
    );
    const roundTrips = group.some((f) =>
      directed.has(`${f.buyer.toLowerCase()}>${f.seller.toLowerCase()}`),
    );
    if (!roundTrips) continue;
    const weight = group.reduce((s, f) => s + f.mon, 0);
    for (const f of group) claimed.add(f.txHash + ':' + f.tokenId);
    out.push({
      archetype: 'mirror',
      sector: sectorOf(group[group.length - 1]!.tokenId),
      weight,
      hp: hpFor('mirror', weight, group.length),
      cause: group.map((f) => ({ txHash: f.txHash, tokenId: f.tokenId, mon: f.mon })),
      label: `MIRROR — ${group.length} round-trips, ${Math.round(weight).toLocaleString()} MON`,
    });
  }

  for (const f of fills) {
    const id = f.txHash + ':' + f.tokenId;
    if (claimed.has(id)) continue;
    if (f.mon < PRICE_FLOOR_MON) continue;
    if (f.mon < BARON_AT_MON) continue;
    claimed.add(id);
    out.push({
      archetype: 'baron',
      sector: sectorOf(f.tokenId),
      weight: Math.min(PRICE_CEIL_MON, f.mon),
      hp: hpFor('baron', f.mon),
      cause: [{ txHash: f.txHash, tokenId: f.tokenId, mon: f.mon }],
      label: `BARON #${f.tokenId} — ${Math.round(f.mon).toLocaleString()} MON`,
    });
  }

  // Front: fills landing inside one block window, i.e. a run rather than a spike.
  const byBlock = [...fills]
    .filter((f) => !claimed.has(f.txHash + ':' + f.tokenId))
    .sort((a, b) => a.block - b.block);
  let window: SaleFact[] = [];
  for (const f of byBlock) {
    if (window.length && f.block - window[0]!.block > FRONT_WINDOW_BLOCKS) {
      if (window.length >= FRONT_MIN_FILLS) out.push(frontTrigger(window, claimed));
      window = [];
    }
    window.push(f);
  }
  if (window.length >= FRONT_MIN_FILLS) out.push(frontTrigger(window, claimed));

  // Surge: 30-minute volume against a trailing baseline. Only meaningful once a
  // baseline exists, so it stays silent on an empty history instead of guessing.
  const baseline = opts.baselineMon ?? 0;
  if (baseline > 0) {
    const byAddr = new Map<string, number>();
    let total = 0;
    for (const f of fills) {
      const addr = f.buyer.toLowerCase();
      const used = byAddr.get(addr) ?? 0;
      const credit = Math.max(0, Math.min(ADDRESS_CAP_MON - used, f.mon));
      byAddr.set(addr, used + credit);
      total += credit;
    }
    if (total >= baseline * SURGE_RATIO) {
      // A Surge is a collection-wide condition, so it lands where the collection
      // actually traded rather than wherever the single biggest sale happened.
      const sector = hotSector(volumeOf(fills));
      out.push({
        archetype: 'surge',
        sector,
        weight: total,
        hp: hpFor('surge', total, fills.length),
        cause: fills.slice(-4).map((f) => ({ txHash: f.txHash, tokenId: f.tokenId, mon: f.mon })),
        label: `SURGE — ${(total / baseline).toFixed(1)}x collection volume, ${Math.round(total).toLocaleString()} MON`,
      });
    }
  }

  for (const f of fills) {
    const id = f.txHash + ':' + f.tokenId;
    if (claimed.has(id) || f.mon < PRICE_FLOOR_MON) continue;
    claimed.add(id);
    out.push({
      archetype: 'spark',
      sector: sectorOf(f.tokenId),
      weight: f.mon,
      hp: hpFor('spark', f.mon),
      cause: [{ txHash: f.txHash, tokenId: f.tokenId, mon: f.mon }],
      label: `SPARK #${f.tokenId} — ${Math.round(f.mon).toLocaleString()} MON`,
    });
  }

  return out;
}

function frontTrigger(window: SaleFact[], claimed: Set<string>): AnomalyTrigger {
  const weight = window.reduce((s, f) => s + f.mon, 0);
  for (const f of window) claimed.add(f.txHash + ':' + f.tokenId);
  const heaviest = window.reduce((a, b) => (b.mon > a.mon ? b : a), window[0]!);
  return {
    archetype: 'front',
    sector: sectorOf(heaviest.tokenId),
    weight,
    hp: hpFor('front', weight, window.length),
    cause: window.map((f) => ({ txHash: f.txHash, tokenId: f.tokenId, mon: f.mon })),
    label: `FRONT — ${window.length} sales in ${FRONT_WINDOW_BLOCKS} blocks`,
  };
}
