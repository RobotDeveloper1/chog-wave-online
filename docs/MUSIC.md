# Music — real tracks, one per place

The synthesiser (`client/src/audio.ts`) does effects. Music is files: `client/src/music.ts`
keeps one track playing per scene, crossfades over 2 seconds on change, and never breaks
when a file is missing — a region without its track falls back to the shared `line` track,
and with nothing left it parks on the generative bed that place always had.

## Slots

Drop MP3s in `client/public/music/` (served at `/music/` in dev, copied to `dist` on build):

| slot | file | plays where |
|---|---|---|
| `title` | `title.mp3` | title screen |
| `city` | `city.mp3` | the street |
| `duel` | `duel.mp3` | every duel |
| `dungeon` | `dungeon.mp3` | dungeon folds |
| `line` | `line.mp3` | any Line region without its own track |
| `tolls` … `static` | `<region>.mp3` | that Line region |

Any subset works. The game sounds exactly like today until the first file lands.

## File spec

- MP3, 44.1 or 48 kHz stereo, 128–192 kbps. MP3 because it plays everywhere
  including Safari; the player does not try other extensions.
- Mixed around −14 LUFS integrated, peaks under −1 dBTP. The music bus sits at
  0.55 under the effects; a hot master will still shout over them.
- Seamless loop, 1–3 minutes, no intro/outro tails: the player hard-loops.
  (MP3 loop points can tick ~50 ms on some browsers; scene changes crossfade,
  the loop itself does not — trim to zero crossings.)
- Player behaviour: 2 s crossfade between tracks, volume persisted
  (`chog:music-vol`), mute follows the N/M keys. Every switch and every 404 is
  logged as `[music]`; `musicStatus()` in the console shows slot, file, and
  what is missing.

## Licensing (hard rule)

Only ship files the project owns or licenses: commissioned, bought, or
royalty-free with its terms honoured. Attribution-needing files get a
`<track>.LICENSE.txt` next to them with source, author, license and link.
Never hotlink the internet, never commit rips.

## Testing

Drop files, refresh — no server restart (client-only). Travel city → Line →
duel and watch the console: one `[music] playing …` line per change, one
`missing, falling back` line per absent file, and never a silent scene that
used to have its bed.
