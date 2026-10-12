import { CFG } from './config.ts';

/**
 * The chain's transport, in one place.
 *
 * Every on-chain reader here — the ownership scan, the transfer backfill, the wave
 * feed — used to carry its own copy of this, which meant the quirks measured
 * against Monad's public RPCs lived in three places and only got fixed in one.
 *
 * The measured quirks those copies had to agree on:
 * - `rpc2.monad.xyz` refuses `eth_getLogs` ranges over ~16k blocks with -32012
 *   (`rpc.monad.xyz` caps at 100), so range work is windowed by the caller.
 * - JSON-RPC batches come back **unordered** and may drop entries, so results are
 *   re-keyed by request id and a dropped slot is `null` — never "absent", which
 *   would read as "this wallet owns nothing" or "this token never moved".
 * - Batched `eth_getTransactionReceipt` fails roughly one call in twelve against
 *   single calls at 100%, so receipts stay one at a time.
 */

export interface RpcLog {
  blockNumber: string;
  transactionHash: string;
  address: string;
  topics: string[];
  data: string;
  /** True while a reorg holds the log; a removed log never counts as history. */
  removed?: boolean;
  logIndex?: string;
}

export interface CallShape {
  to: string;
  data: string;
}

/** keccak256("Transfer(address,address,uint256)") — shared by ERC-721 and ERC-20. */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Monad's measured block time is ~0.302s. This is only used to interpolate a
 * timestamp inside a window whose head block was read, where the error is
 * minutes — and holding time is scored in days.
 */
export const BLOCK_MS = 320;

const hexNum = (n: number) => `0x${Math.trunc(n).toString(16)}`;

/** A single JSON-RPC call. Throws, so the caller decides what a failure means. */
export async function rpc<T>(method: string, params: unknown[] = [], url = CFG.rpcUrl): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`rpc ${method} -> http ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string; code?: number } };
  if (json.error) throw new Error(`rpc ${method} -> ${json.error.message}`);
  return json.result as T;
}

/**
 * One HTTP request, many calls, results back in request order with `null` where a
 * node dropped a slot. `retries` re-asks only the missing entries, because a
 * dropped slot has to be indistinguishable from a real empty answer.
 */
export async function rpcBatch<T>(
  calls: { method: string; params: unknown[] }[],
  url = CFG.rpcUrl,
  retries = 1,
): Promise<(T | null)[]> {
  const out: (T | null)[] = calls.map(() => null);
  let todo = calls.map((c, i) => ({ ...c, slot: i }));

  for (let pass = 0; pass <= retries && todo.length; pass++) {
    if (pass) await new Promise((r) => setTimeout(r, 250 * pass));
    const body = todo.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params }));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { id?: number; result?: T; error?: unknown }[];
      const byId = new Map<number, { result?: T }>();
      for (const r of Array.isArray(json) ? json : [json]) byId.set(Number(r.id ?? 0), r);
      const still: typeof todo = [];
      todo.forEach((c, i) => {
        const hit = byId.get(i + 1);
        if (hit && hit.result !== undefined) out[c.slot] = hit.result;
        else still.push(c);
      });
      todo = still;
    } catch {
      // A whole-request failure leaves every slot unfilled and retried.
    }
  }
  return out;
}

export const toHex = hexNum;
export const fromHex = (hex: string | number | undefined): number =>
  typeof hex === 'number' ? hex : Number(BigInt(hex && hex !== '0x' ? hex : '0x0'));

/** `eth_call` against the Genesis contract, as one batched request. */
export async function ethCallBatch(
  calls: CallShape[],
  url = CFG.rpcUrl,
  retries = 1,
): Promise<(string | null)[]> {
  return rpcBatch<string>(calls.map((c) => ({ method: 'eth_call', params: [c, 'latest'] })), url, retries);
}

export async function getLogsWindow(
  filter: { address: string; topics: string[]; from: number; to: number },
  url = CFG.rpcUrl,
): Promise<RpcLog[]> {
  return rpc<RpcLog[]>('eth_getLogs', [
    {
      address: filter.address,
      topics: filter.topics,
      fromBlock: hexNum(filter.from),
      toBlock: hexNum(filter.to),
    },
  ], url);
}

export async function blockTimestamp(at: number, url = CFG.rpcUrl): Promise<number> {
  const b = await rpc<{ timestamp?: string } | null>('eth_getBlockByNumber', [hexNum(at), false], url);
  return b?.timestamp ? fromHex(b.timestamp) * 1000 : 0;
}

export async function headBlock(url = CFG.rpcUrl): Promise<number> {
  return fromHex(await rpc<string>('eth_blockNumber', [], url));
}
