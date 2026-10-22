# Mainnet launch

Mainnet is live at <https://chogwave.online> (testnet recording build at
<https://demo.chogwave.online>). Both run the same code; the chain is config.
This file is the whole procedure.

## Server: `.env`

```sh
# Point at mainnet (or delete both lines: the built-ins ARE mainnet).
MONAD_RPC=https://rpc2.monad.xyz
CHOG_GENESIS_CONTRACT=0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763

# Namespace the provenance ledger, so mainnet history never reads testnet rows.
CHAIN_ID=143

# $CHOG vault + hot wallet (same address; see "Real $CHOG ops" below).
# Empty vault = deposits off (paper mode); empty key = manual payout queue.
VAULT_ADDRESS=0x...
HOT_WALLET_KEY=0x...

# Live chain feed, not the simulator.
FEED=chain

# NEVER on mainnet: DEV_TOKENS=1 lets anyone play any token without holding
# it. It exists for the testnet recording build only.
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

## Client: no per-chain edits

One bundle serves both sites: the client is chain-agnostic (Privy login, no
chain switch) and the picker badge reads the chain off the server's own
`/health`. Rebuild and deploy `dist/` whenever client code changes —
`npm run build -w client` with `VITE_PRIVY_APP_ID` set — but never to switch
chains.

Traits, art (`/art/:id`), the token map and the 1969 metadata records are
chain-agnostic: mainnet token T is the same face and build on either chain.

## Real $CHOG ops

- **Vault = hot wallet**: one fresh address does both jobs. Player deposits
  capitalize it, so it only ever needs MON for gas from the operator. Its key
  lives in `HOT_WALLET_KEY` (host env + root-only backup) and is never logged.
- **Deposits** credit automatically (whole $CHOG, floored; dust is recorded
  but unpaid), two blocks after they land. Verify with a 1-$CHOG transfer to
  the vault, then check the balance in game (CASH tab).
- **Withdrawals** pay automatically: request debits the ledger and queues;
  the pump claims each row once, checks the float, sends the transfer, and
  settles `done` with the tx hash — or settles `failed` and refunds. Only
  deposited coins can ever leave (the grant is play money); caps are 500 per
  wager, 2000 per wallet per day. Watch it live:
  `SELECT id, wallet, amount, status, tx FROM withdraw ORDER BY id DESC LIMIT 10;`
- Every applied vault Transfer is recorded by tx hash in `deposits`: re-polls
  and restarts pay nothing twice. Statuses: `pending` → `sending` → `done`
  (or `failed`, refunded).

## Pre-launch verify (5 min)

1. `/health` → `feed: chain`, `chainId: 143`, vault set.
2. Foster join → travel Tolls → 13 mobs, packs of 2 and 3.
3. Walk into a mob → ambush → duel → leave.
4. Holder login → real traits + real art for the held token.
5. 1-$CHOG deposit → balance +1; withdraw 1 → payout tx on the explorer.
