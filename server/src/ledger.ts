import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENESIS_SUPPLY, type Provenance } from '@chog/shared';
import { CFG, chainConfigured, feedMode } from './config.ts';
import { ZERO, ownership } from './owners.ts';
import {
  BLOCK_MS,
  TRANSFER_TOPIC,
  fromHex,
  headBlock,
  rpcBatch,
  toHex,
  type RpcLog,
} from './rpc.ts';

/**
 * Which Chog moved, when, and to whom — the part of the premise nothing else can
 * fake.
 *
 * `deriveBuild` reads provenance off two numbers: how many times a token has
 * changed hands, and how long its current holder has held it. Those are the only
 * inputs to the build that a player cannot shop for, which is why a heavily
 * flipped Chog stays loud forever and a loyal one earns clean signal. Before this
 * ledger existed the server passed `transferCount: 0, daysHeld: 0` for everyone,
 * so the whole mechanic was dormant and every Chog read as brand new.
 *
 * The history is not a live query: `eth_getLogs` is capped at ~16k blocks per
 * request on the public RPCs and the collection's first Transfer sits at block
 * 101,704,044 against a head of ~112M, so reconstructing it is ~900 windowed
 * requests. That is a background job, once, persisted to disk — not something to
 * do at boot or on a login.
 */

/** Measured: the first Genesis Transfer logs land at block 101,704,044. */
export const GENESIS_FIRST_LOG_BLOCK = 101_704_036;
/** rpc2 answers at 12,000 blocks and refuses at 20,000, so stay under the cap. */
const WINDOW = 12_000;
/** Round-trips are ~0.6s; four in flight brings the backfill to about two minutes. */
const CONC = 4;
const DAY_MS = 86_400_000;

export interface TokenHistory {
  /** Transfer events this token has ever produced, its mint included. */
  count: number;
  /** Current holder, lowercase. Blank when the token was burned. */
  holder: string;
  /** ms the *current* holder received it — the basis of daysHeld. */
  since: number;
  /** ms of the most recent Transfer, for a "market activity" read. */
  last: number;
  mintBlock: number;
  mintTs: number;
  /**
   * Highest block applied for this token. The backfill and the live poll overlap at
   * the head of the chain by design, so without this guard a restart would count
   * the same move twice and quietly inflate every `transferCount` it overlaps.
   * Tokens that move twice inside a single block are counted once — mint-and-flip
   * in one transaction, which does not change who you are playing as.
   */
  lastBlock: number;
}

interface DiskShape {
  cursor: number;
  rows: Record<string, TokenHistory>;
}

export class TransferLedger {
  private rows = new Map<number, TokenHistory>();
  /** Highest block whose Transfers are all applied. 0 before the first run. */
  cursor = 0;
  done = false;
  applied = 0;
  scanned = 0;

  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly file = join(CFG.dataDir, 'transfers.json');

  constructor() {
    this.load();
  }

  /** Tokens whose history this ledger has actually seen a Transfer for. */
  get coverage(): number {
    return this.rows.size;
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const disk = JSON.parse(readFileSync(this.file, 'utf8')) as DiskShape;
      this.cursor = Number(disk.cursor ?? 0);
      for (const [id, row] of Object.entries(disk.rows ?? {})) {
        const tokenId = Number(id);
        if (!Number.isFinite(tokenId) || !row || typeof row.count !== 'number') continue;
        this.rows.set(tokenId, {
          count: row.count,
          holder: String(row.holder ?? '').toLowerCase(),
          since: Number(row.since ?? 0),
          last: Number(row.last ?? 0),
          mintBlock: Number(row.mintBlock ?? 0),
          mintTs: Number(row.mintTs ?? 0),
          lastBlock: Number(row.lastBlock ?? 0),
        });
      }
      // Resuming from a persisted cursor is cheap, so `done` stays false until a
      // pass has actually reached the head.
    } catch {
      // A half-written file is not a reason to lose the scan that produced it;
      // start over and let the backfill refill it.
      this.rows = new Map();
    }
  }

  /** Debounced, so a 900-window backfill does not mean 900 synchronous writes. */
  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 2_000);
    this.flushTimer.unref?.();
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    mkdirSync(CFG.dataDir, { recursive: true });
    const rows: Record<string, TokenHistory> = {};
    for (const [id, row] of this.rows) rows[String(id)] = row;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ cursor: this.cursor, rows } satisfies DiskShape));
    renameSync(tmp, this.file);
  }

  /**
   * Apply one Transfer. Kept idempotent per (token, block) so a reorg or a
   * overlapping restart cannot count the same move twice.
   */
  apply(tokenId: number, from: string | null, to: string | null, ts: number, block: number): void {
    if (!Number.isFinite(tokenId) || tokenId < 1 || tokenId > GENESIS_SUPPLY) return;
    const row = this.rows.get(tokenId) ?? {
      count: 0,
      holder: '',
      since: 0,
      last: 0,
      mintBlock: 0,
      mintTs: 0,
      lastBlock: 0,
    };
    // A caller without a block number (0) is not in a position to be deduped.
    if (block && row.lastBlock && block <= row.lastBlock) return;
    if (!row.count && from === ZERO) {
      row.mintBlock = block;
      row.mintTs = ts;
    }
    row.lastBlock = Math.max(row.lastBlock, block);
    row.count += 1;
    row.last = Math.max(row.last, ts);
    if (to && to !== ZERO) {
      const holder = to.toLowerCase();
      if (holder !== row.holder) {
        row.holder = holder;
        row.since = ts;
      }
    } else if (to === ZERO) {
      row.holder = '';
      row.since = 0;
    }
    this.rows.set(tokenId, row);
    this.applied += 1;
    this.markDirty();
  }

  /**
   * What the formula gets to work with. `daysHeld` is only meaningful for the
   * wallet that actually holds it now, so a caller that asks about somebody
   * else's Chog is told the truth: zero days.
   */
  provenance(tokenId: number, holder?: string | null, now = Date.now()): Provenance {
    const row = this.rows.get(tokenId);
    if (!row) return { transferCount: 0, daysHeld: 0 };
    const mine = !holder || row.holder === holder.toLowerCase();
    return {
      transferCount: row.count,
      daysHeld: mine && row.since ? Math.max(0, (now - row.since) / DAY_MS) : 0,
      mintBlock: row.mintBlock || undefined,
    };
  }

  history(tokenId: number): TokenHistory | null {
    return this.rows.get(tokenId) ?? null;
  }

  /**
   * Record a Transfer in both stores: the history here, and the ownership index it
   * keeps honest. Both the backfill and the live poll come through this one door, so
   * the two can never end up disagreeing about who holds what.
   */
  observe(f: TransferFact): void {
    this.setSample(f.block, f.ts);
    this.apply(f.tokenId, f.from, f.to, f.ts, f.block);
    ownership.transfer(f.tokenId, f.from, f.to);
  }

  /**
   * Walk the collection's whole Transfer history in windowed batches, once.
   *
   * Each request is a two-call batch: the logs for the window plus the timestamp
   * of the window's first block, so the block→time mapping comes from the same
   * round trip instead of one call per log. A window the node refuses is split in
   * half rather than skipped, because a skipped window is silently missing
   * provenance and nothing downstream can tell.
   */
  async backfill(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (!chainConfigured() || feedMode() === 'synthetic') {
      this.done = true;
      return;
    }
    const head = await headBlock();
    this.headHint = head;
    let from = Math.max(this.cursor + 1, GENESIS_FIRST_LOG_BLOCK);
    if (from > head) {
      this.done = true;
      return;
    }
    const total = Math.ceil((head - from + 1) / WINDOW);
    let walked = 0;

    while (from <= head) {
      const chunkStart = from;
      const jobs = Array.from({ length: CONC }, (_, i) => {
        const s = chunkStart + i * WINDOW;
        return this.window(s, Math.min(head, s + WINDOW - 1));
      });
      const results = await Promise.all(jobs);
      results.forEach(({ logs, ts }, i) => {
        const start = chunkStart + i * WINDOW;
        if (ts) this.setSample(start, ts);
        for (const log of logs) this.applyLog(log, start);
        this.cursor = Math.max(this.cursor, Math.min(head, start + WINDOW - 1));
        walked++;
      });
      this.scanned = this.cursor;
      from = chunkStart + CONC * WINDOW;
      onProgress?.(Math.min(total, walked), total);
    }
    this.done = true;
    this.markDirty();
    this.flush();
  }

  /** The window's Transfers, plus the timestamp its first block was mined at. */
  private async window(from: number, to: number): Promise<{ logs: RpcLog[]; ts: number }> {
    const [logs, block] = await rpcBatch<unknown>(
      [
        {
          method: 'eth_getLogs',
          params: [
            {
              address: CFG.chogGenesis,
              topics: [TRANSFER_TOPIC],
              fromBlock: toHex(from),
              toBlock: toHex(to),
            },
          ],
        },
        { method: 'eth_getBlockByNumber', params: [toHex(from), false] },
      ],
      CFG.rpcUrl,
      0,
    );
    // Blocks carry seconds; every other timestamp in this ledger is ms.
    const ts = isBlock(block) ? fromHex(block.timestamp) * 1000 : 0;
    if (!Array.isArray(logs)) {
      // A refused or dropped window is split rather than skipped: skipping would
      // silently drop provenance for a stretch of chain, and nothing downstream
      // could tell a missing hour from a quiet one.
      if (to - from <= 256) return { logs: [], ts };
      const mid = from + Math.floor((to - from) / 2);
      const left = await this.window(from, mid);
      const right = await this.window(mid + 1, to);
      // Anchoring the halves back onto `from` keeps one sample per chunk start, so
      // interpolation never has to guess which of two windows a log came from.
      const anchored = left.ts || (right.ts ? right.ts - (mid + 1 - from) * BLOCK_MS : 0);
      return { logs: [...left.logs, ...right.logs], ts: anchored };
    }
    return { logs: logs as RpcLog[], ts };
  }

  private applyLog(log: RpcLog, windowStart: number): void {
    if (log.removed) return;
    const block = fromHex(log.blockNumber);
    const tokenId = Number(BigInt(log.topics[3] ?? '0x0'));
    const addr = (topic: string | undefined) =>
      topic && topic.length >= 64 ? '0x' + topic.slice(-40).toLowerCase() : null;
    this.observe({
      tokenId,
      from: addr(log.topics[1]),
      to: addr(log.topics[2]),
      block,
      ts: this.timestampOf(block, windowStart),
    });
  }

  /** Window start times, learned as the backfill walks and reused live. */
  private samples = new Map<number, number>();
  private setSample(block: number, ts: number): void {
    if (!block || !ts) return;
    this.samples.set(block, ts);
    if (this.samples.size > 64) {
      const oldest = this.samples.keys().next().value;
      if (oldest !== undefined) this.samples.delete(oldest);
    }
  }

  /**
   * The window's measured start time, corrected by block distance at Monad's real
   * cadence. Worst case inside a 12k-block window that is about an hour of error on
   * a number scored in days, which is why `daysHeld` is never used for anything
   * finer than "has this Chog been loved for a while".
   */
  private timestampOf(block: number, windowStart: number): number {
    const anchor = this.samples.has(windowStart) ? windowStart : this.anchorOf(block);
    const base = anchor === null ? undefined : this.samples.get(anchor);
    if (base !== undefined && anchor !== null) return base + (block - anchor) * BLOCK_MS;
    // No sample yet (a live Transfer before the first backfill pass): the head's own
    // timestamp minus the block gap is the only honest estimate left.
    if (this.headTs) return this.headTs - (this.headHint - block) * BLOCK_MS;
    // Nothing measured at all: 0 reads as "unknown" downstream, which beats an
    // invented date that would then be scored as daysHeld.
    return 0;
  }

  /** Sampled block closest to `block` from below, which is what makes the slope right. */
  private anchorOf(block: number): number | null {
    let best: number | null = null;
    for (const s of this.samples.keys()) {
      if (s <= block && (best === null || s > best)) best = s;
    }
    return best;
  }

  headHint = 0;
  /** Set by the chain poll from the block it just read; 0 until the first tick. */
  headTs = 0;
}

/**
 * One ledger for the process, like `traits` and `ownership`. The backfill, the
 * chain poll and the sign-in routes all have to agree on a token's history or the
 * same Chog derives a different build depending on which path asked.
 */
export const ledger = new TransferLedger();

/** A Transfer the chain poll has just read, in the shape both stores want. */
export interface TransferFact {
  tokenId: number;
  from: string | null;
  to: string | null;
  block: number;
  ts: number;
}

/** Feed one live Transfer from the chain poll into the ledger and the index. */
export function recordTransfer(f: TransferFact): void {
  ledger.observe(f);
}

type BlockShape = { timestamp?: string };
const isBlock = (v: unknown): v is BlockShape =>
  !!v && typeof v === 'object' && !Array.isArray(v) && 'timestamp' in v;
