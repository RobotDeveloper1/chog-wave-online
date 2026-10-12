// Runs the game's own card, grid and gauge code hundreds of times against three reference
// players, and prints what the loop actually measures: damage per second, how long the fights on
// a sized map take, what each one costs the field, and whether a walk is survivable at all.
// Difficulty here is expressed in seconds and in fractions of your integrity, because those are
// the only units an action-game player can feel — HP is an implementation detail of the first one.
// `shared/src/dungeon.ts` reads the same numbers, so this report and the shipped maps cannot
// drift apart. The last two sections are the drift check: they read the *generated* maps.
//   node --experimental-strip-types tools/pacing-report.mjs
import {
  BANDS,
  FUN,
  PARTY_LINK,
  PARTY_SIZE,
  REF_LEVEL,
  audienceBand,
  attritionFor,
  bossWindow,
  costSplit,
  dpsProfile,
  expectedDps,
  funSpread,
  nodeWindow,
  pacingVerdicts,
  partyRun,
  refLevel,
  rowsForTier,
  runPlan,
  runWindow,
  ttkSeconds,
  volleyPeriodSeconds,
} from '../shared/src/loop.ts';
import { partyHpScale, partyRewardScale } from '../shared/src/party.ts';
import { DUNGEONS } from '../shared/src/dungeonData.ts';
import { unlocksAt } from '../shared/src/progress.ts';
import { makeDungeon, nodeById } from '../shared/src/dungeon.ts';

const BANDS_ORDER = ['new', 'core', 'optimized'];
const TIERS = [1, 2, 3, 4];
const SEED = 20_261_010;
const pad = (v, n) => String(v).padStart(n);
const pct = (v) => `${Math.round(v * 100)}%`;
const sec = (v) => `${Math.round(v)}s`;

console.log('CHOG WAVE ONLINE — pacing report (measured, not asserted)\n');

// ---------------------------------------------------------------------------
// 1. The reference players. DPS here is Monte Carlo over the real draw/line/grid/gauge code,
//    averaged across six folders per band so one lucky folder cannot set a tier's HP.
// ---------------------------------------------------------------------------
console.log('reference players — measured, not assumed');
console.log('  band        lv  queue grid  gauge  cycle  program  dmg/cycle      dps');
for (const band of BANDS_ORDER) {
  let prev = 0;
  for (const level of REF_LEVEL) {
    const p = dpsProfile(level, band);
    const m = BANDS[band];
    console.log(
      `  ${band.padEnd(10)} ${pad(p.level, 2)}  ${pad(p.queueSlots, 4)} ${pad(p.gridEdge, 4)}x${p.gridEdge}` +
        ` ${pad(p.gaugeMs / 1000, 5)}s ${pad(p.cycleSeconds, 6)}s ${pad(p.programDamage, 7)} ${pad(Math.round(p.dps * p.cycleSeconds), 9)}   ${pad(p.dps, 6)}` +
        `   ${prev && p.dps > prev ? 'ok' : prev ? 'NOT MONOTONIC' : ''}`,
    );
    prev = p.dps;
  }
  console.log(
    `  ${''.padEnd(10)}    aim ${(BANDS[band].aim * 100) | 0}%  eats ${(BANDS[band].hitRate * 100) | 0}% of volleys` +
      `  menu ${BANDS[band].menuMs}ms  chain x${BANDS[band].chainRun}  affinity ${BANDS[band].affinity}  crit ${BANDS[band].crit}` +
      `  (${dpsProfile(REF_LEVEL[0], band).samples} programs/band)`,
  );
}

// ---------------------------------------------------------------------------
// 2. The windows. These four numbers are the whole design brief; everything after is arithmetic.
// ---------------------------------------------------------------------------
console.log(`\nthe brief — a volley lands every ${volleyPeriodSeconds().toFixed(2)}s, so these windows are volley counts`);
console.log('  T lv  rows | node window  boss window  run window | walk spends | per fight: node  elite  boss');
for (const tier of TIERS) {
  const [nlo, nhi] = nodeWindow(tier);
  const [blo, bhi] = bossWindow(tier);
  const [rlo, rhi] = runWindow(tier);
  const costs = costSplit(tier);
  const sum = costs.node * layoutCount(tier, 'node') + costs.elite * layoutCount(tier, 'elite') + costs.boss;
  console.log(
    `  ${tier} ${pad(refLevel(tier), 2)} ${pad(rowsForTier(tier), 4)} | ${pad(`${nlo}-${nhi}s`, 11)} ${pad(`${blo}-${bhi}s`, 11)}` +
      ` ${pad(`${rlo}-${rhi}m`, 11)} | ${pad(pct(FUN.runCost[tier - 1]), 11)} | ${pad(pct(costs.node), 6)} ${pad(pct(costs.elite), 5)} ${pad(pct(costs.boss), 5)}` +
      `   (check: ${pct(sum)})`,
  );
}

function layoutCount(tier, kind) {
  return runPlan(tier).layout.filter((k) => k === kind).length;
}

// ---------------------------------------------------------------------------
// 3. The map that falls out of the brief: HP from measured DPS, bite from the cost budget.
// ---------------------------------------------------------------------------
console.log(`\nwhat that turns into (each tier's audience band sizes the map; the other two read it)`);
console.log('  T lv  dps |  node hp  secs  cost  power |  elite hp  secs  cost  power |   boss hp secs  cost  power');
for (const tier of TIERS) {
  const plan = runPlan(tier);
  const cell = (f) => `${pad(f.hp, 8)} ${pad(sec(f.seconds), 5)} ${pad(pct(f.costPct), 5)} ${pad(f.power, 6)}`;
  console.log(
    `  ${tier} ${pad(plan.level, 2)} ${pad(plan.fights.node.dps, 4)} | ${cell(plan.fights.node)}` +
      ` | ${cell(plan.fights.elite)} | ${cell(plan.fights.boss)}`,
  );
}

// ---------------------------------------------------------------------------
// 4. Skill spread, on one fixed map. A weaker player is not handed a smaller monster — they are
//    measured taking longer and paying more, which is the only honest reading of a difficulty band.
// ---------------------------------------------------------------------------
console.log('\nsame map, three players (node / core seconds, run minutes, integrity left at the core)');
console.log('  T            new           core        optimized   (* = this tier\'s audience band)');
for (const tier of TIERS) {
  const cells = funSpread(tier).map((r) => {
    const tag = r.arrivesPct < 0 ? 'dies' : r.arrivesPct > 0.85 ? 'free' : `${pct(r.arrivesPct)} left`;
    const mark = r.role === 'audience' ? '*' : ' ';
    return `${pad(sec(r.nodeSeconds), 4)}/${pad(sec(r.bossSeconds), 4)} ${pad(`${r.minutes}m`, 5)} ${pad(tag, 7)}${mark}`;
  });
  console.log(`  ${tier}  ${cells.join('  ')}`);
}

// ---------------------------------------------------------------------------
// 5. The walk itself, fight by fight, for the median player. This is the number that decides
//    whether a run is tense or a coin flip: what is left of the field when the core falls.
// ---------------------------------------------------------------------------
console.log('\nthe walk, audience band, row by row (cost of each fight as a share of the field)');
for (const tier of TIERS) {
  const plan = runPlan(tier);
  const band = audienceBand(tier);
  const solo = plan.walks[band];
  const four = partyRun(plan);
  const rows = plan.layout.map((row) => {
    if (row === 'prize') return 'prize  +0%';
    if (row === 'relay') return `relay  +${Math.round(FUN.relayPct * 100)}%`;
    const f = plan.fights[row];
    const a = attritionFor({ level: plan.level, tier, band, kind: row, seconds: f.seconds, power: f.power });
    return `${row}  -${Math.round(a.pct * 100)}%`;
  });
  console.log(`  T${tier} (${plan.level}, ${band})  ${rows.join('   ')}`);
  console.log(
    `             solo: ${solo.minutes}min, ${solo.fights} fights, worst ${(solo.worstPct * 100) | 0}% a fight, arrives at ${pct(solo.arrivesPct)}` +
      `  ·  4-man: ${four.minutes}min, arrives at ${pct(four.arrivesPct)}`,
  );
}

// ---------------------------------------------------------------------------
// 6. Why to bring three friends. Time down, money up, and the alt-queue still earns nothing.
// ---------------------------------------------------------------------------
console.log(`\nparty (a coordinated four: x${PARTY_LINK} cross-link)`);
console.log('  T  solo run | 4-man run | hp node x / core x | reward/body  4 humans | 4 boxes, 1 owner');
for (const tier of TIERS) {
  const plan = runPlan(tier);
  const solo = plan.walks[audienceBand(tier)];
  const four = partyRun(plan);
  const payout = (base, size, owners) => Math.round(base * size * partyRewardScale(size, owners));
  const base = 10 + tier * 8;
  console.log(
    `  ${tier} ${pad(`${solo.minutes}m`, 9)} | ${pad(`${four.minutes}m`, 9)} |` +
      ` ${pad(partyHpScale(4, 'node'), 7)} / ${partyHpScale(4, 'boss')}` +
      ` | ${pad(payout(base, 4, 4), 9)} WAV ${pad(payout(base, 4, 1), 9)} WAV (${pct(partyRewardScale(4, 1))} each vs solo)`,
  );
}

// ---------------------------------------------------------------------------
// 7. The shipped dungeons, as the generator actually builds them, walked along every path.
//    Best case = the cheapest path to the core; worst = the one a player who takes everything
//    pays. If the budget is real, the worst path still has to arrive above zero.
// ---------------------------------------------------------------------------
console.log('\nthe six dungeons, as the generator builds them');
console.log('  dungeon           T lv band rows  trash   elite    core | run  best worst | arrives  best worst');
for (const d of DUNGEONS) {
  const area = makeDungeon(d, SEED + d.n);
  const dps = dpsProfile(d.level, audienceBand(d.tier)).dps;
  const hps = (kind) => area.nodes.filter((n) => n.kind === kind).map((n) => n.enemy.hp);
  const trash = hps('wave');
  const elites = hps('elite');
  const boss = hps('boss');
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, h) => s + h, 0) / xs.length) : 0);
  const paths = pathsToCore(area);
  const scored = paths.map((path) => walkPath(area, d, path, dps));
  scored.sort((a, b) => a.arrives - b.arrives);
  const worst = scored[0];
  const best = scored[scored.length - 1];
  const minutes = (s) => `${(s.seconds / 60).toFixed(1)}m`;
  console.log(
    `  ${d.name.padEnd(17)} ${d.tier} ${pad(d.level, 2)} ${audienceBand(d.tier).padEnd(5)} ${pad(area.rows, 3)} ${pad(avg(trash), 6)} ${pad(avg(elites), 6)} ${pad(boss[0] ?? 0, 7)}` +
      ` | ${pad(minutes(worst), 4)} ${pad(minutes(best), 5)} |` +
      `          ${pct(worst.arrives)} ${pct(best.arrives)}`,
  );
}

// ---------------------------------------------------------------------------
// 8. Budget vs. generator: the gap this report exists to close.
// ---------------------------------------------------------------------------
console.log('\nthe sized map next to the generated one (power is what the field hits you with)');
console.log('  T          budget hp  power |  generated trash  power | hp ratio');
for (const tier of TIERS) {
  const plan = runPlan(tier);
  const def = DUNGEONS.find((d) => d.tier === tier);
  const area = makeDungeon(def, SEED + def.n);
  const nodes = area.nodes.filter((n) => n.kind === 'wave');
  const hp = nodes.length ? Math.round(nodes.reduce((s, n) => s + n.enemy.hp, 0) / nodes.length) : 0;
  const power = avgPower(nodes);
  const ratio = plan.fights.node.hp ? Math.round((hp / plan.fights.node.hp) * 100) : 0;
  console.log(
    `  ${tier} ${pad(`${plan.fights.node.hp}/${plan.fights.node.power}`.replace('/', '  '), 16)} |` +
      ` ${pad(hp, 11)} ${pad(power, 6)} | ${pad(`${ratio}%`, 9)}`,
  );
}

function avgPower(nodes) {
  if (!nodes.length) return 0;
  return Math.round(nodes.reduce((s, n) => s + n.enemy.power, 0) / nodes.length);
}

/** Every route from the mouth to the core, in walking order. */
function pathsToCore(area) {
  const out = [];
  const walk = (id, seen) => {
    // `seen` already ends on `id`: the recursive call below appends before descending. Pushing `id`
    // again here charged every core twice, and made every run look like a death sentence.
    if (id === area.bossId) {
      out.push([...seen]);
      return;
    }
    for (const next of nodeById(area, id)?.links ?? []) {
      if (!seen.includes(next) && next !== id) walk(next, [...seen, next]);
    }
  };
  walk(area.entryId, [area.entryId]);
  return out.length ? out : [[area.entryId]];
}

/** The same arithmetic `runPlan` does, but over the nodes a map actually contains. */
function walkPath(area, def, path, dps) {
  const field = unlocksAt(def.level).fieldHp;
  let hp = 1;
  let seconds = FUN.travelSeconds * Math.max(0, path.length - 1);
  for (const id of path) {
    const node = nodeById(area, id);
    if (!node) continue;
    if (node.kind === 'shrine') {
      hp = Math.min(1, hp + 0.35);
      continue;
    }
    if (!node.enemy) continue;
    const kind = node.kind === 'boss' ? 'boss' : node.kind === 'elite' ? 'elite' : 'node';
    const length = node.enemy.hp / dps;
    seconds += length;
    hp -= attritionFor({
      level: def.level,
      tier: def.tier,
      band: audienceBand(def.tier),
      kind,
      seconds: length,
      power: node.enemy.power,
      archetype: node.enemy.archetype,
    }).pct;
  }
  return { seconds, arrives: hp };
}

const verdict = pacingVerdicts();
console.log(`\nverdicts: ${verdict.ok ? 'the curve holds' : `${verdict.notes.length} problem(s)`}`);
for (const n of verdict.notes) console.log(`  ! ${n}`);
// Findings, not failures: what a band *other* than this tier's audience does on the same map. This
// is the accessibility ledger — the game being hard for a newcomer at T3 is a fact to publish, not
// a number to smooth away, because smoothing it is exactly what makes a map boring for its audience.
if (verdict.reads.length) {
  console.log('\nwhat the other bands do on these maps (findings, not sizing failures)');
  for (const r of verdict.reads) console.log(`  · ${r}`);
}
