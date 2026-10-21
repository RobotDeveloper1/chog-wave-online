import * as THREE from 'three';
import { ENCOUNTER_BY_ID, SF, type DuelStartMsg, type DuelTickMsg, type DuelEndMsg, type DuelPickMsg, type DuelCoverMsg, type DuelProgramMsg, type DuelRivalMsg, type DuelMsg, type SectorId } from '@chog/shared';
import { sfx } from '../../audio.ts';
import { net } from '../../net.ts';
import type { DistrictArt } from '../art.ts';
import { loadChogNFT, type Chog } from '../chogLoader.ts';
import type { Hud } from '../hud/hud.ts';
import type { Stage, DuelMood } from '../stage.ts';
import { Arena } from './arena.ts';
import { buildBoss, type BossAvatar } from './boss.ts';
import { buildCritter } from '../line/critters.ts';
import { Floaters } from './fx.ts';
import { ELEMENT_HEX, ELEMENT_PALETTES, FILES, LANES, PALETTES, clamp, easeOut, fileX, laneZ } from './theme.ts';
import { DuelUi, escapeHtml } from './ui.ts';
import { reduceMotion } from '../../settings.ts';

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

type Mode = 'anomaly' | 'train' | 'node' | 'pvp';
type Message = DuelStartMsg | DuelTickMsg | DuelEndMsg | DuelPickMsg | DuelCoverMsg
  | DuelProgramMsg | DuelRivalMsg | { kind: 'refused'; reason?: string };

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
/** The rival faces down-screen, toward the player. */
const RIVAL_FACING = 0.5;
/** Same manifests as the shell's MODEL: one collection, one set of parts. */
const RIVAL_MODEL = {
  baseUrl: '/models/chog-base.glb',
  partsUrl: '/models/trait-parts.json',
  colorsUrl: '/models/trait-colors.json',
  skinsUrl: '/models/skins.json',
  skullBaseUrl: '/models/chog-skull.glb',
  skullSkinsUrl: '/models/skull-skins.json',
};

/**
 * A Chog wearing the boss avatar's contract, so the duel loop never learns the
 * difference: position tracks the rival view, hurt/lunge play one-shots, death tips over.
 */
function chogAsAvatar(chog: Chog): BossAvatar {
  let dead = false;
  let targetX = chog.root.position.x;
  let hitAt = -Infinity;
  let pose: 'idle' | 'hit' = 'idle';
  return {
    root: chog.root,
    update(dt: number) {
      chog.root.position.x += (targetX - chog.root.position.x) * (1 - Math.exp(-dt * 10));
      chog.setSpeed(Math.abs(targetX - chog.root.position.x) > 0.05 ? 1 : 0);
      chog.update(dt);
      if (dead) {
        chog.root.rotation.z += (1.25 - chog.root.rotation.z) * (1 - Math.exp(-dt * 7));
        return;
      }
      const next = performance.now() - hitAt < 350 ? 'hit' : 'idle';
      if (next !== pose) { pose = next; chog.play(next); }
    },
    moveTo(x: number) { targetX = x; },
    hurt() { hitAt = performance.now(); chog.impulse(); },
    lunge() { chog.impulse(0.4); },
    die() { dead = true; },
    get dead() { return dead; },
    eye() { return chog.root.position.clone().add(new THREE.Vector3(0, 1.6, 0)); },
    dispose() { chog.root.parent?.remove(chog.root); },
  };
}

/**
 * Why the body cannot step, in a sentence.
 *
 * `frozen` on the wire covers three different states — the Hand is open, a program is in flight,
 * the Hand is holding you — and they read very differently to a player deciding what to
 * press next. The wire carries one boolean, so the reason is reconstructed from the rest of the
 * view. When the reason is not in the wire yet, the message still has to be actionable.
 */
// Only a program in flight locks the boots. An open screen no longer does: the server
// steps the body out of the safe room instead of refusing, so this message only ever
// fires for the firing state (`frozen && !open`).
const frozenWhy = (_you: SF.YouView): string =>
  'A program is firing — movement is locked for a moment.';
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
  /** The last freeze reason this client told the player, so one freeze is one notice. */
  private toldFreeze: string | null = null;
  private readonly off: (() => void)[] = [];
  private readonly timers = new Set<number>();
  private readonly keys = new Map<string, number>();
  private coverTarget: string | null = null;
  private coverSource: string | null = null;
  private files = FILES;
  private lanes = LANES;
  /** PvP side: side 1 sees every lane mirrored, self-near. Events arrive absolute. */
  private mySide: 0 | 1 = 0;
  private startMsg: DuelStartMsg | null = null;
  private rivalBuilding = false;
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
      undo: () => this.handAction('undo'), clear: () => this.handAction('clear'),
      execute: () => this.handAction('execute'),
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
    if (this.mode !== 'node' && this.mode !== 'pvp') this.send({ action: 'enter', mode: this.mode });
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
        this.startMsg = m;
        this.training = m.view.boss.training;
        if (!this.arena) this.build(m.view);
        this.phase = 'field';
        this.ui.setManual(m.moves, m.caps);
        this.applyView(m.view, true);
        sfx.spawn();
        break;
      }
      case 'rival': {
        // PvP late arrival: these boots stepped on first, so the start came without a
        // rival — the server pushes the other doc the moment it arrives. Stash it on the
        // start (so plate and faceless fallback agree) and build the model now.
        if (this.startMsg && !this.startMsg.rival) this.startMsg.rival = m.rival;
        if (this.phase === 'field' && this.view?.boss.archetype === 'rival') void this.buildRival(this.view);
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
    this.lanes = v.boss.lanes;
    this.arena.setFiles(this.files, this.lanes);
    stage.scene.add(this.arena.group);
    // A Line fight shows the same animal that was standing on the road: the session id
    // carries the encounter (`line:tolls.1`), and the roster, the region and the kind all
    // follow from it. Everywhere else — anomalies, dungeons, the Training Sim — the signal
    // keeps its mask.
    const lineEnc = v.session.startsWith('line:') ? ENCOUNTER_BY_ID.get(v.session.slice(5)) : undefined;
    this.boss = v.boss.archetype === 'rival' ? null : lineEnc
      ? buildCritter(lineEnc.region, lineEnc.kind, v.boss.element, v.session, 'duel', v.boss.archetype)
      : buildBoss(v.boss.archetype, v.boss.element, v.boss.tier);
    if (this.boss) this.arena.group.add(this.boss.root);
    if (this.boss) this.boss.root.position.x = fileX(v.boss.file, this.files);
    if (this.boss) this.boss.moveTo(this.boss.root.position.x);
    if (this.boss) this.boss.root.position.z = laneZ(v.boss.lane, this.lanes);
    if (v.boss.archetype === 'rival') void this.buildRival(v);
    this.myX = fileX(v.you?.file ?? 1, this.files);
    this.myZ = laneZ(v.you?.lane ?? this.lanes - 1, this.lanes);
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
    // The warmup renders below pose the duel camera, which needs the first view.
    this.view = v;
    this.prewarm();
  }

  /**
   * Warm every GL program the duel can need before the first presented frame.
   *
   * Pooled effects (rings, marks) are born invisible, shots are born per trigger,
   * and the first of each used to compile its program mid-fight — on D3D a mid-fight
   * compile stalls the WebGL surface and the field flashes black for a beat right on the
   * dodge or the strike. One of everything is built and really rendered here (a compile
   * kick can still link lazily, a render cannot), the warmup shots are cleared, and the
   * true state renders over it — all synchronously inside `build`, so no presented frame
   * ever shows the warmup state.
   */
  private prewarm(): void {
    if (!this.arena) return;
    const { stage } = this.host;
    // Shots are born per trigger, so none exist yet — and the first shot of each element
    // used to compile its program mid-fight. Fire one of every element plus the ring and
    // the burst the dodge plays, render them warm, then clear the shots before the true
    // state renders: nothing warmed is ever presented.
    const at = new THREE.Vector3(0, 0.6, 0);
    const white = new THREE.Color(1.6, 1.6, 1.6);
    for (const el of ['frost', 'wave', 'prism', 'void', 'volt', 'burn', 'none']) {
      this.arena.shots.fire({ cardId: `warm-${el}`, element: el, from: at, to: at, big: false, fused: false, flight: 60 });
    }
    this.arena.rings.spawn(at, white, 0.01, 0.01, true);
    this.arena.particles.burst(at, white, 1, 0.1, 0.01, 0.01);
    const hidden: THREE.Object3D[] = [];
    this.arena.group.traverse((o) => {
      if (!o.visible) { o.visible = true; hidden.push(o); }
    });
    try {
      stage.render(1 / 60);
    } catch { /* a failed warmup must never block entering the field */ }
    this.arena.shots.clear();
    for (const o of hidden) o.visible = false;
    try {
      stage.render(1 / 60);
    } catch { /* a failed warmup must never block entering the field */ }
  }

  private applyView(v: SF.DuelView, first = false): void {
    this.mySide = v.you?.side ?? 0;
    const previous = this.view;
    this.previousPlayers = previous?.players ?? [];
    this.view = v;
    this.files = v.boss.cols;
    this.lanes = v.boss.lanes;
    this.arena?.setFiles(this.files, this.lanes);
    if (v.you) {
      this.myX = fileX(v.you.file, this.files);
      this.myZ = laneZ(v.you.lane, this.lanes);
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
    this.host.hud.deck.classList.toggle('handopen', !!v.you?.hand);
    if (!previous?.you?.hand && v.you?.hand) sfx.handOpen();
    if (previous?.you?.hand && !v.you?.hand) sfx.handClose();
    // The D-pad survives an open Hand (seamless movement); it is only released when the
    // boots are truly locked — down, or a program in flight (`frozen && !open`).
    if (!v.you || v.you.down || (v.you.frozen && !v.you.hand?.open)) this.releaseControls();
    if (this.coverTarget && (previous?.you?.revive && !v.you?.revive
      || !v.players.some((p) => p.id === this.coverTarget && p.down))) {
      this.coverTarget = this.coverSource = null;
    }
  }

  private bodyPoint(owner: string, y = 2.2): THREE.Vector3 {
    if (owner === this.view?.you?.id) return new THREE.Vector3(this.myX, y, this.myZ);
    const body = this.view?.players.find((p) => p.id === owner) ?? this.previousPlayers.find((p) => p.id === owner);
    return new THREE.Vector3(fileX(body?.file ?? 1, this.files), y, laneZ(body?.lane ?? this.lanes - 1, this.lanes));
  }

  private bossPoint(dy = 0): THREE.Vector3 {
    return new THREE.Vector3(this.boss?.root.position.x ?? 0, (this.boss?.root.position.y ?? 2.4) + dy,
      laneZ(this.view?.boss.lane ?? 2, this.lanes));
  }

  private floater(at: THREE.Vector3, text: string, cls = '', life = 1.2): void {
    // Floaters uses innerHTML; all names and server words cross this boundary escaped.
    this.floaters.add(at, escapeHtml(text), cls, life);
  }

  /**
   * Play the field's events.
   *
   * Each one is isolated. These are the only place where a number the server sent becomes a
   * position on the screen, and a single malformed event used to take the whole frame with it —
   * which, in the old frame order, meant the render loop stopped and the canvas went black for the
   * rest of the session. A bad event now costs its own presentation.
   */
  private applyEvents(events: SF.FieldEvent[]): void {
    for (const e of events) {
      try {
        this.ui.event(e);
        const mine = 'owner' in e && e.owner === this.view?.you?.id;
        this.playEvent(e, mine);
      } catch (err) {
        console.warn(`[duel] event ${e.type} failed to play`, err);
      }
    }
  }

  private playEvent(e: SF.FieldEvent, mine: boolean): void {
    if (this.disposed) return;
      switch (e.type) {
        case 'shot-fired': {
          const from = this.bodyPoint(e.owner, 1.5);
          const to = this.bossPoint();
          to.x = fileX(e.files.includes(this.view!.boss.file) ? this.view!.boss.file : (e.files[0] ?? this.view!.boss.file), this.files);
          const key = `${e.owner}:${e.cardId}`;
          const id = `sf-shot-${++this.shotSerial}`;
          const queue = this.shots.get(key) ?? [];
          queue.push(id);
          this.shots.set(key, queue);
          this.arena?.shots.fire({ cardId: id, element: e.element, from, to,
            big: e.cls !== 'standard', fused: false, flight: SF.SHOT_FLIGHT_MS / 1000 });
          sfx.shot(e.element);
          if (mine) this.animate('attack');
          if (e.counter) this.floater(from.clone().add(new THREE.Vector3(0, 1, 0)), 'COUNTER SHOT', 'chain');
          break;
        }
        case 'hit':
          this.resolveShot(e.owner, e.cardId, { hit: true, damage: e.damage, weak: e.weak, chain: e.chain });
          this.landed(e.damage, e.weak, e.chain, e.element, mine);
          if (e.counter) this.floater(this.bossPoint(1.4), 'COUNTER', 'chain');
          break;
        case 'miss':
          this.resolveShot(e.owner, e.cardId, { hit: false });
          this.floater(this.bossPoint(), 'MISS', 'miss');
          break;
        case 'blocked':
          this.resolveShot(e.owner, e.cardId, { hit: false, blocked: true });
          this.floater(this.bossPoint(), 'BLOCKED', 'miss');
          break;
        case 'telegraph': {
          if (!mine) { sfx.warn(); break; }
          // PvP launch feedback: the warning lives on the rival's screen, so this
          // screen gets the throw - the target row flashed through the same side
          // mirror as strikes, the lead card on a banner, amber for outgoing.
          const ml = this.mySide === 1 ? (lane: number): number => this.lanes - 1 - lane : (lane: number): number => lane;
          for (const p of e.panels) {
            this.arena?.flash(p.file, ml(p.lane), 1.0);
            this.arena?.rings.spawn(new THREE.Vector3(fileX(p.file, this.files), 0.5, laneZ(ml(p.lane), this.lanes)), new THREE.Color(1.5, 0.9, 0.3), 3.5, 0.5, false);
          }
          this.floater(this.bossPoint(1), e.label, 'chain');
          this.animate('attack');
          sfx.fire();
          break;
        }
        case 'strike':
          // Strikes read through the panel pulse plus a red ring per struck panel: the
          // beam quads retired here flashed the field black on this machine every time
          // they activated, and every bisect round without them stayed clean.
          const ml = this.mySide === 1 ? (lane: number): number => this.lanes - 1 - lane : (lane: number): number => lane;
          for (const p of e.panels) {
            this.arena?.flash(p.file, ml(p.lane), 1.0);
            this.arena?.rings.spawn(new THREE.Vector3(fileX(p.file, this.files), 0.5, laneZ(ml(p.lane), this.lanes)), new THREE.Color(1.5, 0.3, 0.4), 3.5, 0.5, false);
          }
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
      case 'dodge': {
        this.floater(this.bodyPoint(e.owner), 'DODGED', 'dodge');
        // A ring at the body, so the escape has a shape on the field and not just a word.
        const at = this.bodyPoint(e.owner, 0.7);
        this.arena?.rings.spawn(at, new THREE.Color(0.45, 1.5, 1.1), 4.2, 0.42, false);
        if (mine) {
          sfx.dodge();
          this.ui.dodgeFlash();
        }
        break;
      }        
        case 'drain': this.floater(this.bodyPoint(e.owner), `+${e.amount} INTEGRITY`, 'heal'); break;
        case 'bonus-card': this.floater(this.bodyPoint(e.owner, 3.2), 'BONUS CARD', 'chain'); break;
        case 'guard-break': this.floater(this.bossPoint(1), 'GUARD BROKEN', 'big'); break;
        case 'stun': this.floater(e.target ? this.bodyPoint(e.target, 1) : this.bossPoint(1), `STUN ${Math.round(e.ms)}ms`, 'dodge'); break;
        case 'knock': this.floater(this.bossPoint(1), `BREAK · FILE ${e.file + 1}`, 'dodge'); break;
        case 'burn': this.floater(e.target ? this.bodyPoint(e.target, 1) : this.bossPoint(1), `BURNING ${e.ticks}x${e.damage}`, 'weak'); break;
        case 'burn-tick': this.floater(e.target ? this.bodyPoint(e.target) : this.bossPoint(), `-${e.damage} BURN`, ''); break;
        case 'freeze': this.floater(e.target ? this.bodyPoint(e.target, 1) : this.bossPoint(1), 'FROZEN', 'dodge'); break;
        case 'barrier': this.floater(this.bodyPoint(e.owner), `BARRIER x${e.charges}`, 'heal'); break;
        case 'ward': this.floater(this.bodyPoint(e.owner), 'WARDED', 'dodge'); break;
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
        case 'hand': break;
      }
  }

  private resolveShot(owner: string, card: string, outcome: { hit: boolean; damage?: number; weak?: number; chain?: number; blocked?: boolean }): void {
    const key = `${owner}:${card}`;
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

  /**
   * Take one step on the lane grid.
   *
   * Steps are server-authoritative, and a held key repeats through `update`, so the
   * refusal is not silent: the client says why, once per firing freeze rather than once
   * per press, and the D-pad greys itself at the same time so the state is visible
   * before the player tests it. An open Hand does NOT refuse — the server steps the body
   * out of the safe room on this same step (shield dropped, dealt hand kept), so walking
   * with the Hand open is the seamless default.
   */
  private step(dir: SF.StepDir): void {
    const you = this.view?.you;
    if (this.phase !== 'field' || this.leaving || !you || you.down) return;
    // Only a program in flight refuses here. An open Hand steps through: the server closes
    // the safe room on this same step, so no notice is owed for it — the boots just walk.
    if (you.frozen && !you.hand?.open) {
      if (this.toldFreeze !== frozenWhy(you)) {
        this.toldFreeze = frozenWhy(you);
        this.ui.notice(frozenWhy(you));
      }
      this.ui.setFrozen(true);
      return;
    }
    this.toldFreeze = null;
    this.ui.setFrozen(false);
    this.cover(null);
    // Side 1 reads the field lane-mirrored (self-near), so its near/far intent is
    // flipped on screen: un-mirror back/forward before sending, the same way
    // strikes are mirrored on the way in. The wire stays absolute.
    const out = this.mySide === 1 && dir !== 'left' && dir !== 'right'
      ? (dir === 'back' ? 'forward' : 'back') : dir;
    this.send({ action: 'step', dir: out });
    // No predicted file/lane: the next snapshot is the only movement authority.
  }

  private pick(cell: number): void {
    const candidate = this.view?.you?.hand?.cells.find((c) => c.cell === cell);
    if (this.phase !== 'field' || this.leaving || !candidate || candidate.picked || candidate.locked) return;
    this.send({ action: 'pick', cell });
  }

  private handAction(action: 'undo' | 'clear' | 'execute'): void {
    if (this.phase !== 'field' || this.leaving || !this.view?.you?.hand) return;
    this.send({ action });
  }

  private cover(target: string | null, source = 'controls'): void {
    if (target === null) {
      if (source !== 'controls' && this.coverSource !== source) return;
      if (this.coverTarget || this.view?.you?.revive) this.send({ action: 'cover', with: null });
      this.coverTarget = this.coverSource = null;
      return;
    }
    const you = this.view?.you;
    if (this.phase !== 'field' || this.leaving || !you || you.down || you.frozen || you.hand || this.coverTarget) return;
    this.coverTarget = target;
    this.coverSource = source;
    this.send({ action: 'cover', with: target });
  }

  private readonly releaseControls = (): void => {
    this.keys.clear();
    this.ui.releasePointers();
    this.cover(null);
  };
  private readonly onVisibility = (): void => { if (document.hidden) this.releaseControls(); };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // `e.target` is not always an Element — a key dispatched on window/document has none, and
    // calling `.closest` on it throws, which kills this.handler and with it the dodge.
    const target = e.target;
    if (this.disposed || (target instanceof Element && target.closest('input,textarea,select,[contenteditable="true"]'))) return;
    const k = e.key.toLowerCase();
    if (!KEY_DIR[k] && ![' ', 'r', 'enter', 'backspace', 'delete', 'c', 'escape'].includes(k) && !/^[1-6]$/.test(k)) return;
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
    if (k === ' ') { /* space used to be the Buster; combat is cards and dodging now */ }
    else if (k === 'r') {
      const you = this.view?.you;
      const ally = this.view?.players.find((p) => p.down && p.id !== you?.id && Math.abs(p.file - (you?.file ?? -9)) === 1);
      if (ally) this.cover(ally.id, 'key:r');
      else this.ui.notice('Hold R beside a downed partner on the neighbouring file.');
    } else if (/^[1-6]$/.test(k)) this.pick(Number(k) - 1);
    else if (k === 'enter') this.handAction('execute');
    else if (k === 'backspace') this.handAction('undo');
    else if (k === 'delete' || k === 'c') this.handAction('clear');
    else if (k === 'escape') this.askLeave();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (KEY_DIR[k] || [' ', 'r'].includes(k)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.keys.delete(k);
      if (k === 'r') this.cover(null, 'key:r');
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

  /**
   * The rival across a PvP field: their actual Chog, built once from the start message —
   * or from the late rival message when the other boots stepped on second.
   *
   * The view comes in as an argument on purpose: at build time `this.view` is still
   * null (it is only set after the warmup), and reading it here is how the rival used to
   * never appear. Same manifests as the shell's MODEL — one collection, one set of parts.
   * The plate, the marks and the damage all work without the model, so a failed load
   * degrades to a faceless bout instead of refusing the fight.
   */
  private async buildRival(v: SF.DuelView): Promise<void> {
    const rival = this.startMsg?.rival;
    if (!rival || !this.arena || this.disposed || this.boss || this.rivalBuilding) return;
    this.rivalBuilding = true;
    try {
      const model = await loadChogNFT({ ...RIVAL_MODEL, traits: rival.traits ?? {}, tokenId: rival.tokenId });
      if (this.disposed || !this.arena || this.boss) return;
      model.root.visible = true;
      model.root.scale.setScalar(DUEL_CAM.chog);
      model.root.rotation.set(0, RIVAL_FACING, 0);
      model.root.position.set(fileX(v.boss.file, this.files), 0.12, laneZ(v.boss.lane, this.lanes));
      model.play('idle');
      this.arena.group.add(model.root);
      this.boss = chogAsAvatar(model);
    } catch (err) {
      // Faceless bout: everything else already works — but the reason belongs in the log.
      console.warn('[rival]', err);
    } finally {
      this.rivalBuilding = false;
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
    this.host.hud.deck.classList.remove('handopen');
    if (m.won) {
      this.victory = 0.001;
      this.boss?.die();
      const colour = new THREE.Color(ELEMENT_HEX[this.view?.boss.element ?? 'prism'] ?? 0xffffff);
      this.arena?.particles.burst(this.bossPoint(), colour.clone().multiplyScalar(1.8), 140, 12, 1.4, 0.4);
      for (let i = 0; i < 4; i++) this.later(() => this.arena?.rings.spawn(this.bossPoint(), colour, 6 + i * 3, 0.9, false), i * 180);
      this.shake = 1;
      sfx.cleared();
      this.host.say(m.pvp ? `${m.name} — bout won` : `${m.name} cleared`, 't-glitch');
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
      aim.set(0, 3.6, laneZ(this.view?.boss.lane ?? 2, this.lanes));
    }
    if (this.defeat > 0) {
      p.y -= easeOut(this.defeat / 1.2) * 1.4;
      p.z += easeOut(this.defeat / 1.2) * 1.6;
    }
    const sh = reduceMotion() ? 0 : this.shake;
    p.x += (Math.random() - 0.5) * sh * 0.5;
    p.y += (Math.random() - 0.5) * sh * 0.35;
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
      // A held key repeats — but only while the body can actually move. Firing `step` at a
      // downed body or a firing program every 160 ms was both a silent dead button and a
      // queue that all landed at once the moment the lock lifted. An open Hand steps
      // through (seamless), so its keys survive and keep walking.
      const stuck = this.view?.you;
      if (stuck?.down || (stuck?.frozen && !stuck?.hand?.open)) { this.keys.clear(); break; }
      if (now >= next) {
        this.step(KEY_DIR[key]!);
        if (this.keys.has(key)) this.keys.set(key, now + 160);
      }
    }
    const { chog, stage } = this.host;
    const you = this.view.you;
    const smooth = 1 - Math.exp(-dt * 18);
    this.myX += (fileX(you?.file ?? 1, this.files) - this.myX) * smooth;
    this.myZ += (laneZ(you?.lane ?? this.lanes - 1, this.lanes) - this.myZ) * smooth;
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
    if (this.boss && this.view.boss.archetype !== 'rival') this.boss.root.position.z += laneZ(this.view.boss.lane, this.lanes) - (laneZ(1) - 0.2);
    if (this.boss && this.view.boss.archetype === 'rival') {
      // A rival dodges every volley, so unlike an anomaly it is tracked, not homed.
      const k = 1 - Math.exp(-dt * 10);
      this.boss.root.position.x += (fileX(this.view.boss.file, this.files) - this.boss.root.position.x) * k;
      this.boss.root.position.z += (laneZ(this.view.boss.lane, this.lanes) - this.boss.root.position.z) * k;
    }
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
      // Coming back into a dungeon keeps the cave, not the city: only a street
      // fight gets the district's sky/floor/mood re-painted. This ran for a node
      // fight too and flashed the city's dusk over the dungeon on the way out.
      const backToDungeon = this.saved.rig === 'dungeon' || this.mode === 'node';
      stage.setRig(this.saved.rig, true);
      stage.focusOn(this.saved.focus.x, this.saved.focus.y, this.saved.focus.z);
      for (const { object, visible } of this.saved.scenery) object.visible = visible;
      if (!backToDungeon) stage.setDistrict(this.host.art, this.host.sector);
    }
    this.arena = null;
    this.boss = null;
    this.shots.clear();
    this.view = null;
    this.previousPlayers = [];
    this.warn = null;
    this.pendingEnd = null;
    hud.deck.classList.remove('dueling', 'handopen');
  }
}
