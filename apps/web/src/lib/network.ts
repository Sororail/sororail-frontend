/**
 * Network and contract configuration.
 *
 * Testnet only, deliberately. The contracts are unaudited, and shipping a
 * network switcher that can reach mainnet would invite exactly the mistake
 * SECURITY.md asks people not to make.
 */
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";

export const RPC_URL = process.env["NEXT_PUBLIC_RPC_URL"] ?? DEFAULT_RPC_URL;

const DEFAULT_NATIVE_TOKEN =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** Native XLM's Stellar Asset Contract on testnet. */
export const NATIVE_TOKEN =
  process.env["NEXT_PUBLIC_TOKEN_ID"] ??
  DEFAULT_NATIVE_TOKEN;

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

const TESTNET_EXPLORER = "https://stellar.expert/explorer/testnet";

/**
 * Where the block explorer for the configured network lives, or `null`.
 *
 * `NEXT_PUBLIC_EXPLORER_URL` wins when set. Otherwise the base is derived from
 * `RPC_URL`: an RPC on a testnet host maps to the testnet explorer, and
 * anything else (a local quickstart node, futurenet, an unrecognised
 * provider) has none, because a link into the wrong network's explorer 404s
 * for every transaction and contract on it.
 */
export function resolveExplorerBase(
  rpcUrl: string,
  override?: string,
): string | null {
  const explicit = override?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;

  try {
    const { hostname } = new URL(rpcUrl);
    return hostname.toLowerCase().includes("testnet") ? TESTNET_EXPLORER : null;
  } catch {
    return null;
  }
}

const EXPLORER_BASE = resolveExplorerBase(
  RPC_URL,
  process.env["NEXT_PUBLIC_EXPLORER_URL"],
);

/** Block explorer link for a transaction, or `null` if the network has none. */
export function explorerTx(hash: string): string | null {
  return EXPLORER_BASE ? `${EXPLORER_BASE}/tx/${hash}` : null;
}

/** Block explorer link for a contract, or `null` if the network has none. */
export function explorerContract(id: string): string | null {
  return EXPLORER_BASE ? `${EXPLORER_BASE}/contract/${id}` : null;
}

/** Shortens an address for display without hiding which one it is. */
export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
