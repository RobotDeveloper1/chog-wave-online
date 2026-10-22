# CHOG WAVE — systems (judge-readable, code-linked)

Every claim below names the file that implements it. Paths are repo-rooted.

## Auth — Privy wallet or Foster

- `client/src/app/picker.ts` — the gate: connect, holdings grid, 3D detail, enter.
- `client/src/wallet.ts` + `client/src/app/privyIsland.tsx` — real Privy modal, wallet-only login.
- `server/src/auth.ts` — the server verifies the Privy access token itself, then
  issues a 6h session; ownership is re-checked on join, so the grid is a request, not a claim.
- No Chog? "Walk in as a Foster Chog" plays without a wallet.

## The street — Genesis City

- `server/src/world.ts` — sectors, sites, NPCs, quests, chat, announcements.
- `client/src/app/shell.ts` — the 3D client: movement, camera, HUD, attract mode.
- Quests come from the quest board (`WAGMI` first); quest state lives in `server/src/profiles.ts`.

## The Line — Tolls, packs, ambush

- `shared/src/line/` — mob defs, drift/aggro, bands of 2–3.
- `server/src/world.ts` (`stepSessions`, `killLineMob`, `releaseLineBodies`) — aggro
  pursuit, duel trigger on contact, corpse despawn + respawn, loot.
- Mobs near spawn are weaker and drop weaker cards; stats scale with distance.

## Duel — six cards, one element

- `shared/src/session.ts` — the duel session model, files/lanes, element locks.
- `server/src/battle.ts` — server-owned picks, programs, phases, boss tiers.
- `client/src/app/duel/` — field grid, custom (hand) screen, firing order, previews.
- Pick up to 3 cards of one element (keys 1–6), Enter executes; moving files/lanes
  dodges and banks Charge. Kills drop cards (`08` in the trailer).

## Housing

- `shared/src/housing.ts` — `FURNITURE`, `STARTER_FURNITURE`, `HouseLayout`.
- `server/src/profiles.ts` — per-save house + furniture inventory.
- `server/src/world.ts` (`house.get/enter/leave/place/pickup/rotate/invite/accept`) —
  visit, decorate, and invite friends over.

## Anomaly — volume is the raid boss

- `shared/src/anomaly.ts` — `volumeOf()` aggregates priced fills, `hotSector()` picks
  where the rift opens.
- `server/src/feed.ts` — `surge()` wires collection trading into spawns in both modes.
- `server/src/chain.ts` — live Seaport fills off Monad RPC; `server/src/battle.ts`
  (`bossTier: 'anomaly' | 'storm'`) runs the fight. In-game: `STORM RIFT · GO TO THE STATION`.

## Dungeons

- `shared/src/dungeonData.ts` — `DUNGEONS` defs.
- `server/src/world.ts` (`area.open`, `attachFold`/`openDungeon`) — folds open from
  the menu; the street hides while inside. `playMusic('dungeon')` scores them.

## Party

- `server/src/index.ts` (`msg.t === 'link' | 'party'`) → `world.partyAction` — invites,
  shared fights, boss HP/loot scaling by bodies and owners (`server/src/battle.ts`).

## PvP — brawls with real stakes

- `server/src/world.ts` (`pvpAction`, `case 'challenge'`) — open challenges, accept/decline.
- `server/src/save.ts` (`escrow` table) — stakes deducted at accept, refunded on crash.
- `shared/src/economy.ts` — `MAX_WAGER = 500`, 5% rake (`WAGER_RAKE_BPS`), `wagerPayout()`.
- `client/src/app/brawlPage.ts` — wager picker showing the split before anything moves.

## $CHOG — real token in and out

- `server/src/chain.ts` (`depositOf`) + `world.creditDeposits` — vault Transfers credit
  whole $CHOG once per tx hash; dust is recorded, not credited.
- `server/src/payouts.ts` — automatic payouts: pending rows claimed atomically, paid
  by one ERC-20 transfer from the hot wallet, settled `done` with the tx hash;
  failures refund the ledger and settle `failed`. Stale `sending` rows recover on boot.
- Caps: `WITHDRAW_DAILY_MAX = 2000` per wallet per UTC day (`server/src/save.ts`
  `withdrawDailyTotal`); requests above it are refused before any debit.
- Config: `VAULT_ADDRESS` (deposits) + `HOT_WALLET_KEY` (signer) in `server/src/config.ts`;
  empty vault = paper mode, empty key = manual queue. `chog.deposit` returns vault +
  balance; `chog.withdraw` debits, queues, and pays automatically when configured.

## Ranks, chain feed, music

- Ranks: four boards in `server/src/profiles.ts` (the rake vault never appears).
- Feed: `server/src/chain.ts` + `server/src/feed.ts` — `chain` mode off Monad RPC,
  `synthetic` for offline; always namespaced per `CHAIN_ID`.
- Music: `client/src/music.ts` plays one `CHOG WORLD ORDER` render per scene with
  2 s crossfades (`docs/MUSIC.md`); the gate scores `title` on open.

## Trailer (reproducible)

- Capture: `tools/trailer-shoot/` (`lib.mjs` + `shot-*.mjs`) — Playwright video +
  in-page audio, deterministic PvP setup over the net protocol.
- Takes: `docs/trailer/shots/` (17 finals). Voice: `docs/trailer/voice/` (`lines.txt`
  + clips). Build: `docs/trailer/remotion/` (`npm run render`).
