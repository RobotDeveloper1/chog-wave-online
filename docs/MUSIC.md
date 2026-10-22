# Music — real tracks, one per place

The synthesiser (`client/src/audio.ts`) does effects. Music is files: `client/src/music.ts`
keeps one track playing per scene, crossfades over 2 seconds on change, and never breaks
when a file is missing — a region without its track falls back to the shared `line` track,
and with nothing left it parks on the generative bed that place always had.

All shipped tracks are renders of the project's own `CHOG WORLD ORDER`, so the
game sounds like one place: the gate calls `playMusic('title')` on open
(`client/src/app/picker.ts`), the shell takes it to `city`/`duel`/`dungeon`/Line
regions from there, and scene changes crossfade.

## Slots

| slot | file | plays where |
|---|---|---|
| `title` | `chog-wave-login.ogg` | the gate |
| `city` | `chog-wave-street.ogg` | the street |
| `duel` | `chog-wave-duel.ogg` | every duel |
| `dungeon` | `chog-wave-dungeon.ogg` | dungeon folds |
| `line` | `chog-wave-street.ogg` | any Line region without its own track |
| `tolls` … `static` | (falls back to `line`) | that Line region |

Files live in `client/public/audio/` (served at `/audio/` in dev, copied to `dist` on build).

## File spec

- OGG (Opus), 48 kHz stereo. Browsers without OGG support (Safari) fall back
  to the generative bed per scene — never silence that used to have music.
- Mixed around −14 LUFS integrated, peaks under −1 dBTP. The music bus sits
  under the effects; a hot master will still shout over them.
- Seamless loop, 1–3 minutes, no intro/outro tails: the player hard-loops.
- Player behaviour: 2 s crossfade between tracks, volume persisted
  (`chog:music-vol`), mute follows the N/M keys. Every switch and every 404 is
  logged as `[music]`; `musicStatus()` in the console shows slot, file, and
  what is missing. With `?capture=1` the gate also exposes `window.__music()`.

## Licensing (hard rule)

Only ship files the project owns or licenses: commissioned, bought, or
royalty-free with its terms honoured. Attribution-needing files get a
`<track>.LICENSE.txt` next to them with source, author, license and link.
Never hotlink the internet, never commit rips.

## Testing

Refresh — no server restart (client-only). Gate → city → Line → duel and watch
the console: one `[music] playing …` line per change, one
`missing, falling back` line per absent file, and never a silent scene that
used to have its bed.
