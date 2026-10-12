const RPC = 'https://rpc2.monad.xyz';
const NFT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
const SEAPORT = '0x0000000000000068f116a894984e2db1123eb395';

const call = async (method, params) => {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};

const { decodeOrderFulfilled, dedupeFills } = await import(
  'file:///C:/Users/Kauker/Desktop/chog/server/src/seaport.ts'
);
const { classify } = await import(
  'file:///C:/Users/Kauker/Desktop/chog/shared/src/anomaly.ts'
);

const txs = [
  '0x8df75d2afa001b7e3f42356b5ac3cd38c456f32975be5e053e573b6dca111465',
  '0x382d9340',
];

for (const tx of txs.slice(0, 1)) {
  const rc = await call('eth_getTransactionReceipt', [tx]);
  const logs = rc.logs.filter((l) => l.address.toLowerCase() === SEAPORT);
  console.log(`\ntx ${tx.slice(0, 12)}…  seaport logs: ${logs.length}`);
  const fills = logs
    .map((l) =>
      decodeOrderFulfilled(l, NFT, {
        txHash: tx,
        block: parseInt(rc.blockNumber, 16),
        ts: Date.now(),
      }),
    )
    .filter(Boolean);
  console.log('decoded legs:', fills);
  const deduped = dedupeFills(fills);
  console.log('deduped:', deduped.length, deduped.map((f) => `#${f.tokenId} ${f.mon.toFixed(2)} MON`).join(' | '));
  console.log('sellers:', deduped.map((f) => `${f.seller} -> ${f.buyer}`));
  console.log('classify:', JSON.stringify(classify(deduped), null, 1));
}
