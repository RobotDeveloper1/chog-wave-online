import './duel.css';
import { BUILD_VERSION, SF, findRecipe, type ChogLoadout, type DuelEndMsg, type DuelStartMsg } from '@chog/shared';
import { net } from '../../net.ts';
import { ELEMENT_COLOUR, ELEMENT_ICON } from '../hud/icons.ts';
import { cardImg } from '../cardArt.ts';

export interface DuelUiHandlers {
  step(dir: SF.StepDir): void;
  pick(cell: number): void;
  undo(): void;
  clear(): void;
  execute(): void;
  cover(target: string | null, source?: string): void;
  leave(): void;
  close(): void;
}

export const escapeHtml = (s: string): string => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const esc = escapeHtml;
const num = (n: number): string => Math.round(n).toLocaleString();
const pct = (n: number): string => `${Number(n.toFixed(1))}%`;
const fraction = (n: number): number => Math.max(0, Math.min(1, n));
const colour = (e: string): string => ELEMENT_COLOUR[e] ?? 'var(--violet)';
const element = (e: keyof typeof SF.SF_NAMES): string => SF.SF_NAMES[e];
const panelName = (p: SF.Panel): string => `F${p.file + 1} · L${p.lane + 1}`;
const hp = (value: number, max: number, cls = ''): string =>
  `<div class="d-meter ${cls}"><i style="width:${fraction(value / Math.max(1, max)) * 100}%"></i><span>${num(value)} / ${num(max)}</span></div>`;

type Identity = { tokenId: number; name: string; element: keyof typeof SF.SF_NAMES; level: number;
  traitsSource: 'real' | 'predicted'; loadout?: ChogLoadout };
type PlayerIdentity = SF.PlayerView & { tokenId?: number };
/** These economy fields are optional until the parent protocol owner adds them. */
type Receipt = DuelEndMsg & {
  xp?: number; wav?: number; first?: boolean;
  refunded?: { name: string; wav: number }[];
  level?: { to: number; unlocks?: string[] } | null;
};
type Hold = { kind: 'cover' | 'step'; source: string; target?: string; dir?: SF.StepDir; next: number };

export class DuelUi {
  readonly root: HTMLElement;
  readonly floatHost: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private mounted = false;
  private over = false;
  private view: SF.DuelView | null = null;
  private identity: Identity | null = null;
  private snapshotAt = 0;
  private readonly holds = new Map<number, Hold>();
  private readonly signatures = new Map<string, string>();
  private moves: DuelStartMsg['moves'] = [];
  private caps: DuelStartMsg['caps'] | null = null;
  private logs: string[] = [];
  private noticeUntil = 0;

  constructor(private readonly top: HTMLElement, private readonly cs: HTMLElement, private readonly h: DuelUiHandlers) {
    this.root = document.createElement('div');
    this.root.id = 'duel';
    this.root.innerHTML = `
      <section class="d-you panel chamfer" aria-label="Your NFT and integrity"></section>
      <section class="d-boss panel chamfer" aria-label="Rift integrity"></section>
      <section class="d-charge"><div class="bar"><i></i><span class="label"></span></div></section>
      <section class="d-grade panel"></section>
      <section class="d-party" aria-label="Other players on the field"></section>
      <details class="d-stats panel hit"><summary>NFT TRAIT STATS</summary><div></div></details>
      <details class="d-manual panel hit"><summary>FIELD MANUAL</summary><div></div></details>
      <section class="d-warn" role="status"></section>
      <section class="d-ward"></section>
      <section class="d-down"></section>
      <section class="d-cover"></section>
      <section class="d-event" aria-live="polite"></section>
      <section class="d-hint" role="status">WASD: dodge (fills Charge) · R: cover · 1-6 pick · ENTER fires</section>
      <section class="d-controls hit" aria-label="Field controls">
        <div class="d-pad">
          <button data-dir="back" class="back" aria-label="Step to the far player lane">BACK <small>W</small></button>
          <button data-dir="left" class="left" aria-label="Step one file left">LEFT <small>A</small></button>
          <span class="position"></span>
          <button data-dir="right" class="right" aria-label="Step one file right">RIGHT <small>D</small></button>
          <button data-dir="forward" class="forward" aria-label="Step to the near player lane">NEAR <small>S</small></button>
        </div>
      </section>
      <button class="d-leave hit" data-act="leave">LEAVE <small>ESC</small></button>
      <button class="d-fire hit" data-act="execute" aria-label="Fire the picked cards"><b>FIRE</b><small>ENTER</small></button>
      <div class="d-low"></div><div class="d-flash"></div><div class="d-floats"></div>
      <section class="d-end"></section>`;
    for (const key of ['you', 'boss', 'charge', 'grade', 'party', 'stats', 'manual', 'warn', 'ward', 'down', 'cover', 'event', 'hint', 'controls', 'fire', 'low', 'flash', 'floats', 'end']) {
      this.el[key] = this.root.querySelector<HTMLElement>(`.d-${key}`)!;
    }
    this.floatHost = this.el.floats!;
  }

  mount(identity: Identity): void {
    if (this.mounted) return;
    this.mounted = true;
    this.identity = identity;
    this.top.appendChild(this.root);
    this.cs.classList.add('on', 'duel');
    this.cs.innerHTML = '';
    this.root.addEventListener('click', this.onClick);
    this.cs.addEventListener('click', this.onClick);
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('lostpointercapture', this.onPointerEnd);
    window.addEventListener('pointerup', this.onPointerEnd, { capture: true });
    window.addEventListener('pointercancel', this.onPointerEnd, { capture: true });
    window.addEventListener('blur', this.releasePointers);
  }

  private paint(key: string, html: string, target = this.el[key]!): void {
    if (this.signatures.get(key) === html) return;
    this.signatures.set(key, html);
    target.innerHTML = html;
  }

  setManual(moves: DuelStartMsg['moves'], caps: DuelStartMsg['caps']): void {
    this.moves = moves;
    this.caps = caps;
    this.paint('manualText', `<p>The Charge opens your Hand automatically. Pick with 1–6 or tap cards, in firing order. Enter fires; Backspace undoes; C clears.</p>
      <p>Cards aim from your current file. Movement freezes only while a program fires — walking out of an open Hand drops its shield. Read your lanes before dodging.</p>
      <p>Dodging a marked panel banks Charge, so the next Hand comes sooner. Hold R or COVER beside a downed partner on a neighbouring file.</p>
      <p>Counter cards fired during a telegraph deal double damage and bank bonus cards. Chaining one element raises every later card in the program. NULL fits any element lock; VOID pushes the district wave up.</p>
      <ol>${moves.map((m) => `<li><b>${esc(m.name)}</b><span>${esc(m.read)}</span></li>`).join('')}</ol>`, this.el.manual!.querySelector('div')!);
  }

  /**
   * Re-read the pad's live state. `setControls` owns it; this is just the nudge that runs when a
   * refused step needs the grey to appear before the player presses anything else.
   */
  setFrozen(on: boolean): void {
    this.setControls(this.view?.you ?? null);
  }

  setView(v: SF.DuelView): void {
    this.view = v;
    this.snapshotAt = performance.now();
    const b = v.boss;
    const you = v.you;
    const id = this.identity!;
    this.el.boss!.style.setProperty('--c', colour(b.element));
    const weak = SF.weakTo(b.element);
    this.paint('boss', `<div class="who"><span class="el">${ELEMENT_ICON[b.element] ?? ''}</span><b>${esc(b.name)}</b></div>
      ${hp(b.hp, b.maxHp, 'boss-hp')}
      <div class="sub"><span>${b.training ? 'TRAINING' : b.node ? 'DUNGEON' : esc(b.tier.toUpperCase())} · PHASE ${b.phase}</span><span>${panelName(b)}</span></div>
      <div class="sub"><span>${element(b.element)} · GUARD ${pct(b.guard * 100)}</span><span>${weak ? `WEAK: ${element(weak)}` : b.element === 'prism' ? 'WEAK: VOID' : 'NO CYCLE WEAKNESS'}</span></div>
      ${(b.burn || b.freezeMs > 0 || b.stunMs > 0) ? `<div class="sub status">${[b.burn ? `BURN ${b.burn.ticks}x${b.burn.damage}` : '', b.freezeMs > 0 ? `FROZEN ${(b.freezeMs / 1000).toFixed(1)}s` : '', b.stunMs > 0 ? `STUN ${(b.stunMs / 1000).toFixed(1)}s` : ''].filter(Boolean).join(' · ')}</div>` : ''}
      ${b.blocked !== null ? `<div class="wall">WALL · FILE ${b.blocked + 1} · SWORD PIERCES</div>` : ''}`);
    this.el.you!.style.setProperty('--c', colour(you?.tribe ?? id.element));
    const tokenId = (you as PlayerIdentity | null)?.tokenId ?? id.tokenId;
    // The grace window, drawn as a bar under the chain: 220ms is too short to read as a number, but
    // a bar that fills and drains reads at a glance, which is the only speed that matters here.
    const grace = you && you.dodge && you.dodge.iframeMs > 0
      ? `<div class="d-grace" style="--g:${Math.min(1, you.dodge.iframeMs / Math.max(1, you.dodge.graceMs))}"><b>GRACE</b><i></i></div>`
      : '';
    this.paint('you', `<div class="who">${this.portrait(tokenId, id.element)}<div><b>${esc(you?.name ?? id.name)}</b><small>CHOG #${String(tokenId).padStart(4, '0')} · LV ${net.profile?.level ?? id.level} · ${element(you?.tribe ?? id.element)}</small></div></div>
      ${you ? hp(you.hp, you.maxHp, you.hp / you.maxHp < 0.3 ? 'low' : '') : '<div class="sub">Waiting for your field body</div>'}
      <div class="d-chain">CHAIN <b>${you?.chain ?? 0}</b><span>×${SF.chainMultiplier(you?.chain ?? 0).toFixed(2)}</span><small>${you?.hand ? 'HAND · SHIELDED' : you?.frozen ? 'PROGRAM · FROZEN' : you?.down ? 'DOWN' : 'FIELD ACTIVE'}</small>${you && you.barrier > 0 ? `<span class="barrier">BARRIER x${you.barrier}</span>` : ''}${you && you.stunMs > 0 ? `<span class="status">STUN ${(you.stunMs / 1000).toFixed(1)}s</span>` : ''}
      ${you && you.chillMs > 0 ? `<span class="status">FROZEN ${(you.chillMs / 1000).toFixed(1)}s</span>` : ''}
      ${you && you.burn ? `<span class="status">BURN ${you.burn.ticks}x${you.burn.damage}</span>` : ''}</div>${grace}`);
    this.el.low!.classList.toggle('on', !!you && you.hp / Math.max(1, you.maxHp) < 0.3);
    this.el.ward!.classList.toggle('on', v.warded);
    this.paint('ward', v.warded ? 'LINK WARD · Two banded players must stand on neighbouring files for damage to land.' : '');
    if (you) {
      // One line, under the charge banner: the grade, what is feeding it, and what it is buying.
      // Three stacked panels about the same fight was the loudest noise on the screen.
      this.paint('grade', `<b>${esc(you.rank.letter)}</b><span>${you.rank.counters} counters · ${you.rank.abacks} abacks</span><span>${pct(you.drop.rareChance * 100)} rare</span>${you.link && you.link.mult > 1 ? `<span class="link">${esc(you.link.tag ?? 'link')} ×${you.link.mult.toFixed(2)}</span>` : ''}`);
      this.renderStats(you.stats);
    }
    this.renderParty(v);
    this.renderWarning(v.hazard);
    this.renderCover(you);
    this.renderCustom();
    this.setControls(you);
    this.frame(performance.now());
  }

  private portrait(tokenId: number | undefined, tribe: keyof typeof SF.SF_NAMES): string {
    // ?v= busts the browser cache, same as the HUD: the face behind a token id outlived its URL once already.
    // The plate shows the collection's illustration, not the model's turntable sheet: a face you
    // recognise from the market, in the corner you look at when you want to know who is fighting.
    return tokenId !== undefined && Number.isInteger(tokenId) && tokenId >= 1 && tokenId <= 1969
      ? `<span class="portrait art" style="background-image:url(/art/${tokenId}.webp?v=${BUILD_VERSION})" role="img" aria-label="Chog #${tokenId}"></span>`
      : `<span class="portrait glyph">${ELEMENT_ICON[tribe] ?? ''}</span>`;
  }

  private renderStats(s: SF.DuelStats): void {
    const loadout = this.identity?.loadout;
    const values: [string, string][] = [
      ['INTEGRITY', num(s.hp)], ['ATTACK', `${s.attack}/10`],
      ['CHARGE SPEED', `${s.charge}/10`], ['CARD SLOTS', String(s.slots)],
      ['FIELD FILES', String(s.cols)], ['MEGA / GIGA CAP', `${s.megaCap} / ${s.gigaCap}`],
      ['ARMOUR', pct(s.armour * 100)], ['CRIT CHANCE', pct(s.crit)],
      ['DRAIN RETURN', pct(s.drain * 100)], ['CHARGE REDUCTION', pct(s.chargePct)],
      ['CHARGE FILL', `${((this.view?.you?.chargeMs ?? 0) / 1000).toFixed(2)}s`],
    ];
    this.paint('statsText', `<p>${this.identity?.traitsSource === 'real' ? 'Collection traits' : 'Predicted traits'} · effective server stats, including party steps.</p>
      <dl>${values.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl>
      ${loadout ? `<p>HEAD · ${esc(loadout.gear.toUpperCase())}<br>SKIN RESIST · ${loadout.resist ? element(loadout.resist) : 'NONE'}<br>
        MOUTH · CRIT ${pct(loadout.voice.critPct ?? 0)} / DRAIN ${pct(loadout.voice.drainPct ?? 0)} / CHARGE ${pct(loadout.voice.chargePct ?? 0)} / AGGRO ${loadout.voice.aggro ?? 0}</p>` : ''}`, this.el.stats!.querySelector('div')!);
  }

  private renderParty(v: SF.DuelView): void {
    const you = v.you;
    const allies = v.players.filter((p) => p.id !== (you?.id ?? net.me?.id));
    const rows = allies.map((a: PlayerIdentity) => {
      const token = a.tokenId ?? net.world?.players.find((p) => p.id === a.id)?.tokenId ?? net.world?.roster?.find((p) => p.id === a.id)?.tokenId;
      const near = !!you && !you.down && !you.frozen && !you.hand && Math.abs(a.file - you.file) === 1;
      return `<div class="party-row ${a.down ? 'down' : ''}" style="--c:${colour(a.tribe)}">
        ${this.portrait(token, a.tribe)}<div class="party-info"><b>${esc(a.name)}</b><small>${token === undefined ? 'NFT identity pending' : `CHOG #${token}`} · ${panelName(a)} · ${element(a.tribe)}</small>
        ${hp(a.hp, a.maxHp)}<small>${a.down ? `DOWN · ${(a.downLeft / 1000).toFixed(1)}s` : a.shielded ? 'HAND · SHIELDED' : a.reviving ? `COVER ${pct(a.reviving.fraction * 100)}` : a.frozen ? 'PROGRAM · FROZEN' : `CHAIN ${a.chain}`}</small>${a.stunMs > 0 || a.chillMs > 0 || a.burn ? `<small class="status">${[a.stunMs > 0 ? `STUN ${(a.stunMs / 1000).toFixed(1)}s` : '', a.chillMs > 0 ? `FROZEN ${(a.chillMs / 1000).toFixed(1)}s` : '', a.burn ? `BURN ${a.burn.ticks}x${a.burn.damage}` : ''].filter(Boolean).join(' · ')}</small>` : ''}</div>
        ${a.down ? `<button data-cover="${esc(a.id)}" ${near ? '' : 'disabled'} title="${near ? 'Hold to cover; release to cancel' : 'Move to a neighbouring file'}">COVER<small>HOLD</small></button>` : ''}</div>`;
    }).join('');
    // A party of one is not a fact the fight needs on screen: the panel exists for the bodies beside
    // you, and saying "you are alone" out loud only adds a box to a screen that already has six.
    if (v.party.bodies <= 1) {
      this.paint('party', '');
      return;
    }
    this.paint('party', `<div class="party-heading">FIELD PARTY <span>${v.party.bodies} BODIES · ${v.party.owners} OWNERS · ${v.party.bands} BANDS</span></div>
      ${you?.link && you.link.mult > 1 ? `<div class="link">${esc(you.link.tag ?? 'PARTY LINK')} ×${you.link.mult.toFixed(2)}</div>` : ''}
      ${rows}`);
  }

  private renderCover(you: SF.YouView | null): void {
    this.el.down!.classList.toggle('on', !!you?.down);
    this.paint('down', you?.down ? `<b>DOWN · ${(you.downLeft / 1000).toFixed(1)}s</b><span>A partner on a neighbouring file must hold COVER. Your body stays on ${panelName(you)}.</span>` : '');
    this.el.cover!.classList.toggle('on', !!you?.revive);
    const revive = you?.revive;
    this.paint('cover', revive ? `<b>COVERING ${esc(revive.name)} · ${pct(revive.fraction * 100)}</b><div class="d-meter"><i style="width:${fraction(revive.fraction) * 100}%"></i></div><small>Hold ${(Math.max(0, 1 - revive.fraction) * SF.REVIVE_HOLD_MS / 1000).toFixed(1)}s more · release, step or fire to cancel</small>` : '');
  }

  private renderWarning(h: SF.HazardView | null): void {
    this.el.warn!.classList.toggle('on', !!h && !this.over);
    this.paint('warn', h ? `<b>${esc(h.label)}</b><span>${num(h.damage)} DMG</span><small class="remaining"></small>${this.panelGrid(h.panels, false)}` : '');
  }

  /** A literal field map, never a placement surface or a warning expanded across lanes. */
  private panelGrid(warnings: readonly SF.Panel[], allLanes = true): string {
    const v = this.view;
    const files = v?.boss.cols ?? SF.MIN_COLS;
    const depth = v?.boss.lanes ?? SF.LANES;
    const home = v?.pvp ? depth - SF.PVP_HALF : SF.FIRST_PLAYER_LANE;
    const lanes = Array.from({ length: allLanes ? depth : depth - home }, (_, i) => i + (allLanes ? 0 : home));
    const cells = lanes.flatMap((lane) => Array.from({ length: files }, (_, file) => {
      const danger = warnings.some((p) => p.file === file && p.lane === lane);
      const mine = v?.you?.file === file && v.you.lane === lane;
      const boss = allLanes && v?.boss.file === file && v.boss.lane === lane;
      const ally = v?.players.some((p) => p.id !== v.you?.id && p.file === file && p.lane === lane);
      return `<span class="field-panel ${danger ? 'danger' : ''} ${mine ? 'mine' : ''} ${boss ? 'boss' : ''}" title="File ${file + 1}, lane ${lane + 1}${danger ? ': incoming' : ': not marked'}">${boss ? 'BOSS' : mine ? 'YOU' : ally ? 'ALLY' : `F${file + 1}`}<small>L${lane + 1}</small></span>`;
    })).join('');
    return `<div class="field-map" style="--files:${files}">${cells}</div>`;
  }

  private renderCustom(): void {
    if (!this.mounted) return;
    const v = this.view;
    const hand = this.over ? null : v?.you?.hand;
    const open = !!hand?.open;
    const selected = hand?.cells.filter((c) => c.picked).sort((a, b) => a.order - b.order) ?? [];
    const cards = hand ? Array.from({ length: SF.HAND_CELLS }, (_, index) => {
      const cell = hand.cells.find((c) => c.cell === index);
      return cell ? this.cardHtml(cell, open) : `<div class="sf-card waiting"><small>${index + 1}</small><b>EMPTY CELL</b></div>`;
    }).join('') :
      Array.from({ length: SF.HAND_CELLS }, (_, i) => `<div class="sf-card waiting"><small>${i + 1}</small><b>AWAITING DEAL</b></div>`).join('');
    const title = this.over ? 'FIELD CLOSED' : hand ? (open ? 'HAND · YOUR MOVE' : 'HAND DEALT · OPENS WHEN THE CHARGE FILLS') : 'HAND OPENS AUTOMATICALLY';
    const caps = v?.you ? { slots: v.you.stats.slots, mega: v.you.stats.megaCap, giga: v.you.stats.gigaCap } : this.caps;
    const limits = caps ? `${caps.slots} SLOTS · ${caps.mega} MEGA · ${caps.giga} GIGA` : '';
    const chainNow = v?.you?.chain ?? 0;
    // The true preview: walk the queue through the same formula the field fires, so the
    // number on the screen is the number on the boss. Crit stays out — it is rolled on
    // the landing, which a preview is not allowed to know.
    const canPrice = !!v?.you && !!v?.boss;
    const bossEl = v?.boss.element;
    const counter = !!v?.hazard;
    const linkMult = v?.you?.link?.mult ?? 1;
    const guard = v?.boss?.guard ?? 0;
    const atk = v?.you?.stats.attack ?? 1;
    const crit = v?.you?.stats.crit ?? 0;
    let runState = chainNow;
    let lastEl = v?.you?.lastElement ?? null;
    let links = 0;
    let total = 0;
    const qcards = selected.map((cell, i) => {
      const linked = i > 0 && selected[i - 1]!.card.element === cell.card.element;
      if (linked) links += 1;
      let dmg: number | null = null;
      let mult = SF.chainMultiplier(chainNow + links);
      if (canPrice && bossEl) {
        const pv = SF.previewDamage(cell.card, { chain: runState, lastElement: lastEl, attack: atk, bossElement: bossEl, counter, linkMult, guard });
        runState = pv.run;
        lastEl = pv.element;
        dmg = pv.damage;
        total += dmg;
        mult = SF.chainMultiplier(pv.run);
      }
      return `<div class="qcard ${linked ? 'linked' : ''}" style="--c:${colour(cell.card.element)}">${cardImg(cell.card.id, cell.card.element, 'qart')}<b class="qnum">${cell.order}</b><span class="qnm">${esc(cell.card.name)}</span><small>${SF.CLASS_LABEL[cell.card.cls]}${dmg !== null ? `· <em>≈${num(dmg)}</em>` : ''}${linked ? `· <em>LINK ×${mult.toFixed(2)}</em>` : ''}</small></div>`;
    }).join('');
    const recipe = selected.length >= 3 ? findRecipe(selected.map((c) => c.card.id)) : null;
    const preview = Math.round(hand ? hand.might * SF.chainMultiplier(chainNow + links) : 0);
    const program = hand ? `<div class="cs-queue">${qcards || '<p>Pick your first card to choose this turn’s element.</p>'}</div>
      ${recipe ? `<div class="cs-fusion">FUSION READY · ${esc(recipe.result)}</div>` : ''}
      <div class="cs-sum"><b>${num(hand.might)}</b> RAW MIGHT <small>Might before the multipliers the preview prices.</small><span>${hand.left} PICKS LEFT · ${SF.CLASS_LABEL[hand.top]} · ${hand.gigaSpent ? 'GIGA SPENT' : 'GIGA NOT SPENT'}</span><span class="cs-preview">PREVIEW ≈ ${num(canPrice && bossEl && selected.length ? total : preview)} DAMAGE${counter && selected.length ? ' · COUNTER ×2' : ''}${guard > 0 && selected.length ? ` · GUARD -${Math.round(guard * 100)}%` : ''}${linkMult > 1 && selected.length ? ` · LINK ×${linkMult.toFixed(2)}` : ''}${crit > 0 && selected.length ? ` · CRIT ${pct(crit)}` : ''}${atk > 1 && selected.length ? ` · ATK ×${SF.attackScale(atk).toFixed(2)}` : ''}${links ? ` · ${links} RESONANCE LINK${links > 1 ? 'S' : ''}` : ''}</span></div>
      <div class="cs-btns"><button data-act="undo" ${selected.length && open ? '' : 'disabled'}>UNDO <small>BACKSPACE</small></button><button data-act="clear" ${selected.length && open ? '' : 'disabled'}>CLEAR <small>C</small></button><button class="exe" data-act="execute" ${open ? '' : 'disabled'}>${selected.length ? 'EXECUTE' : 'RETURN TO FIELD'} <small>ENTER</small></button></div>` :
      `<div class="cs-wait"><b>${this.over ? 'Take your result receipt on the field.' : 'Dodge while the Charge fills.'}</b><p>Every clean dodge banks Charge. The server deals your next Hand automatically.</p></div>`;
    const lock = hand?.lock ? element(hand.lock) : 'UNLOCKED / NULL';
    const coverage = selected.map((c) => ({ cell: c, files: SF.coverFiles(c.card.shape, v?.you?.file ?? 1, v?.boss.cols ?? 3) }));
    const aiming = coverage.map(({ cell, files }) => `<div><b>${cell.order} · ${esc(cell.card.name)}</b><span>F${files.map((f) => f + 1).join(', F')} · ${files.includes(v?.boss.file ?? -1) ? 'BOSS FILE COVERED' : 'OFF BOSS FILE'}${v?.boss.blocked !== null && files.includes(v?.boss.blocked ?? -1) && cell.card.kind !== 'sword' ? ' · WALL BLOCKS' : ''}</span></div>`).join('');
    const html = `<div class="sf-hand">
      <header><b>${title}</b><small>${hand ? `ELEMENT LOCK: ${lock} · ${limits}` : limits}</small></header>
      <section class="cs-hand"><div class="cs-cards">${cards}</div>${!hand ? '<div class="cs-charge"><b>AWAITING DEAL</b><span class="time"></span><small>The server deals six on arrival.</small></div>' : !open ? '<div class="cs-charge"><b>HAND IN</b><span class="time"></span><small>The hand is dealt and readable; picking and the safe room start when the Charge fills.</small></div>' : ''}</section>
      <section class="cs-field"><h3>LIVE FIELD · ${v?.you ? panelName(v.you) : 'SYNCING'}</h3>${this.panelGrid(v?.hazard?.panels ?? [])}
        <div class="cs-safe ${v?.you?.shielded ? '' : 'exposed'}">${v?.you?.down ? 'DOWN · Wait for partner cover' : v?.you?.shielded ? 'SHIELDED · stepping out drops the shield' : v?.you?.frozen ? 'PROGRAM FIRING · Movement frozen' : 'ACTIVE FIELD · Dodge on both axes'}</div>
        <div class="cs-aim">${aiming || '<p>Card spread is anchored to your file, not a placement grid.</p>'}</div></section>
      <section class="cs-prog ${recipe ? 'fusion' : ' '.trim()}"><h3>FIRING ORDER <small>${selected.length} SELECTED</small></h3>${program}</section>
      <footer>${hand ? 'Server owns every pick and lock. The screen auto-executes when its hold expires.' : '1–6 picks · Enter executes · Backspace undoes · C clears'}</footer>
    </div>`;
    const focusCell = (document.activeElement as HTMLElement | null)?.dataset.cell;
    this.paint('hand', html, this.cs);
    if (focusCell !== undefined) this.cs.querySelector<HTMLButtonElement>(`[data-cell="${Number(focusCell)}"]`)?.focus({ preventScroll: true });
    // The one button in the middle of the field: it says what it will cost the boss, so the eye has
    // somewhere to go the moment a program exists.
    const fire = this.el.fire as HTMLButtonElement | undefined;
    if (fire) {
      const live = !this.over && open && selected.length > 0;
      fire.disabled = !live;
      fire.classList.toggle('ready', live);
      fire.querySelector('small')!.textContent = live ? `${num(canPrice && bossEl && selected.length ? total : hand?.might ?? 0)} DMG · ENTER` : 'PICK A CARD FIRST';
    }
  }

  /**
   * One card in the hand.
   *
   * The old card was a *row*: a 3em thumbnail pinned to the left and five lines of text stacked
   * beside it, six of them, all the same shape. It read as a list of spreadsheet lines, which is
   * exactly the wrong register for a battle card — the art is the identity and it was a stamp in
   * the margin.
   *
   * So the art is the card now. It fills the tile, a scrim keeps the text legible over it, and the
   * numbers ride on top of the picture instead of living in a paragraph next to it. Picking a card
   * does not hide it: the tile dims, lifts and wears its order numeral, so a program you have
   * queued is still six seconds from being one you can see and undo.
   */
  private cardHtml(cell: SF.CellView, open = true): string {
    const c = cell.card;
    const reason = !open ? 'the hand opens when the Charge fills' : cell.locked ? SF.REFUSAL_TEXT[cell.locked] : 'available to pick';
    const match = this.view ? SF.matchup(c.element, this.view.boss.element) : 1;
    const state = cell.picked ? 'picked' : cell.locked ? 'locked' : 'available';
    return `<button class="sf-card ${state} ${open ? '' : 'held'}" style="--c:${colour(c.element)}" data-cell="${cell.cell}" ${cell.picked || cell.locked || !open ? 'disabled' : ''}
      title="${esc(c.name)} · ${esc(SF.KIND_READ[c.kind])} · ${esc(reason)}" aria-label="${cell.cell + 1}: ${esc(c.name)}, ${cell.picked ? `picked, fires ${cell.order}` : esc(reason)}">
      ${cardImg(c.id, c.element, 'card-art')}
      <span class="card-veil"></span>
      <span class="card-top"><i class="card-dot" aria-hidden="true"></i><small>${String(cell.cell + 1).padStart(2, '0')} ${element(c.element)}</small><b>${SF.CLASS_LABEL[c.cls]}</b></span>
      <span class="card-foot"><b class="card-name">${esc(c.name)}</b><span class="card-pw">${c.power}<i>×</i>${c.hits}</span><small>${SF.KIND_LABEL[c.kind]} · ${c.spread} SPREAD${match !== 1 ? ` · <em>×${match} ELEMENT</em>` : ''}</small></span>
      ${cell.picked ? `<span class="card-order"><i>${cell.order}</i>FIRES ${cell.order}</span>` : cell.locked ? `<span class="card-nope">${esc(SF.REFUSAL_SHORT[cell.locked] ?? 'LOCKED')}</span>` : ''}
    </button>`;
  }

  private setControls(you: SF.YouView | null): void {
    // Seamless movement: an open Hand no longer greys the D-pad — only a program in flight
    // does. Walking out closes the screen on the server and drops the shield.
    const blocked = this.over || !you || you.down || (you.frozen && !you.hand?.open);
    this.root.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((b) => {
      const dir = b.dataset.dir;
      const lanes = this.view?.boss.lanes ?? SF.LANES;
      const lo = this.view?.pvp ? lanes - SF.PVP_HALF : SF.FIRST_PLAYER_LANE;
      b.disabled = blocked || dir === 'left' && you!.file === 0 || dir === 'right' && you!.file === this.view!.boss.cols - 1
        || dir === 'back' && you!.lane === lo || dir === 'forward' && you!.lane === lanes - 1;
    });
    // One owner of the pad's dead state. Two sources of truth means the pad greyed while the field
    // is live, or lit while every step is refused — both read as "travado".
    this.el.controls?.querySelector('.d-pad')?.classList.toggle('dead', blocked);
    this.el.controls!.querySelector('.position')!.textContent = you ? panelName(you) : 'SYNC';
  }

  frame(now: number): void {
    if (!this.mounted || !this.view) return;
    const you = this.view.you;
    const elapsed = Math.max(0, now - this.snapshotAt);
    const left = Math.max(0, (you?.readyIn ?? 0) - (you?.frozen || you?.down || this.over ? 0 : elapsed));
    const fill = you?.hand ? 1 : fraction(1 - left / Math.max(1, you?.chargeMs ?? 1));
    this.el.charge!.querySelector<HTMLElement>('i')!.style.transform = `scaleX(${fill.toFixed(4)})`;
    this.el.charge!.querySelector('.label')!.textContent = this.over ? 'FIELD CLOSED' : you?.hand ? 'HAND OPEN · PICK IN ORDER' : `HAND IN ${(left / 1000).toFixed(1)}s · AUTO DEAL`;
    const wait = this.cs.querySelector('.cs-charge .time');
    if (wait) wait.textContent = this.over ? 'FIELD CLOSED' : `${(left / 1000).toFixed(1)}s`;
    const remaining = this.el.warn!.querySelector('.remaining');
    if (remaining && this.view.hazard) remaining.textContent = `${(Math.max(0, this.view.hazard.left - elapsed) / 1000).toFixed(2)}s`;
    if (this.noticeUntil && now >= this.noticeUntil) {
      this.noticeUntil = 0;
      this.el.hint!.textContent = 'WASD / arrows: dodge (banks Charge) · R: cover · ENTER fires the program';
    }
    for (const hold of this.holds.values()) {
      if (hold.kind === 'step' && now >= hold.next && hold.dir) {
        this.h.step(hold.dir);
        hold.next = now + 180;
      }
    }
  }

  notice(text: string): void {
    this.el.hint!.textContent = text;
    this.noticeUntil = performance.now() + 4500;
  }

  event(e: SF.FieldEvent): void {
    const owner = 'owner' in e ? this.view?.players.find((p) => p.id === e.owner)?.name ?? 'CHOG' : '';
    const targetId: string | undefined = 'target' in e ? e.target : undefined;
    const target = targetId ? this.view?.players.find((p) => p.id === targetId)?.name ?? null : null;
    let text = '';
    switch (e.type) {
      case 'shot-fired': text = `${owner} · ${SF.battleCard(e.cardId)?.name ?? e.cardId} · ${e.damage} shot might${e.counter ? ' · COUNTER' : ''}`; break;
      case 'hit': text = `${owner} · ${e.damage} DAMAGE${e.counter ? ' · COUNTER' : ''}`; break;
      case 'miss': text = `${owner} · CARD MISSED`; break;
      case 'blocked': text = `${owner} · WALL BLOCKED`; break;
      case 'took-hit': text = `${owner} · TOOK ${e.damage}`; break;
      case 'telegraph': text = `${e.label} · ${this.moves.find((m) => m.id === e.move)?.read ?? 'Read the marked panels'}`; break;
      case 'strike': text = `${e.label} · STRIKE`; break;
      case 'hand': text = `${owner} · HAND ${e.open ? 'OPENED' : 'FIRED'}`; break;
      case 'dodge': text = `${owner} · DODGED`; break;
      case 'down': text = `${owner} · DOWN`; break;
      case 'revived': text = `${owner} · REVIVED`; break;
      case 'lost': text = `${owner} · LOST`; break;
      case 'bonus-card': text = `${owner} · BONUS CARD BANKED`; break;
      case 'drain': text = `${owner} · +${e.amount} INTEGRITY`; break;
      case 'stun': text = `${target ?? 'RIFT'} STUNNED · ${e.ms}ms`; break;
      case 'knock': text = `RIFT BREAK · FILE ${e.file + 1}`; break;
      case 'burn': text = `${target ?? 'RIFT'} BURNING · ${e.ticks}x${e.damage}`; break;
      case 'burn-tick': text = `${target ?? 'RIFT'} BURN · -${e.damage} (${e.left} left)`; break;
      case 'freeze': text = `${target ?? 'RIFT'} FROZEN · ${(e.ms / 1000).toFixed(1)}s SLOW`; break;
      case 'barrier': text = `${owner} · BARRIER x${e.charges}`; break;
      case 'ward': text = `${owner} · WARD ABSORBED (${e.left} left)`; break;
      case 'guard-break': text = 'RIFT GUARD BROKEN'; break;
      case 'phase': text = `RIFT PHASE ${e.phase}`; break;
      case 'boss-down': text = 'RIFT DOWN'; break;
    }
    if (!text) return;
    this.logs.push(text);
    this.logs = this.logs.slice(-3);
    // One line. A stack of three was a transcript nobody read while dodging; the last thing that
    // happened is the only thing that changes what you do next.
    this.paint('event', this.logs.length ? `<div>${esc(this.logs[this.logs.length - 1]!)}</div>` : '');
  }

  hurtFlash(): void {
    this.screenFlash(false);
  }

  /**
   * The clean-dodge tell. A step that escaped a marked panel is the one moment the fight is
   * decided and it used to land as silence plus a small word in the corner; the border closing in
   * mint is the receipt. It never replaces the hurt flash — a hit and a dodge in the same beat
   * draw red, because the hit is what the player must react to.
   */
  dodgeFlash(): void {
    this.screenFlash(true);
  }

  /**
   * Fullscreen edge flash without touching layout. Restarting a CSS animation needs the
   * reflow trick (`void offsetWidth`), which forces sync layout plus a layer rebuild right
   * on the dodge beat — exactly when the canvas cannot afford a missed composite. The Web
   * Animations pulse restarts cleanly and runs on the compositor; the latest call wins, so
   * a hit landing inside a dodge still draws red.
   */
  private flashAnim: Animation | null = null;
  private flashHit = false;
  private screenFlash(dodge: boolean): void {
    // A hit owns the beat: same rule as the old class version — a dodge never paints
    // over red.
    if (dodge && this.flashHit) return;
    const el = this.el.flash!;
    el.classList.toggle('dodge', dodge);
    this.flashAnim?.cancel();
    this.flashHit = !dodge;
    const anim = el.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: dodge ? 350 : 450, easing: 'ease-out' });
    if (!dodge) anim.onfinish = () => { if (this.flashAnim === anim) this.flashHit = false; };
    this.flashAnim = anim;
  }

  private readonly onClick = (e: MouseEvent): void => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    if (b.dataset.cell !== undefined) this.h.pick(Number(b.dataset.cell));
    else if (b.dataset.act === 'undo') this.h.undo();
    else if (b.dataset.act === 'clear') this.h.clear();
    else if (b.dataset.act === 'execute') this.h.execute();
    else if (b.dataset.act === 'leave') this.h.leave();
    else if (b.dataset.act === 'close') this.h.close();
    else if (e.detail === 0 && b.dataset.dir) this.h.step(b.dataset.dir as SF.StepDir);
    else if (e.detail === 0 && b.dataset.cover) {
      const source = `accessible-cover:${b.dataset.cover}`;
      const hold = this.holds.get(-1);
      if (hold) this.h.cover(null, hold.source);
      if (hold?.target === b.dataset.cover) this.holds.delete(-1);
      else {
        this.holds.set(-1, { kind: 'cover', source, target: b.dataset.cover, next: 0 });
        this.h.cover(b.dataset.cover, source);
      }
    }
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-dir],[data-cover]');
    if (!button || button.disabled || e.button !== 0 || this.over) return;
    e.preventDefault();
    const source = `pointer:${e.pointerId}`;
    const hold: Hold = { kind: button.dataset.dir ? 'step' : 'cover', source, next: performance.now() + 260 };
    if (button.dataset.dir) { hold.dir = button.dataset.dir as SF.StepDir; this.h.step(hold.dir); }
    else { hold.target = button.dataset.cover!; this.h.cover(hold.target, source); }
    this.holds.set(e.pointerId, hold);
    // Capture on the stable root: snapshots may repaint the party's COVER button underneath us.
    this.root.setPointerCapture(e.pointerId);
  };

  private readonly onPointerEnd = (e: PointerEvent): void => {
    const hold = this.holds.get(e.pointerId);
    if (!hold) return;
    this.holds.delete(e.pointerId);
    if (hold.kind === 'cover') this.h.cover(null, hold.source);
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
  };

  readonly releasePointers = (): void => {
    for (const [id, hold] of this.holds) {
      this.holds.delete(id);
      if (hold.kind === 'cover') this.h.cover(null, hold.source);
      if (this.root.hasPointerCapture(id)) this.root.releasePointerCapture(id);
    }
  };

  markOver(): void {
    this.over = true;
    this.releasePointers();
    this.el.warn!.classList.remove('on');
    this.el.cover!.classList.remove('on');
    this.el.down!.classList.remove('on');
    this.renderCustom();
    this.setControls(this.view?.you ?? null);
  }

  showEnd(m: Receipt, training: boolean): void {
    const title = m.won ? training ? 'SIMULATION CLEARED' : m.pvp ? 'BOUT WON' : 'RIFT CLEARED' : m.reason === 'draw' ? 'DRAW — STAKES RETURNED' : m.reason === 'wiped' ? 'SIGNAL LOST' : m.reason === 'gone' ? 'FIELD EXPIRED' : 'FIELD LEFT';
    const rewards = [
      ...(m.xp !== undefined ? [`+${num(m.xp)} XP`] : []),
      ...(m.wav !== undefined ? [`+${num(m.wav)} WAV TOTAL`] : []),
      ...m.cards.map((id) => `CARD · ${SF.battleCard(id)?.name ?? id}`),
      ...m.items.map((id) => `ITEM · ${id}`),
      ...(m.refunded ?? []).map((r) => `CARD REFUND · ${r.name} · ${num(r.wav)} WAV INCLUDED IN TOTAL`),
      ...(m.level ? [`LEVEL ${m.level.to}`] : []),
    ];
    this.el.end!.className = `d-end on ${m.won ? 'win' : 'lose'}`;
    this.el.end!.innerHTML = `<div class="receipt panel chamfer" role="dialog" aria-modal="true" aria-label="Field result receipt">
      <header>AUTHORITATIVE FIELD RECEIPT${m.first ? ' · FIRST CLEAR' : ''}</header><h2>${title}</h2><p>${esc(m.name)} · ${m.seconds.toFixed(1)}s</p>
      <div class="receipt-grade"><b>${esc(m.rank.letter)}</b><div>RANK LEVEL ${m.rank.level}<small>${m.rank.counters} COUNTERS · ${m.rank.abacks} ABACKS</small></div></div>
      <p class="read">${esc(m.rank.read)}</p><dl><div><dt>DROP ROLLS</dt><dd>${m.drop.rolls}</dd></div><div><dt>RARE CHANCE</dt><dd>${pct(m.drop.rareChance * 100)}</dd></div><div><dt>WAVE DRAIN</dt><dd>${m.wave < 0 ? '−' : ''}${Math.abs(m.wave).toFixed(1)}${m.wave < 0 ? ' · WAVE INCREASED' : ''}</dd></div></dl>
      <div class="rews">${rewards.map((r) => `<span>${esc(r)}</span>`).join('') || '<span>No inventory reward.</span>'}</div>
      ${m.level?.unlocks?.length ? `<p>UNLOCKED · ${esc(m.level.unlocks.join(' · '))}</p>` : ''}
      ${m.quests.length ? `<p>QUESTS · ${esc(m.quests.join(' · '))}</p>` : ''}
      ${m.lockoutMs > 0 ? `<p>RE-ENTRY LOCKOUT · ${Math.ceil(m.lockoutMs / 1000)}s</p>` : ''}
      <button class="primary" data-act="close">CONTINUE <small>ENTER</small></button>
    </div>`;
    this.el.end!.querySelector<HTMLButtonElement>('[data-act="close"]')?.focus({ preventScroll: true });
  }

  get isOpen(): boolean { return !this.over && !!this.view?.you?.hand; }
  get ended(): boolean { return this.el.end!.classList.contains('on'); }

  unmount(): void {
    this.releasePointers();
    this.root.removeEventListener('click', this.onClick);
    this.cs.removeEventListener('click', this.onClick);
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('lostpointercapture', this.onPointerEnd);
    window.removeEventListener('pointerup', this.onPointerEnd, { capture: true });
    window.removeEventListener('pointercancel', this.onPointerEnd, { capture: true });
    window.removeEventListener('blur', this.releasePointers);
    this.root.remove();
    if (this.mounted) {
      this.cs.classList.remove('on', 'duel');
      this.cs.innerHTML = '';
    }
    this.mounted = false;
    this.view = null;
    this.signatures.clear();
    this.logs = [];
  }
}
