import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import { Ownership } from './owners.ts';

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
 * Sessions are short and in-memory on purpose. A two-week hackathon build should
 * not be inventing a token format; when the address needs to be proven again, the
 * wallet signs again, which costs the user one click.
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

  constructor(ownership: Ownership) {
    this.ownership = ownership;
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
    this.sessions.set(token, { address: key, made: Date.now() });
    return { ok: true, token, address: key };
  }

  /** Who a session token belongs to, or null if it is unknown or stale. */
  addressFor(token: string | undefined | null): string | null {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (Date.now() - s.made > SESSION_MS) {
      this.sessions.delete(token);
      return null;
    }
    return s.address;
  }

  signOut(token: string): void {
    this.sessions.delete(token);
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
    for (const [token, s] of this.sessions) if (now - s.made > SESSION_MS) this.sessions.delete(token);
    for (const [addr, p] of this.nonces) if (now - p.made > NONCE_MS) this.nonces.delete(addr);
  }
}
