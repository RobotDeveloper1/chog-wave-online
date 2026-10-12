import './pages.css';
import { DUNGEON_BY_ID, DUNGEONS, ITEMS, partyHpScale, partyRewardScale, type DungeonDef, type DungeonView } from '@chog/shared';
import { ELEMENT_COLOUR, ELEMENT_ICON } from './hud/icons.ts';
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

function listPage(area: AreaView): string {
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

function glyph(kind: string): string {
  return kind === 'boss' ? '◈' : kind === 'elite' ? '◆' : kind === 'chest' ? '▣' : kind === 'shrine' ? '✚' : kind === 'gate' ? '◉' : '●';
}

/** Linked hands, while walking the map. A count only — the pull itself is the field's business. */
function hands(): string {
  const n = social.party?.members.length ?? 0;
  if (n < 2) return '';
  return `<span class="hands" title="a tile scales with the bodies standing on it; the fight strip shows the pull">${n} HANDS LINKED</span>`;
}

function runPage(area: AreaView): string {
  const run = area.run!;
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
      `<span class="node k-${n.kind} ${cleared ? 'off' : ''} ${run.at === n.id ? 'here' : ''}" title="${esc(n.label)}${n.enemy ? ` — ${esc(n.enemy.name)}` : ''}"${reachable ? ` data-a="step" data-id="${n.id}"` : ''}>${glyph(n.kind)}</span>`,
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
      <span class="wav">+${run.wav} WAV · ${run.xp} XP · ${run.chips.length} cards</span>
      ${hands()}
    </div>
    <div class="map">${map}</div>
    <div class="legend"><span>◉ mouth</span><span>● room</span><span>◆ elite</span><span>▣ cache</span><span>✚ relay</span><span>◈ boss</span></div>
    <p class="hint">${run.done ? 'The core is closed — leave to bank it.' : run.failed ? 'The fold collapsed. Leave and go in again.' : 'Tap a node linked from where you stand. Rooms with something in them open a fight; caches and relays resolve on the step.'}</p>
  </div>`;
}

export function renderDungeons(area: AreaView | null): string {
  if (!area) return `<div class="dgs"><header><span>DUNGEONS</span></header><div class="idle">asking the Fold Gate…</div></div>`;
  return area.run ? runPage(area) : listPage(area);
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
