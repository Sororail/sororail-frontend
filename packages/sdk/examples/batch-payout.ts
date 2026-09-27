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
import {
  BatchPayoutClient,
  ContractError,
  KeypairSigner,
  formatAmount,
  type Payment,
} from "../src/index.js";
import { NETWORK, RPC_URL, TOKEN, required } from "./_shared.js";

import { TokenClient, check, checkEqual } from "./support.js";

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
  check(Number.isInteger(cap) && cap >= 2, "the cap allows at least two recipients");

  const token = new TokenClient({
    contractId: TOKEN,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    publicKey: signer.publicKey,
  });
  const recipient = required("RECIPIENT_PUBLIC_KEY");

  // The same recipient twice is legitimate on chain (two invoices for one
  // contractor), and keeps this run to one balance to check.
  const payroll: Payment[] = [
    { to: recipient, amount: 1_000n },
    { to: recipient, amount: 500n },
  ];
  const expectedTotal = 1_500n;
  const recipientBefore = await token.balance(recipient);

  // Preview first. It runs exactly the validation `execute` does, so this is
  // what a confirmation screen should show before asking for a signature.
  const receipt = await batch.preview(payroll);
  console.log(
    `about to pay ${receipt.count} lines totalling ${formatAmount(receipt.total)}`,
  );
  checkEqual(receipt.count, payroll.length, "previewed line count");
  checkEqual(receipt.total, expectedTotal, "previewed total");
  // A preview sends nothing.
  checkEqual(await token.balance(recipient), recipientBefore, "balance after preview");

  // An oversized payroll is split client-side rather than rejected on-chain.
  // Chunking is pure, so check it against a list one line over two full batches.
  const oversized: Payment[] = Array.from({ length: cap * 2 + 1 }, () => ({
    to: recipient,
    amount: 1n,
  }));
  const oversizedBatches = BatchPayoutClient.chunk(oversized, cap);
  checkEqual(oversizedBatches.length, 3, "batches for an oversized payroll");
  check(
    oversizedBatches.every((chunk) => chunk.length <= cap),
    "no batch exceeds the cap",
  );
  checkEqual(oversizedBatches.flat().length, oversized.length, "no line lost in chunking");

  const batches = BatchPayoutClient.chunk(payroll, cap);
  console.log(`splitting into ${batches.length} transaction(s)`);

  let paid = 0;
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
    checkEqual(sent.result.count, chunk.length, `lines paid in batch ${index + 1}`);
    paid += sent.result.count;
  }

  checkEqual(paid, payroll.length, "total lines paid");
  // The recipient pays no fee in this run, so their balance moves by exactly
  // the payroll total.
  checkEqual(
    (await token.balance(recipient)) - recipientBefore,
    expectedTotal,
    "recipient's gain",
  );
  console.log("verified: batch payout");
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
