# Demo trailer shot list — CHOG WAVE

Record with OBS (or Win+G), 1920x1080, MP4, **game audio on, mic off**,
no narration — the assembly cuts cards between the takes. Drop the files in
`docs/trailer/shots/` with these exact names, then run:

```sh
python docs/trailer/assemble.py
# → docs/trailer/chog-wave-demo.mp4
```

A missing take is filled with a stand-in slice from the old trailer, so the
pipeline always renders a watchable preview. Keep each take 5–12 good seconds
(the assembly caps at 25). Record on the testnet build (`chogdemo`,
DEV_TOKENS on): any token can be shown on screen.

Narration is five short lines — the script, file names and recording notes
are in [VOICEOVER.md](VOICEOVER.md). Drop the clips in `docs/trailer/voice/`
and the assembly mixes them over the game audio with automatic ducking.

## Act 1 — the gate (01–03)

| file | show | how |
| --- | --- | --- |
| `01-login.mp4` | gate → connect → **real Privy popup** → shelf | Click connect, pick a crypto wallet in the Privy popup, approve. Hold 2s on the Protected by Privy button before clicking. |
| `02-pick.mp4` | shelf with the wallet's Chogs, each with its 3D model | Cycle 2–3 tokens, stop on a strong-looking one, confirm. Show the build card if it appears. |
| `03-street.mp4` | the street: walking, minimap, NPCs, quest board close-up | Walk a block, open the quest board and close it. Show the HUD with the logged-in token's art. |

## Act 2 — the road and the Toll (04–07)

| file | show | how |
| --- | --- | --- |
| `04-line.mp4` | travel to the line, the road into **the Tolls** | Travel, walk the road with mobs in sight. 8–10s of walking sets the pace. |
| `05-pack.mp4` | a pack of 3 up close (single-species trio) | Find a trio (past the line's halfway is more common), walk close without touching, zoom the wheel in. |
| `06-ambush.mp4` | chase → contact → the duel opens | Step into aggro, let the mob run you down, cut as the arena opens. |
| `07-duel.mp4` | hand opens, program, damage preview, execute, win | Build 2–3 cards, show the preview, execute, hold on the finishing blow. A counter is gold if you get one. |

## Act 3 — progression (08–12)

| file | show | how |
| --- | --- | --- |
| `08-drops.mp4` | loot on the ground, walk over and take it | After the win, film the drops and walk over to collect. |
| `09-reward.mp4` | the new card landing in the deck | Open the deck/sheet and show the new card coming in. |
| `10-sheet.mp4` | character sheet: NFT traits becoming stats | Open the sheet, scroll the attributes. Point at PWR → Attack if you can. |
| `11-deck.mp4` | deck builder: swapping cards, signature | Swap 1–2 cards, show the token's signature card. |
| `12-trade.mp4` | market: buying/selling a card | Buy a cheap card, show the balance moving. |

## Act 4 — the big game (13–16)

| file | show | how |
| --- | --- | --- |
| `13-anomaly.mp4` | anomaly: telegraph, strike, phases, clear | Enter the sector anomaly, film a telegraph popping + a dodged strike. If the spawn banner names its cause (BARON / SURGE + MON amount), hold on it — that sale is what woke it up. If you clear it, hold on the clear. |
| `14-dungeon.mp4` | dungeon: enter, rooms, mobs, clear | Go in, show 1–2 rooms with combat. No need to full-clear — keep the pace. |
| `15-party.mp4` | co-op: ally, cover, revive | With 2 tabs/players: one goes down, the other gives cover (R) and revives. No duo available, show the party page. |
| `16-ranks.mp4` | ranks/leaderboard | Open ranks, show your name/callsign on the list. |

## Act 5 — PvP (17–18, the climax)

| file | show | how |
| --- | --- | --- |
| `17-callout.mp4` | challenge → accept → wager screen | Player A challenges, player B accepts, show the wager locking in. |
| `18-bout.mp4` | the fight: both real Chogs, programs, KO, result | Record 10–12s mid-fight (programs flying, telegraphs) + the KO and the result screen with the prize. |

## Checklist before recording

- [ ] Testnet build up, game sound at a comfortable level
- [ ] Wallet holding 2+ Chogs (a full shelf impresses more)
- [ ] Second tab/player ready for takes 15, 17 and 18
- [ ] 1920x1080 at 30 or 60 fps, no Discord/FPS overlay on screen
