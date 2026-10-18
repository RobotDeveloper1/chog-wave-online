import { CARDS, GA_BY_ID, card } from './cards.ts';
import type { Element } from './types.ts';

/**
 * Fusion and the Library.
 *
 * Three cards that belong together collapse into one named heavy card at the
 * moment you queue them — not in a crafting menu somewhere else. That is the
 * whole reason it feels good: the discovery happens inside the decision you are
 * already making, under the charge clock.
 *
 * The Library is the reason to come back. A recipe you have never fired is
 * invisible, so a deck can hold the exact three cards that make something and
 * you will not know until you try. Firing it for the first time teaches your
 * Chog permanently: the fused card joins your deck and you can then run it
 * without the triple. The DS original tracked a library and paid nothing for it.
 * Here the payout is the card itself, which is also the power curve.
 */

export interface Recipe {
  id: string;
  name: string;
  /** Exactly these three cards, in any order, any number of copies. */
  needs: readonly [string, string, string];
  result: string;
  /** How the player is meant to find it without a guide. */
  hint: string;
}

// The heavy cards fusion produces (GA_CARDS) are defined in cards.ts so `card()` can read them.

const byElement = (e: Element) => CARDS.filter((c) => c.element === e).map((c) => c.id);

/**
 * Every element has one obvious triple: its own three cards. Those are the
 * recipes a player finds on their own in an evening. The named cross-element ones
 * below are the ones they trade for.
 */
const ELEMENT_TRIPLES: Recipe[] = (['burn', 'frost', 'volt', 'wave', 'prism', 'void'] as Element[]).map(
  (e) => ({
    id: `triple_${e}`,
    name: `${e} triad`,
    needs: [byElement(e)[0]!, byElement(e)[1]!, byElement(e)[2]!] as [string, string, string],
    result: {
      burn: 'ga_cinderfall',
      frost: 'ga_hollowwinter',
      volt: 'ga_arccathedral',
      wave: 'ga_drownedbell',
      prism: 'ga_prismchoir',
      void: 'ga_quietdeath',
    }[e],
    hint: `run all three ${e} cards in one queue`,
  }),
);

const NAMED_TRIPLES: Recipe[] = [
  {
    id: 'staticbloom',
    name: 'Static Bloom',
    needs: ['staticnip', 'rimeclaw', 'refract'],
    result: 'ga_staticbloom',
    hint: 'something that bites, something that stills, something that bends',
  },
  {
    id: 'lasttrain',
    name: 'Last Train',
    needs: ['undertow', 'ripplebite', 'tsunamichog'],
    result: 'ga_lasttrain',
    hint: 'the whole tide in one line',
  },
  {
    id: 'moltenmirror',
    name: 'Molten Mirror',
    needs: ['emberpaw', 'magmachog', 'spectrum'],
    result: 'ga_moltenmirror',
    hint: 'start a fire, then look into it',
  },
];

export const RECIPES: readonly Recipe[] = [...ELEMENT_TRIPLES, ...NAMED_TRIPLES];

export const RECIPE_BY_RESULT: ReadonlyMap<string, Recipe> = new Map(RECIPES.map((r) => [r.result, r]));

/**
 * A recipe matches when its three cards are all present in the queue. Copies
 * count: two Emberpaws and a Cinder Fang is not an Emberpaw triad.
 */
export function findRecipe(queueCardIds: readonly string[]): Recipe | null {
  const counts = new Map<string, number>();
  for (const id of queueCardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const r of RECIPES) {
    const needed = new Map<string, number>();
    for (const id of r.needs) needed.set(id, (needed.get(id) ?? 0) + 1);
    let ok = true;
    for (const [id, n] of needed) if ((counts.get(id) ?? 0) < n) ok = false;
    if (ok) return r;
  }
  return null;
}

export interface Library {
  /** Recipe ids this Chog has fired at least once. Travels with the token. */
  discovered: string[];
}

export const emptyLibrary = (): Library => ({ discovered: [] });

export interface FusionOutcome {
  library: Library;
  /** Cards to add to the deck because they were newly discovered. */
  granted: string[];
  fired: Recipe | null;
}

/**
 * Resolve one turn's queue. Merging is one-per-turn by rule, so a queue holding
 * two recipes only teaches you one of them — which is what keeps a good draw
 * feeling like a choice rather than a windfall.
 */
export function resolveTurn(library: Library, queueCardIds: readonly string[]): FusionOutcome {
  const fired = findRecipe(queueCardIds);
  if (!fired) return { library, granted: [], fired: null };
  if (library.discovered.includes(fired.id)) {
    return { library, granted: [], fired };
  }
  return {
    library: { discovered: [...library.discovered, fired.id] },
    granted: [fired.result],
    fired,
  };
}

/** Progress text for the bottom screen. Unfired recipes stay unnamed on purpose. */
export function libraryLine(library: Library): string {
  const known = library.discovered.length;
  return `${known}/${RECIPES.length} fusions known · ${RECIPES.length - known} undiscovered`;
}

export function describeRecipe(r: Recipe): string {
  return `${r.needs.map((id) => card(id).name).join(' + ')} = ${GA_BY_ID.get(r.result)?.name ?? '?'}`;
}
