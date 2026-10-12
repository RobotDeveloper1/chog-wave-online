import { ITEMS, SECTOR_NAME, chip as chipOf, cityOf, type AreaRun, type DataArea, type DungeonView, type ProfileView, type SectorId, type SectorState } from '@chog/shared';
import { ICON } from './hud/icons.ts';
import { renderCareer } from './careerPage.ts';
import { renderFolder, renderLibrary } from './deckPages.ts';
import { renderDungeons } from './dungeonPage.ts';
import { renderParty } from './partyPage.ts';

/**
 * The bottom screen's tab sheet.
 *
 * The DS original kept everything that was not walking in a menu on the lower screen,
 * so this is that menu: the map, bag, shop, quests, album, the war board and the fold. It
 * is deliberately a *renderer* — it takes the profile the server pushed and returns HTML,
 * with no game logic and no numbers of its own. Every figure a player sees here is one
 * the server computed, which is the only reason the screen can be trusted.
 */

export type Tab = 'home' | 'map' | 'bag' | 'shop' | 'jobs' | 'career' | 'album' | 'war' | 'dungeons' | 'folder' | 'library' | 'party';

export interface TabDef {
  id: Exclude<Tab, 'home'>;
  label: string;
  icon: keyof typeof ICON;
  /** The tile's glow on the home grid. */
  colour: string;
  /** The key that opens it straight from the street. */
  key?: string;
}

export const TABS: TabDef[] = [
  { id: 'map', label: 'MAP', icon: 'pin', colour: 'var(--wave)', key: 'M' },
  { id: 'jobs', label: 'QUESTS', icon: 'scroll', colour: 'var(--gold)', key: 'J' },
  { id: 'career', label: 'CAREER', icon: 'bolt', colour: 'var(--gold)', key: 'C' },
  { id: 'bag', label: 'BAG', icon: 'bag', colour: 'var(--frost)', key: 'B' },
  { id: 'party', label: 'PARTY', icon: 'heart', colour: 'var(--rose)', key: 'P' },
  { id: 'folder', label: 'FOLDER', icon: 'pack', colour: 'var(--burn)', key: 'F' },
  { id: 'library', label: 'LIBRARY', icon: 'sparkle', colour: 'var(--cyan)' },
  { id: 'shop', label: 'SHOP', icon: 'wav', colour: 'var(--volt)' },
  { id: 'album', label: 'ALBUM', icon: 'star', colour: 'var(--prism)' },
  { id: 'war', label: 'WAR', icon: 'skull', colour: 'var(--rose)' },
  { id: 'dungeons', label: 'DUNGEONS', icon: 'gate', colour: 'var(--void)', key: 'G' },
];

/** The menu's first page: the DS touch menu's grid of big buttons. */
export function renderHome(badges: Partial<Record<Tab, number>> = {}): string {
  const tiles = TABS.map(
    (t) => `<button class="hbtn" data-t="${t.id}" style="--c:${t.colour}">${ICON[t.icon]}<span>${t.label}</span>${badges[t.id] ? `<i class="badge">${badges[t.id]}</i>` : ''}${t.key ? `<em class="kc">${t.key}</em>` : ''}</button>`,
  ).join('');
  return `<div class="home">${tiles}</div><div class="homefoot"><span class="key">Tab</span> close · <span class="key">←</span> <span class="key">→</span> turn the page · <span class="key">Esc</span> back</div>`;
}

/** What the map and quest tabs need to know about where the player is. */
export interface SheetCtx {
  sector: SectorId;
  sectors: SectorState[];
  debug: boolean;
  tracked: string | null;
  area: string;
}

export interface WarView {
  week: string;
  rows: { tribe: string; name: string; points: number; members: number; share: number; holds: string[]; rank: number }[];
  control: Record<string, string>;
  prizes: { tribe: string; wav: number; title: string }[];
  mvp: { tokenId: number; tribe: string; points: number } | null;
  rolloverIn: string;
}

export interface AreaView {
  area: DataArea | null;
  run: AreaRun | null;
  dungeons: DungeonView[];
  level: number;
}

export interface SheetApi {
  buy(kind: 'chip' | 'item', stockId: string): void;
  sell(chipId: string): void;
  use(id: string): void;
  track(questId: string): void;
  openDungeon(id: string): void;
  stepArea(nodeId: string): void;
  closeArea(): void;
}

const esc = (s: string): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

const pct = (v: number): string => `${Math.round(v * 100)}%`;

const TIER_COLOUR: Record<string, string> = { normal: 'var(--wave)', glitch: 'var(--cyan)', anomaly: 'var(--gold)', storm: 'var(--rose)' };

/** The map tab: the city drawn from its plan, how hot the wave is, and the way down. */
function worldMap(ctx: SheetCtx): string {
  const rows = ctx.sectors
    .map((s) => {
      const c = TIER_COLOUR[s.tier] ?? '#6fe3c8';
      return `<div class="d here">
        <b>${esc(SECTOR_NAME[s.sector])}</b>
        <span class="bar"><i style="width:${Math.min(100, (s.wave / 120) * 100)}%;background:${c}"></i></span>
        <span class="num" style="color:${c}">${Math.round(s.wave)}</span>
        <span class="lbl">${esc(s.tier === 'normal' ? 'wave quiet' : s.tier + ' open')}</span>
      </div>`;
    })
    .join('');
  return `<div class="worldmap">
    <canvas class="wm"></canvas>
    <div class="dist">
      <div class="lbl">${esc(SECTOR_NAME[ctx.sector])} · ${esc(ctx.area)}</div>
      ${rows}
      <div class="legend">
        <span><i style="background:#ff5d72"></i>anomaly</span>
        <span><i style="background:#7fd8ff"></i>station · shops · clinic</span>
        <span><i style="background:#f5c343"></i>quest · board</span>
        <span><i style="background:#43e2a8"></i>turn in</span>
        <span><i style="background:#cbb2f2"></i>sights</span>
        <span><i style="background:#fff"></i>you</span>
      </div>
      <button class="godown" data-t="dungeons">▼ THE DUNGEONS · ENTER FROM WHEREVER YOU ARE</button>
      <div class="hint">${esc(cityOf(ctx.sector).tagline)} Quest targets show gold on the map, and the gold arrow on its edge points at the one you are tracking.<span class="only-keys"> Press <span class="key">V</span> for the wave layer.</span></div>
    </div>
  </div>`;
}

export function renderSheet(
  tab: Tab,
  p: ProfileView | null,
  war: WarView | null,
  area: AreaView | null,
  ctx: SheetCtx,
): string {
  if (tab === 'home') return renderHome();
  if (tab === 'party') return renderParty();
  if (tab === 'map') return worldMap(ctx);
  if (!p) return `<div class="sheet"><span class="idle">no profile yet — the link is still opening</span></div>`;

  switch (tab) {
    case 'bag':
      return bag(p);
    case 'shop':
      return shop(p);
    case 'jobs':
      return jobs(p, ctx);
    case 'album':
      return album(p);
    case 'war':
      return warBoard(war, p);
    case 'dungeons':
      return renderDungeons(area);
    case 'career':
      return renderCareer(p);
    case 'folder':
      return renderFolder(p);
    case 'library':
      return renderLibrary(p);
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------

function head(p: ProfileView, right: string): string {
  return `<div class="phead">
    <span class="lv">LV ${p.level}</span>
    <span class="xpwrap"><i style="width:${pct(p.pct)}"></i></span>
    <span class="xp">${p.into}/${p.need} xp</span>
    <span class="wav">${p.wav.toLocaleString()} WAV</span>
    <span class="right">${right}</span>
  </div>`;
}

function bag(p: ProfileView): string {
  const items = Object.entries(ITEMS)
    .map(([id, def]) => {
      const n = p.items[id as keyof typeof p.items] ?? 0;
      if (!n) return '';
      return `<div class="line"><b>${esc(def.name)}</b><span class="x">x${n}</span>
        <span class="d">${esc(def.desc)}</span>
        <button data-a="use" data-id="${id}">USE</button></div>`;
    })
    .join('');
  const sig = new Set(p.signatureIds);
  const chips = p.chips
    .slice(0, p.bagCap)
    .map((id) => {
      const c = chipOf(id);
      const price = p.sellPrices[id] ?? 0;
      const locked = sig.has(id);
      return `<span class="chip ${locked ? 'sig' : ''}" title="${esc(c.name)} · ${c.element} · ${c.power}x${c.hits}">
        ${esc(c.name.slice(0, 13))}${locked ? ' ◆' : price ? ` <em data-a="sell" data-id="${id}">▸${price}</em>` : ''}
      </span>`;
    })
    .join('');
  const flags = [p.amp && 'AMP READY', p.ward && 'WARD HELD', p.scanned && 'SCANNED'].filter(Boolean).join(' · ');
  return `<div class="sheet">${head(p, `bag ${p.chips.length}/${p.bagCap}`)}
    <div class="cols">
      <div>
        <div class="lbl">SUPPLIES</div>
        ${items || '<div class="idle">nothing in the bag — the supply counter sells some</div>'}
        ${flags ? `<div class="flags">${flags}</div>` : ''}
      </div>
      <div>
        <div class="lbl">CARDS · ◆ belongs to your Chog and cannot be sold</div>
        <div class="chips">${chips || '<span class="idle">no cards yet</span>'}</div>
      </div>
    </div>
    <div class="stats">clears ${p.stats.clears} · storm ${p.stats.stormClears} · nodes ${p.stats.rooms} · areas ${p.stats.areas} · trades ${p.stats.trades} · linked ${p.stats.links} · sightings ${p.stats.sightings} · best ${Math.round(p.stats.bestProgram).toLocaleString()} dmg · chain x${p.stats.bestChain}</div>
  </div>`;
}

function shop(p: ProfileView): string {
  const line = (l: { stockId: string; name: string; price: number; desc?: string; klass?: string; element?: string }, kind: 'chip' | 'item'): string =>
    `<div class="line"><b>${esc(l.name)}</b><span class="x">${l.klass ?? ''}${l.element ? ` ${l.element}` : ''}</span>
      <span class="d">${esc(l.desc ?? '')}</span>
      <button data-a="buy" data-kind="${kind}" data-id="${l.stockId}">${l.price} WAV</button></div>`;
  return `<div class="sheet">${head(p, `floor factor x${p.shops.factor.toFixed(2)} · turns in ${p.shops.refreshesIn}`)}
    <div class="cols">
      <div><div class="lbl">CHIP SHOP</div>${p.shops.chips.map((c) => line(c, 'chip')).join('')}</div>
      <div><div class="lbl">SUPPLY COUNTER</div>${p.shops.supply.map((c) => line(c, 'item')).join('')}</div>
    </div>
    <div class="hint">prices move with the collection's real volume — a hot floor is an expensive floor</div>
  </div>`;
}

function jobs(p: ProfileView, ctx: SheetCtx): string {
  const open = p.quests.filter((q) => !q.turnedIn);
  const rows = open
    .sort((a, b) => Number(b.done) - Number(a.done) || Number(b.main) - Number(a.main))
    .map((q) => {
      const lines = q.lines
        .map((l) => `<div class="obj ${l.have >= l.need ? 'done' : ''}">${l.have >= l.need ? '✓' : '·'} ${esc(l.label)} <span class="x">${l.have}/${l.need}</span></div>`)
        .join('');
      const items = Object.entries(q.reward.items ?? {})
        .map(([id, n]) => `+${n} ${esc((ITEMS as Record<string, { name: string }>)[id]?.name ?? id)}`)
        .join(' · ');
      return `<div class="quest ${q.done ? 'ready' : ''} ${ctx.tracked === q.id ? 'tracked' : ''}">
        <div class="qh"><b>${esc(q.name)}</b><span class="stars">${'★'.repeat(q.stars)}</span>
          <span class="giver">${q.main ? 'MAIN · ' : q.bounty ? 'CONTRACT · ' : ''}${esc(q.sector ? q.sector.toUpperCase() : '')}</span>
          <button data-a="track" data-id="${q.id}">${ctx.tracked === q.id ? 'TRACKING' : 'TRACK'}</button></div>
        <div class="qt">${esc(q.done ? `Done — report to ${q.turnIn}.` : q.doing || q.text)}</div>
        ${q.done ? '' : lines}
        <div class="qt">reward: ${q.reward.wav} WAV${items ? ` · ${items}` : ''} · from ${esc(q.giver)}${q.turnInId !== q.giverId ? ` · report to ${esc(q.turnIn)}` : ''}</div>
      </div>`;
    })
    .join('');
  return `<div class="sheet">${head(p, `${open.filter((q) => q.done).length} ready to report · ${p.questsDone}/${p.questsTotal} done`)}
    ${rows || '<div class="idle">no open quests — find the people with a gold <b>!</b> over their heads. The board at the crossing is a good start.</div>'}
  </div>`;
}

function album(p: ProfileView): string {
  const cats = p.album.categories
    .map((c) => `<div class="arow"><span>${esc(c.category)}</span>
      <span class="abar"><i style="width:${pct(c.pct)}"></i></span>
      <span class="x">${c.have}/${c.need}</span></div>`)
    .join('');
  return `<div class="sheet">${head(p, esc(p.album.rank))}
    <div class="big">${p.album.have}/${p.album.need} <span class="lbl">traits logged · ${pct(p.album.pct)}</span></div>
    ${cats}
    <div class="hint">${p.rarest ? `rarest sighting: ${esc(p.rarest.key)} (weight ${p.rarest.weight})` : 'nothing logged yet'} · your own Chog fills its entries the moment you play it</div>
  </div>`;
}

function warBoard(war: WarView | null, p: ProfileView): string {
  if (!war) return `<div class="sheet">${head(p, '')}<div class="idle">asking the tribe hall…</div></div>`;
  const rows = war.rows
    .map((r) => `<div class="wrow ${r.rank === 1 ? 'lead' : ''}">
      <span class="rk">${r.rank}</span><span class="tn">${esc(r.name)}</span>
      <span class="abar"><i style="width:${pct(r.share)}"></i></span>
      <span class="x">${r.points}</span><span class="mb">${r.members}p</span>
      <span class="hold">${r.holds.join(' ') || '—'}</span></div>`)
    .join('');
  return `<div class="sheet">${head(p, `week ${esc(war.week)} · resets in ${esc(war.rolloverIn)}`)}
    ${rows}
    <div class="hint">${war.mvp ? `top runner #${war.mvp.tokenId} (${esc(war.mvp.tribe)}) · ${war.mvp.points} pts` : 'no points banked yet'} · clearing anomalies in the sector the floor is actually moving pays double</div>
  </div>`;
}

/** Bind the sheet's buttons. Called after every render because the HTML is replaced. */
export function bindSheet(el: HTMLElement, api: SheetApi): void {
  el.querySelectorAll<HTMLElement>('[data-a]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.a ?? '';
      const id = btn.dataset.id ?? '';
      if (a === 'buy') api.buy(btn.dataset.kind as 'chip' | 'item', id);
      else if (a === 'sell') api.sell(id);
      else if (a === 'use') api.use(id);
      else if (a === 'track') api.track(id);
      else if (a === 'dungeon') api.openDungeon(id);
      else if (a === 'step') api.stepArea(id);
      else if (a === 'leave') api.closeArea();
    });
  });
}
