import {
  Account,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

import { NETWORK_PASSPHRASE, RPC_URL } from "./network";

/**
 * Reads `decimals()` off a token contract.
 *
 * Amounts are entered as decimal strings and converted to the token's smallest
 * unit, so the scale has to come from the token itself: 7 is only the default
 * for classic Stellar assets, and a custom token can declare anything.
 */
export async function fetchTokenDecimals(
  tokenId: string,
  sourceAddress: string,
): Promise<number> {
  const server = new rpc.Server(RPC_URL);
  const transaction = new TransactionBuilder(new Account(sourceAddress, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: tokenId,
        function: "decimals",
        args: [],
      }),
    )
    .setTimeout(30)
    .build();

  const response = await server.simulateTransaction(transaction);
  if (!rpc.Api.isSimulationSuccess(response) || !response.result) {
    throw new Error("Could not read the token's decimals.");
  }
  const decimals = Number(scValToNative(response.result.retval));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new Error(`The token reported an invalid decimals value: ${decimals}.`);
  }
  return decimals;
}
