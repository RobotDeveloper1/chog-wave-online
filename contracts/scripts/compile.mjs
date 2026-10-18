import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'ChogTestnet.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'ChogTestnet.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors ?? []).filter((e) => e.severity === 'error');
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage ?? e.message);
  process.exit(1);
}
for (const w of (output.errors ?? []).filter((e) => e.severity === 'warning')) {
  console.error('warning: ' + (w.formattedMessage ?? w.message));
}
const contract = output.contracts['ChogTestnet.sol']['ChogTestnet'];
mkdirSync(join(root, 'artifacts'), { recursive: true });
writeFileSync(
  join(root, 'artifacts', 'ChogTestnet.json'),
  JSON.stringify({ abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object }, null, 2),
);
console.log(`compiled ChogTestnet (${contract.evm.bytecode.object.length / 2} bytes of initcode)`);
