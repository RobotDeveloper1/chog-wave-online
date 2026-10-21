# Mainnet launch

The recording demo runs on testnet. Going live (`pro ar`) is a config change
plus a client rebuild — no code changes, no migration. This file is the whole
procedure.

## Server: `.env`

```sh
# Point at mainnet (or delete both lines: the built-ins ARE mainnet).
MONAD_RPC=https://rpc2.monad.xyz
CHOG_GENESIS_CONTRACT=0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763

# Namespace the provenance ledger, so mainnet history never reads testnet rows.
CHAIN_ID=143

# $CHOG deposit vault (a wallet YOU control; see below). Empty = deposits off.
VAULT_ADDRESS=0x...

# Keep both for the demo:
FEED=chain        # live chain feed, not the simulator
DEV_TOKENS=1      # judges can demo any token without holding one
```

Restart the server process (`node --env-file-if-exists=../.env src/index.ts`
from `server/`). First boot on mainnet runs the provenance backfill (~900
`getLogs` windows, a few minutes depending on RPC 429s); the game is playable
while it runs, provenance fills in behind it. Watch for:

- `[owners] index ready: N tokens`
- `[provenance] backfill done` (or its progress callback)
- `/health` shows `"chainId": "143"`, `"vault": "0x..."`

Rollback is the reverse: restore the testnet `.env` values (or just unset
`CHAIN_ID`), restart. The testnet `transfers.json` is untouched — each chain
keeps its own file.

## Client: 4 lines + rebuild

Mirror the server, or holders get denied their own Chogs:

1. `client/src/wallet.ts`: `MONAD_TESTNET_CHAIN_ID` → `MONAD_CHAIN_ID`
   (import + `readonly chainId`).
2. `client/src/app/picker.ts`: lede `chog testnet replicas · monad testnet` →
   `chog genesis · monad mainnet`, and step 2 detail `a testnet Chog` →
   `a mainnet Chog`.
3. `npm run build -w client`, deploy `dist/`.

Traits, art (`/art/:id`), the token map and the 1969 metadata records are
chain-agnostic: mainnet token T is the same face and build on either chain.

## Real $CHOG ops

- **Vault**: a fresh wallet whose key never leaves the operator. It only needs
  MON for gas when paying withdrawals out.
- **Deposits** credit automatically (whole $CHOG, floored; dust is recorded
  but unpaid). Verify with a 1-$CHOG transfer to the vault, then check the
  balance in game (`chog.deposit` loop action, or the brawl sheet).
- **Withdrawals** queue for manual payout. List pendings:
  `sqlite3 <DATA_DIR>/chog-wave.db "SELECT * FROM withdraw WHERE status='pending';"`
  Pay from the vault, then mark it:
  `sqlite3 <DATA_DIR>/chog-wave.db "UPDATE withdraw SET status='paid' WHERE id=?;"`
- Every applied vault Transfer is recorded by tx hash in `deposits`: re-polls
  and restarts pay nothing twice.

## Pre-launch verify (5 min)

1. `/health` → `feed: chain`, `chainId: 143`, vault set.
2. Foster join → travel Tolls → 13 mobs, packs of 2 and 3.
3. Walk into a mob → ambush → duel → leave (see `LIVE_SMOKE`).
4. DEV_TOKENS demo of a mainnet token id → real traits + real art.
5. 1-$CHOG deposit → balance +1; withdraw request → row in `withdraw`.
