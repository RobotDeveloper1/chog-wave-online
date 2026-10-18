import { PrivyClient } from '@privy-io/server-auth';
import { isAddress } from '@chog/shared';

/**
 * Privy is the only login. The client signs in with Privy (email code, social,
 * or an external wallet) and hands the server both tokens; the server verifies
 * them itself and reads the wallet address out of Privy's own user object —
 * never out of the request body, which is exactly where a liar would put it.
 *
 * Unconfigured (no PRIVY_APP_ID/SECRET) this refuses everything with words
 * instead of throwing at import time, so the game still boots for local work
 * and says plainly why nobody can sign in.
 */

let client: PrivyClient | null = null;
let misconfigured = '';

function privy(): PrivyClient {
  if (client) return client;
  const appId = process.env.PRIVY_APP_ID ?? '';
  const appSecret = process.env.PRIVY_APP_SECRET ?? '';
  if (!appId || !appSecret) {
    misconfigured = 'privy is not configured (PRIVY_APP_ID/PRIVY_APP_SECRET)';
    throw new Error(misconfigured);
  }
  client = new PrivyClient(appId, appSecret);
  return client;
}

interface WalletAccount {
  type?: string;
  address?: string;
  chainType?: string;
}

/** The first Ethereum wallet on the Privy user, embedded or external. */
function firstWallet(user: { linkedAccounts?: WalletAccount[] }): string | null {
  for (const a of user.linkedAccounts ?? []) {
    if (a?.type === 'wallet' && isAddress(a.address)) {
      if (!a.chainType || a.chainType === 'ethereum') return a.address!.toLowerCase();
    }
  }
  return null;
}

export async function verifyPrivyLogin(
  accessToken: unknown,
  idToken: unknown,
): Promise<{ ok: true; address: string; privyUserId: string } | { ok: false; reason: string }> {
  if (typeof accessToken !== 'string' || !accessToken) return { ok: false, reason: 'need a privy access token' };
  if (typeof idToken !== 'string' || !idToken) return { ok: false, reason: 'need a privy identity token' };
  let api: PrivyClient;
  try {
    api = privy();
  } catch {
    return { ok: false, reason: misconfigured };
  }
  let userId: string;
  try {
    const claims = await api.verifyAuthToken(accessToken);
    userId = claims.userId;
  } catch {
    return { ok: false, reason: 'privy did not vouch for that token' };
  }
  let user: { id: string; linkedAccounts?: WalletAccount[] };
  try {
    user = await api.getUser({ idToken });
  } catch {
    return { ok: false, reason: 'privy would not say who that is' };
  }
  if (user.id !== userId) return { ok: false, reason: 'privy tokens disagree with each other' };
  const address = firstWallet(user);
  if (!address) return { ok: false, reason: 'that privy user has no wallet yet' };
  return { ok: true, address, privyUserId: userId };
}
