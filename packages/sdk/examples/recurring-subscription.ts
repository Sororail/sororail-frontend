/**
 * Recurring: authorize a subscription, approve an allowance, charge.
 *
 * ```bash
 * export SOROBAN_SECRET_KEY=S...          # payer, funded
 * export RECURRING_CONTRACT_ID=C...       # a freshly deployed instance
 * export PAYEE_PUBLIC_KEY=G...
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
import { Networks } from "@stellar/stellar-sdk";

import { ContractError, KeypairSigner, RecurringClient, fromStroops } from "../src/index.js";

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
  const recurring = new RecurringClient({
    contractId: required("RECURRING_CONTRACT_ID"),
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    publicKey: signer.publicKey,
  });

  // A 30-second "month", so the example can actually reach a charge.
  const authorize = await recurring.authorize({
    payer: signer.publicKey,
    payee: required("PAYEE_PUBLIC_KEY"),
    token: TOKEN,
    amountPerPeriod: 1_000n,
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
  console.log("chargeable now:", await recurring.isChargeable(), "(expected false)");
  console.log("remaining periods:", await recurring.remainingPeriods());

  console.log(
    "\nNOTE: the payee still cannot charge until the payer approves this",
    "contract as a spender on the token. Use the token's approve() with",
    `spender = ${recurring.contractId}.`,
  );
  console.log(
    "NOTE: if the payee skips a period it is gone -- the next charge is",
    "scheduled from the moment of the last charge, not from the missed due date.",
  );

  // Either party can cancel, effective immediately.
  const cancel = await recurring.cancel(signer.publicKey);
  console.log("\ncancelled", (await cancel.signAndSend(signer)).hash);
  console.log("charges taken:", (await recurring.get()).periodsCharged);
  void fromStroops;
}

main().catch((error: unknown) => {
  if (error instanceof ContractError) {
    console.error(`\n${error.variant} (code ${error.code}): ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
