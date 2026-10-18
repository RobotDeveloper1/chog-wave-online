import { ENCOUNTERS, ENCOUNTER_BY_ID, REGION_BY_ID } from './index.ts';
import { TRAILHEAD_SAFE_R, lineLayout, seedOf, walkable } from './layout.ts';
import type { RegionId } from './index.ts';

/**
 * The Line's inhabitants: every encounter, embodied.
 *
 * The first version of this design put a glowing pillar on each site and asked the player to
 * press E. That is a menu with extra steps, not an encounter — you do not "interact" with a
 * rust mite, you walk into it and it starts. So each encounter is now 1-2 mobs standing on the
 * road, and walking within reach of one starts the fight by itself. No prompt, no key, no menu.
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
}

/** How many bodies an encounter fields. Drifts travel in pairs; a post stands alone twice; a warden is one thing. */
const BODIES: Record<string, number> = { drift: 2, post: 1, warden: 1 };

const REPEAT_WAV: Record<string, number> = { drift: 6, post: 14, warden: 0 };

/**
 * How wide an encounter fans its bodies around its site. The highway's packs hold the road;
 * the farm track's hug it. Stays above 7 everywhere, because a drift's two bodies 14 units
 * apart is the corridor that keeps them two meetings instead of one fight.
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
    const n = BODIES[def.kind] ?? 1;
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
      // shifts out as one body, so the two bodies of a drift keep their spread instead of
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
      });
    }
  }
  return out;
}

/**
 * Who each region fields: the four drifts in walk order, and the one thing every post is.
 *
 * Six regions, six rosters — no two alike. Tolls keeps the original alternation, because it
 * is the reference every later region is read against; everywhere else the lead mob, the
 * pattern, or both change. The wisp walls a file for the whole fight and the husk wears
 * guard, so a region that *leads* with one opens on a very different first impression than
 * a region that alternates it in second — which is why the marsh and the causeway lead with
 * theirs, and why the relay leads with the loose signal its own masts keep leaking.
 */
const ROSTER: Record<RegionId, { drifts: [string, string, string, string]; post: string }> = {
  tolls: { drifts: ['mite', 'walker', 'mite', 'walker'], post: 'walker' },
  ashpine: { drifts: ['spark', 'glitch', 'spark', 'glitch'], post: 'glitch' },
  marsh: { drifts: ['wisp', 'spark', 'wisp', 'spark'], post: 'wisp' },
  relay: { drifts: ['glitch', 'spark', 'glitch', 'spark'], post: 'glitch' },
  causeway: { drifts: ['husk', 'spark', 'husk', 'spark'], post: 'husk' },
  static: { drifts: ['spark', 'husk', 'spark', 'husk'], post: 'husk' },
};

/** Which archetype an encounter fields, in the duel it opens. */
export function archetypeForEncounter(encounterId: string): string {
  const def = ENCOUNTER_BY_ID.get(encounterId);
  if (!def) return 'spark';
  if (def.kind === 'warden') return REGION_BY_ID.get(def.region)?.boss.archetype ?? 'baron';
  const roster = ROSTER[def.region];
  if (def.kind === 'post') return roster.post;
  const drifts = ENCOUNTERS.filter((e) => e.region === def.region && e.kind === 'drift');
  const i = drifts.findIndex((e) => e.id === encounterId);
  return roster.drifts[i] ?? 'spark';
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
