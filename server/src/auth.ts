import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import { Ownership } from './owners.ts';
import type { SaveStore } from './save.ts';

/**
 * Wallet sign-in.
 *
 * There is no password here and no account to make: the proof of identity is an
 * EIP-191 signature over a nonce the server issued, which is the only thing that
 * actually demonstrates the caller controls the address rather than merely
 * typing it into a field. Everything downstream — which Chogs are theirs, whether
 * they may play one — hangs off that, so a bypass here is a bypass of the whole
 * premise.
 *
 * Sessions are short (6h) and random-hex — no invented token format — but they
 * survive a restart: with a store attached, every session is written through to
 * sqlite and reloaded on boot, so a deploy stops logging the whole street out.
 * Without one (tests), the map is the whole store and behaviour is unchanged.
 */

const SESSION_MS = 6 * 60 * 60 * 1000;
const NONCE_MS = 5 * 60 * 1000;

interface Pending {
  nonce: string;
  made: number;
}

interface Session {
  address: string;
  made: number;
}

export class Auth {
  private nonces = new Map<string, Pending>();
  private sessions = new Map<string, Session>();

  private readonly ownership: Ownership;
  private readonly saves: SaveStore | null;

  constructor(ownership: Ownership, saves?: SaveStore) {
    this.ownership = ownership;
    this.saves = saves ?? null;
    // Stale rows die here, not on first use: a boot that replays dead sessions
    // would hand out hours of ghost access before anything pruned them.
    if (this.saves) {
      const now = Date.now();
      this.saves.sessionPrune(now - SESSION_MS);
      for (const s of this.saves.sessionsAll()) this.sessions.set(s.token, { address: s.address, made: s.made });
    }
  }

  private keep(token: string, address: string, made: number): void {
    this.sessions.set(token, { address, made });
    this.saves?.sessionPut(token, address, made);
  }

  private drop(token: string): void {
    this.sessions.delete(token);
    this.saves?.sessionDel(token);
  }

  /**
   * The message a wallet is asked to sign. It names the game, the nonce and the
   * expiry so a signature captured from one session cannot be replayed into
   * another, and so a user can read what they are approving.
   */
  static challenge(nonce: string, ts: number): string {
    return [
      'Chog Wave Online sign-in',
      `nonce: ${nonce}`,
      `issued: ${new Date(ts).toISOString()}`,
      'valid for 5 minutes; no transaction is requested',
    ].join('\n');
  }

  nonce(address: string): { nonce: string; message: string } {
    const key = address.toLowerCase();
    const nonce = randomBytes(12).toString('hex');
    const ts = Date.now();
    this.nonces.set(key, { nonce, made: ts });
    return { nonce, message: Auth.challenge(nonce, ts) };
  }

  /** Returns the session token, or why the signature did not establish the address. */
  async verify(address: string, signature: string): Promise<{ ok: true; token: string; address: string } | { ok: false; reason: string }> {
    const key = address.toLowerCase();
    const pending = this.nonces.get(key);
    if (!pending) return { ok: false, reason: 'ask for a nonce first' };
    if (Date.now() - pending.made > NONCE_MS) {
      this.nonces.delete(key);
      return { ok: false, reason: 'nonce expired' };
    }
    let recovered: string;
    try {
      const valid = await verifyMessage({
        address: key as `0x${string}`,
        message: Auth.challenge(pending.nonce, pending.made),
        signature: signature as `0x${string}`,
      });
      recovered = valid ? key : '';
    } catch {
      return { ok: false, reason: 'malformed signature' };
    }
    this.nonces.delete(key);
    if (!recovered) return { ok: false, reason: 'signature does not match that address' };
    const token = randomBytes(24).toString('hex');
    this.keep(token, key, Date.now());
    return { ok: true, token, address: key };
  }

  /** Who a session token belongs to, or null if it is unknown or stale. */
  addressFor(token: string | undefined | null): string | null {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (Date.now() - s.made > SESSION_MS) {
      this.drop(token);
      return null;
    }
    return s.address;
  }

  /**
   * A Privy login the server already verified adopts a game session. The address
   * arrived inside Privy's own user object, not the request, so by the time this
   * runs there is nothing left to prove — only a token to hand over.
   */
  adoptPrivy(address: string): string {
    const token = randomBytes(24).toString('hex');
    this.keep(token, address.toLowerCase(), Date.now());
    return token;
  }

  signOut(token: string): void {
    this.drop(token);
  }

  /**
   * The Chogs a signed-in wallet may play. Ownership is read from the index, so
   * this cannot be talked into handing out someone else's token.
   */
  playable(address: string): number[] {
    return this.ownership.holdings(address);
  }

  /**
   * Does this address actually hold this token right now?
   *
   * Answered by the chain, not by the index. The map only moves when the poll sees a
   * Transfer, so a positive read from it is a *claim about the past*: a Chog sold a
   * moment ago would keep playing for its old owner until the next poll caught up, and
   * provenance is exactly the thing that decides a Chog's crit rate. One `eth_call` per
   * join is cheap. When the RPC does not answer, `liveOwnerOf` falls back to the map's
   * opinion rather than locking a whole street out of the game.
   */
  async mayPlay(address: string, tokenId: number): Promise<boolean> {
    return (await this.ownership.liveOwnerOf(tokenId)) === address.toLowerCase();
  }

  prune(now = Date.now()): void {
    for (const [token, s] of this.sessions) if (now - s.made > SESSION_MS) this.drop(token);
    this.saves?.sessionPrune(now - SESSION_MS);
    for (const [addr, p] of this.nonces) if (now - p.made > NONCE_MS) this.nonces.delete(addr);
  }
}
