import type { SectorId } from '../wave.ts';
import type { Element } from '../types.ts';
import type { CardClass, CardKind } from './card.ts';
import type { LockReason, CellView } from './hand.ts';
import type { Panel } from './field.ts';
import type { Rank } from './rank.ts';
import type { DuelStats } from './stats.ts';

/**
 * What a client is told.
 *
 * One rule, and it is the only one that matters: **the client is never asked what happened.**
 * It says what it wants to do (step here, take that card, fire) and it is told what the field
 * decided. A number that floats off the anomaly is a number the server computed, and a card
 * that visibly misses is a card that really did nothing.
 *
 * `place` is where this field *is*, which is the hook the explorable dungeon hangs on: a fight
 * is not a screen, it is a room somebody walked into, and the client needs to know which room
 * to put the player back in when it ends.
 */

export type PlaceKind = 'sector' | 'dungeon' | 'train' | 'pvp';

export interface Place {
  kind: PlaceKind;
  sector: SectorId;
  /** Set when this field is a room in a dungeon rather than the street's anomaly. */
  dungeonId?: string;
  /** The room/tile this field mirrors, so the run knows what died. */
  roomId?: string;
}

export interface BossView {
  name: string;
  archetype: string;
  element: Element;
  hp: number;
  maxHp: number;
  /** Which file and lane it stands on. */
  file: number;
  lane: number;
  /** 1..4, from its health. A dying boss swings sooner. */
  phase: number;
  /** 0..1 — how much of every card it is eating. A BREAK card strips it. */
  guard: number;
  /** A BURN card's leftover: ticks to go and damage a tick. */
  burn: { ticks: number; damage: number } | null;
  /** Milliseconds of FREEZE left on its clock. */
  freezeMs: number;
  /** STUN clock on the body across the field (boss stun in PvE, rival stun in PvP). */
  stunMs: number;
  /** A file it has walled off for the fight. */
  blocked: number | null;
  /** How many files this floor is cut into. */
  cols: number;
  /** How many lanes deep this floor is: five PvE, six PvP. */
  lanes: number;
  node: boolean;
  training: boolean;
  tier: string;
}

export interface PlayerView {
  id: string;
  tokenId: number;
  name: string;
  tribe: Element;
  hp: number;
  maxHp: number;
  file: number;
  lane: number;
  /** Current element chain, and what it is worth. */
  chain: number;
  /** The element the last fired card resolved as — what a CHAIN card inherits. */
  lastElement: Element | null;
  /** In the Hand: nothing lands on you while you are. */
  shielded: boolean;
  down: boolean;
  /** Milliseconds before the run loses this body. 0 while standing. */
  downLeft: number;
  /** The cover hold this player is running for somebody else, 0..1. */
  reviving: { target: string; fraction: number } | null;
  frozen: boolean;
  /**
   * Status ailment clocks, PvP only. `frozen` above is the input lock (menu open or
   * program firing); `chillMs` is the FREEZE ailment slowing the charge.
   */
  stunMs: number;
  chillMs: number;
  burn: { ticks: number; damage: number } | null;
  /** BARRIER charges held: each eats one landed hit. */
  barrier: number;
  /** PvP side: 0 holds the near half, 1 the far. Always 0 outside PvP. */
  side: 0 | 1;
}

export interface YouView extends PlayerView {
  stats: DuelStats;
  /** The Hand: the hand on the table, and whether you are inside it. */
  hand: {
    cells: CellView[];
    /** Dealt is not open: the hand shows from the join, the safe room and the picking wait for the charge. */
    open: boolean;
    lock: Element | null;
    /** How many picks are left, and the biggest class taken. */
    left: number;
    top: CardClass;
    might: number;
    /** Whether your one Giga has been spent this fight. */
    gigaSpent: boolean;
  } | null;
  /** Milliseconds until the charge is full, and the length of a full fill. */
  readyIn: number;
  chargeMs: number;
  /**
   * The dodge's own readout: how much invulnerability is left, and the window a clean escape
   * grants. The client needs both to show the grace as a thing that happened and not as a
   * number that ambushed it — a dodge with no visible reward reads as luck.
   */
  dodge: { iframeMs: number; graceMs: number };
  /** The cover hold you are running, 0..1. */
  revive: { target: string; name: string; fraction: number; ms: number } | null;
  /** The band's link, when one resonated. */
  link: { tag: string | null; mult: number } | null;
  /** Cards paid by counters, waiting for the next screen. */
  bonus: number;
  /** Rank level so far, and the letter it is worth. */
  rank: { level: number; letter: Rank; counters: number; abacks: number };
  /** What this fight would drop at the grade you are currently holding. */
  drop: { rolls: number; rareChance: number };
}

export interface HazardView {
  panels: Panel[];
  files: number[];
  left: number;
  total: number;
  move: string;
  label: string;
  damage: number;
}

export interface DuelView {
  session: string;
  place: Place;
  boss: BossView;
  players: PlayerView[];
  you: YouView | null;
  /** What the anomaly is about to do. This is the counter window. */
  hazard: HazardView | null;
  /** Seconds this fight has run. */
  /** True when both bodies are players and the boss plate is the rival. */
  pvp: boolean;
  elapsed: number;
  party: { bodies: number; owners: number; bands: number };
  /** The Link ward is up: nothing lands until two banded players stand on neighbouring files. */
  warded: boolean;
}
