# Chog Wave Online — architecture and how it works

> A complete map of the game: what it is, how the code is laid out, where every number
> comes from, and what is genuinely finished versus what is written-but-unwired.
> Written to be handed to another model (or a new session) as working context.
>
> Everything below is true of the tree as of **2026-10-09**. Section 14 lists the gaps
> deliberately, because refining against a description of features that are not wired
> yet is worse than refining against an honest one.

---

## 1. The premise in one paragraph

Chog Wave Online is a **browser MMORPG** built for **Chogathon 2026** around the *Chog
Genesis* collection (1,969 NFTs on Monad). The world is a 2.5D street — 3D models on a
2D gameplay plane — framed like a **DS clamshell**: a 3D world on top, a 2D terminal
below (Custom Screen, tape, chat, waves). Trading activity in the *real* collection
drives the game: aggregate buy/sell volume raises a per-district **Wave Index**, and
crossing thresholds opens **anomalies** whose *archetype* is decided by the **shape** of
the flow, not just its size. Your own Chog determines your element, your born card, your
stat profile and your tribe. If you hold no NFT you can still play, through a **foster**
token with a provenance ceiling.

**Judging weights** (the reason for the design): Novelty 30% · Fun 20% · Retention 20% ·
Clarity 15% · Execution 15%, tie-broken by Novelty then Retention. The NFT must be
*essential* to winning, not decorative.

---

## 2. Repository layout

npm workspaces monorepo on git (+ GitHub). Three packages plus tooling.

```
chog/
  shared/    @chog/shared    pure game model — no DOM, no node, no three
  server/    @chog/server    node + ws + node:sqlite authoritative host
  client/    @chog/client    vite + three.js dual-screen shell
  contracts/ testnet replica collection + deploy scripts
  tools/     node/python scripts: checks, verifiers, generators, trailer capture
  blender/   local 3D scratch (gitignored)
  .data/     metadata, traits.json, sprites, sqlite db, generated art
  docs/      systems, architecture, audit, music, design refs
```

`shared` is imported by both `server` and `client` and is the only place gameplay rules
live. If a rule exists in two places, that is a bug.

### Commands

| what | command |
|---|---|
| all tests | `npm test` (shared then server) |
| typecheck everything | `npm run typecheck` |
| dev (server :8787 + vite :5173) | `npm run dev` |
| client build | `npm run build` |
| shared tests only | `npm run test -w shared` |
| regenerate the Album universe | `node tools/gen-album.mjs` |
| attribute-per-token report | `node tools/formula-report.mjs` |
| measured DPS / TTK / window report | `node tools/pacing-report.mjs` |
| co-op / authority check against a live server | `npm run coop` — needs `DEV_TOKENS=1` + `DEV_LEVERS=1` on the server it points at; see §7.4 |

TypeScript is `strict` with **`noUncheckedIndexedAccess: true`** — every array/object
index read is `T | undefined`. This is why `pick()` and explicit guards exist in the
client geometry code; do not "simplify" them away.

---

## 3. Runtime topology

```
browser ── vite :5173 ──┬── /            shell entry (src/app/shell.ts)
                        ├── /shell.html  same shell (legacy alias)
                        ├── /api,/chogs  proxied → :8787
                        └── /ws          proxied (ws:true) → :8787

server :8787 ──── HTTP routes (index.ts)
               ├── /api/auth/{nonce,verify,privy,session,signout,holdings}  (auth.ts + privy.ts + owners.ts)
               ├── WebSocket world session
               ├── chain poller (chain.ts, adaptive ~1s tick, 2-block confirmations)
               ├── payout pump ($CHOG withdrawals, every 15s + on request)
               ├── node:sqlite  .data/chog-wave.db (WAL)
               └── .data/sprites/*.png atlases served on demand
```

`client/vite.config.ts` proxies to `process.env.VITE_PROXY ?? http://localhost:8787`, and
the port to `VITE_PORT ?? 5173`; the server port is `process.env.PORT ?? 8787`. Two dev
servers on one machine therefore no longer have to fight over one world — point the second
at its own server instead of sharing a world neither session started.

**One client entry exists.** `index.html` → `main.ts` → `bootShell()` is the
Three.js dual-screen build that everything in sections 9–11 belongs to.
(An old Phaser entry was removed; nothing references it. Shared: `net.ts`, `config.ts`,
`sprites.ts` and `audio.ts`.)

---

## 4. Shared model (`shared/src/`)

| file | owns |
|---|---|
| `types.ts` | `Element`, `Chip`, `Placement`, `GridScore`, `ChogLoadout`, `ChogBuild`, `SaveView`, `ChogSource` |
| `chips.ts` | 18 core + 9 signature + 15 voice + 8 style + 4 form cards = `CHIPS_ALL`, plus the lookup maps |
| `grid.ts` | `scoreGrid()` — damage from shape placement, resonance, fill |
| `derive.ts` | `deriveBuild(source)` — the whole NFT→build pipeline, `buildFolder()` |
| `folder.ts` | the deck a Chog fights with: slots and shape from the NFT, contents from the bag |
| `traits.ts` | all 272 trait values → meaning; `loadoutOf()`, element ring, `affinityKeys()`, the cascades |
| `formula.ts` | `profileOf`, `allocate`, `provenance`, budget constants |
| `custom.ts` | 3×2 Custom Screen, selection locks, queue, charge |
| `fusion.ts` | 9 GA cards, 9 recipes, `resolveTurn()` |
| `field.ts` | 3×5 lane field, coverage, chain, boss drift, mirror attack |
| `duel.ts` | the duel's numbers: `telegraphMs`/`volleyGapMs`/`chargeMsFor`, `volleyDamage`/`volleyAnchor` bands, the seven archetypes, `validateProgram`, `autoPlace`, `planProgram` |
| `draft.ts` | the immutable pick/place/lift draft and its live `preview()` — the client's Custom Screen is this file, not a copy of the rules |
| `party.ts` | every party number (§7.5): HP/power/reward scaling, formation, cross-link, pincer, revive |
| `loop.ts` | the loop **measured**: `dpsProfile`/`expectedDps` per band and level, `attritionFor`, `nodeBudget`, `FUN` time windows, `duelTierOf` — what `dungeon.ts` budgets against and `tools/pacing-report.mjs` prints |
| `wave.ts` | sectors, Wave Index, tiers, boss spawn, `applyDamage`, signals, `seasonKey` |
| `city/` | the city as data, not a stage set: `types.ts` plans, `zones.ts` the three districts (`cityOf`, npc/poi/door tables), `layout.ts` the deterministic block-and-street geometry, `waves.ts` the Mystery Wave route |
| `anomaly.ts` | `SaleFact`, `classify()`, `volumeOf()`, `hotSector()`, `volumePressure()` |
| `protocol.ts` | every wire type |
| `progress.ts` | XP curve, levels, unlock gates |
| `economy.ts` | WAV, bag, items, shop stock, prices |
| `quest.ts` | story chain, objectives, bounties, log state machine |
| `questbook.ts` | the people's errands, level-1–3, each finished by *going* somewhere |
| `dungeon.ts` | Data Area generation, node graph, run state machine — every node's HP and bite comes from `loop.ts nodeBudget`, not a guessed band |
| `dungeonData.ts` | the six dungeons outside the city as one table (`DUNGEONS`, `DUNGEON_BY_ID`): element, level gate, open-after prerequisite, boss archetype |
| `album.ts` + `albumData.ts` | trait Album, rarity weights, completions |
| `tribe.ts` | weekly war ledger, control, board, prizes |
| `chain.ts` | the one copy of the chain id and contract addresses, read from mainnet, shared so the wallet switch and the ownership scan cannot disagree |
| `holdings.ts` | the shapes the sign-in endpoints answer with, so the picker draws from the same `deriveBuild` the world runs at join |
| `version.ts` | `GAME_NAME` + `BUILD_VERSION`, so the HUD, `/health` and the boot log print one string |

`shared/src/index.ts` re-exports all of them; import from `'@chog/shared'`.

---

## 5. The market → anomaly pipeline (the headline mechanic)

### 5.1 Where money is read

An ERC-721 `Transfer` carries **no price** — 852 of 2,074 transfer txs contain no money
at all, so a plain Transfer must never be presented as a sale. The venue is **Seaport on
Monad**:

- contract `0x0000000000000068f116a894984e2db1123eb395`
- `OrderFulfilled` topic0 `0x9d9af8e3…cdcb6f31` — the **6-parameter v1.6** spelling
- data head `[orderHash, fulfiller, offerOffset, considerationOffset]`; offsets are byte
  offsets (÷32 for words); OfferItem 4 words, ConsiderationItem 5
- a matched order emits **two legs in one tx** → `dedupeFills()` keyed by `(tx, tokenId)`,
  preferring the leg with **distinct counterparties** (the listing leg reports its own
  offerer as fulfiller and fakes a self-trade)
- `WMON = 0x3bd359c1119da7da1d913d1c4d2b7c461115433a` ≈ MON 1:1; ~⅓ of fills settle in WMON

Implemented in `server/src/seaport.ts`, polled by `server/src/chain.ts`
(`priceTransfers`), windowed by `CFG.logWindow = 900` blocks against `rpc2.monad.xyz`
(the only endpoint tolerating ~10k-block `getLogs`; `rpc.monad.xyz` caps at 100).
**Receipts must be fetched one at a time** — batched fetches failed 173/2074.

`server/src/feed.ts` has two modes behind one interface: `chain` (real) and `synthetic`
(`synthetic.ts`, a surge generator). `injectFills` runs in both, which is what lets a
demo drive real code paths. `/api/world` reports `feed.mode` and a per-kind tally so
"is this the real chain?" is answerable from the client.

### 5.2 Volume, not one big sale

`volumeOf(fills)` aggregates the **collection's** turnover over `VOLUME_WINDOW_MS = 15min`
into `{mon, trades, wallets, tokens, bySector}`. `marketPulse()` re-measures every 10s and
pushes `market-volume` events split per sector. `hotSector(v)` picks the district where
the floor is actually moving — that district is where anomalies open, where the war pays
double, and where shop prices rise.

### 5.3 Wave Index (`wave.ts`)

Per sector, 0…`WAVE_CAP = 120`, decaying `DECAY_PER_SEC = 0.02`. Ambient traffic alone
cannot exceed `AMBIENT_CEILING = 52`.

| tier | at | boss HP |
|---|---|---|
| glitch | 45 | 12,000 |
| anomaly | 70 | 26,000 |
| storm | 95 | 55,000 |

`bossHp(tier, players)` scales +55% per extra participant. `LOCKOUT_MS = 90_000` prevents
instant re-spawn. `salePressure(mon)` has slope 3.0 — chosen because with 2.5 the median
real sale (9,140 MON) scored 42.85, just under the glitch threshold.

### 5.4 The five archetypes

`classify()` reads the *shape* of the flow, keyed to real priced-sale behaviour:

| archetype | trigger | what it does to the fight | tier |
|---|---|---|---|
| `spark` | single mid-size sale | fast, low HP | glitch |
| `mirror` | **round trip** both directions | throws your own last program back | anomaly |
| `front` | many small buys | blocks a file | anomaly |
| `surge` | volume ≥ `SURGE_RATIO = 3`× baseline | fires two adjacent files | storm |
| `baron` | one fill ≥ `BARON_AT_MON = 15_000` | centre-file only, armoured | storm |

Guards learned the hard way: `PRICE_FLOOR/CEIL = 1_000/20_000` clamps, and
`ADDRESS_CAP_MON = 25_000` stops a single whale from being read as the whole market.
Mirror requires flow in **both** directions — a loyal repeat buyer is not a wash trade.
`openAnomaly()` bypasses threshold and lockout and **escalates** an existing boss rather
than spawning a second one.

---

## 6. NFT → build: the formula

`deriveBuild(source: ChogSource)` in `shared/src/derive.ts`. Input is `{tokenId,
transferCount, daysHeld, attributes?}`.

```
attributes ──traits.ts──▶ loadout (element, style, profile, gear, voice, form, sector…)
                         │
                         ├─ element cascade:  Aura → Skin → Background → Base → tokenId
                         ├─ signature cascade: Accessory → Mouth → Eyes → Base → null
                         ▼
affinityKeys(loadout, attributes) ──▶ AFFINITY weights ──▶ profileOf() = a/Σa
                         ▼
allocate(profile, budget)   budget = BASE_BUDGET(30) + tierIndex*BUDGET_PER_TIER(3)
                            ATTR_MIN 2, ATTR_MAX 10, six attrs PWR GRD SPD SIG RES CAP
                            largest-remainder apportionment, clamped on BOTH passes
                         ▼
provenance(transferCount, daysHeld)
   affinity = 1 − e^(−transfers/6)
   ceiling  = 1 − 0.9·affinity          ← a *ceiling*, not a multiplier
   clean    = min(ceiling, daysHeld/180)
                         ▼
ChogBuild { attrs, waveAffinity, cleanSignal, cleanCeiling, damageBonus,
            aggroRadius, crit, linkSlots(3..5), library[], signature, audit, loadout }
```

**The design intent, in one line each:**
- rarity buys **breadth** (bigger budget), not height (no attribute exceeds 10)
- a heavily-flipped Chog is **loud forever**: the ceiling cannot be bought back by time
- `audit` is a recomputable proof string, shown in the inspect panel

Measured on 493 real tokens (`tools/formula-report.mjs`): **454/493 distinct attribute
profiles**, 31 distinct held signature cards, budgets 30/33/36/39/42 by tier.

Why the cascades exist: **Aura covers only 50% of tokens and Accessory only 9%**, so the
two headline couplings were inert for most of the collection. Every trait category now
feeds something through a fallback chain. All 272 values are mapped; `invert()` throws on
duplicates, which is how a silent trait collision would be caught.

---

## 7. Combat

### 7.1 Custom Screen (`custom.ts`)
3 rows × 2 cols, `QUEUE_MAX = 6`, `CHARGE_MS = 9000`. Selecting a card **locks** its row
and column; `canSelect()` returns the reason (`duplicate|column|row|full|already|empty`).
`buriedCells()` implements physical coverage — a big card buries smaller ones, which is
what makes Support/Single-use decisions matter.

### 7.2 The field (`field.ts`)
`FIELD_COLS 3 × FIELD_ROWS 5`, `LANE_MS 90`. Lane index **counts down** from the near row
(growing it hit the far boss at t=0 — a real bug, fixed). `covers()` replaced an earlier
`occupies()` that compared an absolute row to an offset. `CHAIN_STEPS = [1,1.15,1.3,1.45,1.6]`,
and the **first card in a chain scores nothing**. `bossDrift()` moves the boss per beat;
`mirroredAttack()` replays your own program.

### 7.3 Fusion (`fusion.ts`)
9 GA cards, 9 recipes (6 element triples + 3 named). `resolveTurn()` allows **one merge per
turn** and grants the fused card once.

### 7.4 Server authority (`server/src/battle.ts`)
`BattleSession` runs the *same* pure field the client replays, so "did the card land" is
decided once. Key API:

- `fire(id, placements, warded)` → returns the placements **actually** queued
- `step(dtMs, sectors)` → `{events, cleared}`; `nodeFight` sessions keep their own HP and
  never touch the sector's Wave Index
- `bossVolley()` per archetype — this is where an archetype stops being a health bar
- `heal(id, n)` / `hpOf(id)` for items; `join(p, hp)` takes the level-derived field HP
- `occupiedCols()` + `Social.shieldHeld()` implement the **Link ward**: an anomaly warded
  by a party takes no damage unless two linked players stand in **adjacent files**

That last rule is the co-op promise: a warded fight is unwinnable alone no matter how
good the program is. `server/test/social.test.ts` asserts `shieldHeld` (solo always holds the
ward up, two adjacent files drop it, a body on the floor cannot), and §7.5's field tests assert
what happens to a program fired into a ward.

`tools/coop-check.mjs` (`npm run coop`) is the end-to-end check: three real sockets through
join, move, fire, laser, clear and re-join against a running server, asserting both the
*transport* (every client sees the same token set, the same boss HP, the same save) and the
*authority* rules from outside — a teleport is walked at `MAX_SPEED` instead of honoured, an
unowned chip scores zero, the server's `scoreGrid` equals the client's. It has to run against
a probe server, because the join guard asks the wallet session for the tokenId
(`index.ts:291`) and a scripted client cannot sign:

```
DEV_TOKENS=1 PORT=8799 DATA_DIR=.data/probe node server/src/index.ts &
WS=ws://localhost:8799/ws node tools/coop-check.mjs     # → 22/22
```

Pointed at a server without `DEV_TOKENS=1` it now says so (`join refused as 1: sign in with a
wallet first`, exit 2). Until this round it printed `timeout joining as 1` after eight seconds,
because the `Client` promise only settled on `welcome` and a `{t:'rejected'}` had no handler —
which is how an auth gate came to look like broken netcode.

### 7.5 The party as a mechanic (`shared/src/party.ts`)

Pure, integer-or-simple-float, every function handed `now` — so the server decides it and the
client predicts the same numbers. It answers exactly three questions and nothing else.

**How much bigger the fight gets.** `partyHpScale(n,'node') = n^0.9` (trash grows
sub-linearly: four players clear a wave in ~87% of solo time) vs `partyHpScale(n,'boss') =
n^1.18` (a four-man core has ~5x HP and runs ~28% longer). The asymmetry is deliberate: a
boss core is the only place the party mechanics have time to fire. `partyPowerScale(n) =
n^0.5` — the incoming bite grows far slower than the health pool, so per body a party is
*safer*, and that margin is what revives and pincers are spent on.

**What members earn.** `partyRewardScale(size, owners)` counts **distinct wallets**, not
bodies: a second body from an owner already counted is worth `ALT_WEIGHT = 0.35` of a person
and pays `BODY_TAX` on top. Four humans earn 1.48 each; four boxes farmed by one wallet earn
at or under 1. This is the invariant the whole design lives on — multi-boxing is never the
faster route.

**What standing next to each other makes possible.** Three things, all field-side:
- *Cross-link* — `crossLink({self, now, recent, party})` is the party's answer to the element
  chain: a partner's volley of the **same element** inside `LINK_WINDOW_MS = 1500` adds
  `0.1` per partner (max 2), `+0.05` for an adjacent file, `+0.07` when every body on the
  field is fielding that element. Capped at `CROSS_LINK_MAX = 1.32`, and the multiplier is
  multiplied into the projectile's `scale`, so it lands in the same slot a crit does.
  `linkTag()` gives the word that goes over the head (`LINK` / `CROSS-LINK` / `HARMONY LINK`).
- *Pincer* — `pincerBonus(files)`: 1.12 when the party holds all three files, 1.05 for two.
  The tension is the point: the ward pays for *converging* on adjacent files, the pincer pays
  for *spreading*, so a two-person party must choose per pull and a three-person party can
  have both.
- *Cover* — `canRevive` / `reviveFraction` / `revivedHp`: hold position one file away for
  `REVIVE_HOLD_MS = 2000` and the body comes up at `REVIVE_PCT = 0.4` of its field HP. The
  cost is that the rescuer stops shooting; stepping away, firing, opening the Custom Screen,
  taking a hit or the target's grace expiring all break the hold, and the server decides each
  one. `DOWN_GRACE_MS = 12_000` is the clock on the body itself.

Every claim a client could lie about — adjacency, "my partner was hit inside the window",
"I was covering them" — is recomputed from the roster server-side. `server/test/duel.test.ts`
pins these on a live `BattleSession` with a fixed die, including the numbers leaving the hand.

---

## 8. The MMO fabric (`server/src/world.ts`, `social.ts`)

- `ROOM_CAP = 24` per instance; a room is **congestion relief, not a separate world** —
  the Wave Index and boss live on the *sector*, so every Voltgrid instance chips the same
  anomaly
- `TOWN = {minX:-47, maxX:47, minY:-16, maxY:16, maxSpeed:14}` in **world units** (they
  were pixels once, which silently pinned every player to one side of the road)
- `move()` validates position, speed and animation names server-side
- `Social`: presence, parties (`link` merges partial parties, refuses only combined > 4),
  `shieldHeld`, trade `offer/accept` which **re-checks holdings at accept** so a card
  cannot be duplicated
- chat: bounded log (60), channels global/sector/local/party, control chars stripped
- `roster()`, `tribeTally()`, `recentAnomalies()`, `simulateSale()` (the demo lever)
- `snapshot(forPlayerId)` is **per-room**, so a client sees its own instance

---

## 9. Progression loop (new, this session)

All of it is server-decided; the client asks, `Profiles` answers.

### 9.1 XP and levels (`progress.ts`)
`LEVEL_CAP = 50`, `xpToLevel(L) = round(28·(L−1)^1.6)`. Sources: clear (`xpForClear(tier,
damage, scale)` — banded per tier `6/26/55/96`, damage only tips it by up to +50% so chip-spam
cannot farm, then multiplied by `partyRewardScale(size, owners)`, see §7.5), Data Area room,
quest, first-time
sighting. **The party scale is decided once**, at `world.ts:1745`, from `ownersOf(group)`
(distinct wallets; a wallet-less Foster counts as a person) and then carried into
`profiles.onClear({…, scale})` → `warPoints` → `pointsForClear(tier, scale)`. There is no
separate "split penalty" step any more — the alt tax lives inside `partyRewardScale`, because
two caps on the same number drift apart. **Levels buy breadth, never height** — `LEVEL_AFFECTS` lists the only fields that
may move (`queueSlots, areaTier, laserCharges, bagCap, chargeScale, fieldHp`) and a test
asserts nothing else changes. A level-1 token holder can still out-damage a level-40
foster player. Gates: lv3 Delta · lv6 +queue · lv8 Sigma · lv12 2nd laser · lv16 Omega ·
lv20 charge −12% · lv24 bag 48 · lv30 Storm Core · lv36 3rd laser · lv42 +queue.

### 9.2 Economy (`economy.ts`)
Currency **WAV**. Items: `med, repair, amp, ward, scan, pack`. `amp` = +25% next program,
`ward` = burn through a Link ward **alone** (the money answer to the friendship answer),
`scan` = reveal archetype/tribe. Prices and rarity both scale with **real collection
volume**: `priceFactor` 0.75–2.2, `rarityBias` 0–0.85. A hot floor makes the shop
expensive and rare stock appear — one real-world event drives danger *and* inflation.
Shelf rotates every `SHELF_MS = 6h` from a deterministic mixer. `sellPrice` is always
below the cheapest possible buy price (tested — no buy→sell money loop). A token's own
signature card can never be sold.

### 9.3 Quests (`quest.ts`)
Six-beat story chain where each beat introduces one system and reuses the previous ones:
`Static on the Line → The 143rd Chip → Two Files Deep → Data Area Delta → Every Mane
Colour → Storm Watch`. Objectives are **real events** (`clear, stormClear, damage,
chainRun, buy, sellChip, trade, link, chat, visit, dungeonRoom, dungeonClear, sighting,
witnessSale, laser`) — there is no separate quest-progress path that could disagree with
the game. Bounties: one per sector per day, generated deterministically from the date.
`turnIn()` pays exactly once; `sweepBounties()` drops yesterday's.

### 9.4 Data Areas (`dungeon.ts`)
Spire-like node graph, generated from a seed: row 0 is a **gate** (never a fight), middle
rows 1–3 lanes of `wave|elite|chest|shrine`, last row a single **boss**. Every node in row
r links forward and orphans are repaired, so **a path from mouth to core always exists**
(tested over 60 seeds × 4 tiers, plus "no unreachable nodes"). HP bands `[900,1500,2300,
3400]` × per-kind multiplier, calibrated against the 12k/26k/55k sector bosses. Shrines
heal 35% and grant a capped run buff. Loot is drawn from real `CHIPS` ids only.

Run flow: `openArea` → `enterNode` (position) → the room's `BattleSession` mirrors the
node → field kills it → `clearNode` pays. **The map never leaves the server**, so a forged
`nodeId` is simply not in the graph.

### 9.5 Album (`album.ts` + generated `albumData.ts`)
The collection as a Pokédex: **272 values across 13 categories**. `tools/gen-album.mjs`
regenerates the universe from `.data/traits.json`, which also carries a **real per-value
count** (`Base: Origin` 474/493 vs `Base: 1:1` 1/493) — so `rarityWeight = log2(sample/
count)` clamped 1..8 makes rare sightings pay up to 8× more, measured rather than
asserted. Owning a token fills its own entries; everything else must be **seen on someone
else** — the MMO reason to log in, sourced from a real collector base. `sight()` is
idempotent (re-meeting pays nothing, tested). Category completion pays a card, which is
the deliberate slow path for non-holders.

### 9.6 Tribe War (`tribe.ts` + `server/src/war.ts`)
Six element lineages, one ISO week, three sectors. Points: `ambient 2 / glitch 10 /
anomaly 18 / storm 30`, ×1.25 when linked, ×1.5–2 in the **hot sector** — so a whale
buying a Chog visibly moves the front line. `controlOf()` leaves a tied ground unheld
rather than awarding it to whoever posted last. `members` counts **distinct tokens**, so
one alt cannot inflate a tribe. Persisted per week in the `war` table; `War.roll()` turns
the ledger over on the calendar.

---

## 10. Persistence (`server/src/save.ts`)

`node:sqlite` (`DatabaseSync`), `.data/chog-wave.db`, WAL.

```sql
saves(token_id PK, kills, storm_kills, chips TEXT /*json*/, peak_wave, streak,
      season, updated_at, progress TEXT /*json, added by migration*/)
chapters(token_id, ts, kind, detail)          -- the story the token carries
INDEX chapters_token(token_id, ts)
war(week PK, ledger TEXT)
```

`migrate()` checks `PRAGMA table_info(saves)` and `ALTER TABLE ADD COLUMN` —
`CREATE TABLE IF NOT EXISTS` cannot add a column to an existing database.

Progression is **one JSON blob** (`ProfileDoc`: xp, bag, quests, album, run, area, stats,
bountyDay, amp/ward/scanned) rather than eight columns, deliberately: it changes with
every new system. `readProgress` merges shallowly (a persisted subsystem replaces its
default outright) and `doc()` repairs half-written shapes, because a missing `items`
would otherwise crash that token permanently.

Season semantics: `seasonKey(now)` is ISO-week. A new season **resets the leaderboard**
(kills, streak) but never the token's own history (stormKills, chips, peakWave, chapters).
`levelOf(kills)` in save.ts is the legacy renown badge; the displayed level is now XP-based.

---

## 11. Client (`client/src/app/`)

| file | responsibility |
|---|---|
| `picker.ts` + `picker.css` | the gate in front of the world: sign in, hold the shelf, pick the Chog to play |
| `../wallet.ts` | EIP-1193 injected-provider connector: connect → nonce → `personal_sign` → verify, session in `localStorage` |
| `brand.ts` + `public/brand/` | the identity: the pixel wordmark, the official Monad lockup, the Chog cast, and the painted street behind the gate |
| `shell.ts` | dual-screen DOM, net wiring, tape, stand-in NPCs, debug hooks |
| `stage.ts` | three.js scene, `TOWN`/`BATTLE` camera presets, fog, `debug()` |
| `town.ts` | district block plans, road, plazas, walkway, interactables |
| `props.ts` | ~15 static street props, all batched |
| `geo.ts` | **Batcher** — merges geometry per (name, material) |
| `art.ts` | colour script per district, sky/road/slab textures |
| `billboard.ts` | live market ticker board |
| `battle.ts` | ⚠ unreferenced since `duel/` landed — superseded field-panel code, left in place |
| `duel/` | the battle screen: `duel.ts` drives the three.js arena from the server's `view()`, `ui.ts` is the DOM overlay (Custom Screen, cross-link tag, cover ring), `arena/boss/fx/theme` the rest. The only place a player sees a party rule fire |
| `hud/` | top screen: toasts, minimap, touch controls |
| `sheet.ts` + `pages.css` | the bottom screen's tab sheet — map, bag, shop, jobs, album, war, dungeons, folder, library, party. A renderer only: it takes the profile the server pushed and returns HTML, and holds no numbers of its own |
| `careerPage.ts` `deckPages.ts` `dungeonPage.ts` `partyPage.ts` | the sheet's long pages: the main road, folder + library, the six folds, who you are playing with |
| `explorer.ts` | everything in the city that is not the player: anchors, interactables, the Mystery Wave you catch |
| `city/` `blocks.ts` `buildings.ts` `interiors.ts` | street geometry built from the `shared/city` plans |
| `voice.ts` | party voice over a peer-to-peer WebRTC mesh, opt-in, only with people already in the party |
| `tribes.ts` | one model, six tribes |
| `lab.ts` | the city lab: new renderer + new camera + one district, for checking art changes without booting the world |
| `chogLoader.ts` | GLB load, `SkeletonUtils.clone`, trait-derived colours |
| `motion.ts` | procedural animation on the bone hierarchy |
| `player.ts` | virtual input, collision, remote avatars |
| `life.ts` | wanderers, window flicker, dust, traffic, `setPaused` |
| `standin.ts` | primitive Chog figures so nothing depends on unfinished models |
| `audio.ts` | WebAudio |

**The gate computes nothing.** Every card on the shelf is the server's own `deriveBuild`
output from `/api/auth/holdings`, keyed to the address the signature proved, so the picker
cannot offer a build the world will not honour. Picking is a *request*: `net.enter()` still
asks, and a `no` comes back as the server's own reason printed on the gate rather than
swallowed. `?chog=<id>` is a preselect, never a way in — unsigned it renders as a ghost card
that only goes through when `DEV_TOKENS=1`. Foster entry sits beside it on the same screen,
because the collection floor (~5,260 MON) prices out most people who open the page.

**Two phases, one screen.** `data-phase` on the gate's root: `auth` is the front door (the
wordmark at full size, the cast along the bottom, one obvious action), `pick` is a workbench
(a 3px lockup in the header, the shelf, the readout). Nothing is fetched or decided
differently between them — only what there is to look at.

**The join asks the chain.** `auth.mayPlay` goes to `liveOwnerOf` rather than answering from
the ownership index, because the index only moves when the poll sees a Transfer: a positive
read is a claim about the past, and playing a Chog you sold a moment ago — with its
provenance and its crit rate — is exactly the kind of thing a front door should not allow.
When the RPC does not answer, `liveOwnerOf` keeps the map's opinion instead of locking the
street out, and the answer it does get is written back, so the grid stops offering what the
join already refused.

**Batching is load-bearing.** The street is hundreds of objects; each push is
`Batcher.push(name, material, geometry, matrix)` with the transform baked, merged into one
geometry per `(name, material.uuid)`. The bucket key includes material identity — keying
by name alone made every roof one flat colour, because a bucket adopts the first material
it sees. Incompatible attribute sets fall back to individual meshes rather than producing
a corrupt buffer.

**Camera reality check:** the top screen is portrait with a downward tilt, giving a
visible window of roughly **x ∈ [−10, 7]** at street scale. Two placement attempts that
"should be visible" and are not means the thing does not belong in 3D — that is how the
market feed became a DOM tape.

**Rendering/verification:** the Qoder in-app browser has no visible surface, so `rAF`
stalls and `take_screenshot` returns nothing. The only reliable capture is forcing
`game.loop.step` and reading the canvas back **in the same task** (`__frame`). Sampling
`drawImage(gl)` outside the render task returns black.

### The visual identity

`client/src/app/brand.ts` owns the marks and the street; `client/public/brand/` owns the
files. The rules exist so the next screen does not invent a second language.

- **Name.** *Chog Wave Online*. The wordmark is a hand-cut **5×7 pixel alphabet** (eleven
  glyphs) emitted as SVG `<rect>`s — not a font, because a logo that is also a typeface
  stops being a logo. Only the name is ever set in it.
- **Lockups.** Stacked `CHOG / WAVE` with the wave ribbon under it: cell 6 on the gate,
  cell 3 in the header once a session exists. One-line at cell 4 for wide spaces.
- **The ribbon is a lamp, not decoration.** Mint = the gate is ready, gold = the chain is
  still being read, rose = the server refused. That is the HUD's existing colour grammar
  spent on the logo, so the front door cannot disagree with the game.
- **Type.** Oxanium 800 for anything read at a glance, Oxanium 400 for prose, Share Tech
  Mono for every number and micro-label. There is no third face and no letterspaced shout
  outside the mono micro-labels.
- **Monad.** Their marks are used as published: `monad-lockup.svg` / `monad-mark.svg`,
  taken from the inline SVGs at `monad.xyz/brand-and-media-kit`, with `currentColor`
  resolved to their `#DDD7FE` and the symbol left at `#836EF9`. It lives in the chain
  badge at ~17px — never larger than our wordmark, never on a button, never redrawn.
- **The cast.** Five Chogs front the gate: `#1` (wearing the chain id on its shirt), `#4`,
  `#13`, `#26`, `#111`, from `/brand/cast/<id>.png` — a 2026-10-11 snapshot of the current
  `blender/out/traits/tokenN_head.png` renders, chosen by looking at the art rather than at
  trait names. The selection grid still shows the server's own atlas sprites, because those
  are what the world will actually run.
- **The street.** `street()` paints the gate's backdrop on a 2D canvas: an isometric grid
  receding to a violet horizon, blocks with a few lit windows, warm lamp pools, and one
  mint wave crossing the tiles every nine seconds. Deterministic hash, ~12fps, frozen under
  `prefers-reduced-motion`, and stopped for good when the gate closes. It is 2D on purpose:
  the 3D world is built *after* the join, so the gate cannot ask for it.

---

## 12. Assets and tooling

- `.data/metadata/<X>.json` — 493 token metadata files. **`tokenURI` is shuffled**: the
  filename is the *requested* id and only `name` carries the real one (offsets +1461 for
  444 files, −508 for 49). `server/src/meta.ts` keys by `name`, never by filename.
- Tokens with no local record get **predicted** traits, weighted by the real frequency
  table, and labelled `traitsSource: 'predicted'` — playable for all 1,969 without
  pretending to be on-chain data.
- `.data/sprites/<id>.png` atlases served by `/chogs/<id>.png` (id matched against
  `^\d+$` before touching the filesystem).
- Art: OpenSea CDN `i2c.seadn.io` is the only reliable image source; public IPFS gateways
  are rate-limited and one returns HTTP 200 with an HTML challenge (check the RIFF magic).
- `tools/pixellab.mjs` — raw MCP-over-HTTP client for the PixelLab server, with `@path`
  refs expanded to base64 so large PNGs never hit the Windows command-line limit.
- `tools/chog-matte.py` — background keying; proved the official art is a **fire crop**,
  not a full-body sprite.
- `tools/verify-seaport.mjs`, `tools/dump-receipt.mjs` — decode a real sale end to end.

---

## 13. Tests

`npm test` → **158 server** and **319 shared** green at the time of writing, and
`npm run typecheck` is clean across all three workspaces. `client` has
no runner: it is covered by typecheck plus what the browser drivers capture. The suite is weighted toward the mistakes
that were actually made:

| file | guards |
|---|---|
| `core` `traits` `formula` | trait coverage, no duplicate inversions, budget/clamp/rounding behaviour, provenance as a ceiling |
| `custom` `fusion` `field` | locks, coverage, one-merge-per-turn, first-card chain, lane direction |
| `anomaly` | mirror needs a round trip, whale cap, volume routing that *disagrees* with a single sale |
| `loop` (new) | levels add no damage, no sell arbitrage, shelf determinism, path-to-boss over 240 maps, idempotent sightings, war ties unheld, alt cannot inflate membership |
| `party` `duel` (shared) | the party's and the duel's numbers as pure tables: hp/power/reward curves, cross-link cap and tag bands, revive reach and fractions, tier bands and telegraph timing |
| `server/party` `server/duel` (new) | the same claims on a live `BattleSession`: the bite really scales `√bodies` while per-body exposure falls 12→8.5→7→6, a downed body counts for neither the bite nor the pincer, the link multiplier survives all the way onto the projectile's `scale`, and a two-second revive hold breaks on eleven different things (step away, fire, open the Custom Screen, take the hit, target expires…) |
| `server/social` | party merge, ward adjacency, trade cannot duplicate |
| `server/auth` (new) | a session only exists for a signature that recovers to that address: replayed nonce, wrong signer, expired challenge, malformed and undefined signature, a sold Chog refused to its old owner, **a refusal re-checked against the chain before it is acted on**, the write-back that makes the second ask free, and the `ready` flag an empty grid must not be read as |

Test fixtures have been wrong before (three trade fixtures had holdings inverted; one
volume test asserted routing it did not actually discriminate). When adding a test, check
that it can fail.

`tools/coop-check.mjs` is the standing proof of that rule. It went green for months and then
reported nothing at all, and four of its assertions turned out to be measuring their own
stale assumptions rather than the server: it sent `x: 420` into a city whose bounds are
±128/±97 (`cityOf().bounds`) and expected the number back, when `world.move` is a validator;
it expected `vx: -140` to arrive intact when speed is clamped to ±17; it rebuilt the program
from `deriveBuild({transferCount: 4, daysHeld: 90})` — a provenance it invented — and fired it
at a server whose `p.build.library` came from the chain, so every placement was filtered out
and the whole damage branch passed on `reason: 'empty-program'`; and its forgery test used the
literal id `not-a-real-chip`, which scores zero whether the ownership filter exists or not.
Each of those is now asserted against the real invariant instead: hop inside reach, expect the
clamp, build from `welcome.you.build`, and forge with a **chip that exists and is not owned**.

Field tests are deterministic by injecting a fixed die: `new BattleSession(id, sector, spec,
() => 0.5)`. Note that `warn()` consumes `rand()` and reads the *standing* bodies in roster
insertion order, so `0.5` picks `standing[floor(0.5·len)]` — with two or three bodies on the
field that is index 1, which decides **which** player the boss downs. Guessing this produces a
green test that asserts nothing.

To run one workspace's file, use `npm test -w shared -- test/party.test.ts`. `npx vitest run -w
…` does not mean "workspace": `-w` is `--watch`, and it hangs.

The sign-in and the gate are also photographed, in `docs/evidence/`: `brand-1` the gate with
no wallet extension at all, `brand-2` with one detected, `brand-3` a holder's four-Chog
shelf, `brand-4` the build the world will run for the selected one, `brand-5` a real refusal
— the Chog sold out from under the live session, the join refused, and the wordmark's ribbon
turned rose. The holder states need a wallet holding genesis Chogs, which the floor
(~5,260 MON) rules out for a test key, so they were captured against a chain that answers
`ownerOf` for one address and can be told to sell one mid-run, while every other path — the
boot scan, the metadata, the atlas, the signature check, the join — stayed the production
one.

---

## 14. Known gaps — read this before refining

**Where the code stops short:**
1. **Wallet sign-in is wired; nothing about it is finished in the sense of being
   operationally boring.** `server/src/auth.ts` (EIP-191 nonce → `verifyMessage`) is mounted
   at `/api/auth/{nonce,verify,session,signout,holdings}`, `owners.ts` answers holdings from
   the boot scan (`ownerOf(1..1969)` — the contract has **no ERC721Enumerable**,
   `supportsInterface` reverts) plus the Transfer stream, and the WS join refuses any
   `tokenId` the session's address does not hold. Provenance is therefore real now: the
   old path joined with `{transferCount: 0, daysHeld: 0}` for everyone, which left the
   clean-signal/crit mechanic dormant. Still thin: **sessions and nonces live in memory**,
   so a restart signs the whole street out, and the ownership index is only as fresh as the
   poll — which is why a join asks the chain rather than trusting a map that can be hours
   behind, and why the answer is written back into it.
2. **The formula's output is not surfaced** in the Custom Screen or inspect panel — the
   attributes and the `audit` line exist on `ChogBuild` and are not drawn. (The picker's
   detail panel does print `describeBuild()`, which is the same data in prose.)
3. ~~`shop / quest / area / album / war` are reachable only over the `loop` WebSocket
   action and have no client UI~~ — they now have both: `net.loop(…)` carries `buy sell use
   quest.accept quest.turnin area.open area.step area.state area.close` and the bottom screen
   draws them as sheet tabs. What is still true: there are **no HTTP routes** for any of them
   (deliberate — they all mutate authoritative state), and the sheet is a *renderer*, so a
   judge who wants to see a number change has to touch the world, not the DOM.
4. ~~`client` dev still proxies to :8787~~ — `VITE_PROXY`/`VITE_PORT` now point a second
   dev server at its own game server, which is how the holder-side screenshots were taken
   without touching the live :8787 world.
5. The GLB has **no animation clips** — `motion.ts` animates bones procedurally. The
   models themselves are unfinished by another session; `standin.ts` exists so nothing
   depends on them.
6. **`partyHpScale` is a model, not yet a live path.** The node/boss health curves in
   `loop.ts` are what `tools/pacing-report.mjs` measures and what `dungeon.ts` budgets
   against, and the shared sector boss *is* population-scaled (`wave.ts bossHp(tier,players)`)
   with its bite scaled live at `battle.ts:616` — but a Data Area fold is single-player by
   construction: its session key is `area:${playerId}` (`world.ts:813`), so a second body
   never joins that field and `scale: 1` is hardcoded at the payout. Group HP scaling only
   bites where one session object is shared: the sector boss and party node fights. Making
   dungeons co-op means keying the fold by party, not by player, and re-testing the
   `area.kill` ownership path — it is deliberately not faked here.

**Design holes still open:** no death/defeat screen for a failed run, no repair loop that
consumes `repair` outside battle, no guild/friend list, no PvP, no onboarding beyond the
quest text, no mobile layout, no deployment (R6).

**Real-world constraint to respect:** Chog Genesis trades ~**0.48/hour** with observed
12.9-hour gaps. Any feature whose only trigger is "a sale happens" must have a demo lever
(`/api/dev/fill`) or it is untestable in a judge's three minutes.

---

## 15. Invariants — the rules the code must not break

1. **Never present a plain ERC-721 Transfer as a sale.** Only decoded Seaport fills carry money.
2. **The server decides damage, coverage, drops, prices, steps and war points.** A client
   message can at worst waste its sender's turn.
3. **The NFT must stay essential.** Levels never add damage; the signature card cannot be
   sold; the Album floor comes from owning; foster players are capped by provenance, not
   locked out.
4. **Rarity buys breadth, not height.** No attribute exceeds `ATTR_MAX`.
5. **Provenance is a ceiling, not a multiplier.** A flipped Chog cannot buy back quiet.
6. **A warded anomaly needs two linked players in adjacent files.** Portable Ward is the
   single-use exception, and it is consumed server-side.
7. **Every trait category must feed something** — check the cascades before "simplifying"
   a fallback.
8. **Real data drives the fiction.** Volume, prices, rarity weights and metadata all come
   from measured chain/scrape values; when you add a number that could be measured, measure it.
9. **`shared/` owns the rules.** Server and client import them; they do not restate them.
10. **Several bodies on one wallet are not several people.** Rewards scale by *distinct
    owners* (`partyRewardScale(size, owners)`), never by head count; an unowned body is worth
    `ALT_WEIGHT` of a person and carries a body tax on top. Do not add a second, independent
    split-penalty anywhere downstream — the tax is decided once, or the two copies drift.
11. **Every party rule that makes a fight easier must also make it bigger or better-paying.**
    Bite grows `√bodies` while HP grows faster, and the gap pays for the revive; a ward drops
    only for two adjacent files, and the pincer pays for spreading instead. A buff with no
    cost is how a party becomes a tax nobody forms on purpose.
12. **Never edit `blender/` or `client/src/scenes/Battle.ts`** — another session owns them.
13. Two concurrent sessions writing `~/.qoder/settings.json` cause **lost updates** (this
    already silently deleted the PixelLab MCP config once).

---

## 16. Suggested reading order for a new session

1. `shared/src/wave.ts` + `anomaly.ts` — the world model and the market hook
2. `shared/src/derive.ts` + `formula.ts` + `traits.ts` — why the NFT matters
3. `shared/src/custom.ts` + `field.ts`, then `server/src/battle.ts` — how a fight resolves
4. `shared/src/progress.ts` `economy.ts` `quest.ts` `dungeon.ts` `album.ts` `tribe.ts` — the loop
5. `server/src/world.ts` `profiles.ts` `index.ts` — where it all becomes one process
6. `client/src/app/shell.ts` → `town.ts` → `battle.ts` — what the player sees
7. this document's section 14 — what to do next
