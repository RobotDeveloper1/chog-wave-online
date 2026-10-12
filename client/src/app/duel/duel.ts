import * as THREE from 'three';
import { SF, type DuelStartMsg, type DuelTickMsg, type DuelEndMsg, type DuelPickMsg, type DuelCoverMsg, type DuelProgramMsg, type DuelBusterMsg, type DuelMsg, type SectorId } from '@chog/shared';
import { sfx } from '../../audio.ts';
import { net } from '../../net.ts';
import type { DistrictArt } from '../art.ts';
import type { Chog } from '../chogLoader.ts';
import type { Hud } from '../hud/hud.ts';
import type { Stage, DuelMood } from '../stage.ts';
import { Arena } from './arena.ts';
import { buildBoss, type BossAvatar } from './boss.ts';
import { Floaters } from './fx.ts';
import { ELEMENT_HEX, ELEMENT_PALETTES, FILES, PALETTES, clamp, easeOut, fileX, laneZ } from './theme.ts';
import { DuelUi, escapeHtml } from './ui.ts';

export interface DuelHost {
  stage: Stage;
  hud: Hud;
  /** The selected NFT's actual model; the duel borrows, never replaces or disposes it. */
  chog: Chog;
  sector: SectorId;
  art: DistrictArt;
  enter: () => void;
  onClose: (info: { won: boolean; training: boolean }) => void;
  toast: (t: { title: string; sub?: string; colour?: string }) => void;
  say: (text: string, cls?: string) => void;
}

type Mode = 'anomaly' | 'train' | 'node';
type Message = DuelStartMsg | DuelTickMsg | DuelEndMsg | DuelPickMsg | DuelCoverMsg
  | DuelProgramMsg | DuelBusterMsg | { kind: 'refused'; reason?: string };

function look(bloom = 0.4): DuelMood['look'] {
  return { bloom: { strength: bloom, radius: 0.5, threshold: 0.86 }, exposure: 0.95,
    vignette: 0.42, saturation: 1.22, contrast: 1.12, shadowTint: [0.94, 0.97, 1.08],
    highlightTint: [1.04, 1, 0.96], tilt: 0, grain: 0, tone: 'aces' };
}
const mood = (bg: string, sky: string, bounce: string, key: string, fill: string): DuelMood =>
  ({ bg, sky, bounce, key, fill, hemi: 1, sun: 1.8, sunAt: [8, 16, 14], fillI: 0.7, look: look() });
const MOODS: Record<SectorId, DuelMood> = {
  ashflat: mood('#150a2c', '#8a7cff', '#2a1240', '#ffd8b0', '#ff8a5c'),
  voltgrid: mood('#02040e', '#4a8cff', '#0a1a3a', '#9fd8ff', '#ff4fd8'),
  hollow: mood('#0b1a17', '#9fe8d0', '#143a30', '#e8ffe0', '#6fe3c8'),
};
const ELEMENT_MOODS: Record<string, DuelMood> = {
  burn: mood('#14060a', '#ff9a6a', '#3a1208', '#ffd0a0', '#ff5a2a'),
  frost: mood('#040c1c', '#9ad8ff', '#0e2a44', '#e6f6ff', '#6ab0ff'),
  volt: mood('#07061a', '#8a7cff', '#1a1448', '#fff0a0', '#ffe45c'),
  wave: mood('#021018', '#6fe3c8', '#08303a', '#d0fff0', '#2f9bff'),
  prism: mood('#120826', '#d9b8ff', '#2a1450', '#fff0ff', '#6af0ff'),
  void: mood('#04010a', '#8a5cff', '#14062a', '#d8c8ff', '#ff3a9a'),
};

/** Live camera tuning remains available through the shell's __duelcam. */
/**
 * Head-on and narrow, so the floor reads as the tall panel of a DS top screen rather than a
 * landscape diorama: a low elevation lets the five lanes recede *up* the picture, and a smaller
 * half-width keeps the files from spreading it back out sideways.
 */
/**
 * Framed like the DS top screen: dead-centre (az 0), a mid elevation so the floor reads as a
 * receding trapezoid rather than a flat grid, and a narrow half-width so the panel fills the
 * picture with the player's back at the bottom and the anomaly at the top.
 */
/**
 * The DS top-screen framing, seen from behind Mega Man: azimuth 90 puts the camera on the player's
 * side of the board looking down the lanes, so the files run left-to-right exactly as the arrow keys
 * and A/D move, and the anomaly stands at the top of the screen with its health over its head.
 * A side-on azimuth reads as a diorama; this reads as a fight you are standing in.
 */
export const DUEL_CAM = { az: 90, el: 34, half: 3.85, minDist: 16, fz: -0.1, fy: 1.15, up: 0.92, fov: 50, chog: 1.45, roomZoom: 0.18, roomShift: 0.23 };
const CHOG_FACING = Math.PI - 0.5;
const KEY_DIR: Record<string, SF.StepDir> = {
  a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
  w: 'back', arrowup: 'back', s: 'forward', arrowdown: 'forward',
};

export class Duel {
  private arena: Arena | null = null;
  private boss: BossAvatar | null = null;
  private readonly ui: DuelUi;
  private readonly floaters: Floaters;
  private view: SF.DuelView | null = null;
  private previousPlayers: SF.PlayerView[] = [];
  private phase: 'wait' | 'field' | 'ended' = 'wait';
  private training = false;
  private started = false;
  private disposed = false;
  private leaving = false;
  private readonly off: (() => void)[] = [];
  private readonly timers = new Set<number>();
  private readonly busterSources = new Set<string>();
  private readonly keys = new Map<string, number>();
  private coverTarget: string | null = null;
  private coverSource: string | null = null;
  private files = FILES;
  private t = 0;
  private myX = 0;
  private myZ = 0;
  private hop = 0;
  private shake = 0;
  private punch = 0;
  private room = 0;
  private orbit = 0;
  private victory = 0;
  private defeat = 0;
  private animationLeft = 0;
  private warn: { hazard: SF.HazardView; at: number } | null = null;
  private pendingEnd: DuelEndMsg | null = null;
  private escAt = -Infinity;
  private shotSerial = 0;
  private readonly shots = new Map<string, string[]>();
  private readonly saved;

  constructor(private readonly host: DuelHost, private readonly mode: Mode) {
    const { chog, stage } = host;
    this.saved = { parent: chog.root.parent, position: chog.root.position.clone(),
      rotation: chog.root.rotation.clone(), scale: chog.root.scale.clone(), visible: chog.root.visible,
      filter: stage.renderer.domElement.style.filter, rig: stage.rig,
      focus: stage.director.focusPoint().clone(),
      scenery: stage.scene.children.filter((o) => o !== chog.root && !(o instanceof THREE.Light))
        .map((object) => ({ object, visible: object.visible })),
      cameraPosition: stage.camera.position.clone(), cameraRotation: stage.camera.quaternion.clone(),
      cameraView: stage.camera.view ? { ...stage.camera.view } : null,
      fov: stage.camera.fov, near: stage.camera.near, far: stage.camera.far };
    this.ui = new DuelUi(host.hud.top, host.hud.csEl, {
      step: (dir) => this.step(dir), pick: (cell) => this.pick(cell),
      undo: () => this.customAction('undo'), clear: () => this.customAction('clear'),
      execute: () => this.customAction('execute'),
      buster: (down, source) => this.buster(down, source),
      cover: (target, source) => this.cover(target, source),
      leave: () => this.askLeave(), close: () => this.finish(),
    });
    this.floaters = new Floaters(this.ui.floatHost);
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.off.push(net.on('duel', (m: Message) => this.onMessage(m)));
    this.off.push(net.on('disconnect', () => this.onDisconnect()));
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('blur', this.releaseControls);
    document.addEventListener('visibilitychange', this.onVisibility);
    // A node is already entered by the server. The shell creates us while dispatching its start.
    if (this.mode !== 'node') this.send({ action: 'enter', mode: this.mode });
  }

  get active(): boolean { return !this.disposed; }

  private send(m: Omit<DuelMsg, 't'>): void {
    // Never queue a stale hold release to be replayed after a reconnect.
    if (!net.connected && m.action !== 'enter') return;
    net.send('duel', { ...m });
  }

  private onMessage(m: Message): void {
    if (this.disposed) return;
    switch (m.kind) {
      case 'start': {
        if (this.phase !== 'wait') return;
        this.training = m.view.boss.training;
        if (!this.arena) this.build(m.view);
        this.phase = 'field';
        this.ui.setManual(m.moves, m.caps);
        this.applyView(m.view, true);
        sfx.spawn();
        break;
      }
      case 'tick':
        if (this.phase !== 'field' || m.view.session !== this.view?.session) return;
        this.applyView(m.view);
        this.applyEvents(m.events);
        break;
      case 'pick':
        if (!m.ok) this.ui.notice(m.reason ? SF.REFUSAL_TEXT[m.reason] : 'The server refused that pick.');
        else sfx.pick();
        break;
      case 'program':
        if (!m.ok) this.ui.notice('The server could not execute this screen.');
        // Programs do not launch projectiles here; shot-fired events own each actual shot.
        break;
      case 'buster':
        if (!m.ok) {
          this.busterSources.clear();
          this.ui.setBusterHeld(false);
          this.ui.notice('Buster unavailable: wait for the field to unlock.');
        }
        break;
      case 'cover':
        if (!m.ok) {
          this.coverTarget = this.coverSource = null;
          this.ui.notice(m.reason ? this.coverReason(m.reason) : 'Cannot cover that partner.');
        }
        break;
      case 'end': this.onEnd(m); break;
      case 'refused':
        if (this.phase === 'wait') {
          this.host.toast({ title: 'CANNOT PULSE IN', sub: m.reason ?? 'The server refused entry.', colour: 'var(--rose)' });
          this.finish();
        } else this.ui.notice(m.reason ?? 'The server refused that field action.');
        break;
    }
  }

  private coverReason(reason: SF.ReviveReason): string {
    return { solo: 'No partner on this field.', 'not-down': 'That partner is already standing.',
      'out-of-reach': 'Move to a neighbouring file.', 'same-file': 'Cover from the neighbouring file, not the same file.',
      'rescuer-down': 'A downed body cannot cover.' }[reason];
  }

  private build(v: SF.DuelView): void {
    const { stage, chog, hud } = this.host;
    this.host.enter();
    for (const { object } of this.saved.scenery) object.visible = false;
    const element = v.place.kind === 'dungeon' ? v.boss.element : null;
    stage.setDuelMood((element && ELEMENT_MOODS[element]) || MOODS[this.host.sector]);
    this.arena = new Arena(element ? ELEMENT_PALETTES[element] : PALETTES[this.host.sector]);
    this.files = v.boss.cols;
    this.arena.setFiles(this.files);
    stage.scene.add(this.arena.group);
    this.boss = buildBoss(v.boss.archetype, v.boss.element, v.boss.tier);
    this.arena.group.add(this.boss.root);
    this.boss.root.position.x = fileX(v.boss.file, this.files);
    this.boss.moveTo(this.boss.root.position.x);
    this.boss.root.position.z = laneZ(v.boss.lane);
    this.myX = fileX(v.you?.file ?? 1, this.files);
    this.myZ = laneZ(v.you?.lane ?? SF.LANES - 1);
    chog.root.visible = true;
    chog.root.scale.setScalar(DUEL_CAM.chog);
    chog.root.rotation.set(0, CHOG_FACING, 0);
    chog.root.position.set(this.myX, 0.12, this.myZ);
    chog.setSpeed(0);
    chog.play('idle');
    this.arena.group.add(chog.root);
    hud.deck.classList.add('dueling');
    hud.menu(false);
    hud.tabsEl.innerHTML = '';
    hud.sheetEl.classList.remove('on');
    this.ui.mount({ tokenId: net.me?.tokenId ?? net.me?.build.tokenId ?? 0,
      name: net.me?.build.callsign ?? v.you?.name ?? 'CHOG',
      element: net.me?.build.loadout.element ?? v.you?.tribe ?? 'prism',
      level: net.profile?.level ?? net.me?.level ?? 1,
      traitsSource: net.me?.traitsSource ?? 'predicted', loadout: net.me?.build.loadout });
    stage.setCameraControl((cam, dt) => this.pose(cam, dt));
    stage.setBounds(null);
    stage.focusOn(0, DUEL_CAM.fy, 0);
    // The city vanished this same task; without a snap the director lerps the street rig
    // across to the duel pose and every frame of that swing is black void — the player
    // reads it as the screen dying when the anomaly hits. Cut, do not travel.
    stage.snap();
  }

  private applyView(v: SF.DuelView, first = false): void {
    const previous = this.view;
    this.previousPlayers = previous?.players ?? [];
    this.view = v;
    this.files = v.boss.cols;
    this.arena?.setFiles(this.files);
    if (v.you) {
      this.myX = fileX(v.you.file, this.files);
      this.myZ = laneZ(v.you.lane);
    }
    this.boss?.moveTo(fileX(v.boss.file, this.files));
    this.arena?.setWall(v.boss.blocked);
    if (v.you && !first && (previous?.you?.file !== v.you.file || previous?.you?.lane !== v.you.lane)) {
      this.hop = 1;
      this.arena?.flash(v.you.file, v.you.lane, 0.5);
      sfx.step();
    }
    this.arena?.setMine(v.you && !v.you.down ? v.you : null);
    this.arena?.setAllies(v.players.filter((p) => p.id !== v.you?.id && !p.down));
    this.arena?.setBodies(v.players.filter((p) => p.down));
    this.warn = v.hazard ? { hazard: v.hazard, at: performance.now() } : null;
    this.arena?.setTelegraph(v.hazard?.panels ?? null);
    this.ui.setView(v);
    this.host.hud.deck.classList.toggle('customopen', !!v.you?.custom);
    if (!previous?.you?.custom && v.you?.custom) sfx.customOpen();
    if (previous?.you?.custom && !v.you?.custom) sfx.customClose();
    if (!v.you || v.you.custom || v.you.down || v.you.frozen) this.releaseControls();
    if (this.coverTarget && (previous?.you?.revive && !v.you?.revive
      || !v.players.some((p) => p.id === this.coverTarget && p.down))) {
      this.coverTarget = this.coverSource = null;
    }
  }

  private bodyPoint(owner: string, y = 2.2): THREE.Vector3 {
    if (owner === this.view?.you?.id) return new THREE.Vector3(this.myX, y, this.myZ);
    const body = this.view?.players.find((p) => p.id === owner) ?? this.previousPlayers.find((p) => p.id === owner);
    return new THREE.Vector3(fileX(body?.file ?? 1, this.files), y, laneZ(body?.lane ?? SF.LANES - 1));
  }

  private bossPoint(dy = 0): THREE.Vector3 {
    return new THREE.Vector3(this.boss?.root.position.x ?? 0, (this.boss?.root.position.y ?? 2.4) + dy,
      laneZ(this.view?.boss.lane ?? 2));
  }

  private floater(at: THREE.Vector3, text: string, cls = '', life = 1.2): void {
    // Floaters uses innerHTML; all names and server words cross this boundary escaped.
    this.floaters.add(at, escapeHtml(text), cls, life);
  }

  private applyEvents(events: SF.FieldEvent[]): void {
    for (const e of events) {
      this.ui.event(e);
      const mine = 'owner' in e && e.owner === this.view?.you?.id;
      switch (e.type) {
        case 'shot-fired': {
          const from = this.bodyPoint(e.owner, 1.5);
          const to = this.bossPoint();
          to.x = fileX(e.files.includes(this.view!.boss.file) ? this.view!.boss.file : (e.files[0] ?? this.view!.boss.file), this.files);
          const key = `${e.owner}:${e.chipId}`;
          const id = `sf-shot-${++this.shotSerial}`;
          const queue = this.shots.get(key) ?? [];
          queue.push(id);
          this.shots.set(key, queue);
          this.arena?.shots.fire({ chipId: id, element: e.element, from, to,
            big: e.cls !== 'standard', fused: false, flight: SF.SHOT_FLIGHT_MS / 1000 });
          sfx.shot(e.element);
          if (mine) this.animate('attack');
          if (e.counter) this.floater(from.clone().add(new THREE.Vector3(0, 1, 0)), 'COUNTER SHOT', 'chain');
          break;
        }
        case 'hit':
          this.resolveShot(e.owner, e.chipId, { hit: true, damage: e.damage, weak: e.weak, chain: e.chain });
          this.landed(e.damage, e.weak, e.chain, e.element, mine);
          if (e.counter) this.floater(this.bossPoint(1.4), 'COUNTER', 'chain');
          break;
        case 'miss':
          this.resolveShot(e.owner, e.chipId, { hit: false });
          this.floater(this.bossPoint(), 'MISS', 'miss');
          break;
        case 'blocked':
          this.resolveShot(e.owner, e.chipId, { hit: false, blocked: true });
          this.floater(this.bossPoint(), 'BLOCKED', 'miss');
          break;
        case 'telegraph':
          sfx.warn();
          break;
        case 'strike':
          for (const p of e.panels) this.arena?.strike(p);
          this.boss?.lunge();
          this.shake = Math.max(this.shake, 0.35);
          sfx.strike();
          break;
        case 'took-hit':
          this.floater(this.bodyPoint(e.owner), `-${e.damage}`, 'hurt');
          if (mine) {
            this.ui.hurtFlash();
            this.animate('hit');
            this.shake = Math.max(this.shake, 0.9);
            sfx.hurt();
          }
          this.arena?.particles.burst(this.bodyPoint(e.owner, 1.2), new THREE.Color(2.4, 0.4, 0.5), 22, 6, 0.6, 0.26);
          break;
        case 'dodge':
          this.floater(this.bodyPoint(e.owner), 'DODGED', 'dodge');
          if (mine) sfx.dodge();
          break;
        case 'buster': {
          const from = this.bodyPoint(e.owner, 1.4);
          const to = this.bossPoint();
          const body = this.view?.players.find((p) => p.id === e.owner);
          to.x = fileX(body?.file ?? this.view?.you?.file ?? 1, this.files);
          const id = `sf-buster-${++this.shotSerial}`;
          this.arena?.shots.fire({ chipId: id, element: 'prism', from, to, big: e.charged, fused: false, flight: 0.16 });
          this.arena?.shots.resolve(id, { hit: e.damage > 0, damage: e.damage });
          if (e.damage > 0) this.landed(e.damage, 1, 0, 'prism', mine);
          else this.floater(to, 'BUSTER MISS', 'miss');
          if (mine) this.animate('attack');
          sfx.shot('prism');
          break;
        }
        case 'drain': this.floater(this.bodyPoint(e.owner), `+${e.amount} INTEGRITY`, 'heal'); break;
        case 'bonus-card': this.floater(this.bodyPoint(e.owner, 3.2), 'BONUS CARD', 'chain'); break;
        case 'guard-break': this.floater(this.bossPoint(1), 'GUARD BROKEN', 'big'); break;
        case 'stun': this.floater(this.bossPoint(1), `STUN ${Math.round(e.ms)}ms`, 'dodge'); break;
        case 'knock': this.floater(this.bossPoint(1), `BREAK · FILE ${e.file + 1}`, 'dodge'); break;
        case 'phase':
          this.floater(this.bossPoint(1), `PHASE ${e.phase}`, 'big');
          this.shake = Math.max(this.shake, 0.7);
          this.arena?.rings.spawn(this.bossPoint(), new THREE.Color(1.5, 0.3, 0.4), 9, 0.8, false);
          sfx.phase();
          break;
        case 'down':
          this.floater(this.bodyPoint(e.owner), 'DOWN', 'hurt', 1.8);
          if (mine) this.releaseControls();
          break;
        case 'revived': this.floater(this.bodyPoint(e.owner), 'BACK UP', 'heal', 1.6); sfx.dodge(); break;
        case 'lost': this.floater(this.bodyPoint(e.owner), 'SIGNAL LOST', 'miss', 1.8); break;
        case 'boss-down': this.boss?.die(); break;
        case 'custom': break;
      }
    }
  }

  private resolveShot(owner: string, chip: string, outcome: { hit: boolean; damage?: number; weak?: number; chain?: number; blocked?: boolean }): void {
    const key = `${owner}:${chip}`;
    const queue = this.shots.get(key);
    const id = queue?.shift();
    if (id) this.arena?.shots.resolve(id, outcome);
    if (!queue?.length) this.shots.delete(key);
  }

  private landed(damage: number, weak: number, chain: number, element: string, mine: boolean): void {
    const at = this.bossPoint();
    this.floater(at, `${damage.toLocaleString()}${weak > 1 ? '!' : ''}`, weak > 1 ? 'weak' : weak < 1 ? 'resist' : '');
    if (chain > 0) this.floater(at.clone().add(new THREE.Vector3(1.4, 1.4, 0)), `CHAIN ×${SF.chainMultiplier(chain).toFixed(2)}`, 'chain');
    const c = new THREE.Color(ELEMENT_HEX[element] ?? 0xffffff).multiplyScalar(1.6);
    this.arena?.particles.burst(at, c, 24, 6, 0.6, 0.28);
    this.boss?.hurt(clamp(damage / 2200, 0.35, 1));
    this.shake = Math.max(this.shake, clamp(damage / 3500, 0.12, mine ? 0.7 : 0.3));
    this.punch = Math.max(this.punch, mine ? 0.35 : 0.1);
    sfx.hitBoss(weak);
  }

  private animate(name: 'hit' | 'attack'): void {
    this.host.chog.play(name);
    this.animationLeft = name === 'hit' ? 0.52 : 0.65;
  }

  private step(dir: SF.StepDir): void {
    const you = this.view?.you;
    // `frozen` IS custom-open-or-firing, the same test the server runs in
    // canAct. The old `|| you.custom` blocked every step: the view carries the
    // dealt hand as a non-null custom state from the join, so the check was
    // always true and WASD never moved the body.
    if (this.phase !== 'field' || this.leaving || !you || you.down || you.frozen) return;
    this.cover(null);
    this.send({ action: 'step', dir });
    // No predicted file/lane: the next snapshot is the only movement authority.
  }

  private pick(cell: number): void {
    const candidate = this.view?.you?.custom?.cells.find((c) => c.cell === cell);
    if (this.phase !== 'field' || this.leaving || !candidate || candidate.picked || candidate.locked) return;
    this.send({ action: 'pick', cell });
  }

  private customAction(action: 'undo' | 'clear' | 'execute'): void {
    if (this.phase !== 'field' || this.leaving || !this.view?.you?.custom) return;
    this.send({ action });
  }

  private buster(down: boolean, source: string): void {
    if (!down) {
      if (!this.busterSources.delete(source)) return;
      if (!this.busterSources.size) {
        this.ui.setBusterHeld(false);
        this.send({ action: 'buster', down: false });
      }
      return;
    }
    const you = this.view?.you;
    if (this.phase !== 'field' || this.leaving || !you || you.down || you.frozen || you.custom || this.busterSources.has(source)) return;
    const held = this.busterSources.size > 0;
    this.busterSources.add(source);
    this.cover(null);
    if (!held) {
      this.ui.setBusterHeld(true);
      this.send({ action: 'buster', down: true });
    }
  }

  private cover(target: string | null, source = 'controls'): void {
    if (target === null) {
      if (source !== 'controls' && this.coverSource !== source) return;
      if (this.coverTarget || this.view?.you?.revive) this.send({ action: 'cover', with: null });
      this.coverTarget = this.coverSource = null;
      return;
    }
    const you = this.view?.you;
    if (this.phase !== 'field' || this.leaving || !you || you.down || you.frozen || you.custom || this.coverTarget) return;
    this.releaseBuster();
    this.coverTarget = target;
    this.coverSource = source;
    this.send({ action: 'cover', with: target });
  }

  private releaseBuster(): void {
    if (!this.busterSources.size) return;
    this.busterSources.clear();
    this.ui.setBusterHeld(false);
    this.send({ action: 'buster', down: false });
  }
  private readonly releaseControls = (): void => {
    this.keys.clear();
    this.ui.releasePointers();
    this.releaseBuster();
    this.cover(null);
  };
  private readonly onVisibility = (): void => { if (document.hidden) this.releaseControls(); };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.disposed || (e.target as HTMLElement | null)?.closest('input,textarea,select,[contenteditable="true"]')) return;
    const k = e.key.toLowerCase();
    if (!KEY_DIR[k] && ![' ', 'b', 'r', 'enter', 'backspace', 'delete', 'c', 'escape'].includes(k) && !/^[1-6]$/.test(k)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.phase === 'ended') {
      if (!e.repeat && this.ui.ended && (k === 'enter' || k === 'escape')) this.finish();
      return;
    }
    if (e.repeat) return;
    if (KEY_DIR[k]) {
      if (this.keys.has(k)) return;
      this.keys.set(k, performance.now() + 240);
      this.step(KEY_DIR[k]!);
      return;
    }
    if (k === ' ' || k === 'b') this.buster(true, `key:${e.code || k}`);
    else if (k === 'r') {
      const you = this.view?.you;
      const ally = this.view?.players.find((p) => p.down && p.id !== you?.id && Math.abs(p.file - (you?.file ?? -9)) === 1);
      if (ally) this.cover(ally.id, 'key:r');
      else this.ui.notice('Hold R beside a downed partner on the neighbouring file.');
    } else if (/^[1-6]$/.test(k)) this.pick(Number(k) - 1);
    else if (k === 'enter') this.customAction('execute');
    else if (k === 'backspace') this.customAction('undo');
    else if (k === 'delete' || k === 'c') this.customAction('clear');
    else if (k === 'escape') this.askLeave();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (KEY_DIR[k] || [' ', 'b', 'r'].includes(k)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.keys.delete(k);
      if (k === ' ' || k === 'b') this.buster(false, `key:${e.code || k}`);
      else if (k === 'r') this.cover(null, 'key:r');
    }
  };

  private askLeave(): void {
    if (this.phase === 'ended') { if (this.ui.ended) this.finish(); return; }
    if (this.leaving) return;
    const now = performance.now();
    if (now - this.escAt < 1500) {
      this.releaseControls();
      this.leaving = true;
      this.send({ action: 'leave' });
      this.ui.notice('Leaving the field · waiting for the server receipt.');
    } else {
      this.escAt = now;
      this.ui.notice('Press Escape or tap LEAVE again to abandon this fight.');
    }
  }

  private onEnd(m: DuelEndMsg): void {
    if (this.phase === 'ended') return;
    this.releaseControls();
    this.phase = 'ended';
    this.pendingEnd = m;
    this.warn = null;
    this.arena?.setTelegraph(null);
    this.ui.markOver();
    this.host.hud.deck.classList.remove('customopen');
    if (m.won) {
      this.victory = 0.001;
      this.boss?.die();
      const colour = new THREE.Color(ELEMENT_HEX[this.view?.boss.element ?? 'prism'] ?? 0xffffff);
      this.arena?.particles.burst(this.bossPoint(), colour.clone().multiplyScalar(1.8), 140, 12, 1.4, 0.4);
      for (let i = 0; i < 4; i++) this.later(() => this.arena?.rings.spawn(this.bossPoint(), colour, 6 + i * 3, 0.9, false), i * 180);
      this.shake = 1;
      sfx.cleared();
      this.host.say(`${m.name} cleared`, 't-glitch');
    } else if (m.reason === 'wiped') {
      this.defeat = 0.001;
      sfx.defeat();
      this.host.stage.renderer.domElement.style.filter = 'grayscale(.75) brightness(.75)';
    }
    this.later(() => this.ui.showEnd(m, this.training), m.won ? 1500 : 800);
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => { this.timers.delete(id); if (!this.disposed) fn(); }, ms);
    this.timers.add(id);
  }

  private onDisconnect(): void {
    this.releaseControls();
    this.host.toast({ title: 'FIELD DISCONNECTED', sub: 'The connection closed; returning to the street.', colour: 'var(--rose)' });
    this.finish();
  }

  private finish(): void {
    if (this.disposed) return;
    const won = !!this.pendingEnd?.won;
    this.dispose();
    this.host.onClose({ won, training: this.training || this.mode === 'train' });
  }

  private pose(cam: THREE.PerspectiveCamera, dt: number): void {
    const C = DUEL_CAM;
    const aspect = cam.aspect || 1;
    // The camera rides the player's column, so the Chog always sits bottom-centre with the
    // anomaly ahead — the DS framing, where the field slides under a fixed player.
    const focus = new THREE.Vector3(this.myX, C.fy, C.fz);
    const k = this.room * this.room * (3 - 2 * this.room);
    const half = C.half + Math.max(0, this.files - FILES) * 0.55;
    const dist = Math.max(C.minDist, half / (Math.tan(C.fov * Math.PI / 360) * Math.max(0.8, aspect))) * (1 + C.roomZoom * k);
    const az = C.az * Math.PI / 180;
    const el = C.el * Math.PI / 180;
    const p = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(dist).add(focus);
    const aim = focus.clone();
    aim.y += C.up;
    p.y += Math.sin(this.t * 0.55) * 0.07;
    p.addScaledVector(p.clone().sub(focus).normalize(), -this.punch * 1.6);
    if (this.victory > 0) {
      this.orbit += dt * 0.35;
      p.x += Math.sin(this.orbit) * 3.2;
      p.z -= 2 + easeOut(this.victory / 2) * 1.5;
      p.y += 0.6;
      aim.set(0, 3.6, laneZ(this.view?.boss.lane ?? 2));
    }
    if (this.defeat > 0) {
      p.y -= easeOut(this.defeat / 1.2) * 1.4;
      p.z += easeOut(this.defeat / 1.2) * 1.6;
    }
    p.x += (Math.random() - 0.5) * this.shake * 0.5;
    p.y += (Math.random() - 0.5) * this.shake * 0.35;
    cam.position.copy(p);
    cam.lookAt(aim);
    cam.fov = C.fov - this.punch * 4;
    cam.near = 1;
    if (k > 0.001) cam.setViewOffset(1000 * aspect, 1000, C.roomShift * k * 1000 * aspect, 0, 1000 * aspect, 1000);
    else if (cam.view) cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }

  update(dt: number, now: number): void {
    if (this.disposed || !this.arena || !this.view) return;
    this.t += dt;
    for (const [key, next] of this.keys) {
      if (now >= next) {
        this.step(KEY_DIR[key]!);
        if (this.keys.has(key)) this.keys.set(key, now + 160);
      }
    }
    const { chog, stage } = this.host;
    const you = this.view.you;
    const smooth = 1 - Math.exp(-dt * 18);
    this.myX += (fileX(you?.file ?? 1, this.files) - this.myX) * smooth;
    this.myZ += (laneZ(you?.lane ?? 4) - this.myZ) * smooth;
    this.hop = Math.max(0, this.hop - dt * 4.5);
    chog.root.scale.setScalar(DUEL_CAM.chog);
    chog.root.position.set(this.myX, 0.12 + Math.sin(this.hop * Math.PI) * 0.45, this.myZ);
    chog.root.rotation.z += ((you?.down || this.defeat > 0 ? 1.25 : 0) - chog.root.rotation.z) * (1 - Math.exp(-dt * 7));
    chog.setSpeed(this.hop);
    chog.update(dt);
    if (this.animationLeft > 0) {
      this.animationLeft -= dt;
      if (this.animationLeft <= 0) chog.play('idle');
    }
    if (this.victory > 0) this.victory += dt;
    if (this.defeat > 0) this.defeat += dt;
    const h = this.warn;
    const left = h ? Math.max(0, h.hazard.left - (performance.now() - h.at)) : 0;
    const progress = h ? clamp(1 - left / Math.max(1, h.hazard.total), 0, 1) : 0;
    this.arena.setTelegraph(h?.hazard.panels ?? null, progress);
    this.arena.setBossMark(this.view.boss, !!this.boss && !this.boss.dead && this.phase !== 'ended');
    this.boss?.update(dt, this.t, { phase: this.view.boss.phase, warn: progress,
      hp: this.view.boss.hp / Math.max(1, this.view.boss.maxHp) });
    // buildBoss animates around its historical home lane; shift that animation to the SF lane.
    if (this.boss) this.boss.root.position.z += laneZ(this.view.boss.lane) - (laneZ(1) - 0.2);
    const canvas = stage.renderer.domElement;
    this.arena.update(dt, this.t, stage.camera, canvas.clientHeight || 1, stage.camera.fov);
    this.floaters.update(stage.camera, canvas.clientWidth || 1, canvas.clientHeight || 1);
    this.ui.frame(now);
    this.room += ((this.ui.isOpen ? 1 : 0) - this.room) * (1 - Math.exp(-dt * 6));
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.punch = Math.max(0, this.punch - dt * 2.6);
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseControls();
    this.disposed = true;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    for (const off of this.off) off();
    this.off.length = 0;
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('keyup', this.onKeyUp, { capture: true });
    window.removeEventListener('blur', this.releaseControls);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.floaters.clear();
    this.ui.unmount();
    const { stage, chog, hud } = this.host;
    stage.renderer.domElement.style.filter = this.saved.filter;
    if (this.arena) {
      chog.root.removeFromParent();
      if (this.saved.parent) this.saved.parent.add(chog.root);
      chog.root.position.copy(this.saved.position);
      chog.root.rotation.copy(this.saved.rotation);
      chog.root.scale.copy(this.saved.scale);
      chog.root.visible = this.saved.visible;
      chog.setSpeed(0);
      chog.play('idle');
      this.boss?.root.removeFromParent();
      this.boss?.root.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
        if (this.view?.boss.archetype === 'dummy' && object instanceof THREE.Mesh && object.parent !== this.boss?.root) {
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
          }
        }
      });
      this.boss?.dispose();
      this.arena.dispose();
      stage.setCameraControl(null);
      stage.camera.clearViewOffset();
      if (this.saved.cameraView) {
        stage.camera.view = { ...this.saved.cameraView };
      }
      stage.camera.position.copy(this.saved.cameraPosition);
      stage.camera.quaternion.copy(this.saved.cameraRotation);
      stage.camera.fov = this.saved.fov;
      stage.camera.near = this.saved.near;
      stage.camera.far = this.saved.far;
      stage.camera.updateProjectionMatrix();
      stage.setRig(this.saved.rig, true);
      stage.focusOn(this.saved.focus.x, this.saved.focus.y, this.saved.focus.z);
      for (const { object, visible } of this.saved.scenery) object.visible = visible;
      stage.setDistrict(this.host.art, this.host.sector);
    }
    this.arena = null;
    this.boss = null;
    this.shots.clear();
    this.view = null;
    this.previousPlayers = [];
    this.warn = null;
    this.pendingEnd = null;
    hud.deck.classList.remove('dueling', 'customopen');
  }
}
