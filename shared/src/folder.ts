import { CHIPS, anyChip } from './chips.ts';
import type { FolderLicence } from './progress.ts';
import { folderShape } from './traits.ts';
import type { ChogBuild, Chip, Element } from './types.ts';

/**
 * The Folder: the deck a Chog fights with.
 *
 * Until this existed the fight drew from `build.library` — the cards a token was *born*
 * with — and everything the player bought, won or fused went into a bag that no fight could
 * see. That made the whole economy decorative: a better card changed nothing. The folder is
 * the missing joint. The NFT still decides the *shape* of it (how many cards, how many
 * copies of one, how many Mega and Giga, which element it may never field), so a rare token
 * has a bigger, heavier folder and a flipped one cannot be out-built by money alone; the
 * player decides what goes in it, from what they have earned.
 *
 * Pure, so the server can refuse a folder the rules do not allow and the client can show
 * why before it asks.
 */

export interface FolderRules {
  /** Exactly this many cards. */
  size: number;
  /** Most copies of any one card (fused cards are singletons; Mega and Giga also share a total cap). */
  copies: number;
  /** Total Mega cards, copies included. */
  megaCap: number;
  /** Total Giga cards, copies included. */
  gigaCap: number;
  /** Total fused (GA) cards. They are earned, so they get their own allowance. */
  fusedCap: number;
  /** An element this Chog may not field: its own weakness. */
  banned: Element;
  /** The born card. It is always in the folder and does not count against a cap. */
  signature: string;
  /** How much of each cap above is a licence bought with levels rather than the Chog's shape. */
  licence: FolderLicence;
}

/** A Chog with no licences: the born folder, exactly as its traits draw it. */
export const NO_LICENCE: FolderLicence = { mega: 0, giga: 0, fused: 0 };

/**
 * The caps are two numbers added together, and that is the whole joint between the NFT and
 * progression. `folderShape` and the loadout set the born half — a rare token really does field a
 * heavier folder, and no amount of grinding changes it — while `licence` is the half the level
 * ladder hands out, so a foster Chog can grow into its own attributes instead of being frozen at
 * whatever it was born able to hold. The folder's *size* never moves: a licence swaps a weak
 * common for a strong card, it does not lengthen the deck.
 */
export function folderRules(build: ChogBuild, licence: FolderLicence = NO_LICENCE): FolderRules {
  const shape = folderShape(build.loadout.profile);
  const giga = build.loadout.gigaCap + licence.giga;
  return {
    size: Math.max(12, build.folder.length),
    copies: shape.copies,
    megaCap: build.loadout.megaCap + licence.mega,
    gigaCap: giga,
    fusedCap: 1 + giga + licence.fused,
    banned: build.loadout.weakness,
    signature: build.signature,
    licence,
  };
}

type Klass = 'S' | 'M' | 'G' | 'F';
const classOf = (c: Chip): Klass => (c.id.startsWith('ga_') ? 'F' : (c.klass ?? 'S'));
/** Fused cards are earned one at a time; every other card is limited by the Body trait. */
const copyLimit = (rules: FolderRules, c: Chip): number => (classOf(c) === 'F' ? 1 : rules.copies);

/**
 * Every card this Chog could put in a folder: what it was born with, what it owns, and
 * nothing of the element it cannot hold. The signature is always allowed — it is the one
 * card nobody else can field, and its element is a feature, not a mistake.
 */
export function cardPool(build: ChogBuild, owned: readonly string[]): string[] {
  const banned = build.loadout.weakness;
  const out = new Set<string>();
  for (const id of [...build.library, ...owned]) {
    const c = anyChip(id);
    if (!c) continue;
    if (c.element === banned && id !== build.signature) continue;
    out.add(id);
  }
  return [...out];
}

/**
 * The card the Training Sim pays for its first clear: a common card of the Chog's own tribe
 * that it does not hold yet. The first thing a new player can do with a reward is put it in
 * the folder — which is exactly what the quest after the Sim asks for.
 */
export function starterCard(build: ChogBuild, owned: readonly string[]): string | null {
  const have = new Set([...build.library, ...owned]);
  const banned = build.loadout.weakness;
  const common = CHIPS.filter((c) => !c.klass && !have.has(c.id) && c.element !== banned);
  const own = common.find((c) => c.element === build.loadout.element);
  const best = [...common].sort((a, b) => b.power * b.hits - a.power * a.hits)[0];
  return (own ?? best)?.id ?? null;
}

/** The born folder, with the signature guaranteed (a cap can squeeze it out of the draw). */
export function defaultFolder(build: ChogBuild): string[] {
  const out = [...build.folder];
  if (!out.includes(build.signature) && out.length) out[out.length - 1] = build.signature;
  return out;
}

interface Tally {
  counts: Record<string, number>;
  mega: number;
  giga: number;
  fused: number;
}

function tally(rules: FolderRules, folder: readonly string[]): Tally {
  const t: Tally = { counts: {}, mega: 0, giga: 0, fused: 0 };
  for (const id of folder) {
    const c = anyChip(id);
    if (!c) continue;
    t.counts[id] = (t.counts[id] ?? 0) + 1;
    if (id === rules.signature) continue;
    const k = classOf(c);
    if (k === 'M') t.mega++;
    else if (k === 'G') t.giga++;
    else if (k === 'F') t.fused++;
  }
  return t;
}

/** Would one more copy of `id` break a rule other than the total size? */
export function canAdd(rules: FolderRules, folder: readonly string[], id: string, pool: ReadonlySet<string>): boolean {
  const c = anyChip(id);
  if (!c || !pool.has(id)) return false;
  if (c.element === rules.banned && id !== rules.signature) return false;
  const t = tally(rules, folder);
  // The signature is exempt from the class caps (a Giga born card fits a Chog whose cap is
  // zero) but not from the copy limit, which is what the Body trait sets.
  const limit = id === rules.signature ? rules.copies : copyLimit(rules, c);
  if ((t.counts[id] ?? 0) >= limit) return false;
  if (id === rules.signature) return true;
  const k = classOf(c);
  if (k === 'M' && t.mega >= rules.megaCap) return false;
  if (k === 'G' && t.giga >= rules.gigaCap) return false;
  if (k === 'F' && t.fused >= rules.fusedCap) return false;
  return true;
}

export interface FolderCheck {
  ok: boolean;
  errors: string[];
  size: number;
  mega: number;
  giga: number;
  fused: number;
  /** Copies of each card, for the editor to show. */
  counts: Record<string, number>;
}

export function checkFolder(rules: FolderRules, folder: readonly string[], pool: ReadonlySet<string>): FolderCheck {
  const errors: string[] = [];
  const t = tally(rules, folder);
  for (const id of folder) {
    const c = anyChip(id);
    if (!c) errors.push(`${id} is not a card`);
    else if (!pool.has(id)) errors.push(`${c.name} is not in your collection`);
  }
  if (folder.length !== rules.size) errors.push(`a folder holds exactly ${rules.size} cards (${folder.length})`);
  for (const [id, n] of Object.entries(t.counts)) {
    const c = anyChip(id)!;
    const limit = id === rules.signature ? rules.copies : copyLimit(rules, c);
    if (n > limit) errors.push(`${c.name}: at most ${limit} cop${limit === 1 ? 'y' : 'ies'}`);
    if (c.element === rules.banned && id !== rules.signature) errors.push(`${c.name}: your Chog cannot field ${rules.banned}`);
  }
  if (t.mega > rules.megaCap) errors.push(`too many Mega cards (${t.mega}/${rules.megaCap})`);
  if (t.giga > rules.gigaCap) errors.push(`too many Giga cards (${t.giga}/${rules.gigaCap})`);
  if (t.fused > rules.fusedCap) errors.push(`too many fused cards (${t.fused}/${rules.fusedCap})`);
  if (!folder.includes(rules.signature)) errors.push('the signature card must stay in the folder');
  return { ok: errors.length === 0, errors: [...new Set(errors)], size: folder.length, mega: t.mega, giga: t.giga, fused: t.fused, counts: t.counts };
}

/** How good a card is for a folder: raw output, with a nod to the Chog's own tribe. */
function worth(c: Chip, element: Element): number {
  const raw = c.power * Math.max(1, c.hits);
  return raw * (c.element === element ? 1.2 : 1) * (1 + Math.min(4, Math.max(0, c.waveDrain)) * 0.02);
}

/**
 * Fill `folder` up to the rules' size from `pool`, strongest first. Two passes: one or two
 * copies of every strong card (variety is what a six-card hand is made of), then top up
 * with copies of the best of them. A folder of one card repeated is legal and a bad idea.
 */
function fill(build: ChogBuild, rules: FolderRules, start: string[], pool: readonly string[]): string[] {
  const set = new Set(pool);
  const out = [...start];
  const cards = pool
    .map((id) => anyChip(id))
    .filter((c): c is Chip => !!c)
    .sort((a, b) => worth(b, build.loadout.element) - worth(a, build.loadout.element));
  for (const pass of [Math.min(2, rules.copies), rules.copies]) {
    for (const c of cards) {
      while (out.length < rules.size && out.filter((x) => x === c.id).length < pass && canAdd(rules, out, c.id, set)) out.push(c.id);
    }
  }
  return out;
}

/** The best folder the rules allow from this pool. */
export function autoFolder(build: ChogBuild, pool: readonly string[], licence?: FolderLicence): string[] {
  const rules = folderRules(build, licence);
  return fill(build, rules, [build.signature], pool);
}

/**
 * After a card is sold or a rule changes: keep every card of the player's own choice that is
 * still legal, in order, and top up the rest from the best of what they hold.
 */
export function repairFolder(build: ChogBuild, folder: readonly string[], pool: readonly string[], licence?: FolderLicence): string[] {
  const rules = folderRules(build, licence);
  const set = new Set(pool);
  const kept: string[] = [];
  const sequence = folder.includes(build.signature) ? [...folder] : [build.signature, ...folder];
  for (const id of sequence) {
    if (kept.length < rules.size && canAdd(rules, kept, id, set)) kept.push(id);
  }
  return fill(build, rules, kept, pool);
}

export interface FolderStats {
  avgPower: number;
  byElement: Record<string, number>;
  distinct: number;
}

export function folderStats(folder: readonly string[]): FolderStats {
  const byElement: Record<string, number> = {};
  let sum = 0;
  let n = 0;
  for (const id of folder) {
    const c = anyChip(id);
    if (!c) continue;
    byElement[c.element] = (byElement[c.element] ?? 0) + 1;
    sum += c.power * Math.max(1, c.hits);
    n++;
  }
  return { avgPower: n ? Math.round(sum / n) : 0, byElement, distinct: new Set(folder).size };
}
