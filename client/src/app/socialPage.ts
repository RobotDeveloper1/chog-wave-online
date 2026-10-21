import './pages.css';
import type { RemotePlayer } from '@chog/shared';
import { FURNITURE, FURNITURE_IDS } from '@chog/shared';
import { friends } from './friends.ts';

/**
 * The SOCIAL page: home, friends, and the people standing next to you.
 *
 * PARTY is the fighting unit; this is everyone else. The friends book is local
 * (see `friends.ts`), presence comes from the world's roster, and the house
 * section is the owner's whole decorating desk: stock, selection, turn, pick up.
 * Nothing here moves a pixel of furniture — every button sends a request, and
 * what the page shows next is the server's answer.
 */

export interface HouseStore {
  /** This player's own id, so the roster can say "you". */
  me: string | null;
  /** Whose room is open, by save key. Null on the street. */
  atHome: string | null;
  /** True when the open room is their own: only the owner is sent stock. */
  owner: boolean;
  /** Stock to place, for the owner's eyes only. */
  owned: Record<string, number>;
  /** Placed pieces, echoed from the last layout. */
  placed: { uid: string; fid: string }[];
  invite: { from: string; name: string; at: number } | null;
  /** Arrange mode: clicks land furniture instead of menus. */
  editing: boolean;
  selFid: string | null;
  selUid: string | null;
  nearby: RemotePlayer[];
  /** The last line about the house (sent, declined, refused). */
  notice: string;
}

export const house: HouseStore = {
  me: null, atHome: null, owner: false, owned: {}, placed: [], invite: null,
  editing: false, selFid: null, selUid: null, nearby: [], notice: '',
};

export interface SocialApi {
  goHome(): void;
  leaveHome(): void;
  arrange(on: boolean): void;
  select(fid: string | null): void;
  turn(): void;
  pickup(): void;
  inviteHome(id: string): void;
  acceptHome(): void;
  declineHome(): void;
  friend(tokenId: number): void;
  whisper(tokenId: number): void;
}

const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

const stockCount = (fid: string): number => {
  const owned = house.owned[fid] ?? 0;
  const down = house.placed.filter((p) => p.fid === fid).length;
  return Math.max(0, owned - down);
};

export function renderSocial(): string {
  const { atHome, owner, invite, editing, selFid, selUid, nearby, me, notice } = house;
  const mine = atHome !== null;

  const inviteBox = invite
    ? `<div class="ask"><b>${esc(invite.name)}</b><span>invited you home</span>
      <div class="row"><button data-s="accept">COME OVER</button><button data-s="decline">NOT NOW</button></div></div>`
    : '';

  const sel = selUid ? house.placed.find((p) => p.uid === selUid) : null;
  const stock = FURNITURE_IDS.map((fid) => {
    const n = stockCount(fid);
    if (n <= 0 && selFid !== fid) return '';
    return `<button data-s="select" data-id="${fid}" class="${selFid === fid ? 'on' : ''}" ${n <= 0 ? 'disabled' : ''}>${esc(FURNITURE[fid]!.name)}<small>x${n}</small></button>`;
  }).join('');

  const home = !mine
    ? `<div class="row"><button data-s="home">GO HOME</button></div>`
    : `<div class="row"><button data-s="leave">STEP OUT</button>
      ${owner ? `<button data-s="arrange" class="${editing ? 'on' : ''}">${editing ? 'DONE' : 'ARRANGE'}</button>` : `<span class="x">guest of #${atHome}</span>`}</div>
      ${editing ? `<div class="lbl">STOCK — PICK, THEN CLICK THE FLOOR</div><div class="stock">${stock || '<span class="x">nothing left — the shop restocks never, buy more</span>'}</div>
      ${sel ? `<div class="row"><span class="x">${esc(FURNITURE[sel.fid]?.name ?? sel.fid)}</span><button data-s="turn">TURN</button><button data-s="pickup">PICK UP</button></div>` : '<div class="x">click a piece to turn it or pick it up · double-click picks up at once</div>'}` : ''}`;

  const known = friends.all();
  const onlineByToken = new Map<number, RemotePlayer>();
  for (const p of nearby) onlineByToken.set(p.tokenId, p);
  const friendRows = known
    .map((token) => {
      const on = onlineByToken.get(token);
      return `<div class="frow"><span class="dot ${on ? 'on' : ''}"></span><b>${esc(on?.name ?? `CHOG #${token}`)}</b>
        <span class="x">${on ? `LV ${on.level ?? 1}` : 'away'}</span>
        ${on && on.id !== me ? `<button data-s="invite" data-id="${on.id}">INVITE HOME</button>` : ''}
        <button data-s="whisper" data-id="${token}">W</button><button data-s="friend" data-id="${token}">DROP</button></div>`;
    })
    .join('');
  const strangerRows = nearby
    .filter((p) => p.id !== me && !known.includes(p.tokenId))
    .map((p) => `<div class="frow"><span class="dot on"></span><b>${esc(p.name ?? `CHOG #${p.tokenId}`)}</b>
      <span class="x">LV ${p.level ?? 1} · nearby</span>
      <button data-s="invite" data-id="${p.id}">INVITE HOME</button>
      <button data-s="friend" data-id="${p.tokenId}">+ FRIEND</button></div>`)
    .join('');

  return `<div class="social">
    ${inviteBox}
    <section><div class="lbl">HOME</div>${home}${notice ? `<div class="x">${esc(notice)}</div>` : ''}</section>
    <section><div class="lbl">FRIENDS <span class="x">${known.length} kept</span></div>${friendRows || '<div class="x">nobody kept yet — stand near a chog and keep them</div>'}</section>
    <section><div class="lbl">NEARBY</div>${strangerRows || '<div class="x">no strangers in reach</div>'}</section>
  </div>`;
}

/** This player's token, when the profile has arrived. Set by the shell. */


export function bindSocial(el: HTMLElement, api: SocialApi): void {
  el.querySelectorAll<HTMLElement>('[data-s]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id ?? '';
      switch (b.dataset.s) {
        case 'home':
          api.goHome();
          break;
        case 'leave':
          api.leaveHome();
          break;
        case 'arrange':
          api.arrange(!house.editing);
          break;
        case 'select':
          api.select(house.selFid === id ? null : id);
          break;
        case 'turn':
          api.turn();
          break;
        case 'pickup':
          api.pickup();
          break;
        case 'invite':
          api.inviteHome(id);
          break;
        case 'accept':
          api.acceptHome();
          break;
        case 'decline':
          api.declineHome();
          break;
        case 'friend':
          api.friend(Number(id));
          break;
        case 'whisper':
          api.whisper(Number(id));
          break;
      }
    }),
  );
}
