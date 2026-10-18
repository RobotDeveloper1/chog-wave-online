import type { Element } from './types.ts';
import type { SectorId } from './wave.ts';
import { xpForQuest } from './progress.ts';
import type { ItemId } from './economy.ts';
import { npcOf, poiOf } from './city/zones.ts';

/**
 * The quest log.
 *
 * Nothing in the world asked you to do anything: you walked into a street, shot a
 * boss, and the market did its thing regardless. Quests are the layer that reads the
 * same events the rest of the game already emits and turns them into instructions,
 * which is why every objective here is a *real* system — a clear, a trade, a linked
 * fight, a purchase, a first sighting — rather than a kill count with a new name.
 *
 * The story chain teaches the loop in the order it actually pays; bounties rotate
 * daily and are generated from what the market is doing right now, so a hot floor
 * points players at the sector where the anomaly is.
 */

export type ObjectiveKind =
  | 'clear'
  | 'stormClear'
  | 'damage'
  | 'chainRun'
  | 'buy'
  | 'sellCard'
  | 'trade'
  | 'link'
  | 'chat'
  | 'visit'
  | 'dungeonRoom'
  | 'dungeonClear'
  | 'sighting'
  | 'witnessSale'
  /** Spoke to a named person. */
  | 'talk'
  /** Stood at a named place. */
  | 'reach'
  /** Went through a kind of door. */
  | 'enter'
  /** Picked up a Mystery Wave. */
  | 'collect'
  /** Cleared the Training Sim. */
  | 'train'
  /** Saved a deck that fields a card the player collected. */
  | 'equip'
  /** Fired a fusion — three cards collapsed into one. */
  | 'fuse'
  /** Stepped out of the way of a boss volley. */
  | 'dodge'
  /** Walked into a Line region. */
  | 'lineTravel'
  /** Won a Line encounter. */
  | 'lineClear';

export interface Objective {
  kind: ObjectiveKind;
  need: number;
  /** Only counts when the event carries this sector / element / tribe. */
  sector?: SectorId;
  element?: Element;
  /** For `talk`, `reach` and `enter`: the NPC id, the place id or the door kind it must name. */
  target?: string;
  /** Shown in the log; generated when absent so a template cannot lie about itself. */
  label?: string;
}

export interface QuestReward {
  wav: number;
  /** Multiplied by the quest's star rating when it is granted. */
  xp?: number;
  items?: Partial<Record<ItemId, number>>;
  cards?: string[];
}

export interface QuestDef {
  id: string;
  name: string;
  /** Who gives it: an NPC id from the city plan, or `QUEST BOARD` for the daily contracts. */
  giver: string;
  /** Who it is handed in to. Defaults to the giver. */
  turnIn?: string;
  /** What the giver says when offering it. */
  text: string;
  /** What they say while it is still open, and when it is done. */
  doing?: string;
  thanks?: string;
  /** Must be turned in before this one appears. */
  after?: string;
  /** Minimum level, so the world's quests are a ladder and not a heap. */
  level?: number;
  stars: 1 | 2 | 3;
  objectives: Objective[];
  reward: QuestReward;
  /** Repeatable bounties expire; the chain does not. */
  bounty?: boolean;
  /** Where in the city it lives, for the log and the map. */
  sector?: SectorId;
  kind?: 'main' | 'side';
}

const O = (kind: ObjectiveKind, need: number, extra: Partial<Objective> = {}): Objective => ({ kind, need, ...extra });
export { O as objective };

/**
 * The main road. Twenty-one beats in seven Acts — a morning in the city, then one Act for each of
 * the six dungeons — and each introduces one system and
 * reuses the earlier ones, so the chain doubles as the tutorial without a single "press W
 * to walk". An Act is a short errand in the city and then the dungeon it was about: you are
 * sent to a person, a place or a door, never to a menu.
 */
export const STORY: QuestDef[] = [
  {
    id: 'm-01',
    name: 'WAGMI (Pending)',
    giver: 'a-board',
    turnIn: 'a-operator',
    kind: 'main',
    sector: 'ashflat',
    text: 'Fresh wallet just minted, huh? Smell that — new paint, zero history, infinite potential to get absolutely rekt.\n\nBefore you ape into anything: the Wave Station on the avenue reads the market, and the Operator keeps the list of everyone who is somebody. Go tell her you exist. Hurry — there is a guy by the gate selling rocks with receipts, and he has already noticed you.',
    doing: 'The Operator is at the Wave Station, north of the crossing. Do not buy the rock.',
    thanks: 'A new signal. Minted, not earned — yet.\n\nStay close to the avenue, the Index has been restless. And before you touch anything with real money in it: the Sim behind me. Testnet. Same chain, fake losses, nobody can screenshot your shame.',
    stars: 1,
    objectives: [O('talk', 1, { target: 'a-operator' })],
    reward: { wav: 40, items: { med: 1 } },
  },
  {
    id: 'm-01b',
    name: 'Testnet Baby',
    giver: 'a-operator',
    turnIn: 'a-operator',
    kind: 'main',
    sector: 'ashflat',
    text: 'Nobody fights the Index cold. That is how you become a cautionary tale with a red portfolio.\n\nThe Station keeps a Training Sim — the same rules as a real anomaly, zero stakes, infinite respawns. Use the terminal at the Station door (E) and choose TRAINING SIM.\n\nThree things to learn: slide off the red rows with W and S, press Space when the charge fills to open the Hand, and remember that only a card that reaches the target counts. Whiffing in public is cringe. Whiffing here is free.',
    doing: 'At the Wave Station door, press E and choose TRAINING SIM. Lose fake money like a pro.',
    thanks: 'You dodged, you built a program, you landed it. On testnet, but still — most people jeet before the tutorial ends.\n\nThe Sim paid you a card for the first clear. A real one. Do not leave it in the bag like an airdrop you forgot to claim.',
    after: 'm-01',
    stars: 1,
    objectives: [O('train', 1)],
    reward: { wav: 60, items: { med: 1 } },
  },
  {
    id: 'm-01c',
    name: 'Not Your Deck, Not Your Coins',
    giver: 'a-operator',
    turnIn: 'a-operator',
    kind: 'main',
    sector: 'ashflat',
    text: 'A fight only ever deals you cards from your Deck — the deck you carry. No deck, no damage, just vibes, and vibes do not clear anomalies.\n\nOpen the menu (Tab), choose DECK, swap one of your cards for the one the Sim paid you, and press SAVE. Your Chog decides how many copies you may run, how many Mega, and which element you can never hold — on-chain risk management for your own bad decisions.',
    doing: 'Menu (Tab) → DECK: put the new card in, then SAVE. Probably nothing.',
    thanks: 'That is a deck with your hand in it. Diamond hands start here.\n\nNow go and see what the market is selling — the Card Shop is west on Market Row. Touch nothing you cannot afford to watch go to zero.',
    after: 'm-01b',
    stars: 1,
    objectives: [O('equip', 1)],
    reward: { wav: 80, items: { pack: 1 } },
  },
  {
    id: 'm-01d',
    name: 'Touch Grass (Allegedly)',
    giver: 'a-board',
    turnIn: 'a-board',
    kind: 'main',
    sector: 'ashflat',
    text: 'The city ends at the Tolls and the Line starts there — six regions of open road where the cards are just standing around, waiting to be collected by anyone with functioning legs.\n\nOpen the menu (Tab), choose MAPS, and take the road to the TOLLS. There is a camp at the trailhead with a scout. Nothing there will bother you until you walk up to it yourself, which is more than I can say for the DMs you are about to get.',
    doing: 'Menu (Tab) → MAPS → travel to the TOLLS. Outside. Yes, really.',
    thanks: 'Out and back. Certified grass-toucher.\n\nThat road is the rest of the game, so listen: walking is visiting. Walk up to one of the rust mites out there — the fight starts by itself — beat it, and come home. Consider it your first on-chain interaction. Gas fees: zero. Glory: pending.',
    after: 'm-01c',
    stars: 1,
    objectives: [O('lineTravel', 1, { target: 'tolls' })],
    reward: { wav: 85 },
  },
  {
    id: 'm-01e',
    name: 'First Blood (On-Chain Forever)',
    giver: 'a-board',
    turnIn: 'a-board',
    kind: 'main',
    sector: 'ashflat',
    text: 'Walk up to a rust mite on the Tolls road — the fight starts by itself — and beat it. A first win pays you a card on the spot and drops the purse on the ground where the body fell, so walk over and take it. Then come home and report.\n\nFair warning: everything here is on-chain. Your first kill will sit there forever, next to your worst trade. Make it a good one.',
    doing: 'On the TOLLS road, walk into a mob and win. The chain is watching.',
    thanks: 'First blood on the Line, and it paid. You are officially exit liquidity with a sword.\n\nThe Dealer will sell you the rest of what you need — the Card Shop is west on Market Row.',
    after: 'm-01d',
    stars: 1,
    objectives: [O('lineClear', 1)],
    reward: { wav: 95 },
  },
  {
    id: 'm-02',
    name: 'Dealer 143 (Probably Not A Rug)',
    giver: 'a-operator',
    turnIn: 'a-dealer',
    kind: 'main',
    sector: 'ashflat',
    text: 'Programs are built from cards, and cards come from Dealer 143 at the Card Shop on Market Row. Walk in, buy one, sell one you do not run.\n\nIs 143 a good number? Unclear. Are his prices real? They follow the actual floor, which is more than can be said for most men advertising in all caps. DYOR. NFA. Just buy the card.',
    doing: 'Dealer 143 keeps the Card Shop on Market Row. Bring money, leave with cardboard.',
    thanks: 'A mover, not a hoarder. The floor respects motion.\n\nRemember: buy when there is blood in the streets — even if the blood is yours. Especially then.',
    after: 'm-01e',
    stars: 1,
    objectives: [O('enter', 1, { target: 'shop' }), O('buy', 1), O('sellCard', 1)],
    reward: { wav: 90, items: { scan: 1 } },
  },
  {
    id: 'm-03',
    name: 'Read the Album',
    giver: 'a-dealer',
    turnIn: 'a-archivist',
    kind: 'main',
    sector: 'ashflat',
    text: 'Every Chog in the collection is a sentence in the Album. The Archivist keeps it in the Terminal, at the far end of the row. Oh — and ask the Noodle Cook what the tape says.',
    doing: 'The Terminal is at the east end of the shop row.',
    thanks: 'You have read your first sentence. Most of the collection is still unread.',
    after: 'm-02',
    stars: 1,
    objectives: [O('talk', 1, { target: 'a-noodle' }), O('enter', 1, { target: 'telemetry' })],
    reward: { wav: 100, items: { pack: 1 } },
  },
  {
    id: 'm-04',
    name: 'Tribe Colours',
    giver: 'a-archivist',
    turnIn: 'a-scribe',
    kind: 'main',
    sector: 'ashflat',
    text: 'Your Chog was born in a colour, and that colour is a tribe with a war to fight. The Scribe at the Tribe Hall keeps the ledger. Go and be counted — and ask the Clockkeeper why his clock stopped.',
    doing: 'The Tribe Hall is on the shop row, past the Wave Station.',
    thanks: 'Counted. The war resets every week — points banked now are points that matter.',
    after: 'm-03',
    stars: 1,
    objectives: [O('talk', 1, { target: 'a-clock' }), O('enter', 1, { target: 'brother' })],
    reward: { wav: 120 },
  },
  // ---------------------------------------------------------------- ACT II · EMBER FOUNDRY
  {
    id: 'm-05',
    name: 'The Fold Gate',
    giver: 'a-scribe',
    turnIn: 'a-watchman',
    kind: 'main',
    sector: 'ashflat',
    level: 2,
    text: 'There is a gate in the Foldgate Yard, at the east end of the main street. It opens into a fold: a piece of the Index folded over on itself, with a map inside and things living in it.\n\nThe Watchman minds it. Tell him you want in, and prove it — walk into the first fold, the Ember Foundry, and clear three rooms.',
    doing: 'At the Fold Gate, open DUNGEONS and enter the EMBER FOUNDRY. Clear three rooms.',
    thanks: 'Three rooms and you came out on your feet. The Foundry is the gentlest fold there is; the rest are not.',
    after: 'm-04',
    stars: 2,
    objectives: [O('enter', 1, { target: 'dungeon' }), O('dungeonRoom', 3)],
    reward: { wav: 190, items: { amp: 1 } },
  },
  {
    id: 'm-05b',
    name: 'Three Into One',
    giver: 'a-scribe',
    turnIn: 'a-scribe',
    kind: 'main',
    sector: 'ashflat',
    level: 3,
    text: 'The Tribe Hall keeps two ledgers. One is the war. The other is recipes.\n\nWhen three cards in a column of your hand glow gold on the Hand, they spell one. Pick all three in line and fire: they collapse into a single stronger card, and it is yours for good. The LIBRARY page remembers every recipe you have fired.',
    doing: 'In a fight, fire the gold-glowing column of three cards from the Hand.',
    thanks: 'Three became one and nothing broke. Recipes you have not fired stay unnamed in the Library — on purpose.',
    after: 'm-05',
    stars: 2,
    objectives: [O('fuse', 1)],
    reward: { wav: 150, items: { pack: 1 } },
  },
  {
    id: 'm-06',
    name: 'The Foundry Warden',
    giver: 'a-watchman',
    turnIn: 'a-watchman',
    kind: 'main',
    sector: 'ashflat',
    level: 2,
    text: 'Rooms are practice. The Warden is the point.\n\nIt stands at the core of the Foundry and has never once let the line stop. Reach the end of the fold and close it. It will test your dodging first and your program second.',
    doing: 'Clear the EMBER FOUNDRY: reach its core and delete the Foundry Warden.',
    thanks: 'Closed. The furnace is quiet for the first time since the wave.\n\nThere is a title waiting for you on the Career page. Something colder is waking under the canal — the Archivist has been asking after you.',
    after: 'm-05b',
    stars: 3,
    objectives: [O('dungeonClear', 1, { target: 'd-ember' })],
    reward: { wav: 200, items: { ward: 1 } },
  },

  // ---------------------------------------------------------------- ACT III · FROST ARCHIVE
  {
    id: 'm-07',
    name: 'Cold Storage',
    giver: 'a-archivist',
    turnIn: 'a-archivist',
    kind: 'main',
    sector: 'ashflat',
    level: 5,
    text: 'The Album is what the city has seen. The Archive is what it has kept: every card nobody sold, filed in cold storage under the canal.\n\nThe Librarian down there is wrong in a way I cannot explain. Before you go, ask the Noodle Cook and old Elder Spark what they remember. The Archive was not always cold.',
    doing: 'Talk to the Noodle Cook on the main street and to Elder Spark on Hillside Row.',
    thanks: 'So it was warm once. Someone shut the door and the wave went cold.\n\nThe Frost Archive is open to you now. Mind the walls — the Librarian raises them.',
    after: 'm-06',
    stars: 2,
    objectives: [O('talk', 1, { target: 'a-noodle' }), O('talk', 1, { target: 'a-elder' })],
    reward: { wav: 220, items: { pack: 1 } },
  },
  {
    id: 'm-08',
    name: 'The Rime Librarian',
    giver: 'a-watchman',
    turnIn: 'a-watchman',
    kind: 'main',
    sector: 'ashflat',
    level: 5,
    text: 'The Frost Archive is the second fold. Its Librarian walls off the files: you cannot hit what you cannot reach, so learn which row is open and fire down that one.\n\nBring me the Librarian, or what is left of it.',
    doing: 'Clear the FROST ARCHIVE: delete the Rime Librarian.',
    thanks: 'Shelved, at last. The Archive is a little warmer.\n\nThe Engineer on the rail yard says the old line has gone quiet. Quiet is never good.',
    after: 'm-07',
    stars: 3,
    objectives: [O('dungeonClear', 1, { target: 'd-frost' })],
    reward: { wav: 320, items: { pack: 1, repair: 1 } },
  },

  // ---------------------------------------------------------------- ACT IV · RELAY SPIRE
  {
    id: 'm-09',
    name: 'Dead Air',
    giver: 'a-engineer',
    turnIn: 'a-engineer',
    kind: 'main',
    sector: 'ashflat',
    level: 8,
    text: 'The last train left before the Index, you know that. What you do not know is that it never arrived. Something is eating the signal on the old line.\n\nStand at The Last Train and listen, then catch three Mystery Waves with the Visualizer (V). I want to know what a signal looks like when it has been eaten.',
    doing: 'Reach THE LAST TRAIN (south, by the rail yard) and catch three Mystery Waves. Press V.',
    thanks: 'Late. All of it late, and none of it lost. It went up, not away.\n\nThere is a spire where the line ends. Its King has been collecting.',
    after: 'm-08',
    stars: 2,
    objectives: [O('reach', 1, { target: 'a-last' }), O('collect', 3)],
    reward: { wav: 260, items: { amp: 1 } },
  },
  {
    id: 'm-10',
    name: 'The Packet King',
    giver: 'a-watchman',
    turnIn: 'a-watchman',
    kind: 'main',
    sector: 'ashflat',
    level: 8,
    text: 'The Relay Spire is where the missing signal went. Its King sweeps whole rows at once, and you cannot dodge a sweep by standing still.\n\nMove early. Move twice. Then answer.',
    doing: 'Clear the RELAY SPIRE: delete the Packet King.',
    thanks: 'The Spire is dark and the line is running again. Hear that? That is a train that was always going to come.',
    after: 'm-09',
    stars: 3,
    objectives: [O('dungeonClear', 1, { target: 'd-volt' })],
    reward: { wav: 420, items: { pack: 1, ward: 1 } },
  },

  // ---------------------------------------------------------------- ACT V · SUNKEN RESERVOIR
  {
    id: 'm-11',
    name: 'Low Water',
    giver: 'a-fisher',
    turnIn: 'a-fisher',
    kind: 'main',
    sector: 'ashflat',
    level: 12,
    text: 'The canal is lower than it should be, and it is not evaporating. It is draining into something.\n\nWalk the Canal Bridge and then the Hidden Spring behind the bandstand, and tell me where the water goes. I would go myself, but I have fish to disappoint.',
    doing: 'Reach the CANAL BRIDGE and the HIDDEN SPRING (behind the bandstand).',
    thanks: 'Down. All of it goes down. There is a reservoir under there, and from the sound of it, something is breathing in it.',
    after: 'm-10',
    stars: 2,
    objectives: [O('reach', 1, { target: 'a-bridge' }), O('reach', 1, { target: 'a-spring' })],
    reward: { wav: 340, items: { med: 2 } },
  },
  {
    id: 'm-12',
    name: 'The Undertow Mother',
    giver: 'a-watchman',
    turnIn: 'a-watchman',
    kind: 'main',
    sector: 'ashflat',
    level: 12,
    text: 'It copies you. Whatever file you stand in, it will stand in a step behind and give it back a moment later.\n\nUse that. A copy only knows where you were.',
    doing: 'Clear the SUNKEN RESERVOIR: delete the Undertow Mother.',
    thanks: 'The water is only water again. Go and wash your hands; you have been somewhere that remembers.',
    after: 'm-11',
    stars: 3,
    objectives: [O('dungeonClear', 1, { target: 'd-wave' })],
    reward: { wav: 560, items: { pack: 2, repair: 1 } },
  },

  // ---------------------------------------------------------------- ACT VI · PRISM VAULT
  {
    id: 'm-13',
    name: 'A Face in the Glass',
    giver: 'a-archivist',
    turnIn: 'a-archivist',
    kind: 'main',
    sector: 'ashflat',
    level: 18,
    text: 'Every Chog ever sighted is kept in the Prism Vault, and its Twin is built from whoever walks in. It will be you.\n\nThe only thing a copy cannot copy is something you have not made yet. Fire two fusions, and give it something new to be wrong about.',
    doing: 'In fights, fire two fusions: the gold-glowing column of three cards on the Hand.',
    thanks: 'Two new cards that did not exist this morning. Good. Take them in with you.',
    after: 'm-12',
    stars: 2,
    objectives: [O('fuse', 2)],
    reward: { wav: 480, items: { pack: 2 } },
  },
  {
    id: 'm-14',
    name: 'The Spectrum Twin',
    giver: 'a-watchman',
    turnIn: 'a-watchman',
    kind: 'main',
    sector: 'ashflat',
    level: 18,
    text: 'The Twin fires before you have finished reading the warning. You do not have time to read it. Learn the sound, learn the light, and move on the sound.\n\nIf you see yourself, do not hesitate. It will not.',
    doing: 'Clear the PRISM VAULT: delete the Spectrum Twin.',
    thanks: 'One of you walked out. I am almost sure it was the right one.',
    after: 'm-13',
    stars: 3,
    objectives: [O('dungeonClear', 1, { target: 'd-prism' })],
    reward: { wav: 760, items: { pack: 2, amp: 1 } },
  },

  // ---------------------------------------------------------------- ACT VII · THE STORM CORE
  {
    id: 'm-15',
    name: 'Heavy Weather',
    giver: 'a-operator',
    turnIn: 'a-operator',
    kind: 'main',
    sector: 'ashflat',
    level: 26,
    text: 'Every trade in the city ends up in the Storm Core, and it has no door. It has a rhythm.\n\nLearn to step out of forty volleys — in the Sim, in a fold, anywhere — and you will know the rhythm well enough to walk in time with it.',
    doing: 'Dodge forty volleys, in any fight.',
    thanks: 'Forty. You are not afraid of the weather. The Core is open, and it is the last fold there is.',
    after: 'm-14',
    stars: 2,
    objectives: [O('dodge', 40)],
    reward: { wav: 600, items: { repair: 2 } },
  },
  {
    id: 'm-16',
    name: 'The Storm Core',
    giver: 'a-watchman',
    turnIn: 'a-watchman',
    kind: 'main',
    sector: 'ashflat',
    level: 26,
    text: 'There is no trick to it. The Core is the deepest map the Index has, and the hardest thing in it is the Index.\n\nGo in with a deck you trust and a program you built yourself. Close it, and the wave answers to you.',
    doing: 'Clear THE STORM CORE: delete the Index.',
    thanks: 'The Index blinked first.\n\nThat is the end of the road, and the start of the work: every fold can be run again, the anomalies keep coming with the market, and the war resets on Monday.',
    after: 'm-15',
    stars: 3,
    objectives: [O('dungeonClear', 1, { target: 'd-void' })],
    reward: { wav: 1200, items: { pack: 3, repair: 2, ward: 1 } },
  },
];

export const QUEST_BY_ID: ReadonlyMap<string, QuestDef> = new Map(STORY.map((q) => [q.id, q]));

// ---------------------------------------------------------------------------
// Acts
// ---------------------------------------------------------------------------

export interface ActDef {
  id: number;
  name: string;
  /** The dungeon this Act ends in, if it has one, and the level it is meant for. */
  dungeon?: string;
  level: number;
  blurb: string;
  quests: string[];
}

/**
 * The main road in seven stretches: a morning in the city, then one Act for each dungeon, each
 * an errand in the city and the fold it was about. A newcomer is never asked to "play the game":
 * they are asked to finish the next step of the current Act, and the Career page says which
 * that is, what it unlocks and how far the stretch has to go.
 */
export const ACTS: readonly ActDef[] = [
  { id: 1, name: 'WAKE UP', level: 1, blurb: 'Learn the Wave: dodge, build a deck, walk the road, make a trade.', quests: ['m-01', 'm-01b', 'm-01c', 'm-01d', 'm-01e', 'm-02', 'm-03', 'm-04'] },
  { id: 2, name: 'EMBER FOUNDRY', dungeon: 'd-ember', level: 2, blurb: 'Your first fold: three rooms, a fusion, and the Warden at the end.', quests: ['m-05', 'm-05b', 'm-06'] },
  { id: 3, name: 'FROST ARCHIVE', dungeon: 'd-frost', level: 5, blurb: 'Cold storage under the canal, and a Librarian who raises walls.', quests: ['m-07', 'm-08'] },
  { id: 4, name: 'RELAY SPIRE', dungeon: 'd-volt', level: 8, blurb: 'The old rail line ends in a tower of packets and a King who sweeps.', quests: ['m-09', 'm-10'] },
  { id: 5, name: 'SUNKEN RESERVOIR', dungeon: 'd-wave', level: 12, blurb: 'The canal is draining into something that copies what you do.', quests: ['m-11', 'm-12'] },
  { id: 6, name: 'PRISM VAULT', dungeon: 'd-prism', level: 18, blurb: 'Every Chog ever sighted, and a Twin built from you.', quests: ['m-13', 'm-14'] },
  { id: 7, name: 'THE STORM CORE', dungeon: 'd-void', level: 26, blurb: 'The centre of the Index, where every trade ends up.', quests: ['m-15', 'm-16'] },
];

export type StepState = 'done' | 'ready' | 'active' | 'next' | 'locked';

export interface JourneyStep {
  id: string;
  name: string;
  state: StepState;
  level: number;
}

export interface JourneyAct {
  act: ActDef;
  steps: JourneyStep[];
  done: number;
  state: 'done' | 'open' | 'locked';
}

/** Every Act, every step and where the player stands in each: done, ready to hand in, under way, offered, or still shut. */
export function journey(mainDone: readonly string[], active: readonly { id: string; done: boolean }[], level: number): JourneyAct[] {
  const done = new Set(mainDone);
  const live = new Map(active.map((a) => [a.id, a]));
  return ACTS.map((act) => {
    const steps = act.quests.map((id): JourneyStep => {
      const def = QUEST_BY_ID.get(id);
      const lv = def?.level ?? 1;
      let state: StepState;
      if (done.has(id)) state = 'done';
      else if (live.get(id)?.done) state = 'ready';
      else if (live.has(id)) state = 'active';
      else if ((!def?.after || done.has(def.after)) && lv <= level) state = 'next';
      else state = 'locked';
      return { id, name: def?.name ?? id, state, level: lv };
    });
    const dn = steps.filter((s) => s.state === 'done').length;
    return { act, steps, done: dn, state: dn === steps.length ? 'done' : steps.some((s) => s.state !== 'locked') ? 'open' : 'locked' };
  });
}

/** The step a newcomer should be doing right now: the first one that is ready, under way or offered. */
export function nextStep(mainDone: readonly string[], active: readonly { id: string; done: boolean }[], level: number): { act: ActDef; step: JourneyStep } | null {
  const acts = journey(mainDone, active, level);
  for (const a of acts) {
    const s = a.steps.find((x) => x.state === 'ready' || x.state === 'active' || x.state === 'next');
    if (s) return { act: a.act, step: s };
  }
  // nothing to do yet: the road is held by a level, so say which step it is waiting on
  const done = new Set(mainDone);
  for (const a of acts) {
    const s = a.steps.find((x) => {
      const after = QUEST_BY_ID.get(x.id)?.after;
      return x.state === 'locked' && (!after || done.has(after));
    });
    if (s) return { act: a.act, step: s };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Log state
// ---------------------------------------------------------------------------

export interface QuestState {
  /** One counter per objective, in definition order. */
  progress: number[];
  done: boolean;
  turnedIn: boolean;
  /** Bounties carry the day they belong to so they can be swept. */
  day?: number;
}

export type QuestLog = Record<string, QuestState>;

export interface QuestEvent {
  type: ObjectiveKind;
  amount?: number;
  sector?: SectorId;
  element?: Element;
  /** The NPC, place or door kind this happened at. */
  target?: string;
}

export function freshState(def: QuestDef, day?: number): QuestState {
  return { progress: def.objectives.map(() => 0), done: false, turnedIn: false, day };
}

/** Acceptable for an event to satisfy several objectives at once (a clear is also damage). */
export function applyEvent(log: QuestLog, def: QuestDef, ev: QuestEvent): { state: QuestState; justDone: boolean } {
  const state = log[def.id] ?? freshState(def);
  let justDone = false;
  def.objectives.forEach((o, i) => {
    if (o.kind !== ev.type) return;
    if (o.sector && ev.sector && o.sector !== ev.sector) return;
    if (o.element && ev.element && o.element !== ev.element) return;
    // A named objective counts only at that name: talking to the wrong person is not progress.
    if (o.target && ev.target !== o.target) return;
    const before = state.progress[i] ?? 0;
    state.progress[i] = Math.min(o.need, before + Math.max(1, ev.amount ?? 1));
    if (!state.done && state.progress.every((p, k) => p >= def.objectives[k]!.need)) {
      state.done = true;
      justDone = true;
    }
  });
  return { state, justDone };
}

/** Which quests the log should currently be tracking. */
export function offeredQuests(log: QuestLog): QuestDef[] {
  return STORY.filter((q) => {
    const st = log[q.id];
    if (st?.turnedIn) return false;
    if (q.after && !log[q.after]?.turnedIn) return false;
    return true;
  });
}

export interface TurnInResult {
  ok: boolean;
  reason?: string;
  log: QuestLog;
  wav?: number;
  xp?: number;
  items?: Partial<Record<ItemId, number>>;
  cards?: string[];
}

export function turnIn(log: QuestLog, questId: string, known?: QuestDef): TurnInResult {
  const def = known ?? QUEST_BY_ID.get(questId);
  const state = log[questId];
  if (!def || !state) return { ok: false, reason: 'nothing to turn in', log };
  if (!state.done) return { ok: false, reason: 'objectives incomplete', log };
  if (state.turnedIn) return { ok: false, reason: 'already reported', log };
  const next: QuestLog = { ...log, [questId]: { ...state, turnedIn: true } };
  return {
    ok: true,
    log: next,
    wav: def.reward.wav,
    xp: xpForQuest(def.stars),
    items: def.reward.items,
    cards: def.reward.cards,
  };
}

const DOOR_NAME: Record<string, string> = {
  shop: 'the Card Shop',
  heal: 'the clinic',
  station: 'the Wave Station',
  brother: 'the Tribe Hall',
  telemetry: 'the Terminal',
  dungeon: 'the Fold Gate',
  home: 'a shop',
};

export function labelFor(o: Objective): string {
  if (o.label) return o.label;
  if (o.kind === 'talk' && o.target) return `talk to ${npcOf(o.target)?.npc.name ?? o.target}`;
  if (o.kind === 'reach' && o.target) return `reach ${poiOf(o.target)?.poi.name ?? o.target}`;
  if (o.kind === 'enter' && o.target) return `go into ${DOOR_NAME[o.target] ?? o.target}`;
  const noun: Record<ObjectiveKind, string> = {
    clear: 'anomalies cleared',
    stormClear: 'storm-tier anomalies cleared',
    damage: 'damage dealt',
    chainRun: 'chain of x or better',
    buy: 'purchases made',
    sellCard: 'cards sold',
    trade: 'trades completed',
    link: 'linked fights',
    chat: 'messages sent',
    visit: 'sectors visited',
    dungeonRoom: 'nodes cleared',
    dungeonClear: 'data areas closed',
    sighting: 'new trait sightings',
    witnessSale: 'priced trades witnessed',
    talk: 'conversations',
    reach: 'places reached',
    enter: 'doors entered',
    collect: 'Mystery Waves caught',
    train: 'Training Sim clears',
    equip: 'decks built with a card you collected',
    fuse: 'fusions fired',
    dodge: 'volleys dodged',
    lineTravel: 'Line regions walked',
    lineClear: 'Line encounters cleared',
  };
  return `${o.need} ${noun[o.kind]}${o.sector ? ` in ${o.sector}` : o.element ? ` (${o.element})` : ''}`;
}

// ---------------------------------------------------------------------------
// Bounties — the repeatable half, generated from the live market
// ---------------------------------------------------------------------------

const BOUNTY_TEMPLATES: { name: (t: BountySeed) => string; build: (t: BountySeed) => Objective[]; stars: 1 | 2 | 3 }[] = [
  {
    name: (t) => `Hot Floor: ${t.sector}`,
    stars: 2,
    build: (t) => [O('clear', 2, { sector: t.sector }), O('damage', t.target)],
  },
  {
    name: (t) => `Sweep the Fold`,
    stars: 2,
    build: (t) => [O('dungeonRoom', 4), O('dungeonClear', 1, { sector: t.sector })],
  },
  {
    name: (t) => `Storm Contract`,
    stars: 3,
    build: (t) => [O('stormClear', 1, { sector: t.sector })],
  },
  {
    name: (t) => `Floothead`,
    stars: 1,
    build: (t) => [O('buy', 2), O('sellCard', 1)],
  },
];

/** The contract board in each district's crossing. */
export const BOARD: Record<SectorId, string> = { ashflat: 'a-board', voltgrid: 'v-board', hollow: 'h-board' };

export interface BountySeed {
  day: number;
  sector: SectorId;
  /** A damage number derived from the day, so it is checkable and never vague. */
  target: number;
}

function dayOf(now: number): number {
  return Math.floor(now / 86_400_000);
}

/** One bounty per sector per day, chosen deterministically from the date. */
export function bountiesFor(now: number, sectors: SectorId[], targetBase = 12_000): QuestDef[] {
  const day = dayOf(now);
  return sectors.map((sector, i) => {
    const t = (day * 7 + i) % BOUNTY_TEMPLATES.length;
    const tpl = BOUNTY_TEMPLATES[t]!;
    const seed: BountySeed = { day, sector, target: targetBase + ((day + i) % 5) * 2_500 };
    return {
      id: `bounty-${day}-${sector}`,
      name: tpl.name(seed),
      giver: BOARD[sector],
      sector,
      text: `Board contract for ${sector}. Expires when the day turns.`,
      stars: tpl.stars,
      objectives: tpl.build(seed),
      reward: { wav: 40 + tpl.stars * 60, xp: 1 },
      bounty: true,
    };
  });
}

export function isBountyStale(state: QuestState, now: number): boolean {
  return state.day !== undefined && state.day !== dayOf(now);
}

/** Sweep expired bounties out of a log so the panel does not fill with dead lines. */
export function sweepBounties(log: QuestLog, now: number): QuestLog {
  const next: QuestLog = {};
  for (const [id, st] of Object.entries(log)) {
    if (isBountyStale(st, now)) continue;
    next[id] = st;
  }
  return next;
}

export function grantBounty(log: QuestLog, def: QuestDef): QuestLog {
  if (log[def.id]) return log;
  return { ...log, [def.id]: freshState(def, dayOf(Date.now())) };
}

export function logLines(log: QuestLog, defs: QuestDef[]): { name: string; lines: string[]; done: boolean }[] {
  return defs
    .filter((d) => log[d.id] && !log[d.id]?.turnedIn)
    .map((d) => ({
      name: d.name,
      done: log[d.id]?.done ?? false,
      lines: d.objectives.map((o, i) => `${(log[d.id]?.progress[i] ?? 0) >= o.need ? 'x' : '-'} ${labelFor(o)}`),
    }));
}
