const RPC = 'https://rpc2.monad.xyz';
const call = async (method, params) => {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await r.json()).result;
};

const rc = await call('eth_getTransactionReceipt', [
  '0x8df75d2afa001b7e3f42356b5ac3cd38c456f32975be5e053e573b6dca111465',
]);
console.log('all logs:', rc.logs.length);
for (const [i, l] of rc.logs.entries()) {
  console.log(
    `\n[${i}] addr=${l.address} topics=${l.topics.length} data=${(l.data.length - 2) / 2} bytes`,
  );
  console.log('    t0=' + l.topics[0]);
  if (l.topics[1]) console.log('    t1=' + l.topics[1]);
  if (l.topics[2]) console.log('    t2=' + l.topics[2]);
  if (i < 6 || l.topics[0].startsWith('0x9d9af8e3')) {
    const d = l.data.replace(/^0x/, '');
    for (let w = 0; w < Math.min(24, d.length / 64); w++) {
      console.log(`    w${String(w).padStart(2)} ${d.slice(w * 64, w * 64 + 64)}`);
    }
  }
}
