import { CARDS_ALL, ITEMS, card as cardOf, isTraitCard } from '@chog/shared';
import { cardImg } from './cardArt.ts';

/**
 * The trade composer: what you give, what you want, to anyone on the street.
 *
 * It is a door, not a promise — the server re-checks every id, both holdings and the
 * trait rule at accept time, so an offer built on stale holdings dies with a reason
 * instead of a dupe. Trait cards never appear here at all: the server would refuse
 * them, and a button that only ever refuses is not a button.
 */

const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export interface TradeDraft {
  giving: string[];
  wanting: string[];
  givingItems: string[];
  wantingItems: string[];
}

export interface TradeApi {
  send(to: string, draft: TradeDraft): void;
  note(text: string): void;
}

let el: HTMLElement | null = null;

export function tradeComposerOpen(): boolean {
  return el !== null;
}

export function closeTradeComposer(): void {
  if (el) {
    el.remove();
    el = null;
  }
}

const cardName = (id: string): string => {
  try {
    return cardOf(id).name;
  } catch {
    return id;
  }
};

const cardElement = (id: string): string => {
  try {
    return cardOf(id).element;
  } catch {
    return '';
  }
};

/** Card and item ids as one readable list. Names, not ids. */
export function tradeNames(cards: string[], items: string[]): string {
  return [...cards.map(cardName), ...items.map((i) => ITEMS[i as keyof typeof ITEMS]?.name ?? i)].join(', ') || 'nothing';
}

/** One line for the invite box, one for the log. Names, not ids. */
export function tradeLines(giving: string[], wanting: string[], givingItems: string[], wantingItems: string[]): { short: string; full: string } {
  const bits = (cards: string[], items: string[]): string[] => {
    const out: string[] = [];
    if (cards.length) out.push(`${cards.length} card${cards.length > 1 ? 's' : ''}`);
    if (items.length) out.push(`${items.length} item${items.length > 1 ? 's' : ''}`);
    return out;
  };
  const names = (cards: string[], items: string[]): string => tradeNames(cards, items);
  const give = bits(giving, givingItems).join(' + ') || 'nothing';
  const want = bits(wanting, wantingItems).join(' + ') || 'nothing';
  return {
    short: `offers ${give}, wants ${want}`,
    full: `offers ${names(giving, givingItems)} — wants ${names(wanting, wantingItems)}`,
  };
}

export function openTradeComposer(
  withId: string,
  name: string,
  held: string[],
  myItems: Partial<Record<string, number>>,
  api: TradeApi,
): void {
  closeTradeComposer();
  const owned = [...new Set(held)];
  const tradeable = (id: string): boolean => {
    try {
      return !isTraitCard(cardOf(id));
    } catch {
      return false;
    }
  };
  const giveCards = owned.filter(tradeable).sort((a, b) => cardName(a).localeCompare(cardName(b)));
  const wantCards = CARDS_ALL.filter((c) => !isTraitCard(c) && !owned.includes(c.id))
    .map((c) => c.id)
    .sort((a, b) => cardName(a).localeCompare(cardName(b)));
  const giveUnits: string[] = [];
  for (const [id, n] of Object.entries(myItems)) {
    for (let i = 0; i < (n ?? 0); i++) giveUnits.push(id);
  }
  // What you can ask for: every tradeable card you do not hold, plus two of each
  // supply line. The server refuses what they do not hold, with the reason why.
  const wantUnits: string[] = [];
  for (const id of Object.keys(ITEMS)) wantUnits.push(id, id);

  const cardRow = (group: string, id: string): string =>
    `<label class="td-row"><input type="checkbox" data-g="${group}" value="${esc(id)}">${cardImg(id, cardElement(id), 'td-art')}<span>${esc(cardName(id))}</span></label>`;
  const itemRow = (group: string, id: string): string =>
    `<label class="td-row"><input type="checkbox" data-g="${group}" value="${esc(id)}"><img class="td-art" src="/items/item-${esc(id)}.svg" alt=""><span>${esc(ITEMS[id as keyof typeof ITEMS]?.name ?? id)}</span></label>`;

  const panel = document.createElement('div');
  panel.id = 'trade-composer';
  panel.innerHTML = `
    <header><b>TRADE WITH ${esc(name)}</b><small>trait cards stay home · up to 6 of each</small></header>
    <div class="td-cols">
      <div class="td-col"><h3>YOU GIVE</h3><div class="td-list">
        ${giveCards.map((id) => cardRow('give', id)).join('') || '<div class="td-idle">no tradeable cards held</div>'}
        ${giveUnits.map((id) => itemRow('giveItems', id)).join('')}
      </div></div>
      <div class="td-col"><h3>YOU WANT</h3><div class="td-list">
        ${wantCards.map((id) => cardRow('want', id)).join('')}
        ${wantUnits.map((id) => itemRow('wantItems', id)).join('')}
      </div></div>
    </div>
    <footer><button data-t="send">SEND OFFER</button><button data-t="close">CLOSE</button></footer>`;
  panel.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.t === 'close') {
      closeTradeComposer();
      return;
    }
    const pick = (g: string): string[] =>
      [...panel.querySelectorAll<HTMLInputElement>(`input[data-g="${g}"]:checked`)].map((i) => i.value).slice(0, 6);
    const draft: TradeDraft = { giving: pick('give'), wanting: pick('want'), givingItems: pick('giveItems'), wantingItems: pick('wantItems') };
    if (!draft.giving.length && !draft.wanting.length && !draft.givingItems.length && !draft.wantingItems.length) {
      api.note('an empty offer trades nothing — tick something first');
      return;
    }
    api.send(withId, draft);
    closeTradeComposer();
  });
  document.body.appendChild(panel);
  el = panel;
}
