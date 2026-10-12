import { describe, expect, it } from 'vitest';

import {
  BARON_AT_MON,
  PRICE_CEIL_MON,
  classify,
  hotSector,
  sectorOf,
  volumeOf,
  volumePressure,
  volumeRatio,
  type SaleFact,
} from '../src/anomaly.ts';
import { salePressure } from '../src/wave.ts';

let seq = 0;
function fill(over: Partial<SaleFact> = {}): SaleFact {
  seq += 1;
  return {
    txHash: `0x${seq.toString(16).padStart(64, '0')}`,
    block: 111_655_723 + seq,
    ts: 1_791_500_000_000 + seq * 302,
    tokenId: 842,
    mon: 9_140,
    seller: `0x${'a'.repeat(40)}`,
    buyer: `0x${'b'.repeat(40)}`,
    ...over,
  };
}

const kinds = (fills: SaleFact[], opts?: { baselineMon?: number }) =>
  classify(fills, opts).map((t) => t.archetype);

describe('anomaly archetypes', () => {
  it('fires a spark for an ordinary sale', () => {
    expect(kinds([fill({ mon: 5_000 })])).toEqual(['spark']);
  });

  it('ignores dust transfers that fall under the floor', () => {
    expect(kinds([fill({ mon: 12 })])).toEqual([]);
  });

  it('promotes a p95 sale to a Baron instead of also sparking it', () => {
    const triggers = classify([fill({ mon: BARON_AT_MON })]);
    expect(triggers.map((t) => t.archetype)).toEqual(['baron']);
    expect(triggers[0]!.hp).toBeGreaterThan(30_000);
  });

  it('turns a burst of separate sales into one Front, not N sparks', () => {
    const base = 111_655_723;
    const burst = [0, 8, 16].map((d) => fill({ block: base + d, mon: 5_000 }));
    expect(kinds(burst)).toEqual(['front']);
  });

  it('leaves sales too far apart out of the Front window', () => {
    const base = 111_655_723;
    const spread = [0, 90, 180].map((d) => fill({ block: base + d, mon: 5_000 }));
    expect(kinds(spread)).toEqual(['spark', 'spark', 'spark']);
  });

  it('reads a two-way counterparty pair as a Mirror', () => {
    const A = '0x' + 'c'.repeat(40);
    const B = '0x' + 'd'.repeat(40);
    const pair = [0, 1, 2].map((i) =>
      fill({
        mon: 5_000,
        block: 111_655_723 + i * 5,
        seller: i % 2 ? A : B,
        buyer: i % 2 ? B : A,
      }),
    );
    // Three round-trips would be a Front on volume alone; the fraud signal wins.
    expect(kinds(pair)).toEqual(['mirror']);
  });

  it('does not call a repeat customer a wash trader', () => {
    const A = '0x' + 'c'.repeat(40);
    const B = '0x' + 'd'.repeat(40);
    const oneWay = [0, 1, 2].map((i) =>
      fill({ mon: 5_000, block: 111_655_723 + i * 5, seller: A, buyer: B }),
    );
    expect(kinds(oneWay)).not.toContain('mirror');
  });

  it('claims a Baron inside a wash pattern as a Mirror', () => {
    const A = '0x' + 'c'.repeat(40);
    const B = '0x' + 'd'.repeat(40);
    const trio = [0, 1, 2].map((i) =>
      fill({
        mon: 40_000,
        block: 111_655_723 + i * 5,
        seller: i % 2 ? A : B,
        buyer: i % 2 ? B : A,
      }),
    );
    expect(kinds(trio)).toEqual(['mirror']);
  });

  it('stays silent on Surge until a real baseline exists', () => {
    const busy = Array.from({ length: 2 }, () => fill({ mon: 12_000 }));
    expect(kinds(busy)).toEqual(['spark', 'spark']);
    expect(kinds(busy, { baselineMon: 1_000 })).toContain('surge');
  });

  it('caps how much of a Surge one wallet can buy', () => {
    const whale = fill({ mon: PRICE_CEIL_MON, buyer: '0x' + 'e'.repeat(40) });
    const sameWhale = fill({ mon: PRICE_CEIL_MON, buyer: '0x' + 'e'.repeat(40) });
    const triggers = classify([whale, sameWhale], { baselineMon: 1 });
    const surge = triggers.find((t) => t.archetype === 'surge');
    // ADDRESS_CAP_MON is 25k and each fill is 20k: the second is refused entirely.
    expect(surge?.weight).toBeLessThanOrEqual(25_000);
  });

  it('routes a sale to the sector its token id falls in', () => {
    const t = classify([fill({ tokenId: 3 })])[0]!;
    expect(t.sector).toBe(sectorOf(3));
  });

  it('puts every trigger on a tx the HUD can link', () => {
    for (const trigger of classify([fill({ mon: 5_000 }), fill({ mon: 20_000 })])) {
      expect(trigger.cause[0]!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(trigger.label).toContain('MON');
    }
  });
});

describe('collection volume', () => {
  it('aggregates the whole window, not one sale', () => {
    const v = volumeOf([
      fill({ mon: 5_000, tokenId: 1 }),
      fill({ mon: 7_000, tokenId: 2 }),
      fill({ mon: 9_000, tokenId: 3 }),
    ]);
    expect(v.mon).toBe(21_000);
    expect(v.trades).toBe(3);
    expect(v.tokens).toBe(3);
    // The fixture reuses one counterparty pair, so three trades is still two
    // wallets. Distinct parties are counted, not counted per trade.
    expect(v.wallets).toBe(2);
  });

  it('puts all of the money in the one city, whichever token it was spent on', () => {
    const v = volumeOf([
      fill({ mon: 4_000, tokenId: 2 }),
      fill({ mon: 4_000, tokenId: 5 }),
      fill({ mon: 1_000, tokenId: 1 }),
    ]);
    expect(v.bySector.ashflat).toBe(9_000);
    expect(hotSector(v)).toBe('ashflat');
  });

  it('is silent at baseline and only charges what is above it', () => {
    const quiet = volumeOf([fill({ mon: 800 })]);
    expect(volumePressure(quiet)).toBe(0);
    const busy = volumeOf([fill({ mon: 12_000 })]);
    expect(volumePressure(busy)).toBeGreaterThan(0);
    expect(volumeRatio(busy)).toBeGreaterThan(1);
  });

  it('opens a Surge from many modest trades, even against a bigger single sale', () => {
    // Nine modest trades (27k) outweigh one 20k whale: the Surge is the crowd, not the biggest fill.
    const spread = Array.from({ length: 9 }, (_, i) =>
      fill({
        mon: 3_000,
        tokenId: 3 + i * 3,
        buyer: `0x${'0'.repeat(39)}${i}`,
        seller: `0x${'f'.repeat(39)}${i}`,
      }),
    );
    const whale = fill({ mon: 20_000, tokenId: 1 });
    const volume = volumeOf([...spread, whale]);
    expect(volume.bySector.ashflat).toBe(47_000);

    const surge = classify([...spread, whale], { baselineMon: 1 }).find(
      (t) => t.archetype === 'surge',
    );
    expect(surge?.sector).toBe('ashflat');
    expect(surge).toBeTruthy();
  });
});

describe('sale pressure', () => {
  it('rises with price but stops rewarding past the ceiling', () => {
    const at = (mon: number) => salePressure(mon);
    expect(at(20_000)).toBeGreaterThan(at(5_000));
    expect(at(5_000)).toBeGreaterThan(at(1_000));
    expect(at(200_000)).toBe(at(PRICE_CEIL_MON));
  });

  it('lets a median sale cross the Glitch threshold on its own', () => {
    expect(salePressure(9_140)).toBeGreaterThanOrEqual(45);
  });

  it('cannot open a Storm from one fill', () => {
    expect(salePressure(PRICE_CEIL_MON)).toBeLessThan(95);
  });
});
