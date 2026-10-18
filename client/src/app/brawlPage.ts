import { MAX_WAGER, wagerPayout } from '@chog/shared';

/**
 * The wager picker: name your price before both boots step on.
 *
 * Zero is an honor brawl, as before. Anything above is matched by whoever accepts —
 * both sides lock the same stake, the winner takes the pot minus the team's five
 * percent. The panel shows the split before a single $CHOG moves, so nobody accepts
 * a price they did not read.
 */

const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export interface WagerApi {
  send(to: string, wager: number): void;
}

let el: HTMLElement | null = null;

export function wagerPickerOpen(): boolean {
  return el !== null;
}

export function closeWagerPicker(): void {
  if (el) {
    el.remove();
    el = null;
  }
}

const PRESETS = [0, 50, 100, 500];

export function openWagerPicker(withId: string, name: string, balance: number, api: WagerApi): void {
  closeWagerPicker();
  const panel = document.createElement('div');
  panel.id = 'wager-picker';
  const split = (v: number): string => {
    if (v <= 0) return 'honor only — no $CHOG moves';
    const { prize, rake } = wagerPayout(v);
    return `pot ${v * 2} · winner ${prize} · team ${rake}`;
  };
  panel.innerHTML = `
    <header><b>CHALLENGE ${esc(name)}</b><small>you hold ${balance.toLocaleString()} $CHOG</small></header>
    <div class="wg-presets">${PRESETS.map((v) => `<button data-w="${v}">${v === 0 ? 'HONOR' : v}</button>`).join('')}</div>
    <div class="wg-custom"><input type="number" min="0" max="${MAX_WAGER}" step="1" value="0" aria-label="wager"><span>$CHOG a side</span></div>
    <div class="wg-split">${esc(split(0))}</div>
    <footer><button data-t="send">SEND CHALLENGE</button><button data-t="close">CLOSE</button></footer>`;
  const input = panel.querySelector('input')!;
  const splitEl = panel.querySelector('.wg-split')!;
  const current = (): number => Math.max(0, Math.min(MAX_WAGER, Math.floor(Number(input.value) || 0)));
  const repaint = (): void => {
    splitEl.textContent = split(current());
  };
  panel.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.t === 'close') {
      closeWagerPicker();
      return;
    }
    if (button.dataset.w !== undefined) {
      input.value = button.dataset.w;
      repaint();
      return;
    }
    if (button.dataset.t === 'send') {
      api.send(withId, current());
      closeWagerPicker();
    }
  });
  input.addEventListener('input', repaint);
  document.body.appendChild(panel);
  el = panel;
  input.focus();
}
