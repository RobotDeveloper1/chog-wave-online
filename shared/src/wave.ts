import type { AnomalyArchetype } from './anomaly.ts';

export type SectorId = 'ashflat' | 'voltgrid' | 'hollow';
export type Tier = 'normal' | 'glitch' | 'anomaly' | 'storm';

/**
 * There is one city, and the wave runs through all of it. The other two district ids stay in the
 * type so the old city plans still compile, but nothing can be in them: the world is the city
 * and the dungeons under it.
 */
export const SECTORS: readonly SectorId[] = ['ashflat'];

/** What the city and its old district ids are called on screen. Only the city exists now. */
export const SECTOR_NAME: Record<SectorId, string> = { ashflat: 'GENESIS', voltgrid: 'VOLTGRID', hollow: 'HOLLOW' };

export const TIER_AT = { glitch: 45, anomaly: 70, storm: 95 } as const;

/**
 * Wave bleeds off on its own, slowly on purpose. The Genesis contract produced
 * zero Transfers in 45 minutes of watching and $CHOG about one per minute, so a
 * single real event has to stay visible for minutes or the Wave Index sits at
 * zero and no Anomaly ever spawns.
 */
export const DECAY_PER_SEC = 0.02;
export const WAVE_CAP = 120;

/**
 * Ceiling for chain noise alone. Background traffic is a proxy for market
 * activity, not market activity itself, so it is allowed to reach the glitch
 * tier — a judge watching for three minutes should see something — but no
 * further. Trading on top of it is what opens anomaly and storm, and it is never
 * clamped. Without this the ambient wave climbed linearly and every sector sat
 * pinned at WAVE_CAP within three minutes of boot.
 */
export const AMBIENT_CEILING = 52;
export const BOSS_TTL_MS = 180_000;
export const LOCKOUT_MS = 90_000;
export const DEFEAT_RELIEF = 40;
export const RAVAGE_RELIEF = 15;

/**
 * Chain activity is the primary signal because it is the only one that is always
 * present. `amount` is a ratio against a self-calibrating baseline, so 1.0 means
 * "an ordinary block" and a busy stretch pushes above it.
 *
 * Calibrated against the live equilibrium: each sector receives roughly one pulse
 * Decay is a flat 0.02/sec rather than proportional, so the wave climbs linearly
 * while traffic is ordinary and only comes back down when players actually kill
 * something (DEFEAT_RELIEF) or a boss ravages a sector. That makes this constant
 * the time-to-first-Anomaly dial: measured on live traffic, 0.4 needed 6-7
 * minutes of just watching, which is longer than a judge records. At 1.4 the
 * ambient chain opens a glitch around the three-minute mark and a single real
 * sale reaches anomaly immediately. TIER_AT stays at 45/70/95 because that
 * spacing is what makes one sale a nudge, two an anomaly and three a storm —
 * core.test.ts pins it.
 *
 * per second and decay is continuous, so the resting wave is PULSE_PRESSURE /
 * DECAY_PER_SEC. At 0.4 that is ~20 — ambient traffic alone sits in the upper
 * normal band, a 3x busy stretch reaches glitch, and a 5x spike can storm. That
 * is the Star Force rule: anomalies come from traffic, not from one transaction.
 */
export const PULSE_PRESSURE = 1.4;

export interface WaveEvent {
  kind: 'nft-swap' | 'nft-sale' | 'token-swap' | 'mint' | 'chain-pulse' | 'market-volume';
  tokenId?: number;
  /** MON for NFT sales, $CHOG units for swaps, activity ratio for pulses. */
  amount?: number;
  /** Forces the target, used by the aggregate volume pulse which is already split. */
  sector?: SectorId;
  block: number;
  ts: number;
}

export interface Boss {
  id: string;
  tier: Exclude<Tier, 'normal'>;
  hp: number;
  maxHp: number;
  spawnedAt: number;
  phase: number;
  /** Set when a priced sale opened this one, so the client can show why. */
  archetype?: AnomalyArchetype;
  cause?: { txHash: string; tokenId: number; mon: number }[];
}

export interface SectorState {
  sector: SectorId;
  wave: number;
  tier: Tier;
  boss: Boss | null;
  lockoutUntil: number;
  peakWave: number;
  spawned: number;
  cleared: number;
}

export type SectorSignal =
  | { type: 'spawn'; sector: SectorId; boss: Boss }
  /** A market event opened this one. `cause` is linkable back to the chain. */
  | { type: 'anomaly'; sector: SectorId; boss: Boss; label: string }
  | { type: 'ravaged'; sector: SectorId; boss: Boss }
  | { type: 'cleared'; sector: SectorId; boss: Boss }
  /** Loot actually written to the token's save, so the reward is on screen. */
  | { type: 'reward'; sector: SectorId; tokenId: number; tier: Tier; cards: string[]; kills: number; level: number }
  | { type: 'tier'; sector: SectorId; from: Tier; to: Tier };

export function tierFor(wave: number): Tier {
  if (wave >= TIER_AT.storm) return 'storm';
  if (wave >= TIER_AT.anomaly) return 'anomaly';
  if (wave >= TIER_AT.glitch) return 'glitch';
  return 'normal';
}

/**
 * A priced sale is the only signal that can be partly linear, because the unit is
 * money rather than an unknown. Log-scaling a 9,140 MON median against a 200,000 MON
 * outlier compresses them into the same nudge, which throws away the one thing the
 * chain tells us precisely. Clamped at the ceiling so no single sale instant-Storms.
 */
export function salePressure(mon: number): number {
  const clamped = Math.min(20_000, Math.max(0, mon));
  return 20 + (clamped / 1_000) * 3;
}

/**
 * Collection-wide trading, split per sector by the server before it gets here.
 * This is the tide: it is what makes "lots of buy/sell across the collection"
 * raise the world's wave level, as opposed to one notable sale, which is a Baron.
 *
 * The floor is per sector because the server already divided the window's MON by
 * where the tokens actually traded.
 */
export const VOLUME_FLOOR_PER_SECTOR = 1_000;
export const VOLUME_PRESSURE_PER_MON = 0.004;

/**
 * Log-scaled so a routine sale nudges the sector and a whale genuinely cracks
 * it. NFT moves carry far more weight than token swaps because they are roughly
 * one per hour, and each has to be able to matter.
 */
export function pressureOf(ev: WaveEvent): number {
  const amt = Math.max(0, ev.amount ?? 0);
  if (ev.kind === 'chain-pulse') return PULSE_PRESSURE * amt;
  if (ev.kind === 'nft-sale') return salePressure(amt);
  if (ev.kind === 'market-volume') {
    return Math.max(0, amt - VOLUME_FLOOR_PER_SECTOR) * VOLUME_PRESSURE_PER_MON;
  }
  const scale = Math.log10(1 + amt);
  switch (ev.kind) {
    case 'nft-swap':
      return 18 + scale * 6;
    case 'token-swap':
      return 6 + scale * 3;
    case 'mint':
      return 10 + scale * 2;
  }
}

/**
 * A traded Chog stresses the sector its mint number falls into. $CHOG volume is
 * market-wide so it loads onto whatever is already hottest — that is the feedback
 * loop that turns a run into a storm. Chain pulses are not market behaviour, so
 * they spread evenly by block instead of compounding onto one sector.
 *
 * The hottest-sector pick is bounded by headroom. Unbounded, it is pure winner-
 * take-all: measured on live traffic one sector went 2 -> 120 inside twenty
 * seconds and sat pinned at the cap forever while the other two never mattered.
 * A sector near the ceiling now stops attracting, so the run spreads instead of
 * locking.
 */
export function routeOf(ev: WaveEvent, states: SectorState[]): SectorId {
  if (ev.sector && states.some((s) => s.sector === ev.sector)) return ev.sector;
  if (ev.kind === 'token-swap' || ev.kind === 'market-volume') {
    const room = states.filter((s) => s.wave < WAVE_CAP * 0.8);
    const pool = room.length ? room : states;
    return pool.reduce((a, b) => (b.wave > a.wave ? b : a), pool[0]!).sector;
  }
  if (ev.kind === 'chain-pulse') {
    return states[Math.abs(Math.trunc(ev.block)) % states.length]!.sector;
  }
  if (ev.tokenId === undefined) return SECTORS[0]!;
  return SECTORS[Math.abs(Math.trunc(ev.tokenId)) % SECTORS.length]!;
}

/**
 * Tuned against a measured program: a 4-card link lands ~2-5k with affinity.
 * At the previous 1400/4200/9000 a single good program deleted a glitch boss,
 * which left no fight to have. Storm is deliberately beyond one player inside
 * the 180s TTL — that is what makes it a co-op event rather than a bigger number.
 */
export function bossHp(tier: Exclude<Tier, 'normal'>, players: number): number {
  const base = tier === 'storm' ? 55000 : tier === 'anomaly' ? 26000 : 12000;
  return Math.round(base * (1 + 0.55 * Math.max(0, players - 1)));
}

export function createSectors(): SectorState[] {
  return SECTORS.map((sector) => ({
    sector,
    wave: 0,
    tier: 'normal' as Tier,
    boss: null,
    lockoutUntil: 0,
    peakWave: 0,
    spawned: 0,
    cleared: 0,
  }));
}

function nextBossId(sector: SectorId, tier: Tier, now: number): string {
  return `${sector}-${tier}-${now.toString(36).slice(-5)}`;
}

/** Applies decay + spawns + TTL despawns. Mutates the array it is given. */
export function tick(states: SectorState[], now: number, dtSec: number, players: number): SectorSignal[] {
  const out: SectorSignal[] = [];
  for (const s of states) {
    const before = s.tier;

    if (!s.boss) s.wave = Math.max(0, s.wave - DECAY_PER_SEC * dtSec);
    s.peakWave = Math.max(s.peakWave, s.wave);

    const to = s.boss ? s.tier : tierFor(s.wave);
    if (to !== before) out.push({ type: 'tier', sector: s.sector, from: before, to });
    s.tier = to;

    if (s.boss && now - s.boss.spawnedAt > BOSS_TTL_MS) {
      out.push({ type: 'ravaged', sector: s.sector, boss: s.boss });
      s.boss = null;
      s.wave = Math.max(0, s.wave - RAVAGE_RELIEF);
      s.lockoutUntil = now + LOCKOUT_MS;
      s.tier = tierFor(s.wave);
      continue;
    }

    if (!s.boss && now >= s.lockoutUntil) {
      const tier = tierFor(s.wave);
      if (tier !== 'normal') {
        const hp = bossHp(tier, players);
        s.boss = { id: nextBossId(s.sector, tier, now), tier, hp, maxHp: hp, spawnedAt: now, phase: 1 };
        s.spawned++;
        out.push({ type: 'spawn', sector: s.sector, boss: s.boss });
      }
    }
  }
  return out;
}

/** How dangerous each market event is, independent of the ambient Wave Index. */
export const ARCHETYPE_TIER: Record<AnomalyArchetype, Exclude<Tier, 'normal'>> = {
  spark: 'glitch',
  mirror: 'anomaly',
  front: 'anomaly',
  surge: 'storm',
  baron: 'storm',
};

/**
 * Open an anomaly because real money moved.
 *
 * This bypasses the tier threshold and the lockout on purpose: a 200k sale should
 * always produce something, and "come back in 90 seconds" is a bad answer to
 * "someone just bought a Chog". It does not replace a boss that is already out —
 * it escalates it, because the market kept moving while players were already
 * fighting. That is the difference between an ambient spawn and an event.
 */
export function openAnomaly(
  states: SectorState[],
  sector: SectorId,
  archetype: AnomalyArchetype,
  hp: number,
  cause: { txHash: string; tokenId: number; mon: number }[],
  now: number,
  label = '',
): SectorSignal[] {
  const s = states.find((x) => x.sector === sector);
  if (!s) return [];
  const tier = ARCHETYPE_TIER[archetype];

  if (s.boss) {
    s.boss.hp += hp;
    s.boss.maxHp += hp;
    if (TIER_AT[tier] > TIER_AT[s.boss.tier]) s.boss.tier = tier;
    s.boss.archetype = archetype;
    s.boss.cause = [...(s.boss.cause ?? []), ...cause].slice(-6);
    return [{ type: 'anomaly', sector, boss: s.boss, label }];
  }

  s.boss = {
    id: nextBossId(sector, tier, now),
    tier,
    hp,
    maxHp: hp,
    spawnedAt: now,
    phase: 1,
    archetype,
    cause,
  };
  s.spawned++;
  // The index has to reflect what is on screen, or a storm with 60k HP sits under
  // a Glitch meter and the HUD starts lying.
  s.wave = Math.max(s.wave, TIER_AT[tier]);
  s.peakWave = Math.max(s.peakWave, s.wave);
  s.tier = tier;
  return [{ type: 'anomaly', sector, boss: s.boss, label }];
}

export function ingest(states: SectorState[], events: WaveEvent[], now: number): SectorSignal[] {
  for (const ev of events) {
    const target = states.find((s) => s.sector === routeOf(ev, states))!;
    const p = pressureOf(ev);
    // Pulses stop accumulating at the ambient ceiling; genuine trades do not.
    const room = ev.kind === 'chain-pulse'
      ? Math.max(0, Math.min(WAVE_CAP, AMBIENT_CEILING) - target.wave)
      : WAVE_CAP - target.wave;
    target.wave = Math.min(WAVE_CAP, target.wave + Math.min(p, room));
  }
  return tick(states, now, 0, 1);
}

export function applyDamage(states: SectorState[], sector: SectorId, amount: number, now: number): SectorSignal[] {
  const s = states.find((x) => x.sector === sector);
  if (!s?.boss) return [];
  s.boss.hp -= amount;
  // Four reachable phases across the fight. The old `min(2, floor(p*3))` capped
  // at 3 and only for the last instant, so the top-end attack pattern was dead
  // code and the fight never actually escalated.
  s.boss.phase = 1 + Math.min(3, Math.floor((1 - s.boss.hp / s.boss.maxHp) * 4));
  if (s.boss.hp > 0) return [];
  const boss = s.boss;
  s.boss = null;
  s.wave = Math.max(0, s.wave - DEFEAT_RELIEF);
  s.lockoutUntil = now + LOCKOUT_MS;
  s.cleared++;
  s.tier = tierFor(s.wave);
  return [{ type: 'cleared', sector: s.sector, boss }];
}

/** Loot quality scales with how hot the sector was when the boss died. */
export function lootRoll(sector: SectorState, boss: Boss): { rarity: number; tier: Tier } {
  return { rarity: Math.min(1, sector.peakWave / WAVE_CAP), tier: boss.tier };
}

export function seasonKey(ts: number): string {
  const d = new Date(ts);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.floor((ts - first.getTime()) / 604_800_000) + 1;
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
