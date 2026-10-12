import { describe, expect, it } from 'vitest';

import { INVITE_TTL_MS, Social, type SocialPlayer } from '../src/social.ts';

const player = (id: string, over: Partial<SocialPlayer> = {}): SocialPlayer => ({
  id,
  tokenId: Number(id.replace(/\D/g, '')) || 1,
  sector: 'ashflat',
  room: 'ashflat#1',
  build: { callsign: `Chog ${id}`, loadout: { element: 'volt' } },
  save: { kills: 4, updatedAt: 0 },
  ...over,
});

describe('presence', () => {
  it('is derived from the player, so it cannot go stale', () => {
    const s = new Social();
    const p = s.presence(player('a1'), 'battle');
    expect(p.name).toBe('Chog a1');
    expect(p.tribe).toBe('volt');
    expect(p.doing).toBe('battle');
    expect(p.level).toBeGreaterThan(1);
  });
});

describe('linking', () => {
  it('merges two solo players into one party', () => {
    const s = new Social();
    const r = s.link('a1', 'b2');
    expect(r.ok).toBe(true);
    expect(r.party?.members).toEqual(['a1', 'b2']);
    expect(s.withMe('b2')).toEqual(['a1', 'b2']);
  });

  it('refuses a party of five', () => {
    const s = new Social();
    s.link('a1', 'b2');
    s.link('a1', 'c3');
    s.link('a1', 'd4');
    const fifth = s.link('a1', 'e5');
    expect(fifth.ok).toBe(false);
    expect(fifth.reason).toBe('party full');
  });

  it('merges whole parties rather than stealing one person', () => {
    const s = new Social();
    s.link('a1', 'b2');
    s.link('c3', 'd4');
    const merged = s.link('a1', 'c3');
    expect(merged.party?.members.sort()).toEqual(['a1', 'b2', 'c3', 'd4']);
    expect(s.partyOf('d4')!.id).toBe(merged.party!.id);
  });

  it('will not link a player to themselves or bridge two full parties', () => {
    const s = new Social();
    expect(s.link('a1', 'a1').reason).toBe('yourself');
    for (const other of ['b2', 'c3', 'd4']) s.link('a1', other);
    s.link('e5', 'f6');
    s.link('e5', 'g7');
    s.link('e5', 'h8');
    expect(s.link('a1', 'e5').reason).toBe('party full');
  });

  it('collapses a party of one back to nobody', () => {
    const s = new Social();
    s.link('a1', 'b2');
    s.unlink('b2');
    expect(s.partyOf('a1')).toBeNull();
    expect(s.withMe('a1')).toEqual(['a1']);
  });
});

describe('the Link shield', () => {
  it('holds while a linked pair stand in adjacent files', () => {
    const s = new Social();
    s.link('a1', 'b2');
    const cols = new Map([
      ['a1', 0],
      ['b2', 1],
    ]);
    expect(s.shieldHeld('a1', cols)).toBe(false);
  });

  it('stays up when the pair are two files apart', () => {
    const s = new Social();
    s.link('a1', 'b2');
    expect(s.shieldHeld('a1', new Map([['a1', 0], ['b2', 2]]))).toBe(true);
  });

  it('is always up for a solo player, so the ward cannot be farmed alone', () => {
    const s = new Social();
    expect(s.shieldHeld('a1', new Map([['a1', 1]]))).toBe(true);
  });

  it('ignores party members who left the field', () => {
    const s = new Social();
    s.link('a1', 'b2');
    expect(s.shieldHeld('a1', new Map([['a1', 1]]))).toBe(true);
    expect(s.shieldHeld('a1', new Map([['a1', 1], ['b2', 2]]))).toBe(false);
  });
});

describe('trading', () => {
  const holdings = (a: string[], b: string[]) => ({ a1: a, b2: b });

  it('swaps both sides when both still hold what was promised', () => {
    const s = new Social();
    const t = s.offer('a1', 'b2', ['emberpaw'], ['arcsnap']);
    const r = s.accept(t.id, 'b2', holdings(['emberpaw'], ['arcsnap']));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.swap.to).toBe('a1');
      expect(r.swap.give).toEqual(['arcsnap']);
      expect(r.swap.take).toEqual(['emberpaw']);
    }
  });

  it('refuses when the offerer spent the card in the meantime', () => {
    const s = new Social();
    const t = s.offer('a1', 'b2', ['emberpaw'], ['arcsnap']);
    const r = s.accept(t.id, 'b2', holdings([], ['arcsnap']));
    expect(r).toEqual({ ok: false, reason: 'they no longer hold it' });
  });

  it('refuses when the acceptor no longer holds their half', () => {
    const s = new Social();
    const t = s.offer('a1', 'b2', ['emberpaw'], ['arcsnap']);
    expect(s.accept(t.id, 'b2', holdings(['emberpaw'], []))).toEqual({
      ok: false,
      reason: 'you no longer hold it',
    });
  });

  it('cannot be accepted twice', () => {
    const s = new Social();
    const t = s.offer('a1', 'b2', ['emberpaw'], ['arcsnap']);
    const hold = holdings(['emberpaw'], ['arcsnap']);
    expect(s.accept(t.id, 'b2', hold).ok).toBe(true);
    expect(s.accept(t.id, 'b2', hold)).toEqual({ ok: false, reason: 'gone' });
  });

  it('is only acceptable by the player it was addressed to', () => {
    const s = new Social();
    const t = s.offer('a1', 'b2', ['emberpaw'], ['arcsnap']);
    expect(s.accept(t.id, 'c3', holdings(['emberpaw'], ['arcsnap']))).toEqual({
      ok: false,
      reason: 'not yours',
    });
  });

  it('caps at six cards a side and drops duplicates', () => {
    const s = new Social();
    const many = Array.from({ length: 12 }, (_, i) => `chip${i}`);
    const t = s.offer('a1', 'b2', [...many.slice(0, 3), 'chip0'], many);
    expect(t.giving).toEqual(['chip0', 'chip1', 'chip2']);
    expect(t.wanting).toHaveLength(6);
  });

  it('shows up in the recipient inbox and clears on cancel', () => {
    const s = new Social();
    const t = s.offer('a1', 'b2', ['emberpaw'], ['arcsnap']);
    expect(s.pendingFor('b2').map((x) => x.id)).toEqual([t.id]);
    s.cancel(t.id);
    expect(s.pendingFor('b2')).toEqual([]);
  });
});

describe('tribe tally', () => {
  it('ranks tribes by score, highest first', () => {
    const s = new Social();
    const ranked = s.tally(
      new Map([
        ['volt', 10],
        ['burn', 40],
        ['void', 25],
      ] as never),
    );
    expect(ranked.map((r) => r.tribe)).toEqual(['burn', 'void', 'volt']);
  });
});

describe('invitations', () => {
  it('become a party when answered, with whoever asked at the front', () => {
    const s = new Social();
    expect(s.invite('a1', 'b2').ok).toBe(true);
    expect(s.partyOf('a1')).toBeNull();
    const r = s.acceptInvite('b2');
    expect(r.ok).toBe(true);
    expect(r.party?.members).toEqual(['a1', 'b2']);
    expect(s.leader('b2')).toBe('a1');
    expect(s.acceptInvite('b2').ok).toBe(false);
  });

  it('run out after forty-five seconds', () => {
    const s = new Social();
    s.invite('a1', 'b2', 1_000);
    expect(s.inviteFor('b2', 1_000 + INVITE_TTL_MS - 1)).not.toBeNull();
    expect(s.inviteFor('b2', 1_000 + INVITE_TTL_MS + 1)).toBeNull();
    expect(s.acceptInvite('b2', 1_000 + INVITE_TTL_MS + 1).ok).toBe(false);
  });

  it('are cancelled when either side goes', () => {
    const s = new Social();
    s.invite('a1', 'b2');
    s.unlink('a1');
    expect(s.inviteFor('b2')).toBeNull();
    s.invite('c3', 'd4');
    s.unlink('d4');
    expect(s.inviteFor('d4')).toBeNull();
  });

  it('only come from a leader, never to yourself, never into a full party', () => {
    const s = new Social();
    expect(s.invite('a1', 'a1').ok).toBe(false);
    s.link('a1', 'b2');
    expect(s.invite('b2', 'c3')).toEqual({ ok: false, reason: 'only the leader invites' });
    s.link('a1', 'c3');
    s.link('a1', 'd4');
    expect(s.invite('a1', 'e5')).toEqual({ ok: false, reason: 'party full' });
    expect(s.invite('a1', 'b2')).toEqual({ ok: false, reason: 'already in your party' });
  });

  it('can be declined, and the party leader alone can remove a member', () => {
    const s = new Social();
    s.invite('a1', 'b2');
    expect(s.declineInvite('b2')).toBe('a1');
    expect(s.declineInvite('b2')).toBeNull();
    s.link('a1', 'b2');
    s.link('a1', 'c3');
    expect(s.kick('b2', 'c3').ok).toBe(false);
    expect(s.kick('a1', 'a1').ok).toBe(false);
    expect(s.kick('a1', 'c3').ok).toBe(true);
    expect(s.partyOf('a1')!.members).toEqual(['a1', 'b2']);
  });
});
