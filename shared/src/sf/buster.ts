import { clampStat, attackScale } from './stats.ts';

/**
 * The Mega Buster.
 *
 * Star Force's answer to "what do I do while the gauge fills": tap B for a stream of one-point
 * shots, or hold it and let the shot charge for a single hit worth ten of them. It is the whole
 * reason Rapid and Charge are stats at all, and it is why a fight is never dead time — there is
 * always something to be doing with your hands even when your folder is empty.
 *
 * The numbers are chosen so the Buster is *worth using* and never *enough*: at Attack 1 a
 * charged shot is a fifth of a middling card, and at Attack 10 it is a third. It keeps a fight
 * moving between Custom Screens and it never replaces one.
 */

/** Damage of one uncharged shot, before Attack. */
export const RAPID_BASE = 14;
/** What a full charge is worth. Star Force's number, and the reason Attack is the stat it is. */
export const CHARGE_MULTIPLIER = 10;

/** Milliseconds between taps at Rapid 1. */
export const RAPID_COOLDOWN_MS = 240;
/** Milliseconds of holding before a shot is fully charged, at Charge 1. */
export const FULL_CHARGE_MS = 1600;
/**
 * Below this the hold was a twitch, not a charge, and it fires as a tap. Without it a player
 * who meant to dodge and brushed the button loses 1.6 seconds standing still.
 */
export const MIN_CHARGE_MS = 260;

/** How fast the Buster taps. Rapid 10 fires about 1.7 times as often as Rapid 1. */
export function rapidCooldown(rapid: number): number {
  return Math.round(RAPID_COOLDOWN_MS * (1 - (clampStat(rapid) - 1) * 0.045));
}

/** How long a full charge takes. Charge 10 charges in a little under half the time. */
export function chargeMs(charge: number): number {
  return Math.round(FULL_CHARGE_MS * (1 - (clampStat(charge) - 1) * 0.062));
}

/** 0..1 of the charge, which is the ring the HUD draws around the Chog. */
export function chargeFraction(heldMs: number, charge: number): number {
  return Math.max(0, Math.min(1, heldMs / chargeMs(charge)));
}

/** Was this hold long enough to count as a charge rather than a tap? */
export const isCharged = (heldMs: number, charge = 1): boolean => heldMs >= chargeMs(charge);

/**
 * What one Buster shot deals.
 *
 * A charged shot is `CHARGE_MULTIPLIER` times a tap, and both are scaled by Attack — so Attack
 * is the stat that decides whether the Buster is a shaping tool or a real second weapon.
 */
export function busterDamage(charged: boolean, attack: number): number {
  const base = RAPID_BASE * attackScale(attack);
  return Math.max(1, Math.round(charged ? base * CHARGE_MULTIPLIER : base));
}

/**
 * A tap while a charge is already full does nothing but lose the shot: the Buster fires on
 * release, not on press, and holding past full is free. That is the whole contract a player
 * has to learn and it is one sentence.
 */
export interface BusterState {
  /** Milliseconds the button has been held. 0 when it is not. */
  held: number;
  /** A press is distinct from its elapsed time, which legitimately starts at zero. */
  pressed: boolean;
  /** Milliseconds until the Buster will fire again. */
  cooldown: number;
}

export const emptyBuster = (): BusterState => ({ held: 0, pressed: false, cooldown: 0 });

/** Can this Chog fire a tap right now? */
export const canFire = (b: BusterState): boolean => b.cooldown <= 0;
