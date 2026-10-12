import * as THREE from 'three';
import { areaAt, cityOf, npcOf, type Anchor, type CityLayout, type NpcDef, type QuestMark, type SectorId } from '@chog/shared';
import { DISTRICTS } from './art.ts';
import { loadChogNFT, type Chog, type PartsModel } from './chogLoader.ts';
import { buildCity, type CityScene } from './city/build.ts';
import type { DynamicState } from './city/landmarks.ts';
import type { ICON } from './hud/icons.ts';
import type { MapMarker } from './hud/minimap.ts';
import { CityLife } from './life.ts';
import type { WalkLayout } from './player.ts';
import type { Stage } from './stage.ts';
import { TRIBE_COLOUR, TRIBE_TINT, nameplate, questMark, type MarkKind } from './tribes.ts';

/**
 * Everything that is *in* the city and is not the player: the district's geometry, its
 * people, its doors, its waves. The shell asks "what is the player standing next to?" and
 * this answers; it never decides what pressing E does.
 *
 * People are streamed. A district has a dozen or more named Chogs, and each is a real
 * model with its own materials and outline pass; keeping them all alive would cost more
 * than the rest of the scene. So they are built when the player comes within a minute's
 * walk, and let go when they leave, and nobody can tell.
 */

const STREAM_IN = 62;
const STREAM_OUT = 88;
/**
 * Characters are drawn larger than their buildings would allow. An isometric camera sits so
 * far back that a true-scale person is a dozen pixels high, and the person is the point:
 * every isometric RPG cheats the cast up by about a third, and nobody ever notices.
 */
export const CHOG_SCALE = 1.35;

export interface Target {
  id: string;
  kind: 'door' | 'fold' | 'npc' | 'board' | 'gate' | 'wave';
  label: string;
  /** Door kind, gate destination, NPC role, wave element. */
  sub: string;
  x: number;
  z: number;
  radius: number;
  hint: string;
  icon: keyof typeof ICON;
  colour: string;
  /** Only present while the Visualizer is on. */
  viz?: boolean;
  /** The NPC's quest marker, if it has one. */
  mark?: QuestMark;
}

interface Person {
  def: NpcDef;
  anchor: Anchor;
  group: THREE.Group;
  chog: Chog | null;
  loading: boolean;
  tag: THREE.Sprite | null;
  mark: THREE.Sprite | null;
  markKind: MarkKind | null;
  board: THREE.Group | null;
}

const ELEMENT_COLOUR: Record<string, string> = {
  burn: '#ff7a45',
  frost: '#7fd8ff',
  volt: '#ffe066',
  wave: '#43e2a8',
  prism: '#cbb2f2',
  void: '#a874ff',
};

export class Explorer {
  sector: SectorId = 'ashflat';
  layout!: CityLayout;
  city: CityScene | null = null;
  life: CityLife | null = null;
  /** Collision and bounds for the player, in the shape `stepPlayer` takes. */
  walk: WalkLayout = { solids: [], bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } };

  private people = new Map<string, Person>();
  private targets: Target[] = [];
  private marks: Record<string, QuestMark> = {};
  private caught = new Set<string>();
  private viz = false;
  private waveGroup: THREE.Group | null = null;
  private waveOrbs = new Map<string, THREE.Object3D>();
  private roads: THREE.Group | null = null;
  private root = new THREE.Group();
  private clock = 0;
  /** The Chog's own position, handed to the city so traffic can brake for a person, not a camera. */
  private playerVec = new THREE.Vector3();
  private lastArea = '';

  constructor(
    private readonly stage: Stage,
    private readonly model: PartsModel,
    private readonly state: () => DynamicState,
  ) {
    stage.scene.add(this.root);
  }

  // -------------------------------------------------------------------- entering a district

  /** Build a district and put it on stage. Returns where the player should appear. */
  enter(sector: SectorId, from: SectorId | null): { x: number; z: number } {
    this.leave();
    this.sector = sector;
    this.layout = cityOf(sector);
    const art = DISTRICTS[sector];
    this.city = buildCity(this.layout, art);
    this.root.add(this.city.group);
    this.stage.setDistrict(art, sector);
    const b = this.layout.bounds;
    this.walk = {
      solids: this.layout.solids,
      bounds: { minX: b.x0, maxX: b.x1, minZ: b.z0, maxZ: b.z1 },
      groundY: (x, z) => this.city!.groundY(x, z),
    };
    this.stage.setBounds(this.walk.bounds);
    this.life = new CityLife(this.root as unknown as THREE.Scene, this.layout, art);
    this.buildTargets();
    this.buildWaves();
    this.buildRoads();
    this.lastArea = '';
    return this.arrival(from);
  }

  arrival(from: SectorId | null): { x: number; z: number } {
    const gate = from ? this.layout.anchors.find((a) => a.kind === 'gate' && a.sub === from) : undefined;
    if (gate) return { x: gate.x + (gate.x < 0 ? 7 : -7), z: gate.z };
    const sp = this.layout.anchors.find((a) => a.kind === 'spawn');
    return sp ? { x: sp.x, z: sp.z } : { x: 0, z: 0 };
  }

  private leave(): void {
    for (const p of this.people.values()) this.despawn(p);
    this.people.clear();
    this.setBeacons([]);
    this.waveOrbs.clear();
    if (this.waveGroup) this.root.remove(this.waveGroup);
    if (this.roads) this.root.remove(this.roads);
    this.waveGroup = null;
    this.roads = null;
    if (this.life) {
      this.life.dispose();
      this.life = null;
    }
    if (this.city) {
      this.root.remove(this.city.group);
      this.city.dispose();
      this.city = null;
    }
  }

  dispose(): void {
    this.leave();
    this.stage.scene.remove(this.root);
  }

  // -------------------------------------------------------------------- targets

  private buildTargets(): void {
    const out: Target[] = [];
    const npcs = new Map(this.layout.anchors.filter((a) => a.kind === 'npc' || a.kind === 'board').map((a) => [a.id, a]));
    for (const a of this.layout.anchors) {
      if (a.kind === 'door' || a.kind === 'fold') {
        // A shopfront with a person outside it is talked to, not entered.
        if (a.sub === 'home') continue;
        const station = a.sub === 'station';
        out.push({
          id: a.id,
          kind: a.kind,
          label: a.label,
          sub: a.sub ?? '',
          x: a.x,
          z: a.z,
          radius: a.radius ?? 2.8,
          hint: station ? 'pulse into the wave' : a.kind === 'fold' ? 'enter the data area' : 'go inside',
          icon: station ? 'bolt' : a.kind === 'fold' ? 'gate' : 'door',
          colour: station ? '#7ffcff' : a.kind === 'fold' ? '#ff9a3c' : '#7fd8ff',
        });
      } else if (a.kind === 'gate') {
        out.push({ id: a.id, kind: 'gate', label: a.label, sub: a.sub ?? '', x: a.x, z: a.z, radius: a.radius ?? 3.4, hint: 'travel', icon: 'gate', colour: '#ff9ef0' });
      } else if (a.kind === 'wave') {
        out.push({ id: a.id, kind: 'wave', label: 'MYSTERY WAVE', sub: a.sub ?? 'wave', x: a.x, z: a.z, radius: 2.4, hint: 'catch it', icon: 'sparkle', colour: ELEMENT_COLOUR[a.sub ?? 'wave'] ?? '#7ffcff', viz: true });
      }
    }
    for (const a of npcs.values()) {
      const hit = npcOf(a.id);
      if (!hit) continue;
      const def = hit.npc;
      out.push({
        id: a.id,
        kind: def.role === 'board' ? 'board' : 'npc',
        label: def.name,
        sub: def.role ?? 'lore',
        x: a.x,
        z: a.z,
        radius: a.radius ?? 3,
        hint: def.role === 'board' ? 'read the board' : 'talk',
        icon: def.role === 'board' ? 'scroll' : 'chat',
        colour: TRIBE_COLOUR[def.tribe] ?? '#9a88c4',
        ...(def.hidden ? { viz: true } : {}),
      });
    }
    this.targets = out;
  }

  /** What the player is standing next to, if anything. People win over doors. */
  nearest(px: number, pz: number): Target | null {
    let best: Target | null = null;
    let bestScore = Infinity;
    for (const t of this.targets) {
      if (t.viz && !this.viz) continue;
      if (t.kind === 'wave' && this.caught.has(t.id)) continue;
      const d = Math.hypot(px - t.x, pz - t.z);
      const reach = t.kind === 'wave' ? 2.6 : t.radius + 1;
      if (d > reach) continue;
      // Lower is better; a person is preferred to a door at the same distance.
      const score = d - (t.kind === 'npc' || t.kind === 'board' ? 1.2 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { ...t, ...(this.marks[t.id] ? { mark: this.marks[t.id] } : {}) };
      }
    }
    return best;
  }

  // -------------------------------------------------------------------- people

  setMarks(marks: Record<string, QuestMark>): void {
    this.marks = marks;
    for (const p of this.people.values()) this.paintMark(p);
  }

  /** Hide the whole district (a fight, a room) without tearing it down. */
  setVisible(on: boolean): void {
    this.root.visible = on;
    this.life?.setPaused(!on);
  }

  setViz(on: boolean): void {
    this.viz = on;
    if (this.waveGroup) this.waveGroup.visible = on;
    if (this.roads) this.roads.visible = on;
    for (const p of this.people.values()) p.group.visible = !p.def.hidden || on;
  }

  setCaught(ids: string[]): void {
    this.caught = new Set(ids);
    for (const [id, orb] of this.waveOrbs) orb.visible = !this.caught.has(id);
  }

  private paintMark(p: Person): void {
    const want = (this.marks[p.def.id] ?? null) as MarkKind | null;
    if (want === p.markKind) return;
    if (p.mark) {
      p.group.remove(p.mark);
      (p.mark.material as THREE.SpriteMaterial).dispose();
      p.mark = null;
    }
    p.markKind = want;
    if (want) {
      p.mark = questMark(want);
      p.mark.position.set(0, 5.1, 0);
      p.group.add(p.mark);
    }
  }

  // -------------------------------------------------------------------- objective beacons

  private beaconKey = '';
  private beacons = new THREE.Group();
  private beaconParts: { ring: THREE.Mesh; gem: THREE.Mesh; beam: THREE.Mesh; phase: number; baseY: number }[] = [];

  /**
   * A column of gold light over each place the tracked quest wants you at. A minimap tells
   * you which way; this tells you *which building*, from a block away, which is the thing a
   * player lost in a new district actually needs.
   */
  setBeacons(points: { x: number; z: number }[]): void {
    const key = points.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join('|');
    if (key === this.beaconKey) return;
    this.beaconKey = key;
    this.root.remove(this.beacons);
    this.beacons.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.beacons = new THREE.Group();
    this.beaconParts = [];
    for (const p of points) {
      const y = this.city?.groundY(p.x, p.z) ?? 0;
      const gold = 0xffd24d;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 1.1, 30, 14, 1, true),
        new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }),
      );
      beam.position.set(p.x, y + 15, p.z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.4, 1.75, 44),
        new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, y + 0.09, p.z);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.62), new THREE.MeshBasicMaterial({ color: gold, toneMapped: false }));
      gem.position.set(p.x, y + 7.2, p.z);
      this.beacons.add(beam, ring, gem);
      this.beaconParts.push({ ring, gem, beam, phase: Math.random() * 6, baseY: gem.position.y });
    }
    this.root.add(this.beacons);
  }

  private async spawn(p: Person): Promise<void> {
    if (p.loading || p.chog || p.board) return;
    p.loading = true;
    const { def, anchor } = p;
    const y = this.city?.groundY(anchor.x, anchor.z) ?? 0;
    p.group.position.set(anchor.x, y, anchor.z);
    const colour = TRIBE_COLOUR[def.tribe] ?? '#9a88c4';
    if (def.role === 'board') {
      p.board = questBoard(DISTRICTS[this.sector]);
      p.group.add(p.board);
    } else {
      try {
        const chog = await loadChogNFT({ ...this.model, traits: {}, tokenId: 1 + (hashOf(def.id) % 1900), tint: TRIBE_TINT[def.tribe] ?? {} });
        // The person may have been despawned while the model was loading.
        if (!this.people.has(def.id)) return;
        p.chog = chog;
        chog.root.rotation.y = faceAngle(def.face ?? 2);
        chog.root.scale.setScalar(CHOG_SCALE);
        p.group.add(chog.root);
      } catch {
        p.loading = false;
        return;
      }
    }
    p.tag = nameplate(def.name, colour);
    p.tag.position.set(0, 4.15, 0);
    p.group.add(p.tag);
    this.paintMark(p);
    p.group.visible = !def.hidden || this.viz;
    p.loading = false;
  }

  private despawn(p: Person): void {
    this.root.remove(p.group);
    p.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        // Chog geometry is shared by every clone; only what is ours to free is freed.
        const mat = m.material as THREE.Material | THREE.Material[];
        for (const x of Array.isArray(mat) ? mat : [mat]) x.dispose?.();
      }
    });
    p.chog = null;
    p.board = null;
    p.tag = null;
    p.mark = null;
    p.markKind = null;
    p.loading = false;
  }

  // -------------------------------------------------------------------- the wave layer

  private buildWaves(): void {
    const g = new THREE.Group();
    g.visible = this.viz;
    for (const a of this.layout.anchors) {
      if (a.kind !== 'wave') continue;
      const col = new THREE.Color(ELEMENT_COLOUR[a.sub ?? 'wave'] ?? '#7ffcff');
      const orb = new THREE.Group();
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.04, 6, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, toneMapped: false }));
      ring.rotation.x = Math.PI / 2;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7, 6, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
      beam.position.y = 3.5;
      orb.add(core, halo, ring, beam);
      orb.position.set(a.x, (this.city?.groundY(a.x, a.z) ?? 0) + 1.5, a.z);
      orb.userData = { phase: Math.random() * 6, y: orb.position.y };
      g.add(orb);
      this.waveOrbs.set(a.id, orb);
    }
    this.waveGroup = g;
    this.root.add(g);
  }

  /** Faint cyan lines down the middle of every street: the roads of the wave world. */
  private buildRoads(): void {
    const g = new THREE.Group();
    g.visible = this.viz;
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ffcff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    for (const s of this.layout.streets) {
      const horizontal = s.axis === 'x';
      const len = horizontal ? s.rect.x1 - s.rect.x0 : s.rect.z1 - s.rect.z0;
      const mid = horizontal ? (s.rect.z0 + s.rect.z1) / 2 : (s.rect.x0 + s.rect.x1) / 2;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(horizontal ? len : 0.35, horizontal ? 0.35 : len), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(horizontal ? (s.rect.x0 + s.rect.x1) / 2 : mid, 0.08, horizontal ? mid : (s.rect.z0 + s.rect.z1) / 2);
      g.add(m);
    }
    this.roads = g;
    this.root.add(g);
  }

  // -------------------------------------------------------------------- per frame

  update(dt: number, px: number, pz: number, focus: THREE.Vector3): void {
    this.clock += dt;
    this.playerVec.set(px, 0, pz);
    this.city?.update(this.clock, dt, focus, this.state());
    this.life?.update(dt, this.playerVec, focus);

    // Stream people in and out by distance from the player.
    for (const a of this.layout.anchors) {
      if (a.kind !== 'npc' && a.kind !== 'board') continue;
      const def = npcOf(a.id)?.npc;
      if (!def) continue;
      const d = Math.hypot(a.x - px, a.z - pz);
      let p = this.people.get(a.id);
      if (!p && d < STREAM_IN) {
        p = { def, anchor: a, group: new THREE.Group(), chog: null, loading: false, tag: null, mark: null, markKind: null, board: null };
        this.people.set(a.id, p);
        this.root.add(p.group);
        void this.spawn(p);
      } else if (p && d > STREAM_OUT) {
        this.despawn(p);
        this.people.delete(a.id);
      }
    }
    for (const b of this.beaconParts) {
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 2.4 + b.phase);
      b.ring.scale.setScalar(1 + pulse * 0.25);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + pulse * 0.45;
      b.gem.rotation.y = this.clock * 1.6;
      b.gem.position.y = b.baseY + Math.sin(this.clock * 2 + b.phase) * 0.35;
      (b.beam.material as THREE.MeshBasicMaterial).opacity = 0.14 + pulse * 0.1;
    }
    for (const p of this.people.values()) {
      if (p.chog && p.group.visible) p.chog.update(dt);
      if (p.mark) p.mark.position.y = 5.1 + Math.sin(this.clock * 3 + p.anchor.x) * 0.14;
      // Turn to face the player when they come near; people notice you.
      if (p.chog) {
        const d = Math.hypot(p.anchor.x - px, p.anchor.z - pz);
        const want = d < 7 ? Math.atan2(px - p.anchor.x, pz - p.anchor.z) : faceAngle(p.def.face ?? 2);
        let diff = want - p.chog.root.rotation.y;
        diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        p.chog.root.rotation.y += diff * Math.min(1, dt * 5);
      }
    }
    for (const [id, orb] of this.waveOrbs) {
      if (this.caught.has(id)) continue;
      const ph = (orb.userData.phase as number) ?? 0;
      orb.position.y = (orb.userData.y as number) + Math.sin(this.clock * 1.6 + ph) * 0.3;
      orb.rotation.y = this.clock * 0.8 + ph;
      orb.scale.setScalar(1 + 0.08 * Math.sin(this.clock * 3 + ph));
    }
  }

  // -------------------------------------------------------------------- map

  areaName(x: number, z: number): string {
    return areaAt(this.layout, x, z)?.name ?? 'Streets';
  }

  /** Whether the player has just crossed into a different named area. */
  areaChanged(x: number, z: number): string | null {
    const name = this.areaName(x, z);
    if (name === this.lastArea) return null;
    this.lastArea = name;
    return name;
  }

  markers(opts: { anomaly: boolean; tracked: { kind: 'npc' | 'poi' | 'door'; id: string }[]; remotes: { x: number; z: number }[] }): MapMarker[] {
    const out: MapMarker[] = [];
    const tracked = new Set(opts.tracked.map((t) => `${t.kind}:${t.id}`));
    for (const a of this.layout.anchors) {
      if (a.kind === 'npc' || a.kind === 'board') {
        const def = npcOf(a.id)?.npc;
        if (def?.hidden && !this.viz) continue;
        const mark = this.marks[a.id];
        const kind = mark === 'turnin' ? 'turnin' : mark === 'offer' || tracked.has(`npc:${a.id}`) ? 'quest' : a.kind === 'board' ? 'board' : 'npc';
        out.push({ x: a.x, z: a.z, kind, label: a.label });
      } else if (a.kind === 'door' || a.kind === 'fold') {
        if (a.sub === 'home') continue;
        const hot = opts.anomaly && a.sub === 'station';
        out.push({ x: a.x, z: a.z, kind: hot ? 'anomaly' : tracked.has(`door:${a.sub}`) ? 'quest' : 'door', label: a.label });
      } else if (a.kind === 'gate') out.push({ x: a.x, z: a.z, kind: 'gate', label: a.label });
      else if (a.kind === 'poi') out.push({ x: a.x, z: a.z, kind: tracked.has(`poi:${a.id}`) ? 'quest' : 'poi', label: a.label });
      else if (a.kind === 'wave' && this.viz && !this.caught.has(a.id)) out.push({ x: a.x, z: a.z, kind: 'wave' });
    }
    for (const r of opts.remotes) out.push({ x: r.x, z: r.z, kind: 'remote' });
    return out;
  }

  /** The anchor of a person or a place by id, for "walk toward this" on the tracker. */
  positionOf(kind: 'npc' | 'poi' | 'door', id: string): { x: number; z: number } | null {
    const a = this.layout.anchors.find((q) => (kind === 'door' ? (q.kind === 'door' || q.kind === 'fold') && q.sub === id : q.id === id));
    return a ? { x: a.x, z: a.z } : null;
  }
}

const hashOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Quarter turns clockwise from north → a rotation about Y for a model that faces +z at rest. */
const faceAngle = (f: 0 | 1 | 2 | 3): number => [Math.PI, Math.PI / 2, 0, -Math.PI / 2][f] ?? 0;

/** The contract board: two posts, a slate with pinned notes, and a lantern. */
function questBoard(art: (typeof DISTRICTS)['ashflat']): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: new THREE.Color(art.trunk).lerp(new THREE.Color('#8a6a46'), 0.5) });
  const slate = new THREE.MeshLambertMaterial({ color: new THREE.Color(art.dark).lerp(new THREE.Color('#2a2438'), 0.5) });
  for (const x of [-1.4, 1.4]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.2, 0.28), wood);
    post.position.set(x, 1.6, 0);
    post.castShadow = true;
    g.add(post);
  }
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.9, 0.16), slate);
  board.position.set(0, 2.2, 0);
  board.castShadow = true;
  g.add(board);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.1, 0.12), wood);
  frame.position.set(0, 2.2, -0.04);
  g.add(frame);
  const rand = (i: number): number => (((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1;
  for (let i = 0; i < 7; i++) {
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.7), new THREE.MeshBasicMaterial({ color: ['#f3ecd2', '#ffe9a8', '#d6e8ff', '#ffd0d0'][i % 4]! }));
    note.position.set(-1.2 + (i % 4) * 0.8 + rand(i) * 0.15, 2.6 - Math.floor(i / 4) * 0.85, 0.1);
    note.rotation.z = (rand(i + 9) - 0.5) * 0.3;
    g.add(note);
  }
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.34), new THREE.MeshBasicMaterial({ color: art.window, toneMapped: false }));
  lamp.position.set(0, 3.55, 0);
  g.add(lamp);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.18, 0.7), wood);
  roof.position.set(0, 3.3, 0.1);
  roof.castShadow = true;
  g.add(roof);
  return g;
}
