/**
 * Recurring: authorize a subscription, approve an allowance, charge.
 *
 * ```bash
 * export SOROBAN_SECRET_KEY=S...          # payer, funded
 * export RECURRING_CONTRACT_ID=C...       # a freshly deployed instance
 * export PAYEE_PUBLIC_KEY=G...
 * export PAYEE_SECRET_KEY=S...            # optional: runs the charge step
 * pnpm tsx examples/recurring-subscription.ts
 * ```
 *
 * Two things about this contract surprise people, so they are demonstrated
 * here rather than only documented:
 *
 * 1. `authorize` alone lets the payee take nothing. The payer must ALSO
 *    `approve` the contract as a spender on the token. That allowance is the
 *    real cap, and revoking it stops charges without touching the contract.
 * 2. Skipped periods are forfeited, not banked. A payee who forgets for three
 *    periods gets one charge when they remember, not three.
 */
import { ContractError, KeypairSigner, RecurringClient, fromStroops } from "../src/index.js";
import { NETWORK, RPC_URL, TOKEN, required } from "./_shared.js";

import { TokenClient, check, checkEqual, waitUntil } from "./support.js";

async function main(): Promise<void> {
  const signer = new KeypairSigner(required("SOROBAN_SECRET_KEY"));
  const recurring = new RecurringClient({
    contractId: required("RECURRING_CONTRACT_ID"),
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    publicKey: signer.publicKey,
  });

  const payee = required("PAYEE_PUBLIC_KEY");
  const token = new TokenClient({
    contractId: TOKEN,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    publicKey: signer.publicKey,
  });

  // A 30-second "month", so the example can actually reach a charge.
  const amountPerPeriod = 1_000n;
  const authorize = await recurring.authorize({
    payer: signer.publicKey,
    payee,
    token: TOKEN,
    amountPerPeriod,
    periodSeconds: 30n,
    maxPeriods: 12,
  });
  await authorize.simulate();
  console.log("authorized", (await authorize.signAndSend(signer)).hash);

  const record = await recurring.get();
  console.log(
    "first charge due",
    new Date(Number(record.nextChargeableAt) * 1000).toISOString(),
  );
  checkEqual(record.payer, signer.publicKey, "payer");
  checkEqual(record.payee, payee, "payee");
  checkEqual(record.amountPerPeriod, amountPerPeriod, "amount per period");
  checkEqual(record.maxPeriods, 12, "max periods");
  checkEqual(record.periodsCharged, 0, "periods charged at authorization");
  checkEqual(record.cancelled, false, "cancelled at authorization");

  const chargeable = await recurring.isChargeable();
  console.log("chargeable now:", chargeable, "(expected false)");
  checkEqual(chargeable, false, "chargeable before the first period elapses");
  const remaining = await recurring.remainingPeriods();
  console.log("remaining periods:", remaining);
  checkEqual(remaining, 12, "remaining periods");

  // `authorize` alone lets the payee take nothing. The token allowance is the
  // real cap, so grant one period's worth: enough for exactly one charge.
  const approve = await token.approve({
    from: signer.publicKey,
    spender: recurring.contractId,
    amount: amountPerPeriod,
  });
  console.log("approved", (await approve.signAndSend(signer)).hash);
  console.log(
    "NOTE: if the payee skips a period it is gone -- the next charge is",
    "scheduled from the moment of the last charge, not from the missed due date.",
  );

  // Charging needs the payee's own signature.
  const payeeSecret = process.env["PAYEE_SECRET_KEY"];
  if (payeeSecret) {
    const payeeSigner = new KeypairSigner(payeeSecret);
    checkEqual(payeeSigner.publicKey, payee, "PAYEE_SECRET_KEY matches PAYEE_PUBLIC_KEY");
    const asPayee = new RecurringClient({
      contractId: recurring.contractId,
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK,
      publicKey: payeeSigner.publicKey,
    });

    // Poll ledger time rather than sleeping, so this does not depend on this
    // machine's clock agreeing with the network's.
    console.log("waiting for the first period to elapse...");
    await waitUntil("the first charge to become due", () => asPayee.isChargeable());

    const charge = await asPayee.charge();
    const charged = await charge.signAndSend(payeeSigner);
    console.log("charged", fromStroops(charged.result), "in", charged.hash);
    checkEqual(charged.result, amountPerPeriod, "amount charged");
    checkEqual((await recurring.get()).periodsCharged, 1, "periods charged");
    checkEqual(await recurring.remainingPeriods(), 11, "remaining periods after a charge");
    // The next charge is scheduled a full period out, not immediately.
    checkEqual(await recurring.isChargeable(), false, "chargeable straight after a charge");
  } else {
    console.log("set PAYEE_SECRET_KEY to run the charge step");
  }

  // Either party can cancel, effective immediately.
  const cancel = await recurring.cancel(signer.publicKey);
  console.log("\ncancelled", (await cancel.signAndSend(signer)).hash);
  const final = await recurring.get();
  console.log("charges taken:", final.periodsCharged);
  check(final.cancelled, "the authorization is marked cancelled");
  console.log("verified: recurring subscription");
}

main().catch((error: unknown) => {
  if (error instanceof ContractError) {
    console.error(`\n${error.variant} (code ${error.code}): ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
