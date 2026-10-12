import type { ChogBuild, Element, Placement, SaveView } from './types.ts';
import type { ItemId, ShopLine } from './economy.ts';
import type { FolderLicence, Unlocks } from './progress.ts';
import type { DuelView as SfView, Place } from './sf/view.ts';
import type {
  FieldEvent as SfEvent,
  LockReason as SfLockReason,
  Rank,
  ReviveReason,
  StepDir,
} from './sf/index.ts';
import type { QuestReward } from './quest.ts';
import type { SectorId, SectorState } from './wave.ts';

export interface RemotePlayer {
  id: string;
  tokenId: number;
  sector: SectorId;
  x: number;
  y: number;
  vx: number;
  facing: 1 | -1;
  /** Which way the Chog faces on the plane, in radians; `facing` is the legacy left/right flag. */
  heading?: number;
  anim: string;
  hp: number;
  /** Who it is and how far along, so the street can label it and a party can be offered. */
  name?: string;
  level?: number;
  tribe?: string;
}

/** One priced trade, as the street billboard shows it. */
export interface MarketTick {
  tokenId: number;
  mon: number;
  ts: number;
  /** First 6 and last 4 characters of the tx, so it is checkable but not noise. */
  tx: string;
}

/** A priced market event that opened something the player can fight. */
export interface AnomalyNotice {
  sector: SectorId;
  /** e.g. `BARON #842 — 15,000 MON` */
  label: string;
  ts: number;
  /** The transaction the ticker links to. Empty for ambient spawns. */
  cause: string;
}

export interface WorldSnapshot {
  sectors: SectorState[];
  players: RemotePlayer[];
  feed: { mode: 'chain' | 'synthetic'; describe: string; seen?: Record<string, number> };
  /** Which instance the recipient is in, when the snapshot is per-room. */
  room?: string;
  /** Most recent market-driven anomalies, newest last. */
  anomalies?: AnomalyNotice[];
  /** Who is connected and what they are doing. */
  roster?: { id: string; tokenId: number; name: string; sector: string; room: string; level: number; tribe: string; doing: string; kills: number }[];
  /** Weekly standings by element, counted from the players currently online. */
  tribes?: { tribe: string; score: number; members: number }[];
  /** Recent chat, so a rejoin does not land in silence. */
  chat?: { name: string; channel: string; text: string; ts: number }[];
  /** Recent priced trades, newest last. Drives the street billboard. */
  market?: MarketTick[];
  ts: number;
}

export interface Welcome {
  you: {
    id: string;
    tokenId: number;
    sector: SectorId;
    build: ChogBuild;
    save: SaveView;
    /** Whether the traits came from the collection's metadata or were predicted. */
    traitsSource: 'real' | 'predicted';
    /** The raw trait values, so the client can mount this token's 3D model. */
    attributes: Record<string, string>;
    level: number;
  };
  world: WorldSnapshot;
}

/**
 * The multiplayer envelope. Everything here is what makes this an MMO rather than
 * a shooter with a leaderboard: presence you can read, a party you can form, chat
 * that survives a room change, and a trade that cannot duplicate a card.
 */
export interface ChatMsg {
  t: 'chat';
  /** `global` is the whole city, `party` your party, `whisper` one person (named in `to`). */
  channel: 'global' | 'sector' | 'local' | 'party' | 'whisper';
  text: string;
  to?: string;
}

export interface ChatLine {
  t: 'chat';
  id: string;
  name: string;
  channel: string;
  text: string;
  ts: number;
  tribe?: string;
  /** For a whisper: who it was said to. */
  to?: string;
}

/** What a player can do about their party. `link` (the old name for an invite) still works. */
export interface PartyAction {
  t: 'party';
  action: 'invite' | 'accept' | 'decline' | 'leave' | 'kick';
  with?: string;
}

/** Voice: the server only passes these between members of one party and never reads them. */
export interface RtcMsg {
  t: 'rtc';
  to: string;
  kind: 'hello' | 'offer' | 'answer' | 'ice' | 'bye';
  data?: unknown;
}

export interface LinkMsg {
  t: 'link';
  with: string;
}

export interface PartyMsg {
  t: 'party';
  /** Leader first. */
  members: { id: string; name: string; tribe: string; sector: string; level: number; hp: number }[];
  leader?: string;
  /** Someone has asked this player to join theirs. */
  invite?: { from: string; name: string };
  /** A line for the player: it was sent, declined, expired, refused. */
  notice?: string;
  refused?: string;
  /** True while the Link shield is still up, i.e. nobody is standing adjacent. */
  warded: boolean;
}

export interface TradeMsg {
  t: 'trade';
  action: 'offer' | 'accept' | 'cancel';
  with?: string;
  giving?: string[];
  wanting?: string[];
  tradeId?: string;
}

export interface TradeNotice {
  t: 'trade';
  action: 'incoming' | 'accepted' | 'cancelled' | 'refused';
  tradeId: string;
  from: string;
  to: string;
  giving: string[];
  wanting: string[];
  reason?: string;
}

export interface BattleMsg {
  t: 'battle';
  action: 'enter' | 'leave' | 'move';
  col?: number;
}

// ---------------------------------------------------------------------------
// The duel. One conversation: the client says what it wants to do — step onto a panel, take that
// card, hold the Buster — and the server answers with the whole field: the anomaly, the warning
// painted on the floor, everyone's integrity, on a short clock.
//
// The client never tells the server what happened. A number that floats off the boss is a number
// the server computed, and a card that visibly misses is a card that really did nothing. The view
// types live in `sf/view.ts` and are shared, so the screen cannot draw a rule the server is not
// also enforcing.
// ---------------------------------------------------------------------------

export type DuelAction =
  /** On and off the field. */
  | 'enter'
  | 'leave'
  /** One panel, on either axis. */
  | 'step'
  /** The Custom Screen. */
  | 'pick'
  | 'undo'
  | 'clear'
  | 'execute'
  /** The Mega Buster. Press is `down: true`; it fires on release. */
  | 'buster'
  /** Start or let go of a cover hold on a downed ally. */
  | 'cover';

export interface DuelMsg {
  t: 'duel';
  action: DuelAction;
  /** `enter`: the street's anomaly (default), the Training Sim, or a room inside a dungeon. */
  mode?: 'anomaly' | 'train' | 'room';
  /** `enter` on a room: which dungeon, and which room in it. */
  dungeonId?: string;
  roomId?: string;
  /** `step`: which way. */
  dir?: StepDir;
  /** `pick`: the cell in the 3x2 screen. */
  cell?: number;
  /** `buster`: true on press, false on release. */
  down?: boolean;
  /** `cover`: the downed ally to hold. Null lets go. */
  with?: string | null;
}

/** Sent when you step on. Everything after this is a tick. */
export interface DuelStartMsg {
  t: 'duel';
  kind: 'start';
  view: SfView;
  place: Place;
  /** What this Chog's Custom Screen is capped at, so the screen can say why a card is grey. */
  caps: { slots: number; mega: number; giga: number };
  /**
   * The words this anomaly knows, in the order it will reach for them.
   *
   * Sent on entry so the field manual can list them before you eat one: a warning you can read
   * in 400 ms is only fair if you have already seen the word.
   */
  moves: { id: string; name: string; read: string }[];
}

export interface DuelTickMsg {
  t: 'duel';
  kind: 'tick';
  view: SfView;
  events: SfEvent[];
}

export interface DuelPickMsg {
  t: 'duel';
  kind: 'pick';
  ok: boolean;
  /** Why the screen refused it. The client already greys the card out; this is the server's say. */
  reason?: SfLockReason;
}

export interface DuelProgramMsg {
  t: 'duel';
  kind: 'program';
  ok: boolean;
  /** What went out, in firing order, and what each card was worth at the moment it was sent. */
  cards?: { chipId: string; element: Element; files: number[]; damage: number; counter: boolean }[];
}

export interface DuelBusterMsg {
  t: 'duel';
  kind: 'buster';
  ok: boolean;
  damage?: number;
  charged?: boolean;
}

export interface DuelCoverMsg {
  t: 'duel';
  kind: 'cover';
  ok: boolean;
  reason?: ReviveReason;
  /** Who the server put the rescuer's hands on, so the client never has to guess. */
  target?: string;
}

export interface DuelEndMsg {
  t: 'duel';
  kind: 'end';
  won: boolean;
  reason: 'cleared' | 'wiped' | 'left' | 'gone';
  name: string;
  seconds: number;
  /**
   * The grade. This is what the drop is priced on, and it is why the same boss is worth killing
   * twice: a clean fast run and a scrappy one are different loot.
   */
  busting: { level: number; rank: Rank; counters: number; abacks: number; read: string };
  drop: { rolls: number; rareChance: number };
  /** Wave this fight bled off the district. Negative when the body ran void cards. */
  wave: number;
  chips: string[];
  items: string[];
  /** How long before this fight lets a downed body back on. */
  lockoutMs: number;
  quests: string[];
  /** Economy receipts are server-issued; grades do not replace persistent progression. */
  tier?: string;
  xp?: number;
  wav?: number;
  refunded?: { name: string; wav: number }[];
  level?: { from: number; to: number; unlocks: string[] } | null;
  first?: boolean;
}

export interface FieldMsg {
  t: 'field';
  session: string;
  sector: SectorId;
  events: { type: string; chipId?: string; damage?: number; col?: number; chain?: number }[];
  bossHp: number;
  players: { id: string; hp: number; chain: number; col: number }[];
  bossCol: number;
  bossRow: number;
  phase: number;
}

/** Sent by the client; the server re-scores the grid and owns the damage. */
export interface FireMsg {
  t: 'fire';
  sector: SectorId;
  placements: Placement[];
}

export interface HitMsg {
  t: 'hit';
  damage?: number;
  multiplier?: number;
  /** Laser-eyes meter after this shot, so the HUD cannot be lied to. */
  charge?: number;
  laser?: boolean;
}

/**
 * The progression view: everything the bottom screen renders about one token.
 *
 * It lives here rather than in the server because it is a wire contract — the client
 * cannot import from `@chog/server`, and duplicating the shape is how a UI ends up
 * reading a field the server stopped sending.
 */
export interface ProfileStats {
  clears: number;
  stormClears: number;
  rooms: number;
  areas: number;
  purchases: number;
  sells: number;
  trades: number;
  links: number;
  lasers: number;
  chats: number;
  sightings: number;
  deaths: number;
  bestProgram: number;
  bestChain: number;
  /** Fusions fired (counting repeats), Training Sim clears, waves caught and volleys dodged. */
  fusions: number;
  trains: number;
  waves: number;
  dodges: number;
}

/** One entry in the Library: what the player is allowed to know about a fusion. */
export interface LibraryRecipe {
  id: string;
  known: boolean;
  /** Always shown: how a player is meant to find it without a guide. */
  hint: string;
  /** Only once fired. */
  name?: string;
  needs?: string[];
  result?: string;
}

export interface DungeonView {
  id: string;
  state: 'locked' | 'open' | 'cleared';
  reason: string | null;
}

export interface FolderView {
  /** What the next fight deals from, with its repeats. */
  cards: string[];
  rules: {
    size: number;
    copies: number;
    megaCap: number;
    gigaCap: number;
    fusedCap: number;
    banned: Element;
    signature: string;
    /** How much of each cap above came from a level licence rather than the Chog's own shape. */
    licence: FolderLicence;
  };
  /** Every card this Chog may put in a folder: born, owned, fused. */
  pool: string[];
  check: { ok: boolean; errors: string[]; mega: number; giga: number; fused: number };
  /** Whether this is the folder the token was born with, untouched. */
  born: boolean;
}

export interface QuestLineView {
  label: string;
  have: number;
  need: number;
}

export interface QuestView {
  id: string;
  name: string;
  /** Display names; the ids are what the map and the markers key on. */
  giver: string;
  giverId: string;
  turnIn: string;
  turnInId: string;
  text: string;
  /** What to do next, in a sentence. */
  doing: string;
  stars: number;
  bounty: boolean;
  main: boolean;
  level: number;
  sector: string;
  done: boolean;
  turnedIn: boolean;
  lines: QuestLineView[];
  reward: QuestReward;
  /** Where each open objective points: a person, a place or a kind of door. */
  track: { kind: 'npc' | 'poi' | 'door'; id: string }[];
}

/** What the person over a head is offering: a gold !, a green ?, a grey …. */
export type QuestMark = 'offer' | 'turnin' | 'progress';

/** The reply to talking to someone, which is also what the dialogue box renders. */
export interface TalkView {
  npc: { id: string; name: string; role: string; tribe: string };
  pages: string[];
  options: { id: string; label: string; primary?: boolean }[];
  rewards?: string[];
}

export interface AlbumView {
  pct: number;
  have: number;
  need: number;
  rank: string;
  categories: { category: string; have: number; need: number; pct: number }[];
}

export interface RunView {
  area: string;
  at: string;
  cleared: number;
  hp: number;
  maxHp: number;
  wav: number;
  xp: number;
  done: boolean;
  failed: boolean;
}

export interface ShopView {
  factor: number;
  chips: ShopLine[];
  supply: ShopLine[];
  refreshesIn: string;
  wav: number;
}

export interface ProfileView {
  tokenId: number;
  xp: number;
  level: number;
  into: number;
  need: number;
  pct: number;
  toCap: number;
  unlocks: Unlocks;
  wav: number;
  items: Partial<Record<ItemId, number>>;
  chips: string[];
  bagCap: number;
  amp: boolean;
  ward: boolean;
  scanned: boolean;
  stats: ProfileStats;
  quests: QuestView[];
  album: AlbumView;
  run: RunView | null;
  shops: ShopView;
  sellPrices: Record<string, number>;
  categoryPrizes: Record<string, string | null>;
  rarest: { key: string; weight: number } | null;
  signatureIds: string[];
  /** The marker over each person's head, from this player's own log. */
  marks: Record<string, QuestMark>;
  /** Places this token has found, and Mystery Waves it has caught today. */
  discovered: string[];
  caught: string[];
  /** Quests finished, out of quests in the book. */
  questsDone: number;
  questsTotal: number;
  /** The main-road quests this player has handed in: where they stand in the Acts. */
  mainDone: string[];
  /** Every dungeon, and whether this player may go in: locked (and why), open, or cleared. */
  dungeons: DungeonView[];
  /** The guide's one-off marks (the welcome was shown, a tip was read). */
  flags: string[];
  /** The deck the next fight deals from, and the rules that shaped it. */
  folder: FolderView;
  /** The fusion Library. Unfired recipes stay unnamed on purpose. */
  library: { discovered: number; total: number; recipes: LibraryRecipe[] };
}

/** A node in the Data Area map, as the client draws it. */
export interface AreaNodeView {
  id: string;
  kind: string;
  row: number;
  col: number;
  links: string[];
  label: string;
  cleared: boolean;
  here: boolean;
  enemy?: { name: string; hp: number; element: string; archetype: string };
}

export interface AreaView {
  name: string;
  tier: number;
  rows: number;
  at: string;
  hp: number;
  maxHp: number;
  wav: number;
  xp: number;
  done: boolean;
  failed: boolean;
  nodes: AreaNodeView[][];
  tierUnlocked: number;
  level: number;
}
