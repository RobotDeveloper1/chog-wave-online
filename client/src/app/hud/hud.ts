import './hud.css';
import { BUILD_TAG, BUILD_VERSION, GAME_NAME, SECTOR_NAME, type MarketTick, type ProfileView, type QuestView, type SectorState } from '@chog/shared';
import { ELEMENT_COLOUR, ELEMENT_ICON, ICON, ITEM_ICON } from './icons.ts';
import { Minimap, type MapMarker } from './minimap.ts';

/**
 * The game's HUD.
 *
 * Pure view: it is told what to show and reports what was clicked, and has no opinion
 * about the game. Every number on it comes from the server's profile or the world snapshot
 * — the HUD never computes a price, a level or a reward — which is why it can be trusted
 * and why it can be rebuilt without touching a rule.
 */

export interface Identity {
  tokenId: number;
  name: string;
  element: string;
  tribe: string;
  foster: boolean;
  /** The entered Chog, snapshotted off its own live model. Shown when no flat art exists. */
  face?: string | null;
}

export interface Stats {
  level: number;
  into: number;
  need: number;
  wav: number;
  hp: number;
  hpMax: number;
}

export interface ToastSpec {
  icon?: keyof typeof ICON;
  title: string;
  sub?: string;
  colour?: string;
  big?: boolean;
}

export interface DialogueView {
  name: string;
  role: string;
  tribe: string;
  /** A Chog token whose face shows in the box; absent keeps the tribe glyph. */
  tokenId?: number;
  /** The speaker's own 3D-model face (a PNG data URL from portrait.ts). Preferred over tokenId. */
  face?: string;
  /** Pages of speech, one per advance. */
  pages: string[];
  options: { id: string; label: string; primary?: boolean }[];
  rewards?: string[];
}

export interface HudHandlers {
  useItem(id: string): void;
  openTab(tab: string): void;
  toggleViz(): void;
  chat(text: string): void;
  option(id: string): void;
  closeDialogue(): void;
  /** The invitation popup's buttons: accept or decline. */
  party(action: string): void;
}

const TIER_COLOUR: Record<string, string> = { normal: 'var(--wave)', glitch: 'var(--cyan)', anomaly: 'var(--gold)', storm: 'var(--rose)' };
const HOTBAR = ['med', 'repair', 'amp', 'ward'] as const;

const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export class Hud {
  readonly deck: HTMLElement;
  readonly top: HTMLElement;
  readonly bottom: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly minimap: Minimap;
  readonly hud: HTMLElement;
  /** The lower screen's three surfaces: the tab strip, the Hand and the menu sheet. */
  readonly tabsEl: HTMLElement;
  readonly csEl: HTMLElement;
  readonly sheetEl: HTMLElement;
  private handlers: HudHandlers | null = null;

  private el: Record<string, HTMLElement> = {};
  private logLines: { text: string; cls: string; who?: string }[] = [];
  private banner: { zone: string; area: string } = { zone: '', area: '' };
  private typing: { full: string; shown: number; timer: number | null } | null = null;
  private dlg: { view: DialogueView; page: number; done: boolean } | null = null;
  private lastItems = '';
  private lastWave = '';

  constructor() {
    document.body.innerHTML = `
      <div id="deck" class="explore">
       <div id="console">
        <div id="top">
          <canvas id="gl"></canvas>
          <div id="hud">
            <div id="hud-viz"></div>
            <div id="hud-vignette"></div>
            <div id="hud-ticker"></div>
            <div id="hud-player" class="panel chamfer"></div>
            <div id="hud-waves"></div>
            <div id="hud-next" class="hit"></div>
            <div id="hud-party" class="hit"></div>
            <div id="hud-alert" class="panel"></div>
            <div id="hud-banner"></div>
            <div id="hud-map" class="hit"><div class="disc"><canvas></canvas><span class="n">N</span></div><div class="where"></div></div>
            <div id="hud-toasts"></div>
            <div id="hud-prompt" class="panel"></div>
            <div id="hud-log"><div class="lines"></div><input class="hit" maxlength="140" placeholder="say something · /p party · /w #id name · /help" /></div>
            <div id="hud-bubbles"></div>
            <div id="hud-invite" class="panel hit"></div>
            <div id="hud-dock" class="hit"></div>
            <div id="hud-dialogue" class="panel"></div>
            <div id="hud-vizlabel">VISUALIZER · WAVE LAYER</div>
            <div id="hud-build">build ${BUILD_VERSION} - ${BUILD_TAG}</div>
            <div id="hud-levelup"></div>
            <div id="hud-fade"></div>
          </div>
        </div>
        <div id="bottom">
          <div id="lower">
            <div id="tabs"></div>
            <div id="cs"></div>
            <div id="sheet" class="sheet"></div>
          </div>
          <div class="bz"><b>${GAME_NAME}</b><i></i><em>BUILD ${BUILD_VERSION}</em></div>
        </div>
       </div>
      </div>`;
    const q = (id: string): HTMLElement => document.getElementById(id)!;
    this.deck = q('deck');
    this.top = q('top');
    this.bottom = q('bottom');
    this.hud = q('hud');
    this.canvas = q('gl') as HTMLCanvasElement;
    for (const id of ['hud-ticker', 'hud-player', 'hud-waves', 'hud-next', 'hud-party', 'hud-bubbles', 'hud-invite', 'hud-alert', 'hud-banner', 'hud-map', 'hud-toasts', 'hud-prompt', 'hud-log', 'hud-dock', 'hud-dialogue', 'hud-levelup', 'hud-fade', 'tabs', 'cs', 'sheet']) {
      this.el[id] = q(id);
    }
    this.minimap = new Minimap(this.el['hud-map']!.querySelector('canvas')!);
    this.tabsEl = this.el['tabs']!;
    this.csEl = this.el['cs']!;
    this.sheetEl = this.el['sheet']!;
    this.renderDock();
    this.setTicker([]);
    this.setPrompt(null);
    this.renderPlayer(null, null);
  }

  bind(h: HudHandlers): void {
    this.handlers = h;
    const input = this.el['hud-log']!.querySelector('input')!;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text) h.chat(text);
        input.value = '';
        this.chatOpen(false);
      } else if (e.key === 'Escape') {
        input.value = '';
        this.chatOpen(false);
      }
    });
    this.el['hud-map']!.addEventListener('click', () => h.openTab('map'));
    this.el['hud-invite']!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
      if (b?.dataset.p) h.party(b.dataset.p);
    });
  }

  // -------------------------------------------------------------------- player

  private id: Identity | null = null;
  private stats: Stats | null = null;

  setIdentity(id: Identity): void {
    this.id = id;
    this.renderPlayer(this.id, this.stats);
  }

  setStats(s: Stats): void {
    this.stats = s;
    this.renderPlayer(this.id, this.stats);
  }

  private renderPlayer(id: Identity | null, s: Stats | null): void {
    const el = this.el['hud-player']!;
    const col = ELEMENT_COLOUR[id?.element ?? 'void'] ?? 'var(--violet)';
    // The flat collection art first: it is the token's own face. The entered model's
    // snapshot covers tokens with no art file, and the glyph covers having neither.
    // ?v= busts the browser cache: the face behind a token id outlived its URL once already.
    const artToken = id ? (id.foster ? 1 : id.tokenId) : null;
    const hasArt = artToken !== null && artToken >= 1 && artToken <= 1969;
    const pct = (a: number, b: number): number => Math.max(0, Math.min(100, (a / Math.max(1, b)) * 100));
    el.style.setProperty('--el', col);
    el.innerHTML = `
      <div class="portrait">
        <div class="ring">
          ${hasArt ? `<div class="img" style="background-image:url(/art/${artToken}.webp?v=${BUILD_VERSION})"></div>` : id?.face ? `<div class="img" style="background-image:url(${id.face})"></div>` : `<div class="glyph">${ELEMENT_ICON[id?.element ?? 'void'] ?? ''}</div>`}
        </div>
        <div class="lv num">${s ? s.level : '–'}</div>
      </div>
      <div class="pinfo">
        <div class="pname"><span class="el">${ELEMENT_ICON[id?.element ?? 'void'] ?? ''}</span>${esc(id?.name ?? 'LINKING…')}</div>
        <div class="psub num">${id ? (id.foster ? 'FOSTER SIGNAL' : `CHOG #${String(id.tokenId).padStart(4, '0')}`) : ''} · ${esc((id?.tribe ?? '').toUpperCase())}</div>
        <div class="meter hp"><i style="width:${s ? pct(s.hp, s.hpMax) : 100}%"></i><div class="tick"></div><span class="num">${s ? `${Math.round(s.hp)}/${Math.round(s.hpMax)}` : '—/—'}</span></div>
        <div class="meter xp" title="experience"><i style="width:${s ? pct(s.into, s.need) : 0}%"></i></div>
        <div class="prow"><span class="wav num">${ICON.wav}${s ? s.wav.toLocaleString() : '0'}</span></div>
      </div>`;
  }

  // -------------------------------------------------------------------- waves

  setWaves(sectors: SectorState[], here: string): void {
    const key = sectors.map((s) => `${s.sector}:${Math.round(s.wave)}:${s.tier}:${s.boss ? 1 : 0}`).join('|') + here;
    if (key === this.lastWave) return;
    this.lastWave = key;
    this.el['hud-waves']!.innerHTML = sectors
      .map((s) => {
        const c = TIER_COLOUR[s.tier === 'normal' ? 'normal' : s.tier] ?? 'var(--wave)';
        const hot = s.tier === 'anomaly' || s.tier === 'storm';
        return `<div class="wpill ${s.sector === here ? 'here' : ''} ${hot ? 'hot' : ''}" style="--c:${c}">
          <span class="dot"></span><b>${esc(SECTOR_NAME[s.sector])}</b><span class="bar"><i style="width:${Math.min(100, (s.wave / 120) * 100)}%"></i></span><span class="num">${Math.round(s.wave)}</span></div>`;
      })
      .join('');
    const mine = sectors.find((s) => s.sector === here);
    const alert = this.el['hud-alert']!;
    if (mine?.boss) {
      const k = (mine.boss.archetype ?? mine.boss.tier).toUpperCase();
      alert.innerHTML = `<span style="color:var(--rose)">${ICON.skull}</span><span>${esc(k)} RIFT · ${(mine.boss.hp / 1000).toFixed(0)}K HP</span><span class="lbl">go to the</span><span class="key">STATION</span>`;
      alert.classList.add('on');
    } else alert.classList.remove('on');
  }

  // -------------------------------------------------------------------- banner / where

  zoneBanner(zone: string, area: string, tagline = ''): void {
    const el = this.el['hud-banner']!;
    el.innerHTML = `<div class="zone">${esc(zone)}</div><div class="area">${esc(area)}</div>${tagline ? `<div class="tag">${esc(tagline)}</div>` : ''}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  setWhere(zone: string, area: string): void {
    this.banner = { zone, area };
    this.el['hud-map']!.querySelector('.where')!.innerHTML = `${esc(area)}<small>${esc(zone)}</small>`;
  }

  /**
   * The arrow + distance inside the NEXT card. The guide line used to only
   * recompute on profile events, so the arrow froze pointing at a target the
   * player had already walked past. The shell feeds this every frame instead.
   */
  setArrow(text: string): void {
    const el = this.el['hud-next']!.querySelector('.where');
    if (el && el.textContent !== text) el.textContent = text;
  }

  // -------------------------------------------------------------------- prompt

  setPrompt(p: { key: string; title: string; sub?: string; icon?: keyof typeof ICON; colour?: string } | null): void {
    const el = this.el['hud-prompt']!;
    if (!p) {
      el.classList.remove('on');
      return;
    }
    el.style.setProperty('--c', p.colour ?? 'var(--wave)');
    el.innerHTML = `<span class="key">${esc(p.key)}</span>${p.icon ? `<span class="ic">${ICON[p.icon]}</span>` : ''}<span class="what"><b>${esc(p.title)}</b>${p.sub ? `<small>${esc(p.sub)}</small>` : ''}</span>`;
    el.classList.add('on');
  }

  // -------------------------------------------------------------------- toasts / log

  toast(t: ToastSpec): void {
    const el = document.createElement('div');
    el.className = `toast${t.big ? ' big' : ''}`;
    el.style.setProperty('--c', t.colour ?? 'var(--violet)');
    el.innerHTML = `<span class="ico">${ICON[t.icon ?? 'sparkle']}</span><span><b>${esc(t.title)}</b>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</span>`;
    const box = this.el['hud-toasts']!;
    box.appendChild(el);
    while (box.children.length > 4) box.firstElementChild?.remove();
    setTimeout(() => el.remove(), 4500);
  }

  log(text: string, cls = '', who?: string): void {
    this.logLines.push({ text, cls, ...(who ? { who } : {}) });
    if (this.logLines.length > 60) this.logLines.shift();
    const box = this.el['hud-log']!.querySelector('.lines')!;
    const ln = document.createElement('div');
    ln.className = `ln ${cls}`;
    ln.innerHTML = `${who ? `<span class="who">${esc(who)}</span>` : ''}${esc(text)}`;
    box.appendChild(ln);
    while (box.children.length > 9) box.firstElementChild?.remove();
    setTimeout(() => {
      ln.style.transition = 'opacity 1.2s';
      ln.style.opacity = '0';
      setTimeout(() => ln.remove(), 1300);
    }, 14_000);
  }

  /** A line of chat: the channel decides its colour and its tag, the tribe colours the name. */
  chatLine(m: { name: string; text: string; channel: string; tribe?: string; to?: string; mine?: boolean }): void {
    const ln = document.createElement('div');
    ln.className = `ln chan-${m.channel}`;
    const col = ELEMENT_COLOUR[m.tribe ?? ''] ?? '';
    const tag = m.channel === 'party' ? '<span class="tag">PARTY</span>' : m.channel === 'whisper' ? `<span class="tag">${m.mine ? 'TO' : 'FROM'}</span>` : '';
    const who = m.channel === 'whisper' && m.mine ? esc(m.to ?? '') : esc(m.name);
    ln.innerHTML = `${tag}<span class="who" ${col ? `style="color:${col}"` : ''}>${who}</span>${esc(m.text)}`;
    const box = this.el['hud-log']!.querySelector('.lines')!;
    box.appendChild(ln);
    while (box.children.length > 40) box.firstElementChild?.remove();
    setTimeout(() => {
      ln.style.transition = 'opacity 1.2s';
      ln.classList.add('old');
    }, 16_000);
  }

  chatOpen(on: boolean): void {
    const log = this.el['hud-log']!;
    log.classList.toggle('typing', on);
    if (on) log.querySelector('.lines')?.scrollTo({ top: 1e6 });
    const input = log.querySelector('input')!;
    if (on) input.focus();
    else input.blur();
  }

  get chatting(): boolean {
    return this.el['hud-log']!.classList.contains('typing');
  }

  // -------------------------------------------------------------------- ticker

  setTicker(ticks: MarketTick[]): void {
    const el = this.el['hud-ticker']!;
    const rail = ticks.length
      ? `<div class="rail"><div class="run">${ticks
          .slice(-10)
          .map((t) => `<span class="${t.mon >= 15_000 ? 'hot' : ''}">#${t.tokenId} <b>${Math.round(t.mon).toLocaleString()} MON</b> <em>${t.tx}</em></span>`)
          .join('<span style="color:var(--edge-hi)"> ◆ </span>')}</div></div>`
      : `<div class="rail"><span class="idle">LIVE FILLS · no priced sale yet · the wave is quiet</span></div>`;
    const sig = ticks.length + (ticks.at(-1)?.tx ?? '');
    if (el.dataset.sig === String(sig)) return;
    el.dataset.sig = String(sig);
    el.innerHTML = rail;
  }

  // -------------------------------------------------------------------- party and bubbles

  /** The roster under the player card: who is with you, and who is speaking. */
  setParty(members: { id: string; name: string; tribe: string; level: number }[], me: string | null, leader: string, speaking: Set<string>): void {
    const el = this.el['hud-party']!;
    if (members.length < 2) {
      el.classList.remove('on');
      el.innerHTML = '';
      return;
    }
    el.classList.add('on');
    el.innerHTML = `<div class="ph">PARTY <b>${members.length}/4</b></div>${members
      .map((m) => {
        const mine = m.id === me;
        const talk = speaking.has(mine ? 'me' : m.id);
        return `<div class="pm${talk ? ' talk' : ''}" style="--c:${ELEMENT_COLOUR[m.tribe] ?? 'var(--violet)'}"><span class="el">${ELEMENT_ICON[m.tribe] ?? ''}</span><span class="nm">${m.id === leader ? '★ ' : ''}${esc(m.name)}</span><span class="lv">${m.level}</span></div>`;
      })
      .join('')}`;
  }

  /** Someone asked this player something: a prompt that lasts as long as the invitation does. */
  setInvite(inv: { from: string; name: string; kind?: 'party' | 'brawl' | 'trade'; summary?: string } | null): void {
    const el = this.el['hud-invite']!;
    if (!inv) {
      el.classList.remove('on');
      return;
    }
    const btns = `<div class="btns"><button data-p="accept"><span class="key">Y</span> ACCEPT</button><button data-p="decline"><span class="key">N</span> DECLINE</button></div>`;
    el.innerHTML =
      inv.kind === 'trade'
        ? `<small>TRADE OFFER</small><b>${esc(inv.name)}</b><span>${esc(inv.summary ?? 'wants to swap cards and items')}</span>${btns}`
        : inv.kind === 'brawl'
          ? `<small>BRAWL CHALLENGE</small><b>${esc(inv.name)}</b><span>${esc(inv.summary ?? 'wants to fight you live')}</span>${btns}`
          : `<small>PARTY INVITATION</small><b>${esc(inv.name)}</b><span>wants you in their party</span>${btns}`;
    el.classList.add('on');
  }

  private bubbles = new Map<string, { el: HTMLElement; until: number }>();

  /** A speech bubble over someone's head, for a few seconds. */
  bubble(id: string, text: string, kind = 'global', ttl = 6500): void {
    let b = this.bubbles.get(id);
    if (!b) {
      const el = document.createElement('div');
      this.el['hud-bubbles']!.appendChild(el);
      b = { el, until: 0 };
      this.bubbles.set(id, b);
    }
    b.el.className = `bubble ${kind}`;
    b.el.textContent = text.length > 80 ? `${text.slice(0, 78)}…` : text;
    b.until = performance.now() + ttl;
  }

  /** Called every frame with a way to find where a head is on the screen. */
  placeBubbles(at: (id: string) => { x: number; y: number; vis: boolean } | null): void {
    const now = performance.now();
    for (const [id, b] of this.bubbles) {
      const p = now < b.until ? at(id) : null;
      if (!p) {
        if (now >= b.until) {
          b.el.remove();
          this.bubbles.delete(id);
        } else b.el.style.display = 'none';
        continue;
      }
      b.el.style.display = p.vis ? '' : 'none';
      b.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  // -------------------------------------------------------------------- the guide

  /**
   * The one line that answers "what do I do now?": the next step of the main road, with where
   * it is. Always on, so a newcomer who closes every menu is still never lost.
   */
  setNext(g: { act: string; title: string; text: string; where: string; state: 'next' | 'active' | 'ready' } | null): void {
    const el = this.el['hud-next']!;
    if (!g) {
      el.classList.remove('on');
      el.dataset.sig = '';
      return;
    }
    const sig = JSON.stringify(g);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.className = `hit on ${g.state}`;
    el.innerHTML = `<span class="tag">${g.state === 'ready' ? 'HAND IN' : 'NEXT'}</span>
      <span class="body"><span class="act">${esc(g.act)}</span><b>${esc(g.title)}</b><span class="do">${esc(g.text)}</span></span>
      <span class="where">${esc(g.where)}</span>`;
  }

  // -------------------------------------------------------------------- level up

  /** The moment a level lands: what it unlocked and what is next, until the player dismisses it. */
  levelUp(l: { level: number; unlocks: string[]; next: string | null }): void {
    const el = this.el['hud-levelup']!;
    el.innerHTML = `<div class="card panel chamfer">
      <small>LEVEL UP</small>
      <h2>LEVEL ${l.level}</h2>
      ${l.unlocks.length ? `<ul>${l.unlocks.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : '<p>Your Chog grows — more field integrity.</p>'}
      ${l.next ? `<p class="next">NEXT · ${esc(l.next)}</p>` : ''}
      <span class="hint"><span class="key">Enter</span> continue</span>
    </div>`;
    el.classList.add('on');
    const close = (): void => {
      el.classList.remove('on');
      el.onclick = null;
    };
    el.onclick = close;
    window.setTimeout(close, 9000);
  }

  get levelUpOpen(): boolean {
    return this.el['hud-levelup']!.classList.contains('on');
  }

  dismissLevelUp(): void {
    this.el['hud-levelup']!.classList.remove('on');
  }

  // -------------------------------------------------------------------- dock

  private renderDock(items: ProfileView['items'] = {}, viz = false): void {
    const el = this.el['hud-dock']!;
    const key = JSON.stringify(items) + viz;
    if (key === this.lastItems) return;
    this.lastItems = key;
    el.innerHTML = `
      <div class="panel slots">${HOTBAR.map((id, i) => {
        const n = items[id] ?? 0;
        return `<div class="slot ${n ? '' : 'empty'}" data-item="${id}" title="${id}"><span class="kc">${i + 1}</span>${ITEM_ICON[id] ?? ''}<span class="ct">${n ? n : ''}</span></div>`;
      }).join('')}</div>
      <div class="tools">
        <div class="tool ${viz ? 'on' : ''}" data-act="viz" title="Visualizer — see the wave layer">${ICON.eye}<span class="kc">V</span></div>
        <div class="tool" data-act="menu" title="Menu — the lower screen">${ICON.menu}<span class="kc">Tab</span></div>
      </div>`;
    el.querySelectorAll<HTMLElement>('[data-item]').forEach((b) => b.addEventListener('click', () => this.handlers?.useItem(b.dataset.item!)));
    el.querySelectorAll<HTMLElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.act!;
        if (a === 'viz') this.handlers?.toggleViz();
        else this.handlers?.openTab(a === 'menu' ? 'home' : a === 'quests' ? 'jobs' : a);
      }),
    );
  }

  setItems(items: ProfileView['items'], viz: boolean): void {
    this.renderDock(items, viz);
  }

  // -------------------------------------------------------------------- overlays

  setViz(on: boolean): void {
    this.hud.classList.toggle('viz', on);
  }

  fade(on: boolean): void {
    this.el['hud-fade']!.classList.toggle('on', on);
  }

  /**
   * The lower screen slides up over the picture when it is asked for and away when it is not.
   * In a fight it is the Hand's, and the duel decides when it comes up.
   */
  menu(open: boolean): void {
    this.deck.classList.toggle('menu', open);
    this.deck.classList.toggle('explore', !open);
  }

  get menuOpen(): boolean {
    return this.deck.classList.contains('menu');
  }

  // -------------------------------------------------------------------- dialogue

  openDialogue(v: DialogueView): void {
    this.dlg = { view: v, page: 0, done: false };
    this.renderDialogue();
  }

  get dialogueOpen(): boolean {
    return this.dlg !== null;
  }

  closeDialogue(): void {
    if (this.typing?.timer) clearInterval(this.typing.timer);
    this.typing = null;
    this.dlg = null;
    this.el['hud-dialogue']!.classList.remove('on');
  }

  /** Drop the speaker's 3D face in once its model has streamed in (NPCs load on approach). */
  setFace(url: string | null): void {
    if (!this.dlg || !url) return;
    const el = this.el['hud-dialogue']!.querySelector('.face') as HTMLElement | null;
    if (el && !el.style.backgroundImage) {
      el.classList.add('art');
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center 16%';
      el.textContent = '';
    }
  }

  /** One press, one page: finish the line if it is still typing, then turn it. */
  advance(): void {
    if (!this.dlg) return;
    const typing = !!this.typing && this.typing.shown < this.typing.full.length;
    const last = this.dlg.page >= this.dlg.view.pages.length - 1;
    if (typing) {
      this.typing!.shown = this.typing!.full.length;
      // paintSay runs finishPage, which is what reveals the choices on the last page.
      this.paintSay();
      // Revealing a line still owes the player their page turn — except on the last page,
      // where the line they just uncovered is the one they have to read before choosing.
      if (last) return;
    }
    if (this.dlg.page < this.dlg.view.pages.length - 1) {
      this.dlg.page++;
      this.renderDialogue();
      return;
    }
    if (!this.dlg.view.options.length) this.handlers?.closeDialogue();
  }

  pickOption(index: number): boolean {
    if (!this.dlg || !this.dlg.done) return false;
    const o = this.dlg.view.options[index];
    if (!o) return false;
    this.handlers?.option(o.id);
    return true;
  }

  private paintSay(): void {
    const t = this.typing;
    const say = this.el['hud-dialogue']!.querySelector('.say');
    if (!t || !say) return;
    say.textContent = t.full.slice(0, t.shown);
    if (t.shown >= t.full.length) {
      if (t.timer) clearInterval(t.timer);
      t.timer = null;
      this.finishPage();
    }
  }

  private finishPage(): void {
    const d = this.dlg;
    if (!d) return;
    const last = d.page >= d.view.pages.length - 1;
    const el = this.el['hud-dialogue']!;
    const opts = el.querySelector('.opts') as HTMLElement | null;
    const more = el.querySelector('.more') as HTMLElement | null;
    if (last) {
      d.done = true;
      if (opts) {
        opts.innerHTML = d.view.options
          .map((o, i) => `<button class="opt hit ${o.primary ? 'primary' : ''}" data-i="${i}"><span class="key">${i + 1}</span>${esc(o.label)}</button>`)
          .join('');
        opts.querySelectorAll<HTMLElement>('.opt').forEach((b) => b.addEventListener('click', () => this.pickOption(Number(b.dataset.i))));
      }
      if (more) more.style.display = 'none';
    } else if (more) more.style.display = 'block';
  }

  private renderDialogue(): void {
    const d = this.dlg;
    if (!d) return;
    const v = d.view;
    const col = ELEMENT_COLOUR[v.tribe] ?? 'var(--violet)';
    const el = this.el['hud-dialogue']!;
    el.style.setProperty('--c', col);
    // The speaker's 3D-model face when we have it; otherwise the element glyph.
    const face = v.face
      ? `<div class="face art" style="background-image:url(${v.face});background-size:cover;background-position:center 16%"></div>`
      : `<div class="face">${ELEMENT_ICON[v.tribe] ?? ICON.sparkle}</div>`;
    el.innerHTML = `
      ${face}
      <div class="body">
        <div class="who"><b>${esc(v.name)}</b><small>${esc(v.role.toUpperCase())}</small></div>
        <div class="say"></div>
        ${d.page === v.pages.length - 1 && v.rewards?.length ? `<div class="rew">${v.rewards.map((r) => `<span>${esc(r)}</span>`).join('')}</div>` : ''}
        <div class="opts"></div>
      </div>
      <div class="more" style="display:none"><span class="key">E</span> next</div>`;
    el.classList.add('on');
    el.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.opt')) return;
      this.advance();
    };
    if (this.typing?.timer) clearInterval(this.typing.timer);
    d.done = false;
    const full = v.pages[d.page] ?? '';
    this.typing = { full, shown: 0, timer: null };
    this.typing.timer = window.setInterval(() => {
      if (!this.typing) return;
      this.typing.shown += 3;
      this.paintSay();
    }, 14);
  }

  // -------------------------------------------------------------------- per-frame

  frame(px: number, pz: number, yaw: number, facing: number, markers: MapMarker[], t: number): void {
    this.minimap.draw(px, pz, yaw, facing, markers, t);
  }
}
