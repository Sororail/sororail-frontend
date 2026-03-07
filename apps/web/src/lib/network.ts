import { Networks } from "@stellar/stellar-sdk";

/**
 * Network and contract configuration.
 *
 * Testnet only, deliberately. The contracts are unaudited, and shipping a
 * network switcher that can reach mainnet would invite exactly the mistake
 * SECURITY.md asks people not to make.
 */
export const NETWORK_PASSPHRASE = Networks.TESTNET;

export const RPC_URL =
  process.env["NEXT_PUBLIC_RPC_URL"] ?? "https://soroban-testnet.stellar.org";

/** Native XLM's Stellar Asset Contract on testnet. */
export const NATIVE_TOKEN =
  process.env["NEXT_PUBLIC_TOKEN_ID"] ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/**
 * The `batch_payout` deployment.
 *
 * This is the only contract with a shared address: it is stateless and holds
 * no funds, so one deployment serves everybody. The other four hold one
 * position per instance, which is why they are not listed here — a user
 * deploys their own and registers the address.
 *
 * From DEPLOYMENTS.md in the contracts repo.
 */
export const BATCH_PAYOUT_CONTRACT =
  process.env["NEXT_PUBLIC_BATCH_PAYOUT_ID"] ??
  "CDKJ56S7K7QC4LG6SFF2OGDTG6N4QBCJOVRWHY7MKCWD5JPQ6MDAHRAM";

/** Where to send someone to fund a testnet account. */
export const FRIENDBOT_URL = "https://friendbot.stellar.org";

/** Block explorer, for making a transaction hash clickable. */
export function explorerTx(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export function explorerContract(id: string): string {
  return `https://stellar.expert/explorer/testnet/contract/${id}`;
}

/** Shortens an address for display without hiding which one it is. */
export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
