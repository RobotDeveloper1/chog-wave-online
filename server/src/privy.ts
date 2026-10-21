import { PrivyClient } from '@privy-io/server-auth';
import { isAddress } from '@chog/shared';

/**
 * Privy is the only login. The client signs in with Privy's own modal
 * (wallet-only) and hands the server the session's access token; the server
 * verifies it itself and reads the wallet address out of Privy's own user
 * object — never out of the request body, which is exactly where a liar would put it.
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
  /** 'privy' for the embedded wallet, the client name for a real one. */
  walletClientType?: string;
}

/**
 * The wallet the game plays as: the player's own external wallet first — that is
 * where the Chogs live — and the embedded wallet only when nothing else is linked.
 */
function firstWallet(user: { linkedAccounts?: WalletAccount[] }): string | null {
  const wallets = (user.linkedAccounts ?? []).filter(
    (a) => a?.type === 'wallet' && isAddress(a.address) && (!a.chainType || a.chainType === 'ethereum'),
  );
  const pick = wallets.find((a) => a.walletClientType !== 'privy') ?? wallets[0];
  return pick?.address ? pick.address.toLowerCase() : null;
}

export async function verifyPrivyLogin(
  accessToken: unknown,
  idToken?: unknown,
): Promise<{ ok: true; address: string; privyUserId: string } | { ok: false; reason: string }> {
  if (typeof accessToken !== 'string' || !accessToken) return { ok: false, reason: 'need a privy access token' };
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
  // The identity token lets us cross-check who the session claims to be; without
  // one, the verified access token's own user id is who we look up.
  let user: { id: string; linkedAccounts?: WalletAccount[] };
  try {
    if (typeof idToken === 'string' && idToken) {
      user = await api.getUser({ idToken });
      if (user.id !== userId) return { ok: false, reason: 'privy tokens disagree with each other' };
    } else {
      user = await api.getUserById(userId);
    }
  } catch {
    return { ok: false, reason: 'privy would not say who that is' };
  }
  const address = firstWallet(user);
  if (!address) return { ok: false, reason: 'that privy user has no wallet yet' };
  return { ok: true, address, privyUserId: userId };
}
