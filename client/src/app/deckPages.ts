import './pages.css';
import { GATES, anyChip, canAdd, checkFolder, type Chip, type ProfileView } from '@chog/shared';
import { ELEMENT_COLOUR, ELEMENT_ICON } from './hud/icons.ts';

/**
 * The two pages that make the cards matter: the FOLDER, where the deck a Chog fights with is
 * built from everything it owns, and the LIBRARY, the fusion book.
 *
 * Both are renderers plus a little local state. The rules come from `shared/src/folder.ts`
 * (the same functions the server refuses a bad folder with, so a button is disabled for the
 * very reason the server would give); nothing here decides what a card does.
 */

const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export interface FolderApi {
  save(cards: string[]): void;
  auto(): void;
  reset(): void;
  /** Ask the menu to paint the page again. */
  repaint(): void;
}

// ---------------------------------------------------------------------------
// The folder being edited lives here, not in the profile: a player may change it a dozen times
// before saving, and the profile is pushed (and the page repainted) every few seconds.
// ---------------------------------------------------------------------------

let draft: string[] | null = null;
let basedOn = '';
/** The folder card picked to be swapped out when the folder is full. */
let selected: string | null = null;
let notice = '';

function sync(p: ProfileView): string[] {
  const key = p.folder.cards.join(',');
  if (draft === null || basedOn !== key) {
    draft = [...p.folder.cards];
    basedOn = key;
    selected = null;
    notice = '';
  }
  return draft;
}

const KLASS: Record<string, string> = { S: '', M: 'MEGA', G: 'GIGA', F: 'FUSED' };
const klassOf = (c: Chip): string => (c.id.startsWith('ga_') ? 'F' : (c.klass ?? 'S'));

const order = (a: Chip, b: Chip): number =>
  a.element.localeCompare(b.element) || b.power * b.hits - a.power * a.hits || a.name.localeCompare(b.name);

function counts(ids: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/** A slot the level ladder bought rather than the Chog being born with: shown, so the cap is not a mystery. */
function licence(n: number): string {
  return n > 0 ? `<b class="lic">+${n}</b>` : '';
}

/**
 * The next rung of the ladder that buys one more slot of this class, read out of the same GATES
 * table the server hands licences from.
 *
 * It goes on the strip rather than in a tooltip because a phone has no hover, and because the
 * question behind a full Mega row is never "why is this full" — it is "when do I get another".
 */
function nextLicence(word: string, level: number): string {
  const g = GATES.find((x) => x.kind === 'build' && x.label.includes(word) && x.at > level);
  return g ? `<i class="next">licence LV ${g.at}</i>` : '';
}

function row(c: Chip, extra: { n?: number; sig?: boolean; sel?: boolean; btn: string; why?: string; dim?: boolean }): string {
  const col = ELEMENT_COLOUR[c.element] ?? 'var(--violet)';
  const k = klassOf(c);
  return `<div class="fdr ${extra.sel ? 'sel' : ''} ${extra.dim ? 'dim' : ''}" data-id="${esc(c.id)}" style="--c:${col}" title="${esc(c.name)} — ${esc(c.effect)}${extra.why ? ` · ${esc(extra.why)}` : ''}">
    <span class="el">${ELEMENT_ICON[c.element] ?? ''}</span>
    <span class="nm">${extra.sig ? '<i class="sig" title="your Chog\'s signature card">◆</i>' : ''}${esc(c.name)}</span>
    <span class="st"><b>${c.power}</b>×${c.hits}</span>
    <span class="kl">${KLASS[k] ?? ''}</span>
    <span class="n">${extra.n && extra.n > 1 ? `×${extra.n}` : ''}</span>
    ${extra.btn}
  </div>`;
}

export function renderFolder(p: ProfileView): string {
  const d = sync(p);
  const rules = p.folder.rules;
  const pool = new Set(p.folder.pool);
  const check = checkFolder(rules, d, pool);
  const have = counts(d);
  const dirty = d.join(',') !== p.folder.cards.join(',');
  const full = d.length >= rules.size;

  // the deck: one row per distinct card, with how many copies
  const deckRows = [...have.keys()]
    .map((id) => anyChip(id))
    .filter((c): c is Chip => !!c)
    .sort(order)
    .map((c) => {
      const sig = c.id === rules.signature;
      return row(c, {
        n: have.get(c.id) ?? 0,
        sig,
        sel: selected === c.id,
        btn: `<button class="rm" data-rm="${esc(c.id)}" ${sig && (have.get(c.id) ?? 0) <= 1 ? 'disabled' : ''} title="${sig && (have.get(c.id) ?? 0) <= 1 ? 'the signature card stays' : 'take one out'}">−</button>`,
      });
    })
    .join('');

  // the collection: everything the Chog may field, with what stops one more going in
  const poolRows = p.folder.pool
    .map((id) => anyChip(id))
    .filter((c): c is Chip => !!c)
    .sort(order)
    .map((c) => {
      const inDeck = have.get(c.id) ?? 0;
      // Judge the add as if the selected card were already out, so a swap is never refused for being full.
      const base = full && selected ? removeOne(d, selected) : d;
      const fits = base.length < rules.size && canAdd(rules, base, c.id, pool);
      const why = base.length >= rules.size ? 'the folder is full — pick a card in it to swap out' : fits ? '' : whyNot(rules, base, c, inDeck);
      return row(c, {
        n: inDeck,
        sig: c.id === rules.signature,
        dim: !fits,
        why,
        btn: `<button class="add" data-add="${esc(c.id)}" ${fits ? '' : 'disabled'} title="${esc(why || 'put one in the folder')}">+</button>`,
      });
    })
    .join('');

  const errs = check.errors.filter((e) => !e.startsWith('a folder holds exactly'));
  const status = check.ok
    ? dirty
      ? '<span class="warn">● unsaved changes</span>'
      : '<span class="ok">✓ saved — the next fight deals from this</span>'
    : `<span class="bad">${esc(errs[0] ?? `${d.length}/${rules.size} cards — ${d.length < rules.size ? 'add ' + (rules.size - d.length) + ' more' : 'remove ' + (d.length - rules.size)}`)}</span>`;

  return `<div class="fold2">
    <section class="fd-col">
      <header>FOLDER <b class="${d.length === rules.size ? 'ok' : 'bad'}">${d.length}/${rules.size}</b>
        <small>${full ? 'tap a card here, then<span class="only-keys"> + on the right</span><span class="only-touch"> + in the collection</span> to swap' : 'six are dealt to you at a time'}</small></header>
      <div class="fd-list">${deckRows || '<div class="idle">empty — press AUTO</div>'}</div>
    </section>
    <section class="fd-col">
      <header>COLLECTION <b>${p.folder.pool.length}</b><small>born cards, loot, shop buys, fusions</small></header>
      <div class="fd-list">${poolRows}</div>
    </section>
    <footer>
      <div class="fd-rules">
        <span title="copies of one card">copies ≤ ${rules.copies}</span>
        <span title="Mega cards${rules.licence.mega ? ` — ${rules.licence.mega} slot${rules.licence.mega > 1 ? 's' : ''} bought with levels` : ''}">mega ${check.mega}/${rules.megaCap}${licence(rules.licence.mega)}${nextLicence('Mega', p.level)}</span>
        <span title="Giga cards${rules.licence.giga ? ` — ${rules.licence.giga} slot bought with levels` : ''}">giga ${check.giga}/${rules.gigaCap}${licence(rules.licence.giga)}${nextLicence('Giga', p.level)}</span>
        <span title="fused cards${rules.licence.fused ? ` — ${rules.licence.fused} slot bought with levels` : ''}">fused ${check.fused}/${rules.fusedCap}${licence(rules.licence.fused)}${nextLicence('Fusion', p.level)}</span>
        <span class="ban" title="this Chog cannot field its own weakness">no ${ELEMENT_ICON[rules.banned] ?? ''} ${esc(rules.banned)}</span>
      </div>
      <div class="fd-msg">${notice ? `<span class="warn">${esc(notice)}</span>` : status}</div>
      <div class="fd-btns">
        <button data-act="auto" title="fill the folder with your strongest cards">AUTO</button>
        <button data-act="reset" title="back to the folder this Chog was born with">BORN</button>
        <button class="save" data-act="save" ${check.ok && dirty ? '' : 'disabled'}>SAVE</button>
      </div>
    </footer>
  </div>`;
}

function removeOne(list: readonly string[], id: string): string[] {
  const i = list.indexOf(id);
  return i < 0 ? [...list] : [...list.slice(0, i), ...list.slice(i + 1)];
}

/** Why one more copy of a card would not fit, in the words the folder rules use. */
function whyNot(rules: ProfileView['folder']['rules'], list: readonly string[], c: Chip, inDeck: number): string {
  const k = klassOf(c);
  if (c.id !== rules.signature && c.element === rules.banned) return `your Chog cannot field ${rules.banned}`;
  const limit = k === 'F' ? 1 : rules.copies;
  if (inDeck >= limit) return `at most ${limit} cop${limit === 1 ? 'y' : 'ies'} of one card`;
  if (k === 'M') return `Mega cards are capped at ${rules.megaCap}`;
  if (k === 'G') return `Giga cards are capped at ${rules.gigaCap}`;
  if (k === 'F') return `fused cards are capped at ${rules.fusedCap}`;
  void list;
  return 'not allowed';
}

export function bindFolder(el: HTMLElement, p: ProfileView, api: FolderApi): void {
  const d = sync(p);
  const rules = p.folder.rules;
  const pool = new Set(p.folder.pool);
  el.querySelectorAll<HTMLElement>('[data-add]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.dataset.add!;
      const full = d.length >= rules.size;
      if (full && !selected) {
        notice = 'the folder is full — click a card in it to swap that one out';
        return api.repaint();
      }
      if (full && selected) {
        const i = d.indexOf(selected);
        if (i >= 0) d.splice(i, 1);
        selected = null;
      }
      if (!canAdd(rules, d, id, pool)) {
        notice = 'that card does not fit the folder rules';
        return api.repaint();
      }
      d.push(id);
      notice = '';
      api.repaint();
    }),
  );
  el.querySelectorAll<HTMLElement>('[data-rm]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = d.indexOf(b.dataset.rm!);
      if (i >= 0) d.splice(i, 1);
      if (selected && !d.includes(selected)) selected = null;
      notice = '';
      api.repaint();
    }),
  );
  // a folder row is picked to be swapped for something from the collection
  el.querySelectorAll<HTMLElement>('.fd-col:first-child .fdr').forEach((r) =>
    r.addEventListener('click', () => {
      selected = selected === r.dataset.id ? null : r.dataset.id!;
      notice = '';
      api.repaint();
    }),
  );
  el.querySelector('[data-act="save"]')?.addEventListener('click', () => {
    notice = 'saving…';
    api.save([...d]);
    api.repaint();
  });
  el.querySelector('[data-act="auto"]')?.addEventListener('click', () => {
    draft = null;
    api.auto();
  });
  el.querySelector('[data-act="reset"]')?.addEventListener('click', () => {
    draft = null;
    api.reset();
  });
}

// ---------------------------------------------------------------------------
// The Library: the fusion book
// ---------------------------------------------------------------------------

export function renderLibrary(p: ProfileView): string {
  const lib = p.library;
  const name = (id: string): string => anyChip(id)?.name ?? id;
  const rows = lib.recipes
    .map((r) => {
      if (!r.known) {
        return `<div class="lbr unknown"><span class="q">?</span><div><b>unknown fusion</b><small>${esc(r.hint)}</small></div></div>`;
      }
      return `<div class="lbr"><span class="q">★</span><div><b>${esc(r.name ?? '???')}</b>
        <small>${(r.needs ?? []).map((id) => esc(name(id))).join(' + ')} <i>→</i> ${esc(name(r.result ?? ''))}</small></div></div>`;
    })
    .join('');
  return `<div class="lib">
    <header><span>FUSION LIBRARY</span><b>${lib.discovered}/${lib.total}</b></header>
    <p class="lead">Pick three cards in a line on the Custom Screen. When they spell a recipe they collapse into one stronger card — and it joins your collection for good. Recipes stay hidden until you fire them; each shows only a hint.</p>
    <div class="lib-list">${rows || '<div class="idle">no recipes yet</div>'}</div>
  </div>`;
}
