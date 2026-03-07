/**
 * Vesting: create a grant, watch it vest, claim, revoke.
 *
 * ```bash
 * export SOROBAN_SECRET_KEY=S...        # grantor, funded
 * export VESTING_CONTRACT_ID=C...       # a freshly deployed vesting instance
 * export BENEFICIARY_PUBLIC_KEY=G...
 * pnpm tsx examples/vesting-lifecycle.ts
 * ```
 */
import { Networks } from "@stellar/stellar-sdk";

import { ContractError, KeypairSigner, VestingClient, fromStroops } from "../src/index.js";

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
  const vesting = new VestingClient({
    contractId: required("VESTING_CONTRACT_ID"),
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    publicKey: signer.publicKey,
  });

  const now = BigInt(Math.floor(Date.now() / 1000));
  const total = 10_000n;

  // cliff and duration are SPANS IN SECONDS FROM start, not timestamps.
  // A 10-second cliff on a 60-second schedule, so the example finishes.
  const create = await vesting.create({
    grantor: signer.publicKey,
    beneficiary: required("BENEFICIARY_PUBLIC_KEY"),
    token: TOKEN,
    total,
    start: now,
    cliff: 10n,
    duration: 60n,
    revocable: true,
  });
  await create.simulate();
  console.log("created", (await create.signAndSend(signer)).hash);

  // The schedule is a pure function of the grant and a timestamp, so it can be
  // plotted for any point in time without sending anything.
  for (const offset of [0n, 10n, 30n, 60n]) {
    const vested = await vesting.vestedAmount(now + offset);
    console.log(`  t+${offset}s  vested ${fromStroops(vested)}`);
  }

  console.log("waiting 15s to clear the cliff...");
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  console.log("claimable now:", fromStroops(await vesting.claimable()));

  // Revoking returns only the unvested part. Whatever had vested stays in the
  // contract and remains claimable by the beneficiary.
  const revoke = await vesting.revoke();
  const revoked = await revoke.signAndSend(signer);
  console.log("revoked, returned", fromStroops(revoked.result), "in", revoked.hash);
  console.log("still claimable by beneficiary:", fromStroops(await vesting.claimable()));
}

main().catch((error: unknown) => {
  if (error instanceof ContractError) {
    console.error(`\n${error.variant} (code ${error.code}): ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
