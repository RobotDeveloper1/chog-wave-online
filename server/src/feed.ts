import type { SaleFact, WaveEvent } from '@chog/shared';
import type { DepositFact } from './chain.ts';
import { chainConfigured, feedMode } from './config.ts';
import { createChainFeed } from './chain.ts';
import { createSurge, createSyntheticFeed } from './synthetic.ts';

export interface Feed {
  mode: 'chain' | 'synthetic';
  start(): void | Promise<void>;
  stop(): void;
  surge(count?: number): void;
  setHeat(m: number): void;
  /**
   * Inject priced sales through the same callback the indexer uses.
   *
   * Wired in both modes on purpose. `surge` used to be a no-op under chain, which
   * silently disabled the demo lever on exactly the server a demo runs on; an
   * anomaly archetype is the same kind of lever, and Chog Genesis sells about
   * 0.48 times an hour, so without it there is no way to show the headline
   * mechanic on demand. Everything it produces is labelled `synthetic` in the
   * snapshot, so a fake sale can never be mistaken for a real one.
   */
  injectFills(fills: SaleFact[]): void;
  describe(): string;
}

/**
 * One seam, two backends. The client is told which one is live and shows it in
 * the HUD, so a synthetic demo never gets mistaken for real market pressure.
 *
 * `surge` is wired in both modes on purpose. It used to be a no-op under chain,
 * which silently disabled the demo lever on exactly the server a demo runs on;
 * it injects through the same callback the indexer uses, so the wave maths is
 * identical either way.
 *
 * `onFills` is priced-sale data and is chain-only for now. Synthetic mode still
 * drives the Wave Index, but it cannot produce an anomaly archetype until the
 * fake feed learns to emit SaleFacts — see the note in R1.
 */
export function createFeed(
  onEvents: (evs: WaveEvent[]) => void,
  onFills: (fills: SaleFact[]) => void = () => {},
  onDeposit: (facts: DepositFact[]) => void = () => {},
): Feed {
  const mode = feedMode();

  if (mode === 'chain') {
    const chain = createChainFeed(onEvents, onFills, onDeposit);
    const surge = createSurge(onEvents);
    return {
      mode: 'chain',
      start: () => chain.start(),
      stop: () => chain.stop(),
      surge: (n?: number) => surge(n),
      setHeat: () => {},
      injectFills: (fills) => onFills(fills),
      describe: () => `live · Monad RPC · ~${Math.round(chain.blockTimeMs)}ms blocks`,
    };
  }

  const synth = createSyntheticFeed(onEvents);
  return {
    mode: 'synthetic',
    start: () => synth.start(),
    stop: () => synth.stop(),
    surge: (n?: number) => synth.surge(n),
    setHeat: (m: number) => synth.setHeat(m),
    injectFills: (fills) => onFills(fills),
    describe: () =>
      chainConfigured() ? 'synthetic (forced via FEED=synthetic)' : 'synthetic (no contract/RPC configured)',
  };
}
