/**
 * Batch payout: preview, chunk, execute.
 *
 * ```bash
 * export SOROBAN_SECRET_KEY=S...    # funder, funded
 * export BATCH_CONTRACT_ID=C...     # reusable -- batch_payout is stateless
 * pnpm tsx examples/batch-payout.ts
 * ```
 *
 * Unlike the other contracts, one batch_payout deployment serves everybody: it
 * holds no position and no funds.
 */
import { Networks } from "@stellar/stellar-sdk";

import {
  BatchPayoutClient,
  ContractError,
  KeypairSigner,
  formatAmount,
  type Payment,
} from "../src/index.js";

const RPC_URL = process.env["RPC_URL"] ?? "https://soroban-testnet.stellar.org";
const NETWORK = process.env["NETWORK_PASSPHRASE"] ?? Networks.TESTNET;
const TOKEN =
  process.env["TOKEN_ID"] ?? "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name} before running this example.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const signer = new KeypairSigner(required("SOROBAN_SECRET_KEY"));
  const batch = new BatchPayoutClient({
    contractId: required("BATCH_CONTRACT_ID"),
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    publicKey: signer.publicKey,
  });

  // Read the cap rather than hardcoding it: it is derived from network
  // resource limits and can differ between deployments.
  const cap = await batch.maxRecipients();
  console.log("max recipients per batch:", cap);

  const payroll: Payment[] = [
    { to: required("RECIPIENT_PUBLIC_KEY"), amount: 1_000n },
    { to: required("RECIPIENT_PUBLIC_KEY"), amount: 500n },
  ];

  // Preview first. It runs exactly the validation `execute` does, so this is
  // what a confirmation screen should show before asking for a signature.
  const receipt = await batch.preview(payroll);
  console.log(
    `about to pay ${receipt.count} lines totalling ${formatAmount(receipt.total)}`,
  );

  // An oversized payroll is split client-side rather than rejected on-chain.
  const batches = BatchPayoutClient.chunk(payroll, cap);
  console.log(`splitting into ${batches.length} transaction(s)`);

  for (const [index, chunk] of batches.entries()) {
    const call = await batch.execute({
      funder: signer.publicKey,
      token: TOKEN,
      recipients: chunk,
    });
    const sent = await call.signAndSend(signer);
    console.log(
      `batch ${index + 1}/${batches.length}: paid ${sent.result.count} in ${sent.hash}`,
    );
  }
}

main().catch((error: unknown) => {
  if (error instanceof ContractError) {
    console.error(`\n${error.variant} (code ${error.code}): ${error.message}`);
    // BatchTooLarge is recoverable: split and retry.
    if (error.is("BatchTooLarge")) {
      console.error("Split the payroll with BatchPayoutClient.chunk() and retry.");
    }
  } else {
    console.error(error);
  }
  process.exit(1);
});
