import './pages.css';
import type { PartyMsg, RemotePlayer } from '@chog/shared';
import { ELEMENT_COLOUR, ELEMENT_ICON } from './hud/icons.ts';
import type { Voice } from './voice.ts';

/**
 * The PARTY page: who you are playing with, who is nearby to ask, and the voice switch.
 *
 * It is a view over a small store the shell keeps up to date from the server's `party` pushes and
 * the street's roster. Nothing here forms a party: every button sends a request, and what the
 * page shows next is the server's answer.
 */

export interface PartyStore {
  /** This player's own id, so the roster can say "you". */
  me: string | null;
  party: PartyMsg | null;
  invite: { from: string; name: string; at: number } | null;
  nearby: RemotePlayer[];
  voice: Voice | null;
  /** The last line the server sent about the party (sent, declined, refused). */
  notice: string;
}

export const social: PartyStore = { me: null, party: null, invite: null, nearby: [], voice: null, notice: '' };

export interface PartyApi {
  invite(id: string): void;
  accept(): void;
  decline(): void;
  leave(): void;
  kick(id: string): void;
  voiceToggle(): void;
  ptt(on: boolean): void;
  mute(on: boolean): void;
  whisper(tokenId: number): void;
}

const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** The party size the server allows: four, so a linked fight fills a field. */
export const PARTY_MAX = 4;

export function renderParty(): string {
  const { party, invite, nearby, voice, me, notice } = social;
  const members = party?.members ?? [];
  const inParty = members.length > 1;
  const leader = party?.leader ?? '';
  const iLead = !inParty || leader === me;
  const speaking = voice?.speaking() ?? new Set<string>();

  const rows = members
    .map((m) => {
      const mine = m.id === me;
      const col = ELEMENT_COLOUR[m.tribe] ?? 'var(--violet)';
      const talk = speaking.has(mine ? 'me' : m.id);
      const link = mine ? '' : voice?.enabled ? voice.status(m.id) : 'none';
      return `<div class="pm ${talk ? 'talk' : ''}" style="--c:${col}">
        <span class="el">${ELEMENT_ICON[m.tribe] ?? ''}</span>
        <span class="nm"><b>${esc(m.name)}${mine ? ' <em>you</em>' : ''}</b><small>${m.id === leader ? '★ leader · ' : ''}LV ${m.level}</small></span>
        <span class="vs" title="${talk ? 'speaking' : link === 'live' ? 'voice connected' : link === 'connecting' ? 'connecting…' : link === 'failed' ? 'voice failed' : 'no voice'}">${talk ? '◉' : link === 'live' ? '●' : link === 'connecting' ? '○' : link === 'failed' ? '✕' : ''}</span>
        ${iLead && !mine ? `<button data-p="kick" data-id="${esc(m.id)}" title="remove from the party">✕</button>` : '<span></span>'}
      </div>`;
    })
    .join('');

  const taken = new Set(members.map((m) => m.id));
  const can = iLead && members.length < PARTY_MAX;
  const near = nearby
    .filter((p) => p.id !== me)
    .map((p) => {
      const col = ELEMENT_COLOUR[p.tribe ?? ''] ?? 'var(--violet)';
      const inMine = taken.has(p.id);
      return `<div class="pm near" style="--c:${col}">
        <span class="el">${ELEMENT_ICON[p.tribe ?? ''] ?? ''}</span>
        <span class="nm"><b>${esc(p.name ?? `CHOG #${p.tokenId}`)}</b><small>LV ${p.level ?? 1} · #${p.tokenId}</small></span>
        <button data-p="whisper" data-id="${p.tokenId}" title="whisper to them">✉</button>
        ${inMine ? '<span class="vs">in party</span>' : `<button data-p="invite" data-id="${esc(p.id)}" ${can ? '' : 'disabled'} title="${can ? 'ask them to join' : iLead ? 'the party is full' : 'only the leader invites'}">INVITE</button>`}
      </div>`;
    })
    .join('');

  const banner = invite
    ? `<div class="pinv"><span><b>${esc(invite.name)}</b> asks you to join a party</span><button class="yes" data-p="accept"><span class="key">Y</span> ACCEPT</button><button data-p="decline"><span class="key">N</span> DECLINE</button></div>`
    : '';

  const voicePanel = inParty
    ? `<section class="pv">
        <header>VOICE <small>${voice?.enabled ? 'on — only your party hears you' : 'off — nothing is sent until you turn it on'}</small></header>
        <div class="pvb">
          <button class="${voice?.enabled ? 'on' : ''}" data-p="voice">${voice?.enabled ? '◉ VOICE ON' : '○ TURN VOICE ON'}</button>
          <button class="${voice?.pushToTalk ? 'on' : ''}" data-p="ptt" data-v="1" ${voice?.enabled ? '' : 'disabled'}>PUSH TO TALK <span class="key">T</span></button>
          <button class="${voice && !voice.pushToTalk ? 'on' : ''}" data-p="ptt" data-v="0" ${voice?.enabled ? '' : 'disabled'}>OPEN MIC</button>
          <button class="${voice?.muted ? 'on warn' : ''}" data-p="mute" ${voice?.enabled ? '' : 'disabled'}>${voice?.muted ? 'MUTED' : 'MUTE'}</button>
        </div>
        ${voice?.error ? `<p class="bad">${esc(voice.error)}</p>` : '<p>Voice is peer to peer: your browser asks for the microphone, and the audio goes straight to your party, never through the server.</p>'}
      </section>`
    : '';

  return `<div class="party">
    <header class="ph"><span>PARTY</span><b>${members.length || 1}/${PARTY_MAX}</b><small>${inParty ? 'a party shares the Link ward in storms' : 'up to four Chogs fight as one'}</small></header>
    ${banner}
    ${notice ? `<div class="pnote">${esc(notice)}</div>` : ''}
    <div class="pcols">
      <section class="pl">
        <h3>YOUR PARTY</h3>
        <div class="plist">${rows || '<div class="idle">You are on your own. Ask someone from the list — they get a prompt and can say no.</div>'}</div>
        ${inParty ? '<button class="leave" data-p="leave">LEAVE THE PARTY</button>' : ''}
      </section>
      <section class="pl">
        <h3>IN THE CITY <small>${nearby.filter((p) => p.id !== me).length}</small></h3>
        <div class="plist">${near || '<div class="idle">Nobody else is out on the street right now.</div>'}</div>
      </section>
    </div>
    ${voicePanel}
  </div>`;
}

export function bindParty(el: HTMLElement, api: PartyApi): void {
  el.querySelectorAll<HTMLElement>('[data-p]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id ?? '';
      switch (b.dataset.p) {
        case 'invite':
          api.invite(id);
          break;
        case 'accept':
          api.accept();
          break;
        case 'decline':
          api.decline();
          break;
        case 'leave':
          api.leave();
          break;
        case 'kick':
          api.kick(id);
          break;
        case 'voice':
          api.voiceToggle();
          break;
        case 'ptt':
          api.ptt(b.dataset.v === '1');
          break;
        case 'mute':
          api.mute(!(social.voice?.muted ?? false));
          break;
        case 'whisper':
          api.whisper(Number(id));
          break;
      }
    }),
  );
}
