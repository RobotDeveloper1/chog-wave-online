import type { SectorId } from '../wave.ts';
import type {
  Anchor,
  Area,
  BlockDef,
  BuildingStyle,
  CityLayout,
  Court,
  CourtKind,
  DoorDef,
  Fence,
  LandmarkKind,
  LandmarkLot,
  Lot,
  PlacedBlock,
  Rect,
  RoofKind,
  Side,
  Solid,
  StreetRect,
  ZonePlan,
} from './types.ts';

/**
 * plan -> city.
 *
 * Everything here is a pure function of the plan, which is what lets the server and the
 * client agree on where a door is without sending either one a map. The generator is a
 * set of *rules about space* rather than a pile of coordinates: a shop block puts a
 * continuous wall of shopfronts on its streets and leaves a court behind, a house block
 * puts two rows face to face with a garden lane between them. The rules are what make a
 * grid of rectangles read as a neighbourhood.
 */

export const SIDEWALK = 3;
const FLOOR = 3.3;
/** Margin a solid keeps round a building, so the player's circle does not catch a corner. */
const PAD = 0.12;

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (xs: number[]): number => xs.reduce((s, v) => s + v, 0);
const between = (r: () => number, a: number, b: number): number => a + r() * (b - a);
const choose = <T>(r: () => number, xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))]!;

/** How each district builds the same kinds of block. */
interface Profile {
  shop: BuildingStyle;
  house: BuildingStyle;
  tenement: BuildingStyle;
  warehouse: BuildingStyle;
  tower: BuildingStyle;
  podium: BuildingStyle;
  shopFloors: [number, number];
  houseFloors: [number, number];
  tenementFloors: [number, number];
  towerFloors: [number, number];
  roofs: RoofKind[];
}

const PROFILE: Record<SectorId, Profile> = {
  ashflat: {
    shop: 'shopfront',
    house: 'rowhouse',
    tenement: 'tenement',
    warehouse: 'warehouse',
    tower: 'tenement',
    podium: 'shopfront',
    shopFloors: [2, 3],
    houseFloors: [2.6, 3.4],
    tenementFloors: [4, 5.4],
    towerFloors: [5, 7],
    roofs: ['gable', 'gable', 'flat', 'hip'],
  },
  voltgrid: {
    shop: 'podium',
    house: 'tenement',
    tenement: 'tower',
    warehouse: 'warehouse',
    tower: 'tower',
    podium: 'podium',
    shopFloors: [2.4, 3.4],
    houseFloors: [3.5, 5],
    tenementFloors: [5, 7],
    towerFloors: [6, 10],
    roofs: ['flat', 'stepped', 'flat'],
  },
  hollow: {
    shop: 'arcade',
    house: 'arcade',
    tenement: 'arcade',
    warehouse: 'warehouse',
    tower: 'arcade',
    podium: 'arcade',
    shopFloors: [2.4, 3.4],
    houseFloors: [3, 4],
    tenementFloors: [4, 6],
    towerFloors: [5, 8],
    roofs: ['flat', 'flat', 'stepped'],
  },
};

// ---------------------------------------------------------------------------
// Rect helpers
// ---------------------------------------------------------------------------

const inflate = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, z0: r.z0 - d, x1: r.x1 + d, z1: r.z1 + d });
export const rectW = (r: Rect): number => r.x1 - r.x0;
export const rectD = (r: Rect): number => r.z1 - r.z0;
export const rectCx = (r: Rect): number => (r.x0 + r.x1) / 2;
export const rectCz = (r: Rect): number => (r.z0 + r.z1) / 2;
const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
export const inRect = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

const solidOf = (x0: number, z0: number, x1: number, z1: number, pad = PAD): Solid => ({
  x: (x0 + x1) / 2,
  z: (z0 + z1) / 2,
  halfW: (x1 - x0) / 2 + pad,
  halfD: (z1 - z0) / 2 + pad,
});

// ---------------------------------------------------------------------------
// The build context a block filler writes into
// ---------------------------------------------------------------------------

interface Ctx {
  plan: ZonePlan;
  profile: Profile;
  out: CityLayout;
  block: PlacedBlock;
  rand: () => number;
  seq: { n: number };
}

const faceOf = (side: Side): 0 | 1 | 2 | 3 => (side === 'N' ? 0 : side === 'E' ? 1 : side === 'S' ? 2 : 3);

interface Reserve {
  a: number;
  b: number;
  kind: 'gap' | 'door' | 'keep';
  door?: DoorDef;
}

interface RowOpts {
  side: Side;
  /** Along-axis extent, in absolute coordinates. */
  from: number;
  to: number;
  depth: number;
  minW: number;
  maxW: number;
  reserves?: Reserve[];
  /** Floors for an ordinary lot; doors may override. */
  floors: [number, number];
  style: BuildingStyle;
  /** Fraction of lots that are shopfronts (they get awnings and signs from the builder). */
  shops?: number;
  roofs?: RoofKind[];
  /** A style for the lots that carry a named door, by door kind. */
  doorStyle?: (d: DoorDef) => BuildingStyle;
}

const DOOR_STYLE: Record<string, BuildingStyle> = {
  shop: 'shopfront',
  heal: 'clinic',
  brother: 'townhall',
  telemetry: 'terminal',
  dungeon: 'depot',
  station: 'terminal',
  home: 'rowhouse',
};

function pushLot(ctx: Ctx, lot: Omit<Lot, 'id' | 'block'>): Lot {
  const full: Lot = { ...lot, id: `${ctx.plan.sector}-b${ctx.block.c}${ctx.block.r}-${ctx.seq.n++}`, block: [ctx.block.c, ctx.block.r] };
  ctx.out.lots.push(full);
  ctx.out.solids.push(solidOf(lot.x - lot.w / 2, lot.z - lot.d / 2, lot.x + lot.w / 2, lot.z + lot.d / 2));
  return full;
}

/**
 * Lay a run of lots along one side of a block. Reserved intervals are either alley
 * mouths (nothing is built) or named doors (a wider lot that carries the door); the rest
 * is cut into random widths, with the last lot absorbing the remainder so a row never
 * ends in a sliver.
 */
function fillRow(ctx: Ctx, o: RowOpts): Lot[] {
  const { inner } = ctx.block;
  const made: Lot[] = [];
  const rs = [...(o.reserves ?? [])].sort((p, q) => p.a - q.a);
  const segs: { a: number; b: number; res?: Reserve }[] = [];
  let t = o.from;
  for (const r of rs) {
    const a = Math.max(o.from, r.a);
    const b = Math.min(o.to, r.b);
    if (b <= a) continue;
    if (a > t + 0.01) segs.push({ a: t, b: a });
    segs.push({ a, b, res: r });
    t = b;
  }
  if (t < o.to - 0.01) segs.push({ a: t, b: o.to });

  const emit = (a: number, b: number, extra: Partial<Lot> = {}): void => {
    const w = b - a;
    if (w < 1.6) return;
    const along = (a + b) / 2;
    let x: number;
    let z: number;
    let lw: number;
    let ld: number;
    if (o.side === 'N' || o.side === 'S') {
      x = along;
      z = o.side === 'N' ? inner.z0 + o.depth / 2 : inner.z1 - o.depth / 2;
      lw = w;
      ld = o.depth;
    } else {
      z = along;
      x = o.side === 'W' ? inner.x0 + o.depth / 2 : inner.x1 - o.depth / 2;
      lw = o.depth;
      ld = w;
    }
    const floors = Math.max(1, Math.round(between(ctx.rand, o.floors[0], o.floors[1])));
    const roof = choose(ctx.rand, o.roofs ?? ctx.profile.roofs);
    const shop = ctx.rand() < (o.shops ?? 0);
    const names = SHOP_NAMES[ctx.plan.sector];
    made.push(
      pushLot(ctx, {
        style: o.style,
        x,
        z,
        w: lw,
        d: ld,
        h: floors * FLOOR,
        face: faceOf(o.side),
        seed: Math.floor(ctx.rand() * 1e6),
        roof,
        shop,
        ...(shop && ctx.rand() < 0.6 && w >= 6 ? { sign: choose(ctx.rand, names) } : {}),
        ...extra,
      }),
    );
  };

  for (const seg of segs) {
    if (seg.res?.kind === 'gap' || seg.res?.kind === 'keep') continue;
    if (seg.res?.kind === 'door' && seg.res.door) {
      const d = seg.res.door;
      const style = o.doorStyle?.(d) ?? DOOR_STYLE[d.kind] ?? o.style;
      const taller = style === 'townhall' || style === 'terminal' ? 1 : 0;
      emit(seg.a, seg.b, {
        style,
        shop: true,
        door: true,
        doorId: d.id,
        sign: d.label,
        // The buildings that matter are a floor taller than the rest, so the door
        // you are looking for is also the one you can see from the other end of the street.
        h: (Math.round(o.floors[1]) + taller) * FLOOR,
        roof: style === 'townhall' ? 'hip' : style === 'depot' ? 'sawtooth' : 'flat',
      });
      continue;
    }
    let p = seg.a;
    while (seg.b - p > 0.01) {
      const remaining = seg.b - p;
      let w = between(ctx.rand, o.minW, o.maxW);
      if (remaining - w < o.minW) w = remaining;
      emit(p, p + w);
      p += w;
    }
  }
  return made;
}

/** Along-axis position of a door, in absolute coordinates, for a side of the inner rect. */
function doorSpan(inner: Rect, d: DoorDef, width: number): Reserve {
  const horizontal = d.side === 'N' || d.side === 'S';
  const a0 = horizontal ? inner.x0 : inner.z0;
  const a1 = horizontal ? inner.x1 : inner.z1;
  const centre = a0 + d.at * (a1 - a0);
  const half = width / 2;
  const a = Math.max(a0 + 0.5, Math.min(a1 - 0.5 - width, centre - half));
  return { a, b: a + width, kind: 'door', door: d };
}

/** The anchor a door resolves to: on the sidewalk, in front of its lot. */
function doorAnchor(ctx: Ctx, lot: Lot, d: DoorDef): Anchor {
  const reach = SIDEWALK / 2 + 0.6;
  const dx = lot.face === 1 ? reach : lot.face === 3 ? -reach : 0;
  const dz = lot.face === 2 ? reach : lot.face === 0 ? -reach : 0;
  return {
    id: d.id,
    kind: d.kind === 'dungeon' ? 'fold' : 'door',
    x: lot.x + dx + (dx !== 0 ? Math.sign(dx) * lot.w / 2 : 0),
    z: lot.z + dz + (dz !== 0 ? Math.sign(dz) * lot.d / 2 : 0),
    label: d.label,
    sub: d.kind,
    face: lot.face,
    area: ctx.block.def.name,
    radius: 2.6,
  };
}

function addCourt(ctx: Ctx, rect: Rect, kind: CourtKind, walk?: Rect[]): Court | null {
  if (rectW(rect) < 2 || rectD(rect) < 2) return null;
  const court: Court = { rect, kind, block: [ctx.block.c, ctx.block.r], ...(walk ? { walk } : {}) };
  ctx.out.courts.push(court);
  return court;
}

function addFence(ctx: Ctx, f: Fence): void {
  ctx.out.fences.push(f);
  ctx.out.solids.push(solidOf(f.x0, f.z0, f.x1, f.z1, 0.18));
}

function addLandmark(ctx: Ctx, kind: LandmarkKind, x: number, z: number, w: number, d: number, h: number, face: 0 | 1 | 2 | 3 = 2, solid = true): LandmarkLot {
  const lm: LandmarkLot = {
    id: `${ctx.plan.sector}-lm-${kind}-${ctx.block.c}${ctx.block.r}`,
    kind,
    x,
    z,
    w,
    d,
    h,
    face,
    seed: Math.floor(ctx.rand() * 1e6),
    block: [ctx.block.c, ctx.block.r],
  };
  ctx.out.landmarks.push(lm);
  if (solid) ctx.out.solids.push(solidOf(x - w / 2, z - d / 2, x + w / 2, z + d / 2));
  return lm;
}

/** Reserve alley mouths on a side, away from the corners and from each other. */
function alleys(ctx: Ctx, side: Side, count: number, width = 4.4): Reserve[] {
  const { inner } = ctx.block;
  const horizontal = side === 'N' || side === 'S';
  const a0 = (horizontal ? inner.x0 : inner.z0) + 9;
  const a1 = (horizontal ? inner.x1 : inner.z1) - 9;
  const out: Reserve[] = [];
  for (let i = 0; i < count; i++) {
    const t = a0 + ((i + 0.5) / count) * (a1 - a0) + between(ctx.rand, -2.5, 2.5);
    out.push({ a: t - width / 2, b: t + width / 2, kind: 'gap' });
  }
  return out;
}

const doorsOn = (ctx: Ctx, side: Side, width: number): Reserve[] =>
  (ctx.block.def.doors ?? []).filter((d) => d.side === side).map((d) => doorSpan(ctx.block.inner, d, width));

/** Drop gaps that collide with a door, so an alley never eats the building you wanted. */
function clearOf(res: Reserve[], doors: Reserve[]): Reserve[] {
  return res.filter((g) => !doors.some((d) => g.a < d.b + 1.2 && g.b > d.a - 1.2));
}

// ---------------------------------------------------------------------------
// Block fillers
// ---------------------------------------------------------------------------

type Filler = (ctx: Ctx) => void;

/** A ring of buildings on all four sides, with alley mouths, and whatever is left a court. */
function ringBlock(
  ctx: Ctx,
  o: {
    style: BuildingStyle;
    floors: [number, number];
    depthNS: [number, number];
    depthEW: [number, number];
    minW: number;
    maxW: number;
    shops: number;
    court: CourtKind;
    alleysNS?: number;
    alleysEW?: number;
    sides?: Side[];
  },
): { court: Rect } {
  const { inner } = ctx.block;
  const sides = o.sides ?? ['N', 'S', 'E', 'W'];
  const dN = sides.includes('N') ? between(ctx.rand, o.depthNS[0], o.depthNS[1]) : 0;
  const dS = sides.includes('S') ? between(ctx.rand, o.depthNS[0], o.depthNS[1]) : 0;
  const dE = sides.includes('E') ? between(ctx.rand, o.depthEW[0], o.depthEW[1]) : 0;
  const dW = sides.includes('W') ? between(ctx.rand, o.depthEW[0], o.depthEW[1]) : 0;

  const door = new Map<string, Lot>();
  const run = (side: Side, depth: number, from: number, to: number, alleyCount: number): void => {
    if (!sides.includes(side)) return;
    const doors = doorsOn(ctx, side, 9);
    const gaps = clearOf(alleys(ctx, side, alleyCount), doors);
    const made = fillRow(ctx, {
      side,
      from,
      to,
      depth,
      minW: o.minW,
      maxW: o.maxW,
      reserves: [...doors, ...gaps],
      floors: o.floors,
      style: o.style,
      shops: o.shops,
    });
    for (const lot of made) if (lot.doorId) door.set(lot.doorId, lot);
  };
  run('N', dN, inner.x0, inner.x1, o.alleysNS ?? 1);
  run('S', dS, inner.x0, inner.x1, o.alleysNS ?? 1);
  run('W', dW, inner.z0 + dN, inner.z1 - dS, o.alleysEW ?? 1);
  run('E', dE, inner.z0 + dN, inner.z1 - dS, o.alleysEW ?? 1);

  for (const d of ctx.block.def.doors ?? []) {
    const lot = door.get(d.id);
    if (lot) ctx.out.anchors.push(doorAnchor(ctx, lot, d));
  }

  const court: Rect = { x0: inner.x0 + dW, z0: inner.z0 + dN, x1: inner.x1 - dE, z1: inner.z1 - dS };
  addCourt(ctx, court, o.court);
  return { court };
}

const shops: Filler = (ctx) => {
  const p = ctx.profile;
  const { court } = ringBlock(ctx, {
    style: p.shop,
    floors: p.shopFloors.map((f) => f * (ctx.block.def.tall ?? 1)) as [number, number],
    depthNS: [8.5, 10.5],
    depthEW: [7.5, 9],
    minW: 9,
    maxW: 14,
    shops: 0.7,
    court: 'paved',
  });
  scatterKiosks(ctx, court, 2);
};

const houses: Filler = (ctx) => {
  const p = ctx.profile;
  ringBlock(ctx, {
    style: p.house,
    floors: p.houseFloors.map((f) => f * (ctx.block.def.tall ?? 1)) as [number, number],
    depthNS: [8, 9.2],
    depthEW: [0, 0],
    minW: 7,
    maxW: 10,
    shops: 0.1,
    court: 'garden',
    alleysNS: 1,
    sides: ['N', 'S'],
  });
};

const tenements: Filler = (ctx) => {
  const p = ctx.profile;
  ringBlock(ctx, {
    style: p.tenement,
    floors: p.tenementFloors.map((f) => f * (ctx.block.def.tall ?? 1)) as [number, number],
    depthNS: [10, 12],
    depthEW: [9, 11],
    minW: 10,
    maxW: 15,
    shops: 0.35,
    court: 'paved',
    alleysNS: 1,
    alleysEW: 1,
  });
};

const towers: Filler = (ctx) => {
  const p = ctx.profile;
  // A low podium faces the two long streets; the tower stands behind it with a walkway
  // all round. The street wall stays low, so the skyline is something you look *up* at,
  // and a pedestrian can still go round the back.
  const { court } = ringBlock(ctx, {
    style: p.podium,
    floors: [2.4, 3.4],
    depthNS: [6.5, 8],
    depthEW: [0, 0],
    minW: 7,
    maxW: 12,
    shops: 0.8,
    court: 'plaza',
    alleysNS: 1,
    sides: ['N', 'S'],
  });
  const cw = rectW(court);
  const cd = rectD(court);
  const count = cw > 40 ? 2 : 1;
  const slot = cw / count;
  for (let i = 0; i < count; i++) {
    const w = Math.min(slot - 8, between(ctx.rand, 11, 15));
    const d = Math.min(cd - 7, between(ctx.rand, 9, 13));
    if (w < 6 || d < 6) continue;
    const cx = court.x0 + (i + 0.5) * slot;
    const cz = rectCz(court);
    const floors = Math.round(between(ctx.rand, p.towerFloors[0], p.towerFloors[1]) * (ctx.block.def.tall ?? 1));
    pushLot(ctx, {
      style: p.tower,
      x: cx,
      z: cz,
      w,
      d,
      h: floors * FLOOR,
      face: 2,
      seed: Math.floor(ctx.rand() * 1e6),
      roof: choose(ctx.rand, ['stepped', 'flat'] as const),
      // The tallest thing in a block is its address: it carries the block's door, if it has one.
      ...(ctx.block.def.doors?.length ? { shop: true } : {}),
    });
  }
};

const plaza: Filler = (ctx) => {
  const { inner, def } = ctx.block;
  addCourt(ctx, inner, 'plaza');
  const cx = rectCx(inner);
  const cz = rectCz(inner);
  const kind = def.landmark ?? 'fountain';
  const size = Math.min(rectW(inner), rectD(inner));
  if (kind === 'clocktower') addLandmark(ctx, kind, cx, cz, 7.5, 7.5, 30, 2);
  else if (kind === 'holoPillar') addLandmark(ctx, kind, cx, cz, 5, 5, 26, 2);
  else if (kind === 'monument') addLandmark(ctx, kind, cx, cz, 5, 5, 9, 2);
  else if (kind === 'bandstand') addLandmark(ctx, kind, cx, cz, 9, 9, 5.5, 2);
  else addLandmark(ctx, 'fountain', cx, cz, Math.min(10, size * 0.4), Math.min(10, size * 0.4), 3.2, 2);
  // Kiosks at the corners of the square, where people actually stand.
  const pad = 5.5;
  const spots: [number, number][] = [
    [inner.x0 + pad, inner.z0 + pad],
    [inner.x1 - pad, inner.z0 + pad],
    [inner.x0 + pad, inner.z1 - pad],
    [inner.x1 - pad, inner.z1 - pad],
  ];
  for (const [i, [x, z]] of spots.entries()) {
    if (ctx.rand() < 0.45) continue;
    pushLot(ctx, { style: 'kiosk', x, z, w: 3.2, d: 3.2, h: 3.4, face: ((i + 2) % 4) as 0 | 1 | 2 | 3, seed: Math.floor(ctx.rand() * 1e6), roof: 'hip', shop: true });
  }
  for (const d of ctx.block.def.doors ?? []) {
    // A door on a plaza is a kiosk-sized building at the edge of the square.
    const horizontal = d.side === 'N' || d.side === 'S';
    const a0 = horizontal ? inner.x0 : inner.z0;
    const a1 = horizontal ? inner.x1 : inner.z1;
    const t = a0 + d.at * (a1 - a0);
    const depth = 8;
    const w = 9;
    const lot = pushLot(ctx, {
      style: DOOR_STYLE[d.kind] ?? 'shopfront',
      x: horizontal ? t : d.side === 'W' ? inner.x0 + depth / 2 : inner.x1 - depth / 2,
      z: horizontal ? (d.side === 'N' ? inner.z0 + depth / 2 : inner.z1 - depth / 2) : t,
      w: horizontal ? w : depth,
      d: horizontal ? depth : w,
      h: 3 * FLOOR,
      face: faceOf(d.side),
      seed: Math.floor(ctx.rand() * 1e6),
      roof: 'hip',
      shop: true,
      door: true,
      doorId: d.id,
      sign: d.label,
    });
    ctx.out.anchors.push(doorAnchor(ctx, lot, d));
  }
};

const park: Filler = (ctx) => {
  const { inner, rect } = ctx.block;
  addCourt(ctx, inner, 'lawn');
  // A pond off-centre, so the paths have something to bend round.
  const pw = Math.min(rectW(inner) * 0.42, 15);
  const pd = Math.min(rectD(inner) * 0.3, 11);
  const px = rectCx(inner) + between(ctx.rand, -rectW(inner) * 0.12, rectW(inner) * 0.12);
  const pz = rectCz(inner) + between(ctx.rand, -rectD(inner) * 0.12, rectD(inner) * 0.12);
  const pond: Rect = { x0: px - pw / 2, z0: pz - pd / 2, x1: px + pw / 2, z1: pz + pd / 2 };
  addCourt(ctx, pond, 'water');
  ctx.out.solids.push(solidOf(pond.x0, pond.z0, pond.x1, pond.z1, -0.2));
  if (ctx.block.def.landmark === 'bandstand') {
    addLandmark(ctx, 'bandstand', rectCx(inner) - rectW(inner) * 0.28, rectCz(inner) + rectD(inner) * 0.25, 8, 8, 5.2, 2);
  }
  // A low rail round the park with gates, which is what makes it a place you enter.
  const gate = 6.5;
  const edge = (side: Side): void => {
    const horizontal = side === 'N' || side === 'S';
    const a0 = horizontal ? rect.x0 + 0.6 : rect.z0 + 0.6;
    const a1 = horizontal ? rect.x1 - 0.6 : rect.z1 - 0.6;
    const mid = (a0 + a1) / 2 + between(ctx.rand, -4, 4);
    const fixed =
      side === 'N' ? rect.z0 + 0.5 : side === 'S' ? rect.z1 - 0.5 : side === 'W' ? rect.x0 + 0.5 : rect.x1 - 0.5;
    const segs: [number, number][] = [
      [a0, mid - gate / 2],
      [mid + gate / 2, a1],
    ];
    for (const [a, b] of segs) {
      if (b - a < 1) continue;
      addFence(ctx, horizontal
        ? { x0: a, z0: fixed, x1: b, z1: fixed, kind: 'rail', height: 1.1 }
        : { x0: fixed, z0: a, x1: fixed, z1: b, kind: 'rail', height: 1.1 });
    }
  };
  for (const s of ['N', 'E', 'S', 'W'] as const) edge(s);
};

const market: Filler = (ctx) => {
  const p = ctx.profile;
  const { court } = ringBlock(ctx, {
    style: p.shop,
    floors: [1.4, 2.4],
    depthNS: [6.5, 7.5],
    depthEW: [0, 0],
    minW: 6,
    maxW: 9,
    shops: 1,
    court: 'market',
    alleysNS: 1,
    sides: ['N', 'S'],
  });
  // Stalls in two rows with a wide aisle between and a cross-aisle through the middle.
  // Two rows only fit in a court deep enough to hold them: on a shallow block the old
  // code stood them at a fixed offset from the centre, which put them *inside* the
  // shopfronts behind them. A shallow court gets one row down the middle instead.
  const aisle = 3.6;
  const sw = 3.2;
  const sd = 2.4;
  const cols = Math.max(2, Math.floor((rectW(court) - 4) / (sw + aisle)));
  const x0 = rectCx(court) - ((cols - 1) * (sw + aisle)) / 2;
  const off = sd + aisle / 2 + 0.4;
  const rowsZ = rectD(court) >= 2 * off + sd ? [rectCz(court) - off, rectCz(court) + off] : [rectCz(court)];
  for (const z of rowsZ) {
    for (let i = 0; i < cols; i++) {
      if (cols > 3 && i === Math.floor(cols / 2)) continue;
      pushLot(ctx, { style: 'kiosk', x: x0 + i * (sw + aisle), z, w: sw, d: sd, h: 2.9, face: z < rectCz(court) ? 2 : 0, seed: Math.floor(ctx.rand() * 1e6), roof: 'hip', shop: true });
    }
  }
  // Stalls close to the row buildings would seal the aisle behind them; keep the ends open.
  void sw;
};

const industrial: Filler = (ctx) => {
  const { inner, rect } = ctx.block;
  const p = ctx.profile;
  addCourt(ctx, inner, 'yard');
  const depth = Math.min(15, rectD(inner) * 0.34);
  const made: Lot[] = [];
  made.push(...fillRow(ctx, { side: 'N', from: inner.x0 + 1, to: inner.x1 - 1, depth, minW: 12, maxW: 20, floors: [2, 2.6], style: p.warehouse, roofs: ['sawtooth', 'flat'], reserves: alleys(ctx, 'N', 1, 6) }));
  made.push(...fillRow(ctx, { side: 'S', from: inner.x0 + 1, to: inner.x1 - 1, depth: depth * 0.8, minW: 12, maxW: 18, floors: [1.8, 2.4], style: p.warehouse, roofs: ['sawtooth', 'flat'], reserves: alleys(ctx, 'S', 1, 6) }));
  // A yard with a landmark in it keeps the middle clear. The Fold Gate used to be a door
  // on a warehouse behind three stacks of containers, which is why nobody could find it:
  // the thing the whole dungeon half of the game points at was the least visible object
  // in the district. Now it stands in the open middle of the yard with nothing parked in
  // front of it, and it is tall enough to see over the roofs of its own block.
  if (ctx.block.def.landmark) {
    const lw = Math.min(16, rectW(inner) * 0.55);
    const ld = Math.min(10, rectD(inner) * 0.32);
    addLandmark(ctx, ctx.block.def.landmark, rectCx(inner), rectCz(inner), lw, ld, 30, 2);
  } else {
    // Container stacks in the open yard — cheap, readable as "industrial" at any zoom.
    const yard: Rect = { x0: inner.x0 + 3, z0: inner.z0 + depth + 4, x1: inner.x1 - 3, z1: inner.z1 - depth * 0.8 - 4 };
    for (let i = 0; i < 3; i++) {
      const w = between(ctx.rand, 6, 8);
      const d = 2.6;
      for (let attempt = 0; attempt < 14; attempt++) {
        const x = yard.x0 + w / 2 + ctx.rand() * Math.max(1, rectW(yard) - w);
        const z = yard.z0 + 2 + ctx.rand() * Math.max(0.5, rectD(yard) - 4);
        if (!isClear(ctx.out.solids, x, z, w / 2, d / 2, 2.4)) continue;
        pushLot(ctx, { style: 'kiosk', x, z, w, d, h: 2.6 * (1 + Math.floor(ctx.rand() * 2)), face: 2, seed: Math.floor(ctx.rand() * 1e6), roof: 'flat' });
        break;
      }
    }
  }
  const gate = 8;
  for (const side of ['N', 'S'] as const) {
    const z = side === 'N' ? rect.z0 + 0.6 : rect.z1 - 0.6;
    const mid = rectCx(rect) + between(ctx.rand, -8, 8);
    addFence(ctx, { x0: rect.x0 + 0.6, z0: z, x1: mid - gate / 2, z1: z, kind: 'rail', height: 2 });
    addFence(ctx, { x0: mid + gate / 2, z0: z, x1: rect.x1 - 0.6, z1: z, kind: 'rail', height: 2 });
  }
  for (const d of ctx.block.def.doors ?? []) {
    const lot = made.find((l) => l.face === faceOf(d.side));
    if (!lot) continue;
    lot.doorId = d.id;
    lot.door = true;
    lot.sign = d.label;
    lot.shop = true;
    ctx.out.anchors.push(doorAnchor(ctx, lot, d));
  }
};

const station: Filler = (ctx) => {
  const { inner } = ctx.block;
  const p = ctx.profile;
  const w = 17;
  const d = 15;
  const cx = rectCx(inner);
  const lm = addLandmark(ctx, 'waveStation', cx, inner.z0 + d / 2, w, d, 36, 2);
  // The forecourt: a paved apron the whole street can see, with the door on its north edge.
  const apron: Rect = { x0: inner.x0, z0: inner.z0 + d, x1: inner.x1, z1: inner.z1 };
  addCourt(ctx, apron, 'plaza');
  // Flanking buildings pin the square, one each side, so it reads as a place with walls.
  const flank = (side: 'W' | 'E'): void => {
    const fw = (rectW(inner) - w) / 2 - 1;
    if (fw < 5) return;
    pushLot(ctx, {
      style: p.shop,
      x: side === 'W' ? inner.x0 + fw / 2 : inner.x1 - fw / 2,
      z: inner.z0 + d * 0.62,
      w: fw,
      d: d * 0.9,
      h: 3 * FLOOR,
      face: 2,
      seed: Math.floor(ctx.rand() * 1e6),
      roof: 'flat',
      shop: true,
    });
  };
  flank('W');
  flank('E');
  for (const door of ctx.block.def.doors ?? []) {
    ctx.out.anchors.push({
      id: door.id,
      kind: 'door',
      x: lm.x,
      z: lm.z + lm.d / 2 + 2.2,
      label: door.label,
      sub: door.kind,
      face: 2,
      area: ctx.block.def.name,
      radius: 3.4,
    });
  }
};

const rail: Filler = (ctx) => {
  const { inner } = ctx.block;
  addCourt(ctx, inner, 'dirt');
  // North to south: the station building, a platform to stand on, the tracks, and a strip
  // of cinder on the far side. The tracks are a hazard band you cross only at the
  // crossings, which is what makes the yard a place with a far side.
  const bandZ0 = inner.z0 + 13;
  const bandZ1 = bandZ0 + 8.4;
  addCourt(ctx, { x0: inner.x0, z0: inner.z0 + 9.5, x1: inner.x1, z1: bandZ0 }, 'paved');
  const crossings: Rect[] = [
    { x0: inner.x0, z0: bandZ0, x1: inner.x0 + 5, z1: bandZ1 },
    { x0: inner.x1 - 5, z0: bandZ0, x1: inner.x1, z1: bandZ1 },
    { x0: rectCx(inner) - 3, z0: bandZ0, x1: rectCx(inner) + 3, z1: bandZ1 },
  ];
  addCourt(ctx, { x0: inner.x0, z0: bandZ0, x1: inner.x1, z1: bandZ1 }, 'track', crossings);
  // Everything except the crossings is solid: the rails are a fence you cannot see.
  const cuts = [inner.x0 + 5, rectCx(inner) - 3, rectCx(inner) + 3, inner.x1 - 5];
  ctx.out.solids.push(solidOf(cuts[0]!, bandZ0, cuts[1]!, bandZ1, -0.4));
  ctx.out.solids.push(solidOf(cuts[2]!, bandZ0, cuts[3]!, bandZ1, -0.4));
  addLandmark(ctx, 'oldStation', rectCx(inner) - 3, inner.z0 + 5, Math.min(22, rectW(inner) - 6), 9, 9, 2);
};

const water: Filler = (ctx) => {
  const { inner } = ctx.block;
  addCourt(ctx, inner, 'paved');
  const pond: Rect = { x0: inner.x0 + 3.2, z0: inner.z0 + 3.2, x1: inner.x1 - 3.2, z1: inner.z1 - 3.2 };
  const horizontal = rectW(pond) >= rectD(pond);
  const bridge: Rect = horizontal
    ? { x0: rectCx(pond) - 1.5, z0: pond.z0, x1: rectCx(pond) + 1.5, z1: pond.z1 }
    : { x0: pond.x0, z0: rectCz(pond) - 1.5, x1: pond.x1, z1: rectCz(pond) + 1.5 };
  addCourt(ctx, pond, 'water', [bridge]);
  if (horizontal) {
    ctx.out.solids.push(solidOf(pond.x0, pond.z0, bridge.x0, pond.z1, -0.2));
    ctx.out.solids.push(solidOf(bridge.x1, pond.z0, pond.x1, pond.z1, -0.2));
  } else {
    ctx.out.solids.push(solidOf(pond.x0, pond.z0, pond.x1, bridge.z0, -0.2));
    ctx.out.solids.push(solidOf(pond.x0, bridge.z1, pond.x1, pond.z1, -0.2));
  }
};

const greenhouse: Filler = (ctx) => {
  const { inner } = ctx.block;
  addCourt(ctx, inner, 'allotment');
  const cw = rectW(inner);
  const cd = rectD(inner);
  if (ctx.block.def.landmark === 'dome') {
    // The great dome takes the middle of the block; the allotments wrap round it.
    addLandmark(ctx, 'dome', rectCx(inner), rectCz(inner), Math.min(18, cw * 0.62), Math.min(20, cd * 0.56), 15, 2);
    return;
  }
  const w = Math.min(18, cw * 0.4);
  const d = Math.min(12, cd * 0.3);
  const spots: [number, number][] = [
    [inner.x0 + w / 2 + 2, inner.z0 + d / 2 + 2],
    [inner.x1 - w / 2 - 2, inner.z0 + d / 2 + 2],
    [rectCx(inner), inner.z1 - d / 2 - 2],
  ];
  for (const [x, z] of spots) {
    pushLot(ctx, { style: 'greenhouse', x, z, w, d, h: 6.4, face: 2, seed: Math.floor(ctx.rand() * 1e6), roof: 'dome' });
  }
};

const ruin: Filler = (ctx) => {
  const { inner } = ctx.block;
  addCourt(ctx, inner, 'dirt');
  for (let i = 0; i < 4; i++) {
    const w = between(ctx.rand, 5, 9);
    const d = between(ctx.rand, 4, 7);
    for (let attempt = 0; attempt < 14; attempt++) {
      const x = inner.x0 + 4 + ctx.rand() * Math.max(1, rectW(inner) - w - 8) + w / 2;
      const z = inner.z0 + 4 + ctx.rand() * Math.max(1, rectD(inner) - d - 8) + d / 2;
      if (!isClear(ctx.out.solids, x, z, w / 2, d / 2, 3)) continue;
      pushLot(ctx, { style: 'warehouse', x, z, w, d, h: between(ctx.rand, 3, 6.6), face: Math.floor(ctx.rand() * 4) as 0 | 1 | 2 | 3, seed: Math.floor(ctx.rand() * 1e6), roof: 'flat' });
      break;
    }
  }
};

/** What the shopfronts say. Unnamed ones are left unnamed on purpose: a street where every door has a sign is a font specimen. */
const SHOP_NAMES: Record<SectorId, readonly string[]> = {
  ashflat: ['BAKERY', 'TAILOR', 'PUB', 'BOOKS', 'FLORIST', 'HARDWARE', 'CAFE', 'DELI', 'PRINTERS', 'CLOCKS', 'TOYS', 'CHEMIST', 'BARBER', 'FISH', 'CHEESE', 'TEA ROOMS'],
  voltgrid: ['NEON CO', 'ARCADE', 'NOODLES', 'DATA SHOP', 'CYBERWARE', 'RAMEN', 'GLITCH BAR', 'HOLO SHOP', 'SIM CARDS', 'VR LOUNGE', 'SYNTH', 'PHONE FIX', 'CARD BAZAAR', 'BYTE CAFE'],
  hollow: ['HERBS', 'TEA HOUSE', 'SEEDS', 'REPAIR', 'MOSS & CO', 'GREENGROCER', 'POTTERY', 'FLOWERS', 'WELLNESS', 'BIKE REPAIR', 'BOOKS', 'GARDEN SHOP'],
};

const FILLERS: Record<BlockDef['kind'], Filler> = {
  shops,
  houses,
  tenements,
  towers,
  plaza,
  park,
  market,
  industrial,
  station,
  rail,
  water,
  greenhouse,
  ruin,
};

/** Whether a box clear of every solid so far, with `gap` to spare. */
export function isClear(solids: Solid[], x: number, z: number, halfW: number, halfD: number, gap = 1.2): boolean {
  for (const s of solids) {
    if (Math.abs(x - s.x) < s.halfW + halfW + gap && Math.abs(z - s.z) < s.halfD + halfD + gap) return false;
  }
  return true;
}

/** A few kiosks in a court, kept off everything else and apart from each other. */
function scatterKiosks(ctx: Ctx, court: Rect, n: number): void {
  if (rectW(court) < 9 || rectD(court) < 9) return;
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const x = court.x0 + 3 + ctx.rand() * (rectW(court) - 6);
      const z = court.z0 + 3 + ctx.rand() * (rectD(court) - 6);
      if (!isClear(ctx.out.solids, x, z, 1.4, 1.4, 2.2)) continue;
      pushLot(ctx, { style: 'kiosk', x, z, w: 2.8, d: 2.8, h: 3, face: Math.floor(ctx.rand() * 4) as 0 | 1 | 2 | 3, seed: Math.floor(ctx.rand() * 1e6), roof: 'hip', shop: true });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// The whole zone
// ---------------------------------------------------------------------------

export function layoutZone(plan: ZonePlan): CityLayout {
  const cols = plan.colW.length;
  const rows = plan.rowD.length;
  const W = sum(plan.colW) + sum(plan.gapX) + 2 * plan.ring;
  const D = sum(plan.rowD) + sum(plan.gapZ) + 2 * plan.ring;
  const extent: Rect = { x0: -W / 2, z0: -D / 2, x1: W / 2, z1: D / 2 };

  const bx: number[] = [];
  const bz: number[] = [];
  let x = extent.x0 + plan.ring;
  for (let c = 0; c < cols; c++) {
    bx.push(x);
    x += plan.colW[c]! + (plan.gapX[c] ?? 0);
  }
  let z = extent.z0 + plan.ring;
  for (let r = 0; r < rows; r++) {
    bz.push(z);
    z += plan.rowD[r]! + (plan.gapZ[r] ?? 0);
  }

  const out: CityLayout = {
    sector: plan.sector,
    name: plan.name,
    tagline: plan.tagline,
    extent,
    bounds: inflate(extent, -1.6),
    blocks: [],
    streets: [],
    intersections: [],
    lots: [],
    landmarks: [],
    courts: [],
    fences: [],
    solids: [],
    anchors: [],
    areas: [],
    cols,
    rows,
  };

  // Streets: the gaps between blocks, and the ring road round the edge.
  const vStreets: StreetRect[] = [];
  const hStreets: StreetRect[] = [];
  vStreets.push({ rect: { x0: extent.x0, z0: extent.z0, x1: extent.x0 + plan.ring, z1: extent.z1 }, axis: 'z', width: plan.ring, main: false });
  for (let c = 0; c < cols - 1; c++) {
    const x0 = bx[c]! + plan.colW[c]!;
    vStreets.push({ rect: { x0, z0: extent.z0, x1: x0 + plan.gapX[c]!, z1: extent.z1 }, axis: 'z', width: plan.gapX[c]!, main: c === plan.mainCol });
  }
  vStreets.push({ rect: { x0: extent.x1 - plan.ring, z0: extent.z0, x1: extent.x1, z1: extent.z1 }, axis: 'z', width: plan.ring, main: false });
  hStreets.push({ rect: { x0: extent.x0, z0: extent.z0, x1: extent.x1, z1: extent.z0 + plan.ring }, axis: 'x', width: plan.ring, main: false });
  for (let r = 0; r < rows - 1; r++) {
    const z0 = bz[r]! + plan.rowD[r]!;
    hStreets.push({ rect: { x0: extent.x0, z0, x1: extent.x1, z1: z0 + plan.gapZ[r]! }, axis: 'x', width: plan.gapZ[r]!, main: r === plan.mainRow });
  }
  hStreets.push({ rect: { x0: extent.x0, z0: extent.z1 - plan.ring, x1: extent.x1, z1: extent.z1 }, axis: 'x', width: plan.ring, main: false });
  out.streets.push(...vStreets, ...hStreets);
  for (const v of vStreets) {
    for (const h of hStreets) {
      out.intersections.push({ x0: v.rect.x0, z0: h.rect.z0, x1: v.rect.x1, z1: h.rect.z1 });
    }
  }

  // Blocks, each filled by its kind's rules and its own seed so editing one block's
  // plan never reshuffles the others.
  const seq = { n: 0 };
  const profile = PROFILE[plan.sector];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const def = plan.blocks[r]?.[c];
      if (!def) continue;
      const rect: Rect = { x0: bx[c]!, z0: bz[r]!, x1: bx[c]! + plan.colW[c]!, z1: bz[r]! + plan.rowD[r]! };
      const placed: PlacedBlock = { c, r, rect, inner: inflate(rect, -SIDEWALK), def };
      out.blocks.push(placed);
      const seed = (def.seed ?? 0) * 7919 + c * 131 + r * 17 + plan.sector.length * 1009;
      FILLERS[def.kind]({ plan, profile, out, block: placed, rand: mulberry32(seed), seq });
    }
  }

  // Areas: neighbouring blocks of the same name are one place.
  const byName = new Map<string, PlacedBlock[]>();
  for (const b of out.blocks) {
    const list = byName.get(b.def.name) ?? [];
    list.push(b);
    byName.set(b.def.name, list);
  }
  for (const [name, list] of byName) {
    const rect: Rect = {
      x0: Math.min(...list.map((b) => b.rect.x0)),
      z0: Math.min(...list.map((b) => b.rect.z0)),
      x1: Math.max(...list.map((b) => b.rect.x1)),
      z1: Math.max(...list.map((b) => b.rect.z1)),
    };
    out.areas.push({ name, rect, blocks: list.map((b) => [b.c, b.r] as [number, number]) });
  }

  resolveAnchors(plan, out);
  placeWaves(plan, out);
  return out;
}

/**
 * Where the Mystery Waves surface. One in every named area first, so every neighbourhood
 * has something to find, then the rest spread over the whole city; each on a sidewalk or
 * in a court, never inside a building and never on top of a door or a person.
 */
function placeWaves(plan: ZonePlan, out: CityLayout): void {
  const rand = mulberry32(plan.sector.length * 2749 + 3);
  const elements = ['burn', 'frost', 'volt', 'wave', 'prism', 'void'];
  const taken = out.anchors.filter((a) => a.kind !== 'gate').map((a) => ({ x: a.x, z: a.z }));
  const waves: { x: number; z: number; area: string }[] = [];
  const free = (x: number, z: number): boolean =>
    isClear(out.solids, x, z, 0, 0, 1.4) &&
    !taken.some((t) => Math.hypot(t.x - x, t.z - z) < 4.5) &&
    !waves.some((w) => Math.hypot(w.x - x, w.z - z) < 14) &&
    inRect(out.bounds, x, z);
  const tryBlock = (b: PlacedBlock): boolean => {
    for (let k = 0; k < 40; k++) {
      // Half the tries are on the sidewalk ring, half anywhere in the block: the ring is
      // always reachable, the court is where the interesting ones hide.
      const onRing = rand() < 0.5;
      let x: number;
      let z: number;
      if (onRing) {
        const side = Math.floor(rand() * 4);
        x = side === 0 || side === 2 ? b.rect.x0 + 3 + rand() * (rectW(b.rect) - 6) : side === 1 ? b.rect.x1 - 1.5 : b.rect.x0 + 1.5;
        z = side === 1 || side === 3 ? b.rect.z0 + 3 + rand() * (rectD(b.rect) - 6) : side === 0 ? b.rect.z0 + 1.5 : b.rect.z1 - 1.5;
      } else {
        x = b.inner.x0 + rand() * rectW(b.inner);
        z = b.inner.z0 + rand() * rectD(b.inner);
      }
      if (!free(x, z)) continue;
      waves.push({ x, z, area: b.def.name });
      return true;
    }
    return false;
  };
  const seen = new Set<string>();
  for (const b of out.blocks) {
    // One per neighbourhood, but never more than a district holds: a plan with more named
    // areas than there are waves would otherwise seed one each and blow straight past 18.
    if (waves.length >= 18) break;
    if (seen.has(b.def.name) || b.def.kind === 'water') continue;
    if (tryBlock(b)) seen.add(b.def.name);
  }
  for (let guard = 0; waves.length < 18 && guard < 400; guard++) {
    const b = out.blocks[Math.floor(rand() * out.blocks.length)]!;
    if (b.def.kind !== 'water') tryBlock(b);
  }
  waves.forEach((w, i) => {
    out.anchors.push({ id: `${plan.sector}-w${i}`, kind: 'wave', x: w.x, z: w.z, label: 'MYSTERY WAVE', sub: elements[i % elements.length]!, area: w.area, radius: 3.2 });
  });
}

function blockAt(out: CityLayout, c: number, r: number): PlacedBlock | undefined {
  return out.blocks.find((b) => b.c === c && b.r === r);
}

const areaOf = (out: CityLayout, x: number, z: number): string => {
  const b = out.blocks.find((q) => inRect(q.rect, x, z));
  if (b) return b.def.name;
  return 'Streets';
};

/**
 * The nearest spot to (x, z) with room to stand. A plan names where someone *should*
 * be; the random parts of a block (a kiosk, a stack of crates) decide where there is
 * actually room, and an NPC embedded in a kiosk is a bug the plan cannot see.
 */
export function nearestFree(solids: Solid[], x: number, z: number, clearance = 1.1, reach = 16): { x: number; z: number } {
  if (isClear(solids, x, z, 0, 0, clearance)) return { x, z };
  for (let ring = 1; ring * 0.75 <= reach; ring++) {
    const r = ring * 0.75;
    const steps = Math.max(8, ring * 6);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (isClear(solids, px, pz, 0, 0, clearance)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

/** NPCs, the spawn, gates and points of interest: everything the plan names by block or door. */
function resolveAnchors(plan: ZonePlan, out: CityLayout): void {
  const spawnBlock = blockAt(out, plan.spawn.block[0], plan.spawn.block[1]);
  if (spawnBlock) {
    const at = nearestFree(out.solids, rectCx(spawnBlock.rect) + plan.spawn.dx, rectCz(spawnBlock.rect) + plan.spawn.dz, 1.6);
    out.anchors.push({ id: 'spawn', kind: 'spawn', x: at.x, z: at.z, label: 'ARRIVAL', area: spawnBlock.def.name });
  }

  for (const npc of plan.npcs) {
    let x: number;
    let z: number;
    if ('door' in npc.at) {
      const door = out.anchors.find((a) => a.id === (npc.at as { door: string }).door);
      if (!door) continue;
      x = door.x + (npc.at.dx ?? 0);
      z = door.z + (npc.at.dz ?? 0);
    } else {
      const b = blockAt(out, npc.at.block[0], npc.at.block[1]);
      if (!b) continue;
      x = rectCx(b.rect) + npc.at.dx;
      z = rectCz(b.rect) + npc.at.dz;
    }
    const at = nearestFree(out.solids, x, z, 1.3);
    out.anchors.push({
      id: npc.id,
      kind: npc.role === 'board' ? 'board' : 'npc',
      x: at.x,
      z: at.z,
      label: npc.name,
      sub: npc.tribe,
      face: npc.face ?? 2,
      area: areaOf(out, at.x, at.z),
      radius: 3,
    });
  }

  for (const poi of plan.pois) {
    const b = blockAt(out, poi.at.block[0], poi.at.block[1]);
    if (!b) continue;
    const at = nearestFree(out.solids, rectCx(b.rect) + poi.at.dx, rectCz(b.rect) + poi.at.dz, 1.1);
    out.anchors.push({ id: poi.id, kind: 'poi', x: at.x, z: at.z, label: poi.name, sub: poi.kind, area: areaOf(out, at.x, at.z), radius: poi.radius ?? 5 });
  }

  // Gates sit in the ring road at the end of the street they open onto, so the way out
  // of a district is something you walk to rather than a button.
  // `hStreets` is ring, gap 0, gap 1 … ring, so gap `n` is entry `n + 1`; likewise for columns.
  const hRows = out.streets.filter((s) => s.axis === 'x');
  const vCols = out.streets.filter((s) => s.axis === 'z');
  for (const g of plan.gates) {
    const row = g.row ?? plan.mainRow;
    const rowStreet = hRows[row + 1];
    const zc = rowStreet ? rectCz(rowStreet.rect) : 0;
    const colStreet = vCols[plan.mainCol + 1];
    const xc = colStreet ? rectCx(colStreet.rect) : 0;
    const inset = plan.ring * 0.5;
    const pos: Record<typeof g.side, [number, number]> = {
      W: [out.extent.x0 + inset, zc],
      E: [out.extent.x1 - inset, zc],
      N: [xc, out.extent.z0 + inset],
      S: [xc, out.extent.z1 - inset],
    };
    const [gx, gz] = pos[g.side];
    out.anchors.push({ id: `gate-${g.side}`, kind: 'gate', x: gx, z: gz, label: g.label, sub: g.to, area: 'Streets', radius: 3.4 });
  }
}

/**
 * Where you appear when you come into a district: just inside the gate that leads back
 * to where you came from, so crossing a gate feels like walking through one. Both the
 * server and the client call this, which is how they agree on your position without
 * sending it.
 */
export function arrivalFor(layout: CityLayout, from: SectorId | null | undefined): { x: number; z: number } {
  const gate = from ? layout.anchors.find((a) => a.kind === 'gate' && a.sub === from) : undefined;
  if (gate) return { x: gate.x + (gate.x < 0 ? 7 : -7), z: gate.z };
  const sp = layout.anchors.find((a) => a.kind === 'spawn');
  return sp ? { x: sp.x, z: sp.z } : { x: 0, z: 0 };
}

/** The area a point is in, by name, or null on the open street. */
export function areaAt(layout: CityLayout, x: number, z: number): Area | null {
  for (const a of layout.areas) {
    if (a.blocks.some(([c, r]) => {
      const b = layout.blocks.find((q) => q.c === c && q.r === r);
      return b ? inRect(b.rect, x, z) : false;
    })) return a;
  }
  return null;
}

/** Whether the footprint of `a` overlaps `b`, for tests that want to prove lots never collide. */
export const rectsOverlap = overlaps;
