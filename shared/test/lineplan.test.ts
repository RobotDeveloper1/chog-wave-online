import { describe, expect, it } from 'vitest';
import {
  REGION_IDS,
  campOf,
  lineLayout,
  mobSpawns,
  roadHalfAt,
  roadXAt,
  type RegionId,
} from '../src/line/index.ts';

/**
 * Six regions, six plans.
 *
 * The Line's regions used to be one plan in six paints: the same road, the same
 * seven sites at the same spacing, the same camp pitched the same way, the same
 * mob fan. The palettes differed but the ground did not, so the second region
 * walked exactly like the first.
 *
 * Each region now carries its own plan (`REGION_PLAN` in `layout.ts`): how the
 * road meanders and how wide it runs, how far the sites spread and how long the
 * final approach to the warden is, which side of the road the campfire burns on,
 * and how wide the mobs fan out. Same anatomy everywhere — seven sites in walk
 * order, on the road, reachable — but no two regions walk the same.
 */

const spanOf = (id: RegionId): number => {
  const zs = lineLayout(id).encounters.map((e) => e.z);
  return Math.max(...zs) - Math.min(...zs);
};

describe('line plans — the road', () => {
  it('runs each region its own width, never narrower than the farm track', () => {
    const widths = REGION_IDS.map((id) => roadHalfAt(0, id));
    expect(new Set(widths).size, JSON.stringify(widths)).toBeGreaterThanOrEqual(4);
    for (const id of REGION_IDS) {
      expect(roadHalfAt(0, id), `${id} narrower than base`).toBeGreaterThanOrEqual(roadHalfAt(0));
    }
    expect(roadHalfAt(0, 'causeway'), 'the drowned highway is the widest road').toBeGreaterThan(
      roadHalfAt(0, 'tolls'),
    );
  });
});

describe('line plans — the sites', () => {
  it('spreads each region its own length', () => {
    const spans = REGION_IDS.map(spanOf);
    expect(new Set(spans).size, JSON.stringify(spans)).toBeGreaterThanOrEqual(4);
  });

  it('walks the warden a different final approach per region', () => {
    const leads = REGION_IDS.map((id) => {
      const sites = lineLayout(id).encounters;
      const post = sites[sites.length - 2]!;
      const warden = sites[sites.length - 1]!;
      return Math.hypot(warden.x - post.x, warden.z - post.z);
    });
    expect(new Set(leads.map((l) => Math.round(l))).size, JSON.stringify(leads)).toBeGreaterThanOrEqual(3);
  });

  it('keeps every site out of the trailhead squeeze', () => {
    // A site too close to the spawn forces a safety shift that eats the whole leg to its
    // neighbour: leg − shift − fan must stay above the 10-unit corridor, which needs
    // sd > 40 + 2·fan − leg — 23 on the tightest region (relay).
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      for (const s of l.encounters) {
        expect(Math.hypot(s.x - l.spawn.x, s.z - l.spawn.z), s.id).toBeGreaterThan(23);
      }
    }
  });

  it('keeps every leg walkable — a plan never schedules two fights at once', () => {
    for (const id of REGION_IDS) {
      const sites = lineLayout(id).encounters;
      for (let i = 1; i < sites.length; i++) {
        const d = Math.hypot(sites[i]!.x - sites[i - 1]!.x, sites[i]!.z - sites[i - 1]!.z);
        expect(d, `${id} ${sites[i - 1]!.id}->${sites[i]!.id}`).toBeGreaterThan(30);
      }
    }
  });
});

describe('line plans — the camp', () => {
  it('pitches each camp its own way', () => {
    const pitches = REGION_IDS.map((id) => {
      const c = campOf(id);
      const side = c.fire.x >= roadXAt(id, c.fire.z) ? 'E' : 'W';
      return [...c.tents.map((t) => t.z.toFixed(1)), side].join(',');
    });
    expect(new Set(pitches).size, JSON.stringify(pitches)).toBeGreaterThanOrEqual(4);
  });

  it('keeps every tent off its own road and clear of every site', () => {
    for (const id of REGION_IDS) {
      const camp = campOf(id);
      const sites = lineLayout(id).encounters;
      for (const t of camp.tents) {
        expect(
          Math.abs(t.x - roadXAt(id, t.z)),
          `tent on the road in ${id}`,
        ).toBeGreaterThanOrEqual(roadHalfAt(t.z, id));
        for (const s of sites) {
          expect(Math.hypot(t.x - s.x, t.z - s.z), `tent on ${s.id}`).toBeGreaterThanOrEqual(15);
        }
      }
    }
  });
});

describe('line plans — the mobs', () => {
  it('fans each region its own spread', () => {
    const fans = REGION_IDS.map((id) => {
      const [a, b] = mobSpawns(id).filter((m) => m.encounterId === `${id}.1`);
      return Math.hypot(a!.home.x - b!.home.x, a!.home.z - b!.home.z);
    });
    expect(new Set(fans.map((f) => Math.round(f))).size, JSON.stringify(fans)).toBeGreaterThanOrEqual(3);
    for (const f of fans) expect(f).toBeGreaterThan(14);
  });

  it('walks each region its own patrol tempo, wardens never', () => {
    const roams = REGION_IDS.map(
      (id) => mobSpawns(id).find((m) => m.kind === 'drift')!.roam,
    );
    expect(new Set(roams).size, JSON.stringify(roams)).toBeGreaterThanOrEqual(3);
    for (const id of REGION_IDS) {
      for (const m of mobSpawns(id)) {
        expect(m.roam, m.id).toBe(m.kind === 'warden' ? 0 : m.roam > 0 ? m.roam : NaN);
      }
    }
  });
});
