import * as THREE from 'three';
import type { DropView } from '@chog/shared';
import { cardImg } from './cardArt.ts';
import type { Stage } from './stage.ts';

/**
 * Loot on the street, with a body.
 *
 * A fight used to pay into a menu: you won, and the bag was quietly fuller. That is a receipt, not
 * a reward — nothing in the world acknowledged what you did. A drop is the same payout made
 * physical. It falls where you stood, it burns in its rarity colour, it says what it is when you
 * point at it, and you walk over to take it. The Diablo loop is not the loot table, it is the two
 * seconds between seeing the beam and having the thing.
 *
 * Everything here is presentation. The server owns the position, the contents and who may take
 * one; this file draws the list it is handed and says which pile a body stepped on. It never
 * decides that a card was won.
 */

/** The rarity ladder, as colours. The beam is the whole read at a distance, so it carries the rank. */
/**
 * The rarity ladder as colour *and motion*.
 *
 * `spin` is how fast the gem turns, `bob` how fast it floats, and `pulse` the rate the halo breathes
 * — an uncommon drop sits quietly, a rare one turns and lifts, an epic one does all three at a rate
 * that makes it legible from across the street. The beam is the read at a distance; the motion is
 * the read at a glance, and without it three piles look like three identical piles.
 */
const RARITY: Record<DropView['rarity'], {
  beam: number; core: number; label: string; glow: number; spin: number; bob: number; pulse: number;
}> = {
  common: { beam: 0x7fd8ff, core: 0xdff2ff, label: 'COMMON', glow: 1.4, spin: 0.9, bob: 1.7, pulse: 1.1 },
  rare: { beam: 0xffcc5c, core: 0xfff0c0, label: 'RARE', glow: 2.1, spin: 2.1, bob: 2.6, pulse: 2.4 },
  epic: { beam: 0xd77bff, core: 0xf6e0ff, label: 'EPIC', glow: 2.9, spin: 3.2, bob: 3.6, pulse: 3.8 },
};

/** Money is its own material: green, flat and unmistakably not a card. */
const MONEY = { beam: 0x43e2a8, core: 0xd8fff0, glow: 1.6, spin: 1.4, bob: 2.2, pulse: 1.8 };

/** How close a body has to be for the pile to come to it. Matches the server's own take range. */
const PICKUP_RANGE = 2.2;
/** How near the pointer has to be, in screen pixels, for a pile to name itself. */
const HOVER_PX = 54;
/** How high the beam stands. Rarer loot is louder from further away, which is the point of rarity. */
const BEAM_H: Record<DropView['rarity'], number> = { common: 2.6, rare: 3.6, epic: 4.8 };

interface Pile {
  view: DropView;
  group: THREE.Group;
  core: THREE.Mesh;
  ring: THREE.Mesh;
  beam: THREE.Mesh;
  /** A per-pile phase so identical loot does not bob in lockstep. */
  phase: number;
  /** The screen position from the last frame, or null when it was behind the camera. */
  sx: number;
  sy: number;
  onScreen: boolean;
  /** Whether the player's body is close enough for the server to accept a take. */
  reachable: boolean;
  /** The name plate sitting over the item, the way Diablo wears the loot's name. */
  label: HTMLDivElement;
  /** Per-rarity motion: how fast the gem turns, floats and breathes. */
  bob: number;
  spin: number;
  pulse: number;
}

export interface DropHost {
  /** Where the player's body is on the plane, so a pile can be judged reachable or not. */
  player(): { x: number; z: number };
  /** Ask the server for a pile. It decides; this only says which one. */
  take(id: string): void;
  /**
   * A pile that was asked for and is now gone. Fired from the reconcile, not from the request,
   * so the confirmation is the server's answer rather than this file's optimism.
   */
  collected(view: DropView): void;
  /** A pile the player clicked they are not standing next to. The server would refuse it anyway. */
  outOfReach(view: DropView): void;
}

export class Drops {
  private readonly root = new THREE.Group();
  private readonly piles = new Map<string, Pile>();
  private readonly tip: HTMLDivElement;
  /** The shared parent every pile's name plate hangs from. */
  private readonly labelHost: HTMLDivElement;
  private readonly ground: (x: number, z: number) => number;
  private readonly canvas: HTMLCanvasElement;
  /** Pointer -> world, so a click hits the pile itself and not the space beside it. */
  private readonly ray = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private clock = 0;
  private hover: string | null = null;
  private mouse = { x: -1, y: -1, inside: false };
  private wanted = new Set<string>();
  /** Piles this client asked for, so a disappearance can be told from an expiry. */
  private readonly asked = new Map<string, DropView>();

  constructor(
    private readonly stage: Stage,
    private readonly host: DropHost,
    ground: (x: number, z: number) => number,
  ) {
    this.ground = ground;
    this.canvas = stage.renderer.domElement;
    this.root.name = 'drops';
    stage.scene.add(this.root);

    this.tip = document.createElement('div');
    this.tip.id = 'drop-tip';
    this.tip.hidden = true;
    document.body.appendChild(this.tip);
    // One host for every pile's name plate. One parent each would mean one stacking context per
    // label and a repaint per pile; one moving parent means the labels ride the same layer.
    this.labelHost = document.createElement('div');
    this.labelHost.id = 'drop-labels';
    document.body.appendChild(this.labelHost);

    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    // The click is the pickup. Bubbles rather than captures: the street's own handlers run first,
    // and a click that landed on a menu or a marker must not also reach for a pile.
    this.canvas.addEventListener('pointerdown', this.onClick);
  }

  private readonly onClick = (e: PointerEvent): void => {
    if (!this.root.visible || e.button !== 0) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (!hit) return;
    const near = Math.hypot(hit.near.x, hit.near.z) <= PICKUP_RANGE;
    // The server checks range on its own and would refuse this; saying why here is the difference
    // between a dead click and a click that tells you to walk closer.
    if (!near) { this.host.outOfReach(hit.view); return; }
    if (!this.asked.has(hit.view.id)) this.asked.set(hit.view.id, hit.view);
    this.host.take(hit.view.id);
  };

  /**
   * Which pile a screen point is over.
   *
   * Two passes, because a pure raycast is too precise to be usable: the beam is a thin open
   * cylinder and the core a hand's width wide, so aiming at the glow and missing the gem is the
   * normal case. Meshes win when they are hit; otherwise the nearest pile within HOVER_PX of the
   * point takes it, which is how every ARPG actually feels to click.
   */
  private pick(clientX: number, clientY: number): { view: DropView; near: { x: number; z: number } } | null {
    const me = this.host.player();
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    this.pointer.set((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.stage.camera);
    const meshes: THREE.Mesh[] = [];
    for (const p of this.piles.values()) meshes.push(p.core, p.beam, p.ring);
    const hits = this.ray.intersectObjects(meshes, false);
    for (const h of hits) {
      const pile = [...this.piles.values()].find((p) => p.core === h.object || p.beam === h.object || p.ring === h.object);
      if (pile) return { view: pile.view, near: { x: me.x - pile.view.x, z: me.z - pile.view.z } };
    }

    // Missed the geometry: fall back to the nearest pile on screen, the same favicon the hover uses.
    let best: Pile | null = null;
    let d = Infinity;
    for (const pile of this.piles.values()) {
      if (!pile.onScreen) continue;
      const dist = Math.hypot(pile.sx - px, pile.sy - py);
      if (dist <= HOVER_PX && dist < d) { best = pile; d = dist; }
    }
    return best ? { view: best.view, near: { x: me.x - best.view.x, z: me.z - best.view.z } } : null;
  }

  private readonly onMove = (e: PointerEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    this.mouse.inside = true;
  };

  private readonly onLeave = (): void => {
    this.mouse.inside = false;
    this.mouse.x = -1;
    this.mouse.y = -1;
  };

  /** The street is not always the thing being looked at; a dungeon has no piles of its own. */
  setVisible(on: boolean): void {
    this.root.visible = on;
    if (!on) this.hideTip();
  }

  /**
   * Reconcile against the server's list.
   *
   * Diffed rather than rebuilt: a pile that is already on the ground keeps its bob phase and its
   * mesh, so a push that only added one item does not make the whole street flicker.
   */
  set(list: readonly DropView[]): void {
    this.wanted = new Set(list.map((d) => d.id));
    for (const [id, pile] of this.piles) {
      if (this.wanted.has(id)) continue;
      this.drop(pile);
      // Gone, and this client asked for it: that is the server confirming the pickup, so it is
      // the only moment worth telling the player about. A pile that merely expired says nothing.
      const asked = this.asked.get(id);
      if (asked) {
        this.asked.delete(id);
        this.host.collected(asked);
      }
    }
    for (const view of list) if (!this.piles.has(view.id)) this.build(view);
  }

  private build(view: DropView): void {
    const money = view.kind === 'wav';
    const rank = RARITY[view.rarity];
    const tint = new THREE.Color(money ? MONEY.beam : rank.beam);
    // Money has no element and no class, so it wears its own material instead of borrowing one.
    const coreCol = new THREE.Color(money ? MONEY.core : view.element ? ELEMENT_TINT[view.element] ?? rank.core : rank.core);
    const glow = money ? MONEY.glow : rank.glow;
    const spin = money ? MONEY.spin : rank.spin;

    const group = new THREE.Group();
    // Money is a flat slab, not a gem: a squat box you read as currency from any angle, which is
    // exactly what a card-shaped pile is not.
    const core = new THREE.Mesh(
      money ? new THREE.BoxGeometry(0.42, 0.42, 0.42) : new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshBasicMaterial({ color: coreCol, toneMapped: false }),
    );
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 10, 8),
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(money ? 0.7 : 0.62, money ? 0.05 : 0.035, 6, 24),
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.75, toneMapped: false }),
    );
    ring.rotation.x = Math.PI / 2;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.09, BEAM_H[view.rarity], 6, 1, true),
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.3 + glow * 0.06, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }),
    );
    beam.position.y = BEAM_H[view.rarity] / 2;
    group.add(core, halo, ring, beam);
    const y = this.ground(view.x, view.z) + 0.55;
    group.position.set(view.x, y, view.z);
    this.root.add(group);

    // The Diablo label: the name is on the item, always, not a tooltip you have to go looking for.
    // It is a DOM node because the 3D text path needs a font this project does not ship, and
    // because a CSS label costs one element instead of a texture per pile.
    const label = document.createElement('div');
    label.className = 'drop-label';
    label.dataset.rarity = money ? 'money' : view.rarity;
    label.innerHTML = `<b>${esc(view.name)}</b>${money ? '' : `<small>${esc(labelSub(view))}</small>`}`;
    this.labelHost.appendChild(label);

    this.piles.set(view.id, { view, group, core, ring, beam, label, phase: (this.piles.size * 1.7) % 6.283, sx: 0, sy: 0, onScreen: false, reachable: false, bob: money ? MONEY.bob : rank.bob, spin, pulse: money ? MONEY.pulse : rank.pulse });
  }

  private drop(pile: Pile): void {
    pile.label.remove();
    this.root.remove(pile.group);
    pile.group.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) x.dispose?.();
    });
    (pile.core.geometry as THREE.BufferGeometry).dispose();
    (pile.ring.geometry as THREE.BufferGeometry).dispose();
    (pile.beam.geometry as THREE.BufferGeometry).dispose();
    this.piles.delete(pile.view.id);
    if (this.hover === pile.view.id) this.hideTip();
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.root.visible) return;
    const me = this.host.player();
    const rect = this.canvas.getBoundingClientRect();
    const at = new THREE.Vector3();
    let best: { id: string; d: number } | null = null;

    for (const pile of this.piles.values()) {
      // Motion is the rarity's signature. A common drop sits quietly; a rare one turns and lifts;
      // an epic does both fast enough to read from across the street. Three piles that animate
      // differently are three piles a player can tell apart without opening anything.
      const t = this.clock + pile.phase;
      pile.group.position.y = this.ground(pile.view.x, pile.view.z) + 0.55 + Math.sin(t * pile.bob) * 0.11;
      pile.core.rotation.y = t * pile.spin;
      pile.core.rotation.x = t * pile.spin * 0.6;
      pile.ring.scale.setScalar(1 + Math.sin(t * pile.pulse) * 0.08);
      pile.ring.rotation.z = t * pile.spin * 0.45;
      const haloMat = pile.core.parent?.children[1].material as THREE.MeshBasicMaterial | undefined;
      if (haloMat) haloMat.opacity = 0.14 + 0.14 * (0.5 + 0.5 * Math.sin(t * pile.pulse));

      // Reachability is the pile's own state, and it shows: a pile you can click is lit, one you
      // cannot is dim. The distance is checked here for feel only — the server is the referee.
      pile.reachable = Math.hypot(me.x - pile.view.x, me.z - pile.view.z) <= PICKUP_RANGE;
      const ringMat = pile.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = pile.reachable ? 0.85 + Math.sin(t * 4) * 0.15 : 0.4;
      (pile.beam.material as THREE.MeshBasicMaterial).opacity = pile.reachable ? 0.55 : 0.24;

      // Project for the hover test, so pointing at a pile names it.
      at.set(pile.view.x, pile.group.position.y, pile.view.z).project(this.stage.camera);
      pile.onScreen = at.z <= 1;
      pile.sx = (at.x * 0.5 + 0.5) * rect.width;
      pile.sy = (-at.y * 0.5 + 0.5) * rect.height;
      // The name plate rides the pile, permanently, in the screen frame. `display` rather than
      // `hidden` so the layout is never reflowed by a pile appearing behind the camera.
      pile.label.style.display = pile.onScreen ? '' : 'none';
      if (pile.onScreen) {
        pile.label.style.transform = `translate(${rect.left + pile.sx}px, ${rect.top + pile.sy - 30}px) translate(-50%, -100%)`;
      }
      if (!pile.onScreen || !this.mouse.inside) continue;
      const d = Math.hypot(pile.sx - this.mouse.x, pile.sy - this.mouse.y);
      if (d <= HOVER_PX && (!best || d < best.d)) best = { id: pile.view.id, d };
    }

    const next = best?.id ?? null;
    // The cursor answers the hover before anything else does: a pointer over a pile you can take,
    // nothing over one you cannot.
    const live = next ? this.piles.get(next) : null;
    this.canvas.style.cursor = live ? (live.reachable ? 'pointer' : 'default') : '';
    if (next !== this.hover) {
      this.hover = next;
      if (next) this.showTip(this.piles.get(next)!); else this.hideTip();
    } else if (next) {
      // Same pile: keep the card following the pointer, because the street moves under it.
      const pile = this.piles.get(next);
      if (pile) this.placeTip(pile);
    }
  }

  private showTip(pile: Pile): void {
    const v = pile.view;
    const rank = RARITY[v.rarity];
    const money = v.kind === 'wav';
    const bits = money
      ? 'WAV · CURRENCY'
      : [v.klass ? `${v.klass} CLASS` : v.kind === 'item' ? 'SUPPLY' : '', v.element ? v.element.toUpperCase() : '', rank.label]
        .filter(Boolean).join(' · ');
    const hint = pile.reachable ? 'click to collect' : 'walk closer — too far to reach';
    // The photo: the card face for a card pile, the item drawing for a supply pile.
    // Money has no picture — the slab on the ground already reads as currency.
    const art = v.kind === 'card' && v.key
      ? cardImg(v.key, v.element ?? null, 'tip-art')
      : v.kind === 'item' && v.key
        ? `<img class="tip-art" src="/items/item-${v.key}.svg" alt="">`
        : '';
    this.tip.innerHTML = `<div class="tip-head">${art}<div><b>${esc(v.name)}</b><small>${esc(bits)}</small></div></div>
      <span class="hint">${hint} · ${v.ttl < 0 ? 'yours until taken' : `${v.ttl}s left`}</span>`;
    this.tip.dataset.rarity = v.rarity;
    this.tip.dataset.reachable = pile.reachable ? '1' : '0';
    this.tip.hidden = false;
    this.placeTip(pile);
  }

  private placeTip(pile: Pile): void {
    const r = this.canvas.getBoundingClientRect();
    // Above the pile rather than under the cursor: the cursor is what you are aiming with, and a
    // tooltip that sits under it hides the thing it is describing.
    const x = r.left + pile.sx;
    const y = r.top + pile.sy - 26;
    this.tip.style.left = `${Math.max(8, Math.min(x, window.innerWidth - this.tip.offsetWidth - 8))}px`;
    this.tip.style.top = `${Math.max(8, y - this.tip.offsetHeight)}px`;
  }

  private hideTip(): void {
    this.tip.hidden = true;
  }

  dispose(): void {
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('pointerdown', this.onClick);
    for (const pile of [...this.piles.values()]) this.drop(pile);
    this.labelHost.remove();
    this.stage.scene.remove(this.root);
    this.tip.remove();
  }
}

const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** The second line under a pile's name: what it is, before you click it. */
const labelSub = (v: DropView): string => {
  const bits = [v.klass ? `${v.klass} CLASS` : v.kind === 'item' ? 'SUPPLY' : '', v.element ? v.element.toUpperCase() : ''];
  return bits.filter(Boolean).join(' · ') || RARITY[v.rarity].label;
};

/** The core takes the card's own element, so a pile is legible before the tooltip opens. */
const ELEMENT_TINT: Record<string, number> = {
  burn: 0xff7a45, frost: 0x7fe3ff, volt: 0xffe45c,
  wave: 0x5cffc8, prism: 0xf0e0ff, void: 0xb07cff,
};
