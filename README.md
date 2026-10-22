# CHOG Wave Online

A street-level monster-RPG on Monad: walk the city as your Chog, clear The Line,
run dungeon folds, duel on the grid with cards + dodge, trade, brawl, party up.
Your Chog's traits are its deck, its speed and its weaknesses.

**Play now:** [chogwave.online](https://chogwave.online) (mainnet, real $CHOG)
· [demo.chogwave.online](https://demo.chogwave.online) (testnet recording build).
Judges start here: [SUBMISSION.md](./docs/trailer/SUBMISSION.md).

## Demo in 3 steps (no wallet, no chain)

```sh
npm install

# terminal 1 — the game server (synthetic feed, any token playable)
FEED=synthetic DEV_TOKENS=1 npm run dev -w server

# terminal 2 — the client
npm run dev -w client
```

Open http://localhost:5173, pick **foster chog**, spawn by the quest board.
Server health: http://localhost:8787/health.

Windows (PowerShell):

```powershell
$env:FEED='synthetic'; $env:DEV_TOKENS='1'; npm run dev -w server
npm run dev -w client
```

## The loop

City quest board → Sim (your first card) → The Line (safe camp in the middle,
mobs drop cards and items where they fall) → dungeon folds (draft 1-of-3 after
combat nodes, shrines thin the deck) → grid duels (cards + dodge, no buster).

Right-click any Chog on the street: party invite, whisper, friend, brawl, trade.
Y/N answers invites. Trait cards never leave their token — not by trade, sale or shrine.

## Full mode (wallet + testnet)

Copy `.env.example` to `.env` and follow it: Privy app (wallet-only login),
Monad testnet (chain 10143), the replica contract. Details in
[TESTNET.md](./TESTNET.md). Without chain config the server runs the synthetic
feed instead; mainnet is the default (see [MAINNET.md](./MAINNET.md)).

## Scripts

| command                 | what                       |
| ----------------------- | -------------------------- |
| `npm test`              | shared + server suites     |
| `npm run typecheck`     | shared + server + client   |
| `npm run build`         | client bundle (`dist/`)    |
| `npm run coop`          | co-op smoke check          |

## Layout

- `shared/` — cards, duel formula, economy, dungeons, protocol. The rules live here.
- `server/` — world, battles, profiles, trade, Privy auth. Never trusts the client.
- `client/` — street, duels, sheets, HUD. Three.js + DOM.
- `contracts/` — the testnet replica + deploy scripts.
- `docs/` — systems, architecture, audit, music, The Line, duel blueprint.
