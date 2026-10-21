import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Mint an EXISTING replica up to a target id. The replica mints sequentially
 * from totalSupply+1, so reaching #1000 means filling everything below it —
 * chunked 100 per tx so no single call eats the block gas limit.
 *
 *   REPLICA=0x... MINT_TO=0x... TARGET=1000 DEPLOYER_KEY=0x... node contracts/scripts/mint-to.mjs
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { abi } = JSON.parse(readFileSync(join(root, 'artifacts', 'ChogTestnet.json'), 'utf8'));

const rpcUrl = process.env.MONAD_TESTNET_RPC ?? 'https://testnet-rpc.monad.xyz';
const key = process.env.DEPLOYER_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('DEPLOYER_KEY must be the 0x owner key. Nothing was sent.');
  process.exit(1);
}
const replica = process.env.REPLICA;
const to = process.env.MINT_TO;
if (!isAddress(replica ?? '') || !isAddress(to ?? '')) {
  console.error('REPLICA and MINT_TO must both be 0x addresses. Nothing was sent.');
  process.exit(1);
}
const target = BigInt(process.env.TARGET ?? '1000');
if (target < 1n) {
  console.error('TARGET must be >= 1.');
  process.exit(1);
}

const account = privateKeyToAccount(key);
const chain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const pub = createPublicClient({ chain, transport: http(rpcUrl) });

const supplyOf = () => pub.readContract({ address: replica, abi, functionName: 'totalSupply' });
let supply = await supplyOf();
console.log(`replica ${replica} at totalSupply=${supply}, target=${target}`);
if (supply >= target) {
  console.log('Already there. Verifying owner…');
} else {
  while (supply < target) {
    const count = supply + 100n > target ? target - supply : 100n;
    const hash = await wallet.writeContract({ address: replica, abi, functionName: 'mint', args: [to, count] });
    await pub.waitForTransactionReceipt({ hash });
    supply = await supplyOf();
    console.log(`…supply=${supply} (tx ${hash})`);
  }
}
const holder = await pub.readContract({ address: replica, abi, functionName: 'ownerOf', args: [target] });
const match = holder.toLowerCase() === to.toLowerCase();
console.log(`ownerOf(${target}) = ${holder} ${match ? 'OK' : 'MISMATCH'}`);
if (!match) process.exit(1);
