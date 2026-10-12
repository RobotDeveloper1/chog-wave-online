import { chip } from './chips.ts';
import type { Chip, Element, GridScore, Placement } from './types.ts';

export const key = (r: number, c: number) => `${r},${c}`;

export function cellsOf(p: Placement, size: number): [number, number][] {
  const c = chip(p.chipId);
  const out: [number, number][] = [];
  for (const [dr, dc] of c.shape) {
    const r = p.row + dr;
    const col = p.col + dc;
    if (r < 0 || col < 0 || r >= size || col >= size) return [];
    out.push([r, col]);
  }
  return out;
}

/** The cells a placement covers as a bitmask (`row * size + col`), or 0 when any of it falls off. */
export function cellMask(p: Placement, size: number): number {
  let mask = 0;
  for (const [dr, dc] of chip(p.chipId).shape) {
    const r = p.row + dr;
    const c = p.col + dc;
    if (r < 0 || c < 0 || r >= size || c >= size) return 0;
    mask |= 1 << (r * size + c);
  }
  return mask;
}

/** True when `candidate` lands in bounds without colliding with what is already placed. */
export function fits(placements: Placement[], candidate: Placement, size: number): boolean {
  const mask = cellMask(candidate, size);
  if (!mask) return false;
  let taken = 0;
  for (const p of placements) taken |= cellMask(p, size);
  return (mask & taken) === 0;
}

/** prism resonates with anything; void poisons any mixed adjacency. */
export function resonates(a: Element, b: Element): boolean | null {
  if (a === 'prism' || b === 'prism') return true;
  if (a === 'void' || b === 'void') return a === b ? true : false;
  return a === b;
}

/**
 * What the grid makes of a set of cards: adjacency pays, a clash costs, filling the board pays,
 * and three or more cards is a program rather than a pile. `scoreGrid` and the AUTO search both
 * read the number from here, so the helper cannot rank placements by a formula the game then
 * refuses to pay.
 */
export function gridMultiplier(pairs: number, clash: number, occupied: number, count: number, size: number): number {
  const fillRatio = size === 0 ? 0 : occupied / (size * size);
  return Math.max(
    0.4,
    1 + pairs * 0.18 + fillRatio * 0.5 - clash * 0.12 + (count >= 3 ? 0.1 : 0),
  );
}

export function scoreGrid(placements: Placement[], size = 3): GridScore {
  const cells = placements.map((p) => cellsOf(p, size));
  const owner = new Int8Array(size * size).fill(-1);
  let occupied = 0;

  cells.forEach((list, i) => {
    for (const [r, c] of list) {
      const at = r * size + c;
      if (owner[at] === -1) {
        owner[at] = i;
        occupied++;
      }
    }
  });

  const chips = placements.map((p) => chip(p.chipId));
  const onGrid = placements.map((_, i) => i).filter((i) => cells[i]!.length > 0);
  const placed = onGrid.map((i) => chips[i]!);

  const resonance: Partial<Record<Element, number>> = {};
  let pairs = 0;
  let clash = 0;

  const share = (nAt: number, idx: number): void => {
    const nIdx = owner[nAt];
    if (nIdx === undefined || nIdx < 0 || nIdx === idx) return;
    const a = chips[idx]?.element;
    const b = chips[nIdx]?.element;
    if (!a || !b) return;
    const ok = resonates(a, b);
    if (ok === true) {
      pairs++;
      const e = a === 'prism' ? b : a;
      resonance[e] = (resonance[e] ?? 0) + 1;
    } else if (ok === false) {
      clash++;
    }
  };

  // A card only touches the cards to its right and below it; counting each pair once is what
  // makes an adjacency bonus not depend on the order the cards were dropped.
  for (let at = 0; at < size * size; at++) {
    const idx = owner[at]!;
    if (idx < 0) continue;
    if (at % size + 1 < size) share(at + 1, idx);
    if (at + size < size * size) share(at + size, idx);
  }

  const cellsTotal = size * size;
  const fillRatio = cellsTotal === 0 ? 0 : occupied / cellsTotal;
  const raw = placed.reduce((s, c) => s + c.power * c.hits, 0);
  const hits = placed.reduce((s, c) => s + c.hits, 0);

  const multiplier = gridMultiplier(pairs, clash, occupied, placed.length, size);

  return {
    damage: Math.round(raw * multiplier),
    hits,
    effects: placed.map((c) => c.effect).filter((e) => e !== 'none'),
    resonance,
    fillRatio,
    multiplier: Math.round(multiplier * 100) / 100,
    waveDrain: placed.reduce((s, c) => s + c.waveDrain, 0),
  };
}

/** All placements that fit, used by the client to grey out illegal drops. */
export function legalAnchors(c: Chip, placements: Placement[], size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < size; r++) {
    for (let col = 0; col < size; col++) {
      if (fits(placements, { chipId: c.id, row: r, col }, size)) out.push([r, col]);
    }
  }
  return out;
}
