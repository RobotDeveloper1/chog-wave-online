import { MONAD_CHAIN_ID, MONAD_CHAIN_ID_HEX, isAddress, monadChainParams, type HoldingsView } from '@chog/shared';
import { SERVER_HTTP } from './config.ts';

/**
 * The wallet sign-in, from the browser's side.
 *
 * There is no SDK here and no hosted auth service, because the game needs exactly
 * one thing from the wallet: an EIP-191 signature over a challenge the server
 * issued. Every injected provider (EIP-1193) can do that, and adding Privy or
 * WalletConnect would mean an app id that has to be registered by somebody before
 * this builds — which is a dependency, not a security improvement.
 *
 * Nothing about the wallet is trusted downstream. The signature is re-verified on
 * the server, and the Chogs this address holds are read from the chain by the
 * server's own index (`/api/auth/holdings`), not told to it by whoever is typing.
 */

interface RpcProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (arg: unknown) => void): void;
  removeListener?(event: string, handler: (arg: unknown) => void): void;
  /** EIP-6921: several injected wallets on one page arrive as a list. */
  providers?: RpcProvider[];
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
}

declare global {
  interface Window {
    ethereum?: RpcProvider;
  }
}

const SESSION_KEY = 'chog.session';

export interface SignIn {
  address: string;
  session: string;
}

/** A wallet's chain id, however it chose to hand it over: `0x8f`, `143`, or 143. */
function chainIdOf(value: unknown): number {
  if (typeof value === 'number') return value;
  const text = String(value ?? '');
  return text.startsWith('0x') ? parseInt(text, 16) : Number(text);
}

/** Providers disagree on whether a rejection is a code or a message. */
function codeOf(error: unknown): number {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : Number(String(code ?? ''));
}

function pickProvider(): RpcProvider | null {
  const injected = typeof window === 'undefined' ? undefined : window.ethereum;
  if (!injected) return null;
  // The list is ordered by the user's own default, so the first entry is the wallet
  // they would expect a signature request to come from.
  return injected.providers?.length ? injected.providers[0]! : injected;
}

function labelOf(provider: RpcProvider): string {
  if (provider.isMetaMask) return 'MetaMask';
  if (provider.isCoinbaseWallet) return 'Coinbase Wallet';
  if (provider.isRabby) return 'Rabby';
  return 'injected wallet';
}

export class Wallet {
  address: string | null = null;
  session: string | null = null;
  /** False when the connected chain is not Monad — which still proves the address, so it is a badge, not a block. */
  onMonad = false;

  private listening = false;
  private watchers = new Set<() => void>();

  get available(): boolean {
    return pickProvider() !== null;
  }

  get label(): string {
    const p = pickProvider();
    return p ? labelOf(p) : 'no wallet extension found';
  }

  /** The short form a nameplate needs: 0x1234…abcd. */
  get short(): string {
    return this.address ? `${this.address.slice(0, 6)}…${this.address.slice(38, 42)}` : '';
  }

  /** A provider that moved out from under us has to re-sign; the picker is the only listener. */
  onChange(fn: () => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  private notify(): void {
    for (const fn of this.watchers) fn();
  }

  private requireProvider(): RpcProvider {
    const p = pickProvider();
    if (!p) throw new Error('no wallet extension in this browser');
    return p;
  }

  /**
   * Ask the wallet to switch to Monad, and if it has never heard of the chain, teach it.
   *
   * A refusal is not fatal. The sign-in proves an address with a message signature,
   * which works from any chain, so somebody who declines the switch still gets their
   * Chogs — the badge just says the wallet is sitting somewhere else.
   */
  private async ensureChain(provider: RpcProvider): Promise<void> {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MONAD_CHAIN_ID_HEX }] });
    } catch (error) {
      // 4902: "unrecognized chain". Anything else — 4001 above all — is the user
      // saying no, and the answer to that is to carry on and not to nag.
      if (codeOf(error) === 4902) {
        await provider.request({ method: 'wallet_addEthereumChain', params: [monadChainParams()] });
      }
    }
    try {
      this.onMonad = chainIdOf(await provider.request({ method: 'eth_chainId' })) === MONAD_CHAIN_ID;
    } catch {
      this.onMonad = false;
    }
  }

  private listen(provider: RpcProvider): void {
    if (this.listening || !provider.on) return;
    this.listening = true;
    provider.on('accountsChanged', () => this.notify());
    provider.on('chainChanged', () => {
      void provider.request({ method: 'eth_chainId' }).then((v) => {
        this.onMonad = chainIdOf(v) === MONAD_CHAIN_ID;
        this.notify();
      }, () => this.notify());
    });
  }

  /** The connected account, without opening a popup. */
  async connected(): Promise<string | null> {
    const p = pickProvider();
    if (!p) return null;
    try {
      const accounts = (await p.request({ method: 'eth_accounts' })) as string[];
      return isAddress(accounts[0]) ? accounts[0]!.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  /**
   * Connect, sign, verify.
   *
   * The order matters: the challenge is issued for one address, so signing has to
   * happen after the account is known, and the session only exists once the server
   * has recovered the signer itself.
   */
  async connect(): Promise<SignIn> {
    const provider = this.requireProvider();
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    if (!isAddress(accounts[0])) throw new Error('the wallet returned no address');
    this.address = accounts[0]!.toLowerCase();
    await this.ensureChain(provider);
    this.listen(provider);

    const issued = await post('/api/auth/nonce', { address: this.address });
    if (!issued.ok || typeof issued.message !== 'string') {
      throw new Error(why(issued, 'the server would not issue a challenge'));
    }

    let signature: unknown;
    try {
      signature = await provider.request({ method: 'personal_sign', params: [issued.message, this.address] });
    } catch (error) {
      if (codeOf(error) === 4001) throw new Error('signature declined in the wallet');
      throw new Error('this wallet refused to sign a message');
    }
    if (typeof signature !== 'string') throw new Error('the wallet returned no signature');

    const verified = await post('/api/auth/verify', { address: this.address, signature });
    if (!verified.ok || typeof verified.session !== 'string') {
      throw new Error(why(verified, 'the signature did not verify'));
    }
    this.session = verified.session;
    this.address = String(verified.address ?? this.address);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ session: this.session, address: this.address }));
    return { address: this.address, session: this.session };
  }

  /**
   * A session from an earlier visit, if it still means what it meant then.
   *
   * Both halves are checked: the server has to still know the token, and the wallet
   * still has to be connected to the address that signed for it. A stored token for
   * an account that has since been swapped out is not a login, it is somebody else's.
   */
  async restore(): Promise<SignIn | null> {
    let stored: { session?: string; address?: string } | null = null;
    try {
      stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    } catch {
      stored = null;
    }
    if (!stored?.session) return null;
    const here = await this.connected();
    if (!here || here !== stored.address?.toLowerCase()) {
      this.signOut();
      return null;
    }
    const r = await get('/api/auth/session', stored.session);
    if (!r.ok || String(r.address ?? '').toLowerCase() !== here) {
      this.signOut();
      return null;
    }
    this.address = here;
    this.session = stored.session;
    const provider = pickProvider();
    if (provider) {
      await this.ensureChain(provider);
      this.listen(provider);
    }
    return { address: here, session: this.session };
  }

  async holdings(): Promise<HoldingsView> {
    if (!this.session) throw new Error('not signed in');
    const r = await get('/api/auth/holdings', this.session);
    if (!r.ok) throw new Error(why(r, 'the holdings could not be read'));
    return r as unknown as HoldingsView;
  }

  /** The server forgets the session and the browser forgets the token. */
  signOut(): void {
    if (this.session) void post('/api/auth/signout', {}, this.session).catch(() => undefined);
    this.session = null;
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

/** A refusal in the server's own words, since what it will not do is its policy, not ours. */
function why(reply: Record<string, unknown>, fallback: string): string {
  return typeof reply.reason === 'string' && reply.reason ? reply.reason : fallback;
}

export const wallet = new Wallet();
