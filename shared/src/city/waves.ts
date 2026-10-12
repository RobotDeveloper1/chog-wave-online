import type { Element } from '../types.ts';
import type { ItemId } from '../economy.ts';
import type { SectorId } from '../wave.ts';
import { mulberry32 } from './layout.ts';

/**
 * Mystery Waves: the thing the Visualizer is for.
 *
 * Fragments of the wave that have settled in the street, invisible to the naked eye. Each
 * district has a fixed set of places they surface; each can be caught once a day by each
 * token. What a catch pays is rolled from the token, the wave and the date — so it is the
 * same roll on every server and every retry — and it is shaped by two real things:
 *
 *   - the *element*: a wave tuned to your Chog's own element resonates, and pays half again.
 *     This is the NFT doing something on the street, not in a menu;
 *   - the *heat*: when the district's Wave Index is high the waves are thick, and pay more.
 *     The same market that opens an anomaly makes the streets richer to walk.
 */

export const WAVE_ELEMENTS: readonly Element[] = ['burn', 'frost', 'volt', 'wave', 'prism', 'void'];

export const WAVES_PER_DISTRICT = 18;

/** How far you may be from a wave and still catch it. */
export const WAVE_REACH = 3.2;

export interface WaveRoll {
  wav: number;
  xp: number;
  items: Partial<Record<ItemId, number>>;
  /** Whether it was tuned to the catcher's own element. */
  match: boolean;
}

export interface WaveArgs {
  tokenId: number;
  /** The wave's anchor id. */
  id: string;
  day: number;
  sector: SectorId;
  element: Element;
  /** The catcher's born element. */
  tribe: Element;
  /** The district's Wave Index, 0..120. */
  heat: number;
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function rollWave(a: WaveArgs): WaveRoll {
  const r = mulberry32(hash(`${a.tokenId}:${a.id}:${a.day}`));
  const match = a.element === a.tribe;
  const thick = 1 + Math.min(0.6, Math.max(0, a.heat) / 200);
  const wav = Math.round((6 + r() * 14) * (match ? 1.5 : 1) * thick);
  const roll = r();
  const items: Partial<Record<ItemId, number>> = {};
  if (roll < 0.1) items.med = 1;
  else if (roll < 0.17) items.scan = 1;
  else if (roll < 0.2) items.pack = 1;
  return { wav, xp: match ? 3 : 2, items, match };
}
