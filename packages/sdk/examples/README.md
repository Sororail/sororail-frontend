# Examples

Runnable scripts, one per contract. They are documentation and smoke tests at
the same time: they run against a real network, so an encoding or decoding
mistake in the SDK fails here rather than passing quietly the way a mocked unit
test would.

```bash
pnpm tsx examples/stream-lifecycle.ts
```

## Setup

```bash
# A funded testnet account.
stellar keys generate --network testnet --fund alice
export SOROBAN_SECRET_KEY=$(stellar keys show alice)

# A second account to receive.
stellar keys generate --network testnet --fund bob
export RECIPIENT_PUBLIC_KEY=$(stellar keys address bob)
export RECIPIENT_SECRET_KEY=$(stellar keys show bob)
```

Then deploy the instance the example needs — see
[DEPLOYMENTS.md](https://github.com/Sororail/sororail-contracts/blob/main/DEPLOYMENTS.md)
in the contracts repo — and set its address:

```bash
export STREAM_CONTRACT_ID=C...
```

By default the examples use native XLM's Stellar Asset Contract on testnet.
Override with `TOKEN_ID` to use another token.

## Deploy a fresh instance for each run

Every contract except `batch_payout` holds **one position per deployed
instance**. `create` / `init` / `authorize` claims that instance permanently,
and a second run against the same address fails with `AlreadyInitialized`. So
deploy a new one per run:

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/sororail_stream.optimized.wasm \
  --source alice --network testnet
```

`batch_payout` is the exception — it is stateless, so one deployment is
reusable indefinitely.

## What each example shows

| Example | Covers |
|---|---|
| `stream-lifecycle.ts` | create, simulate, sign, send, read back, withdraw, and the conservation invariant on-chain |
| `escrow-lifecycle.ts` | init, fund, release, and why the beneficiary cannot release to themselves |
| `vesting-lifecycle.ts` | the schedule as a pure function of time, the cliff, and revoke returning only the unvested part |
| `recurring-subscription.ts` | authorize, why the token allowance is the real cap, and why skipped periods are forfeited |
| `batch-payout.ts` | preview before signing, reading the cap, and chunking an oversized payroll |

## A thing worth knowing before you build a UI

An "available to withdraw" figure is **stale the moment you read it**. Stream
accrual is computed from ledger time, so it keeps rising between your balance
read and your transaction landing.

The first live run of `stream-lifecycle.ts` reported `can withdraw 0.00016` and
then withdrew `0.00026` — both correct, seconds apart. Show such figures as
"at least", or re-read immediately before submitting, rather than presenting
them as exact.
