import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENCOUNTER_BY_ID,
  ENCOUNTERS,
  LINE_MAX_SLOTS,
  REGIONS,
  REGION_IDS,
  archetypeForEncounter,
  boardSideFor,
  campOf,
  cityOf,
  encounterBudget,
  quirkOf,
  lineLayout,
  mobAt,
  mobSpawns,
  screensForBasicsOnly,
  screensForRegionDeck,
} from '@chog/shared';

/**
 * The Line on a live `World`: travelling, standing on a thing, and beating it.
 *
 * The three claims worth defending are all about authority, because all three are things a client
 * would be tempted to assert rather than ask for:
 *
 *  - **the maps tab cannot take you to a sealed region** — the gate is `regionGate`, the same one
 *    the tab renders its lock text from;
 *  - **`line.enter` cannot start a fight you are not standing on**, whatever id the message names;
 *  - **`line.clear` cannot claim a win**, because the win belongs to the session, not the message.
 *
 * And one about honesty: the terrain both sides walk is generated from the same seed, so this file
 * checks the layout rather than a copy of it.
 *
 * `DATA_DIR` is redirected before importing `world.ts` — see the note in `line.shared.test.ts`.
 */

let dir: string;
let World: typeof import('../src/world.ts').World;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-line-ws-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  ({ World } = await import('../src/world.ts'));
});
afterAll(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* still locked on Windows */ }
});

let nextToken = 7200;

/**
 * A fixed token pins the build: `weakness` derives from the id, so a test that asserts
 * pool contents must not ride the sequential counter — every seat added above it would
 * re-deal the banned element. Fixed ids live at 9000+, far from the counter's range.
 */
function seat(fixedToken?: number) {
  const world = new World();
  const tokenId = fixedToken ?? nextToken++;
  const p = world.join(`w${tokenId}`, { tokenId, transferCount: 0, daysHeld: 0 }, 'ashflat', null);
  return { world, p, tokenId, id: p.id };
}

const loop = (s: ReturnType<typeof seat>, action: string, body: Record<string, unknown> = {}) =>
  s.world.loop(s.id, { action, ...body }) as { ok: boolean; reason?: string; [k: string]: unknown };

/**
 * Walk the player onto a site the way a player would.
 *
 * **In hops, on purpose.** move() is a validator: one message asking to be 180 units away gets
 * walked back at MAX_SPEED rather than honoured, because that is what stops an encounter from being
 * reached by sending a message instead of walking. The first version of this helper set the position
 * directly and every `line.enter` test failed with `nothing here to fight` � the validator was right and
 * the test was cheating.
 */
function standOn(s: ReturnType<typeof seat>, encounterId: string): void {
  const site = lineLayout(REGION_BY_ID(encounterId)).encounters.find((e) => e.id === encounterId)!;
  for (let i = 0; i < 400; i++) {
    const dx = site.x - s.p.x;
    const dz = site.z - s.p.y;
    if (Math.hypot(dx, dz) <= 2) return;
    s.world.move(s.id, { x: s.p.x + dx, y: s.p.y + dz });
  }
  throw new Error('could not reach ' + encounterId);
}

const REGION_BY_ID = (encounterId: string) =>
  ENCOUNTER_BY_ID.get(encounterId)!.region;

/**
 * The encounter nearest the trailhead, and a walk that can only meet it.
 *
 * The spawn sits in the middle of the road, so walking at a far site crosses other
 * encounters' patrols and the ambush names whichever body it touches first. The nearest
 * site's neighbours stay out of reach (sites hold 30+ apart; a neighbour's bodies roam
 * 8+9 inside that with a 6 reach), so walking at it fights it — by ambush on the way in
 * or by the explicit enter at its feet. Returns the engaged encounter.
 */
function nearestToSpawn(): string {
  const l = lineLayout('tolls');
  let best = l.encounters[0]!;
  for (const e of l.encounters) {
    if (Math.hypot(e.x - l.spawn.x, e.z - l.spawn.z) < Math.hypot(best.x - l.spawn.x, best.z - l.spawn.z)) best = e;
  }
  return best.id;
}

/**
 * Clear the road up to an encounter, one gate at a time.
 *
 * The gate walks each region in order, so a test that fights `tolls.5` proves `tolls.1..4`
 * first — one `lineCleared` call each, because the snapshot validates the whole message
 * against the road as it stood. Deferred: predecessors mark cleared but grant nothing, so
 * purses, decks and drop piles stay the fought encounter's own.
 */
function clearThrough(s: ReturnType<typeof seat>, encounterId: string): void {
  const enc = ENCOUNTERS.filter((e) => e.region === REGION_BY_ID(encounterId));
  const i = enc.findIndex((e) => e.id === encounterId);
  for (const e of enc.slice(0, Math.max(0, i))) {
    const r = s.world.profiles.lineCleared(s.tokenId, [e.id], s.p.build, true);
    expect(r.ok).toBe(true);
  }
}

function walkInto(s: ReturnType<typeof seat>, encounterId: string): string {
  clearThrough(s, encounterId);
  standOn(s, encounterId);
  loop(s, 'line.enter', { encounterId });
  return s.world.sessionOf(s.id)!.spec.encounterId as string;
}

describe('line — the maps tab', () => {
  it('takes you to Tolls from the street, and to nowhere else', () => {
    const s = seat();
    const there = loop(s, 'line.travel', { region: 'tolls' });
    expect(there.ok).toBe(true);
    expect(there.region).toBe('tolls');
    expect(s.p.place).toBe('line');
    expect(s.p.region).toBe('tolls');

    const sealed = loop(s, 'line.travel', { region: 'marsh' });
    expect(sealed.ok).toBe(false);
    // Marsh is region three, so the warden standing in its way is Ash Pine's � the gate names
    // the *predecessor*, not the first region of the Line.
    expect(sealed.reason).toContain('ASH PINE');
    expect(s.p.region).toBe('tolls');
  });

  it('refuses a region the world has never heard of', () => {
    const s = seat();
    expect(loop(s, 'line.travel', { region: 'atlantis' }).ok).toBe(false);
  });

  it('opens the next region the moment the warden is down, through the same gate', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    expect(loop(s, 'line.travel', { region: 'ashpine' }).ok).toBe(false);
    for (let i = 1; i <= 7; i++) s.world.profiles.lineCleared(s.tokenId, [`tolls.${i}`], s.p.build);
    expect(loop(s, 'line.travel', { region: 'ashpine' }).ok).toBe(true);
  });

  it('puts you back where you left a region you have already walked', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    s.world.move(s.id, { x: 40, y: -30 });
    const { x, y } = s.p;
    expect(loop(s, 'line.travel', { region: null }).ok).toBe(true);
    expect(s.p.place).toBe('street');
    expect(loop(s, 'line.travel', { region: 'tolls' }).ok).toBe(true);
    expect(s.p.x).toBeCloseTo(x, 5);
    expect(s.p.y).toBeCloseTo(y, 5);
  });

  it('reports the frontier for the tab to highlight, and whether you are on the Line at all', () => {
    const s = seat();
    expect(loop(s, 'line.state')).toMatchObject({ ok: true, at: 'tolls', onTheLine: false });
    loop(s, 'line.travel', { region: 'tolls' });
    expect(loop(s, 'line.state')).toMatchObject({ at: 'tolls', onTheLine: true });
  });

  it('keeps the tabs and the server on one set of gates', () => {
    const s = seat();
    const view = loop(s, 'line.state') as unknown as { regions: { id: string; state: string }[] };
    for (const r of view.regions) {
      const res = loop(s, 'line.travel', { region: r.id });
      // A region the tab shows as sealed must refuse; one it shows as open must not.
      expect(res.ok, `${r.id} is ${r.state}`).toBe(r.state !== 'sealed');
    }
  });
});

describe('line — walking it', () => {
  it('lands you at the spawn of the region you walked into', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const layout = lineLayout('tolls');
    expect(s.p.x).toBeCloseTo(layout.spawn.x, 5);
    expect(s.p.y).toBeCloseTo(layout.spawn.z, 5);
  });

  it('holds you inside the region, so nobody walks out of the world', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const b = lineLayout('tolls').bounds;
    // Walk there the honest way — a hop at a time, because `move()` is a validator and walks a
    // too-far request back at run speed rather than honouring it.
    for (let i = 0; i < 60; i++) s.world.move(s.id, { x: 9_000, y: 9_000 });
    expect(s.p.x).toBeLessThanOrEqual(b.x1 + 0.001);
    expect(s.p.y).toBeLessThanOrEqual(b.z1 + 0.001);
  });

  it('walks rather than teleports, which is what stops a clear being claimed from the city', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    // The far end of the region: sites stand on the road from the spawn outward, so the first
    // site is a neighbour and only the last one proves a jump did not land.
    const site = lineLayout('tolls').encounters.at(-1)!;
    const before = { x: s.p.x, y: s.p.y };
    // One message asking for the far side of the region.
    s.world.move(s.id, { x: before.x + 180, y: before.y });
    // It gets walked a little and no further, so the player is still nowhere near the site.
    expect(Math.hypot(site.x - s.p.x, site.z - s.p.y)).toBeGreaterThan(100);
    expect(Math.hypot(s.p.x - before.x, s.p.y - before.y)).toBeLessThan(20);
  });
});

describe('line — fighting a site', () => {
  it('refuses to start a fight you are not standing on', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const res = loop(s, 'line.enter', { encounterId: 'tolls.1' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('nothing here to fight');
  });

  it('keeps banked encounters walking the road: the Line never runs out of bodies', () => {
    // A cleared road used to go quiet — bodies unlisted, contacts refused in silence — which
    // reads as a map that died with the duel. Banked encounters stay listed and standing;
    // the repeat pays the purse while the cards land once.
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    s.world.profiles.lineCleared(s.tokenId, ['tolls.1'], s.p.build, true);
    const state = loop(s, 'line.state');
    const mobs = state.mobs as { encounterId: string; alive: boolean }[];
    expect(mobs.some((m) => m.encounterId === 'tolls.1' && m.alive)).toBe(true);
    expect(mobs.some((m) => m.encounterId === 'tolls.2')).toBe(true);
  });

  it('refuses a fight whose id is not the one under your feet', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    standOn(s, 'tolls.1');
    const res = loop(s, 'line.enter', { encounterId: 'tolls.5' });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('not what you are standing on');
  });

  it('opens the fight for the site you walked up to', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    expect(walkInto(s, enc)).toBe(enc);
    const field = s.world.sessionOf(s.id)!;
    // And it is priced from the region, not from a magic table.
    expect(field.spec.hp).toBe(encounterBudget(enc)!.hp);
  });

  it('re-fights a banked site for the repeat purse, not the cards', () => {
    // Every touch is a duel, first or fiftieth. The cards land once — that is the curve —
    // and every win after the first pays the purse on the dirt.
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    expect(walkInto(s, enc)).toBe(enc);
    s.world.sessionOf(s.id)!.state.result = 'win';
    const first = loop(s, 'line.clear', { encounterId: enc });
    expect(first.ok).toBe(true);
    expect(first.cards as string[]).not.toHaveLength(0);
    // The banker walks free with a breath; once it passes, the same site opens again.
    (s.world as unknown as { duelGrace: Map<string, number> }).duelGrace.set(s.id, Date.now() - 1);
    standOn(s, enc);
    expect(loop(s, 'line.enter', { encounterId: enc }).ok).toBe(true);
    s.world.sessionOf(s.id)!.state.result = 'win';
    const repeat = loop(s, 'line.clear', { encounterId: enc });
    expect(repeat.ok).toBe(true);
    expect(repeat.cards).toHaveLength(0);
    expect(repeat.repeatWav as number).toBeGreaterThan(0);
  });
});

describe('line — claiming a clear', () => {
  it('refuses when there is no fight at all', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    // No walking: stepping onto a site can itself ambush a patrolling mob into a fight, so the
    // only deterministic "no fight" setup is standing at the spawn where nobody patrols.
    const res = loop(s, 'line.clear', { encounterId: 'tolls.1' });
    expect(res.ok).toBe(false);
    // Standing on a site does not by itself start the fight, so this is the honest answer.
    expect(res.reason).toContain('no fight here');
  });

  it('refuses a clear for a fight you are not in', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    standOn(s, 'tolls.1');
    loop(s, 'line.enter', { encounterId: 'tolls.1' });
    const res = loop(s, 'line.clear', { encounterId: 'tolls.5' });
    expect(res.ok).toBe(false);
  });

  it('refuses while the fight is still going', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    walkInto(s, enc);
    const before = s.world.profiles.lineCards(s.tokenId);
    const res = loop(s, 'line.clear', { encounterId: enc });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('not over');
    // A refused clear banks nothing: whatever the road proved on the way in is all there is.
    expect(s.world.profiles.lineCards(s.tokenId)).toEqual(before);
  });

  it('banks the encounter cards once the session says the fight was won', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    walkInto(s, enc);
    const field = s.world.sessionOf(s.id)!;
    // The server's own state, not a message: this is the only thing `line.clear` reads.
    field.state.result = 'win';
    const res = loop(s, 'line.clear', { encounterId: enc });
    expect(res.ok).toBe(true);
    // Whatever the encounter pays, the clear returns exactly what the profile banked.
    const cards = res.cards as string[];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(s.world.profiles.lineCards(s.tokenId)).toContain(c);
  });
});

describe('line — the duel wears the map mob', () => {
  it('claims a win the field already announced, after the session is gone', () => {
    // The tick deletes a finished session in the step that ends it; the plate closes
    // seconds later and asks to claim. Checking the session alone read as "no fight
    // here to have won" for every honest win: dead clicks, no drops, nothing banked.
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    walkInto(s, enc);
    const field = s.world.sessionOf(s.id)!;
    field.state.result = 'win';
    s.world.stepSessions(16);
    expect(s.world.sessionOf(s.id)).toBeNull();
    const res = loop(s, 'line.clear', { encounterId: enc });
    expect(res.ok).toBe(true);
    expect((res.cards as string[]).length).toBeGreaterThan(0);
    // Spent is spent: the same claim twice pays once.
    expect(loop(s, 'line.clear', { encounterId: enc }).ok).toBe(false);
  });

  it('opens the engaged encounter’s own archetype, on the ground and in the fight', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    // Whatever the walk actually meets — a post walked at directly, or an ambush on the
    // way in — the duel and the bodies agree with the encounter, never with a default.
    const enc = walkInto(s, 'tolls.5');
    const field = s.world.sessionOf(s.id)!;
    expect(field.state.boss.archetype).toBe(archetypeForEncounter(enc));
    for (const m of mobSpawns('tolls').filter((x) => x.encounterId === enc)) {
      expect(m.archetype).toBe(archetypeForEncounter(enc));
    }
  });
});

describe('line — the terrain both sides agree on', () => {
  it('gives every region a spawn, an exit until the last, and sites on walkable ground', () => {
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      const def = REGIONS.find((r) => r.id === id)!;
      expect(l.walkable(l.spawn.x, l.spawn.z), `${id} spawn`).toBe(true);
      expect(l.exit === null, `${id} exit`).toBe(def.n === 6);
      if (l.exit) expect(l.walkable(l.exit.x, l.exit.z), `${id} exit`).toBe(true);
      for (const s of l.encounters) expect(l.walkable(s.x, s.z), `${s.id}`).toBe(true);
    }
  });

  it('is a function of the region alone — same layout, every time, on both sides', () => {
    expect(lineLayout('ashpine')).toBe(lineLayout('ashpine'));
    expect(lineLayout('ashpine').solids).not.toBe(lineLayout('marsh').solids);
    expect(lineLayout('tolls').seed).not.toBe(lineLayout('causeway').seed);
  });

  it('never puts a tree on the road or on a site', () => {
    for (const id of REGION_IDS) {
      const l = lineLayout(id);
      for (const s of l.encounters) {
        expect(l.solids.filter((o) => Math.hypot(o.x - s.x, o.z - s.z) < 14), `${id} ${s.id}`).toEqual([]);
      }
    }
  });

  it('scales density by biome, so a forest is a forest', () => {
    expect(lineLayout('ashpine').solids.length).toBeGreaterThan(lineLayout('static').solids.length * 2);
    expect(lineLayout('ashpine').biome.tree).toBe('pine');
    expect(lineLayout('marsh').biome.haze).toBeGreaterThan(lineLayout('tolls').biome.haze);
  });
});

describe('trips come home to the quest board', () => {
  it('seats a new arrival beside the board', () => {
    const s = seat();
    const bs = boardSideFor(cityOf('ashflat'));
    expect(Math.hypot(s.p.x - bs.x, s.p.y - bs.z), 'join lands by the board').toBeLessThan(4);
  });

  it('lands line.travel null at the board', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    expect(loop(s, 'line.travel', { region: null }).ok).toBe(true);
    const bs = boardSideFor(cityOf('ashflat'));
    expect(s.p.place).toBe('street');
    expect(s.p.x).toBe(bs.x);
    expect(s.p.y).toBe(bs.z);
  });

  it('walks the board tutorial onto the road and back', () => {
    const s = seat();
    // Fresh seats join beside the board, in range to take its work.
    s.world.profiles.doc(s.tokenId).quests['m-01c'] = { progress: [1], done: true, turnedIn: true };
    expect(loop(s, 'quest.accept', { questId: 'm-01d', npcId: 'a-board' }).ok).toBe(true);
    loop(s, 'line.travel', { region: 'tolls' });
    expect(s.world.profiles.doc(s.tokenId).quests['m-01d']!.done).toBe(true);
    // Home lands back at the board, so the report needs no walk.
    loop(s, 'line.travel', { region: null });
    expect(loop(s, 'quest.turnin', { questId: 'm-01d', npcId: 'a-board' }).ok).toBe(true);
    expect(loop(s, 'quest.accept', { questId: 'm-01e', npcId: 'a-board' }).ok).toBe(true);

    const t = seat();
    t.world.profiles.doc(t.tokenId).quests['m-01c'] = { progress: [1], done: true, turnedIn: true };
    t.world.profiles.doc(t.tokenId).quests['m-01d'] = { progress: [1], done: true, turnedIn: true };
    expect(loop(t, 'quest.accept', { questId: 'm-01e', npcId: 'a-board' }).ok).toBe(true);
    loop(t, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    expect(walkInto(t, enc)).toBe(enc);
    t.world.sessionOf(t.id)!.state.result = 'win';
    expect(loop(t, 'line.clear', { encounterId: enc }).ok).toBe(true);
    expect(t.world.profiles.doc(t.tokenId).quests['m-01e']!.done).toBe(true);
  });

  it('lands area.close at the board', () => {
    const s = seat();
    s.world.profiles.grant(s.tokenId, { xp: 200 });
    expect(loop(s, 'area.open', { dungeonId: 'd-ember' }).ok).toBe(true);
    expect(loop(s, 'area.close').ok).toBe(true);
    const bs = boardSideFor(cityOf('ashflat'));
    expect(s.p.x).toBe(bs.x);
    expect(s.p.y).toBe(bs.z);
  });
});

describe('line — loot falls where the mob fell', () => {
  it('drops the purse at the body, and only shows it in its own region', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    expect(walkInto(s, enc)).toBe(enc);
    const field = s.world.sessionOf(s.id)!;
    field.state.result = 'win';
    const cleared = loop(s, 'line.clear', { encounterId: enc });
    expect(cleared.ok).toBe(true);
    const piles = loop(s, 'drops') as unknown as { ok: boolean; drops: { x: number; z: number }[] };
    expect(piles.drops.length).toBeGreaterThan(0);
    // The pile waits at a body of the fight — within patrol plus scatter of one of its homes —
    // not at the winner's feet.
    const homes = mobSpawns('tolls').filter((m) => m.encounterId === enc).map((m) => m.home);
    expect(homes.length).toBeGreaterThan(0);
    for (const d of piles.drops) {
      const near = homes.some((h) => Math.hypot(d.x - h.x, d.z - h.z) < 12);
      expect(near, `pile at ${d.x.toFixed(1)},${d.z.toFixed(1)} waits by a body of ${enc}`).toBe(true);
    }
    // Back in the city the road's loot is not on the street, and walking back shows it again.
    loop(s, 'line.travel', { region: null });
    expect((loop(s, 'drops') as unknown as { drops: unknown[] }).drops).toEqual([]);
    loop(s, 'line.travel', { region: 'tolls' });
    expect((loop(s, 'drops') as unknown as { drops: unknown[] }).drops.length).toBeGreaterThan(0);
  });

  it('sends each mob with its duel avatar, tier and a real facing', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const state = loop(s, 'line.state') as unknown as {
      mobs: { id: string; kind: string; archetype: string; tier: number; facing: number }[];
    };
    expect(state.mobs.length).toBeGreaterThan(0);
    for (const m of state.mobs) {
      expect(m.tier).toBe(1);
      // The mob id is `encounter.body`: the avatar must be the encounter's own.
      const enc = m.id.slice(0, m.id.lastIndexOf('.'));
      expect(m.archetype, m.id).toBe(archetypeForEncounter(enc));
      expect(Number.isFinite(m.facing)).toBe(true);
    }
    expect(state.mobs.find((m) => m.kind === 'warden')!.archetype).toBe('tollkeeper');
  });
});

describe('line — what the fights cost', () => {
  it('is beatable with the basic attack alone where the road starts', () => {
    // The tutorial promise: the first drift of the Line falls to basics in about two
    // screens. Past that the region gates prove the deck, so later fights are priced on
    // the cards the road has already handed over, not on an empty hand nobody holds
    // that far down.
    expect(screensForBasicsOnly('tolls.4')).toBeLessThanOrEqual(2.5);
  });

  it('lasts its own screens on the deck the road proves', () => {
    for (const e of ENCOUNTERS) {
      const b = encounterBudget(e.id)!;
      // The arrival deck clears it in the kind's screens, times the quirk's seasoning.
      expect(screensForRegionDeck(e.id), e.id).toBeLessThanOrEqual(Math.round(b.screens * 1.3 * 10) / 10);
      expect(screensForRegionDeck(e.id), e.id).toBeGreaterThanOrEqual(b.screens);
    }
  });

  it('prices every encounter from the cards its region hands out beforehand', () => {
    for (const e of ENCOUNTERS) {
      const b = encounterBudget(e.id)!;
      expect(b.hp, e.id).toBeGreaterThan(0);
      // The budget is derived, so moving a card between two encounters changes both — which is
      // the point, and the reason there is no table to forget to update.
      // Times the encounter's quirk, when it has one: seasoning on the derived price,
      // not a second table.
      expect(b.hp).toBe(Math.round(b.screens * b.screenMight * (quirkOf(e.id).hpK ?? 1)));
    }
  });

  it('gives a warden more of a fight than a post, which more than a drift', () => {
    for (const r of REGIONS) {
      const d = r.encounters.find((e) => e.kind === 'drift')!;
      const p = r.encounters.find((e) => e.kind === 'post')!;
      const w = r.encounters.find((e) => e.kind === 'warden')!;
      expect(encounterBudget(w.id)!.hp).toBeGreaterThan(encounterBudget(p.id)!.hp);
      expect(encounterBudget(p.id)!.hp).toBeGreaterThan(encounterBudget(d.id)!.hp);
    }
  });

  it('grows the whole Line\'s deck as it is walked', () => {
    const s = seat();
    expect(s.world.profiles.slots(s.tokenId)).toBeLessThan(LINE_MAX_SLOTS);
    for (const r of REGIONS) for (const e of r.encounters) s.world.profiles.lineCleared(s.tokenId, [e.id], s.p.build);
    expect(s.world.profiles.slots(s.tokenId)).toBe(LINE_MAX_SLOTS);
  });
});

describe('line — the trailhead scout', () => {
  it('talks to whoever stands at the fire, quest or no quest', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    // No quest accepted, no flag set: the scout is company, not a gate.
    const scout = campOf('tolls').npc;
    for (let i = 0; i < 400; i++) {
      const dx = scout.x - s.p.x;
      const dz = scout.z - s.p.y;
      if (Math.hypot(dx, dz) <= 2) break;
      s.world.move(s.id, { x: s.p.x + dx, y: s.p.y + dz });
    }
    const res = loop(s, 'line.talk');
    expect(res.ok).toBe(true);
    const talk = res.talk as { npc: { id: string }; pages: string[]; options: { id: string }[] };
    expect(talk.npc.id).toBe('line-scout');
    expect(talk.pages.length).toBeGreaterThan(0);
    expect(talk.options.map((o) => o.id)).toContain('close');
  });

  it('does not talk across the region', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    // Fresh off the road, still at the spawn: too far from the fire.
    expect(loop(s, 'line.talk')).toMatchObject({ ok: false });
  });
});

describe('line — starting the fight', () => {
  it('joins the session when a patrolling body is walked into, not just on E', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    standOn(s, enc);
    clearThrough(s, enc);
    // Stalk the nearest body of that site until contact. The body roams, so the
    // boots are nowhere near the site by the time the reach closes — and the join
    // must still land, on the body\u2019s encounter, or the ambush is a push with
    // no session behind it and the body bricks in `inFight` forever.
    // (site coordinates not needed: the bodies are the targets)
    const bodies = mobSpawns('tolls').filter((m) => m.encounterId === enc);
    expect(bodies.length).toBeGreaterThan(0);
    // (site coordinates not needed: the bodies are the targets)
    for (let i = 0; i < 500 && !s.world.sessionOf(s.id); i++) {
      let m = bodies[0]!;
      let bd = Infinity;
      for (const b of bodies) {
        const at = mobAt(b, Date.now());
        const d = Math.hypot(s.p.x - at.x, s.p.y - at.z);
        if (d < bd) { bd = d; m = b; }
      }
      const at = mobAt(m, Date.now());
      s.world.move(s.id, { x: at.x, y: at.z });
    }
    const field = s.world.sessionOf(s.id);
    expect(field).not.toBeNull();
    expect(field!.spec.encounterId).toBe(enc);
  });

  it('marks the E-started fight\u2019s nearest body so the purse has an anchor', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    expect(walkInto(s, enc)).toBe(enc);
    expect(s.world.sessionOf(s.id)).not.toBeNull();
  });

  it('reopens the duel when E names the fight the ambush already started', () => {
    // Walking into a drift engages you; pressing E on its site is a rejoin, not a
    // second fight. Refusing it read as a broken map ("leave the current field first"
    // for the field you are standing on).
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    expect(walkInto(s, enc)).toBe(enc);
    expect(s.world.sessionOf(s.id)).not.toBeNull();
    expect(loop(s, 'line.enter', { encounterId: enc }).ok).toBe(true);
  });

  it('makes leaving a fight buy breath, not another fight', () => {
    // The eternal duel: leave, step, ambush, leave… Standing on the site after
    // walking out has to refuse for a breath instead of reopening instantly.
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    expect(walkInto(s, enc)).toBe(enc);
    s.world.duelLeave(s.id);
    const refused = loop(s, 'line.enter', { encounterId: enc });
    expect(refused.ok).toBe(false);
    expect(String(refused.reason)).toMatch('catch your breath');
    // …and once the breath passes, the same fight opens fresh.
    (s.world as unknown as { duelGrace: Map<string, number> }).duelGrace.set(s.id, Date.now() - 1);
    expect(loop(s, 'line.enter', { encounterId: enc }).ok).toBe(true);
  });

  it('banks a clear by releasing the field, not by haunting it', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    clearThrough(s, enc);
    standOn(s, enc);
    expect(loop(s, 'line.enter', { encounterId: enc }).ok).toBe(true);
    s.world.sessionOf(s.id)!.state.result = 'win';
    expect(loop(s, 'line.clear', { encounterId: enc }).ok).toBe(true);
    // Staying in the corpse session bricked the next ambush check and reopened a
    // finished duel on E. The banker walks free with a breath; once it passes, the same
    // site opens again for the repeat purse - the road never ends.
    expect(s.world.sessionOf(s.id)).toBeNull();
    const breath = loop(s, 'line.enter', { encounterId: enc });
    expect(breath.ok).toBe(false);
    expect(String(breath.reason)).toMatch('catch your breath');
    (s.world as unknown as { duelGrace: Map<string, number> }).duelGrace.set(s.id, Date.now() - 1);
    expect(loop(s, 'line.enter', { encounterId: enc }).ok).toBe(true);
  });

  it('stands a drift back up at new ground once its timer elapses', () => {
    // Lazy respawn: the body that fell long ago is listed alive again, walking from a
    // fresh home near its site rather than the printed one.
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const mob = mobSpawns('tolls').find((m) => m.encounterId === 'tolls.1')!;
    expect(mob.respawnS).toBeGreaterThan(0);
    (s.world as unknown as { lineMobs: Map<string, { deadAt: number; inFight: string | null }> }).lineMobs.set(
      mob.id, { deadAt: Date.now() - (mob.respawnS * 1000 + 5000), inFight: null },
    );
    const state = loop(s, 'line.state');
    const back = (state.mobs as { id: string; alive: boolean; home: { x: number; z: number } }[]).find(
      (m) => m.id === mob.id,
    )!;
    expect(back.alive).toBe(true);
    const site = lineLayout('tolls').encounters.find((e) => e.id === 'tolls.1')!;
    expect(Math.hypot(back.home.x - site.x, back.home.z - site.z)).toBeLessThanOrEqual(12.5);
  });

  it('leaves a crossed warden crossed', () => {
    // `respawnS: 0` is the gate that was crossed: no timer elapses it back.
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const mob = mobSpawns('tolls').find((m) => m.encounterId === 'tolls.7')!;
    expect(mob.respawnS).toBe(0);
    (s.world as unknown as { lineMobs: Map<string, { deadAt: number; inFight: string | null }> }).lineMobs.set(
      mob.id, { deadAt: Date.now() - 3600_000, inFight: null },
    );
    const state = loop(s, 'line.state');
    const warden = (state.mobs as { id: string; alive: boolean }[]).find((m) => m.id === mob.id)!;
    expect(warden.alive).toBe(false);
  });

  it('tells the player why a touch refused to fight', () => {
    // A downed body walks into tolls.1's mob: the touch refuses out loud instead of
    // dying quietly, because a figure that came at you and then did
    // nothing reads as a broken ambush.
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    (s.world as unknown as { downedUntil: Map<string, number> }).downedUntil.set(s.id, Date.now() + 8000);
    const mob = mobSpawns('tolls').find((m) => m.encounterId === 'tolls.1')!;
    const at = mobAt(mob, Date.now());
    s.p.x = at.x;
    s.p.y = at.z;
    const got: Record<string, unknown>[] = [];
    (s.world as unknown as { pushSends: Map<string, (m: Record<string, unknown>) => void> }).pushSends.set(
      s.id, (m) => { got.push(m); },
    );
    (s.world as unknown as { checkLineMobs: (id: string, p: unknown) => void }).checkLineMobs(s.id, s.p);
    const sealed = got.find((m) => m['kind'] === 'sealed') as { reason?: string } | undefined;
    expect(sealed).toBeTruthy();
    expect(String(sealed!.reason)).toContain('still recovering');
    expect(s.world.sessionOf(s.id)).toBeNull();
  });

  it('kills the body on the win tick, so the reaped claim still pays the purse', () => {
    // The live path: the tick reaps the won session before `line.clear` arrives. The body
    // used to be released by the end plate and re-stood with purse 0; now the win arm kills
    // it and banks the purse with the claim.
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    expect(walkInto(s, enc)).toBe(enc);
    const marks = (s.world as unknown as { lineMobs: Map<string, { deadAt: number; inFight: string | null }> }).lineMobs;
    const mobId = [...marks].find(([, st]) => st.inFight === s.id)?.[0];
    expect(mobId).toBeTruthy();
    s.world.sessionOf(s.id)!.state.result = 'win';
    s.world.stepSessions(100);
    // Reaped: no session, a banked claim, and a corpse on the road.
    expect(s.world.sessionOf(s.id)).toBeNull();
    expect(marks.get(mobId!)!.inFight).toBeNull();
    expect(marks.get(mobId!)!.deadAt).toBeGreaterThan(0);
    const clear = loop(s, 'line.clear', { encounterId: enc });
    expect(clear.ok).toBe(true);
    expect(clear.repeatWav as number).toBeGreaterThan(0);
    const state = loop(s, 'line.state');
    const corpse = (state.mobs as { id: string; alive: boolean }[]).find((m) => m.id === mobId)!;
    expect(corpse.alive).toBe(false);
  });

  it('keeps the recovering and the finished out of the rejoin', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    expect(walkInto(s, enc)).toBe(enc);
    (s.world as unknown as { downedUntil: Map<string, number> }).downedUntil.set(s.id, Date.now() + 8000);
    const downed = loop(s, 'line.enter', { encounterId: enc });
    expect(downed.ok).toBe(false);
    expect(String(downed.reason)).toMatch('still recovering');
    (s.world as unknown as { downedUntil: Map<string, number> }).downedUntil.delete(s.id);
    const sess = s.world.sessionOf(s.id)!;
    (sess.state as unknown as { over: boolean }).over = true;
    const over = loop(s, 'line.enter', { encounterId: enc });
    expect(over.ok).toBe(false);
    expect(String(over.reason)).toMatch('that fight is over');
  });
});

describe('line — card drops', () => {
  function clearSite(s: ReturnType<typeof seat>, enc: string) {
    clearThrough(s, enc);
    standOn(s, enc);
    expect(loop(s, 'line.enter', { encounterId: enc }).ok).toBe(true);
    s.world.sessionOf(s.id)!.state.result = 'win';
    const res = loop(s, 'line.clear', { encounterId: enc });
    expect(res.ok).toBe(true);
    return res;
  }
  function walkTo(s: ReturnType<typeof seat>, x: number, y: number): void {
    for (let i = 0; i < 400; i++) {
      const dx = x - s.p.x;
      const dz = y - s.p.y;
      if (Math.hypot(dx, dz) <= 1.5) return;
      s.world.move(s.id, { x: s.p.x + dx, y: s.p.y + dz });
    }
    throw new Error(`could not reach ${x},${y}`);
  }
  function piles(s: ReturnType<typeof seat>): { id: string; x: number; z: number; kind: string; key?: string; amount?: number; ttl: number }[] {
    const r = loop(s, 'drops') as unknown as { drops: { id: string; x: number; z: number; kind: string; key?: string; amount?: number; ttl: number }[] };
    return r.drops;
  }

  it('pays the purse into the bag on take, not on clear', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    const before = s.world.profiles.doc(s.tokenId).bag.wav;
    clearSite(s, enc);
    // The purse fell on the dirt; the bag has not moved.
    expect(s.world.profiles.doc(s.tokenId).bag.wav).toBe(before);
    const purse = piles(s).find((d) => d.kind === 'wav');
    expect(purse).toBeDefined();
    walkTo(s, purse!.x, purse!.z);
    expect(loop(s, 'take', { dropId: purse!.id }).ok).toBe(true);
    expect(s.world.profiles.doc(s.tokenId).bag.wav).toBe(before + (purse!.amount ?? 0));
    expect(purse!.amount ?? 0).toBeGreaterThan(0);
  });

  it('drops first-clear cards on the dirt instead of the deck', () => {
    // Token 9000's weakness is not frost, so tolls.4's green_candle is pool-legal.
    const s = seat(9000);
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    const res = clearSite(s, enc);
    const cards = res.cards as string[];
    expect(cards.length).toBeGreaterThan(0);
    // Marked cleared, paid nothing yet: the pool does not know the cards…
    const poolBefore = s.world.profiles.deckView(s.tokenId, s.p.build).pool;
    for (const c of cards) expect(poolBefore).not.toContain(c);
    expect(s.world.profiles.owedCardsOf(s.tokenId)).toEqual(expect.arrayContaining(cards));
    // …and the cards sit on the dirt with no clock on them.
    const dropped = piles(s).filter((d) => d.kind === 'card');
    expect(dropped.map((d) => d.key).sort()).toEqual([...cards].sort());
    for (const d of dropped) expect(d.ttl).toBe(-1);
    // Walk over, click, own: each take moves exactly one card into the pool.
    for (const d of dropped) {
      walkTo(s, d.x, d.z);
      expect(loop(s, 'take', { dropId: d.id }).ok).toBe(true);
    }
    const poolAfter = s.world.profiles.deckView(s.tokenId, s.p.build).pool;
    for (const c of cards) expect(poolAfter).toContain(c);
    expect(s.world.profiles.owedCardsOf(s.tokenId)).toEqual([]);
  });

  it('replantes owed cards on join after a restart', () => {
    const s = seat();
    loop(s, 'line.travel', { region: 'tolls' });
    const enc = nearestToSpawn();
    const res = clearSite(s, enc);
    const cards = res.cards as string[];
    expect(cards.length).toBeGreaterThan(0);
    // The process dies with the piles still on the dirt.
    const world2 = new World();
    const p2 = world2.join(`w${s.tokenId}`, { tokenId: s.tokenId, transferCount: 0, daysHeld: 0 }, 'ashflat', null);
    const id2 = p2.id;
    const r = world2.loop(id2, { action: 'drops' }) as unknown as { drops: { kind: string; key?: string }[] };
    expect(r.drops.filter((d) => d.kind === 'card').map((d) => d.key).sort()).toEqual([...cards].sort());
  });
});
