import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_BY_ID,
  SF,
  GA_BY_ID,
  GA_CARDS,
  sellPrice,
  cityOf,
  partyHpScale,
  partyRewardScale,
  startRun,
  type Anchor,
  type AreaNode,
  type DataArea,
  xpForRoom,
} from '@chog/shared';

/**
 * The street, from the server's side: where a player can stand, who they can talk to, and
 * what a quest is allowed to believe. Every rule here exists because the client is not
 * trusted — a message can *say* it is next to the Operator, and the server is the one that
 * has to know it is not.
 */

let dir: string;
let World: typeof import('../src/world.ts').World;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-street-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  ({ World } = await import('../src/world.ts'));
});

beforeEach(() => {
  // Dungeon seeds include the current second; keep room/payout fixtures reproducible.
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 11));
});
afterEach(() => vi.restoreAllMocks());

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* windows keeps the sqlite handle a moment */
  }
});

const city = cityOf('ashflat');
const anchor = (id: string): Anchor => city.anchors.find((a) => a.id === id)!;

/** Stand a player next to something, the way walking there would. */
function stand(p: { x: number; y: number }, a: Anchor, dx = 1): void {
  p.x = a.x + dx;
  p.y = a.z;
}

function fresh(token = 4001) {
  const world = new World();
  const p = world.join(`p${token}`, { tokenId: token, transferCount: 0, daysHeld: 0 }, 'ashflat');
  return { world, p, id: p.id };
}

function finishField(world: InstanceType<typeof World>, id: string): void {
  const field = world.sessionOf(id)!;
  const st = field.state;
  const body = st.players.find((p) => p.id === id)!;
  field.field.boss.hp = 1;
  body.file = st.field.boss.file;
  st.boss.next = 100_000;
  field.field.hazards = [];
  body.handOpen = false;
  body.program = null;
  SF.openHand(st, body);
  const hand = body.hand!;
  const cell = hand.cells.find((c) => SF.canPick(hand, c.cell, SF.capsOf(body)).ok);
  expect(cell, 'a pickable card').toBeDefined();
  expect(SF.pickCard(st, id, cell!.cell)).toBe(true);
  expect(SF.execute(st, id)).toBe(true);
  for (let t = 0; t < 3000 && st.result == null; t += 100) world.stepSessions(100);
  expect(field.state.result).toBe('win');
}

/**
 * finishField for a bout: both boots are already on, so the winner puts one program
 * down the loser's file and the engine does the rest - down, grace, removal, decision.
 * Separated so a PvP rebalance only breaks the brawl tests.
 */
function finishPvp(world: InstanceType<typeof World>, id: string): void {
  const field = world.sessionOf(id)!;
  const st = field.state;
  const body = st.players.find((p) => p.id === id)!;
  const loser = st.players.find((p) => p.id !== id)!;
  loser.hp = 1;
  body.file = loser.file;
  for (const b of st.players) { b.chargeMs = 100_000; b.charge = 0; }
  field.field.hazards = [];
  body.handOpen = false;
  body.program = null;
  SF.openHand(st, body);
  const hand = body.hand!;
  const cell = hand.cells.find((c) => SF.canPick(hand, c.cell, SF.capsOf(body)).ok);
  expect(cell, 'a pickable card').toBeDefined();
  expect(SF.pickCard(st, id, cell!.cell)).toBe(true);
  expect(SF.execute(st, id)).toBe(true);
  for (let t = 0; t < 8000 && !st.over; t += 100) world.stepSessions(100);
  expect(field.state.result).toBe('win');
  expect(field.state.winnerId).toBe(id);
}

describe('where a player may stand', () => {
  it('clamps a position to the district it is in', () => {
    const { world, p } = fresh();
    p.at = Date.now() - 1000;
    world.move(p.id, { x: 9999, y: -9999 });
    expect(p.x).toBeLessThanOrEqual(city.bounds.x1);
    expect(p.y).toBeGreaterThanOrEqual(city.bounds.z0);
  });

  it('walks a teleport at run speed instead of allowing it', () => {
    const { world, p } = fresh();
    p.x = 0;
    p.y = 0;
    p.at = Date.now() - 100;
    world.move(p.id, { x: 90, y: 0 });
    // 100 ms at 17 u/s plus slack: nowhere near 90 units.
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(6);
  });

  it('keeps a player who is inside a building off the street', () => {
    const a = fresh(4002);
    const b = world2(a.world, 4003);
    a.world.move(a.id, { place: 'room' });
    const seen = a.world.snapshot(b.id).players.map((x) => x.id);
    expect(seen).not.toContain(a.id);
    a.world.move(a.id, { place: 'street' });
    expect(a.world.snapshot(b.id).players.map((x) => x.id)).toContain(a.id);
  });

  it('restores the street position after a visit to a room, so a door is not a teleport', () => {
    const { world, p } = fresh(4004);
    p.x = -40;
    p.y = 5;
    world.move(p.id, { place: 'room' });
    world.move(p.id, { x: 3, y: 2 });
    world.move(p.id, { place: 'street' });
    expect(p.x).toBe(-40);
    expect(p.y).toBe(5);
  });
});

function world2(world: InstanceType<typeof World>, token: number) {
  return world.join(`p${token}`, { tokenId: token, transferCount: 0, daysHeld: 0 }, 'ashflat');
}

describe('talking and quests', () => {
  it('refuses to talk to someone who is across town', () => {
    const { world, p, id } = fresh(4010);
    stand(p, anchor('a-courier'), 60);
    expect(world.loop(id, { action: 'npc.talk', npcId: 'a-operator' }).ok).toBe(false);
  });

  it('refuses a person who lives in another district', () => {
    const { world, p, id } = fresh(4011);
    stand(p, anchor('a-operator'));
    expect(world.loop(id, { action: 'npc.talk', npcId: 'v-operator' }).ok).toBe(false);
  });

  it('offers the first quest at the board, and nothing is progress until it is taken', () => {
    const { world, p, id } = fresh(4012);
    // Talking to the operator first does nothing for a quest you have not taken.
    stand(p, anchor('a-operator'));
    world.loop(id, { action: 'npc.talk', npcId: 'a-operator' });
    stand(p, anchor('a-board'));
    const talk = world.loop(id, { action: 'npc.talk', npcId: 'a-board' }) as unknown as { ok: boolean; talk: { options: { id: string }[] } };
    expect(talk.ok).toBe(true);
    expect(talk.talk.options.some((o) => o.id === 'accept:m-01')).toBe(true);
    expect(world.profileFor(id)!.quests.some((q) => q.id === 'm-01')).toBe(false);
  });

  it('runs a quest from the board to the operator and pays it once', () => {
    const { world, p, id } = fresh(4013);
    stand(p, anchor('a-board'));
    expect(world.loop(id, { action: 'quest.accept', questId: 'm-01', npcId: 'a-board' }).ok).toBe(true);
    expect(world.loop(id, { action: 'quest.accept', questId: 'm-01', npcId: 'a-board' }).ok).toBe(false);

    stand(p, anchor('a-operator'));
    const talk = world.loop(id, { action: 'npc.talk', npcId: 'a-operator' }) as unknown as { talk: { options: { id: string }[] } };
    // The conversation completed the objective, and the same conversation hands it in.
    expect(talk.talk.options.some((o) => o.id === 'turnin:m-01')).toBe(true);
    const before = world.profileFor(id)!.wav;
    const done = world.loop(id, { action: 'quest.turnin', questId: 'm-01', npcId: 'a-operator' });
    expect(done.ok).toBe(true);
    expect(world.profileFor(id)!.wav).toBe(before + 40);
    expect(world.loop(id, { action: 'quest.turnin', questId: 'm-01', npcId: 'a-operator' }).ok).toBe(false);
  });

  it('will not hand a quest in to the wrong person, or from a distance', () => {
    const { world, p, id } = fresh(4014);
    stand(p, anchor('a-board'));
    world.loop(id, { action: 'quest.accept', questId: 'm-01', npcId: 'a-board' });
    stand(p, anchor('a-operator'));
    world.loop(id, { action: 'npc.talk', npcId: 'a-operator' });
    stand(p, anchor('a-dealer'));
    expect(world.loop(id, { action: 'quest.turnin', questId: 'm-01', npcId: 'a-dealer' }).ok).toBe(false);
    stand(p, anchor('a-operator'), 70);
    expect(world.loop(id, { action: 'quest.turnin', questId: 'm-01', npcId: 'a-operator' }).ok).toBe(false);
  });

  it('will not hand out a quest from the wrong person, or one that is not open yet', () => {
    const { world, p, id } = fresh(4015);
    stand(p, anchor('a-dealer'));
    expect(world.loop(id, { action: 'quest.accept', questId: 'm-01', npcId: 'a-dealer' }).ok).toBe(false);
    expect(world.loop(id, { action: 'quest.accept', questId: 'm-02', npcId: 'a-operator' }).ok).toBe(false);
  });

  it('puts the marker over the right head', () => {
    const { world, p, id } = fresh(4016);
    expect(world.profileFor(id)!.marks['a-board']).toBe('offer');
    stand(p, anchor('a-board'));
    world.loop(id, { action: 'quest.accept', questId: 'm-01', npcId: 'a-board' });
    expect(world.profileFor(id)!.marks['a-operator']).toBe('progress');
    stand(p, anchor('a-operator'));
    world.loop(id, { action: 'npc.talk', npcId: 'a-operator' });
    expect(world.profileFor(id)!.marks['a-operator']).toBe('turnin');
  });

  it('refuses the old hand-in-from-a-menu action', () => {
    const { world, id } = fresh(4017);
    expect(world.loop(id, { action: 'turn', questId: 'm-01' }).ok).toBe(false);
  });
});

describe('the dungeons', () => {
  const xpFor = (lv: number): number => Math.round(28 * Math.pow(lv - 1, 1.6));
  /** Bring a token to a level, whatever XP its own traits arrived with. */
  const toLevel = (world: InstanceType<typeof World>, key: string, lv: number): void => {
    world.profiles.grant(key, { xp: Math.max(0, xpFor(lv) - world.profiles.doc(key).xp) });
  };

  it('stay shut to a newcomer, and say why', () => {
    const { world, p, id } = fresh(4030);
    // a token arrives with the XP its own traits earned; a true newcomer has none
    world.profiles.doc(p.tokenId).xp = 0;
    stand(p, anchor('a-fold'));
    const res = world.loop(id, { action: 'area.open', dungeonId: 'd-ember' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/opens at LV 2/);
    expect(world.profileFor(id)!.dungeons.map((d) => d.state)).toEqual(['locked', 'locked', 'locked', 'locked', 'locked', 'locked']);
  });

  it('opens from wherever you are standing: a fold is data, not a door', () => {
    const { world, p, id } = fresh(4031);
    toLevel(world, p.saveKey, 2);
    stand(p, anchor('a-operator'), 40);
    // The gate is how you find the folds the first time; it is not a toll collected every run.
    const res = world.loop(id, { action: 'area.open', dungeonId: 'd-ember' });
    expect(res.ok).toBe(true);
    expect((res.area as { name: string }).name).toBe('EMBER FOUNDRY');
    // and not twice: a run is already open
    expect(world.loop(id, { action: 'area.open', dungeonId: 'd-ember' }).ok).toBe(false);
  });

  it('open in order: the level is not enough without the dungeon before it', () => {
    const { world, p, id } = fresh(4032);
    toLevel(world, p.saveKey, 30);
    stand(p, anchor('a-fold'));
    const res = world.loop(id, { action: 'area.open', dungeonId: 'd-frost' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/clear EMBER FOUNDRY first/);
    expect(world.loop(id, { action: 'area.open', dungeonId: 'd-void' }).ok).toBe(false);
    expect(world.loop(id, { action: 'area.open', dungeonId: 'nope' }).ok).toBe(false);
  });

  /** Walk a run to its core, clearing every room on the way, the way the field would. */
  const runToCore = (world: InstanceType<typeof World>, tokenId: number, id: string): ReturnType<InstanceType<typeof World>['profiles']['clearCurrent']> => {
    const profiles = world.profiles;
    let last: ReturnType<typeof profiles.clearCurrent> = { ok: false };
    for (let guard = 0; guard < 40; guard++) {
      const view = profiles.areaView(tokenId);
      const here = view.area!.nodes.find((n) => n.id === view.run!.at)!;
      if (view.run!.done) break;
      const next = view.area!.nodes.find((n) => here.links.includes(n.id) && !view.run!.cleared.includes(n.id))!;
      const step = profiles.stepArea(tokenId, next.id);
      if (!step.ok) throw new Error(step.reason);
      if (step.fights) {
        world.duelEnter(id, 'node');
        // What the tick loop does when a field's boss falls: the kill is issued before it is paid.
        profiles.armNode(tokenId, next.id);
        last = profiles.clearCurrent(tokenId, 0, 1, world.players.get(id)!.build);
      }
    }
    return last;
  };

  /**
   * Two Chogs linked as a party, both standing at the Fold Gate, with an inbox on the second so
   * what the server *says* to a member is as checkable as what it decides about them.
   *
   * `wallets` is the pair of signed addresses the socket would have put on them: two Chogs can share
   * one, and the reward scale turns on exactly that.
   */
  const partyAtGate = (hostToken: number, otherToken: number, wallets: [string | null, string | null] = [null, null]) => {
    const world = new World();
    const host = world.join(`p${hostToken}`, { tokenId: hostToken, transferCount: 0, daysHeld: 0 }, 'ashflat', wallets[0]);
    const other = world.join(`p${otherToken}`, { tokenId: otherToken, transferCount: 0, daysHeld: 0 }, 'ashflat', wallets[1]);
    stand(host, anchor('a-fold'));
    stand(other, anchor('a-fold'), -1);
    toLevel(world, host.saveKey, 5);
    toLevel(world, other.saveKey, 5);
    const inbox: Record<string, unknown>[] = [];
    world.onPush(other.id, (m) => inbox.push(m));
    world.partyAction(host.id, { action: 'invite', with: other.id });
    world.partyAction(other.id, { action: 'accept' });
    return { world, host, other, inbox };
  };

  /**
   * The shortest walk from the mouth of the fold to the first tile a matcher likes, read off the
   * graph rather than taken by stepping: a party has to walk the *same* route for the test to mean
   * anything, and the route a random walk happens to take is not one a partner can repeat.
   */
  const routeTo = (
    world: InstanceType<typeof World>,
    key: string,
    matches: (n: AreaNode) => boolean,
    why: string,
  ): string[] => {
    const area = world.profiles.doc(key).area!;
    const by = new Map(area.nodes.map((n) => [n.id, n]));
    const parent = new Map<string, string>();
    const seen = new Set([area.entryId]);
    let frontier = [area.entryId];
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const link of by.get(id)!.links) {
          if (seen.has(link)) continue;
          seen.add(link);
          parent.set(link, id);
          if (matches(by.get(link)!)) {
            const back: string[] = [link];
            while (back[back.length - 1] !== area.entryId) back.push(parent.get(back[back.length - 1]!)!);
            return back.reverse().slice(1);
          }
          next.push(link);
        }
      }
      frontier = next;
    }
    throw new Error(why);
  };

  const routeToEnemy = (world: InstanceType<typeof World>, key: string): string[] =>
    routeTo(world, key, (n) => !!n.enemy && n.kind !== 'boss', 'nothing stands in this fold');

  /** Walk a route through the handler, so the fields opened on the way are the server's own. */
  const walk = (world: InstanceType<typeof World>, id: string, route: string[]): void => {
    for (const nodeId of route) {
      const step = world.loop(id, { action: 'area.step', nodeId });
      if (!step.ok) throw new Error(String(step.reason));
      if ((step as { fights?: boolean }).fights) {
        const engage = world.loop(id, { action: 'area.engage' });
        if (!engage.ok) throw new Error(String(engage.reason));
      }
    }
  };

  /** What a tile of this kind pays one person, before any party is counted. */
  const soloXp = (tier: number, kind: string): number => Math.round(xpForRoom(tier) * (kind === 'elite' ? 1.8 : 1));

  it('pay the first clear once, mark the dungeon cleared and open the next', () => {
    const { world, p, id } = fresh(4033);
    toLevel(world, p.saveKey, 5);
    stand(p, anchor('a-fold'));
    expect(world.loop(id, { action: 'area.open', dungeonId: 'd-ember' }).ok).toBe(true);
    const before = world.profiles.doc(p.tokenId).xp;
    const res = runToCore(world, p.tokenId, id);
    expect(res.cleared?.def.id).toBe('d-ember');
    expect(res.cleared?.first).toBe(true);
    expect(world.profiles.doc(p.tokenId).xp).toBeGreaterThan(before + 59);
    expect(world.profileFor(id)!.dungeons.map((d) => d.state).slice(0, 2)).toEqual(['cleared', 'open']);
    expect(world.profileFor(id)!.flags).toContain('dungeon:d-ember');

    // a second run of the same fold pays its rooms, and no first-clear bonus
    world.loop(id, { action: 'area.close' });
    expect(world.loop(id, { action: 'area.open', dungeonId: 'd-ember' }).ok).toBe(true);
    const again = runToCore(world, p.tokenId, id);
    expect(again.cleared?.first).toBe(false);
    expect(again.cleared?.grant).toBeUndefined();
  });

  it('earns the signature itself on the first clear, and never twice', () => {
    const { world, p, id } = fresh(40335);
    toLevel(world, p.saveKey, 5);
    stand(p, anchor('a-fold'));
    expect(world.loop(id, { action: 'area.open', dungeonId: 'd-ember' }).ok).toBe(true);
    const sig = p.build.signature;
    expect(world.profiles.pool(p.tokenId, p.build)).not.toContain(sig);
    const res = runToCore(world, p.tokenId, id);
    expect(res.cleared?.first).toBe(true);
    expect(res.cleared?.grant?.cards).toContain(sig);
    expect(world.profiles.pool(p.tokenId, p.build)).toContain(sig);
    // a second run pays its rooms but never a second signature
    world.loop(id, { action: 'area.close' });
    expect(world.loop(id, { action: 'area.open', dungeonId: 'd-ember' }).ok).toBe(true);
    const again = runToCore(world, p.tokenId, id);
    expect(again.cleared?.first).toBe(false);
    expect(world.profiles.pool(p.tokenId, p.build).filter((c) => c === sig)).toHaveLength(1);
  });

  it('count toward the quest that names them, and no other', () => {
    const { world, p, id } = fresh(4034);
    toLevel(world, p.saveKey, 2);
    const doc = world.profiles.doc(p.tokenId);
    doc.quests['m-06'] = { progress: [0], done: false, turnedIn: false };
    doc.quests['m-10'] = { progress: [0], done: false, turnedIn: false };
    stand(p, anchor('a-fold'));
    world.loop(id, { action: 'area.open', dungeonId: 'd-ember' });
    runToCore(world, p.tokenId, id);
    expect(doc.quests['m-06']!.done).toBe(true);
    expect(doc.quests['m-10']!.done).toBe(false);
  });

  it('pay a room only once a field says something died in it', () => {
    const { world, p, id } = fresh(4040);
    toLevel(world, p.saveKey, 5);
    stand(p, anchor('a-fold'));
    expect(world.loop(id, { action: 'area.open', dungeonId: 'd-ember' }).ok).toBe(true);
    const route = routeToEnemy(world, p.saveKey);
    const nodeId = route[route.length - 1]!;
    walk(world, id, route);

    // `area.kill` is a message a client is free to send at any moment, and standing on a monster it
    // buys nothing: the run has been walked onto the tile, but nothing has died there.
    const forged = world.loop(id, { action: 'area.kill', damage: 0 });
    expect(forged.ok).toBe(false);
    expect(forged.reason).toMatch(/current field has not been cleared/);
    expect(world.profiles.doc(p.tokenId).run!.cleared).not.toContain(nodeId);

    // Arming alone is insufficient: SF must actually win the current field.
    expect(world.profiles.armNode(p.tokenId, nodeId)).toBe(true);
    expect(world.loop(id, { action: 'area.kill' }).ok).toBe(false);
    finishField(world, id);
    expect(world.profiles.doc(p.tokenId).run!.cleared).toContain(nodeId);

    // and the verdict is spent: one kill buys one room, not one room per click
    expect(world.loop(id, { action: 'area.kill' }).ok).toBe(false);
  });

  it('mirror one map into a party instead of seeding each of them a fold of their own', () => {
    const { world, host, other, inbox } = partyAtGate(4041, 4042);
    const opened = world.loop(host.id, { action: 'area.open', dungeonId: 'd-ember' });
    expect(opened.ok).toBe(true);
    const areaId = String((opened.area as { id: string }).id);

    const mine = world.profiles.doc(host.tokenId);
    const theirs = world.profiles.doc(other.tokenId);
    // One map, so the same node ids, so a fight on it keys one field rather than two that look alike.
    expect(theirs.area?.id).toBe(areaId);
    expect(theirs.area?.nodes.map((n) => n.id)).toEqual(mine.area!.nodes.map((n) => n.id));
    expect(theirs.area?.seed).toBe(mine.area!.seed);
    // and each of them their own run: their own integrity, their own route, their own share of the purse
    expect(theirs.run?.areaId).toBe(areaId);
    expect(theirs.run?.at).toBe(mine.run!.at);
    expect(theirs.run?.hp).toBeGreaterThan(0);
    expect(inbox.find((m) => m.kind === 'entered')).toMatchObject({ t: 'dungeon', name: 'EMBER FOUNDRY' });
  });

  it('take in a member who reaches the gate after the fold has opened, and tell the one who is late', () => {
    const { world, host, other, inbox } = partyAtGate(4043, 4044);
    // Late for the door: not standing where the party is when it goes in.
    other.x = anchor('a-fold').x + 60;
    const opened = world.loop(host.id, { action: 'area.open', dungeonId: 'd-ember' });
    const areaId = String((opened.area as { id: string }).id);
    expect(world.profiles.doc(other.tokenId).area).toBeNull();
    expect(inbox.find((m) => m.kind === 'refused')).toMatchObject({ reason: /same Fold Gate/ });

    // So they walk there and press the door themselves, and get the map their party is already on —
    // not a second fold seeded from their own token, which would split the party in silence.
    stand(other, anchor('a-fold'), -2);
    const late = world.loop(other.id, { action: 'area.open', dungeonId: 'd-ember' });
    expect(late.ok).toBe(true);
    expect((late.area as { id: string }).id).toBe(areaId);
    expect(world.profiles.doc(other.tokenId).area?.seed).toBe(world.profiles.doc(host.tokenId).area?.seed);
  });

  it('not carry a member through a door their own Chog has not unlocked', () => {
    const { world, host, other, inbox } = partyAtGate(4045, 4046);
    // The party's newest Chog: the fold stands open to its partner and shut to it.
    world.profiles.doc(other.tokenId).xp = 0;
    expect(world.loop(host.id, { action: 'area.open', dungeonId: 'd-ember' }).ok).toBe(true);
    expect(world.profiles.doc(other.tokenId).area).toBeNull();
    expect(inbox.find((m) => m.kind === 'refused')).toMatchObject({ reason: /opens at LV 2/ });
  });

  it('make the monster bigger and the purse heavier for every body on the tile', () => {
    const { world, host, other } = partyAtGate(4047, 4048);
    expect(world.loop(host.id, { action: 'area.open', dungeonId: 'd-ember' }).ok).toBe(true);
    const route = routeToEnemy(world, host.saveKey);
    const nodeId = route[route.length - 1]!;
    walk(world, host.id, route);
    walk(world, other.id, route);

    const field = world.sessionOf(host.id)!;
    expect(world.sessionOf(other.id)).toBe(field);
    expect(field.size).toBe(2);
    const enemy = world.profiles.areaEnemy(host.tokenId)!;
    expect(field.field.boss.maxHp).toBe(Math.round(enemy.hp * partyHpScale(2, 'node')));
    expect(field.hpScale).toBe(partyHpScale(2, 'node'));

    const area = world.profiles.doc(host.tokenId).area!;
    const node = area.nodes.find((n) => n.id === nodeId)!;
    const solo = soloXp(area.tier, node.kind);
    const before = { host: world.profiles.doc(host.tokenId).xp, other: world.profiles.doc(other.tokenId).xp };

    // The field's verdict is the only thing that pays a room, and the group's size is read off the
    // bodies standing on it rather than trusted from a message.
    finishField(world, host.id);

    const scale = partyRewardScale(2, 2);
    const gained = { host: world.profiles.doc(host.tokenId).xp - before.host, other: world.profiles.doc(other.tokenId).xp - before.other };
    expect(gained.host).toBe(Math.round(solo * scale));
    expect(gained.other).toBe(gained.host);
    // the claim in one line: a bigger fight that still pays each of them more than the same tile alone
    expect(scale).toBeGreaterThan(1);
    expect(gained.host).toBeGreaterThan(solo);
    expect(world.profiles.doc(host.tokenId).run!.cleared).toContain(nodeId);
    expect(world.profiles.doc(other.tokenId).run!.cleared).toContain(nodeId);
    expect(world.sessionOf(host.id)).toBeNull();
  });

  it('shrink back to a solo fight when the party splits, and pay nobody who walked off', () => {
    const { world, host, other } = partyAtGate(4049, 4050);
    expect(world.loop(host.id, { action: 'area.open', dungeonId: 'd-ember' }).ok).toBe(true);
    const route = routeToEnemy(world, host.saveKey);
    const nodeId = route[route.length - 1]!;
    walk(world, host.id, route);
    walk(world, other.id, route);

    const field = world.sessionOf(host.id)!;
    const enemy = world.profiles.areaEnemy(host.tokenId)!;
    expect(field.field.boss.maxHp).toBe(Math.round(enemy.hp * partyHpScale(2, 'node')));

    // Moving cannot silently abandon combat or skip an uncleared room.
    const area = world.profiles.doc(host.tokenId).area!;
    const by = new Map(area.nodes.map((n) => [n.id, n]));
    const here = by.get(nodeId)!;
    const away = here.links.map((id) => by.get(id)!).find((n) => !n.enemy) ?? by.get(here.links[0]!)!;
    const solo = soloXp(area.tier, here.kind);
    const before = world.profiles.doc(host.tokenId).xp;
    const otherXp = world.profiles.doc(other.tokenId).xp;
    expect(world.loop(other.id, { action: 'area.step', nodeId: away.id })).toMatchObject({
      ok: false, reason: 'leave or finish the current fight first',
    });
    world.duel(other.id, { t: 'duel', action: 'leave' });
    expect(world.loop(other.id, { action: 'area.step', nodeId: away.id })).toMatchObject({
      ok: false, reason: 'clear the current room before moving on',
    });

    // The bonus is earned by standing there, so it leaves with them: one body, the map's own number.
    expect(field.size).toBe(1);
    expect(field.field.boss.maxHp).toBe(enemy.hp);

    finishField(world, host.id);

    expect(world.profiles.doc(host.tokenId).xp - before).toBe(solo);
    expect(world.profiles.doc(host.tokenId).run!.cleared).toContain(nodeId);
    const theirs = world.profiles.doc(other.tokenId).run!;
    expect(theirs.at).toBe(nodeId);
    expect(world.profiles.doc(other.tokenId).xp).toBe(otherXp);
    // Leaving the field forfeits its reward even while the run stays on the tile; the room is still theirs
    // to fight, and the kill message they could have sent at any moment still buys them nothing.
    expect(theirs.cleared).not.toContain(nodeId);
    expect(theirs.armed).toBeNull();
    expect(world.loop(other.id, { action: 'area.kill' }).ok).toBe(false);
  });

  it('buys back a duplicate card at the counter instead of swallowing it', () => {
    const { world, p } = fresh(4060);
    const card = [...CARD_BY_ID.values()].find((c) => !c.klass)!;
    world.saves.setChips(p.tokenId, [card.id]);
    const wav = world.profiles.doc(p.tokenId).bag.wav;

    const res = world.profiles.grant(p.tokenId, { cards: [card.id] });
    // A second copy of a card this Chog can already field is not a collection, so nothing lands —
    // but a drop that is worth less than nothing teaches a player to stop opening chests.
    expect(res.cards).toEqual([]);
    expect(res.refunded).toEqual([{ id: card.id, name: card.name, wav: sellPrice(card) }]);
    // the same price the sell button pays, in the bag, on the spot
    expect(world.profiles.doc(p.tokenId).bag.wav).toBe(wav + sellPrice(card));
    expect(res.wav).toBe(sellPrice(card));
    expect(world.saves.get(p.tokenId).cards).toEqual([card.id]);
  });

  it('buys back what a full bag has no room for, and still makes room for a fusion', () => {
    const { world, p } = fresh(4061);
    const cap = world.profiles.unlocks(p.tokenId).bagCap;
    // The cap is a rule about ordinary cards, so the test fills the bag the same way the bag is filled.
    const ordinary = [...CARD_BY_ID.values()].filter((c) => !GA_BY_ID.has(c.id));
    const held = ordinary.slice(0, cap).map((c) => c.id);
    const loose = ordinary[cap]!;
    const fused = GA_CARDS[0]!;
    world.saves.setChips(p.tokenId, held);
    const wav = world.profiles.doc(p.tokenId).bag.wav;

    const res = world.profiles.grant(p.tokenId, { cards: [loose.id, fused.id] });
    // An ordinary card is held to the cap and paid for; a fused one is earned discovery and always fits.
    expect(res.refunded.map((r) => r.id)).toEqual([loose.id]);
    expect(res.cards).toEqual([fused.id]);
    expect(world.profiles.doc(p.tokenId).bag.wav).toBe(wav + sellPrice(loose));
    expect(world.saves.get(p.tokenId).cards).toEqual([...held, fused.id]);
  });

  it('pays a chest on the step, and buys back the card this Chog already holds', () => {
    const { world, p, id } = fresh(4062);
    const commons = [...CARD_BY_ID.values()].filter((c) => !c.klass);
    const dup = commons[0]!;
    const freshCard = commons[1]!;
    world.saves.setChips(p.tokenId, [dup.id]);

    // A generated fold only puts a chest where the seed happens to fall, so this map is written by
    // hand: three tiles, one of them a cache holding a card already in the collection and one new.
    const area: DataArea = {
      id: 'a-pair', name: 'TEST FOLD', tier: 1, seed: 1, sector: 'ashflat', rows: 3,
      entryId: '0-0', bossId: '2-0',
      nodes: [
        { id: '0-0', kind: 'gate', row: 0, col: 0, links: ['1-0'], label: 'MOUTH' },
        { id: '1-0', kind: 'chest', row: 1, col: 0, links: ['2-0'], label: 'CACHE', cards: [dup.id, freshCard.id] },
        { id: '2-0', kind: 'boss', row: 2, col: 0, links: [], label: 'GUARDIAN' },
      ],
    };
    const doc = world.profiles.doc(p.tokenId);
    doc.area = area;
    doc.run = startRun(area, 200);

    const before = { xp: doc.xp, wav: doc.bag.wav };
    const step = world.loop(id, { action: 'area.step', nodeId: '1-0' }) as unknown as {
      ok: boolean;
      outcome: { kind: string; xp: number; wav: number; cards: string[] };
      grant?: { xp: number; wav: number; cards: string[]; refunded: { id: string; name: string; wav: number }[] };
    };

    expect(step.ok).toBe(true);
    expect(step.outcome.kind).toBe('chest');
    const grant = step.grant!;
    expect(world.profiles.doc(p.tokenId).xp).toBe(before.xp + grant.xp);
    expect(world.profiles.doc(p.tokenId).bag.wav).toBe(before.wav + grant.wav);
    // the duplicate is money, so the purse pays more than the tile rolled and the bag holds only the new card
    expect(grant.wav).toBe(step.outcome.wav + sellPrice(dup));
    expect(grant.cards).toEqual([freshCard.id]);
    expect(grant.refunded).toEqual([{ id: dup.id, name: dup.name, wav: sellPrice(dup) }]);
    expect(world.saves.get(p.tokenId).cards).toEqual([dup.id, freshCard.id]);
  });

  it('show the end-of-fight plate what a room paid, refund and all', () => {
    const { world, p, id } = fresh(4064);
    const commons = [...CARD_BY_ID.values()].filter((c) => !c.klass);
    const dup = commons[0]!;
    const freshCard = commons[2]!;
    world.saves.setChips(p.tokenId, [dup.id]);

    // The same map written by hand, this time with something standing in it: only a field can issue
    // the kill a room is paid on, and the plate is built from what that kill answers with.
    const area: DataArea = {
      id: 'a-plate', name: 'TEST FOLD', tier: 1, seed: 1, sector: 'ashflat', rows: 2,
      entryId: '0-0', bossId: '1-0',
      nodes: [
        { id: '0-0', kind: 'gate', row: 0, col: 0, links: ['1-0'], label: 'MOUTH' },
        {
          id: '1-0', kind: 'wave', row: 1, col: 0, links: [], label: 'CONTACT',
          enemy: { name: 'TEST WAVE', element: 'burn', hp: 400, power: 8, archetype: 'spark' },
          cards: [dup.id, freshCard.id],
        },
      ],
    };
    const doc = world.profiles.doc(p.tokenId);
    doc.area = area;
    doc.run = startRun(area, 200);
    const purse = doc.bag.wav;

    const inbox: Record<string, unknown>[] = [];
    world.onPush(id, (m) => inbox.push(m));
    expect(world.loop(id, { action: 'area.step', nodeId: '1-0' }).ok).toBe(true);
    expect(world.loop(id, { action: 'area.engage' }).ok).toBe(true);

    finishField(world, id);

    const end = inbox.find((m) => m.kind === 'end') as {
      won: boolean; reason: string; xp: number; wav: number; cards: string[];
      refunded: { id: string; name: string; wav: number }[];
    };
    expect(end.won).toBe(true);
    expect(end.reason).toBe('cleared');
    expect(end.xp).toBeGreaterThan(0);
    expect(end.cards).toEqual([freshCard.id]);
    // the bought-back card is named on the receipt, so the purse reading bigger than the tile is not a mystery
    expect(end.refunded).toEqual([{ id: dup.id, name: dup.name, wav: sellPrice(dup) }]);
    expect(end.wav).toBe(world.profiles.doc(p.tokenId).bag.wav - purse);
  });

  it('count the humans behind the bodies on a tile, and say it out loud', () => {
    // Two Chogs off one wallet. The fight is still two bodies wide, but a party bonus one account
    // can farm by opening four tabs is not a party bonus — so the alt tax has to reach the plate.
    // One wallet also means one expedition: the second body reinforces the pending fight instead
    // of walking a run it already shares.
    const { world, host, other } = partyAtGate(4068, 4069, ['0xMINE', '0xMINE']);
    expect(world.loop(host.id, { action: 'area.open', dungeonId: 'd-ember' }).ok).toBe(true);
    const route = routeToEnemy(world, host.saveKey);
    walk(world, host.id, route);
    expect(world.loop(other.id, { action: 'area.engage' }).ok).toBe(true);

    const field = world.sessionOf(host.id)!;
    expect(field.partyScale).toEqual({
      bodies: 2,
      owners: 1,
      hp: partyHpScale(2, 'node'),
      loot: partyRewardScale(2, 1),
    });
    // one person in two seats: a bigger monster, and a purse lighter than a solo walk
    expect(field.partyScale.loot).toBeLessThan(1);
    expect(field.partyScale.loot).toBeLessThan(partyRewardScale(2, 2));

    // And the numbers are stated on the view rather than left to be guessed: `owners` is a question
    // about wallets, and a client is not allowed to know one.
    expect(field.view(host.id).party).toEqual({ bodies: 2, owners: 1, bands: 1 });
    expect(field.view(host.id).party.bodies).toBe(2);
  });

  it('pays a Card Pack whose three commons are all already held', () => {
    const { world, p } = fresh(4063);
    const commons = [...CARD_BY_ID.values()].filter((c) => !c.klass);
    world.saves.setChips(p.tokenId, commons.map((c) => c.id));
    world.profiles.grant(p.tokenId, { items: { pack: 1 } });
    const wav = world.profiles.doc(p.tokenId).bag.wav;

    const used = world.profiles.use(p.tokenId, 'pack');
    // Three commons from one bag is a roll with replacement, and this Chog holds every common there is.
    expect(used.ok).toBe(true);
    expect(used.effect?.cards).toEqual([]);
    expect(used.effect?.refunded?.length).toBe(3);
    const back = (used.effect?.refunded ?? []).reduce((s, r) => s + r.wav, 0);
    expect(world.profiles.doc(p.tokenId).bag.wav).toBe(wav + back);
    expect(back).toBeGreaterThan(0);
  });
});

describe('conversations and the journey', () => {
  it('turns a blank line in a quest into a page turn, so the Testnet Baby is a conversation and not a wall of text', () => {
    const { world, p, id } = fresh(4032);
    // finish the first quest so the Operator has the next one on offer
    stand(p, anchor('a-board'));
    world.loop(id, { action: 'quest.accept', questId: 'm-01', npcId: 'a-board' });
    stand(p, anchor('a-operator'));
    world.loop(id, { action: 'npc.talk', npcId: 'a-operator' });
    world.loop(id, { action: 'quest.turnin', questId: 'm-01', npcId: 'a-operator' });
    const talk = world.loop(id, { action: 'npc.talk', npcId: 'a-operator' }) as unknown as { talk: { pages: string[]; options: { id: string }[] } };
    expect(talk.talk.options.some((o) => o.id === 'accept:m-01b')).toBe(true);
    expect(talk.talk.pages.length).toBeGreaterThanOrEqual(4);
    expect(talk.talk.pages.every((pg) => pg.trim().length > 0 && !pg.includes('\n\n'))).toBe(true);
  });

  it('puts the main road in the profile: what is handed in, and the guide marks', () => {
    const { world, p, id } = fresh(4033);
    expect(world.profileFor(id)!.mainDone).toEqual([]);
    stand(p, anchor('a-board'));
    world.loop(id, { action: 'quest.accept', questId: 'm-01', npcId: 'a-board' });
    stand(p, anchor('a-operator'));
    world.loop(id, { action: 'npc.talk', npcId: 'a-operator' });
    world.loop(id, { action: 'quest.turnin', questId: 'm-01', npcId: 'a-operator' });
    expect(world.profileFor(id)!.mainDone).toEqual(['m-01']);
    expect(world.profileFor(id)!.flags).not.toContain('welcome');
    world.loop(id, { action: 'flag.set', flag: 'welcome' });
    expect(world.profileFor(id)!.flags).toContain('welcome');
  });
});

describe('places and doors', () => {
  it('finds a place on arrival, once, and counts it toward a quest', () => {
    const { world, p, id } = fresh(4020);
    const pushed: Record<string, unknown>[] = [];
    world.onPush(id, (m) => pushed.push(m));
    stand(p, anchor('a-board'));
    // The clock quest wants the lookout; take it from the Clockkeeper.
    stand(p, anchor('a-clock'));
    world.loop(id, { action: 'quest.accept', questId: 's-a-clock', npcId: 'a-clock' });
    const spot = anchor('a-vista');
    p.at = Date.now() - 1000;
    p.x = spot.x - 2;
    p.y = spot.z;
    world.move(id, { x: spot.x, y: spot.z });
    expect(pushed.some((m) => m.t === 'found' && m.id === 'a-vista')).toBe(true);
    expect(world.profileFor(id)!.discovered).toContain('a-vista');
    expect(world.profileFor(id)!.quests.find((q) => q.id === 's-a-clock')!.done).toBe(true);
    // Stepping out and back in does not pay twice.
    pushed.length = 0;
    p.at = Date.now() - 1000;
    world.move(id, { x: spot.x + 30, y: spot.z });
    p.x = spot.x + 30;
    p.at = Date.now() - 1000;
    world.move(id, { x: spot.x, y: spot.z });
    expect(pushed.filter((m) => m.t === 'found')).toHaveLength(0);
  });

  it('counts "go into the shop" only when you are at the door', () => {
    const { world, p, id } = fresh(4021);
    stand(p, anchor('a-courier'), 80);
    expect(world.loop(id, { action: 'door.enter', door: 'shop' }).ok).toBe(false);
    stand(p, anchor('a-card'), 0);
    expect(world.loop(id, { action: 'door.enter', door: 'shop' }).ok).toBe(true);
  });
});

describe('mystery waves', () => {
  const waves = city.anchors.filter((a) => a.kind === 'wave');

  it('pays once a day per wave, and refuses one you are not standing at', () => {
    const { world, p, id } = fresh(4030);
    const w = waves[0]!;
    stand(p, anchor('a-courier'), 80);
    expect(world.loop(id, { action: 'wave.collect', waveId: w.id }).ok).toBe(false);
    p.x = w.x;
    p.y = w.z;
    const before = world.profileFor(id)!.wav;
    const first = world.loop(id, { action: 'wave.collect', waveId: w.id });
    expect(first.ok).toBe(true);
    expect(world.profileFor(id)!.wav).toBeGreaterThan(before);
    expect(world.loop(id, { action: 'wave.collect', waveId: w.id }).ok).toBe(false);
    expect(world.profileFor(id)!.caught).toContain(w.id);
  });

  it('pays the same for the same token, wave and day: it is a roll, not a gift', () => {
    const a = fresh(4031);
    const b = fresh(4031);
    const w = waves[1]!;
    for (const x of [a, b]) {
      x.p.x = w.x;
      x.p.y = w.z;
    }
    const ra = a.world.loop(a.id, { action: 'wave.collect', waveId: w.id }) as unknown as { wav: number };
    const rb = b.world.loop(b.id, { action: 'wave.collect', waveId: w.id }) as unknown as { wav: number };
    expect(ra.wav).toBe(rb.wav);
  });
});

describe('area.draft — the 1-of-3 pick', () => {
  // A fold with one wave in it, walked the honest way: step, engage, win. After the kill
  // the run parks 3 dealt cards; `area.draft` takes exactly one of them into the collection.
  function runToWaveDraft(token: number) {
    const { world, p, id } = fresh(token);
    const area: DataArea = {
      id: 'a-draft', name: 'TEST DRAFT', tier: 1, seed: 7, sector: 'ashflat', rows: 2,
      entryId: '0-0', bossId: '1-0',
      nodes: [
        { id: '0-0', kind: 'gate', row: 0, col: 0, links: ['1-0'], label: 'MOUTH' },
        {
          id: '1-0', kind: 'wave', row: 1, col: 0, links: [], label: 'CONTACT',
          enemy: { name: 'TEST WAVE', element: 'burn', hp: 400, power: 8, archetype: 'spark' },
        },
      ],
    };
    const doc = world.profiles.doc(p.tokenId);
    doc.area = area;
    doc.run = startRun(area, 200);
    expect(world.loop(id, { action: 'area.step', nodeId: '1-0' }).ok).toBe(true);
    expect(world.loop(id, { action: 'area.engage' }).ok).toBe(true);
    finishField(world, id);
    return { world, p, id };
  }

  it('takes 1 of the 3 dealt cards into the pool and parks nothing after', () => {
    const { world, p, id } = runToWaveDraft(4071);
    const parked = world.profiles.doc(p.tokenId).run!.draft!;
    expect(parked.options.length).toBe(3);
    // Ownership, not the build-filtered pool: a drafted card of the banned element is still
    // owned, just not fieldable by this Chog.
    const before = world.saves.get(p.tokenId).cards;
    expect(before).not.toContain(parked.options[0]);
    const res = world.loop(id, { action: 'area.draft', card: parked.options[0] });
    expect(res.ok).toBe(true);
    // The sheet repaints off the reply, so the fresh run rides along and the panel clears itself.
    expect((res.run as { draft: null } | undefined)?.draft).toBeNull();
    expect(world.saves.get(p.tokenId).cards).toContain(parked.options[0]);
    expect(world.profiles.doc(p.tokenId).run!.draft).toBeNull();
    // The other two offers evaporate with the pick — no second serving.
    expect(world.loop(id, { action: 'area.draft', card: parked.options[1] }).ok).toBe(false);
  });

  it('refuses a card it never dealt', () => {
    const { world, p, id } = runToWaveDraft(4072);
    const parked = world.profiles.doc(p.tokenId).run!.draft!;
    const before = world.saves.get(p.tokenId).cards.slice();
    const res = world.loop(id, { action: 'area.draft', card: 'nope-not-a-card' });
    expect(res.ok).toBe(false);
    expect(world.saves.get(p.tokenId).cards).toEqual(before);
    // The real offer still waits after a wrong name.
    expect(world.profiles.doc(p.tokenId).run!.draft!.options).toEqual(parked.options);
  });

  it('refuses when no combat node dealt anything', () => {
    const { world, id } = fresh(4073);
    expect(world.loop(id, { action: 'area.draft', card: 'c-ember-1' })).toMatchObject({ ok: false });
  });
});

describe('area.shrine — the rest thins the deck', () => {
  // A fold with one shrine in it, walked the honest way: step, rest. The step heals and
  // parks the rest; `area.shrine` thins exactly one held card, never a signature.
  function runToShrineRest(token: number) {
    const { world, p, id } = fresh(token);
    const area: DataArea = {
      id: 'a-shrine', name: 'TEST REST', tier: 1, seed: 9, sector: 'ashflat', rows: 2,
      entryId: '0-0', bossId: '1-0',
      nodes: [
        { id: '0-0', kind: 'gate', row: 0, col: 0, links: ['1-0'], label: 'MOUTH' },
        { id: '1-0', kind: 'shrine', row: 1, col: 0, links: [], label: 'RELAY' },
      ],
    };
    const doc = world.profiles.doc(p.tokenId);
    doc.area = area;
    doc.run = startRun(area, 200);
    const held = [...CARD_BY_ID.values()].filter((c) => !c.klass && !c.signature);
    world.saves.setChips(p.tokenId, [p.build.signature, held[0]!.id, held[1]!.id]);
    expect(world.loop(id, { action: 'area.step', nodeId: '1-0' }).ok).toBe(true);
    return { world, p, id, sig: p.build.signature, first: held[0]!.id, second: held[1]!.id };
  }

  it('removes one held copy, parks nothing after, and pays no WAV', () => {
    const { world, p, id, first, second, sig } = runToShrineRest(4081);
    expect(world.profiles.doc(p.tokenId).run!.shrine).toEqual({ nodeId: '1-0' });
    const purse = world.profiles.doc(p.tokenId).bag.wav;
    const res = world.loop(id, { action: 'area.shrine', card: first });
    expect(res.ok).toBe(true);
    expect(world.saves.get(p.tokenId).cards).toEqual([sig, second]);
    expect(world.profiles.doc(p.tokenId).bag.wav).toBe(purse);
    expect(world.profiles.doc(p.tokenId).run!.shrine).toBeNull();
    // The sheet repaints off the reply, so the fresh run rides along.
    expect((res.run as { shrine: null } | undefined)?.shrine).toBeNull();
    // One rest, one thinning — no second serving.
    expect(world.loop(id, { action: 'area.shrine', card: second }).ok).toBe(false);
  });

  it('refuses a signature card and keeps the rest waiting', () => {
    const { world, p, id, sig, first, second } = runToShrineRest(4082);
    const before = world.saves.get(p.tokenId).cards.slice();
    expect(before).toEqual([sig, first, second]);
    const res = world.loop(id, { action: 'area.shrine', card: sig });
    expect(res.ok).toBe(false);
    expect(world.saves.get(p.tokenId).cards).toEqual(before);
    expect(world.profiles.doc(p.tokenId).run!.shrine).toEqual({ nodeId: '1-0' });
  });

  it('refuses a card never held, and a rest never taken', () => {
    const { world, p, id } = runToShrineRest(4083);
    const before = world.saves.get(p.tokenId).cards.slice();
    expect(world.loop(id, { action: 'area.shrine', card: 'nope-not-a-card' }).ok).toBe(false);
    expect(world.saves.get(p.tokenId).cards).toEqual(before);
    expect(world.profiles.doc(p.tokenId).run!.shrine).toEqual({ nodeId: '1-0' });
    const cold = fresh(4084);
    expect(cold.world.loop(cold.id, { action: 'area.shrine', card: before[0] }).ok).toBe(false);
  });
});

describe('pvp — brawl on one field', () => {
  // Two Chogs on the street, both listening, so the challenge, the field and the
  // story it tells are all checkable.
  function twoOnStreet(aToken: number, bToken: number) {
    const world = new World();
    const a = world.join('p' + aToken, { tokenId: aToken, transferCount: 0, daysHeld: 0 }, 'ashflat');
    const b = world.join('p' + bToken, { tokenId: bToken, transferCount: 0, daysHeld: 0 }, 'ashflat');
    const inboxA: Record<string, unknown>[] = [];
    const inboxB: Record<string, unknown>[] = [];
    world.onPush(a.id, (m) => inboxA.push(m));
    world.onPush(b.id, (m) => inboxB.push(m));
    return { world, a, b, inboxA, inboxB };
  }

  it('carries a challenge to the street and steps both boots onto one field', () => {
    const { world, a, b, inboxA, inboxB } = twoOnStreet(4091, 4092);
    world.pvpAction(a.id, { action: 'challenge', with: b.id });
    expect(inboxB.find((m) => m.t === 'pvp' && m.challenge)).toMatchObject({
      challenge: { from: a.id, name: a.build.callsign },
    });
    expect(inboxA.find((m) => m.t === 'pvp' && m.notice)).toBeTruthy();
    world.pvpAction(b.id, { action: 'accept' });
    const field = world.sessions.get(`pvp:${a.id}:${b.id}`);
    expect(field).toBeTruthy();
    expect(field!.spec.pvp).toBe(true);
    expect(field!.size).toBe(2);
    expect(field!.brawl).toMatchObject({ rivalId: b.id, challengerName: a.build.callsign });
    expect(a.inBattle).toBe(true);
    expect(b.inBattle).toBe(true);
    expect(inboxB.find((m) => m.t === 'pvp' && typeof m.notice === 'string' && String(m.notice).includes('stepped in'))).toBeTruthy();
    expect(inboxA.find((m) => m.t === 'pvp' && typeof m.notice === 'string' && String(m.notice).includes('the bout is on'))).toBeTruthy();
  });

  it('tells the challenger when the bout is refused', () => {
    const { world, a, b, inboxA } = twoOnStreet(4093, 4094);
    world.pvpAction(a.id, { action: 'challenge', with: b.id });
    world.pvpAction(b.id, { action: 'decline' });
    expect(inboxA.find((m) => m.t === 'pvp' && m.declined)).toMatchObject({ declined: b.build.callsign });
    expect(world.sessions.get(`pvp:${a.id}:${b.id}`)).toBeUndefined();
  });

  it('refuses yourself, the gone, the busy, and the unchallenged', () => {
    const { world, a, b, inboxA } = twoOnStreet(4095, 4096);
    world.pvpAction(a.id, { action: 'challenge', with: a.id });
    world.pvpAction(a.id, { action: 'challenge', with: 'nobody-here' });
    expect(inboxA.filter((m) => m.t === 'pvp' && m.refused).length).toBe(2);
    a.inBattle = true;
    world.pvpAction(a.id, { action: 'challenge', with: b.id });
    expect(inboxA.filter((m) => m.t === 'pvp' && m.refused).length).toBe(3);
    a.inBattle = false;
    world.pvpAction(b.id, { action: 'accept' });
    expect(world.sessions.get(`pvp:${a.id}:${b.id}`)).toBeUndefined();
    world.pvpAction(a.id, { action: 'challenge', with: b.id });
    b.inBattle = true;
    world.pvpAction(b.id, { action: 'accept' });
    expect(world.sessions.get(`pvp:${a.id}:${b.id}`)).toBeUndefined();
  });

  it('locks both stakes on accept and names the price on the street', () => {
    const { world, a, b, inboxA, inboxB } = twoOnStreet(4201, 4202);
    world.pvpAction(a.id, { action: 'challenge', with: b.id, wager: 100 });
    expect(inboxB.find((m) => m.t === 'pvp' && m.challenge)).toMatchObject({
      challenge: { from: a.id, wager: 100 },
    });
    expect(inboxA.find((m) => m.t === 'pvp' && typeof m.notice === 'string' && String(m.notice).includes('100 $CHOG'))).toBeTruthy();
    world.pvpAction(b.id, { action: 'accept' });
    expect(world.sessions.get(`pvp:${a.id}:${b.id}`)?.brawl).toMatchObject({ wager: 100 });
    expect(world.profiles.chogOf(a.tokenId)).toBe(900);
    expect(world.profiles.chogOf(b.tokenId)).toBe(900);
  });

  it('pays the winner minus the rake when the challenger wins', () => {
    const { world, a, b, inboxA, inboxB } = twoOnStreet(4211, 4212);
    const vaultBefore = world.profiles.vaultChog();
    world.pvpAction(a.id, { action: 'challenge', with: b.id, wager: 100 });
    world.pvpAction(b.id, { action: 'accept' });
    finishPvp(world, a.id);
    // 200 locked, 10 raked, 190 to the winner: money is conserved.
    expect(world.profiles.chogOf(a.tokenId)).toBe(1090);
    expect(world.profiles.chogOf(b.tokenId)).toBe(900);
    expect(world.profiles.vaultChog()).toBe(vaultBefore + 10);
    expect(inboxB.find((m) => m.t === 'pvp' && m.result)).toMatchObject({
      result: { winnerId: a.id, prize: 190, rake: 10 },
    });
    expect(inboxA.find((m) => m.t === 'pvp' && m.result)).toMatchObject({
      result: { winnerId: a.id, prize: 190 },
    });
  });

  it('pays the rival when the challenger walks out', () => {
    const { world, a, b, inboxA, inboxB } = twoOnStreet(4221, 4222);
    const vaultBefore = world.profiles.vaultChog();
    world.pvpAction(a.id, { action: 'challenge', with: b.id, wager: 100 });
    world.pvpAction(b.id, { action: 'accept' });
    world.duelLeave(a.id);
    expect(world.profiles.chogOf(a.tokenId)).toBe(900);
    expect(world.profiles.chogOf(b.tokenId)).toBe(1090);
    expect(world.profiles.vaultChog()).toBe(vaultBefore + 10);
    expect(inboxB.find((m) => m.t === 'pvp' && m.result)).toMatchObject({
      result: { winnerId: b.id, prize: 190 },
    });
    const fled = inboxA.find((m) => m.t === 'pvp' && m.result) as { result: { story: string } } | undefined;
    expect(fled?.result.story).toContain('fled');
  });

  it('refuses a price either side cannot cover, locking nothing', () => {
    const { world, a, b, inboxA, inboxB } = twoOnStreet(4231, 4232);
    world.pvpAction(a.id, { action: 'challenge', with: b.id, wager: 2000 });
    expect(inboxA.find((m) => m.t === 'pvp' && m.refused)).toMatchObject({ refused: 'you cannot cover that' });
    expect(world.profiles.addChog(b.tokenId, -950)).toBe(true);
    world.pvpAction(a.id, { action: 'challenge', with: b.id, wager: 100 });
    world.pvpAction(b.id, { action: 'accept' });
    expect(inboxB.find((m) => m.t === 'pvp' && m.refused)).toMatchObject({ refused: 'you cannot cover that' });
    expect(world.sessions.get(`pvp:${a.id}:${b.id}`)).toBeUndefined();
    expect(world.profiles.chogOf(a.tokenId)).toBe(1000);
    expect(world.profiles.chogOf(b.tokenId)).toBe(50);
  });

  it('leaves the ledger alone for an honor brawl', () => {
    const { world, a, b } = twoOnStreet(4241, 4242);
    const vaultBefore = world.profiles.vaultChog();
    world.pvpAction(a.id, { action: 'challenge', with: b.id });
    world.pvpAction(b.id, { action: 'accept' });
    world.duelLeave(a.id);
    expect(world.profiles.chogOf(a.tokenId)).toBe(1000);
    expect(world.profiles.chogOf(b.tokenId)).toBe(1000);
    expect(world.profiles.vaultChog()).toBe(vaultBefore);
  });

  it('refuses a debit past zero without moving anything', () => {
    const { world, a } = twoOnStreet(4251, 4252);
    expect(world.profiles.addChog(a.tokenId, -1001)).toBe(false);
    expect(world.profiles.chogOf(a.tokenId)).toBe(1000);
  });
});

describe('trade — cards and items across the street', () => {
  function twoTraders(t1: number, t2: number) {
    const { world, p } = fresh(t1);
    const q = world.join(`p${t2}`, { tokenId: t2, transferCount: 0, daysHeld: 0 }, 'ashflat');
    world.saves.setChips(p.tokenId, [p.build.signature, 'emberpaw']);
    world.saves.setChips(q.tokenId, [q.build.signature, 'arcsnap']);
    // The player carries a snapshot from join; the trade reads the snapshot.
    p.save = world.saves.get(p.tokenId);
    q.save = world.saves.get(q.tokenId);
    world.profiles.grant(q.tokenId, { items: { amp: 1 } });
    return { world, a: p, b: q };
  }

  it('moves a card and items to the other bag on accept', () => {
    const { world, a, b } = twoTraders(4101, 4102);
    const offered = world.tradeOffer(a.id, b.id, ['emberpaw'], ['arcsnap'], ['med'], ['amp']);
    expect(offered.ok).toBe(true);
    const r = world.tradeAccept(b.id, offered.offer!.id);
    expect(r.ok).toBe(true);
    expect(world.saves.get(a.tokenId).cards).toContain('arcsnap');
    expect(world.saves.get(a.tokenId).cards).not.toContain('emberpaw');
    expect(world.saves.get(b.tokenId).cards).toContain('emberpaw');
    expect(world.profiles.doc(a.tokenId).bag.items.med).toBe(1);
    expect(world.profiles.doc(a.tokenId).bag.items.amp).toBe(1);
    expect(world.profiles.doc(b.tokenId).bag.items.med).toBe(3);
    expect(world.profiles.doc(b.tokenId).bag.items.amp).toBe(0);
  });

  it('refuses to put a signature on the table', () => {
    const { world, a, b } = twoTraders(4111, 4112);
    expect(world.tradeOffer(a.id, b.id, [a.build.signature], [], [], [])).toMatchObject({
      ok: false,
      reason: 'your signature card cannot be traded',
    });
    expect(world.tradeOffer(a.id, b.id, [], [b.build.signature], [], [])).toMatchObject({
      ok: false,
      reason: 'their signature card cannot be traded',
    });
  });

  it('re-checks the signature at accept time', () => {
    // A stale offer planted before the guard existed still cannot cross.
    const { world, a, b } = twoTraders(4121, 4122);
    const t = world.social.offer(a.id, b.id, [a.build.signature], []);
    expect(world.tradeAccept(b.id, t.id)).toMatchObject({
      ok: false,
      reason: 'a signature card cannot be traded',
    });
  });

  it('refuses unknown ids and empty offers', () => {
    const { world, a, b } = twoTraders(4131, 4132);
    expect(world.tradeOffer(a.id, b.id, ['nope-not-a-card'], [], [], []).ok).toBe(false);
    expect(world.tradeOffer(a.id, b.id, [], [], ['nope-not-an-item'], []).ok).toBe(false);
    expect(world.tradeOffer(a.id, b.id, [], [], [], [])).toMatchObject({
      ok: false,
      reason: 'an empty offer trades nothing',
    });
  });

  it('refuses a short bag without half-paying', () => {
    const { world, a, b } = twoTraders(4141, 4142);
    const before = { ...world.profiles.doc(a.tokenId).bag.items };
    expect(world.profiles.moveItems(a.tokenId, b.tokenId, ['amp'], [])).toBe(false);
    expect(world.profiles.doc(a.tokenId).bag.items).toEqual(before);
    expect(world.profiles.doc(b.tokenId).bag.items.amp ?? 0).toBe(1);
  });

  it('refuses a card either side already holds', () => {
    const { world, a, b } = twoTraders(4151, 4152);
    expect(world.tradeOffer(a.id, b.id, [], ['emberpaw'], [], [])).toMatchObject({
      ok: false,
      reason: 'you already hold one of those',
    });
    world.saves.setChips(b.tokenId, [b.build.signature, 'arcsnap', 'emberpaw']);
    b.save = world.saves.get(b.tokenId);
    expect(world.tradeOffer(a.id, b.id, ['emberpaw'], [], [], [])).toMatchObject({
      ok: false,
      reason: 'they already hold one of those',
    });
  });

  it('re-checks dupes at accept time', () => {
    const { world, a, b } = twoTraders(4161, 4162);
    world.saves.setChips(b.tokenId, [b.build.signature, 'arcsnap', 'emberpaw']);
    b.save = world.saves.get(b.tokenId);
    const t = world.social.offer(a.id, b.id, [], ['emberpaw']);
    expect(world.tradeAccept(b.id, t.id)).toMatchObject({
      ok: false,
      reason: 'someone already holds one of those',
    });
  });

  it('refuses trait cards on either side of the table', () => {
    const { world, a, b } = twoTraders(4171, 4172);
    world.saves.setChips(a.tokenId, [a.build.signature, 'emberpaw', 'v_bubblegum']);
    a.save = world.saves.get(a.tokenId);
    expect(world.tradeOffer(a.id, b.id, ['v_bubblegum'], [], [], [])).toMatchObject({
      ok: false,
      reason: 'trait cards cannot be traded',
    });
    expect(world.tradeOffer(a.id, b.id, [], ['v_rainfall'], [], [])).toMatchObject({
      ok: false,
      reason: 'trait cards cannot be traded',
    });
    const t = world.social.offer(a.id, b.id, [], ['v_rainfall']);
    expect(world.tradeAccept(b.id, t.id)).toMatchObject({
      ok: false,
      reason: 'trait cards cannot be traded',
    });
  });
});
