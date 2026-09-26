/**
 * Escrow: init, fund, release.
 *
 * ```bash
 * export SOROBAN_SECRET_KEY=S...      # depositor, funded
 * export ESCROW_CONTRACT_ID=C...      # a freshly deployed escrow instance
 * export BENEFICIARY_PUBLIC_KEY=G...
 * pnpm tsx examples/escrow-lifecycle.ts
 * ```
 *
 * The instance must be fresh: `init` claims an escrow contract permanently.
 */
import { ContractError, EscrowClient, KeypairSigner, fromStroops } from "../src/index.js";
import { NETWORK, RPC_URL, TOKEN, required } from "./_shared.js";

import { TokenClient, checkEqual } from "./support.js";

async function main(): Promise<void> {
  const signer = new KeypairSigner(required("SOROBAN_SECRET_KEY"));
  const escrow = new EscrowClient({
    contractId: required("ESCROW_CONTRACT_ID"),
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    publicKey: signer.publicKey,
  });

  const token = new TokenClient({
    contractId: TOKEN,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    publicKey: signer.publicKey,
  });

  const beneficiary = required("BENEFICIARY_PUBLIC_KEY");
  const amount = 5_000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const init = await escrow.init({
    depositor: signer.publicKey,
    beneficiary,
    // Without an arbiter, dispute and resolve are unavailable and the
    // depositor can only refund after the deadline.
    arbiter: null,
    token: TOKEN,
    amount,
    deadline,
  });
  await init.simulate();
  console.log("init  ", (await init.signAndSend(signer)).hash);
  console.log("state ", await escrow.state());

  // What was stored is what was asked for.
  const created = await escrow.get();
  checkEqual(created.state, "Created", "state after init");
  checkEqual(created.depositor, signer.publicKey, "depositor");
  checkEqual(created.beneficiary, beneficiary, "beneficiary");
  checkEqual(created.arbiter, null, "arbiter");
  checkEqual(created.amount, amount, "escrowed amount");
  checkEqual(created.deadline, deadline, "deadline");

  const beneficiaryBefore = await token.balance(beneficiary);

  const fund = await escrow.fund();
  console.log("fund  ", (await fund.signAndSend(signer)).hash);
  console.log("state ", await escrow.state());

  const record = await escrow.get();
  console.log("holding", fromStroops(record.amount));
  checkEqual(record.state, "Funded", "state after fund");
  // The contract really holds the funds, not just a record saying it does.
  checkEqual(await token.balance(escrow.contractId), amount, "contract token balance");

  // The depositor releases to the beneficiary. The beneficiary cannot do this
  // themselves -- that is the point of an escrow.
  const release = await escrow.release();
  console.log("release", (await release.signAndSend(signer)).hash);
  console.log("state  ", await escrow.state());

  checkEqual(await escrow.state(), "Released", "state after release");
  // The beneficiary pays no fee in this run, so their balance moves by
  // exactly the escrowed amount, and the contract is left empty.
  checkEqual(
    (await token.balance(beneficiary)) - beneficiaryBefore,
    amount,
    "beneficiary's gain",
  );
  checkEqual(await token.balance(escrow.contractId), 0n, "contract balance after release");
  console.log("verified: escrow lifecycle");
}

main().catch((error: unknown) => {
  if (error instanceof ContractError) {
    console.error(`\n${error.variant} (code ${error.code}): ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
