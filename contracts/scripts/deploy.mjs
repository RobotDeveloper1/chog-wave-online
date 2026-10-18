import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { abi, bytecode } = JSON.parse(readFileSync(join(root, 'artifacts', 'ChogTestnet.json'), 'utf8'));

const rpcUrl = process.env.MONAD_TESTNET_RPC ?? 'https://testnet-rpc.monad.xyz';
const key = process.env.DEPLOYER_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('DEPLOYER_KEY must be a 0x-prefixed 32-byte testnet-only key. Nothing was sent.');
  process.exit(1);
}
const mintTo = process.env.MINT_TO;
if (!isAddress(mintTo ?? '')) {
  console.error('MINT_TO must be the 0x address that receives the test Chogs (your Privy embedded wallet). Nothing was sent.');
  process.exit(1);
}
const mintCount = Math.max(1, Math.min(50, Number(process.env.MINT_COUNT ?? 3)));
const baseURI = process.env.BASE_URI ?? '';

const account = privateKeyToAccount(key);
const chain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const pub = createPublicClient({ chain, transport: http(rpcUrl) });

const balance = await pub.getBalance({ address: account.address });
console.log(`deployer ${account.address} holds ${balance} wei of testnet MON`);
if (balance === 0n) {
  console.error('No testnet MON. Fund this address at https://faucet.monad.xyz first. Nothing was sent.');
  process.exit(1);
}

console.log('deploying ChogTestnet…');
const hash = await wallet.deployContract({ abi, bytecode, args: [baseURI] });
const receipt = await pub.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress) {
  console.error('No contract address in the receipt. The deploy did not land.');
  process.exit(1);
}
console.log(`ChogTestnet at ${receipt.contractAddress} (tx ${hash})`);

console.log(`minting ${mintCount} to ${mintTo}…`);
const mintHash = await wallet.writeContract({
  address: receipt.contractAddress,
  abi,
  functionName: 'mint',
  args: [mintTo, BigInt(mintCount)],
});
await pub.waitForTransactionReceipt({ hash: mintHash });
console.log(`minted ids 1..${mintCount} (tx ${mintHash})`);
console.log('');
console.log('Point the game at it:');
console.log(`  MONAD_RPC=https://testnet-rpc.monad.xyz`);
console.log(`  CHOG_GENESIS_CONTRACT=${receipt.contractAddress}`);
