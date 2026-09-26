# @sororail/sdk

Typed TypeScript client for the [SoroRail](https://github.com/Sororail) Soroban
payment contracts: streams, vesting, escrow, recurring charges and batch
payouts.

> ### Unaudited. Testnet only.
>
> The contracts this talks to have not been audited. **Do not use them with
> real value.**

Zero framework dependencies: no React, no assumptions about where it runs.
Signing is injected rather than performed here, so the SDK never holds a secret
key.

## Install

```bash
pnpm add @sororail/sdk @stellar/stellar-sdk
```

The SDK is not published yet; until it is, use it from this workspace.

## Usage

```ts
import {
  StreamClient,
  KeypairSigner,
  ContractError,
  NetworkError,
  SigningError,
  ValidationError,
} from "@sororail/sdk";
import { Networks } from "@stellar/stellar-sdk";

const signer = new KeypairSigner(process.env.SECRET_KEY!);
const stream = new StreamClient({
  contractId: "CBEE4SRXRGCJDWXP6DDOSX6FR4S2PJ5KHUQCHI3ABY3SQTCHYSA7CGC7",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  publicKey: signer.publicKey,
});

try {
  // Build and inspect before anyone signs.
  const call = await stream.withdraw();
  const wouldReceive = await call.simulate();

  // Then commit.
  const { hash, result } = await call.signAndSend(signer);
} catch (error) {
  if (error instanceof ContractError) {
    // The contract refused. `message` is a sentence to show a person;
    // branch on the variant (or the stable numeric `code`) to recover.
    if (error.is("StreamInsufficientAccrued")) {
      // Asked for more than has accrued: withdraw less, or wait.
    }
  } else if (error instanceof ValidationError) {
    // Rejected before anything was sent. Fix the arguments.
  } else if (error instanceof SigningError) {
    // No wallet, locked, declined, or on the wrong network.
  } else if (error instanceof NetworkError) {
    // Could not simulate or submit. The original failure is `error.cause`.
  } else {
    throw error;
  }
}
```

Everything the SDK throws extends `SororailError`, so anything else that reaches
the final branch is a bug in the calling code, not a failed call.

## Amounts

Amounts are `bigint`, never `number`. Use `toStroops` / `fromStroops` at the
edges, and read `decimals()` off the token rather than assuming 7.

## Examples

Runnable, live-testnet examples for each contract are in
[`examples/`](./examples); see [`examples/README.md`](./examples/README.md) for
setup.

## API reference

Generate the browsable reference from the source JSDoc with:

```bash
pnpm --filter @sororail/sdk docs:api
```

## Links

- [Monorepo README](../../README.md)
- [Changelog](./CHANGELOG.md)

## License

Apache-2.0.
