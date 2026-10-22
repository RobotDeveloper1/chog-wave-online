import { WITHDRAW_DAILY_MAX } from '@chog/shared';

const esc = (s: string): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * The CASH tab: real $CHOG in and out.
 *
 * Deposits are an address and patience — whole coins sent to the vault credit
 * on their own. Withdrawals are a form: the server debits at request time and
 * the payout pump sends the coins, so the number on screen is always already
 * spent. Nothing here moves money by itself; every button is a request the
 * server answers, and the answer repaints the page.
 */

export interface CashView {
  vault: string | null;
  balance: number;
}

export interface CashApi {
  withdraw(amount: number): void;
  copy(text: string): void;
}

export function renderCash(view: CashView | null, problem = '', notice = ''): string {
  if (!view) {
    return `<div class="sheet">${
      problem
        ? `<div class="idle" style="color:var(--rose)">${esc(problem)} — is the server running this build?</div>`
        : '<div class="idle">asking the vault…</div>'
    }</div>`;
  }
  const deposit = view.vault
    ? `<div class="line"><span class="line-main"><b>DEPOSIT</b><span class="x">${esc(view.vault.slice(0, 10))}…${esc(view.vault.slice(-6))}</span></span>
      <span class="d">send $CHOG to this address — whole coins credit automatically, dust stays unclaimed</span>
      <button data-cash="copy" data-vault="${esc(view.vault)}">COPY</button></div>`
    : `<div class="line"><span class="line-main"><b>DEPOSIT</b></span>
      <span class="d">paper mode — the vault is not configured on this server, so balances are play money</span></div>`;
  return `<div class="sheet">
    <div class="phead"><span class="chog">${view.balance.toLocaleString()} $CHOG</span><span class="right">the vault is the only account</span></div>
    ${deposit}
    <div class="line"><span class="line-main"><b>WITHDRAW</b>
      <span class="x"><input data-cash="amount" type="number" min="1" step="1" placeholder="0" aria-label="amount"> $CHOG</span></span>
      <span class="d">automatic payout to your linked wallet · up to ${WITHDRAW_DAILY_MAX.toLocaleString()} a day · debited the moment you ask</span>
      <button data-cash="send">SEND</button></div>
    ${notice ? `<div class="line"><span class="d">${esc(notice)}</span></div>` : ''}
  </div>`;
}

export function bindCash(el: HTMLElement, api: CashApi): void {
  el.querySelectorAll<HTMLElement>('[data-cash]').forEach((b) => {
    const kind = b.dataset.cash;
    if (kind === 'copy') {
      b.addEventListener('click', () => api.copy(b.dataset.vault ?? ''));
      return;
    }
    if (kind === 'send') {
      b.addEventListener('click', () => {
        const input = el.querySelector<HTMLInputElement>('[data-cash="amount"]');
        api.withdraw(Math.floor(Number(input?.value ?? 0)));
      });
    }
  });
}
