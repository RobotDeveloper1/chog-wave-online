import { StrictMode, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';

/**
 * The real Privy login, as an island: this client is vanilla TS with no React
 * tree of its own, so one tiny root hosts the PrivyProvider and nothing else.
 * `openLogin()` opens Privy's own modal — wallet list, QR, the works — and the
 * island reports back through an imperative API the wallet singleton consumes.
 *
 * Wallet-only by product decision: `loginMethods: ['wallet']` shows external
 * wallets and nothing else. No email, no socials.
 */

interface LinkedLike {
  type?: string;
  address?: string;
  chainType?: string;
  /** 'privy' for the embedded wallet, the client name for a real one. */
  walletClientType?: string;
}

function playAddressOf(user: { linkedAccounts?: LinkedLike[] } | null): string | null {
  const wallets = (user?.linkedAccounts ?? []).filter(
    (a) => a?.type === 'wallet' && /^0x[0-9a-fA-F]{40}$/.test(a.address ?? ''),
  );
  const pick = wallets.find((a) => a.walletClientType !== 'privy') ?? wallets[0];
  return pick?.address ? pick.address.toLowerCase() : null;
}

export interface PrivySnapshot {
  ready: boolean;
  authenticated: boolean;
  address: string | null;
}

export interface PrivyIslandApi {
  openLogin: () => void;
  logout: () => Promise<void>;
  accessToken: () => Promise<string | null>;
  snapshot: () => PrivySnapshot;
}

let root: Root | null = null;
let api: PrivyIslandApi | null = null;

function Inner({ onAuth }: { onAuth: () => void }): null {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const mirror = useRef<PrivySnapshot>({ ready: false, authenticated: false, address: null });
  mirror.current = { ready, authenticated, address: playAddressOf(user) };
  api = {
    openLogin: () => login(),
    logout: () => logout(),
    accessToken: () => getAccessToken(),
    snapshot: () => ({ ...mirror.current }),
  };
  const was = useRef(authenticated);
  useEffect(() => {
    if (authenticated && !was.current) onAuth();
    was.current = authenticated;
  }, [authenticated, onAuth]);
  return null;
}

/** Mount the island once. `onAuth` fires on every false → true flip. */
export function ensurePrivyIsland(appId: string, onAuth: () => void): void {
  if (root || !appId) return;
  const el = document.createElement('div');
  el.id = 'privy-island';
  document.body.append(el);
  root = createRoot(el);
  root.render(
    <StrictMode>
      <PrivyProvider appId={appId} config={{ loginMethods: ['wallet'], appearance: { theme: 'dark' } }}>
        <Inner onAuth={onAuth} />
      </PrivyProvider>
    </StrictMode>,
  );
}

export function privyIsland(): PrivyIslandApi | null {
  return api;
}

/** Wait for the provider to finish loading its persisted session, if any. */
export async function waitPrivyReady(ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (api?.snapshot().ready) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !!api?.snapshot().ready;
}
