/**
 * Chain wiring is deliberately opt-in: the feed refuses to start in `chain` mode
 * until the contract addresses are real, rather than quietly falling back and
 * letting a demo look live when it is not.
 *
 * The addresses themselves live in `@chog/shared` because the client has to hand
 * the same ones to the wallet — see `shared/src/chain.ts`. This file only maps
 * them to env overrides.
 */
import { CHOG_GENESIS_ADDRESS, MONAD_RPC_URL } from '@chog/shared';

export const CFG = {
  port: Number(process.env.PORT ?? 8787),
  rpcUrl: process.env.MONAD_RPC ?? MONAD_RPC_URL,
  chogGenesis: process.env.CHOG_GENESIS_CONTRACT ?? CHOG_GENESIS_ADDRESS,
  chogToken: process.env.CHOG_TOKEN_CONTRACT ?? '0x350035555E10d9AfAF1566AaebfCeD5BA6C27777',
  /** getLogs window; keep under rpc2's ~10k cap. */
  logWindow: Number(process.env.LOG_WINDOW ?? 900),
  tickMs: Number(process.env.TICK_MS ?? 250),
  broadcastMs: Number(process.env.BROADCAST_MS ?? 50),
  dataDir: process.env.DATA_DIR ?? '.data',
  /**
   * Read-only collection assets, kept separate from `dataDir` so a probe server can
   * run against its own database without silently losing the real trait metadata —
   * which would quietly downgrade every player to predicted traits.
   */
  metaDir: process.env.META_DIR ?? '.data/metadata',
  artTestnetDir: process.env.ART_TESTNET_DIR ?? '.data/art-testnet',
  /** Traits for the testnet replica's ids — a separate map, so testnet #1 never
   *  steals mainnet #1's face (both indexes key by the real id in `name`). */
  metaTestnetDir: process.env.META_TESTNET_DIR ?? '.data/metadata-testnet',
  /** Baked per-token atlases. Served on demand so any of the 1969 works without
   *  shipping 280MB of PNGs to every visitor. */
  spritesDir: process.env.SPRITES_DIR ?? '.data/sprites',
  /**
   * Play any tokenId without a signature. Off by default: the whole premise is that
   * the Chog you play is the Chog you hold, so this has to be a deliberate env
   * choice rather than something a client can ask for. It exists because floor price
   * (~5,260 MON) prices a judge out of holding one, and the recorder needs to show
   * a specific token on screen.
   */
  devTokens: process.env.DEV_TOKENS === '1',
} as const;

export type FeedMode = 'chain' | 'synthetic';

export function feedMode(): FeedMode {
  if (process.env.FEED === 'synthetic') return 'synthetic';
  return CFG.rpcUrl && CFG.chogGenesis ? 'chain' : 'synthetic';
}

export const chainConfigured = () => Boolean(CFG.rpcUrl && CFG.chogGenesis);
