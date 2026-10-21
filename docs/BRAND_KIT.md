# ⚡ CHOG WAVE — Official Brand Kit & Style Guide

> **Game Title:** CHOG WAVE (Chog Wave Online)  
> **Network:** Monad Mainnet (Chain ID: `143`)  
> **Inspiration:** *Mega Man Star Force* (Nintendo DS) × *Mega Man Battle Network* (GBA)  
> **Mascot:** Chog (Monad Genesis NFT Mascot)

---

## 1. Brand Vision & Narrative

**CHOG WAVE** is an online action RPG that blends fast-paced electromagnetic wave combat with real-time multiplayer city exploration on the high-speed Monad blockchain.

* **The Premise:** Beyond the physical streets of the city lies the **Electromagnetic Wave World (EM-Wave World)**. Players equip their **Visualizer** to perceive wave highways (Wave Roads), detect digital anomalies, and battle viruses.
* **The Mascot (Chog):** Chog is a spiky purple creature native to the Monad ecosystem. Equipped with a translucent cyan **Visualizer Headset**, Chog synchronizes with the network to execute **Wave Change**—materializing into battle-ready wave bodies.
* **Frictionless Entry:** Through Privy, players can link their Transer via instant email code or Web3 wallet. Players without a Genesis NFT can freely enter as a **Foster Chog**, ensuring an open and inclusive community.

---

## 2. Logo System & Marks

### A. Primary Action Title Logo (`chog-waves-logo.jpg`)
* **Aspect Ratio:** `16:9` (Title Screen, Hero Displays, Steam/Web Banners)
* **Design Features:**
  * Bold 3D metallic chrome typography with sharp Capcom-style angular bevels.
  * Vibrant Monad Purple (`#836EF9`) and electric cyan neon outlines.
  * Integrated pulse wave frequency running through the center of "WAVES".
  * Mascot Chog wearing the EM Visualizer with radiating holographic wave auras.
* **Path:** `/brand/chog-waves-logo.jpg`

### B. Star Carrier / Transer Crest (`chog-waves-emblem.jpg`)
* **Aspect Ratio:** `1:1` (App Icon, Profile Avatars, Coins, Cartridge Badges, HUD Crest)
* **Design Features:**
  * Circular metallic cyber badge inspired by the Nintendo DS *Star Carrier* and *Transer* personal terminals.
  * High-tech cyan soundwave frequency meter across the visor.
  * Glowing neon ring with status LED nodes and chrome framing.
* **Path:** `/brand/chog-waves-emblem.jpg`

### C. Pixel Wordmark (HUD & Telemetry)
* **Format:** Scalable hand-crafted SVG rect matrix on a 5×7 pixel grid.
* **Dynamic Wave Ribbon:** Serves as the game’s live diagnostic lamp:
  * 🟢 **Mint (`#43E2A8`):** System Ready / Synchronized
  * 🟡 **Gold (`#F5C343`):** Reading Chain / Syncing
  * 🔴 **Rose (`#FF5D72`):** Network Error / Refused
* **Implementation:** `client/src/app/brand.ts` via `wordmark()`

---

## 3. Color Palette & Hierarchy

| Semantic Role | Color Name | Hex Code | Usage |
| :--- | :--- | :--- | :--- |
| **Primary Identity** | Monad Violet | `#836EF9` | Main brand color, blockchain seals, cosmic depth |
| **Active Accent** | EM-Wave Mint | `#43E2A8` | Buttons, ready state, live frequency, wave roads |
| **High Frequency** | Cyber Cyan | `#00F5D4` | Visualizer lens, electric pulse highlights |
| **Telemetry / Sync** | Star Force Gold | `#F5C343` | Scanning state, chain telemetry, rank accents |
| **Overheat / Anomaly** | Plasma Rose | `#FF5D72` | Errors, server refusal, anomaly alerts |
| **Surface Plate** | Void Plate | `#171129` | HUD cards, terminal panels, modal surfaces |
| **Deep Space** | Monad Abyss | `#06040C` | Viewport background, cosmic canvas base |

### Elemental Affinities Matrix
Every Genesis Chog is attuned to an elemental frequency:

* 🔥 **Burn:** `#FF7A45` (Thermal / Fire attacks)
* ❄️ **Frost:** `#7FD8FF` (Cryo / Water attacks)
* ⚡ **Volt:** `#FFE066` (Electro / Stun attacks)
* 🌊 **Wave:** `#43E2A8` (Wind / EM Pulse attacks)
* 🔮 **Prism:** `#CBB2F2` (Light / Shielding)
* 🌌 **Void:** `#A874FF` (Dark / Gravity anomalies)

---

## 4. Typography System

* **Display & Title Headers:** `Oxanium` (Weights: 600, 700, 800)
  * Angular, beveled sci-fi cuts matching Japanese action games.
  * Used for headlines, CTA buttons, and character names.
* **System Telemetry & Monospace:** `Share Tech Mono` (Weight: 400)
  * Used for frequencies, Monad Chain hex readouts, battle stats, and HUD numbers.
* **Fallbacks:** `ui-monospace`, `Consolas`, `Segoe UI`, `monospace`.

---

## 5. UI & Component Design Tokens

### A. Cybernetic Chamfer Cut (Transer Plate)
```css
clip-path: polygon(0 0, calc(100% - .6em) 0, 100% .6em, 100% 100%, 0 100%);
```
Applied to all primary action buttons, terminal containers, and dialogue balloons.

### B. Neon Glow Effects
```css
box-shadow: 0 0 16px rgba(67, 226, 168, 0.45);
text-shadow: 0 0 8px rgba(67, 226, 168, 0.6);
```

### C. Star Force Corner Brackets
Four HUD reticle corners (`.pk-bracket-tl`, `.pk-bracket-tr`, `.pk-bracket-bl`, `.pk-bracket-br`) that frame the screen like an EM-Wave Visor.

---

## 6. Sound & Interactive Identity

* **Audio Bed:** Procedural / Lo-Fi EM dub rendered from `CHOG WORLD ORDER` (4 adaptive scene stems: `login`, `street`, `duel`, `dungeon`).
* **Audio-Reactive UI (`--beat`):** The audio element feeds a WebAudio AnalyserNode, publishing `--beat` (0.0 to 1.0) to CSS for subtle real-time pulsing of waveforms, buttons, and equalizers.
* **Synthesized SFX Palette:**
  * `sfx.ui()` — Crisp high-tech tick (`tone(700, 0.04)`)
  * `sfx.pick()` — Chip/Card selection chirp (`tone(880, 0.05)`)
  * `sfx.fire()` — Dual ascending confirmation chime (`220Hz -> 1400Hz`)
  * `sfx.link()` — Wave synchronization pulse (`660Hz -> 990Hz`)
  * `sfx.deny()` — Buzzing saw refusal (`150Hz -> 90Hz`)
