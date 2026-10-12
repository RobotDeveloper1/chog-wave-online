import type { WaveEvent } from '@chog/shared';
import { GENESIS_SUPPLY } from '@chog/shared';

export interface SyntheticFeed {
  start(): void;
  stop(): void;
  /** Scripted burst — this is what puts a storm on screen for the demo video. */
  surge(count?: number): void;
  setHeat(multiplier: number): void;
}

/**
 * The scripted burst on its own, so the chain feed can offer the same demo lever.
 * `surge` used to be a no-op in chain mode, which meant /api/dev/surge silently
 * did nothing on a live server — the only kind a demo actually runs on.
 */
export function createSurge(onEvents: (evs: WaveEvent[]) => void): (count?: number) => void {
  let block = 41_203_000 + (Date.now() % 1_000_000);

  const make = (kind: WaveEvent['kind'], amount: number): WaveEvent => {
    block += 1 + Math.floor(Math.random() * 3);
    return {
      kind,
      tokenId: kind === 'nft-swap' ? 1 + Math.floor(Math.random() * GENESIS_SUPPLY) : undefined,
      amount,
      block,
      ts: Date.now(),
    };
  };

  const lognormal = (median: number, spread: number) =>
    median * Math.exp((Math.random() + Math.random() + Math.random() - 1.5) * spread);

  return (count = 8) => {
    const evs: WaveEvent[] = [];
    for (let i = 0; i < count; i++) {
      const isToken = Math.random() < 0.45;
      evs.push(
        make(isToken ? 'token-swap' : 'nft-swap', isToken ? lognormal(4000, 1.6) : lognormal(5200, 1.1)),
      );
    }
    onEvents(evs);
  };
}

/**
 * Stands in for the market when the chain feed is not wired. Deliberately shaped
 * like real trading: a long tail of small sales punctuated by runs, so the Wave
 * Index behaves the way it will on mainnet rather than ticking up evenly.
 */
export function createSyntheticFeed(onEvents: (evs: WaveEvent[]) => void, pulseMs = 300): SyntheticFeed {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let heat = 1;
  let block = 41_203_000;
  let token = 0;

  const make = (kind: WaveEvent['kind'], amount: number): WaveEvent => {
    block += 1 + Math.floor(Math.random() * 3);
    return {
      kind,
      tokenId: kind === 'nft-swap' ? 1 + Math.floor(Math.random() * GENESIS_SUPPLY) : undefined,
      amount,
      block,
      ts: Date.now(),
    };
  };

  /**
   * Pulses are emitted here too, so the synthetic world behaves like the chain
   * one. A demo that only looks alive in synthetic mode is not a demo.
   */
  const pulse = () => {
    const spike = Math.random() < 0.05 ? 2.5 + Math.random() * 2 : 1;
    const ev = make('chain-pulse', (0.7 + Math.random() * 0.6) * spike);
    onEvents([ev]);
  };

  const burst = createSurge((evs) => {
    token += evs.length;
    onEvents(evs);
  });

  /**
   * One loop at chain cadence. The old 1.8s tick only ever emitted trades, which
   * made the synthetic world sit near zero the same way the real chain does —
   * the pulse has to run at ~block rate for the two modes to feel alike.
   */
  const step = () => {
    if (!running) return;
    pulse();
    if (Math.random() < 0.008 * heat) burst(5 + Math.floor(Math.random() * 6));
    else if (Math.random() < 0.010 * heat) burst(1);
    timer = setTimeout(step, pulseMs / heat);
  };

  return {
    start() {
      running = true;
      step();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
    surge(count = 8) {
      burst(count);
    },
    setHeat(m: number) {
      heat = Math.max(0.1, m);
    },
  };
}
