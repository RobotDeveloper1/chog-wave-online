# Roadmap — the "make it a game" pass (started 2026-10-10)

Working plan for the rework the player asked for, kept in the repo so it survives a long
session. `docs/ARCHITECTURE.md` stays the map of what exists; this file is what is being
changed and why. Tick items as they land.

## What the player said (verbatim intent)

1. The city must read as an isometric 2.5D *city*, big, full of quests, a HUD that looks like a game.
2. The duel HUD and the duel field are bad.
3. The city still lacks things; there is no *real progression*.
4. Roofs flicker / glitch; the whole picture is foggy.
5. Progression must be **valid and easy to follow**, with **dialogue for whoever enters**.
6. **Text chat**, and optionally **voice chat inside a party**.

## Root causes found (so the fixes are not cosmetic)

| symptom | cause | state |
|---|---|---|
| roofs flicker | cornice box top coplanar with the roof quad (z-fighting) + stepped-roof tops + neon blades | fixed |
| everything flickers | film grain re-rolled every frame (21% of pixels changed on a still frame) | fixed (static, default 0) |
| foggy | tilt-shift pass ran a gaussian at 1 texel *everywhere* (global blur); lamp pools additive by day; lavender fill light + violet roofs/asphalt | fixed |
| duel is empty | server `BattleSession` (boss volleys, HP, chain, phases) is never wired: `onSession` has no subscriber, the client only sends `fire`, and `world.fire` is instant damage — the boss never attacks | open |
| buying/looting is pointless | `world.fire` only accepts `build.library` (NFT-born cards); `save.chips` never reaches a fight | open (folder rules done in `shared/src/folder.ts`) |
| fusion invisible | `shared/src/fusion.ts` has 9 recipes and a Library, nothing calls it | open |
| progression opaque | `progress.ts` GATES are 11 invisible numbers; nothing tells a new player what to do next | open |

## Design

### Progression (four pillars, all server-decided, all visible in the CAREER tab)
- **Level ladder**: LV1..30 with something named at (almost) every level — districts, abilities, Data Area tiers, queue slots, shop tiers, titles. Levels still buy *breadth* (invariant 3/4): damage comes from the build and the folder.
- **Folder** (power): the NFT sets the *shape* (size, copies, Mega/Giga caps, banned element); the player fills it from what they own. Collected cards finally matter.
- **Acts** (content): ACT I Ashflat → ACT II Voltgrid → ACT III Hollow, each a chapter of main quests with a gate that opens at the end. Locked gates say what they need.
- **Feats and titles** (meta): achievements with progress bars; titles shown on the nameplate.

### Onboarding
- Welcome dialogue on first login (client-driven, persisted per token).
- A permanent **NEXT** chip in the HUD: one line, one arrow, always the right thing to do.
- Contextual **tips** shown once each (first door, first level-up, first card won, first party invite...).
- **Training Sim** at the Wave Station: a personal, always-available duel with a slow dummy, so the first fight is not "wait for the market to open an anomaly".

### Duel
- Server-authoritative field: boss **telegraphs** a file, then fires; you dodge by changing file; HP and defeat; chain meter; four phases; per-archetype volleys.
- Custom Screen: the server deals the hand, enforces the gauge and the queue limit; programs are resolved by projectiles on the field (a card that visually misses does no damage); fusion/Program Advance detected in the queue.
- New arena (panels, backdrop, boss avatar per archetype, FX, damage numbers) and a new HUD (boss plate, player plate, gauge, chain, telegraph banner, hand/grid/queue UI).

### Social
- Chat panel with channels (global / district / party / whisper), history, bubbles over avatars, `/` commands, rate limit.
- Party panel: nearby players, invite/accept, members' HP and element.
- **Optional voice in a party**: WebRTC mesh (parties are capped at 4), signalling relayed by the game server, opt-in per player, push-to-talk or open mic, speaking indicators. Never active outside a party.

### City
- Wave pylons (fast travel inside a district / between unlocked gates), kiosks and vendors that do something, more NPC dialogue, discoveries that feed feats.

## Checklist

- [x] visual: grain, global blur, lamp pools, palette, roof z-fighting, adaptive near plane
- [x] shared: fused cards readable by `chip()`; `ChogBuild.folder`; `shared/src/folder.ts` + tests
- [ ] shared: duel rules (`duel.ts`), field extensions (owner/scale/telegraph), unlock ladder, feats/titles, journey/tips, acts
- [ ] server: folder + library persistence; session-driven duel; field pushes; results; training sim; gates enforced
- [ ] client: duel (arena, fx, ui); CAREER / FOLDER / LIBRARY tabs; NEXT chip; tips; welcome dialogue
- [ ] social: chat panel, bubbles, party panel, voice
- [ ] city: pylons, kiosks, content
- [ ] docs, tests, cleanup of dead code (`town.ts`, `blocks.ts`, old `props.ts`, `billboard.ts`, `app/battle.ts`)
