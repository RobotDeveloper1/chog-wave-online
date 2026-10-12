import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Talking and playing together, from the server's side: who hears a line, how a party forms and
 * dissolves, and what the voice relay refuses. Every rule here is one a client cannot be trusted
 * with — a message can claim to be in a party, to be whispering to someone, to be dialling a
 * stranger — so the server is the one that has to know it is not.
 */

let dir: string;
let World: typeof import('../src/world.ts').World;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-party-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  ({ World } = await import('../src/world.ts'));
});

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* windows keeps the sqlite handle a moment */
  }
});

afterEach(() => vi.restoreAllMocks());

type Push = Record<string, unknown>;

/** A world with some players in it, each with a push inbox, and one inbox for every chat line said. */
function room(...tokens: number[]) {
  const world = new World();
  const lines: { id: string; name: string; channel: string; text: string; to?: string; rcpt?: string[] }[] = [];
  world.onChat((l) => lines.push(l));
  const players = tokens.map((token) => {
    const p = world.join(`p${token}`, { tokenId: token, transferCount: 0, daysHeld: 0 }, 'ashflat');
    const inbox: Push[] = [];
    world.onPush(p.id, (m) => inbox.push(m));
    return { p, id: p.id, name: p.build.callsign, inbox };
  });
  return { world, lines, players };
}

const parties = (inbox: Push[]): Push[] => inbox.filter((m) => m.t === 'party');
const lastParty = (inbox: Push[]): Push => parties(inbox).at(-1)!;

describe('chat', () => {
  it('goes to the whole city, and is kept for whoever arrives later', () => {
    const { world, lines, players } = room(5001, 5002);
    expect(world.say(players[0]!.id, 'global', 'hello city').ok).toBe(true);
    expect(lines.at(-1)).toMatchObject({ channel: 'global', text: 'hello city', name: players[0]!.name });
    expect(lines.at(-1)!.rcpt).toBeUndefined();
    expect(world.history().map((l) => l.text)).toContain('hello city');
  });

  it('stops a flood, tells the sender, and lets them speak again once the window has passed', () => {
    const { world, players } = room(5003);
    const id = players[0]!.id;
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    for (let i = 0; i < 6; i++) expect(world.say(id, 'global', `line ${i}`).ok).toBe(true);
    const seventh = world.say(id, 'global', 'too many');
    expect(seventh.ok).toBe(false);
    expect(seventh.reason).toMatch(/slow down/);
    now += 10_500;
    expect(world.say(id, 'global', 'back again').ok).toBe(true);
  });

  it('ignores an empty line and strips control characters', () => {
    const { world, lines, players } = room(5004);
    expect(world.say(players[0]!.id, 'global', '   ').ok).toBe(false);
    world.say(players[0]!.id, 'global', 'a\u0007b\u001bc');
    expect(lines.at(-1)!.text).toBe('abc');
  });

  it('puts a party line in front of the party and no one else, and keeps it out of the history', () => {
    const { world, lines, players } = room(5010, 5011, 5012);
    const [a, b, c] = players as [(typeof players)[0], (typeof players)[0], (typeof players)[0]];
    expect(world.say(a.id, 'party', 'anyone?').reason).toMatch(/not in a party/);
    world.partyAction(a.id, { action: 'invite', with: b.id });
    world.partyAction(b.id, { action: 'accept' });
    expect(world.say(a.id, 'party', 'ready when you are').ok).toBe(true);
    const line = lines.at(-1)!;
    expect(line.channel).toBe('party');
    expect(line.rcpt!.sort()).toEqual([a.id, b.id].sort());
    expect(line.rcpt).not.toContain(c.id);
    expect(world.history().map((l) => l.text)).not.toContain('ready when you are');
  });

  it('whispers to one person by name, for them and the sender only', () => {
    const { world, lines, players } = room(5020, 5021, 5022);
    const [a, b, c] = players as [(typeof players)[0], (typeof players)[0], (typeof players)[0]];
    expect(world.say(a.id, 'whisper', 'psst', b.name.toLowerCase()).ok).toBe(true);
    const line = lines.at(-1)!;
    expect(line).toMatchObject({ channel: 'whisper', to: b.name });
    expect(line.rcpt!.sort()).toEqual([a.id, b.id].sort());
    expect(line.rcpt).not.toContain(c.id);
    // a token number is a name too: callsigns have spaces and a hash in them, and nobody types those
    expect(world.say(a.id, 'whisper', 'psst again', '#' + String(c.p.tokenId)).ok).toBe(true);
    expect(lines.at(-1)).toMatchObject({ to: c.name });
    expect(world.say(a.id, 'whisper', 'psst', 'Nobody Atall').reason).toMatch(/nobody here is called/);
    expect(world.say(a.id, 'whisper', 'psst', a.name).ok).toBe(false);
  });
});

describe('the party', () => {
  it('forms by invitation: the invited is asked, and says yes, and both see the same party', () => {
    const { world, players } = room(5030, 5031);
    const [a, b] = players as [(typeof players)[0], (typeof players)[0]];
    world.partyAction(a.id, { action: 'invite', with: b.id });
    expect(lastParty(b.inbox)).toMatchObject({ invite: { from: a.id, name: a.name } });
    expect(lastParty(a.inbox)).toMatchObject({ notice: `invited ${b.name}` });
    // nothing has happened to the party yet: an invitation is not a membership
    expect(world.social.partyOf(a.id)).toBeNull();

    world.partyAction(b.id, { action: 'accept' });
    for (const who of [a, b]) {
      const view = lastParty(who.inbox) as { members: { id: string }[]; leader: string };
      expect(view.members.map((m) => m.id)).toEqual([a.id, b.id]);
      expect(view.leader).toBe(a.id);
    }
  });

  it('can be declined, and the inviter is told', () => {
    const { world, players } = room(5032, 5033);
    const [a, b] = players as [(typeof players)[0], (typeof players)[0]];
    world.partyAction(a.id, { action: 'invite', with: b.id });
    world.partyAction(b.id, { action: 'decline' });
    expect(lastParty(a.inbox)).toMatchObject({ notice: `${b.name} declined` });
    world.partyAction(b.id, { action: 'accept' });
    expect(lastParty(b.inbox)).toMatchObject({ refused: expect.stringMatching(/run out/) });
  });

  it('refuses an invitation to yourself, to someone who is already in, and from someone who is not the leader', () => {
    const { world, players } = room(5034, 5035, 5036);
    const [a, b, c] = players as [(typeof players)[0], (typeof players)[0], (typeof players)[0]];
    world.partyAction(a.id, { action: 'invite', with: a.id });
    expect(lastParty(a.inbox)).toMatchObject({ refused: expect.stringMatching(/yourself/) });
    world.partyAction(a.id, { action: 'invite', with: b.id });
    world.partyAction(b.id, { action: 'accept' });
    world.partyAction(a.id, { action: 'invite', with: b.id });
    expect(lastParty(a.inbox)).toMatchObject({ refused: expect.stringMatching(/already in your party/) });
    world.partyAction(b.id, { action: 'invite', with: c.id });
    expect(lastParty(b.inbox)).toMatchObject({ refused: expect.stringMatching(/only the leader/) });
  });

  it('holds four, and no more', () => {
    const { world, players } = room(5040, 5041, 5042, 5043, 5044);
    const leader = players[0]!;
    for (const who of players.slice(1, 4)) {
      world.partyAction(leader.id, { action: 'invite', with: who.id });
      world.partyAction(who.id, { action: 'accept' });
    }
    expect(world.social.partyOf(leader.id)!.members).toHaveLength(4);
    world.partyAction(leader.id, { action: 'invite', with: players[4]!.id });
    expect(lastParty(leader.inbox)).toMatchObject({ refused: 'party full' });
  });

  it('lets the leader remove someone, and nobody else', () => {
    const { world, players } = room(5045, 5046, 5047);
    const [a, b, c] = players as [(typeof players)[0], (typeof players)[0], (typeof players)[0]];
    for (const who of [b, c]) {
      world.partyAction(a.id, { action: 'invite', with: who.id });
      world.partyAction(who.id, { action: 'accept' });
    }
    world.partyAction(b.id, { action: 'kick', with: c.id });
    expect(lastParty(b.inbox)).toMatchObject({ refused: expect.stringMatching(/only the leader/) });
    world.partyAction(a.id, { action: 'kick', with: c.id });
    expect(lastParty(c.inbox)).toMatchObject({ members: [], notice: expect.stringMatching(/removed/) });
    expect(world.social.partyOf(a.id)!.members).toEqual([a.id, b.id]);
  });

  it('tells whoever is left when a member leaves, and dissolves a party of one', () => {
    const { world, players } = room(5050, 5051);
    const [a, b] = players as [(typeof players)[0], (typeof players)[0]];
    world.partyAction(a.id, { action: 'invite', with: b.id });
    world.partyAction(b.id, { action: 'accept' });
    world.partyAction(b.id, { action: 'leave' });
    expect(lastParty(b.inbox)).toMatchObject({ members: [], notice: 'you left the party' });
    expect(lastParty(a.inbox)).toMatchObject({ members: [], notice: `${b.name} left the party` });
    expect(world.social.partyOf(a.id)).toBeNull();
  });

  it('drops a player who disconnects out of the party, and tells the rest', () => {
    const { world, players } = room(5052, 5053, 5054);
    const [a, b, c] = players as [(typeof players)[0], (typeof players)[0], (typeof players)[0]];
    for (const who of [b, c]) {
      world.partyAction(a.id, { action: 'invite', with: who.id });
      world.partyAction(who.id, { action: 'accept' });
    }
    world.leave(b.id);
    const view = lastParty(a.inbox) as { members: { id: string }[] };
    expect(view.members.map((m) => m.id)).toEqual([a.id, c.id]);
  });

  it('does not let an invitation outlive its welcome', () => {
    const { world, players } = room(5055, 5056);
    const [a, b] = players as [(typeof players)[0], (typeof players)[0]];
    let now = 5_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    world.partyAction(a.id, { action: 'invite', with: b.id });
    now += 60_000;
    world.partyAction(b.id, { action: 'accept' });
    expect(lastParty(b.inbox)).toMatchObject({ refused: expect.stringMatching(/run out/) });
  });

  it('names who is nearby, so a player can be invited from the street', () => {
    const { world, players } = room(5057, 5058);
    const seen = world.snapshot(players[0]!.id).players;
    expect(seen.map((p) => (p as { name?: string }).name).sort()).toEqual(players.map((p) => p.name).sort());
  });
});

describe('the voice relay', () => {
  const setup = () => {
    const r = room(5060, 5061, 5062);
    const [a, b, c] = r.players as [(typeof r.players)[0], (typeof r.players)[0], (typeof r.players)[0]];
    r.world.partyAction(a.id, { action: 'invite', with: b.id });
    r.world.partyAction(b.id, { action: 'accept' });
    return { ...r, a, b, c };
  };
  const rtc = (inbox: Push[]): Push[] => inbox.filter((m) => m.t === 'rtc');

  it('carries an offer between two members of a party, and says who it is from', () => {
    const { world, a, b } = setup();
    world.relayRtc(a.id, { to: b.id, kind: 'offer', data: { sdp: 'v=0' } });
    expect(rtc(b.inbox)).toEqual([{ t: 'rtc', from: a.id, kind: 'offer', data: { sdp: 'v=0' } }]);
  });

  it('will not dial a stranger, itself, or a party it is not in', () => {
    const { world, a, c } = setup();
    world.relayRtc(a.id, { to: c.id, kind: 'offer', data: {} });
    world.relayRtc(c.id, { to: a.id, kind: 'offer', data: {} });
    world.relayRtc(a.id, { to: a.id, kind: 'offer', data: {} });
    expect(rtc(c.inbox)).toEqual([]);
    expect(rtc(a.inbox)).toEqual([]);
  });

  it('only passes the introductions it knows, and nothing after the party is gone', () => {
    const { world, a, b } = setup();
    world.relayRtc(a.id, { to: b.id, kind: 'pwn', data: {} });
    world.relayRtc(a.id, { to: b.id, kind: 'ice', data: { candidate: 'x' } });
    expect(rtc(b.inbox).map((m) => m.kind)).toEqual(['ice']);
    world.partyAction(b.id, { action: 'leave' });
    world.relayRtc(a.id, { to: b.id, kind: 'offer', data: {} });
    expect(rtc(b.inbox).map((m) => m.kind)).toEqual(['ice']);
  });
});
