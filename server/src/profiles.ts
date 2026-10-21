import {
  ALBUM_UNIVERSE,
  ALL_QUESTS,
  CARD_BY_ID,
  GA_BY_ID,
  ITEMS,
  QUESTS,
  RECIPES,
  STARTING_BAG,
  STARTING_CHOG,
  SF,
  advanceRun,
  albumRank,
  albumStat,
  anyCard,
  applyEvent,
  autoDeck,
  bountiesFor,
  buy as buyLine,
  canSell,
  cardPool,
  categoryPrize,
  checkDeck,
  card as cardOf,
  clearNode,
  emptyAlbum,
  emptyBag,
  emptyLibrary,
  FURNITURE,
  STARTER_FURNITURE,
  emptyHouse,
  furnitureLines,
  pickupItem as pickupFurniture,
  placeItem as placeFurniture,
  rotateItem as rotateFurniture,
  enterNode,
  deckLicenceAt,
  deckRules,
  EMPTY_LINE,
  ENCOUNTER_BY_ID,
  REGIONS,
  REGION_BY_ID,
  type EncounterDef,
  anomaliesGate,
  dungeonsGate,
  encounterGate,
  regionState,
  slotsFor,
  unlockedBy,
  type LineProgress,
  freshState,
  isCardId,
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
  padWithCopies,
  priceFactor,
  poiOf,
  progressOf,
  rarityWeight,
  refLevel,
  repairDeck,
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
  xpForLine,
  type AlbumState,
  type AreaRun,
  type Bag,
  type ChogBuild,
  type DataArea,
  type Element,
  type DungeonDef,
  type DungeonView,
  type HouseLayout,
  type DeckLicence,
  type DeckView,
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
  type RankRow,
  type RanksView,
  type QuestLineView,
  type QuestView,
  type RunView,
  type ShopView,
} from '@chog/shared';
import { normalizeKey, saveDisplayName, type SaveKeyInput, type SaveStore } from './save.ts';

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
  /** $CHOG ledger balance. Paper money until a vault deposit lands (see `chain.ts depositOf`). */
  chog: number;
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
  /** The deck the player chose, or null to fight with the one the token was born with. */
  deck: string[] | null;
  /** Which encounters of the Line this token has beaten, permanently. The whole card progression. */
  line: LineProgress;
  /** Fusions this Chog has fired. They travel with the token, like the Album. */
  library: Library;
  /** One-off marks the guide keeps: the welcome shown, a tip seen, the training sim cleared. */
  flags: Record<string, number>;
  /** The UTC day training pay was last counted, and how many clears it has paid since. */
  trainDay: number;
  trainPaid: number;
  /** Line cards dropped on the dirt but not yet picked up. The pile is their only other copy. */
  owedCards: string[];
  /** The room, furnished: what the house draws. */
  house: HouseLayout;
  /** Furniture owned by id. Placed pieces still count here; the floor is the difference. */
  furniture: Record<string, number>;
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
  chats: 0,
  sightings: 0,
  deaths: 0,
  bestProgram: 0,
  bestChain: 0,
  fusions: 0,
  trains: 0,
  waves: 0,
  dodges: 0,
  pvpWins: 0,
  pvpLosses: 0,
};

function blank(): ProfileDoc {
  return {
    xp: 0,
    line: EMPTY_LINE,
    bag: { wav: STARTING_BAG.wav, items: { ...STARTING_BAG.items } },
    chog: STARTING_CHOG,
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
    deck: null,
    library: emptyLibrary(),
    flags: {},
    trainDay: -1,
    trainPaid: 0,
    owedCards: [],
    house: emptyHouse(),
    furniture: { ...STARTER_FURNITURE },
  };
}

export const VAULT_KEY = 'vault';

/** A stable non-negative int from a save key, for the seeds that need a number. */
function keySeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
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
  cards: string[];
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
  private cache = new Map<string, ProfileDoc>();

  private readonly saves: SaveStore;

  constructor(saves: SaveStore) {
    this.saves = saves;
  }

  doc(id: SaveKeyInput): ProfileDoc {
    const saveKey = normalizeKey(id);
    const cached = this.cache.get(saveKey);
    if (cached) return cached;
    const merged = this.saves.readProgress(saveKey, blank());
    // Repair any half-written shape rather than trusting the blob. A missing `items`
    // would otherwise crash every later read for that token, permanently.
    if (!merged.bag || typeof merged.bag.wav !== 'number') merged.bag = emptyBag();
    if (!merged.bag.items) merged.bag.items = {};
    if (typeof merged.chog !== 'number') merged.chog = STARTING_CHOG;
    if (!merged.album) merged.album = emptyAlbum();
    if (!merged.quests) merged.quests = {};
    if (!Array.isArray(merged.discovered)) merged.discovered = [];
    if (!merged.waves || typeof merged.waves !== 'object') merged.waves = {};
    // A stat added after a token was saved reads as a missing number, which does arithmetic as NaN.
    merged.stats = { ...EMPTY_STATS, ...(merged.stats ?? {}) };
    if (merged.deck !== null && !Array.isArray(merged.deck)) merged.deck = null;
    if (!merged.library || !Array.isArray(merged.library.discovered)) merged.library = emptyLibrary();
    if (!merged.flags || typeof merged.flags !== 'object') merged.flags = {};
    if (!merged.line || !Array.isArray(merged.line.cleared)) merged.line = EMPTY_LINE;
    if (typeof merged.trainDay !== 'number') merged.trainDay = -1;
    if (typeof merged.trainPaid !== 'number') merged.trainPaid = 0;
    if (!Array.isArray(merged.owedCards)) merged.owedCards = [];
    if (!merged.house || !Array.isArray(merged.house.items)) merged.house = emptyHouse();
    if (!merged.furniture || typeof merged.furniture !== 'object') merged.furniture = { ...STARTER_FURNITURE };
    this.cache.set(saveKey, merged);
    return merged;
  }

  private persist(id: SaveKeyInput, doc: ProfileDoc): ProfileDoc {
    const saveKey = normalizeKey(id);
    this.saves.writeProgress(saveKey, doc);
    this.cache.set(saveKey, doc);
    return doc;
  }

  forget(id: SaveKeyInput): void {
    this.cache.delete(normalizeKey(id));
  }

  level(saveKey: SaveKeyInput): number {
    return progressOf(this.doc(saveKey).xp).level;
  }

  unlocks(saveKey: SaveKeyInput): Unlocks {
    return unlocksAt(this.level(saveKey));
  }

  /**
   * A brawl ends: the winner banks a win and the loser a loss. Refunds never reach
   * here — a field that fell apart is nobody’s record.
   */
  recordBrawl(saveKey: SaveKeyInput, won: boolean): void {
    const doc = this.doc(saveKey);
    if (won) doc.stats.pvpWins += 1;
    else doc.stats.pvpLosses += 1;
    this.persist(saveKey, doc);
  }

  /**
   * The four RANKS boards, read straight off every save on disk. The vault account
   * (token 0) is the team’s rake jar, not a player, so it never appears.
   */
  ranks(limit = 10): RanksView {
    const rows: RankRow[] = [];
    for (const { key: saveKey, progress } of this.saves.allProgress()) {
      if (saveKey === VAULT_KEY) continue;
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(progress) as Record<string, unknown>;
      } catch {
        continue;
      }
      const xp = typeof raw.xp === 'number' ? raw.xp : 0;
      const stats = (raw.stats ?? {}) as Partial<ProfileStats>;
      const cleared = (raw.line as { cleared?: unknown } | undefined)?.cleared;
      const ids = Array.isArray(cleared) ? cleared.filter((c): c is string => typeof c === 'string') : [];
      let furthest = 0;
      for (const id of ids) {
        const region = ENCOUNTER_BY_ID.get(id)?.region;
        const n = region ? (REGION_BY_ID.get(region)?.n ?? 0) : 0;
        if (n > furthest) furthest = n;
      }
      rows.push({
        key: saveKey,
        name: saveDisplayName(saveKey),
        level: progressOf(xp).level,
        xp,
        pvpWins: typeof stats.pvpWins === 'number' ? stats.pvpWins : 0,
        pvpLosses: typeof stats.pvpLosses === 'number' ? stats.pvpLosses : 0,
        chog: typeof raw.chog === 'number' ? raw.chog : STARTING_CHOG,
        lineCleared: ids.length,
        lineRegion: furthest ? (REGIONS.find((r) => r.n === furthest)?.name ?? '') : '',
      });
    }
    const byLevel = [...rows].sort((a, b) => b.level - a.level || b.xp - a.xp).slice(0, limit);
    const byPvp = rows
      .filter((r) => r.pvpWins + r.pvpLosses > 0)
      .sort((a, b) => b.pvpWins - a.pvpWins || a.pvpLosses - b.pvpLosses)
      .slice(0, limit);
    const byChog = [...rows].sort((a, b) => b.chog - a.chog).slice(0, limit);
    const byLine = [...rows].sort((a, b) => b.lineCleared - a.lineCleared).slice(0, limit);
    return { level: byLevel, pvp: byPvp, chog: byChog, line: byLine, you: '' };
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
    saveKey: SaveKeyInput,
    award: { xp?: number; wav?: number; cards?: string[]; items?: Partial<Record<ItemId, number>>; pinned?: boolean },
  ): GrantResult {
    const doc = this.doc(saveKey);
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
    const cards = (award.cards ?? []).filter((id) => isCardId(id));
    const paid = cards.length ? this.addCards(saveKey, cards, award.pinned) : { taken: [], refunded: [] };

    const after = progressOf(doc.xp).level;
    this.persist(saveKey, doc);
    return {
      xp,
      // The refund is already in the bag, so it is already in the number the reward line prints.
      wav: wav + paid.refunded.reduce((s, r) => s + r.wav, 0),
      cards: paid.taken,
      items,
      refunded: paid.refunded,
      level: after > before ? { from: before, to: after, unlocks: unlockNamesBetween(before, after) } : null,
    };
  }

  /** Hand cards to a player outside a reward grant (the Sim's first card). Returns the ones that fit. */
  giveCards(saveKey: SaveKeyInput, ids: string[]): string[] {
    const { taken } = this.addCards(saveKey, ids);
    if (taken.length) this.persist(saveKey, this.doc(saveKey));
    return taken;
  }

  /**
   * Cards on the dirt with no pile to their name anymore get remembered here: a restart
   * empties the drops map, and an encounter already marked cleared can never pay again,
   * so without this the cards would be gone for good. `take` un-owes them one by one.
   */
  oweCards(saveKey: SaveKeyInput, cards: string[]): void {
    if (!cards.length) return;
    const doc = this.doc(saveKey);
    doc.owedCards = [...doc.owedCards, ...cards.filter((c) => !doc.owedCards.includes(c))];
    this.persist(saveKey, doc);
  }

  /** A picked-up card stops being owed. */
  unoweCard(saveKey: SaveKeyInput, card: string): void {
    const doc = this.doc(saveKey);
    if (!doc.owedCards.includes(card)) return;
    doc.owedCards = doc.owedCards.filter((c) => c !== card);
    this.persist(saveKey, doc);
  }

  /** What the dirt still owes this token. */
  owedCardsOf(saveKey: SaveKeyInput): string[] {
    return [...this.doc(saveKey).owedCards];
  }

  /**
   * Move items between two bags in one pass. Both sides are checked before either
   * is written, so a short bag refuses the whole trade instead of half-paying it.
   * `fromGives` leaves `from`, `toGives` leaves `to`.
   */
  moveItems(from: SaveKeyInput, to: SaveKeyInput, fromGives: string[], toGives: string[]): boolean {
    const a = this.doc(from);
    const b = this.doc(to);
    const counts = (ids: string[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
      return m;
    };
    for (const [id, n] of counts(fromGives)) {
      if ((a.bag.items[id as ItemId] ?? 0) < n) return false;
    }
    for (const [id, n] of counts(toGives)) {
      if ((b.bag.items[id as ItemId] ?? 0) < n) return false;
    }
    for (const [id, n] of counts(fromGives)) {
      a.bag.items = { ...a.bag.items, [id]: (a.bag.items[id as ItemId] ?? 0) - n };
      b.bag.items = { ...b.bag.items, [id]: (b.bag.items[id as ItemId] ?? 0) + n };
    }
    for (const [id, n] of counts(toGives)) {
      b.bag.items = { ...b.bag.items, [id]: (b.bag.items[id as ItemId] ?? 0) - n };
      a.bag.items = { ...a.bag.items, [id]: (a.bag.items[id as ItemId] ?? 0) + n };
    }
    this.persist(from, a);
    this.persist(to, b);
    return true;
  }

  /** $CHOG a token holds. Never negative, never a fraction. */
  chogOf(saveKey: SaveKeyInput): number {
    return this.doc(saveKey).chog;
  }

  /**
   * Move $CHOG in or out of a token. A debit past zero refuses the whole move,
   * so a stake is either fully locked or not locked at all.
   */
  addChog(saveKey: SaveKeyInput, delta: number): boolean {
    const doc = this.doc(saveKey);
    const next = doc.chog + Math.round(delta);
    if (next < 0) return false;
    doc.chog = next;
    this.persist(saveKey, doc);
    return true;
  }

  /** What the team has raked from wagered brawls. */
  vaultChog(): number {
    return this.doc(VAULT_KEY).chog;
  }

  /**
   * Put cards in the bag and report what actually landed. Cards go through the save, because that
   * is where the collection is read from. The bag has a cap, but a fused card is *earned* — dropping
   * one because the bag is full would take a discovery away — so those always fit.
   *
   * `pinned` extends that to the Line. The Line pays **50 named cards** and the base bag holds
   * 32, so without this the last eighteen encounters of the world would silently convert their
   * reward into WAV and a player who finished the Line would be missing a fifth of it. A reward
   * the game printed on a fixed table cannot be subject to a bag size. The cap still does its real
   * job, which is limiting what a `pack` from the shop can add.
   *
   * What cannot land is bought back at the counter on the spot, at the same price a sell button
   * pays: a duplicate and a card dropped against a full bag both used to vanish in silence, which
   * made a late run's chests worth less than nothing.
   */
  private addCards(saveKey: SaveKeyInput, ids: string[], pinned = false): { taken: string[]; refunded: RefundLine[] } {
    const owned = this.saves.get(saveKey);
    const cap = this.unlocks(saveKey).bagCap;
    const have = new Set(owned.cards);
    const taken: string[] = [];
    const refunded: RefundLine[] = [];
    const next = [...owned.cards];
    for (const id of ids) {
      if (!isCardId(id)) continue;
      const fused = GA_BY_ID.has(id);
      const dead = have.has(id) || (!pinned && !fused && next.filter((c) => !GA_BY_ID.has(c)).length >= cap);
      if (!dead) {
        have.add(id);
        next.push(id);
        taken.push(id);
        continue;
      }
      const card = CARD_BY_ID.get(id);
      if (!card) continue;
      const wav = sellPrice(card);
      refunded.push({ id, name: card.name, wav });
    }
    if (taken.length) this.saves.setChips(saveKey, next);
    if (refunded.length) {
      const doc = this.doc(saveKey);
      doc.bag = { ...doc.bag, wav: doc.bag.wav + refunded.reduce((s, r) => s + r.wav, 0) };
      this.persist(saveKey, doc);
    }
    return { taken, refunded };
  }

  // ---------------------------------------------------------------------------
  // Battle-shaped events
  // ---------------------------------------------------------------------------

  /** Called when a boss drops. Returns the quest events the caller must still feed. */
  onClear(args: {
    saveKey: SaveKeyInput;
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
    const doc = this.doc(args.saveKey);
    const tier: 'ambient' | 'glitch' | 'anomaly' | 'storm' =
      args.tier === 'storm' ? 'storm' : args.tier === 'anomaly' ? 'anomaly' : args.tier === 'glitch' ? 'glitch' : 'ambient';
    const scale = args.scale > 0 ? args.scale : 1;
    const grant = this.grant(args.saveKey, {
      xp: xpForClear(tier, args.damage, scale),
      wav: wavForClear(tier, scale),
    });
    doc.stats.clears += 1;
    if (tier === 'storm') doc.stats.stormClears += 1;
    doc.stats.bestProgram = Math.max(doc.stats.bestProgram, Math.round(args.damage));
    this.persist(args.saveKey, doc);
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


  countFor(saveKey: SaveKeyInput, kind: keyof ProfileStats, amount = 1): void {
    const doc = this.doc(saveKey);
    doc.stats[kind] += amount;
    this.persist(saveKey, doc);
  }

  best(saveKey: SaveKeyInput, program: number, chain: number): void {
    const doc = this.doc(saveKey);
    doc.stats.bestProgram = Math.max(doc.stats.bestProgram, Math.round(program));
    doc.stats.bestChain = Math.max(doc.stats.bestChain, chain);
    this.persist(saveKey, doc);
  }

  consume(saveKey: SaveKeyInput, what: 'amp' | 'ward' | 'scanned'): boolean {
    const doc = this.doc(saveKey);
    if (!doc[what]) return false;
    doc[what] = false;
    this.persist(saveKey, doc);
    return true;
  }

  has(saveKey: SaveKeyInput, what: 'amp' | 'ward' | 'scanned'): boolean {
    return this.doc(saveKey)[what];
  }

  // ---------------------------------------------------------------------------
  // Quests
  // ---------------------------------------------------------------------------

  /**
   * Drop yesterday's contracts. Today's are *offered* at the board, not handed out: a
   * quest the player never chose to take is a line in a log they did not ask for.
   */
  ensureBounties(saveKey: SaveKeyInput, _sectors: SectorId[], now = Date.now()): QuestDef[] {
    const doc = this.doc(saveKey);
    doc.quests = sweepBounties(doc.quests, now);
    doc.bountyDay = Math.floor(now / 86_400_000);
    this.persist(saveKey, doc);
    return [];
  }

  /** Today's contract for a district, if this player has not taken it. */
  bountyOffer(saveKey: SaveKeyInput, sector: SectorId, now = Date.now()): QuestDef | null {
    const def = bountiesFor(now, SECTORS_ALL).find((q) => q.sector === sector);
    if (!def) return null;
    return this.doc(saveKey).quests[def.id] ? null : def;
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
  questEvents(saveKey: SaveKeyInput, evs: QuestEvent[]): string[] {
    if (!evs.length) return [];
    const doc = this.doc(saveKey);
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
    this.persist(saveKey, doc);
    return completed;
  }

  /** Take a quest from the person who gives it. */
  accept(saveKey: SaveKeyInput, questId: string, npcId: string, now = Date.now()): { ok: boolean; reason?: string; def?: QuestDef } {
    const doc = this.doc(saveKey);
    const def = this.questDef(questId, now);
    if (!def) return { ok: false, reason: 'no such quest' };
    if (def.giver !== npcId) return { ok: false, reason: 'they do not give that one' };
    if (doc.quests[def.id]) return { ok: false, reason: 'you already have it' };
    if (!def.bounty && !isOpen(def, doc.quests, this.level(saveKey))) return { ok: false, reason: 'not yet' };
    // A contract is only for the day it was posted.
    if (def.bounty && !def.id.startsWith(`bounty-${Math.floor(now / 86_400_000)}-`)) return { ok: false, reason: 'that contract expired' };
    const open = Object.values(doc.quests).filter((s) => !s.turnedIn).length;
    if (open >= 16) return { ok: false, reason: 'your log is full' };
    doc.quests[def.id] = freshState(def, def.bounty ? Math.floor(now / 86_400_000) : undefined);
    this.persist(saveKey, doc);
    return { ok: true, def };
  }

  turnIn(saveKey: SaveKeyInput, questId: string, npcId?: string): { ok: boolean; reason?: string; reward?: GrantResult; name?: string; def?: QuestDef } {
    const doc = this.doc(saveKey);
    const def = this.questDef(questId);
    if (!def) return { ok: false, reason: 'not on your board' };
    if (npcId && turnInOf(def) !== npcId) return { ok: false, reason: 'report that to someone else' };
    const result = turnInQuest(doc.quests, questId, def);
    if (!result.ok) return { ok: false, reason: result.reason };
    doc.quests = result.log;
    this.persist(saveKey, doc);
    const reward = this.grant(saveKey, { xp: result.xp, wav: result.wav, items: result.items, cards: result.cards });
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
  discover(saveKey: SaveKeyInput, poiId: string): { first: boolean; xp: number; name: string; text: string } | null {
    const hit = poiOf(poiId);
    if (!hit) return null;
    const doc = this.doc(saveKey);
    if (doc.discovered.includes(poiId)) return { first: false, xp: 0, name: hit.poi.name, text: hit.poi.text ?? '' };
    doc.discovered = [...doc.discovered, poiId];
    this.persist(saveKey, doc);
    const xp = hit.poi.kind === 'secret' ? 12 : 7;
    this.grant(saveKey, { xp });
    return { first: true, xp, name: hit.poi.name, text: hit.poi.text ?? '' };
  }

  /** Mystery Waves caught today, by wave id. */
  caughtToday(saveKey: SaveKeyInput, now = Date.now()): string[] {
    const day = Math.floor(now / 86_400_000);
    return Object.entries(this.doc(saveKey).waves)
      .filter(([, d]) => d === day)
      .map(([id]) => id);
  }

  collectWave(
    saveKey: SaveKeyInput,
    wave: { id: string; element: Element },
    ctx: { sector: SectorId; tribe: Element; heat: number },
    now = Date.now(),
  ): { ok: boolean; reason?: string; roll?: ReturnType<typeof rollWave> } {
    const doc = this.doc(saveKey);
    const day = Math.floor(now / 86_400_000);
    if (doc.waves[wave.id] === day) return { ok: false, reason: 'already caught today' };
    const roll = rollWave({ seed: normalizeKey(saveKey), id: wave.id, day, sector: ctx.sector, element: wave.element, tribe: ctx.tribe, heat: ctx.heat });
    // Keep only today's catches: the map must not grow with every day a token has played.
    doc.waves = Object.fromEntries(Object.entries(doc.waves).filter(([, d]) => d === day));
    doc.waves[wave.id] = day;
    this.persist(saveKey, doc);
    this.grant(saveKey, { xp: roll.xp, wav: roll.wav, items: roll.items });
    return { ok: true, roll };
  }

  /** The names a quest view shows, from the city plan, not from a string typed twice. */
  private nameOf(npcId: string): string {
    return npcOf(npcId)?.npc.name ?? npcId.toUpperCase();
  }

  /** What the person at `npcId` has for this player: hand-ins, offers and errands in progress. */
  talk(saveKey: SaveKeyInput, npcId: string, now = Date.now()): { ready: QuestDef[]; offers: QuestDef[]; pending: QuestDef[] } {
    const doc = this.doc(saveKey);
    const level = this.level(saveKey);
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

  shops(saveKey: SaveKeyInput, sector: SectorId, volumeMon: number, now = Date.now()): ProfileView['shops'] {
    const doc = this.doc(saveKey);
    const volume = { mon: volumeMon };
    return {
      factor: priceFactor(volume),
      cards: stockForChips(shelfSeed(now), volume, sector),
      supply: stockForSupply(shelfSeed(now), volume),
      furniture: furnitureLines(),
      refreshesIn: refreshLabel(now),
      wav: doc.bag.wav,
    };
  }

  /**
   * The line is regenerated from the server's own shelf seed and re-priced, so a
   * client quoting a friendly number is quoting a card that does not exist today.
   */
  buy(
    saveKey: SaveKeyInput,
    sector: SectorId,
    kind: 'card' | 'item' | 'furniture',
    stockId: string,
    volumeMon: number,
    now = Date.now(),
    born: readonly string[] = [],
  ): { ok: boolean; reason?: string; line?: ShopLine; grant?: GrantResult } {
    const doc = this.doc(saveKey);
    const volume = { mon: volumeMon };
    const lines = kind === 'card' ? stockForChips(shelfSeed(now), volume, sector) : kind === 'item' ? stockForSupply(shelfSeed(now), volume) : furnitureLines();
    const line = lines.find((l) => l.stockId === stockId);
    if (!line) return { ok: false, reason: 'not on the shelf today' };

    const owned = this.saves.get(saveKey).cards;
    // A collection is a set: a second copy of a card the player can already field is WAV for nothing.
    if (kind === 'card' && (owned.includes(stockId) || born.includes(stockId))) return { ok: false, reason: 'you can already field that card' };
    if (kind === 'card' && owned.filter((c) => !GA_BY_ID.has(c)).length >= this.unlocks(saveKey).bagCap) return { ok: false, reason: 'the bag is full — sell a card first' };
    const res = buyLine(line, doc.bag, owned);
    if (!res.ok) return { ok: false, reason: res.reason };
    doc.bag = res.bag;
    doc.stats.purchases += 1;
    this.persist(saveKey, doc);

    if (kind === 'item') {
      const grant = this.grant(saveKey, { items: { [stockId as ItemId]: 1 } });
      this.questEvents(saveKey, [{ type: 'buy' }]);
      return { ok: true, line, grant };
    }
    if (kind === 'furniture') {
      if (!FURNITURE[stockId]) return { ok: false, reason: 'no such furniture' };
      doc.furniture = { ...doc.furniture, [stockId]: (doc.furniture[stockId] ?? 0) + 1 };
      this.persist(saveKey, doc);
      this.questEvents(saveKey, [{ type: 'buy' }]);
      return { ok: true, line };
    }
    if (!CARD_BY_ID.has(stockId)) return { ok: false, reason: 'no such card' };
    this.addCards(saveKey, [stockId]);
    this.questEvents(saveKey, [{ type: 'buy' }]);
    return { ok: true, line };
  }

  sell(saveKey: SaveKeyInput, cardId: string, signatureIds: string[]): { ok: boolean; reason?: string; wav?: number } {
    const c = CARD_BY_ID.get(cardId);
    if (!c) return { ok: false, reason: 'no such card' };
    if (!canSell(c, signatureIds)) return { ok: false, reason: 'that card belongs to a Chog' };
    const save = this.saves.get(saveKey);
    const i = save.cards.indexOf(cardId);
    if (i < 0) return { ok: false, reason: 'you do not hold it' };
    const cards = save.cards.slice();
    cards.splice(i, 1);
    this.saves.setChips(saveKey, cards);
    const wav = sellPrice(c);
    const doc = this.doc(saveKey);
    doc.stats.sells += 1;
    this.persist(saveKey, doc);
    this.grant(saveKey, { wav });
    this.questEvents(saveKey, [{ type: 'sellCard' }]);
    return { ok: true, wav };
  }

  // ---------------------------------------------------------------------------
  // Housing
  // ---------------------------------------------------------------------------

  /** The room and the stock. Guests get the layout; only the owner gets the stock. */
  houseOf(saveKey: SaveKeyInput): { layout: HouseLayout; owned: Record<string, number> } {
    const doc = this.doc(saveKey);
    return { layout: doc.house, owned: { ...doc.furniture } };
  }

  /** Put a piece down. The model re-validates everything; this only files it. */
  housePlace(saveKey: SaveKeyInput, fid: string, x: number, z: number, rot: number, uid: string): { ok: boolean; reason?: string; layout?: HouseLayout } {
    const doc = this.doc(saveKey);
    const res = placeFurniture(doc.house, doc.furniture, fid, x, z, rot, uid);
    if (!res.ok || !res.house) return { ok: false, reason: res.reason };
    doc.house = res.house;
    this.persist(saveKey, doc);
    return { ok: true, layout: doc.house };
  }

  housePickup(saveKey: SaveKeyInput, uid: string): { ok: boolean; reason?: string; layout?: HouseLayout } {
    const doc = this.doc(saveKey);
    const res = pickupFurniture(doc.house, uid);
    if (!res.ok || !res.house) return { ok: false, reason: res.reason };
    doc.house = res.house;
    this.persist(saveKey, doc);
    return { ok: true, layout: doc.house };
  }

  houseRotate(saveKey: SaveKeyInput, uid: string): { ok: boolean; reason?: string; layout?: HouseLayout } {
    const doc = this.doc(saveKey);
    const res = rotateFurniture(doc.house, uid);
    if (!res.ok || !res.house) return { ok: false, reason: res.reason };
    doc.house = res.house;
    this.persist(saveKey, doc);
    return { ok: true, layout: doc.house };
  }

  /**
   * Items resolve to an instruction, not a mutation of the field. The world owns the
   * battle session, so only it can say what "restore 60 integrity" lands on.
   */
  use(
    saveKey: SaveKeyInput,
    id: ItemId,
  ): { ok: boolean; reason?: string; effect?: { heal?: number; amp?: boolean; ward?: boolean; scan?: boolean; cards?: string[]; refunded?: RefundLine[] } } {
    const doc = this.doc(saveKey);
    const def = ITEMS[id];
    if (!def) return { ok: false, reason: 'no such item' };
    if ((doc.bag.items[id] ?? 0) <= 0) return { ok: false, reason: 'none left' };

    const left = (doc.bag.items[id] ?? 1) - 1;
    doc.bag.items = { ...doc.bag.items };
    if (left > 0) doc.bag.items[id] = left;
    else delete doc.bag.items[id];

    let effect: { heal?: number; amp?: boolean; ward?: boolean; scan?: boolean; cards?: string[]; refunded?: RefundLine[] } = {};
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
        const commons = [...CARD_BY_ID.values()].filter((c) => !c.klass).map((c) => c.id);
        const picked = Array.from({ length: 3 }, () => commons[Math.floor(Math.random() * commons.length)]!);
        const { taken, refunded } = this.addCards(saveKey, picked);
        // Three commons from one bag is a roll with replacement, so a pack routinely repeats itself.
        // The copy that has nowhere to go is bought back rather than swallowed by the opening.
        effect = { cards: taken, refunded };
        break;
      }
    }
    this.persist(saveKey, doc);
    return { ok: true, effect };
  }

  // ---------------------------------------------------------------------------
  // Album
  // ---------------------------------------------------------------------------

  /** Fold a Chog's trait keys in. Returns what was new so the tape can announce it. */
  sight(
    saveKey: SaveKeyInput,
    keys: string[],
  ): { added: string[]; xp: number; best: string | null; completions: { category: string; card: string | null; wav: number }[] } {
    const doc = this.doc(saveKey);
    const res = sightInto(doc.album.seen, keys);
    if (!res.added.length) return { added: [], xp: 0, best: null, completions: [] };
    doc.album = { ...doc.album, seen: res.seen };
    doc.stats.sightings += res.added.length;
    this.persist(saveKey, doc);
    const grant = this.grant(saveKey, { xp: res.xp });
    this.questEvents(saveKey, [{ type: 'sighting', amount: res.added.length }]);

    const pending = pendingCompletions(doc.album);
    if (pending.length) {
      doc.album = markClaimed(doc.album, pending.map((p) => p.category));
      this.persist(saveKey, doc);
      for (const p of pending) this.grant(saveKey, { wav: p.wav, cards: p.card ? [p.card] : [] });
    }
    return { added: res.added, xp: grant.xp, best: res.best?.key ?? null, completions: pending };
  }

  albumView(saveKey: SaveKeyInput): ProfileView['album'] {
    const seen = this.doc(saveKey).album.seen;
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
  clearedDungeons(saveKey: SaveKeyInput): Set<string> {
    const flags = this.doc(saveKey).flags;
    return new Set(DUNGEONS.filter((d) => flags[dungeonFlag(d.id)]).map((d) => d.id));
  }

  /** Every dungeon and whether this player may go in, for the menu. */
  dungeonViews(saveKey: SaveKeyInput): DungeonView[] {
    const level = this.level(saveKey);
    const cleared = this.clearedDungeons(saveKey);
    return DUNGEONS.map((d) => ({ id: d.id, ...dungeonStatus(d, level, cleared) }));
  }

  /**
   * Go into a dungeon. The map is generated here and kept with the run, so a client cannot
   * name a node that does not exist in the graph this process built — and the door is the
   * level and the dungeon before it, checked here and not on the menu.
   */
  openDungeon(
    saveKey: SaveKeyInput,
    dungeonId: string,
    maxHp: number,
    now = Date.now(),
  ): { ok: boolean; reason?: string; area?: DataArea; run?: AreaRun } {
    const doc = this.doc(saveKey);
    const def = DUNGEON_BY_ID.get(dungeonId);
    if (!def) return { ok: false, reason: 'no such dungeon' };
    if (doc.run && !doc.run.done && !doc.run.failed) return { ok: false, reason: 'already inside a fold' };
    const door = dungeonStatus(def, this.level(saveKey), this.clearedDungeons(saveKey));
    if (door.state === 'locked') return { ok: false, reason: `${def.name} ${door.reason}` };
    const area = makeDungeon(def, Math.floor(now / 1000) + keySeed(normalizeKey(saveKey)) + def.n * 13);
    doc.area = area;
    doc.run = startRun(area, Math.max(1, maxHp), now);
    this.persist(saveKey, doc);
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
    saveKey: SaveKeyInput,
    host: DataArea,
    maxHp: number,
    now = Date.now(),
  ): { ok: boolean; reason?: string; area?: DataArea; run?: AreaRun } {
    const doc = this.doc(saveKey);
    if (doc.run && !doc.run.done && !doc.run.failed) return { ok: false, reason: 'already inside a fold' };
    const def = host.dungeonId ? DUNGEON_BY_ID.get(host.dungeonId) : undefined;
    if (!def) return { ok: false, reason: 'no such dungeon' };
    const door = dungeonStatus(def, this.level(saveKey), this.clearedDungeons(saveKey));
    if (door.state === 'locked') return { ok: false, reason: `${def.name} ${door.reason}` };
    const area = structuredClone(host);
    doc.area = area;
    doc.run = startRun(area, Math.max(1, maxHp), now);
    this.persist(saveKey, doc);
    return { ok: true, area, run: doc.run };
  }

  /**
   * Step forward. A chest or a relay resolves and pays on the step; a node with something standing
   * in it only moves, because the field decides when that thing is dead and `clearCurrent` is what
   * pays it.
   */
  stepArea(
    saveKey: SaveKeyInput,
    nodeId: string,
  ): { ok: boolean; reason?: string; run?: AreaRun; outcome?: NodeOutcome | null; sector?: SectorId; fights?: boolean; grant?: GrantResult; enemy?: ReturnType<Profiles['areaEnemy']> } {
    const doc = this.doc(saveKey);
    if (!doc.area || !doc.run) return { ok: false, reason: 'not inside a fold' };
    const target = nodeById(doc.area, nodeId);
    if (!target) return { ok: false, reason: 'no such node' };

    if (target.enemy) {
      const step = enterNode(doc.run, doc.area, nodeId);
      if (!step.ok) return { ok: false, reason: step.reason };
      doc.run = step.run;
      this.persist(saveKey, doc);
      return { ok: true, run: step.run, outcome: null, sector: doc.area.sector, fights: true, enemy: this.areaEnemy(saveKey) };
    }

    const res = advanceRun(doc.run, doc.area, nodeId);
    if (!res.ok) return { ok: false, reason: res.reason };
    doc.run = res.run;
    doc.stats.rooms += 1;
    this.persist(saveKey, doc);
    this.questEvents(saveKey, [{ type: 'dungeonRoom', sector: doc.area.sector, ...(doc.area.dungeonId ? { target: doc.area.dungeonId } : {}) }]);

    // A non-combat tile resolves on the step, so it pays on the step. The run's tally is a receipt of
    // what the fold has already handed over, not a purse that waits by the door for someone to come
    // back and open it — and a chest's card goes through the same counter as every other drop.
    const outcome = res.outcome;
    let grant: GrantResult | undefined;
    if (outcome && outcome.kind !== 'shrine') {
      grant = this.grant(saveKey, { xp: outcome.xp, wav: outcome.wav, cards: outcome.cards });
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
  armNode(saveKey: SaveKeyInput, nodeId: string): boolean {
    const doc = this.doc(saveKey);
    if (!doc.area || !doc.run) return false;
    if (doc.run.at !== nodeId || doc.run.cleared.includes(nodeId)) return false;
    doc.run = { ...doc.run, armed: nodeId };
    this.persist(saveKey, doc);
    return true;
  }

  /** Pay the node the run is standing on, called by the field the moment its boss dies. */
  clearCurrent(
    saveKey: SaveKeyInput,
    damageTaken = 0,
    scale = 1,
    build?: ChogBuild,
  ): { ok: boolean; reason?: string; run?: AreaRun; outcome?: NodeOutcome | null; grant?: GrantResult; cleared?: { def: DungeonDef; first: boolean; grant?: GrantResult } } {
    const doc = this.doc(saveKey);
    if (!doc.area || !doc.run) return { ok: false, reason: 'not inside a fold' };
    if (doc.run.armed !== doc.run.at) return { ok: false, reason: 'nothing has died under you yet' };
    const res = clearNode(doc.run, doc.area, damageTaken, Math.random(), scale);
    if (!res.ok || !res.outcome) return { ok: false, reason: res.reason ?? 'nothing to clear' };
    doc.run = res.run;
    doc.stats.rooms += 1;
    if (res.run.done) doc.stats.areas += 1;
    if (res.run.failed) doc.stats.deaths += 1;
    this.persist(saveKey, doc);

    const outcome = res.outcome;
    let room: GrantResult | undefined;
    if (outcome.kind !== 'shrine') {
      // One grant, one receipt: the card a tile drops goes in with the XP and WAV it pays, so a
      // duplicate is bought back by the counter in the same breath rather than vanishing off the map.
      room = this.grant(saveKey, { xp: outcome.xp, wav: outcome.wav, cards: outcome.cards });
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
        this.persist(saveKey, doc);
        // The numbers scale with the pull that closed the core; the card does not, because a
        // card is one card and a second copy of it is worth nothing to anyone.
        grant = this.grant(saveKey, {
          xp: Math.round(def.firstClear.xp * scale),
          wav: Math.round(def.firstClear.wav * scale),
          items: def.firstClear.items,
          // The map is the key, and this is the door it opens. A fold's hand is a fixed list, not a
          // roll: clear it and these cards are yours for good, so the CAREER ladder can name them
          // before you go in and the DECK can show the hand you have earned rather than the
          // library you might have rolled. A party scales the numbers; nobody scales a card, because
          // a second copy of one is worth nothing to anybody. The first clear also earns the
          // signature itself when it is still out there: the card that says who the Chog is.
          cards: [...def.unlocks, ...(build?.signature && !this.saves.get(saveKey).cards.includes(build.signature) ? [build.signature] : [])],
        });
      }
      cleared = { def, first, ...(grant ? { grant } : {}) };
    }
    this.questEvents(saveKey, [
      { type: 'dungeonRoom', sector: doc.area.sector, ...(dungeonId ? { target: dungeonId } : {}) },
      ...(res.run.done && !res.run.failed ? [{ type: 'dungeonClear' as const, sector: doc.area.sector, ...(dungeonId ? { target: dungeonId } : {}) }] : []),
    ]);
    return { ok: true, run: res.run, outcome, ...(room ? { grant: room } : {}), ...(cleared ? { cleared } : {}) };
  }

  /** The enemy a room should mirror while a player stands on a node. */
  areaEnemy(saveKey: SaveKeyInput): { id: string; areaId: string; name: string; hp: number; power: number; kind: string; tier: number; element: string; archetype: string; label: string; level: number; difficulty: number; band?: { lead: string; minions: string[] } } | null {
    const doc = this.doc(saveKey);
    if (!doc.area || !doc.run) return null;
    const node = nodeById(doc.area, doc.run.at);
    if (!node?.enemy) return null;
    // A room already cleared is empty ground — it must never read as "you still owe a clear",
    // or the step gate traps you standing on a node you just beat.
    if (doc.run.cleared.includes(doc.run.at)) return null;
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
  closeArea(saveKey: SaveKeyInput): { ok: boolean; cleared: boolean; wav: number } {
    const doc = this.doc(saveKey);
    const wav = doc.run?.wav ?? 0;
    const cleared = doc.run?.done ?? false;
    doc.run = null;
    doc.area = null;
    this.persist(saveKey, doc);
    return { ok: true, cleared, wav };
  }

  areaView(saveKey: SaveKeyInput): { area: DataArea | null; run: AreaRun | null; dungeons: DungeonView[]; level: number } {
    const doc = this.doc(saveKey);
    return { area: doc.area, run: doc.run, dungeons: this.dungeonViews(saveKey), level: this.level(saveKey) };
  }

  // ---------------------------------------------------------------------------
  // The deck and the Library
  // ---------------------------------------------------------------------------

  /** Cards this Chog could put in a deck right now: born, owned and fused. */
  pool(saveKey: SaveKeyInput, build: ChogBuild): string[] {
    return cardPool(build, this.saves.get(saveKey).cards);
  }

  /**
   * The deck licences this account's level has bought on top of the Chog's born shape. Caps are
   * born + licence, so every deck entry point has to read them from the same place — a deck
   * judged against the born caps alone would silently throw a Mega card out on a level-up.
   */
  licence(saveKey: SaveKeyInput): DeckLicence {
    return deckLicenceAt(this.level(saveKey));
  }

  /**
   * How big a deck this token's deck is allowed to be right now.
   *
   * This is the join between the Line and the deck: the world's progress decides the *size*,
   * the token still decides the shape (`copies`, the Mega and Giga caps, the banned element).
   * A Chog that has never left Camp Zero has two slots and one card in them, which is a legal
   * deck — `checkDeck` only refuses an over-full one.
   */
  slots(saveKey: SaveKeyInput): number {
    return slotsFor(this.doc(saveKey).line);
  }

  /** Every card the Line has handed this token, in the order it handed them over. */
  lineCards(saveKey: SaveKeyInput): string[] {
    return unlockedBy(this.doc(saveKey).line);
  }

  /**
   * Beat an encounter of the Line.
   *
   * Server-authoritative, like everything else here: the encounter has to exist, its region has
   * to be open, and a repeat pays nothing but the first clear does — once, permanently, in the
   * cards the encounter names. That fixed table is the whole reason the Line is a progression
   * and not a loot roll, so this is the one place those ids are turned into things you own.
   *
   * Every fresh clear also pays XP by kind (xpForLine): the cards build the deck, the XP
   * moves the bar on each walk instead of only at the warden.
   *
   * Returns what it paid rather than a boolean, because the UI has to be able to say which card
   * just landed, and a "no" has to say why.
   */
  lineCleared(
    saveKey: SaveKeyInput,
    encounterIds: readonly string[],
    build: ChogBuild,
    deferCards = false,
  ): { ok: boolean; reason?: string; cards?: string[]; xp?: number; wav?: number } {
    const doc = this.doc(saveKey);
    // Validate the whole message against a **snapshot**, then commit. Checking each id against
    // the live `doc` while the loop below is appending to it means the first id can open a gate
    // the second id then walks through — a single forged message listing all 42 encounters would
    // clear the whole Line. That is exactly the bug these tests were written to catch.
    const before = doc.line;
    const fresh: EncounterDef[] = [];
    for (const id of encounterIds) {
      const e = ENCOUNTER_BY_ID.get(id);
      if (!e) return { ok: false, reason: `no such encounter: ${id}` };
      if (before.cleared.includes(id)) continue; // a repeat pays nothing
      const gate = encounterGate(before, id);
      if (!gate.open) return { ok: false, reason: gate.reason };
      fresh.push(e);
    }
    if (!fresh.length) return { ok: false, reason: 'already cleared' };

    const cards: string[] = [];
    let xp = 0;
    let wav = 0;
    for (const e of fresh) {
      for (const card of e.unlocks) {
        if (!cards.includes(card) && !this.ownsCard(saveKey, card)) cards.push(card);
      }
      xp += xpForLine(e.kind);
      if (e.kind === 'warden') {
        const region = REGION_BY_ID.get(e.region)!;
        xp += region.firstClear.xp;
        wav += region.firstClear.wav;
      }
    }

    doc.line = { cleared: [...before.cleared, ...fresh.map((e) => e.id)] };
    // Deferred cards are marked cleared above but granted nowhere: they fall on the dirt as
    // piles and pay on pickup. Granting them here too would double-pay, and the take path
    // re-grants through `giveCards`, so the deck still repairs itself the moment they land.
    this.grant(saveKey, cards.length && !deferCards ? { cards: cards, xp, wav, pinned: true } : { xp, wav });

    // A new card has to be usable the moment it lands, so the deck is re-checked against the
    // size the Line has just grown and repaired in place rather than left illegal.
    this.deckDistinct(saveKey, build);
    return { ok: true, cards, xp, wav };
  }

  /** Does this token already hold the card, born cards included? */
  private ownsCard(saveKey: SaveKeyInput, id: string): boolean {
    return this.saves.get(saveKey).cards.includes(id) || this.doc(saveKey).library.discovered.includes(id);
  }

  /** Where this token stands on the Line, for the map screen. Never a client assertion. */
  lineView(saveKey: SaveKeyInput, mobs?: { id: string; encounterId: string; region: string; kind: string; name: string; element: string; archetype: string; tier: number; home: { x: number; z: number }; roam: number; x: number; z: number; facing: number; alive: boolean }[]): {
    regions: { id: string; name: string; n: number; state: 'done' | 'open' | 'sealed' }[];
    slots: number;
    cards: string[];
    dungeons: { open: boolean; reason: string };
    anomalies: { open: boolean; reason: string };
  } {
    const line = this.doc(saveKey).line;
    return {
      regions: REGIONS.map((r) => ({ id: r.id, name: r.name, n: r.n, state: regionState(line, r.id) })),
      slots: slotsFor(line),
      cards: unlockedBy(line),
      dungeons: dungeonsGate(line),
      anomalies: anomaliesGate(line),
      /** Where the bodies are and which of them are standing, so the client can draw exactly this. */
      ...(mobs ? { mobs } : {}),
    };
  }

  /**
   * The deck the next fight deals from: the distinct deck below, plus copies of the
   * best of it up to the size the Line paid for. The copies are transient - what is
   * persisted is the distinct deck only, so a gap filled by filler can never lock out
   * a card the player has not earned yet.
   */
  deckFor(saveKey: SaveKeyInput, build: ChogBuild): string[] {
    const distinct = this.deckDistinct(saveKey, build);
    return padWithCopies(build, distinct, this.pool(saveKey, build), this.licence(saveKey), this.slots(saveKey));
  }

  /**
   * The saved deck, repaired in place so a fight can never start from a deck the rules
   * would refuse. The player's own choice while it is still legal; if a card was sold or
   * a rule moved under it, it is repaired keeping the player's picks in order - the
   * player's own duplicates are curation and survive. Gaps are topped up with distinct
   * cards only, so a bought, drafted or dropped card joins the moment it lands and the
   * gaps stay open until one does. This is also what the editor shows: what is saved is
   * what was picked, never filler.
   */
  deckDistinct(saveKey: SaveKeyInput, build: ChogBuild): string[] {
    const slots = this.slots(saveKey);
    const doc = this.doc(saveKey);
    const pool = this.pool(saveKey, build);
    const licence = this.licence(saveKey);
    // No saved deck: the best of what is held, so a card is usable the moment it lands —
    // including the signature once the Line has handed it over. Empty hands stay empty.
    if (!doc.deck) return autoDeck(build, pool, licence, slots);
    const rules = deckRules(build, licence, slots);
    // A full legal deck is the player's own build and is left alone. A legal deck with
    // empty slots is topped up with distinct cards instead: a card bought, drafted or
    // dropped joins the deck the moment it lands rather than waiting for a manual
    // rebuild that nobody knows is needed. The gaps stay gaps until one does.
    if (checkDeck(rules, doc.deck, new Set(pool)).ok && doc.deck.length >= rules.size) return doc.deck;
    const fixed = repairDeck(build, doc.deck, pool, licence, slots);
    if (fixed.join('|') !== doc.deck.join('|')) {
      doc.deck = fixed;
      this.persist(saveKey, doc);
    }
    return doc.deck;
  }

  /** Save a deck the player built. Refused with the reasons if the rules do not allow it. */
  setDeck(saveKey: SaveKeyInput, build: ChogBuild, deck: string[]): { ok: boolean; errors?: string[] } {
    const pool = this.pool(saveKey, build);
    const check = checkDeck(deckRules(build, this.licence(saveKey), this.slots(saveKey)), deck, new Set(pool));
    if (!check.ok) return { ok: false, errors: check.errors };
    const doc = this.doc(saveKey);
    doc.deck = [...deck];
    this.persist(saveKey, doc);
    return { ok: true };
  }

  /** Rebuild the deck from the best of what the player holds. */
  autoDeck(saveKey: SaveKeyInput, build: ChogBuild): string[] {
    const doc = this.doc(saveKey);
    doc.deck = autoDeck(build, this.pool(saveKey, build), this.licence(saveKey), this.slots(saveKey));
    this.persist(saveKey, doc);
    return doc.deck;
  }

  /** Clear the saved deck back to the auto default. */
  resetDeck(saveKey: SaveKeyInput): void {
    const doc = this.doc(saveKey);
    doc.deck = null;
    this.persist(saveKey, doc);
  }

  /**
   * Take 1 of the 3 a combat node dealt. The options are server-dealt and the pick is
   * validated against them, so a client cannot name a card it was never offered — and a
   * duplicate is bought back by the counter through the normal grant path.
   */
  takeDraft(saveKey: SaveKeyInput, cardId: string): { ok: boolean; reason?: string; cards?: string[] } {
    const doc = this.doc(saveKey);
    const draft = doc.run?.draft ?? null;
    if (!doc.run || !draft) return { ok: false, reason: 'no draft waiting' };
    if (!draft.options.includes(cardId)) return { ok: false, reason: 'not one of the three' };
    const res = this.grant(saveKey, { cards: [cardId] });
    doc.run = { ...doc.run, draft: null };
    this.persist(saveKey, doc);
    return { ok: true, cards: res.cards };
  }

  /**
   * Thin the deck at a shrine rest: one held card leaves the collection, no payout.
   * The rest has to be waiting, the card has to be held, and a signature belongs to
   * its Chog — the same guard the counter honours, so the shrine cannot sell what
   * the shop would refuse to touch.
   */
  shrineRemove(saveKey: SaveKeyInput, cardId: string, signatureIds: string[]): { ok: boolean; reason?: string; removed?: string } {
    const doc = this.doc(saveKey);
    const rest = doc.run?.shrine ?? null;
    if (!doc.run || !rest) return { ok: false, reason: 'no rest waiting' };
    const c = CARD_BY_ID.get(cardId);
    if (!c) return { ok: false, reason: 'no such card' };
    if (!canSell(c, signatureIds)) return { ok: false, reason: 'that card belongs to a Chog' };
    const save = this.saves.get(saveKey);
    const i = save.cards.indexOf(cardId);
    if (i < 0) return { ok: false, reason: 'you do not hold it' };
    const cards = save.cards.slice();
    cards.splice(i, 1);
    this.saves.setChips(saveKey, cards);
    doc.run = { ...doc.run, shrine: null };
    this.persist(saveKey, doc);
    return { ok: true, removed: cardId };
  }

  deckView(saveKey: SaveKeyInput, build: ChogBuild): DeckView {
    const cards = this.deckDistinct(saveKey, build);
    const pool = this.pool(saveKey, build);
    const rules = deckRules(build, this.licence(saveKey), this.slots(saveKey));
    const check = checkDeck(rules, cards, new Set(pool));
    return {
      cards,
      rules,
      pool,
      check: { ok: check.ok, errors: check.errors, mega: check.mega, giga: check.giga, fused: check.fused },
      born: !this.doc(saveKey).deck,
    };
  }

  library(saveKey: SaveKeyInput): Library {
    return this.doc(saveKey).library;
  }

  /** What the Library may show: a recipe's hint always, its name and cards only once fired. */
  libraryView(saveKey: SaveKeyInput): ProfileView['library'] {
    const known = new Set(this.doc(saveKey).library.discovered);
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
  recordFusion(saveKey: SaveKeyInput, queueIds: string[]): { id: string; name: string; result: string; first: boolean } | null {
    const doc = this.doc(saveKey);
    const out = resolveTurn(doc.library, queueIds);
    if (!out.fired) return null;
    doc.stats.fusions += 1;
    if (out.granted.length) {
      doc.library = out.library;
      this.addCards(saveKey, out.granted);
    }
    this.persist(saveKey, doc);
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
  onTrain(saveKey: SaveKeyInput, now = Date.now()): { first: boolean; paid: boolean; grant: GrantResult; events: QuestEvent[] } {
    const doc = this.doc(saveKey);
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
      grant = this.grant(saveKey, { xp: 45, wav: 50, items: { med: 2 } });
    } else if (doc.trainPaid < SF.TRAIN_PAYS_PER_DAY) {
      doc.trainPaid += 1;
      paid = true;
      grant = this.grant(saveKey, { xp: 6, wav: 8 });
    } else {
      grant = this.grant(saveKey, {});
    }
    this.persist(saveKey, doc);
    return { first, paid, grant, events: [{ type: 'train' }] };
  }

  /** The guide's one-off marks: has this player been shown that yet? */
  flag(saveKey: SaveKeyInput, key: string): boolean {
    return !!this.doc(saveKey).flags[key];
  }

  setFlag(saveKey: SaveKeyInput, key: string, now = Date.now()): boolean {
    const doc = this.doc(saveKey);
    if (doc.flags[key]) return false;
    doc.flags[key] = now;
    this.persist(saveKey, doc);
    return true;
  }

  // ---------------------------------------------------------------------------
  // The one view the client renders
  // ---------------------------------------------------------------------------

  view(saveKey: SaveKeyInput, sector: SectorId, volumeMon: number, build: ChogBuild, displayId: number, now = Date.now()): ProfileView {
    const doc = this.doc(saveKey);
    const signatureIds = [build.signature];
    const cards = this.saves.get(saveKey).cards;
    const prog = progressOf(doc.xp);
    const u = unlocksAt(prog.level);
    const active = this.defsOf(doc.quests, now).filter((q) => doc.quests[q.id] && !doc.quests[q.id]!.turnedIn);
    const rarest = doc.album.seen
      .map((key) => ({ key, weight: rarityWeight(ALBUM_UNIVERSE[key.slice(0, key.indexOf(':'))]?.[key.slice(key.indexOf(':') + 1)] ?? 0) }))
      .sort((a, b) => b.weight - a.weight)[0] ?? null;

    return {
      tokenId: displayId,
      xp: doc.xp,
      level: prog.level,
      into: prog.into,
      need: prog.need,
      pct: prog.pct,
      toCap: prog.toCap,
      unlocks: u,
      wav: doc.bag.wav,
      chog: doc.chog,
      items: doc.bag.items,
      cards,
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
      caught: this.caughtToday(saveKey, now),
      questsDone: Object.values(doc.quests).filter((s) => s.turnedIn).length,
      questsTotal: ALL_QUESTS.length,
      mainDone: STORY.filter((q) => doc.quests[q.id]?.turnedIn).map((q) => q.id),
      dungeons: this.dungeonViews(saveKey),
      flags: Object.keys(doc.flags),
      album: this.albumView(saveKey),
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
      shops: this.shops(saveKey, sector, volumeMon, now),
      sellPrices: Object.fromEntries(
        [...new Set(cards)].filter((id) => CARD_BY_ID.has(id)).map((id) => [id, sellPrice(cardOf(id))]),
      ),
      categoryPrizes: Object.fromEntries(
        albumStat([]).categories.map((c) => [c.category, categoryPrize(c.category)]),
      ),
      rarest,
      signatureIds,
      deck: this.deckView(saveKey, build),
      library: this.libraryView(saveKey),
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
