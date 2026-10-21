import { SEAPORT_ADDRESS, type SaleFact, type WaveEvent } from '@chog/shared';
import { CFG } from './config.ts';
import { dedupeFills, decodeOrderFulfilled } from './seaport.ts';
import { TRANSFER_TOPIC, fromHex, rpc, rpcBatch, toHex, type RpcLog } from './rpc.ts';
import { ledger, recordTransfer } from './ledger.ts';

interface ReceiptShape {
  blockNumber?: string;
  logs?: { address: string; topics: string[]; data: string }[];
}

interface BlockShape {
  timestamp: string;
  transactions?: unknown[];
  gasUsed?: string;
}

/** Batch slots come back `unknown`; these say what this feed can actually use. */
const asLogs = (v: unknown): RpcLog[] | null => (Array.isArray(v) ? (v as RpcLog[]) : null);
const asBlock = (v: unknown): BlockShape | null =>
  v && typeof v === 'object' && !Array.isArray(v) && 'timestamp' in v ? (v as BlockShape) : null;

/** A $CHOG transfer into the game vault: real money arriving. `amount` is whole $CHOG, floored. */
export interface DepositFact {
  txHash: string;
  from: string;
  amount: number;
  block: number;
}

/**
 * Pull a vault deposit out of a $CHOG Transfer log, or null when the log is not
 * one. Pure, so the money path is unit-testable without an RPC in the room.
 */
export function depositOf(log: RpcLog, vault: string): DepositFact | null {
  if (!vault) return null;
  const addr = (topic: string | undefined) =>
    topic && topic.length >= 64 ? '0x' + topic.slice(-40).toLowerCase() : null;
  const to = addr(log.topics[2]);
  if (!to || to !== vault.toLowerCase()) return null;
  const from = addr(log.topics[1]);
  if (!from || from === to) return null;
  return { txHash: log.transactionHash, from, amount: fromHex(log.data || '0x0') / 1e18, block: fromHex(log.blockNumber) };
}

/**
 * Follows Genesis transfers into their receipts to find the Seaport fill that
 * carried the money. A Transfer alone is not a sale — of 2,074 historical transfer
 * transactions, 852 moved a Chog wallet-to-wallet with no payment at all, so
 * pricing them would be showing a fiction.
 *
 * Receipts are fetched one per request on purpose: batched receipt fetches fail
 * against rpc2 with -32603 roughly one call in twelve, while single calls were
 * measured at 100%.
 */
async function priceTransfers(logs: RpcLog[]): Promise<SaleFact[]> {
  const txs = [...new Set(logs.map((l) => l.transactionHash))];
  const fills: SaleFact[] = [];
  for (const txHash of txs) {
    try {
      const rc = await rpc<ReceiptShape>('eth_getTransactionReceipt', [txHash]);
      const block = fromHex(rc?.blockNumber);
      for (const log of rc?.logs ?? []) {
        if (log.address.toLowerCase() !== SEAPORT_ADDRESS.toLowerCase()) continue;
        const fill = decodeOrderFulfilled(log, CFG.chogGenesis, {
          txHash,
          block,
          ts: Date.now(),
        });
        if (fill) fills.push(fill);
      }
    } catch (err) {
      console.warn('[chain] receipt failed', txHash.slice(0, 10), (err as Error).message);
    }
  }
  return dedupeFills(fills);
}

export interface ChainFeed {
  start(): Promise<void>;
  stop(): void;
  readonly lastBlock: number;
  readonly blockTimeMs: number;
  /** Transfers seen with no priced leg since the last one — venue-migration alarm. */
  readonly unpricedStreak: number;
}

/**
 * Scans Transfer logs for the Genesis collection and the $CHOG token, and emits a
 * chain-pulse every poll. The pulse is what keeps the world alive: measured on
 * mainnet the Genesis contract produced zero Transfers in 45 minutes, so a game
 * driven only by trades would never spawn an Anomaly.
 */
export function createChainFeed(
  onEvents: (evs: WaveEvent[]) => void,
  onFills: (fills: SaleFact[]) => void = () => {},
  onDeposit: (facts: DepositFact[]) => void = () => {},
): ChainFeed {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastBlock = 0;
  let blockTimeMs = 800;
  let running = false;
  let unpricedStreak = 0;
  /** Slow EMA so the baseline tracks the time of day instead of one busy block. */
  let emaTxs = 0;

  /**
   * Decode one tick's logs. Genesis transfers do double duty: they are a wave event
   * for the world, and the history that decides what a Chog derives into. The second
   * half is the reason `from`/`to` are read here at all — discarding them is what
   * left the ownership index and the provenance ledger starved while the market
   * screen happily printed the same moves as traffic.
   */
  const decode = (nft: RpcLog[], token: RpcLog[], tsFor: (block: number) => number, deposits: DepositFact[]): WaveEvent[] => {
    const out: WaveEvent[] = [];
    for (const log of nft) {
      const block = fromHex(log.blockNumber);
      const ts = tsFor(block);
      const tokenId = fromHex(log.topics[3] ?? '0x0');
      const addr = (topic: string | undefined) =>
        topic && topic.length >= 64 ? '0x' + topic.slice(-40).toLowerCase() : null;
      recordTransfer({ tokenId, from: addr(log.topics[1]), to: addr(log.topics[2]), block, ts });
      out.push({ kind: 'nft-swap', tokenId, amount: 0, block, ts });
    }
    for (const log of token) {
      const block = fromHex(log.blockNumber);
      out.push({ kind: 'token-swap', amount: fromHex(log.data || '0x0') / 1e18, block, ts: tsFor(block) });
      const dep = depositOf(log, CFG.vault);
      if (dep) deposits.push(dep);
    }
    return out;
  };

  const poll = async () => {
    if (!running) return;
    try {
      const head = fromHex(await rpc<string>('eth_blockNumber'));
      if (lastBlock === 0) lastBlock = Math.max(0, head - 64);
      // Public RPCs cap the getLogs range (rpc2 tolerates ~10k blocks,
      // rpc.monad.xyz only 100), so never ask for more than configured.
      const fromBlock = Math.max(lastBlock + 1, head - CFG.logWindow);

      if (head > lastBlock) {
        const from = toHex(fromBlock);
        const to = toHex(head);
        // Four reads, one request. Measured against rpc2: batches come back
        // unordered and may drop a slot, so every result is checked rather than
        // trusted — a silently missing log array would read as a quiet chain and
        // stop the world from spawning anomalies at all.
        const [n, t, b0, b1] = await rpcBatch<unknown>(
          [
            { method: 'eth_getLogs', params: [{ fromBlock: from, toBlock: to, address: CFG.chogGenesis, topics: [TRANSFER_TOPIC] }] },
            { method: 'eth_getLogs', params: [{ fromBlock: from, toBlock: to, address: CFG.chogToken, topics: [TRANSFER_TOPIC] }] },
            { method: 'eth_getBlockByNumber', params: [from, false] },
            { method: 'eth_getBlockByNumber', params: [to, false] },
          ],
          CFG.rpcUrl,
          1,
        );
        const nftLogs = asLogs(n);
        const tokenLogs = asLogs(t);
        const first = asBlock(b0);
        const latest = asBlock(b1);
        if (!nftLogs || !tokenLogs || !first || !latest) {
          console.warn('[chain] batch came back incomplete; retrying without advancing');
          timer = setTimeout(poll, Math.max(200, blockTimeMs));
          return;
        }

        const headTs = fromHex(latest.timestamp) * 1000;
        const span = (fromHex(latest.timestamp) - fromHex(first.timestamp)) * 1000;
        if (span > 0 && head > fromBlock) blockTimeMs = span / (head - fromBlock);
        // The head's own timestamp is exact, so every log in the window is placed by
        // block distance rather than stamped with the time the poll happened to run.
        const tsFor = (block: number) => headTs - (head - block) * blockTimeMs;
        ledger.headHint = head;
        ledger.headTs = headTs;

        const deposits: DepositFact[] = [];
        const evs = decode(nftLogs, tokenLogs, tsFor, deposits);
        if (deposits.length) onDeposit(deposits);

        const fills = await priceTransfers(nftLogs);
        if (fills.length) {
          unpricedStreak = 0;
          for (const f of fills) {
            evs.push({
              kind: 'nft-sale',
              tokenId: f.tokenId,
              amount: f.mon,
              block: f.block,
              ts: f.ts,
            });
          }
          onFills(fills);
        } else if (nftLogs.length) {
          unpricedStreak += nftLogs.length;
          // Venue-migration guard. 1,339 holders have approved a Blur-shaped
          // exchange that has never filled a single order; if fills move there,
          // this feed keeps seeing transfers and starts reporting zero volume,
          // which looks like a dead market rather than a broken parser.
          if (unpricedStreak >= 10) {
            console.warn(
              `[chain] ${unpricedStreak} transfers with no priced leg — venue may have moved off Seaport`,
            );
          }
        }

        // Chain pulse: how busy this block was relative to a slowly-tracked
        // baseline, so the number means "ordinary" at 1.0 whatever the chain's
        // current throughput is.
        //
        // Clamped, because the EMA is seeded from the first block seen: a quiet
        // opener followed by normal traffic produced ratios over 30x and pinned a
        // sector at the wave cap within seconds of boot. Three times the
        // baseline is already a genuine surge.
        const txs = latest.transactions?.length ?? 0;
        emaTxs = emaTxs === 0 ? Math.max(1, txs) : emaTxs * 0.995 + txs * 0.005;
        const ratio = Math.min(3, Math.max(0.25, txs / Math.max(1, emaTxs)));
        evs.push({ kind: 'chain-pulse', amount: ratio, block: head, ts: headTs });

        onEvents(evs);
        lastBlock = head;
      }
    } catch (err) {
      console.warn('[chain] poll failed:', (err as Error).message);
    }
    timer = setTimeout(poll, Math.max(200, blockTimeMs));
  };

  return {
    async start() {
      if (!CFG.rpcUrl || !CFG.chogGenesis) throw new Error('chain feed needs MONAD_RPC + CHOG_GENESIS_CONTRACT');
      running = true;
      await poll();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
    get lastBlock() {
      return lastBlock;
    },
    get blockTimeMs() {
      return blockTimeMs;
    },
    get unpricedStreak() {
      return unpricedStreak;
    },
  };
}
