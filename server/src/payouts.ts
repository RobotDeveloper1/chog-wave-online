import { createPublicClient, createWalletClient, erc20Abi, http, type Chain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CFG } from './config.ts';
import type { Profiles } from './profiles.ts';
import type { SaveStore, WithdrawRow } from './save.ts';

/**
 * Automatic $CHOG payouts from the hot wallet.
 *
 * Withdrawals debit the ledger the moment they are requested ('chog.withdraw'),
 * so this side never decides whether the player can afford it — only whether the
 * chain can pay it. Each pending row is claimed atomically, paid with one ERC-20
 * transfer, and settled `done` with the tx hash. Anything that fails settles
 * `failed` and the debit is refunded, so a stuck payout is never lost money.
 *
 * The chain itself is behind `PayoutSender`, which is why this file is
 * unit-testable without an RPC in the room: production passes the viem sender,
 * tests pass a fake.
 */

export interface PayoutSender {
  /** Hot wallet $CHOG balance, in whole coins (floored). */
  balance(): Promise<number>;
  /** Transfer whole $CHOG. Resolves to the tx hash once it is on chain. */
  send(to: string, whole: number): Promise<string>;
  /** Null when the tx is unknown; otherwise whether it succeeded. */
  receiptOk(tx: string): Promise<boolean | null>;
}

export interface PayoutEvent {
  id: number;
  wallet: string;
  amount: number;
  ok: boolean;
  tx: string;
  note: string;
}

const monadChain = (id: number): Chain => ({
  id,
  name: id === 10143 ? 'Monad Testnet' : 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [CFG.rpcUrl] } },
});

export function createViemSender(): PayoutSender {
  const account = privateKeyToAccount(CFG.hotKey as Hex);
  const chainId = Number(CFG.chainId) || 143;
  const chain = monadChain(chainId);
  const transport = http(CFG.rpcUrl);
  const wallet = createWalletClient({ account, chain, transport });
  const pub = createPublicClient({ chain, transport });
  const token = CFG.chogToken as Hex;
  return {
    async balance(): Promise<number> {
      const raw = await pub.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      });
      return Number(raw / 10n ** 18n);
    },
    async send(to: string, whole: number): Promise<string> {
      const hash = await wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to as Hex, BigInt(whole) * 10n ** 18n],
        account,
        chain,
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('transfer reverted');
      return hash;
    },
    async receiptOk(tx: string): Promise<boolean | null> {
      try {
        const receipt = await pub.getTransactionReceipt({ hash: tx as Hex });
        return receipt.status === 'success';
      } catch {
        return null;
      }
    },
  };
}

export class PayoutProcessor {
  private running = false;
  private readonly saves: SaveStore;
  private readonly profiles: Profiles;
  private readonly sender: PayoutSender;
  private readonly onEvent: (e: PayoutEvent) => void;

  constructor(saves: SaveStore, profiles: Profiles, sender: PayoutSender, onEvent: (e: PayoutEvent) => void = () => {}) {
    this.saves = saves;
    this.profiles = profiles;
    this.sender = sender;
    this.onEvent = onEvent;
  }

  /** Rows a dead process left `sending` come back honest: re-check a recorded tx, requeue the rest. */
  async recover(): Promise<void> {
    for (const row of this.saves.withdrawReqAll()) {
      if (row.status !== 'sending') continue;
      if (!row.tx) {
        this.saves.withdrawRequeue(row.id);
        continue;
      }
      let ok: boolean | null = null;
      try {
        ok = await this.sender.receiptOk(row.tx);
      } catch {
        ok = null;
      }
      if (ok === true) {
        this.saves.withdrawSettle(row.id, 'done', row.tx, 'confirmed on boot');
        this.onEvent({ id: row.id, wallet: row.wallet, amount: row.amount, ok: true, tx: row.tx, note: '' });
      } else if (ok === false) {
        this.refund(row, 'tx reverted');
      } else {
        this.saves.withdrawRequeue(row.id);
      }
    }
  }

  /** Pay every pending row, oldest first. Re-entrant safe: one pump at a time. */
  async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const row of this.saves.withdrawPending()) {
        if (!this.saves.withdrawClaim(row.id)) continue;
        await this.pay(row);
      }
    } finally {
      this.running = false;
    }
  }

  private async pay(row: WithdrawRow): Promise<void> {
    try {
      const float = await this.sender.balance();
      if (float < row.amount) {
        this.saves.withdrawRequeue(row.id);
        this.onEvent({ id: row.id, wallet: row.wallet, amount: row.amount, ok: false, tx: '', note: 'vault float too low, requeued' });
        return;
      }
      const tx = await this.sender.send(row.wallet, row.amount);
      this.saves.withdrawSettle(row.id, 'done', tx);
      this.onEvent({ id: row.id, wallet: row.wallet, amount: row.amount, ok: true, tx, note: '' });
    } catch (err) {
      this.refund(row, err instanceof Error ? err.message : 'payout failed');
    }
  }

  private refund(row: WithdrawRow, note: string): void {
    this.profiles.addChog(row.savekey || row.wallet, row.amount);
    this.saves.withdrawSettle(row.id, 'failed', row.tx, note);
    this.onEvent({ id: row.id, wallet: row.wallet, amount: row.amount, ok: false, tx: row.tx, note });
  }
}
