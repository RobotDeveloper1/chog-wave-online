import { friends } from './friends.ts';

/**
 * The menu a right-click on another Chog opens on the street.
 *
 * "Walk up to someone and press a button" is how every MMO has ever done it, and this is that:
 * point at the Chog, right-click, ask them something. Everything in here talks to a system that
 * already exists — the party invite, the whisper, the contact book, the brawl challenge,
 * the trade offer — so the menu is a door, not a promise.
 */

const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export interface MenuTarget {
  id: string;
  tokenId: number;
  name: string;
  level: number;
}

export interface MenuActions {
  invite(id: string): void;
  pvp(id: string): void;
  trade(id: string): void;
  whisper(tokenId: number): void;
  /** Said back to the player, and it triggers a re-paint so a change elsewhere is visible now. */
  note(text: string): void;
}

let el: HTMLElement | null = null;

export function closePlayerMenu(): void {
  if (el) {
    el.remove();
    el = null;
  }
}

export function playerMenuOpen(): boolean {
  return el !== null;
}

export function openPlayerMenu(x: number, y: number, who: MenuTarget, actions: MenuActions): void {
  closePlayerMenu();
  const known = friends.has(who.tokenId);
  const menu = document.createElement('div');
  menu.id = 'player-menu';
  menu.innerHTML = `
    <header><b>${esc(who.name)}</b><small>LV ${who.level} · CHOG #${String(who.tokenId).padStart(4, '0')}</small></header>
    <button data-a="invite" title="ask them to join your party">✚ INVITE TO PARTY</button>
    <button data-a="whisper" title="open the chat, addressed to them">✉ WHISPER</button>
    <button data-a="friend" title="${known ? 'take them off your list' : 'keep them on your list'}">${known ? '★ REMOVE FRIEND' : '☆ ADD FRIEND'}</button>
    <button data-a="pvp" title="fight them live, both on the field">⚔ CHALLENGE TO BRAWL</button>
    <button data-a="trade" title="offer cards and items">⇄ TRADE</button>`;
  menu.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const a = button.dataset.a;
    if (a === 'invite') actions.invite(who.id);
    else if (a === 'pvp') actions.pvp(who.id);
    else if (a === 'trade') actions.trade(who.id);
    else if (a === 'whisper') actions.whisper(who.tokenId);
    else if (a === 'friend') {
      const now = friends.toggle(who.tokenId);
      actions.note(`${who.name} ${now ? 'is on' : 'is off'} your list`);
    }
    closePlayerMenu();
  });
  document.body.appendChild(menu);
  // Keep the whole menu on screen: a menu that opens off the edge is a menu nobody can use.
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - w - 6))}px`;
  menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - h - 6))}px`;
  el = menu;
}
