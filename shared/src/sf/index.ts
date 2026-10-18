/**
 * The Star Force engine.
 *
 * Everything a duel needs, and nothing it does not. These modules are pure and shared between
 * the server and the client on purpose: the Hand that greys a card out on the player's
 * screen has to be the same Hand the server refuses a program with, and the element
 * chart the HUD draws has to be the one the damage was computed from. When the two can diverge,
 * the player is being cheated — so they cannot.
 *
 * Read them in this order:
 *
 *   1. `element`  — the cycle, and the chain that pays you for repeating an element
 *   2. `card`     — classes, and the verb on the card face
 *   3. `field`    — the panel grid, and how a card aims by where you stand
 *   4. `hand`   — the screen, and everything it refuses
 *   5. `boss`     — the vocabulary of named attacks
 *   6. `stats` · `rank` · `party` · `clock` — the numbers, the grades, the timings
 *   7. `session`  — the authoritative state machine that binds them
 *   8. `view`     — what the client is told, and what it is never asked
 */

export * from './element.ts';
export * from './card.ts';
export * from './field.ts';
export * from './hand.ts';
export * from './boss.ts';
export * from './stats.ts';
export * from './rank.ts';
export * from './party.ts';
export * from './clock.ts';
export * from './view.ts';
export * from './session.ts';
export * from './loadout.ts';
