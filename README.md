# SoroRail — frontend

The TypeScript half of [SoroRail](https://github.com/Sororail): the client SDK,
the reference application, and the documentation site, in one pnpm workspace.

The contracts live in
[Sororail/sororail-contracts](https://github.com/Sororail/sororail-contracts).
Nothing here can be correct until those are, so that repo leads.

> ### Unaudited. Testnet only.
>
> The contracts this talks to have not been audited. **Do not use them with
> real value.** No mainnet addresses will be published before an audit.

## Layout

```
frontend/
├── packages/
│   └── sdk/          @sororail/sdk — typed client        ✅ built
└── apps/
    ├── web/          Next.js reference application       ⬜ not started
    └── docs/         Astro Starlight documentation site  ⬜ not started
```

## Status

| Piece | State |
|---|---|
| `packages/sdk` | Clients for all five contracts, typed error decoding, Freighter + keypair signers, amount helpers. 28 unit tests, 5 runnable examples, typechecks against `@stellar/stellar-sdk` 17.0.1. |
| `apps/web` | Not started. |
| `apps/docs` | Not started. |

**Verified end-to-end against live testnet.** `examples/stream-lifecycle.ts`
created and withdrew from a real stream on 2026-09-07 — transactions
[`520c753b`](https://stellar.expert/explorer/testnet/tx/520c753bb51cb97be5f85d92f77d37cf28b7966c2722eddae167a587287fc20b)
and
[`30d080d7`](https://stellar.expert/explorer/testnet/tx/30d080d7e52279c0eee441447269752e2feafb29e792eb992057c9a89a307d33)
— and the contract's conservation invariant held on-chain.

Not yet done: the SDK is unpublished and the `@sororail` npm scope is not
reserved. The escrow, vesting, recurring and batch examples typecheck but have
not each been run live; only the stream one has.

## Development

```bash
pnpm install
pnpm test          # all packages
pnpm typecheck
pnpm build
pnpm changeset     # describe a change for the next release
```

Node ≥20. pnpm 10.

Runnable examples live in [`packages/sdk/examples`](packages/sdk/examples) —
they run against a real network, so they double as smoke tests. See their
README for setup.

## The SDK

```ts
import { StreamClient, KeypairSigner, toStroops, ContractError } from "@sororail/sdk";
import { Networks } from "@stellar/stellar-sdk";

const signer = new KeypairSigner(process.env.SECRET_KEY!);
const stream = new StreamClient({
  contractId: "CBEE4SRXRGCJDWXP6DDOSX6FR4S2PJ5KHUQCHI3ABY3SQTCHYSA7CGC7",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  publicKey: signer.publicKey,
});

// Build and inspect before anyone signs.
const call = await stream.withdraw();
const wouldReceive = await call.simulate();

// Then commit.
try {
  const { hash, result } = await call.signAndSend(signer);
} catch (error) {
  if (error instanceof ContractError && error.is("StreamInsufficientAccrued")) {
    // error.message is a sentence you can show a user.
  }
}
```

### Design rules

**Signing is injected, never performed here.** The SDK builds and submits
transactions but never holds a secret key. Supply a `Signer` — `FreighterSigner`
in a browser, `KeypairSigner` for tests and scripts.

**Every stage is separately accessible.** `prepare` → `simulate` →
`signAndSend`, rather than one opaque call. A confirmation screen can only be
honest if it can show what a transaction will do *before* asking for a
signature, so nothing collapses those steps.

**Amounts are `bigint`, never `number`.** `Number` loses integer precision above
2^53, which is well inside the range of a real balance. Use `toStroops` /
`fromStroops` at the edges — and note the **decimals trap**: 7 is the default
for classic Stellar assets, but a custom token can declare anything, so read
`decimals()` off the token rather than assuming.

**Errors are decoded, never bare codes.** `ContractError` carries the ABI
integer, the variant name, the owning contract, and a message written for a
person. The code table mirrors `sororail_common::errors` and is tested against
its reserved ranges.

**Zero framework dependencies.** No React. If React helpers are ever wanted they
go in a separate `packages/react`.

## Two contract behaviours to surface in any UI

**Recurring charges do not accrue retroactively.** A payee who forgets to charge
for three months cannot then take three payments — the next charge is scheduled
from *now*, and skipped periods are gone. This is deliberate consumer
protection, and it surprises merchants. Say so in the UI.

**Batch payouts are capped and all-or-nothing.** Read
`BatchPayoutClient.maxRecipients()` rather than hardcoding, and use
`BatchPayoutClient.chunk()` to split a larger payroll. If any transfer fails,
nobody is paid.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
