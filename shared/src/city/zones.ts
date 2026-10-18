import type { SectorId } from '../wave.ts';
import { layoutZone } from './layout.ts';
import type { BlockDef, CityLayout, DoorDef, DoorKind, NpcDef, PoiDef, Side, ZonePlan } from './types.ts';

/**
 * The three districts as plans.
 *
 * These are level design, written as data: where the hub is, what you see first, which
 * way the main road runs, where the quiet corners are. Voltgrid and Hollow still follow
 * the old skeleton — a main street with the station on it, a crossing with the board, the
 * shops along one side, the fold gate at the far east — so a player who has learned one
 * can read the next.
 *
 * Ashflat is the city, and it is no longer built on that skeleton. It is a 7×5 place with
 * its own geography, and the whole point of the shape is that you can find your way round
 * it: the water along the north, the terraces behind it, the market across the middle,
 * the station standing on its own square — and the way down to the dungeons in plain
 * sight at the far end of the main avenue.
 *
 *        c0        c1        c2        c3        c4        c5        c6
 *  r0 ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
 *     │ wharf   │     THE CANAL     │ bridge  │  canal  │ wharf   │ lookout │
 *  r1 ├─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
 *     │ terrace │ gardens │ terrace │ chapel  │ gardens │ glass   │ ridge   │
 *  r2 ├─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
 *     │ old town│   MARKET ROW      │ guild   │ clinic  │ print   │ parade  │ ← spine
 *  r3 ├─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
 *     │ bell sq │ commons │ CROSSING│ STATION │ tribe   │ terminal│ works   │ ← heart
 *     │         │         │ (spawn) │         │         │         │         │
 *  r4 ├─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
 *     │ terrace │    RAIL YARD      │ depot   │ FOLDGATE│ scrap   │ ruin    │
 *     └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
 *                                        ▲ main avenue (c3|c4): station → fold gate
 *
 * The fold gate is a landmark now — a lit portal frame standing in the open middle of its
 * yard, straight down the avenue from the station — because it used to be a door on a
 * warehouse behind three stacks of containers, and nobody could find it.
 */

const door = (id: string, kind: DoorKind, label: string, side: Side, at: number): DoorDef => ({ id, kind, label, side, at });

const npc = (
  id: string,
  name: string,
  tribe: NpcDef['tribe'],
  line: string,
  at: NpcDef['at'],
  role: NpcDef['role'] = 'quest',
  face: 0 | 1 | 2 | 3 = 2,
  hidden = false,
): NpcDef => ({ id, name, tribe, line, at, role, face, ...(hidden ? { hidden } : {}) });

const B = (kind: BlockDef['kind'], name: string, seed: number, extra: Partial<BlockDef> = {}): BlockDef => ({ kind, name, seed, ...extra });

// ---------------------------------------------------------------------------
// GENESIS — the city: terraces stepping down to the canal, and the station at
// the heart of it
//
// The old plan was one street with the station on it and everything else hung off
// either side of that street, which is why it read as a corridor and why the fold gate
// — tucked in a yard at the far corner behind three stacks of containers — was a thing
// players could not find. This is a different shape of place:
//
//   · the water runs along the NORTH, with the wharf and the bridge on it;
//   · the terraces and gardens climb behind the water;
//   · the market and the shops fill the long spine across the middle;
//   · the STATION stands in the middle of the south, on its own square;
//   · the rail yard, the depots and the ruins are the far south;
//   · the FOLD GATE is a landmark in the open middle of its yard, on the sightline
//     straight down the main avenue from the station, so it is the one thing in the
//     district you can always see where you are.
// ---------------------------------------------------------------------------

const ASH_COLS = [28, 22, 30, 34, 30, 22, 28];
const ASH_ROWS = [30, 22, 32, 34, 32, 22, 30];
/** Distance from a block's centre to the middle of one of its sidewalks. */
const sw = (rows: number[], r: number): number => rows[r]! / 2 - 1.5;
const se = (cols: number[], c: number): number => cols[c]! / 2 - 1.5;

const ASHFLAT: ZonePlan = {
  sector: 'ashflat',
  name: 'GENESIS',
  tagline: 'an island inside its own moat: one spine from the north gate to the fold gate, a bazaar cutting across the middle',
  colW: ASH_COLS,
  rowD: ASH_ROWS,
  // The moat columns and rows are thin on purpose: the water is a channel you see across, not a
  // district you get lost in. The wide gaps are the quays on either side of it and the spine.
  gapX: [14, 12, 16, 18, 16, 12],
  gapZ: [14, 12, 16, 16, 12, 14],
  ring: 15,
  mainRow: 3,
  mainCol: 3,
  blocks: [
    // r0 · the north shore: you arrive at the gate plaza, the rail wedge owns the west, and the
    // beacon towers are the first thing the spine points at from inside the moat
    [
      B('rail', 'Old Rail Yard', 1),
      B('rail', 'Old Rail Yard', 2),
      B('plaza', 'North Gate', 3, { landmark: 'monument' }),
      B('houses', 'Gate Terrace', 4, { doors: [door('a-bakery', 'home', 'BAKERY', 'S', 0.4)] }),
      B('houses', 'Gate Terrace', 5),
      B('towers', 'Beacon Row', 6, { tall: 1.5 }),
      B('park', 'North Point', 7),
    ],
    // r1 · the moat's north arm: five channels and one bridge, on the spine, that every player
    // crosses exactly once on the way in. The row is a channel, so its ends are banks you stand on,
    // not housing — a rowhouse filler does not fit in twenty-two units of depth.
    [
      B('park', 'Wharf Side', 8),
      B('water', 'The Moat', 9),
      B('water', 'The Moat', 10),
      B('water', 'Gate Bridge', 11),
      B('water', 'The Moat', 12),
      B('water', 'The Moat', 13),
      B('park', 'Beacon Banks', 14),
    ],
    // r2 · the island's north: the station on its square, at the head of the spine, with the
    // custom house and the clinic facing it across the water
    [
      B('industrial', 'Depot Row', 15),
      B('water', 'The Moat', 16),
      B('shops', 'Custom House', 17, { doors: [door('a-clinic', 'heal', 'CLINIC', 'E', 0.5)] }),
      B('station', 'Wave Station', 18, { doors: [door('a-station', 'station', 'WAVE STATION', 'S', 0.5)] }),
      B('shops', 'Custom House', 19),
      B('water', 'The Moat', 20),
      B('shops', 'Beacon Arcade', 21),
    ],
    // r3 · the island's middle: the bazaar runs east-west straight through the crossing, and the
    // crossing is where the two axes of the city meet — the one block you can orient from anywhere
    [
      B('rail', 'Freight Sidings', 22),
      B('water', 'The Moat', 23),
      B('market', 'Bazaar Cut', 24, { doors: [door('a-card', 'shop', 'CHIP SHOP', 'S', 0.5)] }),
      B('plaza', 'The Crossing', 25, { landmark: 'fountain' }),
      B('market', 'Bazaar Cut', 26, { doors: [door('a-noodle', 'home', 'NOODLE BAR', 'N', 0.4)] }),
      B('water', 'The Moat', 27),
      B('tenements', 'East Stack', 28, { tall: 1.3 }),
    ],
    // r4 · the island's south: the quays hold the tribe hall and the terminal, with a green between
    // them so the spine stays open water-to-water
    [
      B('houses', 'Wharf Side', 29),
      B('water', 'The Moat', 30),
      B('shops', 'Guild Quay', 31, { doors: [door('a-tribe', 'brother', 'TRIBE HALL', 'W', 0.5)] }),
      B('park', 'The Green', 32, { landmark: 'bandstand' }),
      B('shops', 'Print Quay', 33, { doors: [door('a-terminal', 'telemetry', 'TERMINAL', 'E', 0.5)] }),
      B('water', 'The Moat', 34),
      B('tenements', 'East Stack', 35, { tall: 1.2 }),
    ],
    // r5 · the moat's south arm, with the second bridge on the spine: the gate approach is the only
    // way across, so leaving the island is always a decision you can see yourself making
    [
      B('greenhouse', 'Glass Banks', 36),
      B('water', 'The Moat', 37),
      B('water', 'The Moat', 38),
      B('water', 'Gate Bridge', 39),
      B('water', 'The Moat', 40),
      B('water', 'The Moat', 41),
      B('ruin', 'Ash Pit', 42),
    ],
    // r6 · the south shore: the fold gate stands in the open middle of its yard at the far end of
    // the spine, so from the station square you are always looking straight at the way down
    [
      B('ruin', 'Scrap Lot', 43),
      B('industrial', 'South Works', 44),
      B('plaza', 'Gate Approach', 45),
      B('industrial', 'Foldgate Yard', 46, { landmark: 'foldGate', doors: [door('a-fold', 'dungeon', 'FOLD GATE', 'N', 0.5)] }),
      B('plaza', 'Gate Approach', 47),
      B('industrial', 'South Works', 48),
      B('ruin', 'Ash Pit', 49),
    ],
  ],
  // there is one city: nothing leaves it but the folds under the Foldgate Yard
  gates: [],
  // You arrive on the station square facing south, so the first frame of the game is the whole
  // sightline: crossing, green, bridge, gate.
  spawn: { block: [3, 2], dx: 0, dz: 10 },
  npcs: [
    npc('a-dealer', 'DEALER 143', 'volt', 'stock moves with the floor — buy now', { door: 'a-card', dx: 4.5 }, 'shop'),
    npc('a-nurse', 'NURSE HOLLOW', 'wave', 'you look like you walked out of a storm', { door: 'a-clinic', dx: 4.5 }, 'heal'),
    npc('a-operator', 'OPERATOR', 'prism', 'station is hot — pulse when you are ready', { door: 'a-station', dx: -8, dz: 0.5 }, 'quest', 2),
    npc('a-scribe', 'SCRIBE', 'burn', 'the war resets at the week’s end', { door: 'a-tribe', dx: 4.5 }, 'quest'),
    npc('a-archivist', 'ARCHIVIST', 'void', 'every Chog is a sentence in the album', { door: 'a-terminal', dx: -4.5 }, 'quest'),
    npc('a-watchman', 'WATCHMAN', 'frost', 'the gate stands open — the foundry is still warm', { door: 'a-fold', dx: 4.5 }, 'quest'),
    npc('a-board', 'QUEST BOARD', 'prism', 'contracts, posted fresh each day', { block: [3, 3], dx: 7, dz: -2 }, 'board'),
    npc('a-baker', 'BAKER MIRA', 'burn', 'bread first, then the end of the world', { door: 'a-bakery', dx: 4.5 }, 'quest'),
    npc('a-noodle', 'NOODLE COOK', 'wave', 'two bowls, one rumour', { door: 'a-noodle', dx: 4.5 }, 'lore'),
    npc('a-clock', 'CLOCKKEEPER', 'prism', 'it has not been right since the Index started', { block: [6, 0], dx: 0, dz: 8 }, 'quest'),
    npc('a-elder', 'ELDER SPARK', 'prism', 'I remember when the wave was quiet', { block: [0, 0], dx: 5, dz: sw(ASH_ROWS, 0) }, 'quest', 2),
    npc('a-gardener', 'GARDENER', 'wave', 'nothing grows in a storm — ask me why', { block: [3, 4], dx: -8, dz: 6 }, 'quest'),
    npc('a-fisher', 'OLD FISHER', 'wave', 'the moat keeps what the street loses', { block: [3, 1], dx: 6, dz: 0 }, 'quest', 1),
    npc('a-engineer', 'RAIL ENGINEER', 'volt', 'last train left before the Index', { block: [1, 0], dx: -8, dz: -1.5 }, 'quest'),
    npc('a-scrapper', 'SCRAPPER', 'void', 'one man’s static, another man’s cards', { block: [6, 6], dx: 3, dz: -sw(ASH_ROWS, 6) }, 'quest'),
    npc('a-hertz', 'MR. HERTZ', 'prism', '…you can see me. good. do not tell the others.', { block: [0, 3], dx: -3, dz: -sw(ASH_ROWS, 3) }, 'hertz', 2, true),
    npc('a-courier', 'COURIER', 'frost', 'the Index delivers everything, eventually', { block: [6, 3], dx: se(ASH_COLS, 6), dz: 0 }, 'quest'),
  ],
  pois: [
    { id: 'a-vista', name: 'BEACON VISTA', kind: 'vista', at: { block: [6, 0], dx: 4, dz: -10 }, radius: 6, text: 'From under the beacon towers the moat reads as a ring of light, and the island inside it as one roofline.' },
    { id: 'a-bridge', name: 'GATE BRIDGE', kind: 'landmark', at: { block: [3, 1], dx: 0, dz: 0 }, radius: 6, text: 'Every card that ever entered Genesis crossed this bridge in somebody’s bag.' },
    { id: 'a-oldclock', name: 'THE OLD CLOCK', kind: 'landmark', at: { block: [6, 0], dx: 0, dz: 9 }, radius: 7, text: 'The hands stopped at the first Anomaly. Nobody has dared set them.' },
    { id: 'a-spring', name: 'HIDDEN SPRING', kind: 'secret', at: { block: [3, 4], dx: 10, dz: -9 }, radius: 4.5, text: 'A spring under the bandstand; the water tastes faintly of static.' },
    { id: 'a-last', name: 'THE LAST TRAIN', kind: 'hangout', at: { block: [1, 0], dx: 6, dz: -1.5 }, radius: 6, text: 'Kids sit on the platform and bet on which train will not come.' },
    { id: 'a-shrine', name: 'SCRAP SHRINE', kind: 'secret', at: { block: [6, 6], dx: 3, dz: 6 }, radius: 4.5, text: 'Cards pinned to a wall, offered to nobody. Some are still warm.' },
  ],
};

// ---------------------------------------------------------------------------
// VOLTGRID — the canyon of towers
// ---------------------------------------------------------------------------

const VOLT_COLS = [30, 28, 32, 32, 28, 30];
const VOLT_ROWS = [34, 34, 36, 32];

const VOLTGRID: ZonePlan = {
  sector: 'voltgrid',
  name: 'VOLTGRID',
  tagline: 'neon over wet asphalt, and a relay that never sleeps',
  colW: VOLT_COLS,
  rowD: VOLT_ROWS,
  gapX: [13, 15, 19, 15, 13],
  gapZ: [13, 21, 13],
  ring: 15,
  mainRow: 1,
  mainCol: 2,
  blocks: [
    [
      B('towers', 'North Stacks', 31, { tall: 1.15 }),
      B('towers', 'North Stacks', 32, { tall: 1.25 }),
      B('plaza', 'Relay Plaza', 33, { landmark: 'holoPillar' }),
      B('towers', 'Data Banks', 34, { tall: 1.3 }),
      B('towers', 'Data Banks', 35, { tall: 1.1 }),
      B('industrial', 'Substation 07', 36),
    ],
    [
      B('shops', 'Neon Strip', 37, { doors: [door('v-card', 'shop', 'CHIP KIOSK', 'S', 0.5)] }),
      B('shops', 'Neon Strip', 38, { doors: [door('v-noodle', 'home', 'NODE BAR', 'S', 0.42)] }),
      B('shops', 'Neon Strip', 39, { doors: [door('v-clinic', 'heal', 'SIGNAL LANE', 'S', 0.5)] }),
      B('station', 'Wave Station', 40, { doors: [door('v-station', 'station', 'WAVE STATION', 'S', 0.5)] }),
      B('shops', 'Grid Exchange', 41, { doors: [door('v-tribe', 'brother', 'TRIBE HALL', 'S', 0.45)] }),
      B('towers', 'Core Tower', 42, { tall: 1.2, doors: [door('v-terminal', 'telemetry', 'TERMINAL', 'S', 0.5)] }),
    ],
    [
      B('market', 'Night Market', 43),
      B('market', 'Night Market', 44),
      B('plaza', 'Hub Crossing', 45, { landmark: 'holoPillar' }),
      B('shops', 'Relay Row', 46),
      B('tenements', 'Low Town', 47),
      B('industrial', 'Foldgate Yard', 48, { doors: [door('v-fold', 'dungeon', 'FOLD GATE', 'N', 0.5)] }),
    ],
    [
      B('ruin', 'Burnt Block', 49),
      B('tenements', 'Low Town', 50),
      B('park', 'Sky Garden', 51),
      B('rail', 'Monorail Hub', 52),
      B('tenements', 'Low Town', 53),
      B('ruin', 'Burnt Block', 54),
    ],
  ],
  gates: [
    { side: 'W', to: 'ashflat', label: 'TRANSIT WEST · ASHFLAT' },
    { side: 'E', to: 'hollow', label: 'TRANSIT EAST · HOLLOW' },
  ],
  spawn: { block: [2, 2], dx: 0, dz: -9 },
  npcs: [
    npc('v-dealer', 'KIOSK 7', 'volt', 'every card here fell off a server', { door: 'v-card', dx: 4.5 }, 'shop'),
    npc('v-nurse', 'TECH MEDIC', 'wave', 'your integrity is a rumour, hold still', { door: 'v-clinic', dx: 4.5 }, 'heal'),
    npc('v-operator', 'RELAY OPERATOR', 'prism', 'the index never drops below the floor here', { door: 'v-station', dx: -8, dz: 0.5 }, 'quest'),
    npc('v-scribe', 'EXCHANGE CLERK', 'burn', 'volume is the only honest number', { door: 'v-tribe', dx: 4.5 }, 'quest'),
    npc('v-archivist', 'CORE ARCHIVE', 'void', 'the tower remembers every Chog that passed', { door: 'v-terminal', dx: -4.5 }, 'quest'),
    npc('v-watchman', 'GATE WARDEN', 'frost', 'the fold is deeper on this side of the river', { door: 'v-fold', dx: 4.5 }, 'quest'),
    npc('v-board', 'CONTRACT BOARD', 'prism', 'neon contracts, paid in WAV', { block: [2, 2], dx: 7, dz: -2 }, 'board'),
    npc('v-noodle', 'NODE BARTENDER', 'wave', 'ask me what the tape says', { door: 'v-noodle', dx: 4.5 }, 'lore'),
    npc('v-hacker', 'GLITCH KID', 'void', 'there is a hole in the market tape, want to see?', { block: [0, 2], dx: -8, dz: 10 }, 'quest'),
    npc('v-spire', 'SPIRE TECH', 'volt', 'do not look at the beam when it turns red', { block: [2, 0], dx: 9, dz: 9 }, 'quest'),
    npc('v-vendor', 'NIGHT VENDOR', 'burn', 'hot cards, cold drinks', { block: [0, 2], dx: 6, dz: -9 }, 'lore'),
    npc('v-driver', 'MONORAIL DRIVER', 'frost', 'the line goes everywhere the Index does', { block: [3, 3], dx: -8, dz: -1.5 }, 'quest'),
    npc('v-roof', 'ROOFTOP COURIER', 'prism', 'I cut across the stacks — mind the gap', { block: [1, 0], dx: 0, dz: sw(VOLT_ROWS, 0) }, 'quest'),
    npc('v-hertz', 'MR. HERTZ', 'prism', '…the neon is not the only thing glowing here.', { block: [5, 3], dx: -3, dz: -sw(VOLT_ROWS, 3) }, 'hertz', 2, true),
  ],
  pois: [
    { id: 'v-spire', name: 'RELAY SPIRE', kind: 'landmark', at: { block: [2, 0], dx: 0, dz: 0 }, radius: 8, text: 'The spire carries every packet in Voltgrid. Its beam changes colour with the Index.' },
    { id: 'v-sky', name: 'SKY GARDEN', kind: 'vista', at: { block: [2, 3], dx: 0, dz: 0 }, radius: 7, text: 'The only grass in Voltgrid, kept alive by the heat of the relays.' },
    { id: 'v-market', name: 'NIGHT MARKET', kind: 'hangout', at: { block: [1, 2], dx: 0, dz: 0 }, radius: 9, text: 'The market never closes. Neither does the tape.' },
    { id: 'v-burnt', name: 'BURNT BLOCK', kind: 'secret', at: { block: [0, 3], dx: 2, dz: 2 }, radius: 5, text: 'A block that lost its power and kept its ghosts.' },
    { id: 'v-core', name: 'CORE TOWER', kind: 'landmark', at: { block: [5, 1], dx: 0, dz: 0 }, radius: 8, text: 'Every Chog ever sighted is written on its walls.' },
  ],
};

// ---------------------------------------------------------------------------
// HOLLOW — the garden gone feral
// ---------------------------------------------------------------------------

const HOLLOW_COLS = [32, 30, 30, 32, 28, 30];
const HOLLOW_ROWS = [36, 34, 34, 32];

const HOLLOW: ZonePlan = {
  sector: 'hollow',
  name: 'HOLLOW',
  tagline: 'overcast, overgrown, and quietly the busiest place in the city',
  colW: HOLLOW_COLS,
  rowD: HOLLOW_ROWS,
  gapX: [15, 13, 19, 13, 15],
  gapZ: [15, 19, 13],
  ring: 15,
  mainRow: 1,
  mainCol: 2,
  blocks: [
    [
      B('greenhouse', 'Glass Gardens', 61),
      B('greenhouse', 'Glass Gardens', 62, { landmark: 'dome' }),
      B('park', 'Hollow Green', 63, { landmark: 'bandstand' }),
      B('plaza', 'Market Square', 64, { landmark: 'monument' }),
      B('market', 'Market Square', 65),
      B('ruin', 'The Overgrowth', 66),
    ],
    [
      B('shops', 'Arcade Row', 67, { doors: [door('h-card', 'shop', 'CHIP SHOP', 'S', 0.5)] }),
      B('shops', 'Arcade Row', 68, { doors: [door('h-noodle', 'home', 'TEA HOUSE', 'S', 0.4)] }),
      B('shops', 'Clinic Row', 69, { doors: [door('h-clinic', 'heal', 'CLINIC', 'S', 0.5)] }),
      B('station', 'Wave Station', 70, { doors: [door('h-station', 'station', 'WAVE STATION', 'S', 0.5)] }),
      B('shops', 'Tribe Arcade', 71, { doors: [door('h-tribe', 'brother', 'TRIBE HALL', 'S', 0.45)] }),
      B('tenements', 'Terminal Arcade', 72, { doors: [door('h-terminal', 'telemetry', 'TERMINAL', 'S', 0.5)] }),
    ],
    [
      B('water', 'The Reservoir', 73),
      B('park', 'Reservoir Park', 74),
      B('plaza', 'The Yard', 75, { landmark: 'fountain' }),
      B('tenements', 'Arch Row', 76),
      B('industrial', 'Construction Yard', 77),
      B('industrial', 'Foldgate Yard', 78, { doors: [door('h-fold', 'dungeon', 'FOLD GATE', 'N', 0.5)] }),
    ],
    [
      B('houses', 'Mossy Terraces', 79),
      B('greenhouse', 'Allotments', 80),
      B('rail', 'Overgrown Cut', 81),
      B('rail', 'Overgrown Cut', 82),
      B('ruin', 'The Collapse', 83),
      B('ruin', 'The Collapse', 84),
    ],
  ],
  gates: [
    { side: 'W', to: 'voltgrid', label: 'TRANSIT WEST · VOLTGRID' },
    { side: 'E', to: 'ashflat', label: 'TRANSIT EAST · ASHFLAT' },
  ],
  spawn: { block: [2, 2], dx: 0, dz: -9 },
  npcs: [
    npc('h-dealer', 'HERB DEALER', 'volt', 'cards grow on the trellis if you wait', { door: 'h-card', dx: 4.5 }, 'shop'),
    npc('h-nurse', 'DOCTOR MOSS', 'wave', 'everything heals here, eventually', { door: 'h-clinic', dx: 4.5 }, 'heal'),
    npc('h-operator', 'STATION KEEPER', 'prism', 'the vines reach the dial — watch the Index', { door: 'h-station', dx: -8, dz: 0.5 }, 'quest'),
    npc('h-scribe', 'WAR WARDEN', 'burn', 'the arcade remembers every score', { door: 'h-tribe', dx: 4.5 }, 'quest'),
    npc('h-archivist', 'SEED KEEPER', 'void', 'every trait is a seed in the album', { door: 'h-terminal', dx: -4.5 }, 'quest'),
    npc('h-watchman', 'YARD FOREMAN', 'frost', 'the fold is behind the crane, don’t stand under it', { door: 'h-fold', dx: 4.5 }, 'quest'),
    npc('h-board', 'GARDEN BOARD', 'prism', 'chores that pay in WAV', { block: [2, 2], dx: 7, dz: -2 }, 'board'),
    npc('h-tea', 'TEA MISTRESS', 'wave', 'sit. the storm will wait', { door: 'h-noodle', dx: 4.5 }, 'lore'),
    npc('h-gardener', 'HEAD GARDENER', 'wave', 'the dome keeps the rain out and the wave in', { block: [1, 0], dx: 0, dz: sw(HOLLOW_ROWS, 0) }, 'quest'),
    npc('h-ferryman', 'RESERVOIR WARDEN', 'frost', 'the water is deeper than it looks', { block: [0, 2], dx: -9.4, dz: -4 }, 'quest', 1),
    npc('h-foreman', 'CRANE OPERATOR', 'volt', 'she swings both ways, so do the contracts', { block: [4, 2], dx: -6, dz: sw(HOLLOW_ROWS, 2) }, 'quest'),
    npc('h-vendor', 'MARKET HAWKER', 'burn', 'greens by the bundle, cards by the pound', { block: [4, 0], dx: 0, dz: sw(HOLLOW_ROWS, 0) }, 'lore'),
    npc('h-wanderer', 'MOSS WANDERER', 'void', 'the collapse took the old terminal. the cards stayed', { block: [4, 3], dx: 4, dz: -sw(HOLLOW_ROWS, 3) }, 'quest'),
    npc('h-hertz', 'MR. HERTZ', 'prism', '…the plants listen, you know.', { block: [5, 3], dx: -3, dz: -sw(HOLLOW_ROWS, 3) }, 'hertz', 2, true),
  ],
  pois: [
    { id: 'h-dome', name: 'THE GREAT DOME', kind: 'landmark', at: { block: [1, 0], dx: 0, dz: 2 }, radius: 10, text: 'The dome was a clinic once. The plants moved in; the doctors stayed.' },
    { id: 'h-reservoir', name: 'RESERVOIR BRIDGE', kind: 'vista', at: { block: [0, 2], dx: 0, dz: 0 }, radius: 7, text: 'From the bridge you can see the whole district reflected, upside-down and greener.' },
    { id: 'h-crane', name: 'CRANE YARD', kind: 'landmark', at: { block: [4, 2], dx: 0, dz: 0 }, radius: 9, text: 'The crane has been mid-lift for six months. Nobody knows what it was carrying.' },
    { id: 'h-cut', name: 'OVERGROWN CUT', kind: 'hangout', at: { block: [2, 3], dx: 0, dz: -1.5 }, radius: 7, text: 'A railway cutting swallowed by ivy. The rails still hum.' },
    { id: 'h-collapse', name: 'THE COLLAPSE', kind: 'secret', at: { block: [5, 3], dx: 3, dz: 5 }, radius: 5, text: 'Under the rubble: cards, and a door that was not on any plan.' },
  ],
};

export const ZONES: Record<SectorId, ZonePlan> = {
  ashflat: ASHFLAT,
  voltgrid: VOLTGRID,
  hollow: HOLLOW,
};

const cache = new Map<SectorId, CityLayout>();

/** The resolved city for a district. Pure, deterministic, and cached because it is not cheap. */
export function cityOf(sector: SectorId): CityLayout {
  let hit = cache.get(sector);
  if (!hit) {
    hit = layoutZone(ZONES[sector]);
    cache.set(sector, hit);
  }
  return hit;
}

/** Everyone and everything the plan names, by id — the lookup the quest system shares. */
export function npcOf(id: string): { npc: NpcDef; sector: SectorId } | null {
  for (const sector of Object.keys(ZONES) as SectorId[]) {
    const hit = ZONES[sector].npcs.find((n) => n.id === id);
    if (hit) return { npc: hit, sector };
  }
  return null;
}

export function poiOf(id: string): { poi: PoiDef; sector: SectorId } | null {
  for (const sector of Object.keys(ZONES) as SectorId[]) {
    const hit = ZONES[sector].pois.find((p) => p.id === id);
    if (hit) return { poi: hit, sector };
  }
  return null;
}
