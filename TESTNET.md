# Chog on Monad testnet + Privy login

The game runs against a disposable replica collection on Monad testnet
(chain `10143`) and signs everybody in with Privy. Mainnet is untouched:
nothing here moves real Chogs or real MON.

## 1. Privy app (dashboard, 5 minutes)

1. Create an app at <https://dashboard.privy.io>.
2. Login methods: **wallet only** — the game opens Privy's own wallet modal,
   no email, no socials.
3. Chains: add **Monad Testnet** — id `10143`, RPC
   `https://testnet-rpc.monad.xyz`, currency MON, explorer
   `https://testnet.monadexplorer.com`.
4. Allowed origins: add `http://localhost:5173` (and the preview URL, if any).
5. Copy the **App ID** and the **App Secret**.

## 2. Deployer key (testnet only)

1. Make a throwaway wallet (a fresh MetaMask account is fine).
2. Fund it at <https://faucet.monad.xyz>.
3. Export its private key. This key must never hold mainnet funds —
   the deploy script refuses to run without `0x` + 64 hex chars, but it
   cannot tell testnet keys from mainnet ones. That part is on you.

## 3. Point the game at Privy

Server (same shell, or a `.env` file the process reads):

```powershell
$env:MONAD_RPC = 'https://testnet-rpc.monad.xyz'
$env:CHOG_GENESIS_CONTRACT = '0x...'   # from step 5, after the deploy
$env:PRIVY_APP_ID = '...'
$env:PRIVY_APP_SECRET = '...'
npm run start -w server
```

Client (Vite bakes `VITE_*` at startup, so restart `dev` after setting):

```powershell
$env:VITE_PRIVY_APP_ID = '...'
npm run dev -w client
```

Or copy `.env.example` to `.env` and fill it in. Without the contract
address yet, start the server with the mainnet contract (or none —
`synthetic` mode): login works, the shelf is just empty.

## 4. First login (foster)

1. Open the game, hit connect, pick your wallet in Privy's modal.
2. No Chogs on it yet → the shelf is empty and **foster** is the way in,
   exactly like before.
3. Copy your full wallet address (your wallet app shows it; the game shows
   it short): it is `MINT_TO` in the next step.

## 5. Deploy the replica and mint to yourself

First give the replica its faces — pick mainnet ids whose traits travel
to testnet #1, #2, … (same order as the mint, so the counts must match):

```powershell
cd C:\Users\Kauker\Desktop\chog
npm run meta -w @chog/contracts -- 1462 1 1969
```

Then deploy and mint:

```powershell
$env:DEPLOYER_KEY = '0x...'      # throwaway testnet key
$env:MINT_TO = '0x...'           # your Privy embedded wallet from step 4
$env:MINT_COUNT = '3'            # same count as the ids above
npm run deploy -w @chog/contracts
```

The script prints `CHOG_GENESIS_CONTRACT=0x...`: put it in the server env
and restart the server. Re-run the script any time to mint more (ids
continue from `totalSupply + 1`). With test Chogs on the wallet → pick
and play; builds are derived from the token id until real trait metadata
exists.

## What changed in code

- `contracts/ChogTestnet.sol` — minimal ERC-721 (`tCHOG`), no
  dependencies, `ownerOf`/`Transfer` shaped like Genesis so the
  ownership index works unmodified.
- `contracts/scripts/{compile,deploy}.mjs` — solc-js build, viem deploy
  + mint. Refuses to run without a key, a recipient, or faucet funds.
- `shared/src/chain.ts` — `MONAD_TESTNET_*` constants.
- `client/src/wallet.ts` — Privy only (wallet modal → `POST /api/auth/privy`).
  Same outward shape, so the picker barely changed; foster flow untouched.
- `server/src/privy.ts` + `POST /api/auth/privy` — verifies both Privy
  tokens with `@privy-io/server-auth`, reads the wallet off Privy's own
  user object, issues a game session. Unconfigured servers refuse with
  words (`privy is not configured`), they do not crash.
