import { ARMOUR_CAP, CRIT_CAP, clampPct, withTraits, type DuelStats } from './stats.ts';
import type { Element, GearMod, VoiceMod } from '../types.ts';

/**
 * The party.
 *
 * An MMO party, not a power-up list: every seat is a **different Chog**, one of the 1,969, and
 * what that seat gives the fight comes from the traits on the token that filled it. Six players
 * standing on the same tile are not six times one player — they are six *characters*, and the
 * party is as good as the collection that formed it.
 *
 * Two layers, and the split is the whole design:
 *
 *   1. **Your Chog builds you.** Its Head trait is one mechanical step, its Mouth trait is a
 *      set of percentages, its Skin is a resist, its Tier is how many Mega and Giga cards you
 *      may carry, its Body is the shape of your deck. Those are *your* numbers and they come
 *      from the token you brought.
 *   2. **The party builds on distinct traits.** Each seat grants its Head-trait step to the
 *      whole party — but **duplicates do not stack**. Six Chogs in six different hats is six
 *      steps; six Chogs in the same hat is one. That is the rule that makes the breadth of the
 *      collection matter instead of the rarity of one hat, and it is why inviting a friend with
 *      a trait nobody else has is a real decision rather than a headcount.
 *
 * Nothing here is named after anything from another game. The steps say what they do and which
 * Chog granted them, so the plate can read `CHARGE +1 · from #812 Mon Cap`.
 */

export const PARTY_MAX = 6;

/** One body in the party, and the Chog that filled the seat. */
export interface PartySeat {
  /** Body id on the field. */
  id: string;
  /** Wallet. Two seats owned by the same wallet still only pay one share of the loot. */
  owner: string;
  /** Which Chog filled this seat. */
  tokenId: number;
  /** Its callsign, so the plate can name it. */
  name: string;
  element: Element;
  level: number;
  /** The Head trait: one step, granted to the party. */
  gear: GearMod;
  /** The Mouth trait: percentages on this Chog's own numbers. */
  voice: VoiceMod;
  /** The Skin trait: the element this Chog shrugs off. */
  resist?: Element;
  /** Tribe On is already running for this Chog. */
  transformed?: boolean;
}

export interface PartyStep {
  id: string;
  /** The plate. */
  label: string;
  /** One line: what it changes. */
  read: string;
  /** The Chog that granted it. */
  from: { id: string; tokenId: number; name: string };
  apply: (s: DuelStats) => DuelStats;
}

interface StepDef {
  label: string;
  read: string;
  apply: (s: DuelStats) => DuelStats;
}

/**
 * What each Head-trait value is worth.
 *
 * Ordered by how much it changes *how you play* rather than how much damage it adds: an extra
 * slot is a different turn, a faster charge is a different rhythm, and only the armour and crit
 * are plain numbers.
 */
export const GEAR_STEPS: Record<GearMod, StepDef> = {
  charge: {
    label: 'CHARGE +1',
    read: 'the Hand Charge fills faster — more screens per fight',
    apply: (s) => withTraits(s, { charge: s.charge + 1 }),
  },
  slots: {
    label: 'SLOT +1',
    read: 'one more card in a program',
    apply: (s) => withTraits(s, { slots: s.slots + 1 }),
  },
  hp: {
    label: 'HP +15%',
    read: 'a bigger integrity bar — one more volley survived',
    apply: (s) => withTraits(s, { hp: Math.round(s.hp * 1.15) }),
  },
  crit: {
    label: 'CRIT +12%',
    read: 'one card in eight lands for double',
    apply: (s) => withTraits(s, { crit: clampPct(s.crit + 12, CRIT_CAP) }),
  },
  guard: {
    label: 'ARMOUR +10%',
    read: 'a tenth of every volley stopped before it lands',
    apply: (s) => withTraits(s, { armour: clampPct(s.armour + 0.1, ARMOUR_CAP) }),
  },
  drain: {
    label: 'DRAIN +10%',
    read: 'DRAIN cards pay back a tenth more of what they took',
    apply: (s) => withTraits(s, { drain: clampPct(s.drain + 0.1, 1) }),
  },
};

/** The order steps are granted in, so a party can plan which seat it is filling. */
export const GEAR_ORDER: readonly GearMod[] = ['charge', 'slots', 'hp', 'crit', 'guard', 'drain'];

/**
 * The steps the party is running, for one body.
 *
 * Only *other* seats contribute — your own Chog's traits are already in your stats — and only
 * the first Chog wearing each hat counts. Duplicates are deliberately worthless here: the sixth
 * friend is worth something when they brought a trait nobody else did.
 */
export function partySteps(seats: readonly PartySeat[], selfId?: string): PartyStep[] {
  const others = seats.filter((s) => s.id !== selfId);
  const out: PartyStep[] = [];
  for (const gear of GEAR_ORDER) {
    const seat = others.find((s) => s.gear === gear);
    if (!seat) continue;
    const def = GEAR_STEPS[gear];
    out.push({
      id: gear,
      label: def.label,
      read: def.read,
      from: { id: seat.id, tokenId: seat.tokenId, name: seat.name },
      apply: def.apply,
    });
  }
  return out;
}

export function applySteps(s: DuelStats, steps: readonly PartyStep[]): DuelStats {
  let out = s;
  for (const step of steps) out = step.apply(out);
  return out;
}

/** How many distinct traits this party is actually fielding — the number worth bragging about. */
export const partyDepth = (seats: readonly PartySeat[]): number =>
  new Set(seats.map((s) => s.gear)).size;

// ---------------------------------------------------------------------------
// The Mouth trait: percentages on your own numbers
// ---------------------------------------------------------------------------

export interface VoiceStats {
  /** Percent chance a card lands for double. */
  crit: number;
  /** Share of a DRAIN card's damage returned as integrity. */
  drain: number;
  /** Percent off a full charge fill. Negative is slower. */
  chargePct: number;
  /** Negative makes the Chog sneakier; positive pulls the anomaly onto it. */
  aggro: number;
}

/**
 * The Mouth trait bends one Chog's own numbers rather than granting the party a step — the
 * difference between a trait that changes *you* and a trait that changes *us*.
 */
export function voiceStats(v: VoiceMod): VoiceStats {
  return {
    crit: v.critPct ?? 0,
    drain: (v.drainPct ?? 0) / 100,
    chargePct: v.chargePct ?? 0,
    aggro: v.aggro ?? 0,
  };
}

/** What the Mouth trait does to a full charge fill, as a multiplier on its length. */
export const chargeScale = (chargePct: number): number => Math.max(0.5, 1 - chargePct / 100);

/**
 * How hard the anomaly comes for this body.
 *
 * Aggro is the MMO's tank mechanic and it is on the token: a Chog with a loud mouth is the one
 * the boss singles out, which makes a loud Chog genuinely useful to a party and a quiet one
 * genuinely safe. It is the one trait that is a *liability* as often as it is a gift.
 */
export const aggroScore = (aggro: number, distance: number): number => aggro * 6 - distance;

// ---------------------------------------------------------------------------
// The cross-fire: your volley runs into someone else's
// ---------------------------------------------------------------------------

/**
 * How close in time two players' cards have to land to count as one beat.
 *
 * A little over the charge's own rhythm at low level: you are not required to fire in lockstep,
 * only to be firing about the same thing at about the same time.
 */
export const LINK_WINDOW_MS = 1500;

/** The most a link can add. Two partners plus geometry is already at the cap. */
export const CROSS_LINK_MAX = 1.32;
const PER_PARTNER = 0.1;
const ADJACENT_BONUS = 0.05;
const HARMONY_BONUS = 0.07;

export interface Volley {
  id: string;
  element: Element;
  /** Millisecond timestamp it landed, in session time. */
  at: number;
  file: number;
}

export interface CrossLink {
  /** Partner ids whose volley counted, never including the asker. */
  partners: string[];
  /** At least one partner fired the same element you did. */
  sameElement: boolean;
  /** A partner is on a neighbouring file. */
  adjacent: boolean;
  /** Every member on the field is fielding this element. */
  harmony: boolean;
  mult: number;
  tag: string | null;
}

/**
 * The party's answer to the element chain: not your own run of cards, but the group's.
 *
 * A solo Chog extends a chain by repeating its own element. Here a partner's volley joins yours
 * when it landed inside the window and carried the same element — so same-element folders are
 * the ask, and the pay-off lands in the same slot as a counter, which is what makes a
 * coordinated party visibly outscore six strangers who happened to be standing in one room.
 */
export function crossLink(args: {
  self: { id: string; element: Element; file: number };
  now: number;
  recent: readonly Volley[];
  party?: readonly string[];
}): CrossLink {
  const party = args.party ?? [];
  const inWindow = args.recent.filter(
    (v) => v.id !== args.self.id && args.now - v.at <= LINK_WINDOW_MS && args.now - v.at >= 0,
  );
  const partners = [...new Set(inWindow.filter((v) => v.element === args.self.element).map((v) => v.id))];
  const sameElement = partners.length > 0;
  const adjacent = inWindow.some((v) => Math.abs(v.file - args.self.file) === 1);
  const fielding = new Set(inWindow.map((v) => v.id));
  const harmony =
    party.length >= 2 && sameElement && party.every((m) => m === args.self.id || fielding.has(m));

  let mult = 1 + PER_PARTNER * Math.min(2, partners.length);
  if (adjacent) mult += ADJACENT_BONUS;
  if (harmony) mult += HARMONY_BONUS;
  mult = Math.min(CROSS_LINK_MAX, Math.round(mult * 1000) / 1000);
  return { partners, sameElement, adjacent, harmony, mult, tag: linkTag(mult, sameElement) };
}

/** The word that goes over the player's head. Three bands, so it reads at a glance. */
export function linkTag(mult: number, sameElement: boolean): string | null {
  if (!sameElement || mult <= 1) return null;
  if (mult >= CROSS_LINK_MAX) return 'HARMONY LINK';
  if (mult >= 1.2) return 'CROSS-LINK';
  return 'LINK';
}

// ---------------------------------------------------------------------------
// Cover: pulling somebody back up while the fight is still on
// ---------------------------------------------------------------------------

/** Seconds you must stand beside a downed partner, holding your own fire to do it. */
export const REVIVE_HOLD_MS = 2000;
/** How much of their integrity comes back. Enough to keep playing, not enough to be free. */
export const REVIVE_PCT = 0.4;
/** Files away a rescuer may be. One: you have to be next to them, which is the exposure. */
export const REVIVE_REACH = 1;

export type ReviveReason = 'solo' | 'not-down' | 'out-of-reach' | 'same-file' | 'rescuer-down';

export function canRevive(args: {
  partySize: number;
  downed: { file: number; alive: boolean };
  rescuer: { file: number; alive: boolean };
}): { ok: boolean; reason?: ReviveReason } {
  if (args.partySize < 2) return { ok: false, reason: 'solo' };
  if (args.downed.alive) return { ok: false, reason: 'not-down' };
  if (!args.rescuer.alive) return { ok: false, reason: 'rescuer-down' };
  const gap = Math.abs(args.rescuer.file - args.downed.file);
  if (gap === 0) return { ok: false, reason: 'same-file' };
  if (gap > REVIVE_REACH) return { ok: false, reason: 'out-of-reach' };
  return { ok: true };
}

/** 0..1 of the hold. The client draws the ring from it; the server decides with it. */
export const reviveFraction = (heldMs: number): number => Math.max(0, Math.min(1, heldMs / REVIVE_HOLD_MS));

export const revivedHp = (maxHp: number): number => Math.max(1, Math.round(maxHp * REVIVE_PCT));

/**
 * How long a downed body can wait before the run loses it.
 *
 * Long enough that a partner who was mid-volley can get across a file and finish the hold; short
 * enough that going down in a boss core is an emergency rather than a taxi ride.
 */
export const DOWN_GRACE_MS = 12_000;

/**
 * What the anomaly is owed for standing next to a body that is down.
 *
 * A party that keeps reviving is a party that keeps *fighting*, so the cost of a downed Chog is
 * paid in attention rather than in a wipe: the boss keeps coming, and somebody has to choose
 * between the hold and the dodge.
 */
export const COVER_EXPOSURE = 1;
