import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GENESIS_SUPPLY } from '@chog/shared';

/**
 * Wallet sign-in, end to end.
 *
 * This is the only path in the project where a bug is a security hole rather than a
 * bad frame: if `verify` accepted something that does not prove control of an
 * address, every rule built on top of it — which Chogs are yours, whether you may
 * play one — stops meaning anything. So the signatures here are real EIP-191
 * signatures from real `viem` local accounts, not a stubbed verifier. A test that
 * mocked `verifyMessage` would prove nothing except that the mock works.
 *
 * The chain is faked, and only the part the auth code asks it about: a local
 * JSON-RPC server that answers `ownerOf` from a map. That is deliberate — the
 * behaviour worth pinning is "a refusal gets re-checked against the chain before it
 * is acted on", and on the public RPC that answer belongs to whoever bought the
 * token this afternoon, so it cannot be asserted on Tuesday and trusted on Friday.
 */

const ZERO = '0x0000000000000000000000000000000000000000';
/** Whatever the test map says nothing about, the fake chain hands to this wallet. */
const OTHER = '0x0000000000000000000000000000000000000002';

/** tokenId -> holder, as the fake chain reports it. */
const chainHolders = new Map<number, string>();
/** `eth_call`s served, so "the index answered this without going to the chain" is assertable. */
let calls = 0;

const word = (addr: string) => '0x' + addr.slice(2).toLowerCase().padStart(64, '0');

let rpc: Server;

/**
 * One `eth_call` responder for `ownerOf(uint256)`. Anything else comes back as an
 * error, which the batch layer reads as a dropped slot — the same shape a real
 * node's missing entry has, so the retry path stays exercised rather than mocked out.
 */
function startFakeRpc(): Promise<string> {
  rpc = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let requests: { id?: number; method?: string; params?: unknown[] }[];
      try {
        const parsed = JSON.parse(body);
        requests = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end('[]');
        return;
      }
      const replies = requests.map((call) => {
        const id = call.id ?? 0;
        if (call.method !== 'eth_call') return { id, error: { message: 'unknown method' } };
        const params = call.params as [{ data?: string }?];
        const data = params?.[0]?.data ?? '';
        if (!data.startsWith('0x6352211e')) return { id, error: { message: 'not ownerOf' } };
        calls++;
        const tokenId = Number(BigInt(`0x${data.slice(10)}`));
        return { id, result: word(chainHolders.get(tokenId) ?? OTHER) };
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(replies));
    });
  });
  return new Promise((resolve) => {
    rpc.listen(0, '127.0.0.1', () => {
      const { port } = rpc.address() as { port: number };
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

type Account = ReturnType<typeof import('viem/accounts').privateKeyToAccount>;

let dir: string;
let accounts: typeof import('viem/accounts');
let Auth: typeof import('../src/auth.ts').Auth;
let Ownership: typeof import('../src/owners.ts').Ownership;
let ownership: typeof import('../src/owners.ts').ownership;
let holdingsView: typeof import('../src/wallet.ts').holdingsView;

const NONCE_MS = 5 * 60 * 1000;
const SESSION_MS = 6 * 60 * 60 * 1000;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-auth-'));
  const rpcUrl = await startFakeRpc();
  process.env.DATA_DIR = dir;
  // No local metadata: every card is predicted from the id, so the assertions about
  // `traitsSource` hold whatever happens to be on disk.
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.MONAD_RPC = rpcUrl;
  // After the env, because `config.ts` reads it once at import time.
  accounts = await import('viem/accounts');
  ({ Auth } = await import('../src/auth.ts'));
  ({ Ownership, ownership } = await import('../src/owners.ts'));
  ({ holdingsView } = await import('../src/wallet.ts'));
});

afterAll(() => {
  rpc?.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* windows keeps a handle on the temp tree for a moment */
  }
});

afterEach(() => {
  vi.useRealTimers();
  chainHolders.clear();
});

/** A wallet we can actually sign with. */
const account = (): Account => accounts.privateKeyToAccount(accounts.generatePrivateKey());

/** The whole handshake, driven the way the client drives it. */
async function signIn(auth: InstanceType<typeof Auth>, w: Account) {
  const issued = auth.nonce(w.address);
  const signature = await w.signMessage({ message: issued.message });
  return auth.verify(w.address, signature);
}

describe('the challenge', () => {
  it('names the game, the nonce and the expiry, so a signer can read what they approve', () => {
    const ts = Date.now();
    const text = Auth.challenge('ab12', ts);
    expect(text).toContain('Chog Wave Online');
    expect(text).toContain('nonce: ab12');
    expect(text).toContain(new Date(ts).toISOString());
    expect(text).toContain('no transaction is requested');
  });

  it('changes with the nonce and the moment, so a captured signature has nothing to replay into', () => {
    expect(Auth.challenge('aa', 1)).not.toEqual(Auth.challenge('bb', 1));
    expect(Auth.challenge('aa', 1)).not.toEqual(Auth.challenge('aa', 2));
  });
});

describe('sign-in', () => {
  it('accepts an EIP-191 signature over its own challenge', async () => {
    const auth = new Auth(new Ownership());
    const w = account();
    const r = await signIn(auth, w);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.address).toBe(w.address.toLowerCase());
    expect(auth.addressFor(r.token)).toBe(w.address.toLowerCase());
  });

  it('normalises the address it is handed, so casing is not a second identity', async () => {
    const auth = new Auth(new Ownership());
    const w = account();
    const shouted = `0x${w.address.slice(2).toUpperCase()}`;
    const issued = auth.nonce(shouted);
    const signature = await w.signMessage({ message: issued.message });
    const r = await auth.verify(shouted, signature);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.address).toBe(w.address.toLowerCase());
  });

  it('refuses before a nonce exists', async () => {
    const auth = new Auth(new Ownership());
    const w = account();
    const signature = await w.signMessage({ message: Auth.challenge('never-issued', Date.now()) });
    expect(await auth.verify(w.address, signature)).toEqual({ ok: false, reason: 'ask for a nonce first' });
  });

  it('refuses a signature over somebody else’s challenge', async () => {
    const auth = new Auth(new Ownership());
    const w = account();
    auth.nonce(w.address);
    const forged = await w.signMessage({ message: Auth.challenge('not-the-issued-nonce', Date.now()) });
    expect(await auth.verify(w.address, forged)).toEqual({
      ok: false,
      reason: 'signature does not match that address',
    });
  });

  it('refuses a signature from a wallet other than the address claimed', async () => {
    const auth = new Auth(new Ownership());
    const claimant = account();
    const signer = account();
    const issued = auth.nonce(claimant.address);
    const signature = await signer.signMessage({ message: issued.message });
    expect(await auth.verify(claimant.address, signature)).toEqual({
      ok: false,
      reason: 'signature does not match that address',
    });
  });

  it('consumes the nonce, so one signature buys one session', async () => {
    const auth = new Auth(new Ownership());
    const w = account();
    const issued = auth.nonce(w.address);
    const signature = await w.signMessage({ message: issued.message });
    expect((await auth.verify(w.address, signature)).ok).toBe(true);
    expect(await auth.verify(w.address, signature)).toEqual({ ok: false, reason: 'ask for a nonce first' });
  });

  it('expires a nonce rather than leaving it open forever', async () => {
    const auth = new Auth(new Ownership());
    const w = account();
    const issued = auth.nonce(w.address);
    const signature = await w.signMessage({ message: issued.message });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + NONCE_MS + 1);
    expect(await auth.verify(w.address, signature)).toEqual({ ok: false, reason: 'nonce expired' });
  });

  it('rejects a malformed signature instead of throwing', async () => {
    const auth = new Auth(new Ownership());
    const w = account();
    auth.nonce(w.address);
    expect(await auth.verify(w.address, '0xnothex')).toEqual({ ok: false, reason: 'malformed signature' });
    // Two different wallets, both mid-handshake: neither parse attempt may take the server down.
    auth.nonce(OTHER);
    expect(await auth.verify(OTHER, '0x')).toEqual({ ok: false, reason: 'malformed signature' });
  });

  it('drops a session on sign-out', async () => {
    const auth = new Auth(new Ownership());
    const r = await signIn(auth, account());
    if (!r.ok) throw new Error(r.reason);
    expect(auth.addressFor(r.token)).toBe(r.address);
    auth.signOut(r.token);
    expect(auth.addressFor(r.token)).toBeNull();
  });

  it('expires a session that outlives its window', async () => {
    const auth = new Auth(new Ownership());
    const r = await signIn(auth, account());
    if (!r.ok) throw new Error(r.reason);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + SESSION_MS + 1);
    expect(auth.addressFor(r.token)).toBeNull();
  });

  it('does not treat the session token as a guessable stand-in for the address', async () => {
    const auth = new Auth(new Ownership());
    const r = await signIn(auth, account());
    if (!r.ok) throw new Error(r.reason);
    expect(r.token).not.toContain(r.address);
    expect(auth.addressFor(`${r.token.slice(0, -1)}0`)).toBeNull();
    expect(auth.addressFor(undefined)).toBeNull();
    expect(auth.addressFor('')).toBeNull();
  });

  it('prunes expired sessions and keeps live ones', async () => {
    const auth = new Auth(new Ownership());
    const stale = await signIn(auth, account());
    if (!stale.ok) throw new Error(stale.reason);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + SESSION_MS + 1);
    const fresh = await signIn(auth, account());
    if (!fresh.ok) throw new Error(fresh.reason);
    auth.prune();
    expect(auth.addressFor(stale.token)).toBeNull();
    expect(auth.addressFor(fresh.token)).toBe(fresh.address);
  });
});

describe('what a signed-in wallet may play', () => {
  /** An index the test filled by hand, the way the chain poll fills the real one. */
  /** A wallet the index *and* the fake chain agree holds these tokens. */
  function seeded(holder: string, tokens: number[]) {
    const o = new Ownership();
    for (const t of tokens) {
      o.transfer(t, ZERO, holder);
      chainHolders.set(t, holder);
    }
    return o;
  }

  it('lists the holdings the index knows, and nothing else', () => {
    const o = seeded(OTHER, [4, 11, 3]);
    expect(o.holdings(OTHER)).toEqual([3, 4, 11]);
    expect(o.holdings('0x0000000000000000000000000000000000000003')).toEqual([]);
  });

  it('answers `playable` from the index, so a caller cannot name its own tokens', () => {
    const w = account();
    const auth = new Auth(seeded(w.address.toLowerCase(), [9, 2]));
    expect(auth.playable(w.address)).toEqual([2, 9]);
    expect(auth.playable(OTHER)).toEqual([]);
  });

  it('moves a holding on a Transfer, so a sold Chog stops being playable', async () => {
    const w = account();
    const buyer = account();
    const buyerKey = buyer.address.toLowerCase();
    const o = seeded(w.address.toLowerCase(), [5]);
    const auth = new Auth(o);
    expect(await auth.mayPlay(w.address, 5)).toBe(true);
    o.transfer(5, w.address.toLowerCase(), buyerKey);
    chainHolders.set(5, buyerKey);
    expect(o.ownerOf(5)).toBe(buyerKey);
    expect(auth.playable(w.address)).toEqual([]);
    expect(await auth.mayPlay(w.address, 5)).toBe(false);
    expect(await auth.mayPlay(buyer.address, 5)).toBe(true);
  });

  it('honours a holding the index has not seen yet, because the chain is the answer', async () => {
    // The case `auth.ts` promises: the map only moves when the poll sees a Transfer,
    // so a Chog that sold while the server was down would otherwise deny the person
    // standing in front of it with the right wallet.
    const w = account();
    chainHolders.set(777, w.address.toLowerCase());
    const auth = new Auth(new Ownership());
    expect(auth.playable(w.address)).toEqual([]);
    expect(await auth.mayPlay(w.address, 777)).toBe(true);
  });

  it('refuses a token the chain says belongs to somebody else', async () => {
    const w = account();
    chainHolders.set(778, OTHER);
    const auth = new Auth(new Ownership());
    expect(await auth.mayPlay(w.address, 778)).toBe(false);
    expect(await auth.mayPlay(OTHER, 778)).toBe(true);
  });

  it('asks the chain on every join, and writes the answer back into the index', async () => {
    const w = account();
    const holderKey = w.address.toLowerCase();
    const o = new Ownership();
    const auth = new Auth(o);
    chainHolders.set(779, holderKey);
    const before = calls;
    expect(await auth.mayPlay(w.address, 779)).toBe(true);
    expect(calls).toBe(before + 1);
    expect(o.ownerOf(779)).toBe(holderKey);
    expect(await auth.mayPlay(w.address, 779)).toBe(true);
    expect(calls).toBe(before + 2);
  });

  it('refuses a Chog the index still credits, because a sold token is not playable', async () => {
    // The hole this closes: the map only moves when the poll sees a Transfer, so a
    // positive read is a claim about the past. Answering a join from it would let
    // somebody play a Chog they sold seconds ago — with its provenance, its crit
    // rate, and a nameplate claiming it is theirs.
    const w = account();
    const holderKey = w.address.toLowerCase();
    const o = seeded(holderKey, [780]);
    const auth = new Auth(o);
    expect(await auth.mayPlay(w.address, 780)).toBe(true);
    chainHolders.set(780, OTHER);
    expect(o.ownerOf(780)).toBe(holderKey);
    expect(await auth.mayPlay(w.address, 780)).toBe(false);
    // The chain's answer was written back on the way out, so the grid stops offering a
    // Chog the join already refused.
    expect(auth.playable(w.address)).toEqual([]);
  });

  it('treats a burn as nobody holding it', () => {
    const o = seeded(OTHER, [12]);
    o.transfer(12, OTHER, ZERO);
    expect(o.ownerOf(12)).toBeNull();
    expect(o.holdings(OTHER)).toEqual([]);
  });
});

describe('the picker’s cards', () => {
  let holder: string;

  beforeAll(() => {
    holder = account().address.toLowerCase();
    // The singleton the route reads from, seeded the way `scan()` would leave it.
    ownership.transfer(1462, ZERO, holder);
    ownership.transfer(3, ZERO, holder);
    ownership.transfer(4, ZERO, OTHER);
  });

  it('shows only this wallet’s Chogs, in id order', () => {
    const view = holdingsView(holder);
    expect(view.address).toBe(holder);
    expect(view.tokens.map((t) => t.tokenId)).toEqual([3, 1462]);
  });

  it('carries the same build the world will run at join time', () => {
    const [first] = holdingsView(holder).tokens;
    expect(first?.build.tokenId).toBe(3);
    expect(typeof first?.build.callsign).toBe('string');
    expect(first?.element).toBeTruthy();
    expect(first?.linkSlots).toBeGreaterThanOrEqual(3);
    expect(first?.linkSlots).toBeLessThanOrEqual(5);
    expect(['real', 'predicted']).toContain(first?.traitsSource);
  });

  it('does not claim provenance for a wallet that is not the holder', () => {
    const card = holdingsView(OTHER).tokens.find((t) => t.tokenId === 4);
    expect(card?.provenance.daysHeld).toBe(0);
    expect(card?.provenance.transferCount).toBe(0);
  });

  it('says when the index has not finished reading, instead of answering “you hold nothing”', () => {
    const view = holdingsView(holder);
    // `scan()` has not run in this process, so `ready` stays false even with two
    // tokens known — and that flag is exactly what the picker polls on.
    expect(view.ready).toBe(false);
    expect(view.tokens.length).toBe(2);
    expect(view.coverage).toBeLessThanOrEqual(GENESIS_SUPPLY);
  });
});
