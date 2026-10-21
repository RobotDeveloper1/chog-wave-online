/**
 * The forge never cooled down.
 *
 * A Data Area used to be a walk between two fights: the only thing the corridor charged you
 * was the seconds it took, and the only thing the clock charged you was the Depth par. This
 * module is the missing price. The foundry runs a cycle -- a long lull, then a surge -- and
 * whatever is standing on the floor while it surges heats up.
 *
 * Why heat and not another stat: the Fold Depth ladder (see `dungeon.ts`) pays for *speed*
 * and for an untouched field. Both of those are free today, because walking fast costs
 * nothing. Heat is what makes them cost something. Running the surge buys the par and spends
 * the flawless; waiting out the lull keeps the field whole and gives the par away. That
 * trade is the whole mechanic, and it only works because heat is measured against the same
 * integrity the run is already dying by.
 *
 * Everything here is a pure function of the clock. The client renders the meter with it and
 * the server charges the damage with it, and because both call the same code from the same
 * wall-clock they cannot disagree -- which is the only reason a client-side hazard is
 * allowed to exist in a game whose server is authoritative.
 */

/** Heat is a percentage. 100 is ignition, and there is no 101. */
export const HEAT_MAX = 100;

/**
 * The forge cycle, in milliseconds. 18s is long enough that a room can be fought inside one
 * lull and short enough that a corridor is never more than a few seconds from the next
 * surge -- so the decision "go now or wait" is asked on every single crossing.
 */
export const FORGE_PERIOD_MS = 18_000;
/** When the surge begins inside the period. */
export const FORGE_SURGE_AT = 11_000;
/** How long the surge takes to come up, and to go back down. */
export const FORGE_RISE_MS = 2_500;
export const FORGE_FALL_MS = 2_000;
/** How long before the surge the tell starts. Long enough to be read, short enough to hurt. */
export const FORGE_WARN_MS = 2_500;

export interface ForgePhase {
  /** 0 through the lull, 1 at the peak of the surge. */
  surge: number;
  /** 0..1 through the warning window: the tell that a surge is coming. */
  tell: number;
  /** Milliseconds until the surge starts. 0 once it has. */
  untilSurge: number;
  /** True while the floor is actually hot. */
  hot: boolean;
}

/** Where the forge is in its cycle. Deterministic in `ms`, which is a wall clock, not a frame count. */
export function forgePhase(ms: number): ForgePhase {
  const t = ((ms % FORGE_PERIOD_MS) + FORGE_PERIOD_MS) % FORGE_PERIOD_MS;

  let surge: number;
  if (t < FORGE_SURGE_AT) surge = 0;
  else if (t < FORGE_SURGE_AT + FORGE_RISE_MS) surge = (t - FORGE_SURGE_AT) / FORGE_RISE_MS;
  else {
    // The tail of the period is the fall, so the surge always ends the cycle it began.
    const fallAt = FORGE_PERIOD_MS - FORGE_FALL_MS;
    surge = t < fallAt ? 1 : Math.max(0, 1 - (t - fallAt) / FORGE_FALL_MS);
  }

  const warnAt = FORGE_SURGE_AT - FORGE_WARN_MS;
  const tell = t >= warnAt && t < FORGE_SURGE_AT ? (t - warnAt) / FORGE_WARN_MS : 0;
  const untilSurge = t < FORGE_SURGE_AT ? FORGE_SURGE_AT - t : 0;
  return { surge, tell, untilSurge, hot: surge > 0.02 };
}

/** The three bands the meter is drawn in, and the only places the rules change. */
export type HeatBand = 'cold' | 'warm' | 'critical';
export const HEAT_WARM = 40;
export const HEAT_CRITICAL = 70;

export function heatBand(heat: number): HeatBand {
  if (heat >= HEAT_CRITICAL) return 'critical';
  if (heat >= HEAT_WARM) return 'warm';
  return 'cold';
}

export const HEAT_BAND_LABEL: Record<HeatBand, string> = {
  cold: 'COOL',
  warm: 'HEATING',
  critical: 'CRITICAL',
};

/**
 * What you are standing on, as far as the forge is concerned.
 *
 * `cool` is a cleared chamber or the mouth of the fold -- the two places the run has already
 * made safe, which is the whole reward for having fought. `corridor` is the walk between
 * rooms. `room` is an uncleared chamber, which is where the machinery still runs.
 */
export type HeatZone = 'cool' | 'corridor' | 'room';

/**
 * How hard the place cooks you, 0..1.
 *
 * The point of the numbers is the *gap*: a corridor at the peak is nearly as bad as a room,
 * and a corridor in the lull is nearly free. So the surge is what makes the walk expensive,
 * and clearing a room is what makes the next walk cheap -- which is why heat and the node
 * graph reinforce each other instead of sitting side by side.
 */
export function zoneSource(zone: HeatZone, surge: number): number {
  const s = Math.max(0, Math.min(1, surge));
  switch (zone) {
    case 'cool': return 0;
    case 'corridor': return 0.14 + 0.86 * s;
    case 'room': return 0.42 + 0.58 * s;
  }
}

/** Heat gained per second standing in a fully hot spot. ~9s from cold to ignition. */
export const HEAT_GAIN = 11;
/** Heat lost per second standing somewhere cool. ~11s from ignition back to cold. */
export const HEAT_COOL = 9;

/** One integration step. `dt` is seconds. */
export function heatStep(heat: number, dt: number, zone: HeatZone, surge: number): number {
  const src = zoneSource(zone, surge);
  const next = src > 0 ? heat + src * HEAT_GAIN * dt : heat - HEAT_COOL * dt;
  return Math.max(0, Math.min(HEAT_MAX, next));
}

/**
 * The same step, over a wall-clock interval, integrating in fixed slices so a client running at
 * 144Hz and a server stepping at 4Hz land on exactly the same number.
 */
export function heatOverInterval(heat: number, fromMs: number, toMs: number, zone: HeatZone, slice = 250): number {
  return advanceHeat(heat, fromMs, toMs, zone, slice).heat;
}

/**
 * The longest gap that is charged as forge time. A player who closed the tab for an hour was not
 * standing in the foundry for an hour, so anything past this is a reconnect and costs nothing --
 * otherwise a reload would be a death sentence and nobody would ever dare to leave.
 */
export const HEAT_MAX_GAP_MS = 20_000;

export interface HeatAdvance {
  /** Heat at the end of the interval. */
  heat: number;
  /** Integrity lost over the interval, as a fraction of the pool. Integrated, not sampled. */
  drain: number;
  /** The worst band the interval passed through, which is the one worth telling the player about. */
  worst: HeatBand;
}

/**
 * Walk the interval in slices, accumulating both the heat and the bleed it caused.
 *
 * Sampling the band once at the end would be wrong in the one case that matters: crossing a
 * corridor as a surge comes up passes through warm and into critical, and a player who loses the
 * field to a single sampled frame would be right to call it a cheat.
 */
export function advanceHeat(heat: number, fromMs: number, toMs: number, zone: HeatZone, slice = 250): HeatAdvance {
  let h = Math.max(0, Math.min(HEAT_MAX, heat));
  let drain = 0;
  let worst: HeatBand = heatBand(h);
  const rank: Record<HeatBand, number> = { cold: 0, warm: 1, critical: 2 };
  if (!(toMs > fromMs)) return { heat: h, drain: 0, worst };
  let at = fromMs;
  while (at < toMs) {
    const span = Math.min(slice, toMs - at);
    const dt = span / 1000;
    // The band is read at the middle of the slice, which is where a slice this short is exact to
    // the third decimal anyway -- and `heatStep` cannot cross a threshold it did not already sit on.
    const mid = heatStep(h, dt / 2, zone, forgePhase(at + span / 2).surge);
    drain += heatDrainPct(mid) * dt;
    h = heatStep(h, dt, zone, forgePhase(at + span / 2).surge);
    const band = heatBand(h);
    if (rank[band] > rank[worst]) worst = band;
    at += span;
  }
  return { heat: h, drain, worst };
}

/**
 * What a band costs you in field integrity, as a fraction of the pool per second.
 *
 * Cold is free, warm is a slow bleed you can ignore once and not twice, and critical is
 * fast enough that standing in it is always a mistake you chose to make.
 */
export function heatDrainPct(heat: number): number {
  switch (heatBand(heat)) {
    case 'cold': return 0;
    case 'warm': return 0.006;
    case 'critical': return 0.018;
  }
}

/**
 * How low heat is allowed to take you, as a fraction of the pool.
 *
 * The first fold is where the mechanic is learned, and its own blurb calls it "short, hot and
 * forgiving", so heat there can hurt you but never end you. From the second fold on the floor
 * is gone and the forge is a thing that can kill -- which is the promise the tutorial made.
 */
export function heatFloorPct(tier: number): number {
  return tier <= 1 ? 0.35 : 0;
}

/**
 * How much wider a band's notice is when the floor is glowing. At critical the whole room is
 * awake, so a fight you meant to walk around comes to you instead.
 */
export function heatAggroMul(heat: number): number {
  switch (heatBand(heat)) {
    case 'cold': return 1;
    case 'warm': return 1.25;
    case 'critical': return 2;
  }
}

/** One line for the meter, so the number always says what it is doing to you. */
export function heatAdvice(heat: number): string {
  switch (heatBand(heat)) {
    case 'cold': return 'the floor is only warm';
    case 'warm': return 'your field is bleeding off';
    case 'critical': return 'everything in here can see you';
  }
}

/**
 * What the server will believe about where a client says it is standing.
 *
 * The field is the only thing that knows whether the player is in a chamber or a corridor, so the
 * zone has to come from the client -- the same trust the fight's own `damageTaken` already runs on.
 * The one thing that is not on offer is claiming to be cool while standing in a room whose monster
 * is still alive: that is the single claim that would make heat free, so the server refuses it.
 * Claiming a corridor from somewhere safe is allowed, and only ever costs the player more.
 */
export function clampHeatZone(claimed: HeatZone, standingInUnclearedFight: boolean): HeatZone {
  if (standingInUnclearedFight && claimed === 'cool') return 'room';
  if (claimed !== 'cool' && claimed !== 'corridor' && claimed !== 'room') return 'room';
  return claimed;
}
