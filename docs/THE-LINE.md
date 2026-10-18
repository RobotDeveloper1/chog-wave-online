# The Line — open-world progression (proposal, 2026-10-15)

> Replaces the current progression: a Chog is born with a full 24–34 card folder and six
> dungeons unlock cards at level 2. This document is the opposite of that. The rules, the
> region tables and the exact code that changes are all below, so it can be argued with
> before it is built.
>
> Read alongside `ARCHITECTURE.md` (what exists) and `ROADMAP.md` (what was being
> changed). This one is what is being changed **now**.

---

## 1. The change in one paragraph

A Chog wakes up in **Camp Zero** with **one card (its signature) and its basic element
attack. Nothing else.** The world outside the city is **the Line** — six open regions
along a broken road, walked in order. Every encounter in a region is fought with
whatever you happen to be carrying, and **beating an encounter unlocks a specific,
permanent card.** That is the whole progression: *find cards, build a hand, go deeper.*
The six Data Areas — the dungeons — stay, but they become **phase two**: they only open
once you have cleared two regions and are holding ten cards, because their whole point is
fighting with a real deck. **Anomalies move off the critical path** and become optional
endgame world events.

The NFT keeps its job, and the job changes shape: **before you have any cards the NFT is
the strongest thing you own.** Your attributes decide the basic attack, and the basic
attack is what clears region one. A rare, clean-provenance token walks further on bare
attributes than a flipped common. That is invariant 3 ("the NFT must be essential to
winning") satisfied by the *new* progression instead of fighting it.

---

## 2. Why the current model has to go

`derive.ts:188` calls `folderSlots(tierIndex)` which returns `24 + tier*2`, and
`buildFolder` fills it from the whole chip catalogue weighted by the attribute profile.
A new player logs in holding **24 to 34 cards** they never chose and cannot explain.
Three consequences, all of them bad:

- **There is no "before".** The first five minutes of a run cannot feel different from
  the fifth hour, because the deck is already full.
- **Deckbuilding is not a decision.** Filling a folder is a menu, not a build. The
  `folder/` editor UI exists to rearrange what was handed to you.
- **Exploration has no reward.** The dungeons' `unlocks` table is the only fixed card
  source in the game, and the first one opens at level 2 — so the interesting reward
  arrives before the player has anything to want it with.

`dungeonData.ts` already does the right thing (fixed, permanent, first-clear, one table
the server and the menu both read). The Line is that idea, moved to the front and made
the spine.

---

## 3. The Line — six regions

Open terrain, walked in order, sealed by a warden each. Palette and enemy lean per
region; the cards are what make it worth crossing.

| # | region | element | mood | what it is |
|---|---|---|---|---|
| 1 | **TOLLS** | burn | dusk, dry wheat, rust | the last farmed strip before the road gives up |
| 2 | **ASH PINE** | burn→volt | black pines under falling ash | a forest that has been burning for a long time |
| 3 | **GLASS MARSH** | frost | standing water like glass, drowned pylons | where the Index kept what it could not sell |
| 4 | **RELAY FLATS** | volt | plain of antenna bones, cable runs, storm | a broadcast site that never stopped transmitting |
| 5 | **CAUSEWAY** | wave | sunken highway under shallow water | the old trade route, flooded |
| 6 | **THE STATIC LINE** | void | the road ends; noise instead of distance | where every trade in the city ends up |

### Anatomy of a region

- **drifts** (4) — roaming packs. Cheap. The bread and the first cards.
- **posts** (2) — a real fight, with a real HP bar and a telegraphing enemy.
- **warden** (1) — the region's seal. Beat it and the next region opens.

Nine encounters per region, **fixed card tables, permanent on first clear, no RNG.** A
player can aim at a card. That is the difference between a reward and a slot machine.

Same anatomy, different ground. Each region carries its own plan (`REGION_PLAN` in
`shared/src/line/layout.ts`): how its road meanders and how wide it runs, the six legs
between its sites (the middle leg is the trailhead clearing, the last the warden's final
approach), how its camp pitches, and how wide its mobs fan out and how far they patrol.
The dressing follows in `client/src/app/line/detail.ts`: drift markers, roadside posts,
barricade and gate-arch materials, banners, tent canvas, grass density and water height are
per-region dialects. The ring colours stay kind-wide — gold is a drift everywhere — because
the ring is the language and the props are the accent.

The mobs follow the same rule: each region fields its own roster (`ROSTER` in
`shared/src/line/mobs.ts` — six signatures, no two alike), and the figure is the
region's own fauna (`client/src/app/line/critters.ts`) on the road and in the duel it
opens. Eyes are the encounter's element, wardens wear the brass. The duel resolves the
animal from the session id (`line:tolls.1`) with no protocol change; anomalies, dungeons
and the Training Sim keep the signal avatars.

### Unlock tables

| region | drifts | posts | warden | count |
|---|---|---|---|---|
| **TOLLS** | `emberpaw` `hot_heart` `cigar_steady` | `switchblade` `magmachog` | **TOLLKEEPER** (tollkeeper) → `cinderfang` | 6 |
| **ASH PINE** | `staticnip` `green_candle` `fwog_buddy` | `b_origin` `sb_signal` | **FIRST FLAME** (baron) → `red_candle` `ga_cinderfall` | 7 |
| **GLASS MARSH** | `v_bubblegum` `v_worried` `v_flatline` | `v_normsmile` `glacierhowl` | **RIME LIBRARIAN** (front) → `hoarbar` `ga_hollowwinter` | 7 |
| **RELAY FLATS** | `v_btccoin` `v_drool` `lucky_coin` | `v_grit` `arcsnap` | **PACKET KING** (surge) → `stormchomp` `ga_arccathedral` | 7 |
| **CAUSEWAY** | `v_rainfall` `pepe_curse` `ripplebite` | `v_goldtooth` `refract` | **UNDERTOW MOTHER** (mirror) → `tsunamichog` `ga_drownedbell` | 7 |
| **THE STATIC LINE** | `v_clownlaugh` `nullfur` `signaldeath` | `v_lipbite` `v_wo` `e_dead` | **THE INDEX** (baron) → `eclipse` + all six remaining GA | 12 |

46 of the 57 cards live on the Line. The other 11 are deliberately elsewhere:

- **the eight `e_*` (eye/style) cards** are only found in **anomalies** — they are what
  you get from staring at other people's Chogs, so they belong in the market-driven
  endgame, not on the critical path. They also feed the Album's sighting loop.
- **`undertow`, `rimeclaw`, `chognova`, `v_puke`, `v_smile`** are **dungeon** rewards,
  because phase two should hand out cards the Line does not.

---

## 4. Rules that change, precisely

### 4.1 A Chog is born with one card

`derive.ts` stops drawing a folder. `build.library` becomes `[signature]`, `build.folder`
becomes `[signature]`. `buildFolder()` and its weighting stay in the file — it is what
picks the *signature* when the Accessory trait is absent, and it is the reference
implementation for what a folder will eventually look like.

### 4.2 The hand always has six cells

This is the join that makes the whole thing work. The folder deals **distinct cards first** and
only then tops up with second copies, and whatever the folder still cannot fill becomes the basic
attack. So:

| folder size | hand | what you choose between |
|---|---|---|
| 1 (fresh Chog) | 1 signature + 5 basic | almost nothing — you are learning the board |
| 6 (Tolls cleared) | up to 6 distinct | your first real decision |
| 18 (whole Line) | 6 of 18 | the deck is finally a deck |

The hand never shrinks, so the Custom Screen never teaches a new mechanic, and a bigger folder is
felt as *choice per turn* rather than as a bigger number. That is the same rule the level ladder
obeys, applied to the thing that replaces it.

**Distinct-first dealing is load-bearing, and it was not obvious.** `drawCandidates` originally
drew from the folder *with replacement*, so a one-card folder filled the whole panel by itself and
the empty cells this design leans on would never have existed. Variety-first also matches what the
code said about itself before this rewrite: *"the screen draws six candidates, so a folder of three
is a folder of three"*. The Body trait's copy count still decides how many times a card may appear
across a hand — it just no longer lets a folder of one show the same card six times.

### 4.3 The basic attack is the NFT's voice

Not a card in the folder, not won by anything — always there, always free to press. Its damage
is the attribute profile:

```
might = round(6 + PWR × 0.9 + SPD × 0.25)
```

Measured across the 493 tokens in `.data/metadata`: **might 9 → 16, median 12**. The spread is
**1.40× at p90/p10 and 1.78× at max/min** — a common token at the bottom and a Legendary at the
top really do hit for very different numbers with nothing else on the board, which is the whole
early game. The absolute band is deliberately low and will have to be reconciled against the HP
of a region's drift when slice 3 prices the encounters; that is the one number in this document
that is not yet closed.

With no multipliers, no crit and no cards in play, that gap is everything a new player feels.
A foster Chog is a **ceiling**, not a multiplier: `capShares` hands a capped profile's surplus
into whichever attribute is still under the cap, and PWR is exactly what the basic attack reads,
so computing the number from the *capped* attributes made a free Chog hit **harder** (17) than
the held token it was borrowing (16). It is now `floor(held × 0.75)` off the **uncapped**
profile — measured 12 against 16 on a Kings Robe / Fire / Legendary — the same shape as
`cleanCeiling`. That is the honest version of invariant 3: **owning one helps you, it does not
play for you**, and it helps you exactly where you have nothing else.

### 4.4 Folder size comes from the Line, not from the NFT

```
slots = clamp(2 + regionsCleared * 2 + floor(encountersCleared / 4), 2, 18)
```

The NFT keeps the *shape* — `copies` (2–5 from the Body trait), `megaCap`/`gigaCap`
(from Tier), and `banned` (the weakness) — via `folderShape()` and the existing
`folderRules()`. So rarity still decides what kind of deck is possible, and no amount of
walking changes it. What the Line decides is **which cards you have to put in it.**

`folderSlots(tierIndex)` in `formula.ts` is deleted. `loop.ts:178` and `derive.ts:188`
are its only callers.

### 4.5 Gating

| gate | opens when |
|---|---|
| region *N* (N>1) | region *N−1*'s warden is down |
| the Line is done | all six wardens |
| **dungeons** | `regionsCleared >= 2` **and** `cardsHeld >= 10` |
| **anomalies** | `regionsCleared >= 3` — the market events become endgame |

The dungeon gate is the important one. It is deliberately two conditions: *levels* alone
would let a grinder walk in with a signature card and a bad hand, which is not phase two.

### 4.6 Anomalies leave the critical path

They already are optional — they spawn from real collection volume, and the Line does not
wait for one. What changes is the gate: `regionsCleared >= 3`, so the first two hours
cannot be spent watching a ticker, and the eight `e_*` cards make them the endgame's
actual payout rather than a stat bump.

### 4.7 The shop stops selling cards

Not answered when the design went out, so: **the shop sells consumables only.** `pack`
survives as "one random card, weighted toward regions you have reached" — it is the only
card source money buys, which keeps the WAV sink and the volume-driven pricing without
letting a player assemble a deck faster than they can walk it. `stockForChips()` goes
away; selling cards stays, at the existing below-cost rate, so a card can be traded for
a repair.

### 4.8 The level ladder keeps only the axes that are not the Line

Dropped: `bagCap` and `laserCharges` (the bag is no longer a collection you fill by
shopping, and the laser is refused at `world.ts:1401` anyway — it is already dead code).

Kept: `queueSlots`, `chargeScale`, `fieldHp`, and the folder licences (mega / giga /
fused). Those are all *breadth*, none of them is damage, so invariant 3 and 4 still hold.

---

## 5. Invariants this must not break

1. **The NFT is essential.** Now proven by the basic attack (§4.3) instead of by a
   free 24-card folder — a *stronger* demonstration, because it is the thing that makes
   the first hour playable at all.
2. **Levels never add damage.** Unchanged; the ladder only buys breadth.
3. **Provenance is a ceiling.** Unchanged. It reaches the early game through `crit` on
   the basic attack, which is where it belongs.
4. **Shared owns the rules.** `line.ts` is pure and shared; the server refuses an
   encounter the client cannot prove, the client renders the same tables.
5. **Real data drives the fiction.** Unchanged. The Line's cards are hand-authored, not
   scraped — they are a reward, not a measurement. Anomalies stay the measured half.

---

## 6. Build order

| slice | what | state |
|---|---|---|
| **1** | `shared/src/line/index.ts` — regions, encounters, unlocks, gating, `slotsFor`. Pure, 37 tests. | **done** |
| **2a** | `derive.ts` folder → `[signature]`; `folderSlots` deleted; `folderRules` takes its size from the Line; folder is capacity not quota. | **done** |
| **2b** | the basic attack: six BASIC chips, `ChogBuild.basicMight`, distinct-first dealing, empty cells filled with the token's own attack. 21 tests. | **done** |
| **3** | an encounter is a `BattleSession`; `loop` actions `line.state` / `line.travel` / `line.enter` / `line.clear`; `place: 'line'` through `move()` with the same anti-teleport speed check. 25 tests on a live `World`. | **done** |
| **3a** | `shared/src/line/budget.ts` — fight HP **derived** from the cards the region hands out beforehand, not tabulated. | **done** |
| **3b** | `shared/src/line/layout.ts` — the terrain both sides generate: heightmap, water, props, sites. 18 tests. | **done** |
| **4** | the client: `app/line/{render,field,theme}.ts` reusing `ChunkBatcher`, the `line` camera rig, `Stage.setLineMood`, `shell` wiring. **MAPS tab** at key `L`. | **done** |
| **5** | `stockForChips` removal, dungeon/anomaly gates surfaced in the menu, `ARCHITECTURE.md` §3/§4/§7/§11/§13 | not started |

### How the Line is put together

```
shared/src/line/
  index.ts    regions, encounters, unlock tables, regionGate, slotsFor   (pure, both sides)
  layout.ts   heightmap, water, props, site placement, bounds           (pure, both sides)
  budget.ts   what a fight costs, derived from the deck you arrive with (pure, server)

server/src/world.ts
  travel()      the only way across; regionGate decides, never the message
  siteUnder()   "is the player standing on it" — the server's own answer
  lineEngage()  builds `line:<encounterId>`, shared by everyone who walks into it
  line.clear    reads `session.state.result`, which the client cannot write

client/src/app/line/
  theme.ts    six moods; `haze` is the control that decides how far you can see
  render.ts   terrain into the city's ChunkBatcher — no city code, same sink
  field.ts    the `{group, solids, spawn, bounds}` contract, third implementer

client/src/app/linePage.ts   the MAPS tab: a renderer and nothing else
```

**Why the terrain is generated rather than sent.** A region is 420 units square and carries a
few thousand solids. Shipping that over the wire every time someone walks through a gate would be
absurd, so both sides run the same seed — which is only safe because `world.ts:63-70`'s lesson is
respected: the server clamps to the walkable rectangle *the client built the district from*, not
to its own copy of it. The same shape as `city/`, and the reason collision can stay client-side.

**Why the MAPS tab may only draw.** It renders six regions, the server's state for each, and a
button that sends `line.travel`. It computes no gate. The lock text on a sealed row is
`regionGate`'s own `reason` string printed verbatim, so when the tab says *"TOLLS: the warden is
still standing"* that is the sentence the server sends back if the player tries it anyway. Travel
is free and skips no gate: a player who has crossed Tolls can jump to Ash Pine, which is fast
travel and is why walking it is only a journey the first time.

### What slices 3–4 turned up

1. **A site can be unreachable without looking at it.** The route ring crosses the marsh and the
   flooded causeway, and a site in standing water is a fight `siteUnder` can never find. Two
   rounds of this: first a nudge in any direction, which then put site five *behind* site four in
   Glass Marsh; then a nudge along the road only — same `z`, different `x` — which cannot break
   either ordering or the gaps.
2. **Two sites 22 units apart is two encounters at once.** Measured, not assumed. The generator
   now holds a minimum gap and the test asserts it, because "five seconds of walking between
   fights" is a design statement and not a cosmetic one.
3. **Water dropped on a site made it unwalkable.** Standing water is a solid, and the loop that
   places it ran after the loop that cleared the sites.
4. **`bagCap` was silently eating a fifth of the world** — the bag holds 32 ordinary cards and the
   Line pays 50 named ones. Line clears now pass `pinned: true`, on the same precedent as fused
   cards.
5. **Validating a batch against state the batch is mutating.** `lineCleared` checked each gate
   against the live profile while the same loop appended to it, so one forged message listing all
   42 encounters cleared the whole Line. Now a snapshot, all-or-nothing.
6. **The share cap made the free Chog stronger.** `capShares` hands a capped profile's surplus
   into whatever is under the cap, and the basic attack reads PWR — so a foster came out *above*
   the held token it was borrowing. Now a ceiling on the uncapped profile (`ChogBuild.basicMight`).
7. **The first `RING_BASE` budget table was wrong by more than an order of magnitude** in both
   directions, and no amount of retyping would have fixed it. The HP is now computed from the
   cards the region hands out *before* that site, so moving a card between two encounters re-tunes
   both fights with nobody touching a difficulty slider.

### What slices 2a–2b turned up

Four things worth keeping, because they are the kind of bug a design change hides rather than
causes:

1. **One roll off a peaked distribution has no spread left in it.** Keeping the old weighted-pool
   draw and stopping after one card produced **fifteen** distinct born cards over 493 tokens, with
   278 of them landing on three prism commons. The draw was replaced by a rule — tribe names the
   shelf, the attribute profile says how far down it — which is deterministic, recomputable like
   `audit`, and gives **30** distinct cards across the same 493. Without traits the answer is one
   card for every token, which is correct: without a trait there is nothing to tell them apart.

2. **`bagCap` was silently eating a fifth of the world.** The bag holds 32 ordinary cards and the
   Line pays 50 named ones, so without intervention the last eighteen encounters refunded their
   reward into WAV. Line clears now pass `pinned: true` to `addChips`, on the same precedent as
   fused cards: a reward the game printed on a fixed table is not subject to a bag size.

3. **Validating a batch against state the batch is mutating.** `lineCleared` checked each id's gate
   against the live profile while the same loop appended to it, so a single forged message listing
   all 42 encounters cleared the whole Line. It now validates every id against a snapshot and
   commits all-or-nothing — a partial commit would be worse than the original bug, because it lets
   a client push a region forward one id at a time and learn the gate by probing. Both properties
   are pinned in `server/test/line.test.ts`.

4. **The share cap could make the free Chog stronger.** `capShares` redistributes into whatever is
   under the cap, so a foster's surplus landed in PWR and the basic attack — which reads PWR —
   came out *above* the held token it was borrowing. Fixed by making the foster a ceiling on the
   uncapped profile (`ChogBuild.basicMight`), which is the idiom `provenance` already uses.

Two smaller things, both mine from the regex-heavy edits: `drawCandidates` drew with replacement,
which would have made the empty cells this design depends on unreachable, and `selectProgram` in
the pacing model read the catalogue's `might` and would have ranked every basic as a 1-power card.

Slices 1–2b are ~2,000 lines and take the game from "24 free cards" to "one card, a basic attack
priced off your token, and two slots to put things in". Nothing is on screen yet. Slice 3 is what
makes a Line encounter a fight; slice 4 is what makes it feel like a game.