import type { SaleFact } from '@chog/shared';
import { WMON_ADDRESS } from '@chog/shared';

/**
 * Decodes Chog Genesis sales out of Seaport `OrderFulfilled` logs.
 *
 * An ERC-721 `Transfer` carries no price, so the game could not tell a 5 MON sale
 * from a 200,000 MON one — every transfer produced identical pressure. The chain
 * scan found 1,222 of 2,074 Genesis transfer transactions contain a Seaport fill,
 * and the fill is where the money actually is.
 *
 * Two traps this has to respect: a match emits *two* legs (the listing order and
 * the bid) inside one tx, so callers dedupe by tx+tokenId or every sale counts
 * twice; and roughly a third of fills settle in WMON rather than native MON.
 */

/** keccak256("OrderFulfilled(bytes32,address,address,address,(uint8,address,uint256,uint256)[],(uint8,address,uint256,uint256,address)[])") */
const ORDER_FULFILLED_TOPIC =
  '0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31';

const ERC20 = 1n;
const ERC721 = 2n;
const OFFER_STRIDE = 4;
const CONSIDERATION_STRIDE = 5;

interface Item {
  itemType: bigint;
  token: string;
  tokenId: bigint;
  amount: bigint;
  recipient?: string;
}

/**
 * Head layout: [orderHash, fulfiller, offerOffset, considerationOffset]. The two
 * offsets are byte offsets into the calldata, which is why they divide by 32.
 */
function readItems(d: string, headWord: number, stride: number): Item[] {
  const word = (i: number) => '0x' + (d.slice(i * 64, i * 64 + 64) || '0');
  const base = Number(BigInt(word(headWord))) / 32;
  const count = Number(BigInt(word(base)));
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const at = base + 1 + i * stride;
    items.push({
      itemType: BigInt(word(at)),
      token: '0x' + word(at + 1).slice(-40),
      tokenId: BigInt(word(at + 2)),
      amount: BigInt(word(at + 3)),
      recipient: stride === CONSIDERATION_STRIDE ? '0x' + word(at + 4).slice(-40) : undefined,
    });
  }
  return items;
}

/** WMON stands in 1:1 for native MON, so both count as sale volume. */
function moneyOf(items: Item[]): number {
  let mon = 0;
  for (const it of items) {
    const native = it.itemType === 0n;
    const wrapped = it.itemType === ERC20 && it.token.toLowerCase() === WMON_ADDRESS.toLowerCase();
    if (native || wrapped) mon += Number(it.amount) / 1e18;
  }
  return mon;
}

export function decodeOrderFulfilled(
  log: { topics: string[]; data: string },
  nftContract: string,
  meta: { txHash: string; block: number; ts: number },
): SaleFact | null {
  if (log.topics[0] !== ORDER_FULFILLED_TOPIC) return null;
  const d = log.data.replace(/^0x/, '');
  const offer = readItems(d, 2, OFFER_STRIDE);
  const consideration = readItems(d, 3, CONSIDERATION_STRIDE);
  const wanted = nftContract.toLowerCase();
  const fulfiller = '0x' + d.slice(64, 128).slice(-40);
  const offerer = '0x' + (log.topics[1] ?? '').slice(-40);

  // A sell listing offers the NFT and takes money; accepting a bid is the mirror.
  const sold = offer.find((it) => it.itemType === ERC721 && it.token.toLowerCase() === wanted);
  const bought = consideration.find(
    (it) => it.itemType === ERC721 && it.token.toLowerCase() === wanted,
  );
  if (!sold && !bought) return null;

  const mon = moneyOf(sold ? consideration : offer);
  if (mon <= 0) return null;

  return {
    txHash: meta.txHash,
    block: meta.block,
    ts: meta.ts,
    tokenId: Number((sold ?? bought)!.tokenId),
    mon,
    // Whoever created a sell listing gives up the NFT; whoever created a bid gets
    // it. The fulfiller is always the other side.
    seller: sold ? offerer : fulfiller,
    buyer: sold ? fulfiller : offerer,
  };
}

/**
 * Two legs of one match must not become two anomalies. The listing leg reports its
 * own offerer as the fulfiller under matchOrders, which would look exactly like a
 * self-trade and fire the Mirror detector on honest sales, so a leg with distinct
 * counterparties always wins over a fatter one.
 */
const legScore = (f: SaleFact) =>
  (f.seller.toLowerCase() === f.buyer.toLowerCase() ? 0 : 1e9) + f.mon;

/**
 * Two legs of one match must not become two anomalies. The listing leg reports its
 * own offerer as the fulfiller under matchOrders, which would look exactly like a
 * self-trade and fire the Mirror detector on honest sales, so a leg with distinct
 * counterparties always beats a fatter one, and price breaks remaining ties.
 */
export function dedupeFills(fills: SaleFact[]): SaleFact[] {
  const best = new Map<string, SaleFact>();
  for (const f of fills) {
    const key = `${f.txHash}:${f.tokenId}`;
    const seen = best.get(key);
    if (!seen || legScore(f) > legScore(seen)) best.set(key, f);
  }
  return [...best.values()];
}
