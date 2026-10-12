import { wardBroken, type Element, type SectorId } from '@chog/shared';

/**
 * The multiplayer fabric: who is here, who is linked to whom, what is being
 * offered, and which tribe a player belongs to.
 *
 * This lives apart from the world simulation on purpose. The world owns positions
 * and bosses; this owns *relationships*, which are the part that has to survive a
 * player changing rooms, sectors or instances. Bolting them onto World would mean
 * every room transition has to remember to re-attach them, which is the kind of
 * bug that only shows up as a lost friend list three hours later.
 */

/** The slice of a connected player this module needs, without importing World. */
export interface SocialPlayer {
  id: string;
  tokenId: number;
  sector: SectorId;
  room: string;
  build: { callsign: string; loadout: { element: Element } };
  save: { kills: number; updatedAt: number };
}

export interface Presence {
  id: string;
  tokenId: number;
  name: string;
  sector: SectorId;
  room: string;
  level: number;
  tribe: Element;
  /** Where the player currently is, so the roster reads as a world not a lobby. */
  doing: 'street' | 'battle' | 'trading' | 'idle';
  kills: number;
  since: number;
}

export interface Party {
  id: string;
  /** Leader first. Capped at four, which is what the field's files can support. */
  members: string[];
  formed: number;
}

/** An open invitation to a party, until it is answered or runs out. */
export interface PartyInvite {
  from: string;
  at: number;
}

export const INVITE_TTL_MS = 45_000;

export interface TradeOffer {
  id: string;
  from: string;
  to: string;
  giving: string[];
  wanting: string[];
  /** Cards are held out but not transferred until both sides confirm. */
  accepted: boolean;
  made: number;
}

let seq = 0;
const nextId = (p: string) => `${p}${(seq++).toString(36)}${Date.now().toString(36).slice(-4)}`;

export class Social {
  parties = new Map<string, Party>();
  /** playerId -> partyId */
  private inParty = new Map<string, string>();
  trades = new Map<string, TradeOffer>();
  /** playerId -> the invitation waiting for them (one at a time) */
  invites = new Map<string, PartyInvite>();
  /** playerId -> pending offers addressed to them */
  private inbox = new Map<string, Set<string>>();

  presence(p: SocialPlayer, doing: Presence['doing']): Presence {
    return {
      id: p.id,
      tokenId: p.tokenId,
      name: p.build.callsign,
      sector: p.sector,
      room: p.room,
      level: 1 + Math.floor(Math.sqrt(p.save.kills)),
      tribe: p.build.loadout.element,
      doing,
      kills: p.save.kills,
      since: p.save.updatedAt || Date.now(),
    };
  }

  // ---------------------------------------------------------------- parties

  partyOf(id: string): Party | null {
    const pid = this.inParty.get(id);
    return pid ? this.parties.get(pid) ?? null : null;
  }

  /**
   * Linking up. Solo players get their own one-person party so the rest of the
   * code never has to special-case "not in a group", which is how these things
   * usually start leaking.
   */
  link(a: string, b: string): { ok: boolean; reason?: string; party?: Party } {
    if (a === b) return { ok: false, reason: 'yourself' };
    const pa = this.partyOf(a);
    const pb = this.partyOf(b);
    if (pa && pb) {
      if (pa.id === pb.id) return { ok: true, party: pa };
      // Two partial parties merge; only two that are both at capacity refuse.
      if (pa.members.length + pb.members.length > 4) return { ok: false, reason: 'party full' };
    } else if (pa && pa.members.length >= 4) return { ok: false, reason: 'party full' };
    else if (pb && pb.members.length >= 4) return { ok: false, reason: 'party full' };

    const party = pa ?? { id: nextId('p-'), members: [a], formed: Date.now() };
    if (pb) {
      for (const m of pb.members) this.inParty.delete(m);
      this.parties.delete(pb.id);
      party.members.push(...pb.members);
    } else {
      party.members.push(b);
    }
    for (const m of party.members) this.inParty.set(m, party.id);
    this.parties.set(party.id, party);
    return { ok: true, party };
  }

  unlink(id: string): void {
    this.invites.delete(id);
    for (const [to, inv] of this.invites) if (inv.from === id) this.invites.delete(to);
    const party = this.partyOf(id);
    if (!party) return;
    party.members = party.members.filter((m) => m !== id);
    this.inParty.delete(id);
    if (party.members.length === 0) this.parties.delete(party.id);
    else if (party.members.length === 1) {
      // A party of one is just a person standing alone; drop the indirection.
      const [only] = party.members;
      this.inParty.delete(only!);
      this.parties.delete(party.id);
    }
  }

  /** The party's leader: whoever stood first. A solo player leads themselves. */
  leader(id: string): string {
    return this.partyOf(id)?.members[0] ?? id;
  }

  /**
   * Ask someone to join. Only a leader (or someone alone) may invite, so a party has one
   * person deciding who is in it, and a full party cannot be over-invited.
   */
  invite(from: string, to: string, now = Date.now()): { ok: boolean; reason?: string } {
    if (from === to) return { ok: false, reason: 'you cannot invite yourself' };
    const mine = this.partyOf(from);
    const theirs = this.partyOf(to);
    if (mine && theirs && mine.id === theirs.id) return { ok: false, reason: 'already in your party' };
    if (mine && mine.members[0] !== from) return { ok: false, reason: 'only the leader invites' };
    if ((mine?.members.length ?? 1) + (theirs?.members.length ?? 1) > 4) return { ok: false, reason: 'party full' };
    this.invites.set(to, { from, at: now });
    return { ok: true };
  }

  /** The invitation waiting for `to`, unless it has run out. */
  inviteFor(to: string, now = Date.now()): PartyInvite | null {
    const inv = this.invites.get(to);
    if (!inv) return null;
    if (now - inv.at > INVITE_TTL_MS) {
      this.invites.delete(to);
      return null;
    }
    return inv;
  }

  /** Say yes: the two parties become one, with the inviter's side first. */
  acceptInvite(to: string, now = Date.now()): { ok: boolean; reason?: string; from?: string; party?: Party } {
    const inv = this.inviteFor(to, now);
    if (!inv) return { ok: false, reason: 'that invitation has run out' };
    this.invites.delete(to);
    const r = this.link(inv.from, to);
    return r.ok ? { ok: true, from: inv.from, ...(r.party ? { party: r.party } : {}) } : { ok: false, reason: r.reason ?? 'could not join' };
  }

  declineInvite(to: string): string | null {
    const inv = this.invites.get(to);
    this.invites.delete(to);
    return inv?.from ?? null;
  }

  /** The leader sends someone out of the party. */
  kick(leader: string, target: string): { ok: boolean; reason?: string } {
    const party = this.partyOf(leader);
    if (!party || party.members[0] !== leader) return { ok: false, reason: 'only the leader can' };
    if (leader === target || !party.members.includes(target)) return { ok: false, reason: 'not in your party' };
    this.unlink(target);
    return { ok: true };
  }

  /** Everyone sharing a party with `id`, including them. */
  withMe(id: string): string[] {
    return this.partyOf(id)?.members ?? [id];
  }

  /**
   * The Link gimmick: an anomaly warded by a shield that only comes down when two
   * linked players stand in adjacent files on the same beat. This is the reason to
   * bring someone rather than merely the company of them.
   */
  shieldHeld(id: string, occupiedCols: Map<string, number>): boolean {
    const party = this.partyOf(id);
    if (!party || party.members.length < 2) return true;
    // One rule, and it lives in `party.ts`: the ward comes down when two of them hold
    // neighbouring files. A body on the floor is not in `occupiedCols`, so the dead cannot
    // hold the line open — which is the moment a party learns it needed a third seat.
    const mine = party.members
      .map((m) => occupiedCols.get(m))
      .filter((c): c is number => c !== undefined);
    return !wardBroken(mine);
  }

  // ------------------------------------------------------------------ trade

  offer(from: string, to: string, giving: string[], wanting: string[]): TradeOffer {
    const t: TradeOffer = {
      id: nextId('t-'),
      from,
      to,
      giving: [...new Set(giving)].slice(0, 6),
      wanting: [...new Set(wanting)].slice(0, 6),
      accepted: false,
      made: Date.now(),
    };
    this.trades.set(t.id, t);
    if (!this.inbox.has(to)) this.inbox.set(to, new Set());
    this.inbox.get(to)!.add(t.id);
    return t;
  }

  pendingFor(id: string): TradeOffer[] {
    return [...(this.inbox.get(id) ?? [])].map((t) => this.trades.get(t)!).filter(Boolean);
  }

  cancel(tradeId: string): void {
    const t = this.trades.get(tradeId);
    if (!t) return;
    this.inbox.get(t.to)?.delete(tradeId);
    this.trades.delete(tradeId);
  }

  /**
   * Accept an offer. Returns the swap to apply, or why it cannot be applied.
   *
   * Both sides' holdings are re-checked here rather than at offer time, because a
   * player can spend or lose a card between being offered and accepting. That is
   * the whole difference between a trade that works and one that duplicates cards.
   */
  accept(tradeId: string, by: string, holdings: Record<string, string[]>):
    { ok: true; swap: { to: string; give: string[]; take: string[] } } | { ok: false; reason: string } {
    const t = this.trades.get(tradeId);
    if (!t) return { ok: false, reason: 'gone' };
    if (t.to !== by) return { ok: false, reason: 'not yours' };
    const fromCards = holdings[t.from] ?? [];
    const toCards = holdings[by] ?? [];
    if (!t.giving.every((c) => fromCards.includes(c))) return { ok: false, reason: 'they no longer hold it' };
    if (!t.wanting.every((c) => toCards.includes(c))) return { ok: false, reason: 'you no longer hold it' };
    this.cancel(tradeId);
    return { ok: true, swap: { to: t.from, give: t.wanting, take: t.giving } };
  }

  // ------------------------------------------------------------------ tribe

  /** Weekly tribe tally. Membership is just your element, so it costs nothing. */
  tally(byTribe: Map<Element, number>): { tribe: Element; score: number }[] {
    return [...byTribe.entries()]
      .map(([tribe, score]) => ({ tribe, score }))
      .sort((a, b) => b.score - a.score);
  }
}
