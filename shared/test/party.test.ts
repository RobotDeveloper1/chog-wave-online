import { describe, expect, it } from 'vitest';
import {
  SF,
  PARTY_MAX,
  ALT_WEIGHT,
  partyHpScale,
  partyPowerScale,
  partyRewardScale,
  wardBroken,
} from '../src/index.ts';
import { formation } from '../src/party.ts';
const { CROSS_LINK_MAX, DOWN_GRACE_MS, LINK_WINDOW_MS, REVIVE_HOLD_MS, REVIVE_PCT, REVIVE_REACH, canRevive, crossLink, linkTag, reviveFraction, revivedHp } = SF;
type Volley = SF.Volley;

/**
 * The party's numbers, on their own.
 *
 * Everything in `party.ts` is a promise about how the game feels, and each of those promises has a
 * number attached to it: a wave should go *faster* with more bodies while a boss should go longer,
 * a group of alts should earn less than a group of humans, a cross-link should be reachable without
 * firing in lockstep, and a revive should cost the rescuer real exposure. Those are the claims this
 * file checks. The fight itself is covered in `server/test/duel.test.ts`; the pacing they produce is
 * what `tools/pacing-report.mjs` prints.
 */

const volley = (id: string, element: Volley['element'], at: number, file: number): Volley => ({ id, element, at, file });

describe('how the fight grows', () => {
  it('makes trash faster and bosses longer, which is the whole reason to bring four', () => {
    // Trash grows under linear: four bodies clear a wave in ~87% of the solo time.
    expect(partyHpScale(1, 'node')).toBe(1);
    expect(partyHpScale(4, 'node') / 4).toBeLessThan(1);
    expect(partyHpScale(4, 'node') / 4).toBeCloseTo(0.87, 2);
    // A boss goes the other way, because a cross-link needs a partner's volley inside the window
    // and a revive needs two seconds of cover: a fight that ends on the solo timeline deletes both.
    expect(partyHpScale(4, 'boss')).toBeGreaterThan(partyHpScale(4, 'node'));
    expect(partyHpScale(4, 'boss') / 4).toBeGreaterThan(1);
    expect(partyHpScale(2, 'boss')).toBeGreaterThan(partyHpScale(2, 'node'));
  });

  it('caps at the party, so a fifth body cannot keep inflating a room', () => {
    for (const kind of ['node', 'boss'] as const) {
      expect(partyHpScale(PARTY_MAX + 5, kind)).toBe(partyHpScale(PARTY_MAX, kind));
    }
    expect(partyHpScale(0)).toBe(1);
    expect(partyRewardScale(9, 9)).toBe(partyRewardScale(PARTY_MAX, PARTY_MAX));
  });

  it('grows the health pool faster than the enemy’s bite, so more bodies feel safer per body', () => {
    // The gap between these two curves is what a revive and a pincer are spent on.
    expect(partyPowerScale(4)).toBeLessThan(partyHpScale(4, 'node'));
    expect(partyPowerScale(4) / 4).toBeLessThan(partyPowerScale(1));
    expect(partyPowerScale(4)).toBe(2);
  });
});

describe('what the party earns', () => {
  it('counts people, not bodies', () => {
    expect(partyRewardScale(1, 1)).toBe(1);
    // Four boxes on one wallet earn *less* per account than playing one of them: the alt-split tax
    // lives here and nowhere else.
    expect(partyRewardScale(4, 1)).toBeLessThan(1);
    expect(partyRewardScale(4, 4)).toBeGreaterThan(1);
    // and every human added is worth strictly more than the alt they replaced.
    const byHumans = [1, 2, 3, 4].map((owners) => partyRewardScale(4, owners));
    for (let i = 1; i < byHumans.length; i++) expect(byHumans[i]!).toBeGreaterThan(byHumans[i - 1]!);
  });

  it('keeps a real party a bonus rather than a multiple', () => {
    expect(partyRewardScale(4, 4)).toBeLessThan(2);
    expect(partyRewardScale(2, 2)).toBeCloseTo(1 + 0.16, 2);
    // an alt is worth a fraction of a person, which is the only reason the two rows above differ.
    expect(ALT_WEIGHT).toBeLessThan(1);
    expect(partyRewardScale(4, 1)).toBeLessThan(partyRewardScale(2, 2));
  });
});

describe('formation: the party has to choose where it stands', () => {
  it('reads the shape off the files, ignoring whoever is not placed', () => {
    const f = formation(new Map([['a', 2], ['b', 0], ['c', Number.NaN]]));
    expect(f).toEqual({ files: [0, 2], adjacent: false, count: 2 });
    expect(formation([1, 1, 1]).files).toEqual([1]);
    expect(formation([]).count).toBe(0);
  });

  it('opens the social ward only when two occupied files are neighbours', () => {
    expect(wardBroken([0, 1])).toBe(true);
    expect(wardBroken([0, 2])).toBe(false);
    expect(wardBroken([0, 1, 2])).toBe(true);
    expect(wardBroken([1, 1])).toBe(false);
  });
});

describe('the cross-link', () => {
  const now = 10_000;
  const ask = (self: { id: string; element: Volley['element']; file: number }, recent: Volley[], party?: string[]) =>
    crossLink({ self, now, recent, party });

  it('joins a partner’s volley only while it is inside the window', () => {
    const inTime = ask({ id: 'a', element: 'burn', file: 1 }, [volley('b', 'burn', now - 1_200, 2)], ['a', 'b']);
    expect(inTime.partners).toEqual(['b']);
    expect(inTime.mult).toBeGreaterThan(1);
    const out = ask({ id: 'a', element: 'burn', file: 1 }, [volley('b', 'burn', now - LINK_WINDOW_MS - 1, 2)], ['a', 'b']);
    expect(out.partners).toEqual([]);
    expect(out.mult).toBe(1);
    expect(out.tag).toBeNull();
    // a volley stamped in the future is not a partner, it is a client lying about the clock
    expect(ask({ id: 'a', element: 'burn', file: 1 }, [volley('b', 'burn', now + 5_000, 2)], ['a', 'b']).partners).toEqual([]);
  });

  it('needs the same element to be called a link at all', () => {
    const cross = ask({ id: 'a', element: 'burn', file: 1 }, [volley('b', 'frost', now - 200, 0)], ['a', 'b']);
    expect(cross.sameElement).toBe(false);
    expect(cross.adjacent).toBe(true);
    // Position still pays — that is the pincer's contribution, not a link's. The client has to be
    // able to tell those apart, which is why `mult` and `tag` are separate fields.
    expect(cross.mult).toBeGreaterThan(1);
    expect(cross.tag).toBeNull();
  });

  it('never counts your own volley back to you as a partner', () => {
    const solo = ask({ id: 'a', element: 'burn', file: 1 }, [volley('a', 'burn', now - 100, 1)], ['a']);
    expect(solo.partners).toEqual([]);
    expect(solo.mult).toBe(1);
  });

  it('rewards the whole party fielding one element, and nobody who has gone quiet', () => {
    const both = ask({ id: 'a', element: 'burn', file: 1 }, [volley('b', 'burn', now - 300, 2)], ['a', 'b']);
    expect(both.harmony).toBe(true);
    // A third member who has not fired inside the window is not fielding anything, so the party is
    // not in harmony and the tag drops a band.
    const quiet = ask({ id: 'a', element: 'burn', file: 1 }, [volley('b', 'burn', now - 300, 2)], ['a', 'b', 'c']);
    expect(quiet.harmony).toBe(false);
    expect(quiet.mult).toBeLessThan(both.mult);
  });

  it('caps at the cross-link maximum, whatever the geometry', () => {
    const crowded = ask(
      { id: 'a', element: 'burn', file: 1 },
      [volley('b', 'burn', now - 50, 0), volley('c', 'burn', now - 60, 2), volley('d', 'burn', now - 70, 1)],
      ['a', 'b', 'c', 'd'],
    );
    expect(crowded.mult).toBe(CROSS_LINK_MAX);
    expect(crowded.tag).toBe('HARMONY LINK');
  });

  it('names three bands and nothing else, so the word reads at a glance', () => {
    expect(linkTag(1, true)).toBeNull();
    expect(linkTag(1.1, true)).toBe('LINK');
    expect(linkTag(1.2, true)).toBe('CROSS-LINK');
    expect(linkTag(CROSS_LINK_MAX, true)).toBe('HARMONY LINK');
    expect(linkTag(CROSS_LINK_MAX, false)).toBeNull();
    // every mult the function can produce lands in one of those bands
    for (const mult of [1, 1.05, 1.1, 1.17, 1.2, 1.25, 1.32]) {
      expect(['LINK', 'CROSS-LINK', 'HARMONY LINK', null]).toContain(linkTag(mult, true));
    }
  });
});

describe('cover', () => {
  const down = { file: 1, alive: false };
  const up = { file: 1, alive: true };

  it('refuses for a reason the player can act on', () => {
    expect(canRevive({ partySize: 1, downed: down, rescuer: up })).toEqual({ ok: false, reason: 'solo' });
    expect(canRevive({ partySize: 2, downed: up, rescuer: up }).reason).toBe('not-down');
    expect(canRevive({ partySize: 2, downed: down, rescuer: down }).reason).toBe('rescuer-down');
    expect(canRevive({ partySize: 2, downed: down, rescuer: { file: 1, alive: true } }).reason).toBe('same-file');
    expect(canRevive({ partySize: 2, downed: down, rescuer: { file: 3, alive: true } }).reason).toBe('out-of-reach');
    expect(canRevive({ partySize: 2, downed: down, rescuer: { file: 2, alive: true } })).toEqual({ ok: true });
  });

  it('is only ever one file away, which is the exposure being priced', () => {
    expect(REVIVE_REACH).toBe(1);
    // same-file is refused even though it is nearer than one: standing on a body is not covering it.
    expect(canRevive({ partySize: 2, downed: down, rescuer: { file: 1, alive: true } }).ok).toBe(false);
  });

  it('fills a hold on a straight line and never past the ends', () => {
    expect(reviveFraction(0)).toBe(0);
    expect(reviveFraction(REVIVE_HOLD_MS / 2)).toBeCloseTo(0.5, 5);
    expect(reviveFraction(REVIVE_HOLD_MS)).toBe(1);
    expect(reviveFraction(REVIVE_HOLD_MS * 4)).toBe(1);
    expect(reviveFraction(-1_000)).toBe(0);
  });

  it('brings them back able to play but not whole', () => {
    expect(revivedHp(100)).toBe(Math.round(100 * REVIVE_PCT));
    expect(revivedHp(100)).toBeLessThan(100);
    // a body at one integrity still gets up, because getting up is not a reward for health
    expect(revivedHp(1)).toBe(1);
    expect(REVIVE_PCT).toBeGreaterThan(0.33);
  });

  it('gives a rescue enough time to be possible, and not enough to be routine', () => {
    expect(DOWN_GRACE_MS).toBeGreaterThan(REVIVE_HOLD_MS);
    // The grace has to survive one boss beat of travel: a partner mid-volley still reaches them.
    expect(DOWN_GRACE_MS / REVIVE_HOLD_MS).toBeGreaterThanOrEqual(4);
  });
});
