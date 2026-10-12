import type { Chip, Element } from './types.ts';
import type { SectorId } from './wave.ts';
import type { CollectionVolume } from './anomaly.ts';
import { CHIP_BY_ID } from './chips.ts';

/**
 * The economy: WAV credits, a bag, and two shops that are actually connected to the
 * real market.
 *
 * There was no reason to win a fight until this existed — loot went into a set and
 * the set had no uses. WAV is the sink-and-source that makes the loop close: clears
 * pay, the shop spends, and the shop's *stock and prices move with the collection's
 * real trading volume*. When the floor is hot, chips are expensive and rare stock
 * appears; when it is dead, the dealer is discounting. That is the same signal that
 * opens anomalies, so one real-world event now drives both the danger and the market.
 */

export type ItemId = 'med' | 'repair' | 'amp' | 'ward' | 'scan' | 'pack';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** What it does, in the words the shop shows. */
  desc: string;
  base: number;
  /** Only one can be held in reserve at a time for these. */
  unique: boolean;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  med: { id: 'med', name: 'MED PATCH', desc: 'restore 60 field integrity', base: 40, unique: false },
  repair: { id: 'repair', name: 'REPAIR KIT', desc: 'full field restore, mid-run', base: 90, unique: false },
  amp: { id: 'amp', name: 'SIGNAL AMP', desc: '+25% on your next program', base: 120, unique: true },
  ward: { id: 'ward', name: 'PORTABLE WARD', desc: 'punch through a linked anomaly alone', base: 260, unique: true },
  scan: { id: 'scan', name: 'DEEP SCAN', desc: 'reveal an anomaly archetype and tribe', base: 55, unique: false },
  pack: { id: 'pack', name: 'CHIP PACK', desc: 'three random cards, rarity rolls with the floor', base: 150, unique: false },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export interface Bag {
  wav: number;
  items: Partial<Record<ItemId, number>>;
}

export const STARTING_BAG: Bag = { wav: 120, items: { med: 2 } };

export function emptyBag(wav = 0): Bag {
  return { wav, items: {} };
}

export function itemCount(bag: Bag, id: ItemId): number {
  return bag.items[id] ?? 0;
}

export function addItem(bag: Bag, id: ItemId, n = 1): Bag {
  const items = { ...bag.items };
  items[id] = (items[id] ?? 0) + n;
  return { ...bag, items };
}

export function takeItem(bag: Bag, id: ItemId, n = 1): { bag: Bag; ok: boolean } {
  const have = bag.items[id] ?? 0;
  if (have < n) return { bag, ok: false };
  const items = { ...bag.items };
  const left = have - n;
  if (left > 0) items[id] = left;
  else delete items[id];
  return { bag: { ...bag, items }, ok: true };
}

// ---------------------------------------------------------------------------
// Pricing — the real hook between the market and the shop
// ---------------------------------------------------------------------------

/** Baseline collection turnover this shop is calibrated against, in MON/15min. */
export const VOLUME_NOMINAL_MON = 3_000;

/**
 * 0.75 .. 2.2. Prices and rarity both scale with it, which means a hot floor makes
 * the shop a harder place to profit from — the same direction real supply chains move.
 */
export function priceFactor(volume: Pick<CollectionVolume, 'mon'>): number {
  const ratio = Math.max(0, volume.mon) / VOLUME_NOMINAL_MON;
  return clamp(0.75 + 0.55 * Math.sqrt(ratio), 0.75, 2.2);
}

/** How much richer the stock looks, 0..1, from the same ratio. */
export function rarityBias(volume: Pick<CollectionVolume, 'mon'>): number {
  const ratio = Math.max(0, volume.mon) / VOLUME_NOMINAL_MON;
  return clamp(Math.log10(1 + ratio) * 0.62, 0, 0.85);
}

const CLASS_MULT: Record<NonNullable<Chip['klass']>, number> = { S: 1, M: 1.7, G: 2.6 };

export function chipValue(c: Chip): number {
  // Bleeding the Wave Index is a bonus, so it prices up — but a void card's *negative*
  // drain must not drag the value below its raw damage, which is what happened when
  // the factor was allowed to go sub-zero and every void card hit the floor price.
  const bonus = 1 + Math.max(0, Math.min(8, c.waveDrain)) * 0.12;
  const liability = c.waveDrain < 0 ? 0.9 : 1;
  const raw = c.power * Math.max(1, c.hits) * bonus * liability;
  return Math.round(raw * (CLASS_MULT[c.klass ?? 'S'] ?? 1) * 0.42);
}

export function chipPrice(c: Chip, factor: number): number {
  return Math.max(15, Math.round(chipValue(c) * factor));
}

/** Selling always loses you money — otherwise the shop is an XP machine. */
export function sellPrice(c: Chip): number {
  return Math.max(6, Math.round(chipValue(c) * 0.45));
}

export function itemPrice(def: ItemDef, factor: number): number {
  return Math.max(5, Math.round(def.base * factor));
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export interface ShopLine {
  kind: 'chip' | 'item';
  /** Chip id or ItemId. */
  stockId: string;
  name: string;
  price: number;
  element?: Element;
  klass?: NonNullable<Chip['klass']>;
  desc?: string;
  /** Sold out for the day once bought; the shop is a daily rhythm, not a menu. */
  limited: boolean;
}

export interface Shop {
  id: 'chips' | 'supply';
  name: string;
  /** Rotates on this seed, so the shop refreshes on a schedule the player can learn. */
  seed: number;
  factor: number;
  lines: ShopLine[];
  /** When the stock turns over, for the UI to say so. */
  refreshesIn: string;
}

/** A deterministic 32-bit mixer, so a seed always gives the same shop. */
function mix(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2545ff43) >>> 0;
  x = Math.imul(x ^ (x >>> 7), 0x27d4eb2f) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const SHOP_REFRESH_MS = 6 * 60 * 60 * 1000;

export function shopSeedAt(now: number): number {
  return Math.floor(now / SHOP_REFRESH_MS);
}

export function refreshLabel(now: number): string {
  const left = SHOP_REFRESH_MS - (now % SHOP_REFRESH_MS);
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

/**
 * The chip dealer. Six lines: three commons, two mid, one high roll that only
 * appears when the floor is busy — so the anomaly-driven market is visible as
 * inventory, not just as a number on a ticker.
 */
export function stockForChips(seed: number, volume: Pick<CollectionVolume, 'mon'>, _sector: SectorId): ShopLine[] {
  const factor = priceFactor(volume);
  const bias = rarityBias(volume);
  // Power ordering gives the tiers real meaning instead of a random strong card.
  const ranked = [...CHIP_BY_ID.values()].sort((a, b) => a.power * a.hits - b.power * b.hits);
  const fromBand = (q: number, salt: number): Chip => {
    const center = clamp(Math.round(q * (ranked.length - 1)), 0, ranked.length - 1);
    const spread = Math.max(2, Math.round(ranked.length * 0.11));
    const offset = Math.floor(mix(seed * 31 + salt * 7) * (spread * 2 + 1)) - spread;
    return ranked[clamp(center + offset, 0, ranked.length - 1)]!;
  };
  const lines: ShopLine[] = [];
  const bands = [0.12, 0.28, 0.4, 0.58, 0.72, bias > 0.45 ? 0.95 : 0.82];
  bands.forEach((q, i) => {
    const c = fromBand(Math.min(1, q + bias * 0.15), i);
    lines.push({
      kind: 'chip',
      stockId: c.id,
      name: c.name,
      price: chipPrice(c, factor),
      element: c.element,
      klass: c.klass ?? 'S',
      desc: `${c.power} x${c.hits}${c.effect !== 'none' ? ` ${c.effect}` : ''}`,
      limited: (c.klass ?? 'S') !== 'S',
    });
  });
  return lines;
}

/** The supply counter: fixed catalogue, floating price. */
export function stockForSupply(seed: number, volume: Pick<CollectionVolume, 'mon'>): ShopLine[] {
  const factor = priceFactor(volume);
  return ITEM_IDS.filter((id) => id !== 'pack').map((id, i) => {
    const def = ITEMS[id];
    return {
      kind: 'item' as const,
      stockId: def.id,
      name: def.name,
      price: itemPrice(def, factor * (1 + mix(seed + i) * 0.18)),
      desc: def.desc,
      limited: def.unique,
    };
  });
}

export function makeShops(seed: number, volume: Pick<CollectionVolume, 'mon'>, sector: SectorId, now: number): Shop[] {
  return [
    { id: 'chips', name: 'CHIP SHOP', seed, factor: priceFactor(volume), lines: stockForChips(seed, volume, sector), refreshesIn: refreshLabel(now) },
    { id: 'supply', name: 'SUPPLY COUNTER', seed, factor: priceFactor(volume), lines: stockForSupply(seed, volume), refreshesIn: refreshLabel(now) },
  ];
}

// ---------------------------------------------------------------------------
// Earning
// ---------------------------------------------------------------------------

const WAV_BASE: Record<'ambient' | 'glitch' | 'anomaly' | 'storm', number> = { ambient: 8, glitch: 24, anomaly: 52, storm: 90 };

/**
 * WAV for a clear.
 *
 * `scale` is `partyRewardScale(size, owners)` from `party.ts`. This function used to carry its own
 * pile-on tax (0.85 past three heads, 0.7 past five) while `progress.ts` carried a different one and
 * `tribe.ts` paid a bonus for the same thing — three files pricing the same act, so nobody could say
 * what a party was worth. One table now, and it is the party's.
 */
export function wavForClear(tier: keyof typeof WAV_BASE, scale = 1): number {
  const base = WAV_BASE[tier] ?? WAV_BASE.glitch;
  return Math.round(base * scale);
}

export function wavForRoom(areaTier: number): number {
  return 10 + areaTier * 8;
}

export function wavForChest(areaTier: number, luck = 0.5): number {
  return Math.round((30 + areaTier * 40) * (0.8 + luck * 0.6));
}

/** Selling a Chog's own signature card is not allowed — the token owns it, not you. */
export function canSell(c: Chip, signatureIds: string[]): boolean {
  return !signatureIds.includes(c.id);
}

export type BuyResult = { ok: true; bag: Bag; wav: number; line: ShopLine } | { ok: false; reason: string };

/** Buy a stock line. Chips land wherever the caller wants them; items go in the bag. */
export function buy(line: ShopLine, bag: Bag, ownedChips: string[]): BuyResult {
  if (bag.wav < line.price) return { ok: false, reason: 'not enough WAV' };
  if (line.kind === 'chip' && line.limited && ownedChips.includes(line.stockId)) {
    return { ok: false, reason: 'already carrying that card' };
  }
  if (line.kind === 'item') {
    const def = ITEMS[line.stockId as ItemId];
    if (def?.unique && itemCount(bag, def.id) > 0) return { ok: false, reason: 'already reserved' };
  }
  return { ok: true, bag: { ...bag, wav: bag.wav - line.price }, wav: line.price, line };
}
