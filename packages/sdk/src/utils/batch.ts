import type { BaseClient } from "../clients/base.js";

/**
 * #77 — Batch/multi-get helper for reading several positions in fewer round
 * trips. Each `read()` call is an independent Soroban simulation, so they
 * can run concurrently rather than sequentially. The SDK previously had no
 * helper for this, forcing the multi-position UI to issue one full client
 * construction + `getAccount` + simulate per position, sequentially.
 *
 * @example
 * ```ts
 * const results = await batchRead([
 *   { client: streamClient, method: "get_balance" },
 *   { client: vestingClient, method: "get_vested" },
 *   { client: escrowClient, method: "get_balance" },
 * ]);
 * // results[0] → { status: "fulfilled", value: ... } | { status: "rejected", reason: ... }
 * ```
 */
export async function batchRead<T>(
  calls: Array<{
    client: BaseClient;
    method: string;
    args?: unknown[];
  }>,
): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(
    calls.map(async ({ client, method, args = [] }) => {
      const prepared = await client.read(method, ...args);
      return prepared.simulate() as Promise<T>;
    }),
  );
}

/**
 * Like `batchRead` but returns only the successful results, dropping any
 * that failed. Useful when the caller wants to render what succeeded and
 * silently skip broken positions.
 */
export async function batchReadSafe<T>(
  calls: Array<{
    client: BaseClient;
    method: string;
    args?: unknown[];
  }>,
): Promise<T[]> {
  const results = await batchRead<T>(calls);
  return results
    .filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled")
    .map((r) => r.value);
}
