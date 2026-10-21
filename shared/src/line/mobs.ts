import { ENCOUNTERS, ENCOUNTER_BY_ID, REGION_BY_ID } from './index.ts';
import { TRAILHEAD_SAFE_R, lineLayout, seedOf, walkable } from './layout.ts';
import type { RegionId } from './index.ts';

/**
 * The Line's inhabitants: every encounter, embodied.
 *
 * The first version of this design put a glowing pillar on each site and asked the player to
 * press E. That is a menu with extra steps, not an encounter — you do not "interact" with a
 * rust mite, you walk into it and it starts. So each encounter is 1-3 mobs standing on the
 * road, and walking within reach of one starts the fight by itself. No prompt, no key, no menu.
 * Drifts near the trailhead travel in pairs; past the halfway mark they run in packs of three.
 *
 * A mob is `{encounterId}.{n}`. Several mobs share one encounter, and only the first one killed
 * banks the clear: the rest are the same fight again for a smaller purse, which is what makes a
 * cleared region still worth walking. Wardens are one mob and they do not come back — a gate that
 * respawns is not a gate.
 *
 * Positions are deterministic from the region, like everything else in `layout.ts`. The server
 * owns liveness (alive, fighting, dead, respawning) and the client only ever draws what
 * `line.state` reports, so a forged "the mob is here" buys nothing: the fight opens off the
 * server's own distance check.
 */

export interface MobSpawn {
  /** `tolls.1.0` — the encounter, and which body of it. */
  id: string;
  encounterId: string;
  region: RegionId;
  kind: 'drift' | 'post' | 'warden';
  name: string;
  element: string;
  /** The fight this body opens, from `archetypeForEncounter`: wardens wear the region
   * boss, posts wear the regional post mob, drifts run the regional pattern. The figure is
   * the region's own fauna, on the road and in the duel it opens — the signal avatar is
   * what anomalies, dungeons and the Training Sim wear instead. */
  archetype: string;
  /** Region tier (1..6), so the map figure matches the duel it opens. */
  tier: number;
  /** Where it stands when nobody has bothered it. */
  home: { x: number; z: number };
  /** How far from home it wanders, in units. Wardens do not wander. */
  roam: number;
  /** Walk into this and the fight starts. */
  reach: number;
  /** Seconds before it stands back up after being beaten. Wardens never do. */
  respawnS: number;
  /** WAV a repeat kill pays, when the cards are already banked. */
  repeatWav: number;
  /** Chase speed in units a second: mites shamble, imps nearly keep up. */
  chaseSpeed: number;
}

/**
 * How many bodies a post or a warden fields. Drifts are not here: their count comes from
 * `bodiesForEncounter`, because pairs near the trailhead and packs of three past it.
 */
const BODIES: Record<string, number> = { post: 1, warden: 1 };

/**
 * How many bodies an encounter fields. Posts stand alone and wardens are one thing; drifts
 * travel in pairs near the trailhead and in packs of three past the halfway mark, because
 * distance is the Line's risk dial and a far drift should read as one before it is walked
 * into. An unknown encounter fields one body rather than none, so a bad id is a lonely mob,
 * not a hole in the road.
 */
export function bodiesForEncounter(encounterId: string): number {
  const def = ENCOUNTER_BY_ID.get(encounterId);
  if (!def) return 1;
  if (def.kind !== 'drift') return BODIES[def.kind] ?? 1;
  const drifts = distOrder(def.region).filter((id) => ENCOUNTER_BY_ID.get(id)?.kind === 'drift');
  return drifts.indexOf(encounterId) >= Math.ceil(drifts.length / 2) ? 3 : 2;
}

const REPEAT_WAV: Record<string, number> = { drift: 6, post: 14, warden: 0 };

/**
 * How wide an encounter fans its bodies around its site. The highway's packs hold the road;
 * the farm track's hug it. Stays above 7 everywhere, because drift bodies ~14 units apart
 * is the corridor that keeps them separate meetings instead of one fight.
 */
const FAN_R: Record<RegionId, number> = {
  tolls: 8, ashpine: 9, marsh: 8.5, relay: 9.5, causeway: 10, static: 9,
};

/**
 * How far a body patrols from home. The relay's mobs are skittish, the static's sluggish —
 * and Tolls keeps 9 and 5, because the patrol-tempo test walks a Tolls drift.
 */
const ROAM: Record<RegionId, { drift: number; post: number }> = {
  tolls: { drift: 9, post: 5 },
  ashpine: { drift: 10, post: 6 },
  marsh: { drift: 7, post: 4 },
  relay: { drift: 11, post: 6 },
  causeway: { drift: 8, post: 5 },
  static: { drift: 6, post: 4 },
};

export function mobSpawns(region: RegionId): MobSpawn[] {
  const l = lineLayout(region);
  const out: MobSpawn[] = [];
  for (const site of l.encounters) {
    const def = ENCOUNTER_BY_ID.get(site.id)!;
    const n = bodiesForEncounter(site.id);
    const archetype = archetypeForEncounter(site.id);
    for (let i = 0; i < n; i++) {
      // Bodies fan around the site. Flat ground means anything inside the bounds is standing,
      // so the only question is the spread: two bodies at the same point are one fight, which
      // was the first version's bug — the sideways nudge collapsed them because `walkable` had
      // stopped being about terrain and become a bounds check.
      // The fan opens the region's own width, turned by the region's own seed — Tolls, the
      // marsh and the relay used to share one orientation, because all three names are five
      // letters long.
      const ang = (i / Math.max(1, n)) * Math.PI * 2 + seedOf(region);
      // The trailhead is safe ground: when the site sits too close to the spawn, the whole fan
      // shifts out as one body, so a drift's bodies keep their spread instead of
      // collapsing onto the same point of the safe circle. With roam the closest a shifted body
      // patrols is still ~20 units off.
      const sdx = site.x - l.spawn.x;
      const sdz = site.z - l.spawn.z;
      const sd = Math.hypot(sdx, sdz);
      // The fan opens FAN_R wide, so the centre shifts until the nearest body — not the
      // centre — clears the trailhead. This was calibrated for 8 when every fan was 8; wider
      // fans ate the buffer and a Static drift woke up inside the safe radius.
      const need = TRAILHEAD_SAFE_R + FAN_R[region] - sd;
      const ux = sd > 0.001 ? sdx / sd : 1;
      const uz = sd > 0.001 ? sdz / sd : 0;
      const shx = need > 0 ? ux * need : 0;
      const shz = need > 0 ? uz * need : 0;
      const hx = site.x + Math.cos(ang) * FAN_R[region] + shx;
      const hz = site.z + Math.sin(ang) * FAN_R[region] + shz;
      out.push({
        id: `${site.id}.${i}`,
        encounterId: site.id,
        region,
        kind: def.kind,
        name: def.name,
        element: def.element,
        archetype,
        tier: def.tier,
        home: { x: hx, z: hz },
        roam: def.kind === 'warden' ? 0 : def.kind === 'post' ? ROAM[region].post : ROAM[region].drift,
        reach: 6,
        respawnS: def.kind === 'warden' ? 0 : def.kind === 'post' ? 150 : 90,
        repeatWav: REPEAT_WAV[def.kind] ?? 0,
        chaseSpeed: def.kind === 'warden' ? 5.2 : chaseSpeedFor(archetype),
      });
    }
  }
  return out;
}

/**
/**
 * Who each region fields, nearest drift first.
 *
 * Six regions, six ladders — no two alike. Tolls opens on mites because the farm track
 * is where the game starts and the tutorial fight is a mite; every ladder climbs from
 * there to something faster, tougher, or stranger at the far end. Posts keep one
 * regional mob each: they are roadblocks, not the climb.
 */
const LADDER: Record<RegionId, { drifts: [string, string, string, string]; post: string }> = {
  tolls: { drifts: ['mite', 'mite', 'walker', 'imp'], post: 'walker' },
  ashpine: { drifts: ['spark', 'glitch', 'glitch', 'imp'], post: 'glitch' },
  marsh: { drifts: ['wisp', 'spark', 'husk', 'husk'], post: 'wisp' },
  relay: { drifts: ['spark', 'glitch', 'glitch', 'surge'], post: 'glitch' },
  causeway: { drifts: ['spark', 'front', 'front', 'husk'], post: 'husk' },
  static: { drifts: ['spark', 'husk', 'imp', 'husk'], post: 'husk' },
};

/**
 * How fast each species runs a chase down, in units a second. The player walks faster
 * than all of these, so every pursuit is escapable — but the imp nearly keeps up, which
 * is exactly why it lives at the far end of the road.
 */
const CHASE_SPEED: Record<string, number> = {
  mite: 3.2, walker: 4.2, spark: 5.2, glitch: 5.6, wisp: 4.2, husk: 2.8,
  imp: 6.4, surge: 4.6, front: 4.4, mirror: 5,
};

/** Chase speed for an archetype, on the map and in the duel it opens. */
export function chaseSpeedFor(archetype: string): number {
  return CHASE_SPEED[archetype] ?? 4.2;
}

/**
 * Encounters nearest-first from the trailhead; wardens always last, whatever ground
 * they stand on, because they are the gate. The road's difficulty, species and drops
 * all key off this order: near is weak, far is strong, and wandering further is the
 * only risk dial the Line has.
 */
export function distOrder(region: RegionId): string[] {
  const l = lineLayout(region);
  const dist = (id: string): number => {
    const s = l.encounters.find((e) => e.id === id);
    return s ? Math.hypot(s.x - l.spawn.x, s.z - l.spawn.z) : Infinity;
  };
  return ENCOUNTERS.filter((e) => e.region === region)
    .sort((a, b) => (a.kind === 'warden' ? 1 : 0) - (b.kind === 'warden' ? 1 : 0) || dist(a.id) - dist(b.id))
    .map((e) => e.id);
}

/** Which archetype an encounter fields, in the duel it opens. */
export function archetypeForEncounter(encounterId: string): string {
  const def = ENCOUNTER_BY_ID.get(encounterId);
  if (!def) return 'spark';
  if (def.kind === 'warden') return REGION_BY_ID.get(def.region)?.boss.archetype ?? 'baron';
  const ladder = LADDER[def.region];
  if (def.kind === 'post') return ladder.post;
  const drifts = distOrder(def.region).filter((id) => ENCOUNTER_BY_ID.get(id)?.kind === 'drift');
  const i = drifts.indexOf(encounterId);
  return ladder.drifts[Math.max(0, i)] ?? 'spark';
}

/** Every mob on the Line, for the spawn audit. Throws on a duplicate id. */
export function allMobSpawns(): MobSpawn[] {
  const seen = new Set<string>();
  const out: MobSpawn[] = [];
  for (const r of ['tolls', 'ashpine', 'marsh', 'relay', 'causeway', 'static'] as RegionId[]) {
    for (const m of mobSpawns(r)) {
      if (seen.has(m.id)) throw new Error(`duplicate mob ${m.id}`);
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** Where a mob is right now: home plus a wander, as a pure function of time. */
export function mobAt(m: MobSpawn, nowMs: number, seed = 0): { x: number; z: number } {
  if (m.roam <= 0) return { ...m.home };
  const t = nowMs / 1000;
  // A Lissajous in a square of side `2*roam` reaches `roam*sqrt(2)` at the corners, which is not
  // what "roams 9 units" says. Dividing by sqrt(2) keeps the whole figure inside the disc, so
  // the number on the spawn is the number the mob obeys.
  //
  // Fast enough to read as walking (~2 u/s at the peaks for a drift): the first version ran at
  // 0.11/0.09 rad/s, which tops out near 0.7 u/s — slower than a player idles — so patrols read
  // as statues even where the client drew them live. Same function on both sides, so the server's
  // ambush check and the client's figures still agree; only the tempo changed.
  const k = m.roam / Math.SQRT2;
  const ax = Math.sin(t * 0.28 + m.home.x * 0.7 + seed) * k;
  const az = Math.cos(t * 0.23 + m.home.z * 0.9 + seed * 1.7) * k;
  const px = m.home.x + ax;
  const pz = m.home.z + az;
  // Stay on dry ground. The first fallback is halfway home; in a wet region even that can be
  // water, so the last fallback is home itself, which is walkable by construction. A mob that
  // stands still for a beat in the marsh is better than one swimming.
  if (walkable(m.region, px, pz)) return { x: px, z: pz };
  const hx = (px + m.home.x) / 2;
  const hz = (pz + m.home.z) / 2;
  if (walkable(m.region, hx, hz)) return { x: hx, z: hz };
  return { ...m.home };
}

/**
 * Which way a mob is walking, as a yaw the client can set directly.
 *
 * Pure function of the clock like `mobAt`: the server reports it and the client places it,
 * so figures turn into their walk instead of sliding sideways. Still when standing.
 */
export function mobFacing(m: MobSpawn, nowMs: number, seed = 0): number {
  if (m.roam <= 0) return 0;
  const a = mobAt(m, nowMs, seed);
  const b = mobAt(m, nowMs - 400, seed);
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  if (dx * dx + dz * dz < 1e-6) return 0;
  return Math.atan2(dx, dz);
}

/**
 * The aggro radius: inside it a mob notices you and starts the run over. Both sides
 * run the same step below — the server with the moving player (or the nearest one in
 * the region for the snapshot), the client with its own boots — so the walk you see
 * is the walk you bump into.
 */
export const AGGRO_R = 14;
/** How far past the rim the foe has to get before the mob gives up and walks home. */
export const GIVE_UP_R = 4;
/** Close enough to touch: the run ends here and the duel opens on contact. */
export const CHASE_CONTACT = 2.5;

/**
 * Where a chase started, and when. The run itself is a pure function of the anchor,
 * the clock and the live foe position, so both sides agree from the same anchor — but
 * the anchor is state, kept per mob: a pursuit has to remember where it began. A back
 * anchor is the walk home after a give-up: same shape, the patrol as target.
 */
export interface ChaseAnchor {
  fx: number;
  fz: number;
  since: number;
  back?: boolean;
}

/** Run from an anchor toward a target at the mob's own speed, hugging dry ground. */
function runToward(
  m: MobSpawn,
  anchor: ChaseAnchor,
  toX: number,
  toZ: number,
  contactR: number,
  nowMs: number,
): { x: number; z: number } {
  const dx = toX - anchor.fx;
  const dz = toZ - anchor.fz;
  const d = Math.hypot(dx, dz);
  if (d <= contactR) return { x: toX, z: toZ };
  const speed = m.chaseSpeed > 0 ? m.chaseSpeed : 4.2;
  const travelled = speed * Math.max(0, (nowMs - anchor.since) / 1000);
  const step = Math.min(travelled, d - contactR);
  const ux = dx / d;
  const uz = dz / d;
  // Step back along the run until dry: a chase that would cross water strains at
  // the shore instead of snapping home.
  for (const k of [1, 0.75, 0.5, 0.25]) {
    const x = anchor.fx + ux * step * k;
    const z = anchor.fz + uz * step * k;
    if (walkable(m.region, x, z)) return { x, z };
  }
  return { x: anchor.fx, z: anchor.fz };
}

/**
 * One step of the pursuit: where the body is and which way it faces, and the anchor
 * to keep for the next step. The server persists the anchor per mob; the client keeps
 * its own copy per figure — same function, same rules, same walk.
 *
 * Out, the mob runs the foe down at its species speed and stops at contact. Past the
 * rim it gives up and walks home to the live patrol point, turning straight back
 * around if a foe steps in mid-return. Nothing teleports: every transition starts
 * from the position the last step ended on.
 */
export function chaseStep(
  prev: ChaseAnchor | null,
  m: MobSpawn,
  nowMs: number,
  foe: { x: number; z: number } | null,
  seed = 0,
): { anchor: ChaseAnchor | null; x: number; z: number; facing: number } {
  const patrol = mobAt(m, nowMs, seed);
  const d = foe ? Math.hypot(foe.x - patrol.x, foe.z - patrol.z) : Infinity;
  let anchor = prev ?? null;
  if (!anchor) {
    if (foe && d < AGGRO_R) anchor = { fx: patrol.x, fz: patrol.z, since: nowMs };
  } else if (!anchor.back) {
    if (!foe || d > AGGRO_R + GIVE_UP_R) {
      const cur = runToward(m, anchor, foe?.x ?? anchor.fx, foe?.z ?? anchor.fz, CHASE_CONTACT, nowMs);
      anchor = { fx: cur.x, fz: cur.z, since: nowMs, back: true };
    }
  } else if (foe && d < AGGRO_R) {
    const cur = runToward(m, anchor, patrol.x, patrol.z, 0, nowMs);
    anchor = { fx: cur.x, fz: cur.z, since: nowMs };
  } else {
    const cur = runToward(m, anchor, patrol.x, patrol.z, 0, nowMs);
    const stuck = Math.hypot(cur.x - anchor.fx, cur.z - anchor.fz) < 1e-6 && nowMs - anchor.since > 1200;
    if (stuck || Math.hypot(cur.x - patrol.x, cur.z - patrol.z) < 0.05) anchor = null;
  }
  if (!anchor) return { anchor, x: patrol.x, z: patrol.z, facing: mobFacing(m, nowMs, seed) };
  const target = anchor.back ? patrol : foe!;
  const contactR = anchor.back ? 0 : CHASE_CONTACT;
  const at = runToward(m, anchor, target.x, target.z, contactR, nowMs);
  // Face the run itself: the velocity between two samples of the same chase. Facing
  // the foe directly whipped every time the player strafed; facing where the body is
  // actually going turns with it instead.
  const patrolB = anchor.back ? mobAt(m, nowMs - 400, seed) : patrol;
  const targetB = anchor.back ? patrolB : target;
  const b = runToward(m, anchor, targetB.x, targetB.z, contactR, nowMs - 400);
  const vx = at.x - b.x;
  const vz = at.z - b.z;
  let facing: number;
  if (vx * vx + vz * vz > 1e-6) facing = Math.atan2(vx, vz);
  else if (!anchor.back && foe) {
    const fx = foe.x - at.x;
    const fz = foe.z - at.z;
    facing = fx * fx + fz * fz > 1e-4 ? Math.atan2(fx, fz) : mobFacing(m, nowMs, seed);
  } else facing = mobFacing(m, nowMs, seed);
  return { anchor, x: at.x, z: at.z, facing };
}
