# Voiceover — CHOG WAVE demo trailer

Twenty short lines. Hype, optimistic, fast — the trailer sells the
game, so the voice is excited, not deadpan. Energetic young male
(ElevenLabs "Liam"-style or similar), dry voice only, MP3.

## Using ElevenLabs (recommended)

Generate one clip per line below, download as MP3, and drop them in
`docs/trailer/voice/` with these exact names (`open.mp3`, `01.mp3` …
`18.mp3`, `end.mp3`). Then ping the assistant: durations get re-measured
into `remotion/src/timings.ts`, beats re-fit, and the trailer re-renders
with `npm run render --prefix docs/trailer/remotion`.

- One file per line, no slate, half a second of silence at the head.
- Aim 3–6 seconds each. Short hits harder; the beat stretches to fit.
- Say "chog" like "chogue" (one syllable). PWR is spelled out: "P-W-R".
- Line 18 means the $CHOG token — "paid in real Chog".

## Fallback: edge-tts

`docs/trailer/voice/lines.txt` holds `key|line`. Regenerate all twenty:

```sh
foreach ($l in Get-Content docs/trailer/voice/lines.txt) {
  $k, $t = $l -split '\|', 2
  python -m edge_tts --voice en-US-GuyNeural --rate +18% --text $t --write-media "docs/trailer/voice/$k.mp3"
}
```

## The script

| file | plays over | line |
| --- | --- | --- |
| `open.mp3` | open card | Your Chog is not a profile picture. It's your fighter. This is Chog Wave! |
| `01.mp3` | the gate | One thousand nine hundred sixty-nine Chogs live on Monad. Connect your wallet and find yours! |
| `02.mp3` | the pick (gate cut-in) | Every single token, rendered in full 3D. Pick the one you hold! |
| `03.mp3` | the street | Welcome to Genesis City! Grab a quest and hit the street! |
| `04.mp3` | the line | Past the line: the Tolls, packed with wild mobs and fat loot! |
| `05.mp3` | the pack | They roam in packs. Bring backup! |
| `06.mp3` | the ambush | Get spotted and it's an ambush! No countdown, just combat! |
| `07.mp3` | the duel | Six cards, one element. Preview the damage, then fire! |
| `08.mp3` | the drops | Everything you kill drops cards! Walk over and take them! |
| `09.mp3` | the reward | Loot goes straight into your deck. Zero waiting! |
| `10.mp3` | traits | Your Chog's traits ARE your stats! Rare head, real damage! |
| `11.mp3` | the deck | Tune your deck until it hurts! Then tune it more! |
| `12.mp3` | the market | Bad pull? Sell it! The market is always open! |
| `13.mp3` | the anomaly | And when the collection trades, the anomaly wakes! Volume is the raid boss! |
| `14.mp3` | the dungeon | Dungeons, parties, ranks! A real endgame with zero subscription! |
| `15.mp3` | the party | Squad up! Cover your friends and drag them home! |
| `16.mp3` | the ranks | Climb the ranks! Somebody has to be first! |
| `17.mp3` | the callout | Challenge anyone, anywhere! Two Chogs enter, one gets paid! |
| `18.mp3` | the bout | Winner takes the pot, paid in real Chog! |
| `end.mp3` | end card | Chog Wave! Chogathon demo! Your move! |
