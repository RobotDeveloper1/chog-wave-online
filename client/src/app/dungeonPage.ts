import './pages.css';
import { CARD_BY_ID, DUNGEON_BY_ID, DUNGEONS, ITEMS, SECTOR_NAME, partyHpScale, partyRewardScale, type AreaRun, type DungeonDef, type DungeonView, type ProfileView, type SectorId, type SectorState } from '@chog/shared';
import { ELEMENT_COLOUR, ELEMENT_ICON } from './hud/icons.ts';
import { cardImg } from './cardArt.ts';
import { social } from './partyPage.ts';
import type { AreaView } from './sheet.ts';

/**
 * The DUNGEONS page: the six folds under the city, and the run you are in.
 *
 * Out of a run it is a list — every dungeon, what it is made of, what stands at the end of it
 * and whether the door is open (a level to reach and the dungeon before it to beat, the same
 * rule the server holds the door to). In a run it is the map: tap the node linked from where
 * you stand. It decides nothing; every state it shows is one the server computed.
 */

const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const STARS = ['', '★', '★★', '★★★', '★★★★'];

/** The dungeon whose details are open on the right. */
let selected: string | null = null;

const stateOf = (views: readonly DungeonView[], id: string): DungeonView => views.find((v) => v.id === id) ?? { id, state: 'locked', reason: null };

function pick(views: readonly DungeonView[]): DungeonDef {
  const chosen = selected ? DUNGEON_BY_ID.get(selected) : undefined;
  if (chosen) return chosen;
  // the first one that is open and not yet beaten: where the road goes next
  const next = DUNGEONS.find((d) => stateOf(views, d.id).state === 'open') ?? DUNGEONS.find((d) => stateOf(views, d.id).state !== 'cleared') ?? DUNGEONS[0]!;
  return next;
}

function itemLine(items: DungeonDef['firstClear']['items']): string {
  return Object.entries(items ?? {})
    .map(([id, n]) => `${n}× ${(ITEMS as Record<string, { name: string }>)[id]?.name ?? id}`)
    .join(' · ');
}

/**
 * What a pull is worth, read off the same two functions the field runs, so this page cannot
 * promise a number the server does not pay.
 *
 * A room and a core grow at different rates on purpose — the core is the long fight, and the
 * long fight is the one that gives four hands time to link and cover each other. The HAUL line
 * is the part worth stating out loud: it counts people, not boxes, and an extra Chog on a wallet
 * you already hold pays *less* than walking the tile alone.
 */
function pullLines(): string {
  const row = (n: number): string =>
    `<span><b>${n} HANDS</b> GUARD ×${partyHpScale(n, 'node').toFixed(2)}<small>core ×${partyHpScale(n, 'boss').toFixed(2)}</small>HAUL ×${partyRewardScale(n, n).toFixed(2)}</span>`;
  return `${row(2)}${row(4)}<em>HAUL counts people, not boxes — a second Chog on your own wallet pays ×${partyRewardScale(2, 1).toFixed(2)}, which is less than walking it alone.</em>`;
}

function card(def: DungeonDef, view: DungeonView, sel: boolean): string {
  const col = ELEMENT_COLOUR[def.element] ?? 'var(--violet)';
  const status =
    view.state === 'cleared' ? '<i class="ok">✓ cleared</i>' : view.state === 'open' ? '<i class="go">open</i>' : `<i class="lock">${esc(view.reason ?? 'locked')}</i>`;
  return `<div class="dg ${view.state} ${sel ? 'sel' : ''}" data-sel="${def.id}" style="--c:${col}">
    <span class="el">${ELEMENT_ICON[def.element] ?? ''}</span>
    <span class="nm"><b>${esc(def.name)}</b><small>${esc(def.tagline)}</small></span>
    <span class="meta">LV ${def.level}<br>${STARS[def.tier] ?? ''}</span>
    ${status}
  </div>`;
}

/** The world today, on the dungeon door: wave, tier, anomaly. Display only —
 *  folds pay what they pay regardless of the street weather. */
function macroLine(world: { sector: SectorId; sectors: SectorState[] } | null | undefined): string {
  const st = world?.sectors.find((x) => x.sector === world.sector);
  if (!st) return '';
    const boss = st.boss ? ` · ANOMALY ${esc(st.boss.tier.toUpperCase())}${st.boss.archetype ? ` ${esc(st.boss.archetype.toUpperCase())}` : ''}` : '';
  return `<p class="macro">WORLD TODAY · ${esc(SECTOR_NAME[st.sector] ?? st.sector)} WAVE ${Math.round(st.wave)} · ${esc(st.tier.toUpperCase())}${boss}</p>`;
}

function listPage(area: AreaView, world: { sector: SectorId; sectors: SectorState[] } | null | undefined): string {
  const views = area.dungeons;
  const def = pick(views);
  const v = stateOf(views, def.id);
  const col = ELEMENT_COLOUR[def.element] ?? 'var(--violet)';
  const enter =
    v.state === 'locked'
      ? `<button class="enter" disabled>${esc(v.reason ?? 'locked')}</button>`
      : `<button class="enter" data-a="dungeon" data-id="${def.id}">${v.state === 'cleared' ? 'RUN IT AGAIN' : 'ENTER'}</button>`;
  const cleared = views.filter((x) => x.state === 'cleared').length;
  return `<div class="dgs">
    <header><span>DUNGEONS</span><b>${cleared}/${DUNGEONS.length}</b><small>one for each element — clear them in order</small></header>
    ${macroLine(world)}
    <div class="dg-cols">
      <div class="dg-list">${DUNGEONS.map((d) => card(d, stateOf(views, d.id), d.id === def.id)).join('')}</div>
      <section class="dg-detail" style="--c:${col}">
        <h3><span class="el">${ELEMENT_ICON[def.element] ?? ''}</span>${esc(def.name)}</h3>
        <p class="blurb">${esc(def.blurb)}</p>
        <dl>
          <dt>opens</dt><dd>LV ${def.level}${def.n > 1 ? ` · after ${esc(DUNGEONS[def.n - 2]!.name)}` : ''}</dd>
          <dt>depth</dt><dd>${def.rows} rooms · ${STARS[def.tier] ?? ''} difficulty</dd>
          <dt>boss</dt><dd class="boss">${esc(def.boss.name)} <small>${esc(def.boss.archetype)}</small></dd>
          <dt>first clear</dt><dd>${def.firstClear.xp} XP · ${def.firstClear.wav} WAV${def.firstClear.items ? ` · ${esc(itemLine(def.firstClear.items))}` : ''}<br><em>title: ${esc(def.firstClear.title)}</em></dd>
          <dt>a pull</dt><dd class="pscale">${pullLines()}</dd>
        </dl>
        <div class="dg-go">${enter}</div>
        <p class="hint">${v.state === 'cleared' ? 'You can run it again for its rooms and the boss’s cards — the first-clear bonus is paid once.' : 'Rooms cost field integrity. Chests and relays heal and arm you; the boss pays in cards.'} Your level: ${area.level}.</p>
      </section>
    </div>
  </div>`;
}

/** What a node is worth, on the map itself: the choice has to read, not hide in a tooltip. */
function nodeTag(kind: string): string {
  return kind === 'boss' ? 'BOSS · CARDS' : kind === 'elite' ? 'RISK · CARD' : kind === 'chest' ? 'CARD' : kind === 'shrine' ? 'HEAL · BUFF' : kind === 'gate' ? 'MOUTH' : 'FIGHT';
}

/** The same payoff as a sentence, for the tooltip. */
function nodePayoff(kind: string): string {
  return kind === 'boss' ? 'the core: pays cards and a draft pick' : kind === 'elite' ? 'a tough fight: pays a card and a draft pick' : kind === 'chest' ? 'a cache: pays cards on the step' : kind === 'shrine' ? 'a relay: heals, buffs, thins one card' : kind === 'gate' ? 'the mouth: no fight' : 'a fight: a draft pick after';
}

function glyph(kind: string): string {
  return kind === 'boss' ? '◈' : kind === 'elite' ? '◆' : kind === 'chest' ? '▣' : kind === 'shrine' ? '✚' : kind === 'gate' ? '◉' : '●';
}

/** Linked hands, while walking the map. A count only — the pull itself is the field's business. */
function hands(): string {
  const n = social.party?.members.length ?? 0;
  if (n < 2) return '';
  return `<span class="hands" title="a tile scales with the bodies standing on it; the fight strip shows the pull">${n} HANDS LINKED</span>`;
}

/** The 1-of-3 the last combat node dealt, waiting for the pick. Dealt and validated server-side. */
function draftPanel(run: AreaRun): string {
  const draft = run.draft;
  if (!draft) return '';
  const opts = draft.options
    .map((id) => {
      const c = CARD_BY_ID.get(id);
      return `<button class="draft-pick" data-a="draft" data-id="${id}" title="take ${esc(c?.name ?? id)}">` +
        `${cardImg(id, c?.element ?? null, 'draft-art')}<b>${esc(c?.name ?? id)}</b><small>${esc(c?.element ?? '')}${c?.klass ? ` · ${esc(c.klass)}` : ''}</small></button>`;
    })
    .join('');
  return `<div class="draft"><header><span>DRAFT — TAKE 1 OF 3</span></header><div class="draft-opts">${opts}</div></div>`;
}

/** The shrine rest: thin one held card, never a signature. Validated server-side. */
function shrinePanel(run: AreaRun, p: ProfileView | null): string {
  if (!run.shrine || !p) return '';
  const rows = p.cards
    .map((id) => {
      const c = CARD_BY_ID.get(id);
      const locked = p.signatureIds.includes(id);
      const act = locked
        ? '<i>signature stays</i>'
        : `<button data-a="shrine" data-id="${id}" title="remove ${esc(c?.name ?? id)} from the collection">THIN</button>`;
      return `<span class="thin-line">${cardImg(id, c?.element ?? null, 'thin-art')}<b>${esc(c?.name ?? id)}</b>${act}</span>`;
    })
    .join('');
  return `<div class="shrine"><header><span>SHRINE REST \u2014 THIN 1 CARD</span><small>the rest already healed you</small></header><div class="thin-list">${rows || '<i>no cards held</i>'}</div></div>`;
}

function runPage(area: AreaView, p: ProfileView | null): string {
  const run = area.run!;
  const prof = p;
  const nodes = area.area?.nodes ?? [];
  const def = area.area?.dungeonId ? DUNGEON_BY_ID.get(area.area.dungeonId) : undefined;
  const rows = new Map<number, string[]>();
  const from = nodes.find((x) => x.id === run.at);
  for (const n of nodes) {
    const row = rows.get(n.row) ?? [];
    rows.set(n.row, row);
    const cleared = run.cleared.includes(n.id);
    const reachable = !!from?.links.includes(n.id) && !cleared && !run.done && !run.failed;
    row.push(
      `<span class="node k-${n.kind} ${cleared ? 'off' : ''} ${run.at === n.id ? 'here' : ''}" title="${esc(n.label)}${n.enemy ? ` — ${esc(n.enemy.name)}` : ''} · ${esc(nodePayoff(n.kind))}"${reachable ? ` data-a="step" data-id="${n.id}"` : ''}>${glyph(n.kind)}${cleared ? '' : `<small class="nt">${nodeTag(n.kind)}</small>`}</span>`,
    );
  }
  const map = [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([r, cells]) => `<div class="mrow"><span class="rl">${r === (area.area?.rows ?? 1) - 1 ? 'BOSS' : r === 0 ? 'MOUTH' : `R${r}`}</span>${cells.reverse().join('<span class="lnk">—</span>')}</div>`)
    .join('');
  const col = def ? ELEMENT_COLOUR[def.element] ?? 'var(--violet)' : 'var(--violet)';
  return `<div class="dgs run" style="--c:${col}">
    <header><span>${esc(area.area?.name ?? 'FOLD')}</span><small>${def ? esc(def.tagline) : ''}</small>
      <button data-a="leave">${run.done ? 'LEAVE · CLEARED' : run.failed ? 'LEAVE' : 'ABANDON'}</button></header>
    <div class="rhead">
      <span class="hpwrap"><i style="width:${pct(run.hp / Math.max(1, run.maxHp))}"></i></span>
      <span class="x">${run.hp}/${run.maxHp} integrity</span>
      <span class="wav">+${run.wav} WAV · ${run.xp} XP · ${run.cards.length} cards</span>
      ${hands()}
      ${run.buffs.damage > 0 || run.buffs.guard > 0 ? `<span class="build">BUILD +${Math.round(run.buffs.damage * 100)}% DMG +${Math.round(run.buffs.guard * 100)}% GUARD</span>` : ''}
    </div>
    ${draftPanel(run)}
    ${shrinePanel(run, prof)}
    <div class="map">${map}</div>
    <div class="legend"><span>◉ mouth</span><span>●  fight · draft</span><span>◆  elite · risk + card</span><span>▣  cache · cards</span><span>✚  relay · heal + thin</span><span>◈  boss · cards</span></div>
    <p class="hint">${run.done ? 'The core is closed — leave to bank it.' : run.failed ? 'The fold collapsed. Leave and go in again.' : 'Tap a node linked from where you stand. Rooms with something in them open a fight; caches and relays resolve on the step.'}</p>
  </div>`;
}

export function renderDungeons(area: AreaView | null, p: ProfileView | null, world: { sector: SectorId; sectors: SectorState[] } | null | undefined): string {
  if (!area) return `<div class="dgs"><header><span>DUNGEONS</span></header><div class="idle">asking the Fold Gate…</div></div>`;
  return area.run ? runPage(area, p) : listPage(area, world);
}

/** Selecting a dungeon in the list. Entering and stepping go through the sheet's own buttons. */
export function bindDungeons(el: HTMLElement, repaint: () => void): void {
  el.querySelectorAll<HTMLElement>('[data-sel]').forEach((c) =>
    c.addEventListener('click', () => {
      selected = c.dataset.sel!;
      repaint();
    }),
  );
}
