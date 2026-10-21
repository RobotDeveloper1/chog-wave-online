# Demo trailer shots

Record these with OBS (or Win+G), 1920x1080, MP4, **game audio on, mic off**,
no narration — the assembly cuts cards between them. Drop the files in
`docs/trailer/shots/` with these exact names, then run:

```sh
python docs/trailer/assemble.py
# → docs/trailer/chog-wave-demo.mp4
```

Missing shots are filled with stand-in slices from the old trailer, so the
pipeline always renders a watchable preview.

| file | show | card |
| --- | --- | --- |
| `01-login.mp4` | gate → connect → Privy popup → shelf | THE GATE |
| `02-pick.mp4` | choose the Chog, build card, walk into the street | PICK YOUR FIGHTER |
| `03-street.mp4` | walk the city, minimap, quest board up close | THE STREET |
| `04-line.mp4` | travel to Tolls, the road with mobs on it | THE LINE |
| `05-pack.mp4` | a pack of 3, three species side by side | PACKS OF THREE |
| `06-ambush.mp4` | chase → contact → the duel opens | AMBUSH |
| `07-duel.mp4` | hand opens, program, damage preview, execute, win | DUEL |
| `08-drops.mp4` | loot on the ground, walk over and take it | DROPS |
| `09-reward.mp4` | the new card landing in the deck/sheet | LOOT |

Keep each shot 5–25 seconds; the assembly caps at 25 and cuts cards between.
