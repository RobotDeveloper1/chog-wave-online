# Chog Wave — Brand Kit

A community game for the Chogathon, built on the Chog IP — the community-powered
mascot of Monad. The fantasy: **your Chog is the controller**. Not a skin, not a
pass — the character, the build, and the reason the sky opens.

## The one-liner

> Real Chog sales move the Wave. The Wave opens rifts. You pulse in.

## Key messages (say these everywhere)

1. **Every trait is a bonus.** Skin, Body, Head, Eyes, Mouth — everything
   on-chain becomes stats, cards, and powers. Nothing is cosmetic-only.
2. **Every Chog is playable.** No floor/ceiling gating, no banned tokens.
   Token #1 and token #1969 both walk the same street.
3. **The market is the final boss.** Anomalies spawn from real collection
   sales. Trading the collection literally raids the game.

## Assets

| file | use |
| --- | --- |
| `client/public/brand/chog-mark.svg` | the pixel-wave mark (favicon, avatar, coin) |
| `client/public/brand/chog-waves-lockup.svg` | full lockup: mark + wordmark + tagline |
| `client/public/brand/monad-lockup.svg` | "built on Monad" lockup (provided) |
| `client/public/brand/monad-mark.svg` | Monad mark (provided) |
| `docs/trailer/chog-waves-trailer.mp4` | 104s explainer trailer (gameplay, no voice) |
| `client/public/brand/chog-waves-keyart.jpg` | key art: the mascot surfing the wave (no type) |
| `client/public/brand/chog-waves-banner.jpg` | submission banner: key art + pixel lockup + tagline |

## Palette

Pulled from the game itself (`hud.css`), so screenshots and slides never clash.

| swatch | hex | name | use |
| --- | --- | --- | --- |
| plates | `#171129` | Plate | backgrounds, cards |
| wells | `#0a0716` | Recess | wells, video cards (`#141021` reads better on video) |
| ink | `#ece6fb` | Ink | headlines, body on dark |
| dim | `#a093c2` | Dim | secondary text |
| mint | `#43e2a8` | Wave / Mint | CTAs, wins, the brand accent |
| gold | `#f5c343` | Gold | money, ranks, warnings |
| rose | `#ff5d72` | Rose | damage, danger, HP |
| violet | `#9a72ea` | Violet | XP, Chog purple bridge |
| monad | `#836EF9` | Monad | only next to Monad's own lockup |
| chog | `#ff8fb8` | Chog Pink | identity accents: gate meme line, face rings, trailer cards |
| btc | `#f7931a` | Coin Orange | the glasses, sparingly — never body text |

The six wave hues (one per tribe — never invent a seventh):
burn `#ff7a45` · frost `#7fd8ff` · volt `#ffe066` ·
wave `#43e2a8` · prism `#cbb2f2` · void `#a874ff`.

## Type

- **Display:** Oxanium, 800, tight, uppercase. Falls back to Arial Black.
- **Mono/numbers:** Share Tech Mono — money, timers, stats, tickers.
- Rules: headlines shout (all caps), numbers never use the display face,
  body copy stays sentence case.
- **Meme lines** (the gate tagline, trailer cards): Impact, white with a black
  stroke. One line, no mercy: *Make Chog great again.*

## Voice

Short lines, surf-meets-market slang, no purple prose. The game talks like
a local, not a manual: *pulse in · ride the wave · the shelf turns over ·
mind the gap · WAGMI*. Explain mechanics in one breath; never three paragraphs.

The gate talks one notch more acidic than the game: the collection's humor is
memecoin, and the front door is allowed to say what the HUD cannot. Faces on
the gate are always real collection art (`/art/:id`), never redraws.

The pixel alphabet (`brand.ts`) has no S, and the name needs none: the game is
CHOG WAVE, singular, on the gate, the banner and the health check. (The 2024 chrome
lockup in `/brand/chog-waves-logo.jpg` still reads WAVES — it is retired, kept for
history. The mark is `/brand/chog-wave-logo.png`.)

## IP rules (Chog + Monad)

- Chog Wave is a **community project for the Chogathon**, powered by the
  community's mascot. Say that; never imply it is an official Monad product.
- Chog traits are the game's content — show real tokens, real traits, real
  bonuses. Never mock up fake traits for marketing.
- Monad's lockup/mark ship as provided; don't recolor, stretch, or set type in them.
- The trailer's market beat uses **simulated** fills (a judge can't wait on
  the market). On a live server the same rifts open from real sales — say so
  on screen when it matters, and the tx hashes are visibly `simulated:*`.
