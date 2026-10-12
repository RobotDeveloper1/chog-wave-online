import { GENESIS_SUPPLY } from '@chog/shared';
import { CFG } from './config.ts';
import { ethCallBatch } from './rpc.ts';

/**
 * Who holds which Chog.
 *
 * The contract does not implement ERC721Enumerable — `supportsInterface` reverts
 * outright — so there is no `tokenOfOwnerByIndex` to ask. The only way to answer
 * "what does this wallet hold" is to read ownership for all 1,969 ids once and
 * then keep that map honest from the Transfer stream the chain feed already
 * consumes. That is ~20 batched calls at boot, which is cheap, versus scanning
 * the whole chain's history on every login, which is not.
 *
 * A wallet that owns nothing gets an empty list, and the caller decides whether
 * that means "foster a Chog" or "go buy one". Both are honest answers; pretending
 * a random token belongs to them is not.
 */

const OWNER_OF = '0x6352211e'; // ownerOf(uint256)
const CHUNK = 100;
/** The burn address, and the `from` of every mint. */
export const ZERO = '0x0000000000000000000000000000000000000000';

const addrOf = (hex: string | null): string | null => {
  if (!hex || hex.length < 42) return null;
  return '0x' + hex.slice(-40).toLowerCase();
};

const ownerCall = (tokenId: number) => ({
  to: CFG.chogGenesis,
  data: OWNER_OF + tokenId.toString(16).padStart(64, '0'),
});

export class Ownership {
  /** tokenId -> holder address, lowercase */
  private byToken = new Map<number, string>();
  /** holder address -> tokenIds */
  private byWallet = new Map<string, number[]>();
  ready = false;
  scanned = 0;

  get coverage(): number {
    return this.byToken.size;
  }

  /**
   * Read every token's owner once. Batched, with a per-call retry for the ids a
   * batch dropped, because a single failed slot must not read as "unowned".
   */
  async scan(onProgress?: (done: number) => void): Promise<void> {
    const ids = Array.from({ length: GENESIS_SUPPLY }, (_, i) => i + 1);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const results = await ethCallBatch(slice.map(ownerCall));
      const failed: number[] = [];
      results.forEach((r, j) => {
        const addr = addrOf(r);
        if (r === null) failed.push(slice[j]!);
        else if (addr) this.record(slice[j]!, addr);
      });
      // Retry the failures one at a time before concluding anything about them.
      if (failed.length) {
        const again = await ethCallBatch(failed.map(ownerCall), CFG.rpcUrl, 2);
        again.forEach((r, j) => {
          const addr = addrOf(r);
          if (addr) this.record(failed[j]!, addr);
        });
      }
      this.scanned = Math.min(ids.length, i + CHUNK);
      onProgress?.(this.scanned);
    }
    this.ready = true;
  }

  /**
   * A single wallet's ownership, read live rather than from the index.
   *
   * The index is boot-plus-stream, so a token that moved while the server was down
   * would still be handed to its old owner, and a token that moved since the last
   * poll would be refused from under its holder. A sign-in decision is worth one
   * `eth_call`, and the answer is written back so the next ask is free.
   */
  async liveOwnerOf(tokenId: number): Promise<string | null> {
    const [r] = await ethCallBatch([ownerCall(tokenId)], CFG.rpcUrl, 2);
    const addr = addrOf(r ?? null);
    // No answer (dropped slot, or a revert for an id that does not exist) keeps the
    // map's opinion rather than reading as "nobody holds this".
    if (!addr) return this.ownerOf(tokenId);
    if (addr !== ZERO) this.record(tokenId, addr);
    return addr;
  }

  private record(tokenId: number, holder: string): void {
    const prev = this.byToken.get(tokenId);
    if (prev && prev !== holder) {
      const list = this.byWallet.get(prev);
      if (list) this.byWallet.set(prev, list.filter((t) => t !== tokenId));
    }
    this.byToken.set(tokenId, holder);
    if (!this.byWallet.has(holder)) this.byWallet.set(holder, []);
    const mine = this.byWallet.get(holder)!;
    if (!mine.includes(tokenId)) mine.push(tokenId);
  }

  /**
   * Apply a live Transfer. `from` zero-address is a mint; a `to` of zero-address
   * is a burn. Keeping this fed from the chain poll is what stops the index going
   * stale between restarts, which would otherwise mean a sold Chog still lets its
   * old owner play as it.
   */
  transfer(tokenId: number, from: string | null, to: string | null): void {
    if (to && to !== ZERO) this.record(tokenId, to.toLowerCase());
    else if (to === ZERO) {
      this.byToken.delete(tokenId);
      if (from) {
        const list = this.byWallet.get(from.toLowerCase());
        if (list) this.byWallet.set(from.toLowerCase(), list.filter((t) => t !== tokenId));
      }
    }
  }

  holdings(wallet: string): number[] {
    return [...(this.byWallet.get(wallet.toLowerCase()) ?? [])].sort((a, b) => a - b);
  }

  ownerOf(tokenId: number): string | null {
    return this.byToken.get(tokenId) ?? null;
  }
}

/**
 * One index for the process, the same way `traits` is one index for the metadata.
 * The chain poll and the sign-in routes must not be able to disagree about who
 * holds what, and two instances would mean a sold Chog staying playable for its
 * old owner on whichever map did not get the Transfer.
 */
export const ownership = new Ownership();
