import type { HoldingsView } from '@chog/shared';
import { SERVER_HTTP } from './config.ts';
import { ensurePrivyIsland, privyIsland, waitPrivyReady } from './app/privyIsland.tsx';

/**
 * Sign-in, Privy only — the real Privy modal, wallet-only.
 *
 * Pressing connect opens Privy's own login dialog (wallet list, QR, the works);
 * the player connects an external wallet there, Privy verifies and links it, and
 * the game server then verifies the Privy access token itself before issuing a
 * game session. The address the game plays as is the EXTERNAL wallet's — the one
 * that actually holds the Chogs. No email, no socials: `loginMethods: ['wallet']`.
 *
 * The shape is the old wallet's on purpose (`session`, `restore`,
 * `holdings`, `signOut`), so the picker keeps asking the same questions and
 * only the answers change owners.
 */

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? '';
const SESSION_KEY = 'chog.session';

export interface SignIn {
  address: string;
  session: string;
}

export class Wallet {
  address: string | null = null;
  session: string | null = null;
  /** Privy wallets are chain-agnostic: once logged in, the badge is lit. */
  onMonad = false;
  /**
   * The chain the server is actually on, read off its own /health. This used
   * to be a build-time constant (testnet), which lied on mainnet — and one
   * bundle serves both sites, so a constant can never be right. 0 until asked.
   */
  chainId = 0;

  async readChain(): Promise<void> {
    try {
      const r = await fetch(`${SERVER_HTTP}/health`);
      const h = (await r.json().catch(() => null)) as { chainId?: unknown } | null;
      const id = Number(h?.chainId ?? 0);
      if (id && id !== this.chainId) {
        this.chainId = id;
        this.notify();
      }
    } catch {
      /* offline: the badge keeps its placeholder */
    }
  }

  private watchers = new Set<() => void>();
  private pending: { resolve: (s: SignIn) => void; reject: (e: Error) => void } | null = null;

  get available(): boolean {
    return APP_ID !== '';
  }

  get label(): string {
    return 'Privy';
  }

  /** The short form a nameplate needs: 0x1234…abcd. */
  get short(): string {
    return this.address ? `${this.address.slice(0, 6)}…${this.address.slice(38, 42)}` : '';
  }

  onChange(fn: () => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  private notify(): void {
    for (const fn of this.watchers) fn();
  }

  private ensure(): void {
    if (!APP_ID) throw new Error('no privy app id (VITE_PRIVY_APP_ID)');
    ensurePrivyIsland(APP_ID, () => void this.onPrivyAuth());
  }

  /**
   * Open Privy's modal and resolve when the login completes. Closing the modal
   * without logging in leaves the promise pending — nothing spins, nothing
   * errors; pressing connect again just reopens it.
   */
  loginWithModal(): Promise<SignIn> {
    this.ensure();
    const island = privyIsland();
    if (!island) return Promise.reject(new Error('privy did not start'));
    if (island.snapshot().authenticated) return this.finishSignIn();
    return new Promise<SignIn>((resolve, reject) => {
      // A newer call replaces an older one; a stale promise simply never settles.
      this.pending = { resolve, reject };
      island.openLogin();
    });
  }

  private async onPrivyAuth(): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    try {
      const signIn = await this.finishSignIn();
      pending?.resolve(signIn);
    } catch (error) {
      pending?.reject(error instanceof Error ? error : new Error('that login did not work'));
    }
    if (!pending) this.notify();
  }

  /** A session from an earlier visit, if Privy still knows us and so does the server. */
  async restore(): Promise<SignIn | null> {
    let stored: { session?: string; address?: string } | null = null;
    try {
      stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    } catch {
      stored = null;
    }
    if (!stored?.session || !APP_ID) return null;
    this.ensure();
    const ready = await waitPrivyReady();
    const snap = privyIsland()?.snapshot();
    if (!ready || !snap?.authenticated) {
      this.signOut();
      return null;
    }
    try {
      return await this.finishSignIn(stored.address ?? undefined);
    } catch {
      this.signOut();
      return null;
    }
  }

  private async finishSignIn(expectAddress?: string): Promise<SignIn> {
    const island = privyIsland();
    const snap = island?.snapshot();
    const address = snap?.address ?? null;
    if (!island || !snap?.authenticated || !address) throw new Error('privy would not say who that is');
    if (expectAddress && address !== expectAddress.toLowerCase()) {
      this.signOut();
      throw new Error('a different privy user is signed in now');
    }
    const accessToken = await island.accessToken();
    if (!accessToken) throw new Error('privy went quiet after the login');
    // The server reads the address out of Privy's own user object — never out of
    // this body, which is exactly where a liar would put it.
    const verified = await post('/api/auth/privy', { accessToken });
    if (!verified.ok || typeof verified.session !== 'string') {
      throw new Error(why(verified, 'the server would not take that login'));
    }
    this.address = String(verified.address ?? address);
    this.session = verified.session;
    this.onMonad = true;
    void this.readChain();
    localStorage.setItem(SESSION_KEY, JSON.stringify({ session: this.session, address: this.address }));
    this.notify();
    return { address: this.address, session: this.session };
  }

  async holdings(): Promise<HoldingsView> {
    if (!this.session) throw new Error('not signed in');
    const r = await get('/api/auth/holdings', this.session);
    if (!r.ok) throw new Error(why(r, 'the holdings could not be read'));
    return r as unknown as HoldingsView;
  }

  /** The server forgets the session, Privy forgets the login, the browser forgets the token. */
  signOut(): void {
    if (this.session) void post('/api/auth/signout', {}, this.session).catch(() => undefined);
    this.session = null;
    this.address = null;
    this.onMonad = false;
    try {
      void privyIsland()?.logout().catch(() => undefined);
    } catch {
      /* already out */
    }
    localStorage.removeItem(SESSION_KEY);
    this.notify();
  }
}

async function post(path: string, body: unknown, bearer?: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${SERVER_HTTP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}

async function get(path: string, bearer?: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${SERVER_HTTP}${path}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}

/** A refusal in the server's (or Privy's) own words. */
function why(reply: unknown, fallback: string): string {
  if (typeof reply === 'string' && reply) return reply;
  const reason = (reply as { reason?: unknown; message?: unknown } | null)?.reason
    ?? (reply as { message?: unknown } | null)?.message;
  return typeof reason === 'string' && reason ? reason : fallback;
}

export const wallet = new Wallet();
