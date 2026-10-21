import { describe, expect, it } from 'vitest';
import {
  FORGE_PERIOD_MS,
  FORGE_SURGE_AT,
  HEAT_CRITICAL,
  HEAT_GAIN,
  HEAT_MAX,
  HEAT_WARM,
  advanceHeat,
  clampHeatZone,
  forgePhase,
  heatAdvice,
  heatAggroMul,
  heatBand,
  heatDrainPct,
  heatFloorPct,
  heatOverInterval,
  heatStep,
  zoneSource,
} from '../src/heat.ts';

/** The cycle is the mechanic's clock, so everything downstream is read off it. */
describe('the forge cycle', () => {
  it('is cold through the lull and full at the peak of the surge', () => {
    expect(forgePhase(0).surge).toBe(0);
    expect(forgePhase(FORGE_SURGE_AT - 1).surge).toBe(0);
    // Halfway through the rise is halfway up, not all the way.
    const rising = forgePhase(FORGE_SURGE_AT + 1_250).surge;
    expect(rising).toBeGreaterThan(0.4);
    expect(rising).toBeLessThan(0.6);
    expect(forgePhase(FORGE_SURGE_AT + 4_000).surge).toBe(1);
  });

  it('always comes back down before the cycle ends, so a surge cannot leak into the next one', () => {
    // The tail of the period is the fall, so the last instant is cold again.
    expect(forgePhase(FORGE_PERIOD_MS - 1).surge).toBeLessThan(0.05);
    expect(forgePhase(FORGE_PERIOD_MS).surge).toBe(0);
    expect(forgePhase(FORGE_PERIOD_MS * 3).surge).toBe(0);
  });

  it('announces itself before it starts, which is the whole reason the walk is a decision', () => {
    const warnAt = FORGE_SURGE_AT - 2_500;
    expect(forgePhase(warnAt - 1).tell).toBe(0);
    expect(forgePhase(warnAt + 1_250).tell).toBeGreaterThan(0.4);
    expect(forgePhase(FORGE_SURGE_AT - 1).untilSurge).toBeLessThan(50);
    // Once it is under way there is nothing left to warn about.
    expect(forgePhase(FORGE_SURGE_AT + 1_000).tell).toBe(0);
  });

  it('reads the same for a wall clock far in the past or the future', () => {
    expect(forgePhase(FORGE_PERIOD_MS * 10 + 500).surge).toBe(forgePhase(500).surge);
    expect(forgePhase(-FORGE_PERIOD_MS + 500).surge).toBe(forgePhase(500).surge);
  });
});

describe('where you are standing', () => {
  it('makes a cleared chamber free and an uncleared one the worst place in the map', () => {
    expect(zoneSource('cool', 1)).toBe(0);
    // A room is hot even in the lull -- the machinery never fully stops.
    expect(zoneSource('room', 0)).toBeGreaterThan(0.4);
    // A corridor is nearly free in the lull and nearly as bad as a room at the peak, which is
    // exactly the gap the "go now or wait" decision is made out of.
    expect(zoneSource('corridor', 0)).toBeLessThan(0.2);
    expect(zoneSource('corridor', 1)).toBeGreaterThan(0.95);
  });

  it('refuses to believe a client standing in a live room is cool', () => {
    expect(clampHeatZone('cool', true)).toBe('room');
    // Claiming a corridor from safety is allowed and only ever costs the player more.
    expect(clampHeatZone('corridor', false)).toBe('corridor');
    expect(clampHeatZone('cool', false)).toBe('cool');
    expect(clampHeatZone('room', true)).toBe('room');
  });
});

describe('the heat it puts in you', () => {
  it('climbs to ignition in a surging room and never past 100', () => {
    let h = 0;
    for (let i = 0; i < 200; i++) h = heatStep(h, 0.1, 'room', 1);
    expect(h).toBe(HEAT_MAX);
    expect(h).toBeLessThanOrEqual(HEAT_MAX);
  });

  it('takes about nine seconds of a full surge to cook you from cold', () => {
    let h = 0;
    let t = 0;
    while (h < HEAT_MAX && t < 30) { h = heatStep(h, 0.1, 'room', 1); t += 0.1; }
    expect(t).toBeGreaterThan(7);
    expect(t).toBeLessThan(12);
  });

  it('bleeds back off in a cleared chamber and floors at zero', () => {
    let h = 100;
    for (let i = 0; i < 300; i++) h = heatStep(h, 0.1, 'cool', 1);
    expect(h).toBe(0);
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('charges a corridor at the peak nearly what it charges a room', () => {
    const corridor = zoneSource('corridor', 1) * HEAT_GAIN;
    const room = zoneSource('room', 1) * HEAT_GAIN;
    expect(corridor / room).toBeGreaterThan(0.9);
  });
});

describe('the bands', () => {
  it('splits at 40 and 70 and says what each one is doing to you', () => {
    expect(heatBand(0)).toBe('cold');
    expect(heatBand(HEAT_WARM - 1)).toBe('cold');
    expect(heatBand(HEAT_WARM)).toBe('warm');
    expect(heatBand(HEAT_CRITICAL - 1)).toBe('warm');
    expect(heatBand(HEAT_CRITICAL)).toBe('critical');
    expect(heatDrainPct(10)).toBe(0);
    expect(heatDrainPct(50)).toBeGreaterThan(0);
    expect(heatDrainPct(90)).toBeGreaterThan(heatDrainPct(50));
    expect(heatAdvice(90)).toContain('see you');
  });

  it('doubles how far a band can see you once the floor is glowing', () => {
    expect(heatAggroMul(10)).toBe(1);
    expect(heatAggroMul(50)).toBeGreaterThan(1);
    expect(heatAggroMul(90)).toBe(2);
  });
});

describe('whether the forge is allowed to finish you', () => {
  it('never kills in the first fold, because its own blurb calls it forgiving', () => {
    expect(heatFloorPct(1)).toBeGreaterThan(0.2);
  });

  it('is lethal from the second fold on, which is the promise the tutorial made', () => {
    for (const tier of [2, 3, 4]) expect(heatFloorPct(tier)).toBe(0);
  });
});

describe('integrating over a real interval', () => {
  it('lands on the same number however finely it is sliced', () => {
    const from = 1_000;
    const to = 12_000;
    const coarse = heatOverInterval(0, from, to, 'corridor', 1_000);
    const fine = heatOverInterval(0, from, to, 'corridor', 50);
    expect(Math.abs(coarse - fine)).toBeLessThan(1.5);
  });

  it('is a no-op over an empty or backwards interval', () => {
    expect(heatOverInterval(37, 5_000, 5_000, 'room')).toBe(37);
    expect(heatOverInterval(37, 9_000, 5_000, 'room')).toBe(37);
  });

  it('reports the worst band the interval passed through, not just where it ended', () => {
    // Already warm, crossing a corridor into the surge: ends critical and passed through warm.
    const res = advanceHeat(45, 13_500, 18_200, 'corridor', 250);
    expect(res.worst).toBe('critical');
    expect(res.heat).toBeGreaterThan(HEAT_CRITICAL);
    expect(res.drain).toBeGreaterThan(0);
    // Ending below where it started still reports the band it crossed on the way down.
    const cooling = advanceHeat(90, 0, 12_000, 'cool', 250);
    expect(cooling.heat).toBe(0);
    expect(cooling.worst).toBe('critical');
  });
});

/**
 * The claim the whole mechanic rests on.
 *
 * Heat is a *debt*, not an instant tax: one crossing during a surge is survivable and costs
 * almost nothing, but it leaves you standing at the edge of the warm band, so the next one
 * finishes the job. That is what makes the crossing a decision rather than a dice roll --
 * you can always afford one, and you can never afford three.
 */
describe('the trade the mechanic is made of', () => {
  it('leaves you nearly untouched for one surge crossing and untouched for one in the lull', () => {
    const running = advanceHeat(0, 13_500, 18_200, 'corridor', 250);
    const waiting = advanceHeat(0, 0, 4_700, 'corridor', 250);
    expect(running.heat).toBeGreaterThan(HEAT_WARM - 5);
    expect(running.drain).toBeLessThan(0.01);
    // Waiting it out is free and leaves you cold -- the cost of the run is the clock, not the field.
    expect(waiting.drain).toBe(0);
    expect(waiting.heat).toBeLessThan(10);
  });

  it('ignites you on the third crossing in a row and never on three lull crossings', () => {
    let running = 0;
    for (let i = 0; i < 3; i++) running = advanceHeat(running, 13_500, 18_200, 'corridor', 250).heat;
    let waiting = 0;
    for (let i = 0; i < 3; i++) waiting = advanceHeat(waiting, 0, 4_700, 'corridor', 250).heat;
    expect(running).toBe(HEAT_MAX);
    expect(waiting).toBeLessThan(HEAT_WARM);
    // So the third crossing is where the run actually dies, which is the pressure the clock is for.
    expect(heatBand(running)).toBe('critical');
    expect(heatBand(waiting)).toBe('cold');
  });

  it('makes a cleared chamber the only place heat is free, so fighting is what buys safety', () => {
    // A full forge cycle standing in a room whose monster is still alive: ignition.
    const live = advanceHeat(0, 0, 18_000, 'room', 250);
    expect(live.heat).toBe(HEAT_MAX);
    expect(live.drain).toBeGreaterThan(0.05);
    // The same cycle in the chamber you already cleared: it sheds what you carried in.
    const cleared = advanceHeat(80, 0, 18_000, 'cool', 250);
    expect(cleared.heat).toBe(0);
    // ...but it does not stop the burning. Fleeing into a cleared room stops the heat *rising*;
    // it does not undo what is already in you, so you still bleed until it drops back to cold.
    // That is the difference between a safe room and a rescue, and it is why the lull matters.
    expect(cleared.drain).toBeGreaterThan(0);
    expect(cleared.drain).toBeLessThan(live.drain);
    // Five seconds of standing still is enough to drop back under the warm band, and the bleed
    // stops the moment it does.
    const settled = advanceHeat(80, 0, 5_000, 'cool', 250);
    expect(heatBand(settled.heat)).toBe('cold');
    const after = advanceHeat(settled.heat, 5_000, 6_500, 'cool', 250);
    expect(after.drain).toBe(0);
  });
});
