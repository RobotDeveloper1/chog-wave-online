import { describe, expect, it } from 'vitest';
import {
  ALBUM_TOTAL,
  CHIP_BY_ID,
  ITEMS,
  LEVEL_CAP,
  advanceRun,
  albumStat,
  applyEvent,
  areaTierUnlocked,
  board,
  bountiesFor,
  buy,
  canEnter,
  canSell,
  chipPrice,
  chipValue,
  controlOf,
  credit,
  emptyLedger,
  emptyBag,
  offeredQuests,
  priceFactor,
  progressOf,
  rarityBias,
  rarityWeight,
  rowsOf,
  sellPrice,
  sight,
  startRun,
  stockForChips,
  stockForSupply,
  turnIn,
  unlocksAt,
  wavForClear,
  xpForClear,
  xpToLevel,
  LEVEL_AFFECTS,
  STORY,
  QUEST_BY_ID,
  albumKey,
  keysOfSource,
  categoryPrize,
  pendingCompletions,
  markClaimed,
  emptyAlbum,
  pointsForClear,
  sectorMultiplier,
  weeklyPrizes,
  freshState,
  sweepBounties,
  makeArea,
  nodeById,
  FUN,
  SF,
  dpsProfile,
  sampleProgram,
  rng,
  nodeBudget,
  attritionFor,
  powerForCost,
  volleyPeriodSeconds,
  runPlan,
  pacingVerdicts,
  pacingReport,
  audienceBand,
  bossWindow,
  expectedDps,
  nodeWindow,
  refLevel,
  partyRewardScale,
  type Bag,
  type QuestLog,
  type SectorId,
  type Unlocks,
} from '../src/index.ts';

/**
 * XP, WAV and tribe points all take the same `scale` argument now — `partyRewardScale`. The three
 * files used to carry their own pile-on tax, which is how a design ends up with three answers to
 * "what is a party worth". This is the one table they are all checked against.
 */
const payouts = (size: number, owners: number) => {
  const scale = partyRewardScale(size, owners);
  return { scale, xp: xpForClear('storm', 0, scale), wav: wavForClear('anomaly', scale), pts: pointsForClear('anomaly', scale) };
};

describe('progression', () => {
  it('has a monotonic curve that reaches the cap without overflow', () => {
    for (let l = 2; l <= LEVEL_CAP; l++) {
      expect(xpToLevel(l)).toBeGreaterThan(xpToLevel(l - 1));
    }
    expect(progressOf(0).level).toBe(1);
    expect(progressOf(1e9).level).toBe(LEVEL_CAP);
  });

  it('buys breadth, never height — levels add no damage term', () => {
    const a = unlocksAt(1);
    const b = unlocksAt(LEVEL_CAP);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    // Anything numeric that moves must be a field the progression file documents.
    const moved = (Object.keys(a) as (keyof Unlocks)[]).filter(
      (k) => typeof a[k] === 'number' && a[k] !== b[k],
    );
    expect(moved.length).toBeGreaterThan(0);
    for (const k of moved) expect(LEVEL_AFFECTS).toContain(k);
    expect(b.queueSlots).toBeGreaterThan(a.queueSlots);
    expect(b.areaTier).toBe(4);
  });

  it('keeps a low-level player out of high tiers', () => {
    expect(areaTierUnlocked(1)).toBe(0);
    expect(areaTierUnlocked(3)).toBe(1);
    expect(areaTierUnlocked(30)).toBe(4);
  });

  it('discourages splitting a kill across alts', () => {
    const solo = payouts(1, 1);
    // Four boxes on one wallet: every one of them progresses *slower* than the single account
    // that player could have logged into and played themselves.
    const alt = payouts(4, 1);
    expect(alt.xp).toBeLessThan(solo.xp);
    expect(alt.wav).toBeLessThan(solo.wav);
    expect(alt.pts).toBeLessThan(solo.pts);
    // Four humans get the opposite answer, which is the entire point of counting owners.
    const party = payouts(4, 4);
    expect(party.xp).toBeGreaterThan(solo.xp);
    expect(party.wav).toBeGreaterThan(solo.wav);
    expect(party.pts).toBeGreaterThan(solo.pts);
    expect(partyRewardScale(4, 1)).toBeLessThan(partyRewardScale(4, 4));
    expect(xpForClear('storm', 1e9)).toBe(xpForClear('storm', 40_000));
  });
});

describe('economy', () => {
  it('prices stay inside the designed band as the floor moves', () => {
    expect(priceFactor({ mon: 0 })).toBe(0.75);
    expect(priceFactor({ mon: 1e12 })).toBe(2.2);
    expect(priceFactor({ mon: 3000 })).toBeGreaterThan(1);
    expect(rarityBias({ mon: 0 })).toBe(0);
    expect(rarityBias({ mon: 1e9 })).toBeLessThanOrEqual(0.85);
  });

  it('never lets a purchase be turned back into more money than it cost', () => {
    for (const line of stockForChips(7, { mon: 0 }, 'voltgrid')) {
      const c = CHIP_BY_ID.get(line.stockId);
      if (!c) continue;
      // Cheapest possible shelf price vs the best possible resale.
      expect(sellPrice(c)).toBeLessThan(chipPrice(c, 0.75));
    }
  });

  it('generates the same shelf for the same seed and a different one for a new day', () => {
    const a = stockForChips(12, { mon: 4000 }, 'ashflat').map((l) => l.stockId);
    const b = stockForChips(12, { mon: 4000 }, 'ashflat').map((l) => l.stockId);
    const c = stockForChips(13, { mon: 4000 }, 'ashflat').map((l) => l.stockId);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('only ever stocks cards that exist', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const line of stockForChips(seed, { mon: 900 }, 'hollow')) {
        expect(CHIP_BY_ID.has(line.stockId)).toBe(true);
      }
    }
  });

  it('refuses what it should and only what it should', () => {
    const line = stockForChips(3, { mon: 100 }, 'ashflat')[0]!;
    const broke: Bag = emptyBag(1);
    expect(buy(line, broke, []).ok).toBe(false);
    const rich: Bag = emptyBag(100_000);
    expect(buy(line, rich, []).ok).toBe(true);
    if (buy(line, rich, []).ok) {
      const res = buy(line, rich, []);
      if (res.ok) expect(res.bag.wav).toBe(rich.wav - line.price);
    }
    // A unique reserve cannot be bought twice.
    const wardLine = stockForSupply(1, { mon: 100 }).find((l) => l.stockId === 'ward')!;
    const withWard: Bag = { wav: 100_000, items: { ward: 1 } };
    expect(buy(wardLine, withWard, []).ok).toBe(false);
  });

  it('will not buy back a Chog signature card from its own owner', () => {
    const sig = [...CHIP_BY_ID.values()].find((c) => c.signature)?.id ?? 'emberpaw';
    expect(canSell(CHIP_BY_ID.get(sig)!, [sig])).toBe(false);
  });

  it('pays the party once, on the party table', () => {
    const solo = payouts(1, 1);
    const party = payouts(4, 4);
    const alt = payouts(4, 1);
    // A body is worth less than a human, and a lone wolf stays the floor of the scale.
    expect(alt.scale).toBeLessThan(party.scale);
    expect(payouts(1, 1).scale).toBe(1);
    // The scale is only allowed to move the number, never to replace the table: WAV, XP and tribe
    // points all stay in the same proportion they do solo.
    expect(party.wav / solo.wav).toBeCloseTo(party.scale, 1);
    expect(party.pts / solo.pts).toBeCloseTo(party.scale, 1);
    // A party of four humans is a better time, not a mint: per head it is a bonus, not a multiple.
    expect(party.scale).toBeLessThan(2);
  });

  it('every item the shop sells can be spent and counted', () => {
    let bag: Bag = emptyBag(0);
    for (const id of Object.keys(ITEMS) as (keyof typeof ITEMS)[]) {
      bag = { ...bag, items: { ...bag.items, [id]: (bag.items[id] ?? 0) + 1 } };
    }
    expect(Object.keys(bag.items)).toHaveLength(Object.keys(ITEMS).length);
  });
});

describe('chip pricing', () => {
  it('never lets a void card collapse to the floor price', () => {
    // Negative waveDrain is a liability, not a discount code: every void card used to
    // price at the 15 WAV minimum because the drain factor went sub-zero.
    const voids = [...CHIP_BY_ID.values()].filter((c) => c.waveDrain < 0);
    expect(voids.length).toBeGreaterThan(0);
    for (const c of voids) {
      expect(chipValue(c)).toBeGreaterThan(c.power * Math.max(1, c.hits) * 0.3);
      expect(chipPrice(c, 0.75)).toBeGreaterThan(15);
    }
  });

  it('prices stronger cards higher, whatever their element', () => {
    const weak = CHIP_BY_ID.get('emberpaw')!;
    const strong = CHIP_BY_ID.get('signaldeath')!;
    expect(chipValue(strong)).toBeGreaterThan(chipValue(weak));
  });
});

describe('a brand-new token', () => {
  it('does not start at mid-level just by existing', () => {
    // Logging its own 13 trait values is the Album floor, not a head start: the first
    // gates (queue slot at 6, Delta at 3) have to be earned by playing.
    const keys = keysOfSource({
      Aura: 'Purple', Background: 'Mon', Skin: 'Pink', Side: 'Left', Body: 'Tuxedo',
      Mouth: 'Sad', Eyes: 'Dead', Head: 'Balls Cap', Accessory: 'Knife', Form: 'Chog',
      Tier: 'Common', Naked: 'No', Base: 'Skull',
    });
    expect(keys.length).toBe(13);
    const res = sight([], keys);
    expect(progressOf(res.xp).level).toBeLessThanOrEqual(3);
  });
});

describe('quests', () => {
  const first = STORY[0]!;

  it('gates the chain on the previous hand-in', () => {
    let log: QuestLog = {};
    expect(offeredQuests(log).map((q) => q.id)).toEqual([first.id]);
    log = { [first.id]: { ...freshState(first), done: true, turnedIn: true } };
    expect(offeredQuests(log).map((q) => q.id)).toEqual([STORY[1]!.id]);
  });

  it('filters objectives by the sector they name', () => {
    const def = { ...first, objectives: [{ kind: 'clear' as const, need: 2, sector: 'ashflat' as const }] };
    const wrong = applyEvent({}, def, { type: 'clear', sector: 'hollow' }).state.progress[0];
    const right = applyEvent({}, def, { type: 'clear', sector: 'ashflat' }).state.progress[0];
    const unspoken = applyEvent({}, def, { type: 'clear' }).state.progress[0];
    expect(wrong).toBe(0);
    expect(right).toBe(1);
    expect(unspoken).toBe(1);
  });

  it('pays exactly once per quest', () => {
    let log: QuestLog = { [first.id]: freshState(first) };
    // A named objective only counts at its name, so the event has to say where it happened.
    for (const o of first.objectives) {
      log = { ...log, [first.id]: applyEvent(log, first, { type: o.kind, ...(o.target ? { target: o.target } : {}) }).state };
    }
    const got = turnIn(log, first.id);
    expect(got.ok).toBe(true);
    expect(got.wav).toBe(first.reward.wav);
    expect(got.xp).toBeGreaterThan(0);
    expect(turnIn(got.log, first.id).ok).toBe(false);
  });

  it('does not complete on a partial objective', () => {
    const log: QuestLog = { [first.id]: applyEvent({}, first, { type: 'clear' }).state };
    expect(log[first.id]!.done).toBe(false);
    expect(turnIn(log, first.id).ok).toBe(false);
  });

  it('sweeps yesterday bounties and keeps today', () => {
    const now = Date.UTC(2026, 9, 9, 12);
    const today = bountiesFor(now, ['ashflat'])[0]!;
    const log: QuestLog = {
      [today.id]: freshState(today, Math.floor(now / 86_400_000)),
      'old-bounty': freshState(today, Math.floor(now / 86_400_000) - 1),
    };
    const clean = sweepBounties(log, now);
    expect(Object.keys(clean)).toEqual([today.id]);
  });

  it('gives a bounty for every sector, each day, deterministically', () => {
    const a = bountiesFor(Date.UTC(2026, 9, 9), ['ashflat', 'voltgrid', 'hollow']);
    const b = bountiesFor(Date.UTC(2026, 9, 9), ['ashflat', 'voltgrid', 'hollow']);
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    expect(a).toHaveLength(3);
    for (const q of a) {
      expect(q.objectives.length).toBeGreaterThan(0);
      for (const o of q.objectives) expect(o.need).toBeGreaterThan(0);
    }
  });

  it('labels every objective instead of showing a blank line', () => {
    for (const q of STORY) {
      expect(q.reward.wav).toBeGreaterThan(0);
      expect(q.giver.length).toBeGreaterThan(0);
      for (const o of q.objectives) expect(o.kind).toBeTruthy();
    }
    expect(QUEST_BY_ID.size).toBe(STORY.length);
  });
});

describe('SF pacing math', () => {
  it('measures repeatable sessions and uses SF stat growth, not economic queue unlocks', () => {
    const early = dpsProfile(2, 'core', { samples: 36, seed: 812 });
    expect(dpsProfile(2, 'core', { samples: 36, seed: 812 })).toEqual(early);
    expect(early.queueSlots).toBe(SF.DEFAULT_STATS.slots);
    expect(early.gaugeMs).toBe(SF.gaugeMsFor({ gauge: 2 }));
    expect(early.cycleSeconds).toBeGreaterThan(early.gaugeMs / 1000 + 3);
    expect(early.dps).toBeGreaterThan(early.programDamage / early.cycleSeconds);
    expect(early.licence).toBe(1);
    const late = dpsProfile(26, 'core', { samples: 36, seed: 812 });
    expect(late.dps).toBeGreaterThan(early.dps);
    expect(late.queueSlots).toBe(6);
    expect(late.gridEdge).toBe(6);
    expect(late.gaugeMs).toBeLessThan(early.gaugeMs);
  });

  it('does not let report callers corrupt the cached measurements', () => {
    const profile = dpsProfile(6, 'new');
    const damage = profile.dps;
    profile.dps = 0;
    expect(dpsProfile(6, 'new').dps).toBe(damage);
  });

  it('samples an actual legal program and never fires duplicate copies', () => {
    const output = sampleProgram(['emberpaw', 'emberpaw'], 'new', 2, 3, () => 0);
    const attack = SF.attackScale(1);
    expect(output).toBe(Math.round(SF.card('emberpaw').might * attack) * SF.CRIT_MULTIPLIER);
    expect(sampleProgram([], 'new', 2, 3, rng(1))).toBe(0);
  });

  it('prices attrition on SF clocks and integrity, including high-depth cadence', () => {
    expect(volleyPeriodSeconds()).toBeCloseTo(
      [1, 2, 3, 4].reduce((sum, phase) => {
        const clock = SF.volleyClock({ phase });
        return sum + clock.telegraph + clock.gap;
      }, 0) / 4000, 6,
    );
    expect(volleyPeriodSeconds({ difficulty: 4 })).toBeLessThan(volleyPeriodSeconds());
    for (const tier of [1, 2, 3, 4]) for (const kind of ['node', 'elite', 'boss'] as const) {
      const level = refLevel(tier);
      const band = audienceBand(tier);
      const args = { level, tier, band, kind, seconds: kind === 'boss' ? 160 : 40, archetype: 'baron', guard: 0.1, partySize: 4 };
      const power = powerForCost({ ...args, pct: 0.2 });
      const cost = attritionFor({ ...args, power });
      expect(cost.fieldHp).toBe(SF.hpFor(level));
      const roundingBound = 0.2 / (2 * power) + 0.5 / cost.fieldHp + 0.0005;
      expect(Math.abs(cost.pct - 0.2)).toBeLessThanOrEqual(roundingBound);
    }
  });

  it('keeps every audience inside the preserved node, boss and whole-run windows', () => {
    for (const tier of [1, 2, 3, 4]) {
      const budget = nodeBudget(tier);
      expect(budget.hp / budget.dps).toBeGreaterThan(nodeWindow(tier)[0]);
      expect(budget.hp / budget.dps).toBeLessThan(nodeWindow(tier)[1]);
      const cost = attritionFor({ level: budget.level, tier, band: budget.band, seconds: budget.seconds, power: budget.power });
      expect(cost.pct).toBeCloseTo(budget.costPct, 2);
      const plan = runPlan(tier);
      expect(plan.walks[budget.band].arrivesPct).toBeGreaterThan(0);
    }
    expect(pacingVerdicts(pacingReport())).toMatchObject({ ok: true, notes: [] });
  });
});

describe('data areas', () => {
  const sectors: SectorId[] = ['ashflat', 'voltgrid', 'hollow'];
  const at = (i: number): SectorId => sectors[i % sectors.length]!;

  it('always contains a walkable path from the mouth to the core', () => {
    for (let tier = 1; tier <= 4; tier++) {
      for (let seed = 0; seed < 60; seed++) {
        const area = makeArea(seed * 7 + tier, tier, at(seed));
        const reach = new Set<string>([area.entryId]);
        const stack = [area.entryId];
        while (stack.length) {
          const n = nodeById(area, stack.pop()!);
          for (const l of n?.links ?? []) {
            if (!reach.has(l)) {
              reach.add(l);
              stack.push(l);
            }
          }
        }
        expect(reach.has(area.bossId)).toBe(true);
        // And no dead nodes you can see but never touch.
        expect(reach.size).toBe(area.nodes.length);
      }
    }
  });

  it('has exactly one boss and a gate you cannot be killed at', () => {
    const area = makeArea(4, 2, 'voltgrid');
    expect(area.nodes.filter((n) => n.kind === 'boss')).toHaveLength(1);
    const entry = nodeById(area, area.entryId)!;
    expect(entry.kind).toBe('gate');
    expect(entry.enemy).toBeUndefined();
  });

  it('keeps node health inside the band a player can actually shoot through', () => {
    // Health is a consequence, not a band: the budget is `audience dps x seconds`, so the honest
    // check is the division. Sector bosses used to be hand-set at 12k/26k/55k and every fold argued
    // against that; now a node has to occupy its window in seconds for the player the tier is cut for.
    for (let tier = 1; tier <= 4; tier++) {
      const dps = expectedDps(refLevel(tier), audienceBand(tier));
      const area = makeArea(tier * 99, tier, 'ashflat');
      const seconds = (hp: number): number => hp / dps;

      const boss = nodeById(area, area.bossId)!.enemy!;
      expect(seconds(boss.hp)).toBeGreaterThan(bossWindow(tier)[0]);
      expect(seconds(boss.hp)).toBeLessThan(bossWindow(tier)[1]);

      for (const node of area.nodes) {
        if (!node.enemy || node.kind === 'boss') continue;
        // An elite is the trash window with eliteSecondsK of it standing there.
        const k = node.kind === 'elite' ? FUN.eliteSecondsK : 1;
        expect(seconds(node.enemy.hp)).toBeGreaterThan(nodeWindow(tier)[0] * k);
        expect(seconds(node.enemy.hp)).toBeLessThan(nodeWindow(tier)[1] * k);
      }

      // And the ordering still reads: a walk's trash is smaller than its guardian.
      const wave = area.nodes.find((n) => n.kind === 'wave');
      if (wave?.enemy) expect(wave.enemy.hp).toBeLessThan(boss.hp);
    }
  });

  it('refuses to let a run skip a node or walk backwards', () => {
    const area = makeArea(11, 2, 'ashflat');
    let run = startRun(area, 200);
    const forward = nodeById(area, area.entryId)!.links[0]!;
    expect(canEnter(run, area, forward).ok).toBe(true);
    const deep = nodeById(area, forward)!.links[0]!;
    expect(canEnter(run, area, deep).ok).toBe(false);
    run = advanceRun(run, area, forward).run;
    expect(run.at).toBe(forward);
    expect(advanceRun(run, area, forward).ok).toBe(false);
    // Backwards is not even expressible, since links only point forward.
    expect(nodeById(area, forward)!.links).not.toContain(area.entryId);
  });

  it('ends the run at the core and pays it out once', () => {
    const area = makeArea(23, 1, 'hollow');
    let run = startRun(area, 400);
    let guard = 0;
    while (!run.done && guard++ < 40) {
      const here = nodeById(area, run.at)!;
      const next = here.links[0];
      if (!next) break;
      const res = advanceRun(run, area, next, 10, 0.5);
      expect(res.ok).toBe(true);
      run = res.run;
    }
    expect(run.done).toBe(true);
    expect(run.xp).toBeGreaterThan(0);
    expect(run.wav).toBeGreaterThan(0);
    expect(rowsOf(area).length).toBe(area.rows);
  });

  it('fails a run when the field drops to zero', () => {
    // A relay heals instead of hurting, so the test has to pick a node that actually
    // has something standing in it.
    for (let seed = 0; seed < 60; seed++) {
      const area = makeArea(seed, 2, 'ashflat');
      const entry = nodeById(area, area.entryId)!;
      const fightable = entry.links.map((id) => nodeById(area, id)!).find((n) => !!n.enemy);
      if (!fightable) continue;
      const hurt = advanceRun(startRun(area, 100), area, fightable.id, 999, 0.5);
      expect(hurt.run.hp).toBe(0);
      expect(hurt.run.failed).toBe(true);
      // A node that did not hurt you must not be able to kill you.
      const safe = advanceRun(startRun(area, 100), area, fightable.id, 0, 0.5);
      expect(safe.run.failed).toBe(false);
      return;
    }
  });

  it('only ever drops cards that exist', () => {
    for (let seed = 0; seed < 80; seed++) {
      const area = makeArea(seed, 1 + (seed % 4), 'voltgrid');
      for (const n of area.nodes) {
        for (const id of n.chips ?? []) expect(CHIP_BY_ID.has(id)).toBe(true);
      }
    }
  });

  it('heals at a relay and caps the buff so a run cannot become immortal', () => {
    // Search wide: a shrine is generated, not guaranteed in any particular map.
    for (let seed = 0; seed < 60; seed++) {
      const area = makeArea(seed, 3, 'ashflat');
      const shrine = area.nodes.find((n) => n.kind === 'shrine');
      if (!shrine) continue;
      const from = area.nodes.find((n) => n.links.includes(shrine.id));
      if (!from) continue;
      const run = { ...startRun(area, 300), hp: 40, at: from.id };
      const res = advanceRun(run, area, shrine.id);
      expect(res.ok).toBe(true);
      expect(res.outcome?.kind).toBe('shrine');
      if (res.outcome?.kind !== 'shrine') return;
      expect(res.run.hp).toBe(40 + res.outcome.heal);
      expect(res.run.hp).toBeLessThanOrEqual(res.run.maxHp);
      expect(res.run.buffs.damage + res.run.buffs.guard).toBeLessThanOrEqual(0.12);
      return;
    }
  });
});

describe('album', () => {
  it('covers the whole collection and nothing invented', () => {
    const stat = albumStat([]);
    expect(stat.need).toBe(ALBUM_TOTAL);
    expect(stat.have).toBe(0);
    expect(stat.pct).toBe(0);
  });

  it('reads a token\'s own traits into the canonical spelling', () => {
    const seen = keysOfSource({ Base: 'skull', Skin: 'PINK', Eyes: 'Happy', Tier: 'Rare' });
    expect(seen).toContain(albumKey('Base', 'Skull'));
    expect(seen).toContain(albumKey('Skin', 'Pink'));
    expect(seen).toContain(albumKey('Eyes', 'Happy'));
    expect(seen).toHaveLength(4);
    expect(keysOfSource({ Base: 'Not A Real Value' })).toHaveLength(0);
    expect(keysOfSource(undefined)).toHaveLength(0);
  });

  it('is idempotent, so meeting the same Chog twice never farms XP', () => {
    const keys = keysOfSource({ Aura: 'Purple', Base: 'Skull' });
    const one = sight([], keys);
    const two = sight(one.seen, keys);
    expect(one.added).toHaveLength(2);
    expect(two.added).toHaveLength(0);
    expect(two.xp).toBe(0);
    expect(two.seen.length).toBe(one.seen.length);
  });

  it('pays the rare value more than the common one', () => {
    const common = rarityWeight(474);
    const rare = rarityWeight(1);
    expect(rare).toBeGreaterThan(common);
    expect(common).toBe(1);
    expect(rare).toBe(8);
    const a = sight([], [albumKey('Base', 'Origin')]).xp;
    const b = sight([], [albumKey('Base', '1:1')]).xp;
    expect(b).toBeGreaterThan(a);
  });

  it('fills a category exactly when all its values are seen', () => {
    const eyes = albumStat([]).gapsFor('Eyes');
    const all = eyes.map((v) => albumKey('Eyes', v));
    const full = sight([], all);
    const stat = albumStat(full.seen);
    const row = stat.categories.find((c) => c.category === 'Eyes')!;
    expect(row.complete).toBe(true);
    expect(row.pct).toBe(1);
    expect(pendingCompletions({ seen: full.seen, claimed: [] })).toHaveLength(1);
    const paid = pendingCompletions({ seen: full.seen, claimed: [] })[0]!;
    expect(paid.chip).toBe(categoryPrize('Eyes'));
    expect(markClaimed(emptyAlbum(), ['Eyes']).claimed).toEqual(['Eyes']);
    expect(pendingCompletions({ seen: full.seen, claimed: ['Eyes'] })).toHaveLength(0);
  });

  it('prize cards are real cards', () => {
    for (const cat of albumStat([]).categories) {
      const prize = categoryPrize(cat.category);
      if (prize) expect(CHIP_BY_ID.has(prize)).toBe(true);
    }
  });
});

describe('tribe war', () => {
  const sectors = ['ashflat', 'voltgrid', 'hollow'] as const;

  it('awards a linked kill more than a solo one', () => {
    const solo = payouts(1, 1);
    const party = payouts(4, 4);
    expect(party.pts).toBeGreaterThan(solo.pts);
    // Nobody ever gets a raw head count as a multiplier: four humans are worth 1.48, not 4.
    expect(party.scale).toBeLessThan(2);
  });

  it('only doubles the sector the floor is actually moving', () => {
    expect(sectorMultiplier('voltgrid', 'ashflat', 50_000)).toBe(1);
    expect(sectorMultiplier('voltgrid', 'voltgrid', 50_000)).toBe(2);
    expect(sectorMultiplier('voltgrid', 'voltgrid', 5_000)).toBe(1.5);
  });

  it('ranks the board by points and breaks ties by membership', () => {
    let ledger = emptyLedger('2026-W41', [...sectors]);
    ledger = credit(ledger, { tokenId: 1, tribe: 'volt', sector: 'voltgrid', points: 30, clear: true });
    ledger = credit(ledger, { tokenId: 2, tribe: 'volt', sector: 'voltgrid', points: 10, clear: true });
    ledger = credit(ledger, { tokenId: 3, tribe: 'burn', sector: 'ashflat', points: 40 });
    const rows = board(ledger);
    expect(rows[0]!.points).toBeGreaterThanOrEqual(rows[1]!.points);
    const volt = rows.find((r) => r.tribe === 'volt')!;
    expect(volt.members).toBe(2);
    expect(volt.holds).toContain('voltgrid');
    expect(rows.reduce((s, r) => s + r.points, 0)).toBe(80);
  });

  it('leaves a contested ground unheld rather than awarding a tie', () => {
    let ledger = emptyLedger('w', ['ashflat']);
    ledger = credit(ledger, { tokenId: 1, tribe: 'volt', sector: 'ashflat', points: 20 });
    ledger = credit(ledger, { tokenId: 2, tribe: 'burn', sector: 'ashflat', points: 20 });
    expect(controlOf(ledger).ashflat).toBeUndefined();
    expect(board(ledger).find((r) => r.tribe === 'volt')!.holds).toHaveLength(0);
  });

  it('pays only the tribes that scored', () => {
    let ledger = emptyLedger('w', ['ashflat']);
    expect(weeklyPrizes(ledger)).toHaveLength(0);
    ledger = credit(ledger, { tokenId: 1, tribe: 'volt', sector: 'ashflat', points: 30, clear: true });
    const prizes = weeklyPrizes(ledger);
    expect(prizes).toHaveLength(1);
    expect(prizes[0]!.tribe).toBe('volt');
  });

  it('does not let a single alt dominate the membership count', () => {
    let ledger = emptyLedger('w', ['ashflat']);
    for (let i = 0; i < 10; i++) {
      ledger = credit(ledger, { tokenId: 7, tribe: 'void', sector: 'ashflat', points: 5, clear: true });
    }
    expect(board(ledger).find((r) => r.tribe === 'void')!.members).toBe(1);
  });
});
