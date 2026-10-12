import type { SectorId } from '../wave.ts';

/**
 * The city, as data.
 *
 * A district used to be a single street with a row of houses along one side — a stage
 * set. A city is a *plan*: a grid of blocks, the streets between them, and what each
 * block is for. This file is the vocabulary for that plan, and it lives in `shared`
 * because three different things need to agree on it:
 *
 *   - the client turns it into geometry,
 *   - the server uses its bounds, doors, NPCs and points of interest to decide whether a
 *     quest step really happened (a player cannot "talk to" an NPC from across town),
 *   - the tests walk it, to prove every door, NPC and gate can actually be reached.
 *
 * Nothing in here knows about three.js. The layout is a pure function of the plan.
 */

export type Side = 'N' | 'E' | 'S' | 'W';

/** What a block is *for*. Each kind has its own generator and its own rhythm of space. */
export type BlockKind =
  | 'shops' // a continuous street wall of shopfronts, an inner court behind
  | 'houses' // row houses facing two streets, a back lane of gardens between
  | 'tenements' // taller, denser residential
  | 'towers' // tall towers on a low podium
  | 'plaza' // open paved square with a feature in the middle
  | 'park' // lawns, paths, trees, a pond
  | 'market' // stalls in aisles under awnings
  | 'industrial' // warehouses, containers, a fenced yard
  | 'station' // the Wave Station block — the landmark the whole game turns on
  | 'rail' // a rail yard with a platform and a parked train
  | 'water' // a pond or canal, promenade round it, a bridge across
  | 'greenhouse' // glasshouses and allotments
  | 'ruin'; // a collapsed lot, overgrown, where the secrets are

export type BuildingStyle =
  | 'rowhouse'
  | 'shopfront'
  | 'tenement'
  | 'townhall'
  | 'warehouse'
  | 'tower'
  | 'podium'
  | 'arcade'
  | 'greenhouse'
  | 'kiosk'
  | 'clinic'
  | 'terminal'
  | 'depot';

export type RoofKind = 'flat' | 'gable' | 'hip' | 'sawtooth' | 'dome' | 'stepped';

export type LandmarkKind =
  | 'clocktower'
  | 'waveStation'
  | 'relaySpire'
  | 'dome'
  | 'waterTower'
  | 'oldStation'
  | 'craneYard'
  | 'foldGate'
  | 'fountain'
  | 'monument'
  | 'holoPillar'
  | 'bandstand'
  | 'monorailHub';

export type DoorKind = 'shop' | 'heal' | 'station' | 'brother' | 'telemetry' | 'dungeon' | 'home';

export interface DoorDef {
  id: string;
  kind: DoorKind;
  label: string;
  /** The side of the block the shopfront faces. */
  side: Side;
  /** 0..1 along that side, left-to-right as seen from the street. */
  at: number;
}

export interface NpcDef {
  id: string;
  name: string;
  /** Who they stand with, which is also the colour they wear. */
  tribe: 'burn' | 'frost' | 'volt' | 'wave' | 'prism' | 'void';
  /** One line for the nameplate bubble; the long dialogue lives with the quests. */
  line: string;
  /** Where they stand: beside a named door, or at an offset from a block's centre. */
  at: { door: string; dx?: number; dz?: number } | { block: [number, number]; dx: number; dz: number };
  /** Where they look, in quarter turns clockwise from north. */
  face?: 0 | 1 | 2 | 3;
  /** What they do beyond talking. */
  role?: 'quest' | 'shop' | 'heal' | 'board' | 'lore' | 'guide' | 'hertz';
  /** A Hertz is only there when the Visualizer is on. */
  hidden?: boolean;
}

export interface BlockDef {
  kind: BlockKind;
  /** The neighbourhood this block belongs to. Neighbouring blocks with the same name are one area. */
  name: string;
  seed?: number;
  /** Multiplies building heights: 0.6 is low-rise, 1.6 is a canyon. */
  tall?: number;
  landmark?: LandmarkKind;
  doors?: DoorDef[];
}

export interface GateDef {
  side: 'W' | 'E' | 'N' | 'S';
  to: SectorId;
  label: string;
  /** Which street row it opens onto (index into the plan's rows), default the main street. */
  row?: number;
}

export interface PoiDef {
  id: string;
  name: string;
  kind: 'vista' | 'landmark' | 'secret' | 'hangout';
  at: { block: [number, number]; dx: number; dz: number };
  radius?: number;
  /** One line of lore shown when it is discovered. */
  text?: string;
}

export interface ZonePlan {
  sector: SectorId;
  name: string;
  tagline: string;
  /** Block sizes along x (columns) and z (rows). */
  colW: number[];
  rowD: number[];
  /** Asphalt widths between columns / rows. */
  gapX: number[];
  gapZ: number[];
  /** The ring road round the edge of the zone. */
  ring: number;
  /** Index of the main street (a gap in `gapZ`) and the main avenue (a gap in `gapX`). */
  mainRow: number;
  mainCol: number;
  blocks: BlockDef[][];
  gates: GateDef[];
  npcs: NpcDef[];
  pois: PoiDef[];
  /** Where a new arrival appears: a block and an offset from its centre. */
  spawn: { block: [number, number]; dx: number; dz: number };
}

// ---------------------------------------------------------------------------
// The layout: what a plan resolves to
// ---------------------------------------------------------------------------

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Solid {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
}

export interface PlacedBlock {
  c: number;
  r: number;
  rect: Rect;
  /** The rect inside the sidewalk ring. */
  inner: Rect;
  def: BlockDef;
}

export interface StreetRect {
  rect: Rect;
  axis: 'x' | 'z';
  width: number;
  main: boolean;
}

export interface Lot {
  id: string;
  style: BuildingStyle;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Which way the front faces, in quarter turns clockwise from north. */
  face: 0 | 1 | 2 | 3;
  seed: number;
  roof: RoofKind;
  shop?: boolean;
  sign?: string;
  door?: boolean;
  /** Set on a lot that houses one of the plan's named doors. */
  doorId?: string;
  /** The block it stands in, so a builder can match its materials to the neighbourhood. */
  block: [number, number];
}

export interface LandmarkLot {
  id: string;
  kind: LandmarkKind;
  x: number;
  z: number;
  /** Footprint, for the builder and for collision. */
  w: number;
  d: number;
  h: number;
  face: 0 | 1 | 2 | 3;
  seed: number;
  block: [number, number];
}

export type CourtKind = 'paved' | 'garden' | 'lawn' | 'water' | 'yard' | 'dirt' | 'track' | 'plaza' | 'market' | 'allotment';

export interface Court {
  rect: Rect;
  kind: CourtKind;
  block: [number, number];
  /** Water/track courts block walking, except along the strips in `walk`. */
  walk?: Rect[];
}

export type AnchorKind = 'spawn' | 'door' | 'npc' | 'board' | 'gate' | 'poi' | 'fold' | 'wave';

export interface Anchor {
  id: string;
  kind: AnchorKind;
  x: number;
  z: number;
  label: string;
  /** Door kind, gate destination, poi kind… whatever the consumer needs to branch on. */
  sub?: string;
  face?: 0 | 1 | 2 | 3;
  area: string;
  radius?: number;
}

export interface Area {
  name: string;
  rect: Rect;
  blocks: [number, number][];
}

export interface Fence {
  /** A thin wall: x0,z0 → x1,z1, axis-aligned. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** 'wall' for brick, 'rail' for open metal, 'hedge' for planting. */
  kind: 'wall' | 'rail' | 'hedge';
  height: number;
}

export interface CityLayout {
  sector: SectorId;
  name: string;
  /** One line about what kind of place this is, for the map page to say in its own words. */
  tagline: string;
  /** The whole zone, edge to edge, including the ring road. */
  extent: Rect;
  /** Where a player may stand. */
  bounds: Rect;
  blocks: PlacedBlock[];
  streets: StreetRect[];
  intersections: Rect[];
  lots: Lot[];
  landmarks: LandmarkLot[];
  courts: Court[];
  fences: Fence[];
  solids: Solid[];
  anchors: Anchor[];
  areas: Area[];
  /** Block grid dimensions, for map drawing. */
  cols: number;
  rows: number;
}
