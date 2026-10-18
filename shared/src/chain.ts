/**
 * Which chain this game is on, in one place.
 *
 * The server needs the address to read it and the client needs it to *switch the
 * wallet to* it, and those two must be the same numbers — a picker that signs in
 * against chain 143 while the world's ownership index scanned a different
 * contract would deny every holder their own Chog. So the client imports this
 * rather than carrying its own copy of a string literal.
 *
 * Every value here was read from mainnet rather than copied from a README:
 * `name()`="Chog Genesis", `symbol()`="CHOG", `totalSupply()`=1969.
 */

export const MONAD_CHAIN_ID = 143;
export const MONAD_CHAIN_ID_HEX = '0x8f';
export const MONAD_CURRENCY = 'MON';
export const MONAD_RPC_URL = 'https://rpc2.monad.xyz';
export const MONAD_EXPLORER_URL = 'https://monadscan.com';

/** Monad testnet (chain 10143): where the replica collection lives. */
export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MONAD_TESTNET_CHAIN_ID_HEX = '0x279f';
export const MONAD_TESTNET_RPC_URL = 'https://testnet-rpc.monad.xyz';
export const MONAD_TESTNET_EXPLORER_URL = 'https://testnet.monadexplorer.com';

/** Chog Genesis ERC-721. It does not implement ERC721Enumerable. */
export const CHOG_GENESIS_ADDRESS = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
/** Wrapped MON, the token every priced Seaport fill settles in. Read off a real
 *  fill's log, not from a spec: the docs gave a different tail. */
export const WMON_ADDRESS = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
/** Seaport 1.x, the venue that has actually filled Genesis orders. */
export const SEAPORT_ADDRESS = '0x0000000000000068f116a894984e2db1123eb395';

/**
 * The EIP-3085 `wallet_addEthereumChain` argument. Exported as a constructor
 * rather than a constant because `rpcUrls` is an array some wallets insist on
 * being fresh, and a caller may want to put its own node first.
 */
export function monadChainParams(rpcUrls: string[] = [MONAD_RPC_URL]) {
  return {
    chainId: MONAD_CHAIN_ID_HEX,
    chainName: 'Monad',
    nativeCurrency: { name: MONAD_CURRENCY, symbol: MONAD_CURRENCY, decimals: 18 },
    rpcUrls,
    blockExplorerUrls: [MONAD_EXPLORER_URL],
  };
}

/** Is this address something a wallet actually handed us? Checked before any of it reaches the chain. */
export const isAddress = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
