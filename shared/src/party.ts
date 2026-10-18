import type { Element } from './types.ts';

/**
 * The party, in numbers.
 *
 * Before this file, a party was a chat channel plus one hard gate: a storm anomaly could not
 * be hurt unless two linked players stood in adjacent files. Everything else — node health,
 * incoming damage, XP, drops — was written for exactly one player, so grouping four people
 * melted a Data Area four times faster for the same loot. A party that only ever *removes*
 * difficulty and never pays for it is a party nobody forms on purpose.
 *
 * So this decides three things and nothing else: how much bigger the fight gets when more
 * bodies arrive, what those bodies earn for it, and which two things standing next to each
 * other makes possible that standing alone does not (a cross-link, and pulling someone back
 * up under fire). Those two are the mechanics; the scaling only exists to keep them
 * interesting rather than ceremonial.
 *
 * Pure, integer-or-simple-float, no clocks of its own: every function is handed `now`, so the
 * server can simulate it authoritatively and the client can predict the same numbers.
 */

export const PARTY_MAX = 4;

/** Which half of the fight the scaling is being asked about. */
export type ScaleKind = 'node' | 'boss';

/**
 * Health of a wave, elite or boss versus how many players are on it.
 *
 * Trash (`node`) grows sub-linearly — `size ** 0.9`, so four players clear a wave in about
 * 87% of the solo time. That is deliberate: a group should feel fast on the small stuff, and
 * a room of four people waiting on one mob's health bar is four people not playing.
 *
 * Bosses go the other way (`size ** 1.18`, so a four-man core has ~5x the health and takes
 * ~28% longer than a solo core). Long boss fights are the only place the party mechanics have
 * time to fire — a cross-link needs a partner's volley inside the window, a revive needs two
 * seconds of cover, a pincer needs the fight to last past its first phase. Scaling a boss down
 * with the trash would delete the reason to bring four.
 */
export function partyHpScale(size: number, kind: ScaleKind = 'node'): number {
  const n = Math.max(1, Math.min(PARTY_MAX, Math.round(size)));
  if (n === 1) return 1;
  return kind === 'boss' ? round2(n ** 1.18) : round2(n ** 0.9);
}

/**
 * What the enemies hit back with, per body. The health pool grows faster than this, which is
 * the whole "bring a friend" fantasy: a four-man party takes about twice the incoming damage
 * in total against four times the hit points, so individually it feels *safer*, and that gap
 * is what a revive and a pincer are spent on.
 */
export function partyPowerScale(size: number): number {
  const n = Math.max(1, Math.min(PARTY_MAX, Math.round(size)));
  return round2(n ** 0.5);
}

/**
 * What each member earns, as a multiple of the solo payout for the same node.
 *
 * The group bonus counts *distinct owners*, not members. Bodies past the first from one wallet
 * are a convenience, not a second human, so they are worth `ALT_WEIGHT` of a person — which
 * keeps the invariant the design lives on: four boxes farmed by one player do not progress any
 * faster, per account, than that player logging in and playing one of them.
 *
 * A real four-human party earns 1.48 each for a fight that lasts about the same solo time,
 * which is the entire difference between a party being the fast way to play and being a tax.
 *
 * `owners` is the number of separate token holders in the party; the server knows this and the
 * client cannot invent it.
 */
export const GROUP_BONUS = 0.16;
export const ALT_WEIGHT = 0.35;

export function partyRewardScale(size: number, owners: number): number {
  const n = Math.max(1, Math.min(PARTY_MAX, Math.round(size)));
  const humans = Math.max(1, Math.min(n, Math.floor(owners)));
  if (n === 1) return 1;
  const effective = humans + ALT_WEIGHT * (n - humans);
  return round3((1 + GROUP_BONUS * (effective - 1)) * (1 - BODY_TAX * ((n - humans) / n)));
}

/** What each extra body from an owner you already counted costs, as a fraction. */
const BODY_TAX = 0.25;

// ---------------------------------------------------------------------------
// Formation: where the party is standing
// ---------------------------------------------------------------------------

export interface Formation {
  /** Files (0..2) at least one member occupies, de-duplicated and sorted. */
  files: number[];
  /** Any two members on neighbouring files. This is what drops a Link ward. */
  adjacent: boolean;
  /** Members placed somewhere, including solo. */
  count: number;
}

/**
 * Read the party's shape off the files it occupies. Accepts a map of member -> file or a plain
 * list of files; either way, unplaced members (a menu, a downed body waiting for cover) are
 * ignored rather than guessed at.
 */
export function formation(cols: ReadonlyMap<string, number> | Iterable<number>): Formation {
  const list = cols instanceof Map ? [...cols.values()] : [...cols];
  const placed = list.filter((c) => Number.isFinite(c));
  const files = [...new Set(placed)].sort((a, b) => a - b);
  let adjacent = false;
  for (const a of placed) {
    for (const b of placed) if (a !== b && Math.abs(a - b) === 1) adjacent = true;
  }
  return { files, adjacent, count: placed.length };
}

/** The Link ward comes down when two linked players stand on neighbouring files. */
export function wardBroken(cols: ReadonlyMap<string, number> | Iterable<number>): boolean {
  return formation(cols).adjacent;
}

/**
 * Files covered, then damage bonus.
 *
 * The tension is the point. `wardBroken` pays you for standing *together* on adjacent files;
 * the pincer pays for *spreading* across all three so the anomaly is covered on every beat.
 * A two-person party has to choose which one it wants on each pull, and a three-person party
 * can have both — which is the concrete reason the third and fourth seats are worth asking
 * someone to fill.
 */
export function pincerBonus(cols: ReadonlyMap<string, number> | Iterable<number>): number {
  const files = formation(cols).files;
  if (files.length >= 3) return 1.12;
  if (files.length === 2) return 1.05;
  return 1;
}

// ---------------------------------------------------------------------------
// The cross-link: your chain runs into someone else's
// ---------------------------------------------------------------------------

/**
 * How close in time two volleys have to land to count as one beat. 1500 ms is a little over
 * the charge's own rhythm at low levels: you are not required to fire in lockstep, only to be
 * firing about the same thing at about the same time.
 */
export const LINK_WINDOW_MS = 1500;

/** The most a cross-link can add. Two partners plus geometry is already at the cap. */
export const CROSS_LINK_MAX = 1.32;
const PER_PARTNER = 0.1;
const ADJACENT_BONUS = 0.05;
const HARMONY_BONUS = 0.07;

export interface Volley {
  /** Who fired it. */
  id: string;
  element: Element;
  /** Millisecond timestamp it landed. */
  at: number;
  col: number;
}

export interface CrossLink {
  /** Partner ids whose volley counts, never including the asker. */
  partners: string[];
  /** At least one partner fired the same element you did. */
  sameElement: boolean;
  /** A partner is on a neighbouring file. */
  adjacent: boolean;
  /** Every file is held by the party, which is what makes the link land. */
  enveloped: boolean;
  /** All members on the field are fielding this element. */
  harmony: boolean;
  mult: number;
  tag: string | null;
}

/**
 * The party's answer to the element chain: not your own run of cards, but the party's.
 *
 * A solo Chog extends a chain by repeating its own tribe. Here, a volley joins yours when a
 * partner's landed inside the window and carried the same element — the resonance the link
 * grid already measures between two cards sitting next to each other, now measured between two
 * players. Same-element decks are the ask, and the pay-off is a multiplier that lands in the
 * same slot as a crit, so a coordinated party visibly outscores four strangers who happened
 * to be in the room.
 *
 * `party` is the whole member list, so "everybody fielding this element" is decidable from the
 * recent volleys alone; a member who has not fired inside the window is not fielding anything.
 */
export function crossLink(args: {
  self: { id: string; element: Element; col: number };
  now: number;
  recent: readonly Volley[];
  party?: readonly string[];
}): CrossLink {
  const party = args.party ?? [];
  const bodies = Math.max(1, party.length);
  const inWindow = args.recent.filter(
    (v) => v.id !== args.self.id && args.now - v.at <= LINK_WINDOW_MS && args.now - v.at >= 0,
  );

  const partners = [...new Set(inWindow.filter((v) => v.element === args.self.element).map((v) => v.id))];
  const sameElement = partners.length > 0;

  const mine = args.self.col;
  const adjacent = inWindow.some((v) => Math.abs(v.col - mine) === 1);

  const files = new Set<number>([mine, ...inWindow.map((v) => v.col)]);
  const enveloped = files.size >= 3;

  const fielding = new Set(inWindow.map((v) => v.id));
  const harmony =
    bodies >= 2 &&
    sameElement &&
    [...(party.length ? party : [...partners, args.self.id])].every((m) => m === args.self.id || fielding.has(m));

  let mult = 1 + PER_PARTNER * Math.min(2, partners.length);
  if (adjacent) mult += ADJACENT_BONUS;
  if (harmony) mult += HARMONY_BONUS;
  mult = Math.min(CROSS_LINK_MAX, round3(mult));

  return { partners, sameElement, adjacent, enveloped, harmony, mult, tag: linkTag(mult, sameElement) };
}

/** The word that goes over the player's head. Kept to three bands so it reads at a glance. */
export function linkTag(mult: number, sameElement: boolean): string | null {
  if (!sameElement || mult <= 1) return null;
  if (mult >= CROSS_LINK_MAX) return 'HARMONY LINK';
  if (mult >= 1.2) return 'CROSS-LINK';
  return 'LINK';
}

// ---------------------------------------------------------------------------
// Cover: pulling someone back up while the fight is still on
// ---------------------------------------------------------------------------

/** Seconds you must stand beside a downed partner, holding your own fire to do it. */
export const REVIVE_HOLD_MS = 2000;
/** How much of their field integrity comes back. Enough to keep playing, not enough to be free. */
export const REVIVE_PCT = 0.4;
/** Files away a rescuer may be. One: you have to be next to them, which is the exposure. */
export const REVIVE_REACH = 1;

export type ReviveReason = 'solo' | 'not-down' | 'out-of-reach' | 'same-file' | 'rescuer-down';

/**
 * Can `rescuer` start a revive on `downed`? One file away is the whole cost: the rescuer stops
 * shooting to reach them, so a wipe that nobody covers is a wipe the party chose.
 */
export function canRevive(args: {
  partySize: number;
  downed: { col: number; alive: boolean };
  rescuer: { col: number; alive: boolean };
}): { ok: boolean; reason?: ReviveReason } {
  if (args.partySize < 2) return { ok: false, reason: 'solo' };
  if (args.downed.alive) return { ok: false, reason: 'not-down' };
  if (!args.rescuer.alive) return { ok: false, reason: 'rescuer-down' };
  const gap = Math.abs(args.rescuer.col - args.downed.col);
  if (gap === 0) return { ok: false, reason: 'same-file' };
  if (gap > REVIVE_REACH) return { ok: false, reason: 'out-of-reach' };
  return { ok: true };
}

/** 0..1 of the hold. The client draws the ring from this, the server decides with it. */
export function reviveFraction(heldMs: number): number {
  return Math.max(0, Math.min(1, heldMs / REVIVE_HOLD_MS));
}

export function revivedHp(maxHp: number): number {
  return Math.max(1, Math.round(maxHp * REVIVE_PCT));
}

/**
 * How long a downed body can wait before the run loses it. Long enough that a partner who was
 * mid-volley can still get across a file and finish the hold; short enough that going down in a
 * boss core is still an emergency rather than a taxi ride.
 */
export const DOWN_GRACE_MS = 12_000;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
