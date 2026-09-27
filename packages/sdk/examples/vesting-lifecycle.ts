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
import { ContractError, KeypairSigner, VestingClient, fromStroops } from "../src/index.js";
import { NETWORK, RPC_URL, TOKEN, required } from "./_shared.js";

import { check, checkEqual } from "./support.js";

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

  const grant = await vesting.get();
  checkEqual(grant.total, total, "grant total");
  checkEqual(grant.cliff, 10n, "cliff span");
  checkEqual(grant.duration, 60n, "duration span");
  checkEqual(grant.revocable, true, "revocable");
  checkEqual(grant.claimed, 0n, "claimed at creation");
  checkEqual(grant.revokedAt, null, "revokedAt at creation");

  // The schedule is a pure function of the grant and a timestamp, so it can be
  // plotted for any point in time without sending anything.
  const schedule: bigint[] = [];
  for (const offset of [0n, 10n, 30n, 60n]) {
    const vested = await vesting.vestedAmount(now + offset);
    console.log(`  t+${offset}s  vested ${fromStroops(vested)}`);
    schedule.push(vested);
  }
  checkEqual(schedule[0], 0n, "vested at start, before the cliff");
  checkEqual(schedule[3], total, "vested at the end of the schedule");
  check(
    schedule.every((vested, i) => i === 0 || vested >= (schedule[i - 1] ?? 0n)),
    "vesting never goes backwards",
  );

  // The cliff is 10s; wait well past it so a few seconds of clock skew between
  // this machine and the ledger cannot leave nothing claimable.
  console.log("waiting 20s to clear the cliff...");
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  const claimableBefore = await vesting.claimable();
  console.log("claimable now:", fromStroops(claimableBefore));
  check(claimableBefore > 0n, "something is claimable after the cliff");
  check(claimableBefore < total, "the grant is only partly vested at t+20s");

  // Revoking returns only the unvested part. Whatever had vested stays in the
  // contract and remains claimable by the beneficiary.
  const revoke = await vesting.revoke();
  const revoked = await revoke.signAndSend(signer);
  console.log("revoked, returned", fromStroops(revoked.result), "in", revoked.hash);
  const claimableAfter = await vesting.claimable();
  console.log("still claimable by beneficiary:", fromStroops(claimableAfter));

  // Only the unvested part came back, and the vested part stayed claimable, so
  // between them the two account for the whole grant.
  const revokedGrant = await vesting.get();
  check(revokedGrant.revokedAt !== null, "revokedAt is recorded");
  checkEqual(revokedGrant.returned, revoked.result, "returned amount on the grant");
  check(revoked.result > 0n, "part of the grant was unvested and returned");
  checkEqual(claimableAfter + revoked.result, total, "returned + still claimable");
  console.log("verified: vesting lifecycle");
}

main().catch((error: unknown) => {
  if (error instanceof ContractError) {
    console.error(`\n${error.variant} (code ${error.code}): ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
