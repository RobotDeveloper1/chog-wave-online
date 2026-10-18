import type { Element } from './types.ts';
import { CARD_BY_ID } from './cards.ts';
import { DUNGEONS } from './dungeonData.ts';

/**
 * Player progression.
 *
 * Before this, the only number that grew was `kills`, and the only thing it changed
 * was a sqrt-curve badge on the leaderboard. That is not an MMO loop: nothing you do
 * between fights makes the next fight feel different. XP is now the spine, and it is
 * earned by everything the game actually offers — clears, Data Area rooms, quests and
 * first-time trait sightings — so a player who explores levels faster than one who
 * only grinds boss damage.
 *
 * Levels buy *room*, not raw numbers: extra queue slots, deeper Data Areas, a second laser
 * charge, and from level 22 onward a licence for one more Mega or Giga card in the Deck. The
 * six attributes stay exactly what the build formula decided, so the NFT still owns the Chog's
 * ceiling — a low-level token holder can out-damage a level 40 foster player. But the deck is
 * what turns those attributes into damage per program, and that is what the ladder hands out.
 *
 * The rule the ladder obeys: every rung has to be felt as a different fight, not a bigger number.
 * A licence is felt because the best cards in the collection suddenly fit; a faster charge is felt
 * because more programs land inside the same volley. Nothing a level buys stops being true at 20 —
 * which is the hole this file used to have, and why the curve below runs to the cap.
 */

export const LEVEL_CAP = 50;

/** Cumulative XP required to *reach* a level. Level 1 is free. */
export function xpToLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(28 * Math.pow(level - 1, 1.6));
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (level < LEVEL_CAP && xp >= xpToLevel(level + 1)) level += 1;
  return level;
}

export interface LevelProgress {
  level: number;
  /** XP banked inside the current level. */
  into: number;
  /** XP needed to leave the current level. */
  need: number;
  pct: number;
  toCap: number;
}

export function progressOf(xp: number): LevelProgress {
  const level = levelFromXp(xp);
  const floor = xpToLevel(level);
  const ceil = level >= LEVEL_CAP ? floor : xpToLevel(level + 1);
  const span = Math.max(1, ceil - floor);
  const into = Math.max(0, xp - floor);
  return {
    level,
    into: level >= LEVEL_CAP ? 0 : into,
    need: level >= LEVEL_CAP ? 0 : span,
    pct: level >= LEVEL_CAP ? 1 : Math.min(1, into / span),
    toCap: Math.max(0, xpToLevel(LEVEL_CAP) - xp),
  };
}

// ---------------------------------------------------------------------------
// What earns XP
// ---------------------------------------------------------------------------

export type ClearTier = 'glitch' | 'anomaly' | 'storm' | 'ambient';

/** Per-tier bands. Damage only tips the scale inside a band, so card-spam cannot farm. */
const CLEAR_BASE: Record<ClearTier, number> = { ambient: 6, glitch: 26, anomaly: 55, storm: 96 };

/** `scale` is the party's own multiplier (`partyRewardScale`); the alt-split tax lives there now. */
export function xpForClear(tier: ClearTier, damage = 0, scale = 1): number {
  const base = CLEAR_BASE[tier] ?? CLEAR_BASE.glitch;
  const bonus = Math.min(0.5, damage / 40_000);
  return Math.round(base * (1 + bonus) * scale);
}

export function xpForRoom(areaTier: number): number {
  return 8 + areaTier * 5;
}

export function xpForQuest(stars: 1 | 2 | 3): number {
  return [0, 30, 70, 130][stars] ?? 30;
}

/**
 * A trait value you had never seen before. Deliberately small: the Album is a reason
 * to meet people, not a way to level by existing. A new holder logging its own 13
 * values should land around level 2 — the first gates are meant to be earned fighting.
 */
export function xpForSighting(rare: boolean): number {
  return rare ? 3 : 2;
}

// ---------------------------------------------------------------------------
// What levels buy
// ---------------------------------------------------------------------------

export interface Unlocks {
  /** Hand queue length — how much program you can bank before firing. */
  queueSlots: number;
  /** Highest Data Area tier you may enter. */
  areaTier: number;
  /** Stored laser-eyes charges. */
  laserCharges: number;
  /** Cards the bag can hold. */
  bagCap: number;
  /** Charge cooldown multiplier, applied to CHARGE_MS. */
  chargeScale: number;
  /** Battle field hit points. */
  fieldHp: number;
  /** Extra Mega slots on top of the deck shape the Chog was born with. */
  megaSlots: number;
  /** Extra Giga slots, same. */
  gigaSlots: number;
  /** Extra fused (GA) slots, same. These are the Library's payout, so they get their own rung. */
  fusedSlots: number;
  /** Next thing that unlocks, for the menu to say it plainly. */
  next: string | null;
}

/** The deck licences progression hands out, in the shape `deck.ts` adds them on in. */
export interface DeckLicence {
  mega: number;
  giga: number;
  fused: number;
}

export type UnlockKind = 'hand' | 'dungeon' | 'laser' | 'charge' | 'bag' | 'build';

export interface Gate {
  at: number;
  kind: UnlockKind;
  /** What the level-up banner and the career page say, in the player's words. */
  label: string;
  /** One more line: why it matters. */
  detail: string;
  apply?: (u: Unlocks) => void;
}

/**
 * The ladder, in level order. Every rung is something the player can *feel* in the next
 * ten minutes — a longer program, a new district, a deeper fold, a card that finally fits —
 * and the early ones come fast: the first three arrive inside the first hour, the first
 * district gate at level 4.
 *
 * The hand stops growing at 14: the Hand is a 3x2 panel, so six cards is the whole
 * panel and `QUEUE_MAX` is the ceiling, not a progression dial. From there the ladder moves to
 * the two levers that still change a fight — how often the charge lets you fire, and how many of
 * your strongest cards the deck may hold — so the curve keeps climbing to the cap instead of
 * flatlining at 20 the way the first version of this file did.
 * Sorted so `next` can be read off the first entry above the level.
 */
const UPGRADES: Gate[] = [
  { at: 2, kind: 'hand', label: 'Hand: 4-card programs', detail: 'one more card in every program you fire', apply: (u) => { u.queueSlots += 1; } },
  { at: 6, kind: 'hand', label: 'Hand: 5-card programs', detail: 'longer programs, bigger fusions', apply: (u) => { u.queueSlots += 1; } },
  { at: 10, kind: 'laser', label: 'Second laser charge', detail: 'store two laser-eyes beams', apply: (u) => { u.laserCharges = 2; } },
  { at: 12, kind: 'bag', label: 'Bigger bag (40)', detail: 'room for eight more cards', apply: (u) => { u.bagCap = 40; } },
  { at: 14, kind: 'hand', label: 'Hand: 6-card programs', detail: 'the whole panel in one program', apply: (u) => { u.queueSlots += 1; } },
  { at: 20, kind: 'charge', label: 'Faster Hand charge', detail: 'the charge fills 12% sooner', apply: (u) => { u.chargeScale = 0.88; } },
  { at: 22, kind: 'build', label: 'Mega licence', detail: 'one more Mega card in the deck', apply: (u) => { u.megaSlots += 1; } },
  { at: 24, kind: 'bag', label: 'Bigger bag (48)', detail: 'room for eight more cards', apply: (u) => { u.bagCap = 48; } },
  { at: 26, kind: 'charge', label: 'Hand charge: 20% sooner', detail: 'the second rung — another program per fight', apply: (u) => { u.chargeScale = 0.80; } },
  { at: 28, kind: 'build', label: 'Giga licence', detail: 'one more Giga card in the deck', apply: (u) => { u.gigaSlots += 1; } },
  { at: 32, kind: 'build', label: 'Fusion licence', detail: 'one more fused GA card in the deck', apply: (u) => { u.fusedSlots += 1; } },
  { at: 36, kind: 'laser', label: 'Third laser charge', detail: 'store three laser-eyes beams', apply: (u) => { u.laserCharges = 3; } },
  { at: 38, kind: 'charge', label: 'Hand charge: 28% sooner', detail: 'the third rung — the clock from level 20 again', apply: (u) => { u.chargeScale = 0.72; } },
  { at: 44, kind: 'build', label: 'Second Mega licence', detail: 'a fourth Mega slot over the born deck', apply: (u) => { u.megaSlots += 1; } },
  { at: 48, kind: 'laser', label: 'Fourth laser charge', detail: 'store four laser-eyes beams', apply: (u) => { u.laserCharges = 4; } },
];

/** A rung for every dungeon, at the level it opens: the career, as a list. */
const DUNGEON_RUNGS: Gate[] = DUNGEONS.map((x) => ({
  at: x.level,
  kind: 'dungeon' as const,
  label: `Dungeon: ${x.name}`,
  // A rung used to say only where the place is (`tagline`). The point of a fixed unlock list is that
  // a player can aim at a card, and they cannot aim at a card nobody named — so the rung says which
  // ones this map hands over, before they go in, exactly as the ladder says what a level gives.
  detail: `${x.tagline} → unlocks ${x.unlocks.map((id) => CARD_BY_ID.get(id)?.name ?? id).join(', ')}`,
  apply: (u: Unlocks) => {
    u.areaTier = Math.max(u.areaTier, x.tier);
  },
}));

export const GATES: readonly Gate[] = [...UPGRADES, ...DUNGEON_RUNGS].sort((a, b) => a.at - b.at);

const BASE: Unlocks = {
  queueSlots: 3,
  areaTier: 0,
  laserCharges: 1,
  bagCap: 32,
  chargeScale: 1,
  fieldHp: 100,
  megaSlots: 0,
  gigaSlots: 0,
  fusedSlots: 0,
  next: null,
};

export function unlocksAt(level: number): Unlocks {
  const u: Unlocks = { ...BASE };
  for (const g of GATES) if (level >= g.at) g.apply?.(u);
  u.fieldHp = 100 + 6 * Math.max(0, level - 1);
  const upcoming = GATES.find((g) => g.at > level);
  u.next = upcoming ? `Lv ${upcoming.at} — ${upcoming.label}` : null;
  return u;
}

/** The deck licences this level has bought, in the shape `deckRules` adds on. */
export function deckLicenceAt(level: number): DeckLicence {
  const u = unlocksAt(level);
  return { mega: u.megaSlots, giga: u.gigaSlots, fused: u.fusedSlots };
}

/** The labels of every rung climbed going from `from` to `to`, for a level-up banner. */
export function gatesBetween(from: number, to: number): string[] {
  return GATES.filter((g) => g.at > from && g.at <= to).map((g) => g.label);
}

/** XP awarded for surviving a Data Area run without dying, by tier. */
export function xpForRun(tier: number, flawless: boolean): number {
  return Math.round((40 + tier * 30) * (flawless ? 1.5 : 1));
}

/**
 * The one place the six attributes and progression meet: level multiplies *nothing*
 * that the formula already decided. It widens what you can do with them — a faster
 * charge, a longer queue, one more slot for the strongest card the deck can hold —
 * and never the power behind a card the Chog was not born with. A designer note more
 * than code, but it is the rule the rest of this file obeys.
 */
export const LEVEL_AFFECTS: readonly string[] = ['queueSlots', 'areaTier', 'laserCharges', 'bagCap', 'chargeScale', 'fieldHp', 'megaSlots', 'gigaSlots', 'fusedSlots'];

/** Element affinity carried by progression: nothing, by design. */
export function elementBias(_level: number): Partial<Record<Element, number>> {
  return {};
}
