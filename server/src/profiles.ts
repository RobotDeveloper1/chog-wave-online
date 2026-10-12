import {
  ALBUM_UNIVERSE,
  ALL_QUESTS,
  CHIP_BY_ID,
  GA_BY_ID,
  ITEMS,
  QUESTS,
  RECIPES,
  STARTING_BAG,
  SF,
  advanceRun,
  albumRank,
  albumStat,
  anyChip,
  applyEvent,
  autoFolder,
  bountiesFor,
  buy as buyLine,
  canSell,
  cardPool,
  categoryPrize,
  checkFolder,
  chip as chipOf,
  clearNode,
  defaultFolder,
  emptyAlbum,
  emptyBag,
  emptyLibrary,
  enterNode,
  folderLicenceAt,
  folderRules,
  freshState,
  isChipId,
  isOpen,
  labelFor,
  DUNGEONS,
  DUNGEON_BY_ID,
  dungeonFlag,
  dungeonStatus,
  makeDungeon,
  markClaimed,
  marksFor,
  nodeById,
  npcOf,
  pendingCompletions,
  pointsForClear,
  priceFactor,
  poiOf,
  progressOf,
  rarityWeight,
  refLevel,
  repairFolder,
  resolveTurn,
  rollWave,
  sectorMultiplier,
  sellPrice,
  sight as sightInto,
  startRun,
  stockForChips,
  stockForSupply,
  sweepBounties,
  trackTargets,
  turnIn as turnInQuest,
  turnInOf,
  unlocksAt,
  gatesBetween,
  STORY,
  wavForClear,
  xpForClear,
  type AlbumState,
  type AreaRun,
  type Bag,
  type ChogBuild,
  type DataArea,
  type Element,
  type DungeonDef,
  type DungeonView,
  type FolderLicence,
  type FolderView,
  type ItemId,
  type Library,
  type LibraryRecipe,
  type NodeOutcome,
  type QuestDef,
  type QuestEvent,
  type QuestLog,
  type SectorId,
  type ShopLine,
  type Unlocks,
  type AlbumView,
  type ProfileStats,
  type ProfileView,
  type QuestLineView,
  type QuestView,
  type RunView,
  type ShopView,
} from '@chog/shared';
import type { SaveStore } from './save.ts';

/**
 * Everything a token *carries* rather than *is*: XP, level, WAV, the bag, the quest
 * log, the Album, and the Data Area run currently in progress.
 *
 * The rule this file exists to enforce is that none of it is ever decided by the
 * client. The client asks to buy, to turn in, to step into a node; this is the only
 * thing allowed to say how much that pays, and it re-derives the shop line and the run
 * from its own records every time. A forged message can at worst waste the sender's
 * own turn.
 */

export interface ProfileDoc {
  xp: number;
  bag: Bag;
  quests: QuestLog;
  album: AlbumState;
  run: AreaRun | null;
  /** The area the current run belongs to, kept so a step can be validated. */
  area: DataArea | null;
  stats: ProfileStats;
  /** Day the bounties currently in `quests` were handed out. */
  bountyDay: number;
  /** Consumable effects bought but not yet spent. Never client-asserted. */
  amp: boolean;
  ward: boolean;
  scanned: boolean;
  /** Places this token has found (point-of-interest ids). */
  discovered: string[];
  /** Mystery Wave id -> the UTC day it was last caught, so each pays once a day. */
  waves: Record<string, number>;
  /** The folder the player chose, or null to fight with the one the token was born with. */
  folder: string[] | null;
  /** Fusions this Chog has fired. They travel with the token, like the Album. */
  library: Library;
  /** One-off marks the guide keeps: the welcome shown, a tip seen, the training sim cleared. */
  flags: Record<string, number>;
  /** The UTC day training pay was last counted, and how many clears it has paid since. */
  trainDay: number;
  trainPaid: number;
}

const EMPTY_STATS: ProfileStats = {
  clears: 0,
  stormClears: 0,
  rooms: 0,
  areas: 0,
  purchases: 0,
  sells: 0,
  trades: 0,
  links: 0,
  lasers: 0,
  chats: 0,
  sightings: 0,
  deaths: 0,
  bestProgram: 0,
  bestChain: 0,
  fusions: 0,
  trains: 0,
  waves: 0,
  dodges: 0,
};

function blank(): ProfileDoc {
  return {
    xp: 0,
    bag: { wav: STARTING_BAG.wav, items: { ...STARTING_BAG.items } },
    quests: {},
    album: emptyAlbum(),
    run: null,
    area: null,
    stats: { ...EMPTY_STATS },
    bountyDay: -1,
    amp: false,
    ward: false,
    scanned: false,
    discovered: [],
    waves: {},
    folder: null,
    library: emptyLibrary(),
    flags: {},
    trainDay: -1,
    trainPaid: 0,
  };
}

export interface LevelUp {
  from: number;
  to: number;
  unlocks: string[];
}

export interface RefundLine {
  id: string;
  name: string;
  wav: number;
}

export interface GrantResult {
  xp: number;
  wav: number;
  chips: string[];
  items: ItemId[];
  /**
   * Cards that had nowhere to go — already in the collection, or no room left in the bag — and were
   * paid to the counter on the spot instead of vanishing. Their WAV is already inside `wav` above.
   */
  refunded: RefundLine[];
  level: LevelUp | null;
}

/** The shelf turns over every six hours; the same divisor is used everywhere so a
 *  price a player sees is the price the server will charge. */
export const SHELF_MS = 216_000_000;
export const shelfSeed = (now: number): number => Math.floor(now / SHELF_MS);

export class Profiles {
  private cache = new Map<number, ProfileDoc>();

  private readonly saves: SaveStore;

  constructor(saves: SaveStore) {
    this.saves = saves;
  }

  doc(tokenId: number): ProfileDoc {
    const cached = this.cache.get(tokenId);
    if (cached) return cached;
    const merged = this.saves.readProgress(tokenId, blank());
    // Repair any half-written shape rather than trusting the blob. A missing `items`
    // would otherwise crash every later read for that token, permanently.
    if (!merged.bag || typeof merged.bag.wav !== 'number') merged.bag = emptyBag();
    if (!merged.bag.items) merged.bag.items = {};
    if (!merged.album) merged.album = emptyAlbum();
    if (!merged.quests) merged.quests = {};
    if (!Array.isArray(merged.discovered)) merged.discovered = [];
    if (!merged.waves || typeof merged.waves !== 'object') merged.waves = {};
    // A stat added after a token was saved reads as a missing number, which does arithmetic as NaN.
    merged.stats = { ...EMPTY_STATS, ...(merged.stats ?? {}) };
    if (merged.folder !== null && !Array.isArray(merged.folder)) merged.folder = null;
    if (!merged.library || !Array.isArray(merged.library.discovered)) merged.library = emptyLibrary();
    if (!merged.flags || typeof merged.flags !== 'object') merged.flags = {};
    if (typeof merged.trainDay !== 'number') merged.trainDay = -1;
    if (typeof merged.trainPaid !== 'number') merged.trainPaid = 0;
    this.cache.set(tokenId, merged);
    return merged;
  }

  private persist(tokenId: number, doc: ProfileDoc): ProfileDoc {
    this.saves.writeProgress(tokenId, doc);
    this.cache.set(tokenId, doc);
    return doc;
  }

  forget(tokenId: number): void {
    this.cache.delete(tokenId);
  }

  level(tokenId: number): number {
    return progressOf(this.doc(tokenId).xp).level;
  }

  unlocks(tokenId: number): Unlocks {
    return unlocksAt(this.level(tokenId));
  }

  // ---------------------------------------------------------------------------
  // Paying out
  // ---------------------------------------------------------------------------

  /**
   * The single entry point for every reward in the game. Clears, chests, quests and
   * Album completions all route through here, so a level-up can only happen one way
   * and the tape can only say one thing about it.
   */
  grant(
    tokenId: number,
    award: { xp?: number; wav?: number; chips?: string[]; items?: Partial<Record<ItemId, number>> },
  ): GrantResult {
    const doc = this.doc(tokenId);
    const before = progressOf(doc.xp).level;
    const xp = Math.max(0, Math.round(award.xp ?? 0));
    const wav = Math.max(0, Math.round(award.wav ?? 0));
    doc.xp += xp;
    doc.bag = { ...doc.bag, wav: doc.bag.wav + wav };
    const items: ItemId[] = [];
    for (const [id, n] of Object.entries(award.items ?? {})) {
      if (!(id in ITEMS)) continue;
      doc.bag.items = { ...doc.bag.items, [id]: (doc.bag.items[id as ItemId] ?? 0) + (n ?? 1) };
      items.push(id as ItemId);
    }
    const chips = (award.chips ?? []).filter((id) => isChipId(id));
    const paid = chips.length ? this.addChips(tokenId, chips) : { taken: [], refunded: [] };

    const after = progressOf(doc.xp).level;
    this.persist(tokenId, doc);
    return {
      xp,
      // The refund is already in the bag, so it is already in the number the reward line prints.
      wav: wav + paid.refunded.reduce((s, r) => s + r.wav, 0),
      chips: paid.taken,
      items,
      refunded: paid.refunded,
      level: after > before ? { from: before, to: after, unlocks: unlockNamesBetween(before, after) } : null,
    };
  }

  /** Hand cards to a player outside a reward grant (the Sim's first card). Returns the ones that fit. */
  giveCards(tokenId: number, ids: string[]): string[] {
    const { taken } = this.addChips(tokenId, ids);
    if (taken.length) this.persist(tokenId, this.doc(tokenId));
    return taken;
  }

  /**
   * Put cards in the bag and report what actually landed. Cards go through the save, because that
   * is where the collection is read from. The bag has a cap, but a fused card is *earned* — dropping
   * one because the bag is full would take a discovery away — so those always fit, and only ordinary
   * cards are held to the cap.
   *
   * What cannot land is bought back at the counter on the spot, at the same price a sell button
   * pays: a duplicate and a card dropped against a full bag both used to vanish in silence, which
   * made a late run's chests worth less than nothing.
   */
  private addChips(tokenId: number, ids: string[]): { taken: string[]; refunded: RefundLine[] } {
    const owned = this.saves.get(tokenId);
    const cap = this.unlocks(tokenId).bagCap;
    const have = new Set(owned.chips);
    const taken: string[] = [];
    const refunded: RefundLine[] = [];
    const next = [...owned.chips];
    for (const id of ids) {
      if (!isChipId(id)) continue;
      const fused = GA_BY_ID.has(id);
      const dead = have.has(id) || (!fused && next.filter((c) => !GA_BY_ID.has(c)).length >= cap);
      if (!dead) {
        have.add(id);
        next.push(id);
        taken.push(id);
        continue;
      }
      const card = CHIP_BY_ID.get(id);
      if (!card) continue;
      const wav = sellPrice(card);
      refunded.push({ id, name: card.name, wav });
    }
    if (taken.length) this.saves.setChips(tokenId, next);
    if (refunded.length) {
      const doc = this.doc(tokenId);
      doc.bag = { ...doc.bag, wav: doc.bag.wav + refunded.reduce((s, r) => s + r.wav, 0) };
      this.persist(tokenId, doc);
    }
    return { taken, refunded };
  }

  // ---------------------------------------------------------------------------
  // Battle-shaped events
  // ---------------------------------------------------------------------------

  /** Called when a boss drops. Returns the quest events the caller must still feed. */
  onClear(args: {
    tokenId: number;
    tier: string;
    sector: SectorId;
    damage: number;
    /**
     * The party's reward multiplier, straight from `partyRewardScale(size, owners)` — 1 solo, up to
     * 1.48 for four humans, and *under* 1 when one wallet runs several bodies. Not a head count:
     * the tax lives in the multiplier, so it is only ever decided once.
     */
    scale: number;
  }): { grant: GrantResult; events: QuestEvent[] } {
    const doc = this.doc(args.tokenId);
    const tier: 'ambient' | 'glitch' | 'anomaly' | 'storm' =
      args.tier === 'storm' ? 'storm' : args.tier === 'anomaly' ? 'anomaly' : args.tier === 'glitch' ? 'glitch' : 'ambient';
    const scale = args.scale > 0 ? args.scale : 1;
    const grant = this.grant(args.tokenId, {
      xp: xpForClear(tier, args.damage, scale),
      wav: wavForClear(tier, scale),
    });
    doc.stats.clears += 1;
    if (tier === 'storm') doc.stats.stormClears += 1;
    doc.stats.bestProgram = Math.max(doc.stats.bestProgram, Math.round(args.damage));
    this.persist(args.tokenId, doc);
    return {
      grant,
      events: [
        { type: 'clear', sector: args.sector },
        ...(tier === 'storm' ? [{ type: 'stormClear' as const, sector: args.sector }] : []),
        // Damage objectives count in 500-point blocks, so `need` stays a readable number.
        { type: 'damage', amount: Math.max(1, Math.round(args.damage / 500)) },
      ],
    };
  }

  onLaser(tokenId: number): QuestEvent[] {
    const doc = this.doc(tokenId);
    doc.stats.lasers += 1;
    this.persist(tokenId, doc);
    return [{ type: 'laser' }];
  }

  countFor(tokenId: number, kind: keyof ProfileStats, amount = 1): void {
    const doc = this.doc(tokenId);
    doc.stats[kind] += amount;
    this.persist(tokenId, doc);
  }

  best(tokenId: number, program: number, chain: number): void {
    const doc = this.doc(tokenId);
    doc.stats.bestProgram = Math.max(doc.stats.bestProgram, Math.round(program));
    doc.stats.bestChain = Math.max(doc.stats.bestChain, chain);
    this.persist(tokenId, doc);
  }

  consume(tokenId: number, what: 'amp' | 'ward' | 'scanned'): boolean {
    const doc = this.doc(tokenId);
    if (!doc[what]) return false;
    doc[what] = false;
    this.persist(tokenId, doc);
    return true;
  }

  has(tokenId: number, what: 'amp' | 'ward' | 'scanned'): boolean {
    return this.doc(tokenId)[what];
  }

  // ---------------------------------------------------------------------------
  // Quests
  // ---------------------------------------------------------------------------

  /**
   * Drop yesterday's contracts. Today's are *offered* at the board, not handed out: a
   * quest the player never chose to take is a line in a log they did not ask for.
   */
  ensureBounties(tokenId: number, _sectors: SectorId[], now = Date.now()): QuestDef[] {
    const doc = this.doc(tokenId);
    doc.quests = sweepBounties(doc.quests, now);
    doc.bountyDay = Math.floor(now / 86_400_000);
    this.persist(tokenId, doc);
    return [];
  }

  /** Today's contract for a district, if this player has not taken it. */
  bountyOffer(tokenId: number, sector: SectorId, now = Date.now()): QuestDef | null {
    const def = bountiesFor(now, SECTORS_ALL).find((q) => q.sector === sector);
    if (!def) return null;
    return this.doc(tokenId).quests[def.id] ? null : def;
  }

  /** Every definition a log carries, the book's and the day's. */
  private defsOf(log: QuestLog, now = Date.now()): QuestDef[] {
    const out: QuestDef[] = [];
    for (const id of Object.keys(log)) {
      const def = this.questDef(id, now);
      if (def) out.push(def);
    }
    return out;
  }

  /**
   * Feed one game event to every quest the player has *taken*. The world calls this from
   * where things actually happen, which is what keeps a quest honest — there is no second
   * "quest progress" path that could disagree with the real one.
   */
  questEvents(tokenId: number, evs: QuestEvent[]): string[] {
    if (!evs.length) return [];
    const doc = this.doc(tokenId);
    const completed: string[] = [];
    for (const def of this.defsOf(doc.quests)) {
      const state = doc.quests[def.id];
      if (!state || state.turnedIn) continue;
      for (const ev of evs) {
        const res = applyEvent(doc.quests, def, ev);
        doc.quests[def.id] = res.state;
        if (res.justDone) completed.push(def.name);
      }
    }
    this.persist(tokenId, doc);
    return completed;
  }

  /** Take a quest from the person who gives it. */
  accept(tokenId: number, questId: string, npcId: string, now = Date.now()): { ok: boolean; reason?: string; def?: QuestDef } {
    const doc = this.doc(tokenId);
    const def = this.questDef(questId, now);
    if (!def) return { ok: false, reason: 'no such quest' };
    if (def.giver !== npcId) return { ok: false, reason: 'they do not give that one' };
    if (doc.quests[def.id]) return { ok: false, reason: 'you already have it' };
    if (!def.bounty && !isOpen(def, doc.quests, this.level(tokenId))) return { ok: false, reason: 'not yet' };
    // A contract is only for the day it was posted.
    if (def.bounty && !def.id.startsWith(`bounty-${Math.floor(now / 86_400_000)}-`)) return { ok: false, reason: 'that contract expired' };
    const open = Object.values(doc.quests).filter((s) => !s.turnedIn).length;
    if (open >= 16) return { ok: false, reason: 'your log is full' };
    doc.quests[def.id] = freshState(def, def.bounty ? Math.floor(now / 86_400_000) : undefined);
    this.persist(tokenId, doc);
    return { ok: true, def };
  }

  turnIn(tokenId: number, questId: string, npcId?: string): { ok: boolean; reason?: string; reward?: GrantResult; name?: string; def?: QuestDef } {
    const doc = this.doc(tokenId);
    const def = this.questDef(questId);
    if (!def) return { ok: false, reason: 'not on your board' };
    if (npcId && turnInOf(def) !== npcId) return { ok: false, reason: 'report that to someone else' };
    const result = turnInQuest(doc.quests, questId, def);
    if (!result.ok) return { ok: false, reason: result.reason };
    doc.quests = result.log;
    this.persist(tokenId, doc);
    const reward = this.grant(tokenId, { xp: result.xp, wav: result.wav, items: result.items, chips: result.chips });
    return { ok: true, reward, name: def.name, def };
  }

  private questDef(id: string, now = Date.now()): QuestDef | undefined {
    const book = QUESTS.get(id);
    if (book) return book;
    if (!id.startsWith('bounty-')) return undefined;
    const day = Number(id.split('-')[1]);
    if (!Number.isFinite(day)) return undefined;
    void now;
    return bountiesFor(day * 86_400_000, SECTORS_ALL).find((q) => q.id === id);
  }

  // ---------------------------------------------------------------------------
  // The street: places to find and waves to catch
  // ---------------------------------------------------------------------------

  /** Log a place as found. Pays once per token, and reports whether it was new. */
  discover(tokenId: number, poiId: string): { first: boolean; xp: number; name: string; text: string } | null {
    const hit = poiOf(poiId);
    if (!hit) return null;
    const doc = this.doc(tokenId);
    if (doc.discovered.includes(poiId)) return { first: false, xp: 0, name: hit.poi.name, text: hit.poi.text ?? '' };
    doc.discovered = [...doc.discovered, poiId];
    this.persist(tokenId, doc);
    const xp = hit.poi.kind === 'secret' ? 12 : 7;
    this.grant(tokenId, { xp });
    return { first: true, xp, name: hit.poi.name, text: hit.poi.text ?? '' };
  }

  /** Mystery Waves caught today, by wave id. */
  caughtToday(tokenId: number, now = Date.now()): string[] {
    const day = Math.floor(now / 86_400_000);
    return Object.entries(this.doc(tokenId).waves)
      .filter(([, d]) => d === day)
      .map(([id]) => id);
  }

  collectWave(
    tokenId: number,
    wave: { id: string; element: Element },
    ctx: { sector: SectorId; tribe: Element; heat: number },
    now = Date.now(),
  ): { ok: boolean; reason?: string; roll?: ReturnType<typeof rollWave> } {
    const doc = this.doc(tokenId);
    const day = Math.floor(now / 86_400_000);
    if (doc.waves[wave.id] === day) return { ok: false, reason: 'already caught today' };
    const roll = rollWave({ tokenId, id: wave.id, day, sector: ctx.sector, element: wave.element, tribe: ctx.tribe, heat: ctx.heat });
    // Keep only today's catches: the map must not grow with every day a token has played.
    doc.waves = Object.fromEntries(Object.entries(doc.waves).filter(([, d]) => d === day));
    doc.waves[wave.id] = day;
    this.persist(tokenId, doc);
    this.grant(tokenId, { xp: roll.xp, wav: roll.wav, items: roll.items });
    return { ok: true, roll };
  }

  /** The names a quest view shows, from the city plan, not from a string typed twice. */
  private nameOf(npcId: string): string {
    return npcOf(npcId)?.npc.name ?? npcId.toUpperCase();
  }

  /** What the person at `npcId` has for this player: hand-ins, offers and errands in progress. */
  talk(tokenId: number, npcId: string, now = Date.now()): { ready: QuestDef[]; offers: QuestDef[]; pending: QuestDef[] } {
    const doc = this.doc(tokenId);
    const level = this.level(tokenId);
    const defs = [...ALL_QUESTS, ...bountiesFor(now, SECTORS_ALL)];
    const ready = defs.filter((q) => {
      const st = doc.quests[q.id];
      return !!st && st.done && !st.turnedIn && turnInOf(q) === npcId;
    });
    const offers = defs.filter((q) => q.giver === npcId && (q.bounty ? !doc.quests[q.id] : isOpen(q, doc.quests, level)));
    const pending = defs.filter((q) => {
      const st = doc.quests[q.id];
      return !!st && !st.done && !st.turnedIn && (q.giver === npcId || turnInOf(q) === npcId);
    });
    return { ready, offers, pending };
  }

  // ---------------------------------------------------------------------------
  // Shop
  // ---------------------------------------------------------------------------

  shops(tokenId: number, sector: SectorId, volumeMon: number, now = Date.now()): ProfileView['shops'] {
    const doc = this.doc(tokenId);
    const volume = { mon: volumeMon };
    return {
      factor: priceFactor(volume),
      chips: stockForChips(shelfSeed(now), volume, sector),
      supply: stockForSupply(shelfSeed(now), volume),
      refreshesIn: refreshLabel(now),
      wav: doc.bag.wav,
    };
  }

  /**
   * The line is regenerated from the server's own shelf seed and re-priced, so a
   * client quoting a friendly number is quoting a card that does not exist today.
   */
  buy(
    tokenId: number,
    sector: SectorId,
    kind: 'chip' | 'item',
    stockId: string,
    volumeMon: number,
    now = Date.now(),
    born: readonly string[] = [],
  ): { ok: boolean; reason?: string; line?: ShopLine; grant?: GrantResult } {
    const doc = this.doc(tokenId);
    const volume = { mon: volumeMon };
    const lines = kind === 'chip' ? stockForChips(shelfSeed(now), volume, sector) : stockForSupply(shelfSeed(now), volume);
    const line = lines.find((l) => l.stockId === stockId);
    if (!line) return { ok: false, reason: 'not on the shelf today' };

    const owned = this.saves.get(tokenId).chips;
    // A collection is a set: a second copy of a card the player can already field is WAV for nothing.
    if (kind === 'chip' && (owned.includes(stockId) || born.includes(stockId))) return { ok: false, reason: 'you can already field that card' };
    if (kind === 'chip' && owned.filter((c) => !GA_BY_ID.has(c)).length >= this.unlocks(tokenId).bagCap) return { ok: false, reason: 'the bag is full — sell a card first' };
    const res = buyLine(line, doc.bag, owned);
    if (!res.ok) return { ok: false, reason: res.reason };
    doc.bag = res.bag;
    doc.stats.purchases += 1;
    this.persist(tokenId, doc);

    if (kind === 'item') {
      const grant = this.grant(tokenId, { items: { [stockId as ItemId]: 1 } });
      this.questEvents(tokenId, [{ type: 'buy' }]);
      return { ok: true, line, grant };
    }
    if (!CHIP_BY_ID.has(stockId)) return { ok: false, reason: 'no such card' };
    this.addChips(tokenId, [stockId]);
    this.questEvents(tokenId, [{ type: 'buy' }]);
    return { ok: true, line };
  }

  sell(tokenId: number, chipId: string, signatureIds: string[]): { ok: boolean; reason?: string; wav?: number } {
    const c = CHIP_BY_ID.get(chipId);
    if (!c) return { ok: false, reason: 'no such card' };
    if (!canSell(c, signatureIds)) return { ok: false, reason: 'that card belongs to a Chog' };
    const save = this.saves.get(tokenId);
    const i = save.chips.indexOf(chipId);
    if (i < 0) return { ok: false, reason: 'you do not hold it' };
    const chips = save.chips.slice();
    chips.splice(i, 1);
    this.saves.setChips(tokenId, chips);
    const wav = sellPrice(c);
    const doc = this.doc(tokenId);
    doc.stats.sells += 1;
    this.persist(tokenId, doc);
    this.grant(tokenId, { wav });
    this.questEvents(tokenId, [{ type: 'sellChip' }]);
    return { ok: true, wav };
  }

  /**
   * Items resolve to an instruction, not a mutation of the field. The world owns the
   * battle session, so only it can say what "restore 60 integrity" lands on.
   */
  use(
    tokenId: number,
    id: ItemId,
  ): { ok: boolean; reason?: string; effect?: { heal?: number; amp?: boolean; ward?: boolean; scan?: boolean; chips?: string[]; refunded?: RefundLine[] } } {
    const doc = this.doc(tokenId);
    const def = ITEMS[id];
    if (!def) return { ok: false, reason: 'no such item' };
    if ((doc.bag.items[id] ?? 0) <= 0) return { ok: false, reason: 'none left' };

    const left = (doc.bag.items[id] ?? 1) - 1;
    doc.bag.items = { ...doc.bag.items };
    if (left > 0) doc.bag.items[id] = left;
    else delete doc.bag.items[id];

    let effect: { heal?: number; amp?: boolean; ward?: boolean; scan?: boolean; chips?: string[]; refunded?: RefundLine[] } = {};
    switch (id) {
      case 'med':
        effect = { heal: 60 };
        break;
      case 'repair':
        // Large rather than infinite, so a typo in the field model still bounds it.
        effect = { heal: 100_000 };
        break;
      case 'amp':
        doc.amp = true;
        effect = { amp: true };
        break;
      case 'ward':
        doc.ward = true;
        effect = { ward: true };
        break;
      case 'scan':
        doc.scanned = true;
        effect = { scan: true };
        break;
      case 'pack': {
        const commons = [...CHIP_BY_ID.values()].filter((c) => !c.klass).map((c) => c.id);
        const picked = Array.from({ length: 3 }, () => commons[Math.floor(Math.random() * commons.length)]!);
        const { taken, refunded } = this.addChips(tokenId, picked);
        // Three commons from one bag is a roll with replacement, so a pack routinely repeats itself.
        // The copy that has nowhere to go is bought back rather than swallowed by the opening.
        effect = { chips: taken, refunded };
        break;
      }
    }
    this.persist(tokenId, doc);
    return { ok: true, effect };
  }

  // ---------------------------------------------------------------------------
  // Album
  // ---------------------------------------------------------------------------

  /** Fold a Chog's trait keys in. Returns what was new so the tape can announce it. */
  sight(
    tokenId: number,
    keys: string[],
  ): { added: string[]; xp: number; best: string | null; completions: { category: string; chip: string | null; wav: number }[] } {
    const doc = this.doc(tokenId);
    const res = sightInto(doc.album.seen, keys);
    if (!res.added.length) return { added: [], xp: 0, best: null, completions: [] };
    doc.album = { ...doc.album, seen: res.seen };
    doc.stats.sightings += res.added.length;
    this.persist(tokenId, doc);
    const grant = this.grant(tokenId, { xp: res.xp });
    this.questEvents(tokenId, [{ type: 'sighting', amount: res.added.length }]);

    const pending = pendingCompletions(doc.album);
    if (pending.length) {
      doc.album = markClaimed(doc.album, pending.map((p) => p.category));
      this.persist(tokenId, doc);
      for (const p of pending) this.grant(tokenId, { wav: p.wav, chips: p.chip ? [p.chip] : [] });
    }
    return { added: res.added, xp: grant.xp, best: res.best?.key ?? null, completions: pending };
  }

  albumView(tokenId: number): ProfileView['album'] {
    const seen = this.doc(tokenId).album.seen;
    const stat = albumStat(seen);
    return {
      pct: stat.pct,
      have: stat.have,
      need: stat.need,
      rank: albumRank(seen).title,
      categories: stat.categories.map((c) => ({ category: c.category, have: c.have, need: c.need, pct: c.pct })),
    };
  }

  // ---------------------------------------------------------------------------
  // Data Areas
  // ---------------------------------------------------------------------------

  /** The dungeons this token has cleared, from the guide's marks. */
  clearedDungeons(tokenId: number): Set<string> {
    const flags = this.doc(tokenId).flags;
    return new Set(DUNGEONS.filter((d) => flags[dungeonFlag(d.id)]).map((d) => d.id));
  }

  /** Every dungeon and whether this player may go in, for the menu. */
  dungeonViews(tokenId: number): DungeonView[] {
    const level = this.level(tokenId);
    const cleared = this.clearedDungeons(tokenId);
    return DUNGEONS.map((d) => ({ id: d.id, ...dungeonStatus(d, level, cleared) }));
  }

  /**
   * Go into a dungeon. The map is generated here and kept with the run, so a client cannot
   * name a node that does not exist in the graph this process built — and the door is the
   * level and the dungeon before it, checked here and not on the menu.
   */
  openDungeon(
    tokenId: number,
    dungeonId: string,
    maxHp: number,
    now = Date.now(),
  ): { ok: boolean; reason?: string; area?: DataArea; run?: AreaRun } {
    const doc = this.doc(tokenId);
    const def = DUNGEON_BY_ID.get(dungeonId);
    if (!def) return { ok: false, reason: 'no such dungeon' };
    if (doc.run && !doc.run.done && !doc.run.failed) return { ok: false, reason: 'already inside a fold' };
    const door = dungeonStatus(def, this.level(tokenId), this.clearedDungeons(tokenId));
    if (door.state === 'locked') return { ok: false, reason: `${def.name} ${door.reason}` };
    const area = makeDungeon(def, Math.floor(now / 1000) + tokenId * 7717 + def.n * 13);
    doc.area = area;
    doc.run = startRun(area, Math.max(1, maxHp), now);
    this.persist(tokenId, doc);
    return { ok: true, area, run: doc.run };
  }

  /**
   * Bring a party member into the fold somebody else opened. They walk the *same* map — same
   * `id`, so the field the server keys a fight on is one field and not four — with their own run
   * on it: their own integrity, their own route, their own share of the payout.
   *
   * Two doors, and both are the member's own: the dungeon has to be unlocked for this Chog, and
   * it cannot already be inside a fold. The layout is copied rather than shared so each save
   * stays a self-contained document; `world.ts` is what decides who is in the party.
   */
  attachFold(
    tokenId: number,
    host: DataArea,
    maxHp: number,
    now = Date.now(),
  ): { ok: boolean; reason?: string; area?: DataArea; run?: AreaRun } {
    const doc = this.doc(tokenId);
    if (doc.run && !doc.run.done && !doc.run.failed) return { ok: false, reason: 'already inside a fold' };
    const def = host.dungeonId ? DUNGEON_BY_ID.get(host.dungeonId) : undefined;
    if (!def) return { ok: false, reason: 'no such dungeon' };
    const door = dungeonStatus(def, this.level(tokenId), this.clearedDungeons(tokenId));
    if (door.state === 'locked') return { ok: false, reason: `${def.name} ${door.reason}` };
    const area = structuredClone(host);
    doc.area = area;
    doc.run = startRun(area, Math.max(1, maxHp), now);
    this.persist(tokenId, doc);
    return { ok: true, area, run: doc.run };
  }

  /**
   * Step forward. A chest or a relay resolves and pays on the step; a node with something standing
   * in it only moves, because the field decides when that thing is dead and `clearCurrent` is what
   * pays it.
   */
  stepArea(
    tokenId: number,
    nodeId: string,
  ): { ok: boolean; reason?: string; run?: AreaRun; outcome?: NodeOutcome | null; sector?: SectorId; fights?: boolean; grant?: GrantResult; enemy?: ReturnType<Profiles['areaEnemy']> } {
    const doc = this.doc(tokenId);
    if (!doc.area || !doc.run) return { ok: false, reason: 'not inside a fold' };
    const target = nodeById(doc.area, nodeId);
    if (!target) return { ok: false, reason: 'no such node' };

    if (target.enemy) {
      const step = enterNode(doc.run, doc.area, nodeId);
      if (!step.ok) return { ok: false, reason: step.reason };
      doc.run = step.run;
      this.persist(tokenId, doc);
      return { ok: true, run: step.run, outcome: null, sector: doc.area.sector, fights: true, enemy: this.areaEnemy(tokenId) };
    }

    const res = advanceRun(doc.run, doc.area, nodeId);
    if (!res.ok) return { ok: false, reason: res.reason };
    doc.run = res.run;
    doc.stats.rooms += 1;
    this.persist(tokenId, doc);
    this.questEvents(tokenId, [{ type: 'dungeonRoom', sector: doc.area.sector, ...(doc.area.dungeonId ? { target: doc.area.dungeonId } : {}) }]);

    // A non-combat tile resolves on the step, so it pays on the step. The run's tally is a receipt of
    // what the fold has already handed over, not a purse that waits by the door for someone to come
    // back and open it — and a chest's card goes through the same counter as every other drop.
    const outcome = res.outcome;
    let grant: GrantResult | undefined;
    if (outcome && outcome.kind !== 'shrine') {
      grant = this.grant(tokenId, { xp: outcome.xp, wav: outcome.wav, chips: outcome.chips });
    }
    return {
      ok: true,
      run: res.run,
      outcome: res.outcome,
      sector: doc.area.sector,
      fights: false,
      ...(grant ? { grant } : {}),
    };
  }

  /**
   * Issue the right to clear the node the run is standing on. Only the loop that watched a field's
   * boss fall may call it, and only for the tile that field was mirroring — which is what stops
   * `area.kill`, a message a client is free to send at any moment, from paying out a fight that
   * never happened. It is spent by the clear, so one kill buys one room.
   */
  armNode(tokenId: number, nodeId: string): boolean {
    const doc = this.doc(tokenId);
    if (!doc.area || !doc.run) return false;
    if (doc.run.at !== nodeId || doc.run.cleared.includes(nodeId)) return false;
    doc.run = { ...doc.run, armed: nodeId };
    this.persist(tokenId, doc);
    return true;
  }

  /** Pay the node the run is standing on, called by the field the moment its boss dies. */
  clearCurrent(
    tokenId: number,
    damageTaken = 0,
    scale = 1,
  ): { ok: boolean; reason?: string; run?: AreaRun; outcome?: NodeOutcome | null; grant?: GrantResult; cleared?: { def: DungeonDef; first: boolean; grant?: GrantResult } } {
    const doc = this.doc(tokenId);
    if (!doc.area || !doc.run) return { ok: false, reason: 'not inside a fold' };
    if (doc.run.armed !== doc.run.at) return { ok: false, reason: 'nothing has died under you yet' };
    const res = clearNode(doc.run, doc.area, damageTaken, Math.random(), scale);
    if (!res.ok || !res.outcome) return { ok: false, reason: res.reason ?? 'nothing to clear' };
    doc.run = res.run;
    doc.stats.rooms += 1;
    if (res.run.done) doc.stats.areas += 1;
    if (res.run.failed) doc.stats.deaths += 1;
    this.persist(tokenId, doc);

    const outcome = res.outcome;
    let room: GrantResult | undefined;
    if (outcome.kind !== 'shrine') {
      // One grant, one receipt: the card a tile drops goes in with the XP and WAV it pays, so a
      // duplicate is bought back by the counter in the same breath rather than vanishing off the map.
      room = this.grant(tokenId, { xp: outcome.xp, wav: outcome.wav, chips: outcome.chips });
    }

    // The core of a named dungeon: the first clear pays on top, and earns the title.
    let cleared: { def: DungeonDef; first: boolean; grant?: GrantResult } | undefined;
    const dungeonId = doc.area.dungeonId;
    const def = dungeonId ? DUNGEON_BY_ID.get(dungeonId) : undefined;
    if (def && res.run.done && !res.run.failed) {
      const key = dungeonFlag(def.id);
      const first = !doc.flags[key];
      let grant: GrantResult | undefined;
      if (first) {
        doc.flags[key] = Date.now();
        this.persist(tokenId, doc);
        // The numbers scale with the pull that closed the core; the card does not, because a
        // card is one card and a second copy of it is worth nothing to anyone.
        grant = this.grant(tokenId, {
          xp: Math.round(def.firstClear.xp * scale),
          wav: Math.round(def.firstClear.wav * scale),
          items: def.firstClear.items,
        });
      }
      cleared = { def, first, ...(grant ? { grant } : {}) };
    }
    this.questEvents(tokenId, [
      { type: 'dungeonRoom', sector: doc.area.sector, ...(dungeonId ? { target: dungeonId } : {}) },
      ...(res.run.done && !res.run.failed ? [{ type: 'dungeonClear' as const, sector: doc.area.sector, ...(dungeonId ? { target: dungeonId } : {}) }] : []),
    ]);
    return { ok: true, run: res.run, outcome, ...(room ? { grant: room } : {}), ...(cleared ? { cleared } : {}) };
  }

  /** The enemy a room should mirror while a player stands on a node. */
  areaEnemy(tokenId: number): { id: string; areaId: string; name: string; hp: number; power: number; kind: string; tier: number; element: string; archetype: string; label: string; level: number; difficulty: number; band?: { lead: string; minions: string[] } } | null {
    const doc = this.doc(tokenId);
    if (!doc.area || !doc.run) return null;
    const node = nodeById(doc.area, doc.run.at);
    if (!node?.enemy) return null;
    // `power` and the area's tier travel with the enemy because the bite a session deals is solved
    // from both: `power` is anchored on that tier's volley table, so a session that mirrors a node
    // has to use the same one the map was budgeted against.
    return {
      id: node.id,
      // Which fold this is, not just which node: two players in one party share an area id, and the
      // field they meet on is keyed by both. A solo walker's area id is its own, so it stays private.
      areaId: doc.area.id,
      name: node.enemy.name,
      hp: node.enemy.hp,
      power: node.enemy.power,
      kind: node.kind,
      tier: doc.area.tier,
      element: node.enemy.element,
      archetype: node.enemy.archetype,
      label: node.label,
      // The map's own rung on the ladder, which the session reads against the party's: a fold saved
      // before this field existed falls back to the level its tier is cut for.
      level: doc.area.level ?? refLevel(doc.area.tier),
      difficulty: doc.area.tier,
      band: node.enemy.band,
    };
  }

  /** Leave the fold, keeping or discarding the run depending on how it ended. */
  closeArea(tokenId: number): { ok: boolean; cleared: boolean; wav: number } {
    const doc = this.doc(tokenId);
    const wav = doc.run?.wav ?? 0;
    const cleared = doc.run?.done ?? false;
    doc.run = null;
    doc.area = null;
    this.persist(tokenId, doc);
    return { ok: true, cleared, wav };
  }

  areaView(tokenId: number): { area: DataArea | null; run: AreaRun | null; dungeons: DungeonView[]; level: number } {
    const doc = this.doc(tokenId);
    return { area: doc.area, run: doc.run, dungeons: this.dungeonViews(tokenId), level: this.level(tokenId) };
  }

  // ---------------------------------------------------------------------------
  // The folder and the Library
  // ---------------------------------------------------------------------------

  /** Cards this Chog could put in a folder right now: born, owned and fused. */
  pool(tokenId: number, build: ChogBuild): string[] {
    return cardPool(build, this.saves.get(tokenId).chips);
  }

  /**
   * The folder licences this account's level has bought on top of the Chog's born shape. Caps are
   * born + licence, so every folder entry point has to read them from the same place — a folder
   * judged against the born caps alone would silently throw a Mega card out on a level-up.
   */
  licence(tokenId: number): FolderLicence {
    return folderLicenceAt(this.level(tokenId));
  }

  /**
   * The folder the next fight deals from. The player's own choice while it is still legal;
   * if a card was sold or a rule moved under it, it is repaired in place, so a fight can
   * never start from a folder the rules would refuse.
   */
  folderFor(tokenId: number, build: ChogBuild): string[] {
    const doc = this.doc(tokenId);
    if (!doc.folder) return defaultFolder(build);
    const pool = this.pool(tokenId, build);
    const licence = this.licence(tokenId);
    if (checkFolder(folderRules(build, licence), doc.folder, new Set(pool)).ok) return doc.folder;
    doc.folder = repairFolder(build, doc.folder, pool, licence);
    this.persist(tokenId, doc);
    return doc.folder;
  }

  /** Save a folder the player built. Refused with the reasons if the rules do not allow it. */
  setFolder(tokenId: number, build: ChogBuild, folder: string[]): { ok: boolean; errors?: string[] } {
    const pool = this.pool(tokenId, build);
    const check = checkFolder(folderRules(build, this.licence(tokenId)), folder, new Set(pool));
    if (!check.ok) return { ok: false, errors: check.errors };
    const doc = this.doc(tokenId);
    doc.folder = [...folder];
    this.persist(tokenId, doc);
    return { ok: true };
  }

  /** Rebuild the folder from the best of what the player holds. */
  autoFolder(tokenId: number, build: ChogBuild): string[] {
    const doc = this.doc(tokenId);
    doc.folder = autoFolder(build, this.pool(tokenId, build), this.licence(tokenId));
    this.persist(tokenId, doc);
    return doc.folder;
  }

  /** Go back to the folder the token was born with. */
  resetFolder(tokenId: number): void {
    const doc = this.doc(tokenId);
    doc.folder = null;
    this.persist(tokenId, doc);
  }

  folderView(tokenId: number, build: ChogBuild): FolderView {
    const cards = this.folderFor(tokenId, build);
    const pool = this.pool(tokenId, build);
    const rules = folderRules(build, this.licence(tokenId));
    const check = checkFolder(rules, cards, new Set(pool));
    return {
      cards,
      rules,
      pool,
      check: { ok: check.ok, errors: check.errors, mega: check.mega, giga: check.giga, fused: check.fused },
      born: !this.doc(tokenId).folder,
    };
  }

  library(tokenId: number): Library {
    return this.doc(tokenId).library;
  }

  /** What the Library may show: a recipe's hint always, its name and cards only once fired. */
  libraryView(tokenId: number): ProfileView['library'] {
    const known = new Set(this.doc(tokenId).library.discovered);
    const recipes: LibraryRecipe[] = RECIPES.map((r) =>
      known.has(r.id)
        ? { id: r.id, known: true, hint: r.hint, name: GA_BY_ID.get(r.result)?.name ?? r.id, needs: [...r.needs], result: r.result }
        : { id: r.id, known: false, hint: r.hint },
    );
    return { discovered: known.size, total: RECIPES.length, recipes };
  }

  /**
   * A program was fired. If its queue held a recipe, the Library learns it; the first time,
   * the fused card joins the collection for good, which is the whole payout of discovery.
   */
  recordFusion(tokenId: number, queueIds: string[]): { id: string; name: string; result: string; first: boolean } | null {
    const doc = this.doc(tokenId);
    const out = resolveTurn(doc.library, queueIds);
    if (!out.fired) return null;
    doc.stats.fusions += 1;
    if (out.granted.length) {
      doc.library = out.library;
      this.addChips(tokenId, out.granted);
    }
    this.persist(tokenId, doc);
    return { id: out.fired.id, name: GA_BY_ID.get(out.fired.result)?.name ?? out.fired.id, result: out.fired.result, first: out.granted.length > 0 };
  }

  // ---------------------------------------------------------------------------
  // The Training Sim and the guide's memory
  // ---------------------------------------------------------------------------

  /**
   * The Training Sim was cleared. The first clear pays properly and is the end of the
   * tutorial; after that it pays a little, three times a day, so it is worth a warm-up and
   * not worth a grind.
   */
  onTrain(tokenId: number, now = Date.now()): { first: boolean; paid: boolean; grant: GrantResult; events: QuestEvent[] } {
    const doc = this.doc(tokenId);
    const day = Math.floor(now / 86_400_000);
    if (doc.trainDay !== day) {
      doc.trainDay = day;
      doc.trainPaid = 0;
    }
    const first = !doc.flags.trained;
    doc.stats.trains += 1;
    let grant: GrantResult;
    let paid = false;
    if (first) {
      doc.flags.trained = now;
      paid = true;
      grant = this.grant(tokenId, { xp: 45, wav: 50, items: { med: 2 } });
    } else if (doc.trainPaid < SF.TRAIN_PAYS_PER_DAY) {
      doc.trainPaid += 1;
      paid = true;
      grant = this.grant(tokenId, { xp: 6, wav: 8 });
    } else {
      grant = this.grant(tokenId, {});
    }
    this.persist(tokenId, doc);
    return { first, paid, grant, events: [{ type: 'train' }] };
  }

  /** The guide's one-off marks: has this player been shown that yet? */
  flag(tokenId: number, key: string): boolean {
    return !!this.doc(tokenId).flags[key];
  }

  setFlag(tokenId: number, key: string, now = Date.now()): boolean {
    const doc = this.doc(tokenId);
    if (doc.flags[key]) return false;
    doc.flags[key] = now;
    this.persist(tokenId, doc);
    return true;
  }

  // ---------------------------------------------------------------------------
  // The one view the client renders
  // ---------------------------------------------------------------------------

  view(tokenId: number, sector: SectorId, volumeMon: number, build: ChogBuild, now = Date.now()): ProfileView {
    const doc = this.doc(tokenId);
    const signatureIds = [build.signature];
    const chips = this.saves.get(tokenId).chips;
    const prog = progressOf(doc.xp);
    const u = unlocksAt(prog.level);
    const active = this.defsOf(doc.quests, now).filter((q) => doc.quests[q.id] && !doc.quests[q.id]!.turnedIn);
    const rarest = doc.album.seen
      .map((key) => ({ key, weight: rarityWeight(ALBUM_UNIVERSE[key.slice(0, key.indexOf(':'))]?.[key.slice(key.indexOf(':') + 1)] ?? 0) }))
      .sort((a, b) => b.weight - a.weight)[0] ?? null;

    return {
      tokenId,
      xp: doc.xp,
      level: prog.level,
      into: prog.into,
      need: prog.need,
      pct: prog.pct,
      toCap: prog.toCap,
      unlocks: u,
      wav: doc.bag.wav,
      items: doc.bag.items,
      chips,
      bagCap: u.bagCap,
      amp: doc.amp,
      ward: doc.ward,
      scanned: doc.scanned,
      stats: doc.stats,
      quests: active.map((q) => ({
        id: q.id,
        name: q.name,
        giver: this.nameOf(q.giver),
        giverId: q.giver,
        turnIn: this.nameOf(turnInOf(q)),
        turnInId: turnInOf(q),
        text: q.text,
        doing: q.doing ?? '',
        stars: q.stars,
        bounty: !!q.bounty,
        main: q.kind === 'main',
        level: q.level ?? 1,
        sector: q.sector ?? '',
        done: doc.quests[q.id]?.done ?? false,
        turnedIn: doc.quests[q.id]?.turnedIn ?? false,
        lines: q.objectives.map((o, i) => ({ label: labelFor(o), have: doc.quests[q.id]?.progress[i] ?? 0, need: o.need })),
        reward: { wav: q.reward.wav, items: q.reward.items },
        track: trackTargets(doc.quests, [q]).map((t) => ({ kind: t.kind, id: t.id })),
      })),
      marks: marksFor(doc.quests, prog.level, bountiesFor(now, SECTORS_ALL)),
      discovered: doc.discovered,
      caught: this.caughtToday(tokenId, now),
      questsDone: Object.values(doc.quests).filter((s) => s.turnedIn).length,
      questsTotal: ALL_QUESTS.length,
      mainDone: STORY.filter((q) => doc.quests[q.id]?.turnedIn).map((q) => q.id),
      dungeons: this.dungeonViews(tokenId),
      flags: Object.keys(doc.flags),
      album: this.albumView(tokenId),
      run: doc.run
        ? {
            area: doc.area?.name ?? '',
            at: doc.run.at,
            cleared: doc.run.cleared.length,
            hp: doc.run.hp,
            maxHp: doc.run.maxHp,
            wav: doc.run.wav,
            xp: doc.run.xp,
            done: doc.run.done,
            failed: doc.run.failed,
          }
        : null,
      shops: this.shops(tokenId, sector, volumeMon, now),
      sellPrices: Object.fromEntries(
        [...new Set(chips)].filter((id) => CHIP_BY_ID.has(id)).map((id) => [id, sellPrice(chipOf(id))]),
      ),
      categoryPrizes: Object.fromEntries(
        albumStat([]).categories.map((c) => [c.category, categoryPrize(c.category)]),
      ),
      rarest,
      signatureIds,
      folder: this.folderView(tokenId, build),
      library: this.libraryView(tokenId),
    };
  }

  /** War points for one clear, so the caller does not have to know the table. */
  warPoints(args: { tier: string; scale: number; hotSector: SectorId; sector: SectorId; volumeMon: number }): number {
    return Math.round(
      pointsForClear(args.tier, args.scale) * sectorMultiplier(args.hotSector, args.sector, args.volumeMon),
    );
  }
}

/** The city is the only sector: bounties, boards and the war all live in it. */
const SECTORS_ALL: SectorId[] = ['ashflat'];

function refreshLabel(now: number): string {
  const left = SHELF_MS - (now % SHELF_MS);
  return `${Math.floor(left / 3_600_000)}h ${Math.floor((left % 3_600_000) / 60_000)}m`;
}

/** What changed between two levels, in the words a level-up banner uses. */
const unlockNamesBetween = gatesBetween;
