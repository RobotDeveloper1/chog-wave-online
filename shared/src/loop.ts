import { CARDS_ALL } from './cards.ts';
import * as SF from './sf/index.ts';
import { LINE_MAX_SLOTS } from './line/index.ts';
import { partyHpScale, partyPowerScale } from './party.ts';
import { LEVEL_CAP } from './progress.ts';
import { deriveBuild } from './derive.ts';
import type { Card, Element } from './types.ts';

type DuelTier = SF.DuelTier;

/**
 * The loop, measured instead of asserted.
 *
 * Every difficulty number in this game used to be a guess written next to a comment claiming
 * it felt right. It is the same failure in both directions: the designer picks an HP band, the
 * player picks a deck, and nobody checks whether those two numbers ever meet. This module is
 * the check. It drives SF sessions with legal Hand picks, real staggered projectiles,
 * persistent element chains, per-battle Giga expenditure and crits. A stationary,
 * neutral target isolates outgoing throughput; the SF volley clock prices incoming attrition.
 *
 * Which turns difficulty into the only unit that matters for an action game: **seconds**. A node
 * is not "2300 HP", it is "how long until it dies, and how much of my field integrity I spend
 * getting there". `dungeon.ts` reads `runPlan()` for both: health comes from measured DPS times the
 * tier's target duration, and the enemy's bite comes from `powerForCost()`, which solves for the
 * damage that spends exactly the walk's integrity budget over exactly those seconds. Cost is the
 * knob, HP is a consequence — so a map cannot become unwinnable just because its health went up.
 *
 * Three bands, because one player is not a distribution: `new` plays badly on purpose (picks
 * the first legal card, stares at the menu, dodges late) and `optimized` plays well. A design
 * that is comfortable for both at once is the only design that does not need a difficulty
 * setting — and since it is not reachable (see `AUDIENCE`), each tier is cut for the band that
 * actually walks into it on the day it opens, and the other two are measured as *readings* on the
 * same map rather than failures of it.
 */

export type Band = 'new' | 'core' | 'optimized';

export interface BandModel {
  /** Deck construction: which elements it leans on and how far up the rarity ladder it reaches. */
  lean: Partial<Record<Element, number>>;
  /** NFT rarity controls deck capacity; SF field width comes from level-derived stats. */
  rarity: number;
  /** Copies of one card the player is willing to bank, which is what makes a draw repeat. */
  copies: number;
  mega: number;
  giga: number;
  /** Descriptive report assumption only; damage uses the live SF chain. */
  chainRun: number;
  /** Fraction of a volley this band eats. Telegraph reading is the skill the field tests. */
  hitRate: number;
  /** How long this band spends in the Hand per program. */
  menuMs: number;
  /** How likely it is to land a card on the file the boss occupies. */
  aim: number;
  /** Economic provenance assumption; SF damage does not use an affinity multiplier. */
  affinity: number;
  crit: number;
}

const ELEMENTS: Element[] = ['burn', 'frost', 'volt', 'wave', 'prism', 'void'];

export const BANDS: Record<Band, BandModel> = {
  // Day one: a deck of whatever the token was born holding, three cards in the queue, and a
  // player still reading the telegraph. Everything here is deliberately bad.
  new: {
    lean: {},
    rarity: 0,
    copies: 5,
    mega: 0,
    giga: 0,
    chainRun: 1,
    hitRate: 0.34,
    menuMs: 6_000,
    aim: 0.5,
    affinity: 0,
    crit: 0.05,
  },
  // The median player at a median level: a chosen tribe, Mega cards, prism as the catalyst, and a
  // dodge that is mostly learned.
  core: {
    lean: { prism: 1.8 },
    rarity: 3,
    copies: 4,
    mega: 3,
    giga: 0,
    chainRun: 2,
    hitRate: 0.18,
    menuMs: 4_000,
    aim: 0.7,
    affinity: 0.22,
    crit: 0.16,
  },
  // Theory craft: void output with prism as the resonance glue, a full six-card queue, and no
  // wasted frames in the menu. This is the ceiling the game has to survive.
  optimized: {
    lean: { void: 3, prism: 2.4 },
    rarity: 5,
    copies: 3,
    mega: 6,
    giga: 1,
    chainRun: 3,
    hitRate: 0.08,
    menuMs: 2_800,
    aim: 0.85,
    affinity: 0.45,
    crit: 0.3,
  },
};

/** A deterministic `rand`, so a pacing report is reproducible and a test can pin it. */
export function rng(seed: number): () => number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
    return (x >>> 0) / 4294967296;
  };
}

function weightOf(lean: Record<Element, number>, c: Card): number {
  const output = c.power * Math.max(1, c.hits);
  // A real player's deck is not uniform-random over what they own: they hold more of what hits
  // harder, and far more of the tribe they chose. Both are here, and together they are why
  // `optimized` reads stronger than a born deck at the same queue length.
  return (lean[c.element] ?? 1) * (0.6 + output / 400);
}

/** The band's element weights, with the player's own tribe on top of them. */
function leanFor(model: BandModel, tribe: Element): Record<Element, number> {
  const lean = {} as Record<Element, number>;
  for (const e of ELEMENTS) lean[e] = model.lean[e] ?? 1;
  lean[tribe] = Math.max(3, lean[tribe]!);
  return lean;
}

/**
 * Fill `want` slots from `pool`, at most `copies` of any one card, weighted by `weight`.
 * The loop cannot hang: every pass either places a card or finds the pool capped.
 */
function drawQuota(pool: readonly Card[], want: number, copies: number, weight: (c: Card) => number, rand: () => number): string[] {
  const counts = new Map<string, number>();
  const out: string[] = [];
  while (out.length < want) {
    const open = pool.filter((c) => (counts.get(c.id) ?? 0) < copies);
    if (!open.length) break;
    let roll = open.reduce((s, c) => s + weight(c), 0) * rand();
    let pick = open[open.length - 1]!;
    for (const c of open) {
      const w = weight(c);
      if (roll < w) {
        pick = c;
        break;
      }
      roll -= w;
    }
    counts.set(pick.id, (counts.get(pick.id) ?? 0) + 1);
    out.push(pick.id);
  }
  return out;
}

/**
 * The deck a player at this band would actually carry. Built with the same constraints the
 * deck editor enforces — a size, a copies cap, a Mega and a Giga allowance, and one element it
 * may never field (its own weakness) — so the draw distribution the Hand sees here is
 * the one it sees in the game.
 */
export function referenceDeck(band: Band, rand: () => number): string[] {
  const model = BANDS[band];
  const tribe = ELEMENTS[Math.floor(rand() * ELEMENTS.length) % ELEMENTS.length]!;
  const banned = ELEMENTS[(ELEMENTS.indexOf(tribe) + 2 + Math.floor(rand() * 3)) % ELEMENTS.length]!;
  const lean = leanFor(model, tribe);
  const weight = (c: Card) => weightOf(lean, c);
  const shelf = (k: 'S' | 'M' | 'G') => CARDS_ALL.filter((c) => (c.klass ?? 'S') === k && c.element !== banned);
  const giga = drawQuota(shelf('G'), model.giga, model.copies, weight, rand);
  const mega = drawQuota(shelf('M'), model.mega, model.copies, weight, rand);
  const commons = drawQuota(shelf('S'), LINE_MAX_SLOTS - giga.length - mega.length, model.copies, weight, rand);
  return [...giga, ...mega, ...commons];
}

/**
 * Six folders per band, drawn once for the band rather than once per level.
 *
 * One reference deck per (band, level) made the level curve measure that deck's luck instead
 * of the player's growth — a level 26 deck of weak commons read as *less damage* than a level 12
 * deck of good ones, which is the opposite of the claim the whole module is making. Averaging
 * over a handful of folders, all drawn from a stream seeded by band alone, keeps the deck spread
 * (and the tribe variety inside it) fixed while SF level-derived stats change across the ladder.
 */
export const DECKS_PER_BAND = 6;
const BAND_SEED: Record<Band, number> = { new: 1_013, core: 2_027, optimized: 4_019 };
const deckCache = new Map<Band, string[][]>();

export function referenceDecks(band: Band, count = DECKS_PER_BAND): string[][] {
  const seen = deckCache.get(band);
  if (seen && seen.length >= count) return seen.slice(0, count);
  const rand = rng(BAND_SEED[band]!);
  const out: string[][] = [];
  for (let i = 0; i < count; i++) out.push(referenceDeck(band, rand));
  deckCache.set(band, out);
  return out;
}

/** A neutral reference loadout; level growth is derived by the same SF API as the server. */
function referenceStats(level: number, band: Band): SF.DuelStats {
  const model = BANDS[band];
  const build = deriveBuild({ tokenId: 418, transferCount: 0, daysHeld: 0 });
  return SF.duelStatsOf({
    level,
    attrs: build.attrs,
    loadout: { ...build.loadout, gear: 'charge', voice: { critPct: model.crit * 100 }, megaCap: model.mega > 0 ? 1 : 0, gigaCap: model.giga > 0 ? 1 : 0 },
  });
}

function selectProgram(session: SF.DuelSession, body: SF.DuelBody, band: Band): void {
  // A candidate's own `might` wins over the catalogue's, because the basic attack carries the
  // token's number there and not in `cards.ts` (`sf/loadout.ts basicMight`). Reading
  // `SF.card(id).might` alone ranked every basic as a 1-power card and would have made the
  // mature bands refuse the very thing a small deck fills its hand with.
  const mightOf = (c: SF.Candidate): number => c.might ?? SF.card(c.cardId).might;
  while (body.hand) {
    const legal = body.hand.cells.filter((c) => SF.canPick(body.hand!, c.cell, SF.capsOf(body)).ok);
    if (!legal.length) break;
    const take = band === 'new' ? legal[0]! : legal.reduce((a, b) => (mightOf(b) > mightOf(a) ? b : a));
    if (!SF.pickCard(session, body.id, take.cell)) break;
  }
}

function referenceSession(deck: readonly string[], band: Band, level: number, rand: () => number): { session: SF.DuelSession; body: SF.DuelBody } {
  const session = SF.openSession({
    id: 'pacing', place: { kind: 'train', sector: 'ashflat' }, rand,
    boss: { name: 'Neutral DPS target', archetype: 'dummy', element: 'void', hp: 1_000_000_000, level },
  });
  // A stationary, non-attacking target isolates throughput from the separate attrition model.
  // Void is neutral to every attacking element; chains, crits and Giga expenditure remain live.
  session.boss.next = Infinity;
  const body = SF.addBody(session, { id: 'reference', owner: 'reference', name: band, tribe: 'burn', level, stats: referenceStats(level, band), deck });
  return { session, body };
}

/** One legal SF program, including real coverage, chain and landing-time crits. */
export function sampleProgram(deck: readonly string[], band: Band, level: number, cols: number, rand: () => number): number {
  const { session, body } = referenceSession(deck, band, level, rand);
  SF.widen(session.field, Math.max(SF.MIN_COLS, Math.min(SF.MAX_COLS, cols)));
  const target = rand() < BANDS[band].aim ? session.field.boss.file : session.field.boss.file + 1;
  while (body.file !== target) SF.step(session, body.id, body.file < target ? 'right' : 'left');
  SF.openHand(session, body);
  selectProgram(session, body, band);
  SF.execute(session, body.id);
  let damage = 0;
  do {
    SF.tick(session, 50);
    for (const event of SF.drainEvents(session)) if (event.type === 'hit') damage += event.damage;
  } while (body.program || session.field.shots.length);
  return damage;
}

function measureCycles(deck: readonly string[], band: Band, level: number, programs: number, rand: () => number): { damage: number; cards: number; ms: number } {
  const { session, body } = referenceSession(deck, band, level, rand);
  let fired = 0;
  let damage = 0;
  let cards = 0;
  const aimFile = (): number => rand() < BANDS[band].aim ? session.field.boss.file : Math.min(session.field.cols - 1, session.field.boss.file + 1);
  let target = aimFile();
  while (fired < programs || body.program || session.field.shots.length) {
    if (body.hand) {
      if (body.handMs >= BANDS[band].menuMs) {
        selectProgram(session, body, band);
        SF.execute(session, body.id);
        fired++;
        target = aimFile();
      }
    } else if (SF.canAct(body) && fired < programs) {
      // Cards and dodging only: the Buster was cut, so the reference player spends the charge
      // window moving to aim, not tapping a gun that no longer exists. The dead time is real and
      // it is priced in — that is what makes the measured DPS honest about the new pacing.
      if (body.file !== target) SF.step(session, body.id, body.file < target ? 'right' : 'left');
    }
    SF.tick(session, 50);
    for (const event of SF.drainEvents(session)) {
      if (event.type === 'hit') { cards += event.damage; damage += event.damage; }
    }
  }
  return { damage, cards, ms: session.elapsed };
}

export interface DpsProfile {
  level: number;
  band: Band;
  /** Damage the reference player actually lands per second, including the menu's dead time. */
  dps: number;
  /** Mean landed SF card damage. */
  programDamage: number;
  /** Retained report field: licences no longer apply an invented combat multiplier. */
  licence: number;
  cycleSeconds: number;
  chargeMs: number;
  queueSlots: number;
  gridEdge: number;
  samples: number;
}

/** Licences govern the deck editor, not a separate SF damage multiplier. */
export function licenceBoost(_level: number): number {
  return 1;
}

const cache = new Map<string, DpsProfile>();

/**
 * Measured DPS for a lone reference player. Memoised because it is a Monte Carlo over hundreds of
 * simulated programs and the dungeon calls it while generating maps.
 *
 * Every deck runs one continuous battle, with paired seeds across levels. Charge refill is full
 * after the opening partial fill, and time in both the menu and the program stops the charge.
 * The per-battle Giga and chain state are never reset between the sampled programs.
 */
export function dpsProfile(level: number, band: Band, opts: { samples?: number; seed?: number } = {}): DpsProfile {
  const samples = opts.samples ?? 144;
  const seed = opts.seed ?? 20_261_010;
  const stats = referenceStats(level, band);
  const hit = `${SF.clampLevel(level)}|${band}|${samples}|${seed}`;
  const seen = cache.get(hit);
  if (seen) return { ...seen, level };

  const folders = referenceDecks(band);
  const per = Math.max(6, Math.ceil(samples / folders.length));
  const count = per * folders.length;
  let damage = 0;
  let cards = 0;
  let ms = 0;
  for (let i = 0; i < folders.length; i++) {
    const result = measureCycles(folders[i]!, band, level, per, rng(seed + i * 131 + BAND_SEED[band]));
    damage += result.damage;
    cards += result.cards;
    ms += result.ms;
  }
  const profile: DpsProfile = {
    level,
    band,
    dps: Math.round(damage / (ms / 1000)),
    programDamage: Math.round(cards / count),
    licence: licenceBoost(level),
    cycleSeconds: Math.round(ms / count / 10) / 100,
    chargeMs: SF.chargeMsFor({ charge: stats.charge }),
    queueSlots: stats.slots,
    // Retain the report's field name, but its value is SF field width, not a placement grid.
    gridEdge: stats.cols,
    samples: count,
  };
  cache.set(hit, profile);
  return { ...profile };
}

/**
 * Price every band the game can ask about, once, so no map generation — and no player waiting on
 * one — pays for the Monte Carlo. Warm each distinct SF stat profile on the economic level ladder.
 */
export function warmDps(): DpsProfile[] {
  const reps: number[] = [];
  const seen = new Set<string>();
  for (let lv = 1; lv <= LEVEL_CAP; lv++) {
    const stats = referenceStats(lv, 'core');
    const key = JSON.stringify(stats);
    if (seen.has(key)) continue;
    seen.add(key);
    reps.push(lv);
  }
  const bands = Object.keys(BANDS) as Band[];
  return bands.flatMap((band) => reps.map((lv) => dpsProfile(lv, band)));
}

/** Same number, with the party standing on it. */
export function expectedDps(level: number, band: Band, partySize = 1, crossLinkMult = 1): number {  const dps = dpsProfile(level, band).dps * Math.max(1, partySize) * crossLinkMult;
  return Math.round(dps);
}

/** Seconds to kill something with this much health, given this much damage per second. */
export function ttkSeconds(hp: number, dps: number): number {
  if (dps <= 0) return Infinity;
  return Math.round((hp / dps) * 10) / 10;
}

/**
 * What a fight costs the field, in HP, while it lasts.
 *
 * The boss fires on the duel's own clock — a warning, then a strike, then a gap — so the number
 * of volleys in a fight is `seconds / volleyPeriodSeconds()`, and what you pay is that many
 * volleys times the fraction you fail to dodge. This is the real dungeon difficulty: health
 * decides how long you stand there, and standing there is what spends you.
 *
 * `power` is the enemy's own bite, the number `dungeon.ts` writes into the map and the session
 * divides by the duel's phase-2 volley to get a per-hit hit. It is solved for by `powerForCost()` from the fraction of the field a fight is allowed to take,
 * which is why the two functions below are inverses of each other and why a map cannot accidentally
 * become unwinnable just because its health went up.
 */
export interface Attrition {
  volleys: number;
  hpLost: number;
  perVolley: number;
  fieldHp: number;
  /** 0..1 of the field integrity gone by the end of this fight. */
  pct: number;
  power: number;
}

/** Which half of the duel's damage table a fight of this kind is drawn from. */
export function duelTierOf(kind: FightKind, tier: number): DuelTier {
  if (kind !== 'boss') return 'node';
  return tier >= 4 ? 'storm' : tier >= 2 ? 'anomaly' : 'node';
}

/** The four phases' volley sizes, which a full health bar walks through roughly evenly. */
function volleySeries(tier: DuelTier, archetype?: string): number[] {
  return [1, 2, 3, 4].map((phase) => SF.volleyDamage(phase, tier, archetype));
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Seconds between one warning starting and the next, averaged over the phases.
 *
 * It takes the same gap and difficulty the field does, because a fight that reads faster also
 * *runs* faster: the same 30 seconds on the clock is more volleys, and a budget solved against the
 * old cadence would quietly over-charge every deep map the moment the warning shortened.
 */
export function volleyPeriodSeconds(args: { levelGap?: number; difficulty?: number; training?: boolean } = {}): number {
  let ms = 0;
  for (let phase = 1; phase <= 4; phase++) {
    const c = SF.volleyClock({ ...args, phase });
    ms += c.telegraph + c.gap;
  }
  return ms / 4 / 1000;
}

export function volleysIn(seconds: number, args: { levelGap?: number; difficulty?: number } = {}): number {
  return Math.max(1, Math.round(seconds / volleyPeriodSeconds(args)));
}

/** Incoming power uses SF's phase-two volley anchor, matching the authoritative session. */

/**
 * How often a volley lands on one body, as a multiple of "always".
 *
 * Both halves come from `party.ts` and they cancel: an enemy hits harder with more bodies on the
 * field (`partyPowerScale`, n**0.5) and aims at any one of them less often (1/n**0.5). So a party
 * does not make you safer per hit taken, it makes the fight *shorter* per body and gives you
 * someone to cover a revive — which is the honest version of the claim.
 */
function exposure(size: number): number {
  return partyPowerScale(size) / Math.sqrt(Math.max(1, size));
}

export interface AttritionArgs {
  level: number;
  tier: number;
  band: Band;
  seconds: number;
  kind?: FightKind;
  /** The enemy's bite. Defaults to whatever this tier's budget for that kind carries. */
  power?: number;
  guard?: number;
  archetype?: string;
  partySize?: number;
}

export function attritionFor(args: AttritionArgs): Attrition {
  const model = BANDS[args.band];
  const kind = args.kind ?? 'node';
  const duel = duelTierOf(kind, args.tier);
  const size = Math.max(1, Math.round(args.partySize ?? 1));
  const power = args.power ?? nodeBudget(args.tier, { kind, level: args.level, band: args.band, archetype: args.archetype }).power;
  // `power` is anchored on phase 2, so dividing it out and re-multiplying by the phase average is
  // what keeps an archetype's own scaling (a baron's 1.5x) in the answer.
  const bite = power / SF.volleyAnchor(duel);
  const perVolley = mean(volleySeries(duel, args.archetype)) * bite;
  const volleys = volleysIn(args.seconds, { difficulty: args.tier });
  const hpLost = Math.round(volleys * perVolley * exposure(size) * model.hitRate * (1 - (args.guard ?? 0)));
  const fieldHp = referenceStats(args.level, args.band).hp;
  return {
    volleys,
    perVolley: Math.round(perVolley * 10) / 10,
    hpLost,
    fieldHp,
    pct: Math.round((hpLost / Math.max(1, fieldHp)) * 1000) / 1000,
    power,
  };
}

/**
 * The bite that makes a fight of this length cost exactly `pct` of the field.
 *
 * The answer carries fractional precision on purpose: with the faster duel pacing the per-volley
 * bite is smaller, and rounding it to a whole number coarsens the whole budget — a 5-percent step
 * on a small bite is a 5-percent error on every map solved from it. Two decimals is finer than any
 * consumer needs and tight enough for the round-trip to hold.
 */
export function powerForCost(args: Omit<AttritionArgs, 'power'> & { pct: number }): number {
  const kind = args.kind ?? 'node';
  const duel = duelTierOf(kind, args.tier);
  const model = BANDS[args.band ?? 'core'];
  const size = Math.max(1, Math.round(args.partySize ?? 1));
  const landings = volleysIn(args.seconds, { difficulty: args.tier }) * model.hitRate * exposure(size) * (1 - (args.guard ?? 0));
  const perPhase = mean(volleySeries(duel, args.archetype));
  const bite = (args.pct * referenceStats(args.level, args.band).hp) / Math.max(Number.EPSILON, landings * perPhase);
  return Math.max(1, Math.round(bite * SF.volleyAnchor(duel) * 100) / 100);
}

// ---------------------------------------------------------------------------
// The fun window
// ---------------------------------------------------------------------------

/**
 * The target durations. Everything else is derived from these, which is the point: a designer
 * arguing about HP bands is arguing about vibes, but "a tier-1 trash fight should last 24 to 34
 * seconds and the whole walk 2.5 to 4.5 minutes" is a number everyone can check the game against.
 *
 * The windows are per tier rather than one global band, because a run's length is the product of
 * its row count and its fight length and only one of those can move. Deeper folds get longer
 * fights *and* more of them — a tier-4 walk is meant to be an evening, a tier-1 walk a coffee —
 * and `runCost` grows more slowly than either, so the difficulty of a high tier comes from the
 * boss's health pool and the number of decisions, not from a fraction of your HP you cannot see.
 */
export const FUN = {
  nodeSeconds: [[24, 34], [30, 42], [36, 52], [44, 62]] as const,
  bossSeconds: [[80, 100], [100, 125], [120, 150], [145, 175]] as const,
  /** An elite is the same fight with more of it standing there. */
  eliteSecondsK: 1.6,
  /** Mouth row, decision rows, core row. */
  rows: [5, 6, 7, 8] as const,
  /** A run should be a lunch break, not a raid night — and a tier-1 run should be a coffee. */
  runMinutes: [[2.5, 4.5], [3.5, 6], [5, 8], [7, 11]] as const,
  /** Walking and reading the map between rows. */
  travelSeconds: 14,
  /** What a whole walk spends of one player's field integrity — for whoever the tier is cut for. */
  runCost: [0.62, 0.72, 0.82, 0.92] as const,
  /** An elite costs twice a wave's integrity, a core 3.2x. The shape of the risk curve. */
  eliteCostK: 2,
  bossCostK: 3.2,
  /** What a relay gives back. */
  relayPct: 0.35,
  /** Levels should arrive while you are still in the chair. */
  levelMinutes: [4, 14] as const,
  /** Something worth a look happens at least this often: a card, a gate, a first clear. */
  rewardEverySeconds: 90,
};

const tierIndex = (tier: number): number => Math.max(0, Math.min(FUN.rows.length - 1, Math.round(tier) - 1));
const windowAt = (table: readonly (readonly [number, number])[], tier: number): readonly [number, number] => table[tierIndex(tier)]!;

export const nodeWindow = (tier: number): readonly [number, number] => windowAt(FUN.nodeSeconds, tier);
export const bossWindow = (tier: number): readonly [number, number] => windowAt(FUN.bossSeconds, tier);
export const runWindow = (tier: number): readonly [number, number] => windowAt(FUN.runMinutes, tier);
export const rowsForTier = (tier: number): number => FUN.rows[tierIndex(tier)]!;

/** The mid-point of a window, which is the number to aim a band at. */
export const mid = ([a, b]: readonly [number, number]): number => (a + b) / 2;

/**
 * The level a tier's content is meant to be beaten at. Dungeons open at 2/5/8/12/18/26, so the
 * reference player for a tier is the one who just walked in through its gate, not the one at the
 * cap — HP sized for a level 40 makes a level 2 dungeon a slog and a level 26 dungeon trivial.
 */
export const REF_LEVEL: readonly number[] = [2, 6, 12, 26];
export const refLevel = (tier: number): number => REF_LEVEL[tierIndex(tier)]!;

/**
 * Which player a tier's map is cut for.
 *
 * This is the decision the whole difficulty curve rests on, so it is worth saying plainly: one map
 * cannot be sized for both ends of the skill range, because a fight's length is HP/dps and its cost
 * is volleys*dodge, and the measured spread between bands is a ~7x product of those two ratios at
 * the same level. Set the health so a newcomer's node lasts half a minute and a veteran's lasts four
 * seconds; set the bite so a newcomer pays a tenth of their field and a veteran pays a fortieth. Any
 * single pair of numbers satisfies exactly one of those readings, and the other one is a bug report.
 *
 * So the ladder is cut per rung instead of pretending to be universal. The first two folds open at
 * level 2 and 5, which is a player on their first afternoon — they are the audience, and EMBER FOUNDRY
 * is *for* them: it should take half a minute to clear a node and cost them something they notice. A
 * veteran back through it melts it, and that is the reward for being a veteran. The deep folds are cut
 * for the median player instead, because tier 3 and tier 4 open at 12, 18 and 26 where nobody is new
 * any more, and a tier-4 map that a good player finds easy is a tier-4 map that the median player
 * finds hard, which is the only difficulty setting this game has.
 */
export const AUDIENCE: readonly Band[] = ['new', 'new', 'core', 'core'];
export const audienceBand = (tier: number): Band => AUDIENCE[tierIndex(tier)]!;

/** Is this band the one the tier was cut for, stronger than it, or weaker? Verdicts are read per role. */
export function bandRole(tier: number, band: Band): 'audience' | 'stronger' | 'weaker' {
  const a = audienceBand(tier);
  if (band === a) return 'audience';
  const order: Band[] = ['new', 'core', 'optimized'];
  return order.indexOf(band) > order.indexOf(a) ? 'stronger' : 'weaker';
}

export type FightKind = 'node' | 'elite' | 'boss';

/**
 * The walk's shape, decided rather than rolled. Each entry is a decision row between the mouth and
 * the core; counts are guaranteed (never a dungeon with no elite, which a per-node roll can and did
 * generate) while `runPlan`'s `offset` rotates them so a generated fold is not always the same map.
 */
const LAYOUT: readonly (readonly FightRow[])[] = [
  ['node', 'elite', 'relay'],
  ['node', 'prize', 'elite', 'relay'],
  ['node', 'relay', 'prize', 'elite', 'node'],
  ['node', 'relay', 'elite', 'prize', 'node', 'node'],
];

export type FightRow = 'node' | 'elite' | 'prize' | 'relay';

export function layoutFor(tier: number, rows?: number, offset = 0): FightRow[] {
  const base = [...LAYOUT[tierIndex(tier)]!];
  const want = Math.max(1, (rows ?? rowsForTier(tier)) - 2);
  const out: FightRow[] = [];
  for (let i = 0; i < want; i++) out.push(base[(i + offset) % base.length]!);
  return out;
}

/**
 * What each kind of fight may take, as a share of one player's field integrity, so the whole walk
 * spends exactly `FUN.runCost`. The distribution is over the *layout*, which is why a longer map
 * is a longer day rather than a slower death.
 */
export function costSplit(tier: number, rows?: number, offset = 0): Record<FightKind, number> {
  const layout = layoutFor(tier, rows, offset);
  const waves = layout.filter((k) => k === 'node').length;
  const elites = layout.filter((k) => k === 'elite').length;
  const unit = FUN.runCost[tierIndex(tier)]! / (waves + FUN.eliteCostK * elites + FUN.bossCostK);
  return {
    node: Math.round(unit * 1000) / 1000,
    elite: Math.round(unit * FUN.eliteCostK * 1000) / 1000,
    boss: Math.round(unit * FUN.bossCostK * 1000) / 1000,
  };
}

export interface NodeBudget {
  kind: FightKind;
  tier: number;
  level: number;
  /** The band this map is cut for — who the health pool and the bite are both tuned to. */
  band: Band;
  /** What that player does per second, which the health pool is made of. */
  dps: number;
  hp: number;
  seconds: number;
  /** The share of the field this fight is allowed to take, and the bite that buys it. */
  costPct: number;
  power: number;
}

/**
 * What a node on this tier should be: the damage its audience does per second, times the seconds we
 * want them spending on it, and the incoming bite that spends the cost budget over exactly that long.
 * Solo sizing, because the party scales it from `party.ts` on the way out — one source for the number,
 * one place that changes it.
 *
 * `level` defaults to the tier's reference level, but a dungeon passes its own gate: EMBER FOUNDRY
 * opens at 2 and THE STORM CORE at 26, and both should be a full-length fight for whoever walks in on
 * the day it opened.
 */
export function nodeBudget(
  tier: number,
  opts: { kind?: FightKind; level?: number; band?: Band; rows?: number; offset?: number; seconds?: number; costPct?: number; archetype?: string } = {},
): NodeBudget {
  const kind = opts.kind ?? 'node';
  const band = opts.band ?? audienceBand(tier);
  const level = opts.level ?? refLevel(tier);
  const dps = dpsProfile(level, band).dps;
  const window = mid(nodeWindow(tier));
  const seconds = opts.seconds ?? (kind === 'boss' ? mid(bossWindow(tier)) : kind === 'elite' ? window * FUN.eliteSecondsK : window);
  const costPct = opts.costPct ?? costSplit(tier, opts.rows, opts.offset)[kind];
  return {
    kind,
    tier,
    level,
    band,
    dps,
    hp: Math.round((dps * seconds) / 50) * 50,
    seconds: Math.round(seconds),
    costPct,
    power: powerForCost({ level, tier, band, kind, seconds, pct: costPct, ...(opts.archetype ? { archetype: opts.archetype } : {}) }),
  };
}

/** A coordinated four-body party's assumed link multiplier, below SF.CROSS_LINK_MAX. */
export const PARTY_LINK = 1.2;

/** The full party, which is the group the windows are sized against as well as the cap. */
export const PARTY_SIZE = 4;

// ---------------------------------------------------------------------------
// The whole walk
// ---------------------------------------------------------------------------

export interface RunPlan {
  tier: number;
  level: number;
  rows: number;
  /** The decision rows between the mouth and the core. */
  layout: FightRow[];
  fights: Record<FightKind, NodeBudget>;
  /** How much integrity a band has left when the core falls, and how long the walk took. */
  walks: Record<Band, Walk>;
}

export interface Walk {
  minutes: number;
  /** Integrity left at the end, as a fraction. Negative means the walk kills this band. */
  arrivesPct: number;
  fights: number;
  /** The worst single fight, as a fraction of the field. */
  worstPct: number;
}

/**
 * Walk the map, fight by fight, and see if the player survives it.
 *
 * This is the arithmetic that replaces "there is a 14% chance of a relay on any node". A relay
 * only matters as part of a sequence — healing to full when you were never hurt is waste — so the
 * only honest reading of a difficulty table is the run itself: subtract each fight, cap each relay,
 * and read what is left at the core.
 */
export function runPlan(tier: number, opts: { rows?: number; offset?: number; level?: number } = {}): RunPlan {
  const rows = opts.rows ?? rowsForTier(tier);
  const level = opts.level ?? refLevel(tier);
  const layout = layoutFor(tier, rows, opts.offset);
  const costs = costSplit(tier, rows, opts.offset);
  const fights: Record<FightKind, NodeBudget> = {
    node: nodeBudget(tier, { kind: 'node', level, rows, costPct: costs.node }),
    elite: nodeBudget(tier, { kind: 'elite', level, rows, costPct: costs.elite }),
    boss: nodeBudget(tier, { kind: 'boss', level, rows, costPct: costs.boss }),
  };
  const walks = {} as Record<Band, Walk>;
  for (const band of ['new', 'core', 'optimized'] as Band[]) {
    walks[band] = walkRun({ level, tier, band, layout, fights });
  }
  return { tier, level, rows, layout, fights, walks };
}

function walkRun(args: {
  level: number;
  tier: number;
  band: Band;
  layout: FightRow[];
  fights: Record<FightKind, NodeBudget>;
  partySize?: number;
}): Walk {
  const size = Math.max(1, Math.round(args.partySize ?? 1));
  const dps = expectedDps(args.level, args.band, size, size > 1 ? PARTY_LINK : 1);
  let hp = 1;
  // `layout` is the decision rows only; the mouth and the core are walked too, so a route crosses
  // layout.length + 1 gaps. Travel is priced once here and never again per fight.
  let seconds = FUN.travelSeconds * (args.layout.length + 1);
  let fightCount = 0;
  let worst = 0;
  for (const row of [...args.layout, 'boss' as FightRow]) {
    if (row === 'relay') {
      hp = Math.min(1, hp + FUN.relayPct);
      continue;
    }
    if (row === 'prize') continue;
    const kind = row as FightKind;
    const budget = args.fights[kind];
    const hpTotal = budget.hp * partyHpScale(size, kind === 'boss' ? 'boss' : 'node');
    const fight = ttkSeconds(hpTotal, dps);
    seconds += fight;
    const cost = attritionFor({
      level: args.level,
      tier: args.tier,
      band: args.band,
      kind,
      seconds: fight,
      power: budget.power,
      partySize: size,
    }).pct;
    hp -= cost;
    fightCount++;
    worst = Math.max(worst, cost);
  }
  return { minutes: Math.round((seconds / 60) * 10) / 10, arrivesPct: Math.round(hp * 100) / 100, fights: fightCount, worstPct: Math.round(worst * 1000) / 1000 };
}

/** The same walk with four bodies on it. */
export function partyRun(plan: RunPlan, band: Band = 'core', size = PARTY_SIZE): Walk {
  return walkRun({ level: plan.level, tier: plan.tier, band, layout: plan.layout, fights: plan.fights, partySize: size });
}

// ---------------------------------------------------------------------------
// What the report prints
// ---------------------------------------------------------------------------

/**
 * One tier's map, read by every band. HP and bite are fixed at the tier's audience — the map the
 * designer actually ships — so a weaker player is measured as *taking longer and paying more* rather
 * than being handed a smaller monster, and a stronger one as taking less. Re-sizing content per band
 * would make the table measure the re-sizing, which is how the first version of this report ended up
 * identical in all three columns.
 */
export interface PacingRow {
  tier: number;
  band: Band;
  /** Whether this band is the one the map was cut for, stronger than it, or weaker. */
  role: 'audience' | 'stronger' | 'weaker';
  level: number;
  rows: number;
  dps: number;
  nodeHp: number;
  nodeSeconds: number;
  bossHp: number;
  bossSeconds: number;
  nodeCostPct: number;
  /** Program cycles the audience's own brief allows, which is how a length reads on screen. */
  nodeCycles: number;
  nodesBeforeDown: number;
  minutes: number;
  arrivesPct: number;
  partySeconds: number;
  partyArrivesPct: number;
}

export function pacingRow(tier: number, band: Band, opts: { rows?: number; offset?: number; level?: number } = {}): PacingRow {
  const plan = runPlan(tier, opts);
  const node = plan.fights.node;
  const boss = plan.fights.boss;
  const dps = dpsProfile(plan.level, band).dps;
  const walk = plan.walks[band];
  const four = partyRun(plan, band);
  const nodeSeconds = ttkSeconds(node.hp, dps);
  const cost = attritionFor({ level: plan.level, tier, band, kind: 'node', seconds: nodeSeconds, power: node.power });
  return {
    tier,
    band,
    role: bandRole(tier, band),
    level: plan.level,
    rows: plan.rows,
    dps,
    nodeHp: node.hp,
    nodeSeconds: Math.round(nodeSeconds),
    bossHp: boss.hp,
    bossSeconds: Math.round(ttkSeconds(boss.hp, dps)),
    nodeCostPct: cost.pct,
    nodeCycles: Math.round((nodeSeconds / dpsProfile(plan.level, band).cycleSeconds) * 10) / 10,
    nodesBeforeDown: Math.floor(1 / Math.max(0.01, cost.pct)),
    minutes: walk.minutes,
    arrivesPct: walk.arrivesPct,
    partySeconds: Math.round(ttkSeconds(node.hp * partyHpScale(PARTY_SIZE, 'node'), expectedDps(plan.level, band, PARTY_SIZE, PARTY_LINK))),
    partyArrivesPct: four.arrivesPct,
  };
}

export function pacingReport(bands: readonly Band[] = ['new', 'core', 'optimized'], tiers: readonly number[] = [1, 2, 3, 4]): PacingRow[] {
  const out: PacingRow[] = [];
  for (const tier of tiers) {
    for (const band of bands) out.push(pacingRow(tier, band));
  }
  return out;
}

export function funSpread(tier: number, opts: { rows?: number; offset?: number; level?: number } = {}): PacingRow[] {
  return (['new', 'core', 'optimized'] as Band[]).map((band) => pacingRow(tier, band, opts));
}

/**
 * Does the curve hold?
 *
 * A failure is only ever something the *map* got wrong, so every hard check below is against the
 * tier's own audience: a node that outstays its window, a walk that reads as one long health bar, a
 * run that kills the player it was cut for or leaves them untouched, and a party that is slower per
 * body than a solo player — the alt-queue signature, and the reason `party.ts` exists.
 *
 * What a *different* band does on that same map is not a failure, it is a finding, and it goes in
 * `reads` instead: a veteran steamrolling EMBER FOUNDRY is the reward for being a veteran, and a
 * newcomer face-down in PRISM VAULT is the game saying that the dodge matters as much as the level.
 * Reporting those two as bugs is how a difficulty table ends up tuned for nobody.
 */
export function pacingVerdicts(rows: PacingRow[] = pacingReport()): { ok: boolean; notes: string[]; reads: string[] } {
  const notes: string[] = [];
  const reads: string[] = [];
  for (const r of rows) {
    const [lo, hi] = nodeWindow(r.tier);
    const [rlo, rhi] = runWindow(r.tier);
    const partyOk = r.partySeconds <= r.nodeSeconds;
    if (!partyOk) notes.push(`T${r.tier} ${r.band}: a four-man party is slower than solo (${r.partySeconds}s vs ${r.nodeSeconds}s)`);
    if (r.role === 'weaker') {
      // A map cut for a stronger band is not mis-sized because a weaker player suffers in it — that
      // is what the cut means. But the suffering has to be named, because it is the one thing the
      // level gate cannot promise: the gate says you are level 12, not that your deck can hold 12.
      if (r.nodeSeconds > hi * 2) {
        reads.push(`T${r.tier} ${r.band}: a node is ${r.nodeSeconds}s for them (${hi}s window) — they can reach the gate and still not clear the fold`);
      }
      if (r.arrivesPct < 0) reads.push(`T${r.tier} ${r.band}: dies on the walk (${Math.round(r.arrivesPct * 100)}%) — the gate asks for the dodge, not only the level`);
      continue;
    }
    if (r.role === 'stronger') {
      if (r.bossSeconds < 45) reads.push(`T${r.tier} ${r.band}: the core falls in ${r.bossSeconds}s — a back-run here is a warm-up, not a fight`);
      if (r.arrivesPct > 0.85) reads.push(`T${r.tier} ${r.band}: arrives at ${Math.round(r.arrivesPct * 100)}% — this map's volleys are not what pressures them`);
      continue;
    }
    if (r.nodeSeconds < lo || r.nodeSeconds > hi) notes.push(`T${r.tier} ${r.band}: node fight ${r.nodeSeconds}s outside its own ${lo}-${hi}s window`);
    if (r.nodeSeconds > hi * 2) notes.push(`T${r.tier} ${r.band}: node fight ${r.nodeSeconds}s is a health bar, not a fight`);
    if (r.minutes < rlo || r.minutes > rhi) notes.push(`T${r.tier} ${r.band}: run is ${r.minutes}min, outside ${rlo}-${rhi}min`);
    if (r.minutes > rhi * 1.5) notes.push(`T${r.tier} ${r.band}: run is ${r.minutes}min for a ${rhi}min dungeon`);
    if (r.arrivesPct < 0.02) notes.push(`T${r.tier} ${r.band}: the map kills its own audience (${r.arrivesPct} left) with ${r.rows - 2} relays on the path`);
    if (r.arrivesPct > 0.85) notes.push(`T${r.tier} ${r.band}: arrives at ${Math.round(r.arrivesPct * 100)}% — attrition is decorative where it was cut`);
    if (r.nodeCostPct < 0.04) notes.push(`T${r.tier} ${r.band}: a node costs ${(r.nodeCostPct * 100) | 0}% — HP is the only knob left`);
    if (r.nodesBeforeDown > 12) notes.push(`T${r.tier} ${r.band}: ${r.nodesBeforeDown} nodes per full field`);
  }
  return { ok: notes.length === 0, notes, reads };
}
