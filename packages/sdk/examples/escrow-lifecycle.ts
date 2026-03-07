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
import { Networks } from "@stellar/stellar-sdk";

import { ContractError, EscrowClient, KeypairSigner, fromStroops } from "../src/index.js";

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
  const escrow = new EscrowClient({
    contractId: required("ESCROW_CONTRACT_ID"),
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

  const fund = await escrow.fund();
  console.log("fund  ", (await fund.signAndSend(signer)).hash);
  console.log("state ", await escrow.state());

  const record = await escrow.get();
  console.log("holding", fromStroops(record.amount));

  // The depositor releases to the beneficiary. The beneficiary cannot do this
  // themselves -- that is the point of an escrow.
  const release = await escrow.release(signer.publicKey);
  console.log("release", (await release.signAndSend(signer)).hash);
  console.log("state  ", await escrow.state());
}

main().catch((error: unknown) => {
  if (error instanceof ContractError) {
    console.error(`\n${error.variant} (code ${error.code}): ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
