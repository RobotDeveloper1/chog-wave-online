import { describe, expect, it } from 'vitest';
import {
  ANOMALY_CARDS,
  DUNGEON_CARDS,
  DUNGEONS_AT_CARDS,
  DUNGEONS_AT_REGIONS,
  ENCOUNTERS,
  ENCOUNTER_BY_ID,
  LINE_BASE_SLOTS,
  LINE_MAX_SLOTS,
  REGIONS,
  REGION_BY_ID,
  anomaliesGate,
  REWARD_CATALOGUE_SIZE,
  cardSources,
  cardsHeld,
  dungeonsGate,
  encounterGate,
  regionGate,
  regionState,
  regionsCleared,
  distOrder,
  slotsFor,
  unlockedBy,
  wardenOf,
  type LineProgress,
  type RegionId,
} from '../src/line/index.ts';
import { BASIC_CARDS, CARDS_ALL, GA_CARDS, anyCard, isBasicId } from '../src/cards.ts';

const all = ENCOUNTERS.map((e) => e.id);
const done = (...ids: string[]): LineProgress => ({ cleared: ids });

const through = (n: number): LineProgress =>
  done(
    ...REGIONS.slice(0, n).flatMap((r) => r.encounters.map((e) => e.id)),
  );

describe('line — shape', () => {
  it('has six regions numbered one to six, in order', () => {
    expect(REGIONS.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gives every region four drifts, two posts and one warden', () => {
    for (const r of REGIONS) {
      expect(r.encounters.map((e) => e.kind), r.id).toEqual([
        'drift', 'drift', 'drift', 'drift',
        'post', 'post',
        'warden',
      ]);
    }
  });

  it('names every encounter id after its region and numbers it', () => {
    for (const r of REGIONS) {
      r.encounters.forEach((e, i) => expect(e.id, e.name).toBe(`${r.id}.${i + 1}`));
    }
    expect(ENCOUNTER_BY_ID.size).toBe(ENCOUNTERS.length);
  });

  it('makes drifts free to walk into and posts real duels', () => {
    for (const e of ENCOUNTERS) expect(e.duel, e.id).toBe(e.kind !== 'drift');
  });

  it('prices a region\'s fights at its own tier', () => {
    for (const r of REGIONS) for (const e of r.encounters) expect(e.tier, e.id).toBe(r.n);
  });
});

describe('line — cards', () => {
  it('only unlocks cards the catalogue actually holds', () => {
    for (const e of ENCOUNTERS) {
      for (const id of e.unlocks) {
        expect(anyCard(id), `${e.id} unlocks ${id}`).toBeTruthy();
      }
    }
    for (const id of [...ANOMALY_CARDS, ...DUNGEON_CARDS]) {
      expect(anyCard(id), `orphan card ${id}`).toBeTruthy();
    }
  });

  it('never unlocks the same card twice', () => {
    expect(cardSources().missing).toEqual([]);
  });

  it('accounts for the whole reward catalogue between the Line, anomalies and dungeons', () => {
    const { line, anomaly, dungeon } = cardSources();
    // The universe is both tables, less the six basic attacks: `CARDS_ALL` holds everything
    // buyable and `GA_CARDS` the nine fusion cards, and the basics are in `CARDS_ALL` but are
    // not won by anything — they exist so a hand is never short.
    expect(line.length + anomaly.length + dungeon.length).toBe(CARDS_ALL.length + GA_CARDS.length - BASIC_CARDS.length);
    expect(REWARD_CATALOGUE_SIZE).toBe(line.length + anomaly.length + dungeon.length);
  });

  it('keeps the basic attacks out of the reward economy entirely', () => {
    const { line, anomaly, dungeon } = cardSources();
    for (const c of BASIC_CARDS) {
      expect(line, c.id).not.toContain(c.id);
      expect(anomaly, c.id).not.toContain(c.id);
      expect(dungeon, c.id).not.toContain(c.id);
    }
    // And nothing anywhere on the Line names one.
    for (const e of ENCOUNTERS) expect(e.unlocks.filter((id) => isBasicId(id)), e.id).toEqual([]);
  });

  it('hands out 51 cards across the Line and leaves 19 for phase two', () => {
    const { line, anomaly, dungeon } = cardSources();
    expect(line).toHaveLength(51);
    expect(anomaly).toHaveLength(8);
    expect(dungeon).toHaveLength(11);
  });

  it('keeps the eight trait-mirroring cards for anomalies, and nothing else', () => {
    for (const id of ANOMALY_CARDS) expect(id, 'anomaly card').toMatch(/^e_/);
  });

  it('gives every region at least six cards and every warden at least one', () => {
    for (const r of REGIONS) {
      const ids = r.encounters.flatMap((e) => e.unlocks);
      expect(ids.length, r.id).toBeGreaterThanOrEqual(6);
      expect(wardenOf(r.id).unlocks.length, `${r.id} warden`).toBeGreaterThan(0);
    }
  });

  it('deals stronger cards the farther down the road they sit', () => {
    // Near weak, far strong: along each region's distance order the best non-fusion
    // card per site never steps down, so the drops stay commensurate with the walk.
    // Wardens are excluded -- a warden pays a spike for the next region plus a
    // keepsake, and the keepsake is allowed to be small.
    const mightOf = (id: string): number => {
      const c = anyCard(id)!;
      return c.power * Math.max(1, c.hits);
    };
    for (const r of REGIONS) {
      let prev = 0;
      for (const id of distOrder(r.id)) {
        const e = ENCOUNTER_BY_ID.get(id)!;
        if (e.kind === 'warden') continue;
        const m = Math.max(...e.unlocks.filter((u) => !u.startsWith('ga_')).map(mightOf));
        expect(m, `${id} under ${prev}`).toBeGreaterThanOrEqual(prev);
        prev = Math.max(prev, m);
      }
    }
  });

  it('opens the road with vendor bait, not a winning lottery ticket', () => {
    // The first clear used to pay 90+ power and end the tutorial on the spot.
    // The nearest site now pays the two weakest cards on the whole Line.
    const first = ENCOUNTER_BY_ID.get(distOrder('tolls')[0]!)!;
    const mightOf = (id: string): number => {
      const c = anyCard(id)!;
      return c.power * Math.max(1, c.hits);
    };
    const floor = Math.min(...ENCOUNTERS.flatMap((e) => e.unlocks).map(mightOf));
    for (const id of first.unlocks) expect(mightOf(id), id).toBeLessThanOrEqual(floor + 10);
  });

  it('never hands out a card before the region that contains it is reachable', () => {
    // A card from region 5 cannot appear in a region 1-4 clear list, which is the property
    // that makes "walk the Line in order" and "collect the whole set" the same activity.
    for (const e of ENCOUNTERS) {
      if (e.region === 'static') continue;
      expect(e.unlocks.some((id) => REGIONS.some((r) => r.n > REGION_BY_ID.get(e.region!)!.n && r.encounters.some((x) => x.unlocks.includes(id)))), e.id).toBe(false);
    }
  });
});

describe('line — gating', () => {
  it('opens the first region to anyone', () => {
    expect(regionGate(done(), 'tolls')).toEqual({ open: true, reason: '' });
  });

  it('seals every other region until its predecessor\'s warden is down', () => {
    expect(regionGate(done(), 'ashpine').open).toBe(false);
    expect(regionGate(done(wardenOf('tolls').id), 'ashpine').open).toBe(true);
    expect(regionGate(done(wardenOf('tolls').id), 'marsh').open).toBe(false);
  });

  it('names the standing warden in the refusal, so the menu can say what to go kill', () => {
    expect(regionGate(done(), 'causeway').reason).toContain('RELAY FLATS');
  });

  it('refuses an encounter id it does not hold', () => {
    expect(encounterGate(done(), 'tolls.99').open).toBe(false);
    expect(encounterGate(done(), 'nope').reason).toBe('no such encounter');
  });

  it('leaves encounters independent inside an open region', () => {
    // No predecessor chain: a fresh road can fight anything, including the warden. The
    // region gate is the only seal — difficulty runs by distance, not by ticket.
    expect(encounterGate(done(), 'tolls.1').open).toBe(true);
    expect(encounterGate(done(), 'tolls.2').open).toBe(true);
    expect(encounterGate(done(), 'tolls.7').open).toBe(true);
    expect(encounterGate(through(1), 'ashpine.2').open).toBe(true);
    expect(encounterGate(through(1), 'ashpine.1').open).toBe(true);
    // …and a sealed region still seals everything in it.
    expect(encounterGate(done(), 'ashpine.1').open).toBe(false);
  });

  it('counts regions only as a contiguous run from the first', () => {
    expect(regionsCleared(done())).toBe(0);
    // Clearing the third warden first must not buy the third region.
    expect(regionsCleared(done(wardenOf('marsh').id))).toBe(0);
    expect(regionsCleared(through(1))).toBe(1);
    expect(regionsCleared(through(6))).toBe(6);
  });

  it('reports done / open / sealed for the map screen', () => {
    expect(regionState(through(1), 'tolls')).toBe('done');
    expect(regionState(through(1), 'ashpine')).toBe('open');
    expect(regionState(through(1), 'marsh')).toBe('sealed');
    expect(regionState(through(6), 'static')).toBe('done');
  });
});

describe('line — deck size', () => {
  it('starts a new Chog at the base, not at a full deck', () => {
    expect(slotsFor(done())).toBe(LINE_BASE_SLOTS);
    expect(LINE_BASE_SLOTS).toBeLessThan(3);
  });

  it('grows with every region crossed and every fourth encounter', () => {
    expect(slotsFor(through(1))).toBeGreaterThan(slotsFor(done()));
    expect(slotsFor(through(6))).toBe(LINE_MAX_SLOTS);
  });

  it('never exceeds the cap, however much of the Line is walked', () => {
    expect(slotsFor({ cleared: [...all, ...all] })).toBe(LINE_MAX_SLOTS);
  });

  it('rises monotonically — a cleared encounter never takes a slot away', () => {
    let prev = 0;
    for (const id of all) {
      const n = slotsFor(done(...all.slice(0, all.indexOf(id) + 1)));
      expect(n, id).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('gives a hand a real choice by the time the dungeons open', () => {
    expect(slotsFor(through(DUNGEONS_AT_REGIONS))).toBeGreaterThanOrEqual(6);
  });
});

describe('line — dungeons are phase two', () => {
  it('are shut with nothing cleared, and say why', () => {
    const g = dungeonsGate(done());
    expect(g.open).toBe(false);
    expect(g.reason).toContain('Line');
  });

  it('need both regions and cards, not one or the other', () => {
    // Two regions crossed but the cards not found: still shut, and the reason is the card
    // count, not the region count.
    const regionsOnly = done(wardenOf('tolls').id, wardenOf('ashpine').id);
    expect(regionsOnly.cleared).toHaveLength(2);
    expect(regionsCleared(regionsOnly)).toBe(2);
    const g = dungeonsGate(regionsOnly);
    expect(g.open).toBe(false);
    expect(g.reason).toContain('cards');
  });

  it('open once two regions are crossed and the cards are in hand', () => {
    expect(dungeonsGate(through(2))).toEqual({ open: true, reason: '' });
  });

  it('would be open with ten cards from anywhere, because the card LineGate is the real one', () => {
    expect(cardsHeld(through(2))).toBeGreaterThanOrEqual(DUNGEONS_AT_CARDS);
  });
});

describe('line — anomalies are endgame', () => {
  it('are shut for the first two regions so the ticker is not the tutorial', () => {
    expect(anomaliesGate(done()).open).toBe(false);
    expect(anomaliesGate(through(1)).open).toBe(false);
    expect(anomaliesGate(through(2)).open).toBe(false);
    expect(anomaliesGate(through(3))).toEqual({ open: true, reason: '' });
  });

  it('say how many wardens are in the way, in the player\'s words', () => {
    expect(anomaliesGate(done()).reason).toContain('3 more wardens');
    expect(anomaliesGate(through(2)).reason).toContain('1 more warden');
  });

  it('come open before the dungeons do not matter — the two gates are independent', () => {
    // Three wardens is past the anomaly LineGate; the dungeon LineGate wants two regions and ten
    // cards, which three regions also clears. So they open together, and that is the
    // intent: phase two and the market endgame start at the same place.
    expect(anomaliesGate(through(3)).open).toBe(dungeonsGate(through(3)).open);
  });
});

describe('line — the hand it hands out', () => {
  it('gives a fresh Chog its signature and nothing else to choose between', () => {
    expect(unlockedBy(done())).toEqual([]);
    expect(cardsHeld(done())).toBe(0);
  });

  it('unlocks in walk order, not table order', () => {
    expect(unlockedBy(done('tolls.1', 'tolls.5'))).toEqual(['staticnip', 'refract']);
  });

  it('counts a card once even if two encounters could both hand it over', () => {
    const doubled = done(...all, ...all);
    expect(cardsHeld(doubled)).toBe(cardsHeld(through(6)));
  });
});

describe('line — the road is one curve', () => {
  it('starts at the middle of the road, with a safe trailhead and a camp', async () => {
    const { campOf, lineLayout, roadHalfAt, roadXAt, TRAILHEAD_SAFE_R } = await import('../src/line/layout.ts');
    const { mobSpawns } = await import('../src/line/mobs.ts');
    for (const r of REGIONS) {
      const l = lineLayout(r.id);
      // The middle, not the edge: the road runs both ways from here.
      expect(l.spawn.z, `${r.id} spawn at the middle`).toBe(0);
      expect(Math.abs(l.spawn.x - roadXAt(r.id, 0)), `${r.id} spawn on the road`).toBeLessThan(roadHalfAt(0) + 0.01);
      // No body starts inside the safe radius, so arrival is never an ambush.
      for (const m of mobSpawns(r.id)) {
        expect(Math.hypot(m.home.x - l.spawn.x, m.home.z - l.spawn.z), `${m.id} starts clear of the trailhead`).toBeGreaterThanOrEqual(TRAILHEAD_SAFE_R - 1e-9);
      }
      // Tents off the road, fire and scout beside it.
      const camp = campOf(r.id);
      expect(camp.tents).toHaveLength(3);
      for (const t of camp.tents) {
        expect(Math.abs(t.x - roadXAt(r.id, t.z)), `tent on the road in ${r.id}`).toBeGreaterThanOrEqual(roadHalfAt(t.z));
      }
      expect(camp.npc.name.length).toBeGreaterThan(0);
    }
  });

  it('stands every site, spawn and exit on the road the client ribbons', async () => {
    const { lineLayout, roadHalfAt, roadXAt } = await import('../src/line/layout.ts');
    for (const r of REGIONS) {
      const l = lineLayout(r.id);
      for (const s of l.encounters) {
        expect(Math.abs(s.x - roadXAt(r.id, s.z)), `${s.id} off the road`).toBeLessThan(roadHalfAt(s.z) + 0.01);
      }
      expect(Math.abs(l.spawn.x - roadXAt(r.id, l.spawn.z)), `${r.id} spawn off the road`).toBeLessThan(roadHalfAt(l.spawn.z) + 0.01);
      if (l.exit) expect(Math.abs(l.exit.x - roadXAt(r.id, l.exit.z)), `${r.id} exit off the road`).toBeLessThan(roadHalfAt(l.exit.z) + 0.01);
      for (const o of l.solids) {
        expect(Math.abs(o.x - roadXAt(r.id, o.z)), `prop on the road in ${r.id}`).toBeGreaterThanOrEqual(roadHalfAt(o.z));
      }
    }
  });
});

describe('line — the whole catalogue is reachable', () => {
  it('gives every region a distinct name and a warden that exists', () => {
    const names = new Set<string>();
    for (const r of REGIONS) {
      expect(names.has(r.name), r.name).toBe(false);
      names.add(r.name);
      expect(ENCOUNTER_BY_ID.has(wardenOf(r.id).id)).toBe(true);
      expect(r.boss.name.length).toBeGreaterThan(0);
    }
  });

  it('walks six wardens and fifty-one cards from nothing to the whole Line', () => {
    let cards = 0;
    for (const r of REGIONS) cards += r.encounters.flatMap((e) => e.unlocks).length;
    expect(cards).toBe(51);
    expect(REGIONS.length).toBe(6);
  });

  it('types a region id strictly, so a typo in the map screen is a compile error', () => {
    const ids: RegionId[] = ['tolls', 'ashpine', 'marsh', 'relay', 'causeway', 'static'];
    expect(ids).toHaveLength(REGION_BY_ID.size);
  });
});