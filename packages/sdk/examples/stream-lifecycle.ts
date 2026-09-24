/**
 * Stream: create, inspect, withdraw.
 *
 * Runs against a real Soroban network. This doubles as documentation and as a
 * smoke test — if the SDK's encoding or decoding is wrong anywhere, this fails
 * rather than passing quietly the way a mocked unit test would.
 *
 * ```bash
 * export SOROBAN_SECRET_KEY=S...            # a funded testnet account
 * export STREAM_CONTRACT_ID=C...            # a freshly deployed stream instance
 * pnpm tsx examples/stream-lifecycle.ts
 * ```
 *
 * `STREAM_CONTRACT_ID` must be a **fresh** deployment: a stream contract holds
 * one position for its whole life, so `create` claims the instance
 * permanently and a second run against the same address fails with
 * `AlreadyInitialized`.
 */
import {
  ContractError,
  KeypairSigner,
  StreamClient,
  formatAmount,
  fromStroops,
  toStroops,
} from "../src/index.js";
import { NETWORK, RPC_URL, TOKEN as NATIVE_TOKEN, required } from "./_shared.js";

import { check, checkEqual } from "./support.js";

async function main(): Promise<void> {
  const signer = new KeypairSigner(required("SOROBAN_SECRET_KEY"));
  const contractId = required("STREAM_CONTRACT_ID");

  const stream = new StreamClient({
    contractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    publicKey: signer.publicKey,
  });

  // The recipient is a second account. It does not need to exist yet for the
  // stream to be created — only to receive a withdrawal.
  const recipient = required("RECIPIENT_PUBLIC_KEY");

  // 100 stroops/second for 60 seconds: 6000 stroops total, pulled up front.
  const ratePerSecond = 100n;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const start = now;
  const stop = now + 60n;

  console.log("sender   ", signer.publicKey);
  console.log("recipient", recipient);
  console.log("funding  ", formatAmount(ratePerSecond * 60n), "XLM-stroops");

  // --- 1. build ---------------------------------------------------------
  // Nothing has been sent yet. The call can be inspected, or its XDR handed
  // to something else entirely.
  const create = await stream.create({
    sender: signer.publicKey,
    recipient,
    token: NATIVE_TOKEN,
    ratePerSecond,
    start,
    stop,
    cancellable: true,
  });

  // --- 2. simulate ------------------------------------------------------
  // A simulation that fails means the real call would fail, before anyone is
  // asked to sign and before a fee is spent.
  await create.simulate();
  console.log("simulated create: ok");

  // --- 3. sign and send -------------------------------------------------
  const created = await create.signAndSend(signer);
  console.log("created in tx", created.hash);

  // --- 4. read it back --------------------------------------------------
  const record = await stream.get();
  console.log("deposited", fromStroops(record.deposited));
  console.log("stop     ", new Date(Number(record.stop) * 1000).toISOString());
  checkEqual(record.deposited, ratePerSecond * 60n, "deposited");
  checkEqual(record.ratePerSecond, ratePerSecond, "rate per second");
  checkEqual(record.withdrawn, 0n, "withdrawn at creation");
  checkEqual(record.cancelledAt, null, "cancelledAt at creation");

  // Accrual is computed from ledger time at read time, so waiting changes the
  // answer without any transaction being sent.
  console.log("waiting 12s for accrual...");
  await new Promise((resolve) => setTimeout(resolve, 12_000));

  const available = await stream.balanceOf(recipient);
  console.log("recipient can withdraw", fromStroops(available));

  check(available > 0n, "something has accrued after 12s");
  check(available <= record.deposited, "accrual never exceeds the deposit");

  // --- 5. withdraw, as the recipient ------------------------------------
  // `withdraw` requires the recipient's own signature, so this only runs when
  // the recipient's secret is available.
  const recipientSecret = process.env["RECIPIENT_SECRET_KEY"];
  if (!recipientSecret) {
    console.log("set RECIPIENT_SECRET_KEY to run the withdrawal step");
    return;
  }

  const recipientSigner = new KeypairSigner(recipientSecret);
  const asRecipient = new StreamClient({
    contractId,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    publicKey: recipientSigner.publicKey,
  });

  const withdraw = await asRecipient.withdraw();
  const withdrawn = await withdraw.signAndSend(recipientSigner);
  console.log("withdrew", fromStroops(withdrawn.result), "in", withdrawn.hash);

  const after = await stream.get();
  const conserved =
    after.withdrawn + after.refunded + (await stream.remaining()) ===
    after.deposited;
  console.log("conservation holds:", conserved);

  // Accrual keeps rising between the read and the withdrawal, so the amount
  // taken is at least what was shown -- never less.
  check(withdrawn.result >= available, "withdrew at least what had been shown");
  checkEqual(after.withdrawn, withdrawn.result, "withdrawn recorded on the stream");
  check(conserved, "withdrawn + refunded + remaining equals deposited");
  console.log("verified: stream lifecycle");
}

main().catch((error: unknown) => {
  // Errors arrive already decoded: a variant name and a sentence, not a code.
  if (error instanceof ContractError) {
    console.error(`\n${error.variant} (code ${error.code}) from ${error.contract}`);
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});

// Referenced so the import is not flagged as unused when the example is
// typechecked without being run.
void toStroops;
