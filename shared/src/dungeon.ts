import type { Element } from './types.ts';
import type { SectorId } from './wave.ts';
import { CARDS } from './cards.ts';
import { DUNGEONS, type BossArchetype, type DungeonDef } from './dungeonData.ts';
import { nodeBudget, refLevel, type FightKind } from './loop.ts';
import { xpForRoom, xpForRun } from './progress.ts';
import { wavForRoom, wavForChest } from './economy.ts';
import { rollBand, type MobBand } from './sf/mobs.ts';

/**
 * Data Areas — the instanced, replayable half of the game.
 *
 * A Data Area is a folded sector: a small generated node map you walk with your own
 * run state, taking a path, spending field integrity, and choosing between a chest
 * and an elite. It exists because an MMO without repeatable content has no reason to
 * come back, and because it gives the battle field something to bite on other than
 * the sector boss, which respawns on a timer nobody controls.
 *
 * The nodes reuse the existing battle machinery: the node you are standing on *is*
 * the enemy the room's session mirrors. No second combat model, so no second set of
 * bugs.
 */

export type NodeKind = 'gate' | 'wave' | 'elite' | 'chest' | 'shrine' | 'boss';

export interface EnemySet {
  name: string;
  element: Element;
  hp: number;
  /** What it hits back with, fed to the session's phase budget. */
  power: number;
  archetype: BossArchetype;
  /** The mob band standing in this node: a lead + 0-2 minions. */
  band?: { lead: string; minions: string[] };
}

export interface AreaNode {
  id: string;
  kind: NodeKind;
  /** Depth from the entry, and the lane inside that depth. */
  row: number;
  col: number;
  /** Node ids one step forward. */
  links: string[];
  enemy?: EnemySet;
  /** Pre-rolled pay: chests and elites always carry, bosses too, waves about half the time. */
  cards?: string[];
  label: string;
}

export interface DataArea {
  id: string;
  name: string;
  tier: number;
  seed: number;
  sector: SectorId;
  nodes: AreaNode[];
  rows: number;
  bossId: string;
  entryId: string;
  /** Set when this map is one of the named dungeons (see `dungeonData.ts`). */
  dungeonId?: string;
  /**
   * The level this map is cut for: a dungeon's own gate, or the tier's reference Chog for a
   * generated fold. Kept on the map because a session needs it — the gap between it and the level
   * of whoever walks in is what decides how much of a volley's warning they get to read.
   */
  level?: number;
}

export interface AreaRun {
  areaId: string;
  tier: number;
  /** Where the player is standing inside the map. */
  at: string;
  cleared: string[];
  hp: number;
  maxHp: number;
  wav: number;
  xp: number;
  cards: string[];
  buffs: { damage: number; guard: number };
  done: boolean;
  enteredAt: number;
  /** A run dies when the field does; this is the honest record of that. */
  failed: boolean;
  /**
   * The node underfoot that a battle field has confirmed dead, or null. Killing is *issued* by the
   * server, never requested: clearing a node requires an arm for the tile you are standing on, so a
   * client cannot walk up to a monster and claim its loot. Stepping anywhere else drops it.
   */
  armed: string | null;
  /**
   * The 1-of-3 the last combat node dealt, waiting for the pick. Walking on is allowed — the
   * choice stays on the table until taken, and a newer combat node re-deals over it.
   */
  draft: { nodeId: string; options: string[] } | null;
  /**
   * The shrine rest waiting to thin the deck, or null. Stepping on is allowed — the
   * choice stays on the table until taken, and a newer shrine re-rests over it.
   */
  shrine: { nodeId: string } | null;
}

const ELEMENTS: Element[] = ['burn', 'frost', 'volt', 'wave', 'prism', 'void'];
const ARCHETYPES: BossArchetype[] = ['spark', 'baron', 'front', 'mirror', 'surge'];

const NAMES = ['DELTA', 'SIGMA', 'OMEGA', 'KAPPA', 'THETA', 'LAMBDA', 'ECHO'];
const PREFIX = ['FOLD', 'PACKET', 'CACHE', 'SEGMENT', 'VECTOR', 'RESIDUE'];

/** Deterministic mixer, the same shape as the shop's so both are reproducible. */
function rnd(seed: number): () => number {
  let x = (seed ^ 0x85ebca6b) >>> 0;
  return () => {
    x = Math.imul(x ^ (x >>> 15), 0x2545ff43) >>> 0;
    x = Math.imul(x ^ (x >>> 7), 0x27d4eb2f) >>> 0;
    x ^= x >>> 16;
    return (x >>> 0) / 4294967295;
  };
}

/** The deepest band of dungeon a player of this level has opened, ignoring the order they are cleared in. */
export function areaTierUnlocked(level: number): number {
  return DUNGEONS.reduce((t, x) => (level >= x.level ? Math.max(t, x.tier) : t), 0);
}

export const dungeonFlag = (id: string): string => `dungeon:${id}`;

export type DungeonState = 'locked' | 'open' | 'cleared';

/**
 * Whether a player of this level, with these dungeons already cleared, may go into one. The rule
 * is the whole shape of the career: a level to reach and the dungeon before it to beat.
 */
export function dungeonStatus(def: DungeonDef, level: number, cleared: ReadonlySet<string>): { state: DungeonState; reason: string | null } {
  if (cleared.has(def.id)) return { state: 'cleared', reason: null };
  if (level < def.level) return { state: 'locked', reason: `opens at LV ${def.level}` };
  const before = DUNGEONS.find((x) => x.n === def.n - 1);
  if (before && !cleared.has(before.id)) return { state: 'locked', reason: `clear ${before.name} first` };
  return { state: 'open', reason: null };
}

export interface AreaOpts {
  rows?: number;
  name?: string;
  /** The element the rooms lean toward. */
  element?: Element;
  boss?: { name: string; archetype: BossArchetype; element?: Element };
  dungeonId?: string;
  /**
   * The level the map is cut for — a dungeon's own gate. It decides both the health pool and the
   * bite, because it is whose damage per second the fight is measured against and how much field
   * integrity that player has. Empty for a generated sector fold, which then sizes itself to
   * whoever the tier's audience is at their reference level.
   */
  level?: number;
}

/** A named dungeon: the same generator, with the dungeon's depth, element, name and boss laid over it. */
export function makeDungeon(def: DungeonDef, seed: number): DataArea {
  return makeArea(seed, def.tier, 'ashflat', {
    rows: def.rows,
    name: def.name,
    element: def.element,
    boss: { ...def.boss, element: def.element },
    dungeonId: def.id,
    level: def.level,
  });
}

/**
 * Generate a map. Depth grows with tier, lane count is fixed at three so the file
 * grid and the node map share a spatial language.
 */
export function makeArea(seed: number, tier: number, sector: SectorId, opts: AreaOpts = {}): DataArea {
  const r = rnd(seed);
  const rows = opts.rows ?? 3 + Math.min(3, tier);
  const generated = `${PREFIX[Math.floor(r() * PREFIX.length) % PREFIX.length]} ${NAMES[Math.floor(r() * NAMES.length) % NAMES.length]}-${100 + (seed % 900)}`;
  const name = opts.name ?? generated;
  const nodes: AreaNode[] = [];
  const lanes = 3;

  for (let row = 0; row < rows; row++) {
    // The first and last rows are single-wide: an entry and a boss. Middle rows vary.
    const count = row === 0 || row === rows - 1 ? 1 : 1 + Math.floor(r() * lanes);
    for (let col = 0; col < count; col++) {
      const last = row === rows - 1;
      // The mouth of the fold is never a fight: a run must always have somewhere to stand.
      const kind: NodeKind = last
        ? 'boss'
        : row === 0
          ? 'gate'
          : r() < 0.16 + tier * 0.03
            ? 'chest'
            : r() < 0.14
              ? 'shrine'
              : r() < 0.24 + tier * 0.05
                ? 'elite'
                : 'wave';
      nodes.push({
        id: `${row}-${col}`,
        kind,
        row,
        col,
        links: [],
        label: label(kind, row, last),
        ...(needsEnemy(kind) ? { enemy: enemyFor(kind, tier, row, rows, r, opts) } : {}),
        // A boss pays in cards too: it is the reason to have come.
        //
        // The wave used to pay XP and WAV straight into the void with nothing on the ground —
        // `cards` was only ever set for chests, elites and bosses, so the ordinary mob you fight
        // most handed `spawnDrops` an empty list and the street stayed empty no matter how many
        // you killed. Every mob now earns a pile, about half the time.
        ...(kind === 'chest' || kind === 'elite' ? { cards: cardRoll(kind, tier, r) }
          : kind === 'boss' && opts.dungeonId ? { cards: cardRoll('elite', tier + 1, r) }
          : kind === 'wave' ? { cards: r() < WAVE_DROP_CHANCE ? cardRoll('wave', tier, r) : [] }
          : {}),
      });
    }
  }

  linkRows(nodes, rows);
  const entry = nodes.find((n) => n.row === 0)!;
  const boss = nodes.find((n) => n.kind === 'boss') ?? nodes[nodes.length - 1]!;
  return {
    id: opts.dungeonId ? `${opts.dungeonId}-${seed}` : `${sector}-${seed}-t${tier}`,
    name,
    tier,
    seed,
    sector,
    nodes,
    rows,
    bossId: boss.id,
    entryId: entry.id,
    level: opts.level ?? refLevel(tier),
    ...(opts.dungeonId ? { dungeonId: opts.dungeonId } : {}),
  };
}

function label(kind: NodeKind, row: number, last: boolean): string {
  if (last) return 'CORE';
  if (kind === 'gate') return 'FOLD MOUTH';
  if (kind === 'chest') return 'CACHE';
  if (kind === 'shrine') return 'RELAY';
  if (kind === 'elite') return `ELITE R${row}`;
  return `NODE R${row}`;
}

function needsEnemy(kind: NodeKind): boolean {
  return kind === 'wave' || kind === 'elite' || kind === 'boss';
}

/**
 * What stands in a node is not a band of HP multiplied by a guess. It is the tier's measured
 * budget, from `loop.ts`: the audience band's real damage per second times the seconds we want them
 * spending on this row, and the bite that spends exactly this fight's share of the field integrity
 * over exactly that long.
 *
 * Both halves come from the same call, which is the whole point. HP used to be a table that a card
 * pool had to be guessed against — and it drifted into a 540,000 HP wall once, then into the 13-67%
 * of a sized node it still is today. Now when the cards change, the maps move with them. And because
 * the bite is *solved* from a cost rather than looked up, raising a node's health cannot make a fold
 * unwinnable: the fight just gets longer, and the field drains at the rate the tier promised.
 *
 * `opts.level` is a dungeon's gate, so EMBER FOUNDRY is sized against a level-2 Chog and THE STORM
 * CORE against a level-26 one. Without it a generated fold sizes itself to its tier's reference.
 */
function enemyFor(kind: NodeKind, tier: number, row: number, rows: number, r: () => number, opts: AreaOpts = {}): EnemySet {
  const fight: FightKind = kind === 'boss' ? 'boss' : kind === 'elite' ? 'elite' : 'node';
  const wild = ELEMENTS[Math.floor(r() * ELEMENTS.length)] ?? 'volt';
  // a dungeon is made of one element: most of what lives in it leans that way
  const lean = opts.element && r() < 0.7 ? opts.element : wild;
  const spawnName = `WAVE ENTITY ${100 + Math.floor(r() * 899)}`;
  const spawnArch = ARCHETYPES[Math.floor(r() * ARCHETYPES.length)] ?? 'spark';
  const archetype = kind === 'boss' && opts.boss ? opts.boss.archetype : spawnArch;

  // Roll a named mob band if this is a dungeon; folds keep the generic names.
  let band: { lead: string; minions: string[] } | undefined;
  if (opts.dungeonId) {
    const bandSeed = Math.floor(r() * 1e9);
    const mobBand = rollBand(opts.dungeonId, kind, tier, bandSeed);
    band = {
      lead: mobBand.lead.name,
      minions: mobBand.minions.map((m) => m.name),
    };
  }

  const budget = nodeBudget(tier, { kind: fight, archetype, ...(opts.level ? { level: opts.level } : {}) });
  // Deeper trash is worth up to a fifth more, because a walk should not feel flat. Elites and cores
  // already carry their own multiple in the budget, so they take no tilt — and the jitter is ±4%
  // where it used to be ±25%, which was wider than the fun window the fight has to land inside.
  const depth = fight === 'node' ? 0.9 + (rows > 1 ? (row / (rows - 1)) * 0.2 : 0.1) : 1;
  const hp = Math.round(budget.hp * depth * (0.96 + r() * 0.08));
  if (kind === 'boss' && opts.boss) {
    return { name: opts.boss.name, element: opts.boss.element ?? lean, hp, power: budget.power, archetype, band };
  }
  return {
    name: kind === 'boss' ? `AREA GUARDIAN ${100 + Math.floor(r() * 899)}` : (band?.lead ?? spawnName),
    element: lean,
    hp,
    power: budget.power,
    archetype,
    band,
  };
}

/** Two or three real cards off the shelf. Kept short so a run does not become a pile. Signatures
 * never roll here: they are earned — a fixed Line encounter, or the first clear — never luck. */
const COMMONS = CARDS.filter((c) => !c.klass && !c.signature).map((c) => c.id);
const MIDS = CARDS.filter((c) => c.klass === 'M' && !c.signature).map((c) => c.id);
const HIGHS = CARDS.filter((c) => c.klass === 'G' && !c.signature).map((c) => c.id);

function fromPool(pool: string[], r: () => number): string {
  return pool[Math.floor(r() * pool.length) % pool.length] ?? pool[0]!;
}

/**
 * How often an ordinary wave node's drop actually turns into a card.
 *
 * Half, not always: a wave is the node you walk through ten of, and a card every time is a bag
 * faucet. The overflow is not free either — the duplicate path buys a card you already hold back
 * at the sell price, which is worth less to the player than having dropped less in the first place.
 * The other half of the time the kill pays XP and WAV as it always did.
 */
const WAVE_DROP_CHANCE = 0.5;

function cardRoll(kind: NodeKind, tier: number, r: () => number): string[] {
  const n = kind === 'chest' ? 2 : 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const q = r();
    // A wave leans hard on the common pool. One in twenty reaches a MEGA, and only a deep fold
    // reaches a GIGA: a mob you out-level immediately should still be worth walking over, not be
    // handing out the deck's ceiling.
    const top = kind === 'wave'
      ? (tier >= 3 ? 0.05 : tier >= 2 ? 0.03 : 0.015)
      : tier >= 3 ? 0.2 : tier >= 2 ? 0.1 : 0.04;
    const mid = top + (kind === 'wave' ? 0.15 : tier >= 2 ? 0.45 : 0.3);
    out.push(fromPool(q < top ? HIGHS : q < mid ? MIDS : COMMONS, r));
  }
  if (kind === 'elite' && tier >= 3) out.push(fromPool(MIDS, r));
  return out;
}

/**
 * The 1-of-3 a combat node deals: the moment you play the next fight for. Waves deal commons,
 * elites deal mids, the boss deals a high with two mids beside it — always three distinct
 * cards, never a signature (those are earned, not rolled), never fewer than the shelf holds.
 */
export function draftRoll(kind: 'wave' | 'elite' | 'boss', tier: number, r: () => number): string[] {
  const shelves = kind === 'wave'
    ? [COMMONS, COMMONS, COMMONS]
    : kind === 'elite'
      ? [MIDS, MIDS, COMMONS]
      : [HIGHS, MIDS, MIDS];
  const out: string[] = [];
  for (const shelf of shelves) {
    const pool = shelf.length ? shelf : COMMONS;
    if (!pool.length) continue;
    for (let guard = 0; guard < 20; guard++) {
      const id = pool[Math.floor(r() * pool.length) % pool.length]!;
      if (!out.includes(id)) { out.push(id); break; }
    }
  }
  return out;
}

/** Each node reaches one or two nodes in the next row, always forward-ish. */
function linkRows(nodes: AreaNode[], rows: number): void {
  for (let row = 0; row < rows - 1; row++) {
    const from = nodes.filter((n) => n.row === row);
    const to = nodes.filter((n) => n.row === row + 1);
    if (!to.length) continue;
    for (const n of from) {
      const anchor = Math.min(to.length - 1, n.col);
      const links = [to[anchor]!.id];
      const alt = to[anchor + 1] ?? to[anchor - 1] ?? to[anchor];
      if (alt && alt.id !== links[0] && (n.row + n.col) % 2 === 0) links.push(alt.id);
      n.links = links;
    }
    // Nobody may be unreachable: orphan nodes in the next row borrow a link.
    const reached = new Set(from.flatMap((n) => n.links));
    for (const t of to) {
      if (reached.has(t.id)) continue;
      const nearest = from.reduce((best, n) => (Math.abs(n.col - t.col) < Math.abs(best.col - t.col) ? n : best), from[0]!);
      if (nearest) nearest.links.push(t.id);
      reached.add(t.id);
    }
  }
}

export function nodeById(area: DataArea, id: string): AreaNode | undefined {
  return area.nodes.find((n) => n.id === id);
}

export function startRun(area: DataArea, maxHp: number, now = Date.now()): AreaRun {
  return {
    areaId: area.id,
    tier: area.tier,
    at: area.entryId,
    cleared: [],
    hp: maxHp,
    maxHp,
    wav: 0,
    xp: 0,
    cards: [],
    buffs: { damage: 0, guard: 0 },
    done: false,
    enteredAt: now,
    failed: false,
    armed: null,
    draft: null,
    shrine: null,
  };
}

/** You may only step onto a node linked from where you stand, and never twice. */
export function canEnter(run: AreaRun, area: DataArea, nodeId: string): { ok: boolean; reason?: string } {
  if (run.done) return { ok: false, reason: 'run is closed' };
  const here = nodeById(area, run.at);
  if (!here) return { ok: false, reason: 'stranded' };
  if (!here.links.includes(nodeId)) return { ok: false, reason: 'not connected' };
  if (run.cleared.includes(nodeId)) return { ok: false, reason: 'already cleared' };
  return { ok: true };
}

export type NodeOutcome =
  | { kind: 'wave' | 'elite' | 'boss'; xp: number; wav: number; cards: string[]; draft: string[]; damagePct: number }
  | { kind: 'chest'; xp: number; wav: number; cards: string[] }
  | { kind: 'shrine'; heal: number; buff: 'damage' | 'guard' };

/**
 * What a node pays out, computed once, so the run state and the message cannot disagree.
 *
 * `scale` is the party multiplier of the field that actually killed the node — the number of
 * bodies standing in it, weighted by how many of them are separate people (`partyRewardScale`).
 * It is handed in rather than looked up because a fold map does not know who is on it: the same
 * node pays a walker alone and a four-body pull differently, and the route is identical either way.
 */
export function resolveNode(
  run: AreaRun,
  area: DataArea,
  nodeId: string,
  roll = Math.random(),
  scale = 1,
  r: () => number = Math.random,
): NodeOutcome | null {
  const node = nodeById(area, nodeId);
  if (!node) return null;
  const taken = 1 - run.cleared.length * 0.04;
  switch (node.kind) {
    case 'gate':
      return null;
    case 'wave':
    case 'elite': {
      const hits = node.kind === 'elite' ? 1.8 : 1;
      return {
        kind: node.kind,
        xp: Math.round(xpForRoom(area.tier) * hits * scale),
        wav: Math.round(wavForRoom(area.tier) * hits * taken * scale),
        // Pre-rolled cards still pay out as always; the draft is the pick on top, not instead.
        cards: node.cards ?? [],
        draft: draftRoll(node.kind, area.tier, r),
        damagePct: (node.enemy?.power ?? 8) * (1 - run.buffs.guard),
      };
    }
    case 'chest':
      return {
        kind: 'chest',
        xp: Math.round(xpForRoom(area.tier) * scale),
        wav: Math.round(wavForChest(area.tier, roll) * scale),
        cards: node.cards ?? [],
      };
    case 'shrine': {
      const heal = Math.round(run.maxHp * 0.35);
      return { kind: 'shrine', heal, buff: (run.cleared.length + area.seed) % 2 ? 'guard' : 'damage' };
    }
    case 'boss': {
      const flawless = run.hp >= run.maxHp * 0.9;
      return {
        kind: 'boss',
        xp: Math.round((xpForRoom(area.tier) + xpForRun(area.tier, flawless)) * scale),
        wav: Math.round(wavForChest(area.tier, flawless ? 0.9 : 0.5) * scale),
        // The boss's pre-rolled pay stays; the draft is the pick on top, not instead.
        cards: node.cards ?? [],
        draft: draftRoll(node.kind, area.tier, r),
        damagePct: node.enemy?.power ?? 10,
      };
    }
  }
}

/**
 * Apply an outcome to the run. Damage is passed in from the session that actually
 * fought it, so the field's own events remain the only source of truth about HP.
 */
export function applyOutcome(run: AreaRun, area: DataArea, nodeId: string, outcome: NodeOutcome, damageTaken = 0): AreaRun {
  const next: AreaRun = {
    ...run,
    cleared: [...run.cleared, nodeId],
    draft: 'draft' in outcome && outcome.draft.length ? { nodeId, options: outcome.draft } : run.draft,
    shrine: outcome.kind === 'shrine' ? { nodeId } : run.shrine,
    cards: [...run.cards, ...('cards' in outcome ? outcome.cards : [])],
    xp: run.xp + ('xp' in outcome ? outcome.xp : 0),
    wav: run.wav + ('wav' in outcome ? outcome.wav : 0),
    buffs: { ...run.buffs },
    // Whatever arm was held was for the node being resolved, and is spent now.
    armed: null,
  };
  if (outcome.kind === 'shrine') {
    next.hp = Math.min(next.maxHp, next.hp + outcome.heal);
    if (outcome.buff === 'damage') next.buffs.damage = Math.min(0.45, next.buffs.damage + 0.12);
    else next.buffs.guard = Math.min(0.4, next.buffs.guard + 0.1);
  } else {
    next.hp = Math.max(0, next.hp - damageTaken);
  }
  next.at = nodeId;
  if (nodeId === area.bossId) next.done = true;
  if (next.hp <= 0) next.failed = true;
  return next;
}

export interface AdvanceResult {
  ok: boolean;
  reason?: string;
  run: AreaRun;
  outcome: NodeOutcome | null;
  node: AreaNode | null;
}

/**
 * The only call a server needs when a player steps into a node: validate, resolve,
 * apply. Keeping those three inside one function is what stops a route from paying
 * out a reward it never validated, which is the classic version of this bug.
 */
export function advanceRun(
  run: AreaRun,
  area: DataArea,
  nodeId: string,
  damageTaken = 0,
  roll = Math.random(),
): AdvanceResult {
  const door = canEnter(run, area, nodeId);
  const node = nodeById(area, nodeId) ?? null;
  if (!door.ok || !node) return { ok: false, reason: door.reason ?? 'no such node', run, outcome: null, node };
  const outcome = resolveNode(run, area, nodeId, roll);
  if (!outcome) {
    // A gate is only a step, but it still has to be recorded or the path check loops.
    return { ok: true, run: { ...run, at: nodeId, cleared: [...run.cleared, nodeId] }, outcome: null, node };
  }
  return { ok: true, run: applyOutcome(run, area, nodeId, outcome, damageTaken), outcome, node };
}

/**
 * Step onto a node without resolving it. A node with something standing in it is
 * entered first and cleared second, because the fight happens on the battle field and
 * the field, not the map, decides when the thing is dead.
 */
export function enterNode(run: AreaRun, area: DataArea, nodeId: string): { ok: boolean; reason?: string; run: AreaRun } {
  const door = canEnter(run, area, nodeId);
  if (!door.ok) return { ok: false, reason: door.reason, run };
  const node = nodeById(area, nodeId);
  if (!node) return { ok: false, reason: 'no such node', run };
  // Non-combat nodes pay out on the step, so they are never "entered" and left open.
  if (!node.enemy) return { ok: true, run };
  return { ok: true, run: { ...run, at: nodeId, armed: null } };
}

/**
 * Clear the node the run is standing on. Only ever pays the node underfoot.
 *
 * `scale` is the party multiplier of the field that killed it, and it is only on this path: a
 * chest or a shrine resolves on the step, from one person's own route, so scaling it would make
 * the payout depend on who happened to arrive first. A fight is different — the bodies in the
 * field are measured by the field itself.
 */
export function clearNode(
  run: AreaRun,
  area: DataArea,
  damageTaken = 0,
  roll = Math.random(),
  scale = 1,
): { ok: boolean; reason?: string; run: AreaRun; outcome: NodeOutcome | null } {
  if (run.cleared.includes(run.at)) return { ok: false, reason: 'already cleared', run, outcome: null };
  const outcome = resolveNode(run, area, run.at, roll, scale, rnd(Math.floor(roll * 4294967296)));
  if (!outcome) return { ok: false, reason: 'nothing to clear here', run, outcome: null };
  return { ok: true, run: applyOutcome(run, area, run.at, outcome, damageTaken), outcome };
}

/** The row summary the client draws as a node map. */
export function rowsOf(area: DataArea): AreaNode[][] {
  const out: AreaNode[][] = [];
  for (let r = 0; r < area.rows; r++) out.push(area.nodes.filter((n) => n.row === r));
  return out;
}

export function runScore(run: AreaRun): { tier: number; rooms: number; wav: number; xp: number } {
  return { tier: run.tier, rooms: run.cleared.length, wav: run.wav, xp: run.xp };
}
