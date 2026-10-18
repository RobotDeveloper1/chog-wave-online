import Privy from '@privy-io/js-sdk-core';
import { defineChain } from 'viem';
import { MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_EXPLORER_URL, MONAD_TESTNET_RPC_URL, isAddress, type HoldingsView } from '@chog/shared';
import { SERVER_HTTP } from './config.ts';

/**
 * Sign-in, Privy only.
 *
 * There is no injected provider here and no EIP-191 challenge: the player logs
 * in with Privy (email code today, whatever the dashboard enables tomorrow),
 * Privy hands them an embedded wallet, and the server verifies both Privy
 * tokens itself before issuing a game session. The address the game plays as
 * is the embedded wallet's — everybody gets one, holder or not, which is
 * exactly what keeps the foster path alive: no Chogs on it just means the
 * shelf is empty, not that the door is shut.
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

interface LinkedWallet {
  type?: string;
  address?: string;
  chainType?: string;
}

function embeddedAddressOf(accounts: LinkedWallet[] | undefined): string | null {
  for (const a of accounts ?? []) {
    if (a?.type === 'wallet' && isAddress(a.address) && (!a.chainType || a.chainType === 'ethereum')) {
      return a.address!.toLowerCase();
    }
  }
  return null;
}

export class Wallet {
  address: string | null = null;
  session: string | null = null;
  /** Privy wallets are chain-agnostic: once logged in, the badge is lit. */
  onMonad = false;
  readonly chainId = MONAD_TESTNET_CHAIN_ID;

  private privy: Privy | null = null;
  private watchers = new Set<() => void>();

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

  private requirePrivy(): Privy {
    if (!APP_ID) throw new Error('no privy app id (VITE_PRIVY_APP_ID)');
    if (!this.privy) {
      // The embedded wallet defaults to the first supported chain, so Monad
      // testnet goes first: fresh wallets are born where the replica lives.
      const monadTestnet = defineChain({
        id: MONAD_TESTNET_CHAIN_ID,
        name: 'Monad Testnet',
        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
        rpcUrls: { default: { http: [MONAD_TESTNET_RPC_URL] } },
        blockExplorers: { default: { name: 'MonadExplorer', url: MONAD_TESTNET_EXPLORER_URL } },
      });
      // Privy's storage speaks JSON values, localStorage speaks strings: translate.
      const storage = {
        get: (key: string): unknown => {
          const raw = localStorage.getItem(`privy:${key}`);
          if (raw === null) return undefined;
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return raw;
          }
        },
        put: (key: string, value: unknown): void => {
          localStorage.setItem(`privy:${key}`, JSON.stringify(value));
        },
        del: (key: string): void => {
          localStorage.removeItem(`privy:${key}`);
        },
        getKeys: (): string[] => {
          const out: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith('privy:')) out.push(k.slice('privy:'.length));
          }
          return out;
        },
      };
      this.privy = new Privy({ appId: APP_ID, storage, supportedChains: [monadTestnet] });
    }
    return this.privy;
  }

  /** Step one of the email login: Privy sends the code, we wait for it. */
  async requestCode(email: string): Promise<void> {
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('that email does not look like one');
    try {
      await this.requirePrivy().auth.email.sendCode(clean);
    } catch (error) {
      throw new Error(why(error, 'privy would not send a code'));
    }
  }

  /**
   * Step two: the code becomes a Privy user, the user gets an embedded wallet
   * if they have none, and both Privy tokens buy a game session from the
   * server — which verifies them itself before believing a word.
   */
  async confirmCode(email: string, code: string): Promise<SignIn> {
    const privy = this.requirePrivy();
    const clean = email.trim().toLowerCase();
    try {
      await privy.auth.email.loginWithCode(clean, code.trim(), 'login-or-sign-up');
    } catch (error) {
      throw new Error(why(error, 'that code did not work'));
    }
    return this.finishSignIn(privy);
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
    const privy = this.requirePrivy();
    let live: string | null = null;
    try {
      live = await privy.getAccessToken();
    } catch {
      live = null;
    }
    if (!live) {
      this.signOut();
      return null;
    }
    try {
      return await this.finishSignIn(privy, stored.address ?? undefined);
    } catch {
      this.signOut();
      return null;
    }
  }

  private async finishSignIn(privy: Privy, expectAddress?: string): Promise<SignIn> {
    let accounts: LinkedWallet[] | undefined;
    try {
      const { user } = await privy.user.get();
      accounts = (user as { linkedAccounts?: LinkedWallet[] }).linkedAccounts;
    } catch (error) {
      throw new Error(why(error, 'privy would not say who that is'));
    }
    let address = embeddedAddressOf(accounts);
    if (!address) {
      try {
        const updated = await privy.embeddedWallet.create({});
        accounts = (updated as unknown as { linkedAccounts?: LinkedWallet[] }).linkedAccounts ?? accounts;
        address = embeddedAddressOf(accounts);
      } catch (error) {
        throw new Error(why(error, 'no wallet came with that login'));
      }
    }
    if (!address) throw new Error('that login has no wallet to play as');
    if (expectAddress && address !== expectAddress.toLowerCase()) {
      this.signOut();
      throw new Error('a different privy user is signed in now');
    }
    let accessToken: string | null = null;
    let idToken: string | null = null;
    try {
      accessToken = await privy.getAccessToken();
      idToken = await privy.getIdentityToken();
    } catch (error) {
      throw new Error(why(error, 'privy went quiet after the login'));
    }
    const verified = await post('/api/auth/privy', { accessToken, idToken });
    if (!verified.ok || typeof verified.session !== 'string') {
      throw new Error(why(verified, 'the server would not take that login'));
    }
    this.address = String(verified.address ?? address);
    this.session = verified.session;
    this.onMonad = true;
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
      void this.privy?.auth.logout();
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
