import type { ChogBuild, Element } from './types.ts';

/**
 * What a wallet is shown before it picks a Chog.
 *
 * These are the shapes the sign-in endpoints answer with, so they live here rather
 * than in the server: the picker has to draw a card, and a client-side copy of the
 * type would let the two sides drift into a screen that renders `undefined`.
 *
 * The client is not trusted with any of this — it could send a tokenId it does not
 * own, or invent trait values. The cards are read from here, which runs the same
 * `deriveBuild` the world runs at join time, and the join is still checked against
 * ownership separately.
 */

export interface Provenance {
  transferCount: number;
  daysHeld: number;
  mintBlock?: number;
}

export interface HolderCard {
  tokenId: number;
  /** The trait reading the world will use, real or predicted. */
  attributes: Record<string, string>;
  traitsSource: 'real' | 'predicted';
  element: Element;
  /** The `Tier` trait as metadata states it, empty when the reading is predicted. */
  tier: string;
  callsign: string;
  /** Chip grid edge, 3..5 — the always-present measure of how much a Chog can field. */
  linkSlots: number;
  provenance: Provenance;
  /** ms the current holder received this Chog; 0 when the ledger has not seen it. */
  heldSince: number;
  /** ms this token last changed hands; 0 when the ledger has not seen it move. */
  lastSaleTs: number;
  /** Baked atlas URL, or null when this token has no sprite on disk yet. */
  sprite: string | null;
  build: ChogBuild;
}

export interface HoldingsView {
  address: string;
  tokens: HolderCard[];
  /** True once the index has been filled and the provenance pass is finished. */
  ready: boolean;
  /** Tokens the index can answer for, out of the collection's supply. */
  coverage: number;
  /** Provenance rows backfilled so far. */
  history: number;
}
