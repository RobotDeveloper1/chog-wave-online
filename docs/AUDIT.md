# CHOG WAVE — security & performance audit (2026-10-22)

Focused pass over money, auth and the hot paths before the closed demo.
Every finding names the file; every fix names the test.

## Fixed

### 1. Withdrawals payable from paper balances (CRITICAL)

`chog.withdraw` checked only the ledger balance and the daily cap. Every wallet
starts with `STARTING_CHOG` (1000) play money, so any fresh wallet could
withdraw real $CHOG it never deposited and drain the hot wallet.

- Fix: a wallet can only ever withdraw what it deposited —
  `SaveStore.depositedBy` (`server/src/save.ts`) sums floored per-tx deposits,
  and the withdraw gate (`server/src/world.ts`, `chog.withdraw`) refuses
  anything above `deposited − alreadyOut`. Lifetime invariant per wallet:
  **withdrawn ≤ deposited**, so the house can never pay out more than it took in.
- Tests: `withdrawal provenance` in `server/test/payouts.test.ts` (paper
  refused, 5.9 → 5 of allowance, dust 0.5+0.5 → 0).

### 2. `/api/dev/*` levers open on prod (HIGH)

`surge`, `heat`, `fill`, `reset` had no auth, and Caddy proxies `/api/*` —
griefing buttons for the whole street (fake sales/anomalies, wave resets).
`reset()` only zeroes waves, not accounts, but a fake anomaly during judging
is still a lie on screen.

- Fix: the four routes 404 unless `DEV_LEVERS=1` (`server/src/index.ts`).
  Local work sets it in `.env`; the host envs do not; the game never calls them.
- The trailer/coop tools under `tools/` call these against localhost — run the
  local server with `DEV_LEVERS=1` when using them.

### 3. Deposit poll credits at head, ignores reorgs (MEDIUM)

The chain poll scanned `toBlock=head` and never checked `log.removed`, so a
reorged deposit stayed credited — a phantom credit is a real payout.

- Fix: two blocks of confirmations (`toBlock=head−2`, `lastBlock` advances to
  it) plus skipping `removed` logs (`server/src/chain.ts`). Two seconds of
  delay, invisible to players.

### 4. Poll skipped deposits after downtime (MEDIUM)

After a >900-block gap the poll clamped to the head and never looked back —
deposits in the gap would sit uncredited until re-sent.

- Fix: `nextWindow` (`server/src/chain.ts`) walks one window per tick from the
  oldest unseen block. Steady state is byte-identical (one small window);
  catch-up just takes one tick per 900 blocks.
- Test: `nextWindow` in `server/test/deposits.test.ts`.

## Checked and sound

- **Auth**: Privy access token verified server-side with id-token cross-check
  (`server/src/privy.ts`); raw wallet login is EIP-191 over single-use 5-minute
  nonces, 6h random sessions persisted to sqlite (`server/src/auth.ts`).
- **PvP escrow**: dual debit with rollback, persisted escrow row, one settle
  funnel with a `told` flag, boot refund, prizes keyed by saveKey (survive
  disconnects).
- **Payout pump** (`server/src/payouts.ts`): atomic claim, float requeue,
  fail-refund, boot recover with receipt re-check. Unit-tested with a fake chain.
- **Trades**: holdings re-checked at accept, single-threaded apply, no dup.
- **Combat**: server-side sessions; hands, cells, cooldowns and damage all
  resolve in `SF.*` — the client only names intentions. Wins are read off the
  live session, never off the message (`line.clear`).
- **Movement**: speed-clamped against the last accepted position; teleports
  get walked at run speed. Doors park/restore coordinates, so room trips
  cannot teleport.
- **Dungeon/quests/shop**: node steps gated by `canEnter` (no boss skip);
  turn-ins proximity-checked with server-side progress; shop prices and
  ownership server-side; items consumed before effects.
- **Chat**: 160 chars, control chars stripped, 6/10 s; client escapes on render.
- **WS**: 60 msg/s + burst 150, 1 MB cap, 15 s heartbeat. CORS `*` is fine —
  bearer tokens, no cookies.
- **Secrets**: `HOT_WALLET_KEY` never logged; `/health` exposes the vault
  (public) but no secrets.

## Accepted risks (demo scope)

- **Rake** accumulates to the ledger-internal `VAULT_KEY`, which has no cashout
  path — paper sink for now.
- **Daily cap is per wallet**, so a determined user can split across wallets.
  Inherent without identity; the 2000 cap bounds the damage.
- **Catch-up gap**: fixed (see §4) — the poll now walks the gap instead of
  skipping it. A multi-hour outage still takes ~1 tick per 900 blocks to
  drain; fine for deploys, revisit before open launch.
- **Mixed-coin wagering**: the invariant is per-wallet net (withdrawn ≤
  deposited), not per-coin taint. A depositor can always take back up to what
  they put in, never more.

## Performance

No changes needed for a closed demo:

- Server broadcasts one snapshot per room (rooms are capped) at 20 Hz; the
  chain poll clamps its window and retries incomplete batches without
  advancing; the ledger flush is debounced with atomic rename.
- Client renders from `InstancedMesh` throughout, DPR capped at 1.75, with
  quality presets (pixel cap, shadows, post) in OPTIONS.
- Scaling note: broadcast is O(rooms) and the chain poll is one window per
  tick — fine for tens of players; re-measure past a hundred.
