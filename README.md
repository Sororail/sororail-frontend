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
    ├── web/          Next.js reference application       ✅ built
    └── docs/         Astro Starlight documentation site  🚧 scaffolded
```

## Status

| Piece | State |
|---|---|
| `packages/sdk` | Clients for all five contracts, typed error decoding, Freighter + keypair signers, amount helpers. 28 unit tests, 5 runnable examples, typechecks against `@stellar/stellar-sdk` 17.0.1. |
| `apps/web` | Overview, payroll, streams, vesting and escrow screens. Builds and serves; typechecks. Wallet-connected flows have not been click-tested against a real wallet. |
| `apps/docs` | Starlight site scaffolded: a landing page, Getting started (with the stream example included from `packages/sdk/examples`), and the amounts / decimals-trap concepts page. Reference, per-primitive concepts, TTL and security pages are not written yet. |

**Verified end-to-end against live testnet.** `examples/stream-lifecycle.ts`
created and withdrew from a real stream on 2026-09-07 — transactions
[`520c753b`](https://stellar.expert/explorer/testnet/tx/520c753bb51cb97be5f85d92f77d37cf28b7966c2722eddae167a587287fc20b)
and
[`30d080d7`](https://stellar.expert/explorer/testnet/tx/30d080d7e52279c0eee441447269752e2feafb29e792eb992057c9a89a307d33)
— and the contract's conservation invariant held on-chain.

**Not yet verified live:** the escrow, vesting, recurring and batch examples.
Only the stream one has been run by hand. All five now assert what they
demonstrate and are run by the scheduled `integration` job in
[`ci.yml`](.github/workflows/ci.yml), which deploys a fresh instance of each
contract to testnet — but that job has not yet reported a run, so treat those
four as unrun until it does.

Not yet done: the SDK is unpublished and the `@sororail` npm scope is not
reserved. The app has no indexer, no database and no history feed — it is
entirely client-side against Soroban RPC — and its wallet flows have not been
exercised with a real Freighter extension.

## Running the app

```bash
pnpm --filter @sororail/web dev
```

Then open http://localhost:3000. You will need
[Freighter](https://freighter.app) and a funded testnet account.

The app is configured through environment variables, all optional. Copy
[`apps/web/.env.example`](apps/web/.env.example) to `apps/web/.env.local` and
uncomment what you need:

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint. Must serve testnet. |
| `NEXT_PUBLIC_TOKEN_ID` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` (native XLM on testnet) | Token the payroll screen pays out in. |
| `NEXT_PUBLIC_BATCH_PAYOUT_ID` | `CDKJ56S7K7QC4LG6SFF2OGDTG6N4QBCJOVRWHY7MKCWD5JPQ6MDAHRAM` | The shared `batch_payout` deployment used by the payroll and overview screens. |
| `NEXT_PUBLIC_EXPLORER_URL` | derived from the RPC URL | Block explorer base for transaction and contract links, e.g. `https://stellar.expert/explorer/testnet`. |

The defaults work against the public testnet as-is. Override them when:

- **You use a different RPC provider**, or a local node running in testnet
  mode. It still has to serve testnet: the network passphrase is fixed to
  testnet, and the app checks the RPC's network at startup and refuses to run
  if it does not match.
- **Testnet has been reset, or you deployed your own `batch_payout`.** The
  default address comes from the contracts repo's
  [DEPLOYMENTS.md](https://github.com/Sororail/sororail-contracts/blob/main/DEPLOYMENTS.md);
  after a reset it no longer exists, so point `NEXT_PUBLIC_BATCH_PAYOUT_ID` at
  a fresh deployment.
- **You want payroll in a token other than native XLM.** Set
  `NEXT_PUBLIC_TOKEN_ID` to that token's contract address.

Without `NEXT_PUBLIC_EXPLORER_URL`, an RPC on a testnet host links to the
testnet explorer; any other RPC (a local quickstart node, futurenet) gets no
explorer links rather than links that 404.

To see the SDK working against a real network, run the five live-testnet
examples (`stream-lifecycle.ts`, `vesting-lifecycle.ts`, `escrow-lifecycle.ts`,
`recurring-subscription.ts`, `batch-payout.ts`). Setup and run instructions are
in [`packages/sdk/examples/README.md`](packages/sdk/examples/README.md).

## Development

```bash
pnpm install
pnpm test          # all packages
pnpm typecheck
pnpm build
pnpm changeset     # describe a change for the next release
pnpm --filter @sororail/docs dev   # the documentation site
```

Node ≥20. pnpm 10. The docs site needs Node ≥22.12.

Runnable examples live in [`packages/sdk/examples`](packages/sdk/examples) —
they run against a real network and assert what they demonstrate, so they are
the SDK's integration tests. `pnpm --filter @sororail/sdk test:integration`
runs all five; see their README for setup.

### Releases and changelog

Releases are managed with [Changesets](https://github.com/changesets/changesets).
A PR that changes the SDK's published behaviour adds a changeset
(`pnpm changeset`); cutting a release (`pnpm version-packages`) turns the
pending ones into an entry in
[`packages/sdk/CHANGELOG.md`](packages/sdk/CHANGELOG.md), which also ships in
the npm package. Nothing has been released yet, so the changelog is empty and
upcoming changes are the files in [`.changeset/`](.changeset). The reference
app is not published and has no changelog. See
[`.changeset/README.md`](.changeset/README.md) for the release steps.

## The SDK

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

Every stage can fail, so the whole flow sits in one `try`:

| Error | Thrown by | What it means |
|---|---|---|
| `ValidationError` | building a call (`stream.withdraw()` etc.) | Bad arguments, or a client without a `publicKey`. Nothing was sent. |
| `ContractError` | `simulate()`, `signAndSend()` | The contract refused. Carries `code`, `variant`, `contract` and a readable `message`. |
| `SigningError` | `signAndSend()` | The signer could not sign: no wallet, locked, declined, a switched account, or `NetworkMismatchError` for the wrong network. |
| `NetworkError` | any stage | The RPC could not be reached or rejected the request; the original failure is `cause`. |

All of them extend `SororailError`, so anything else is a bug in the calling
code rather than a failed call. The reference app's
[`Feedback.tsx`](apps/web/src/components/Feedback.tsx) and
[`recovery.ts`](apps/web/src/lib/recovery.ts) show one way to turn these into
UI: the message says what happened, the recovery text says what to do next.

### Choosing a signer

Every call that changes state is signed by a `Signer`, and the SDK ships two.
Pick by where your code runs and who holds the key:

| | `KeypairSigner` | `FreighterSigner` |
|---|---|---|
| Runs in | Node: scripts, tests, CI, a backend with a key it already controls | A browser with the [Freighter](https://freighter.app) extension installed |
| Who holds the key | Your process, in memory | The user, inside the extension; your code never sees it |
| Create it with | `new KeypairSigner(secretKey)` | `await FreighterSigner.connect()` |
| Account and network | Fixed by the key; the network comes from the client config | Re-checked before every signature. A switched account throws `SigningError`, a different network `NetworkMismatchError` |
| Never | Ship it to a browser. The secret would sit in page memory, where any script on the origin can read it | Use it outside a browser. There is no extension to ask |

The client code is the same either way; only the signer changes.

**A script or server** signs with a key from its own environment:

```ts
import { KeypairSigner, StreamClient } from "@sororail/sdk";
import { Networks } from "@stellar/stellar-sdk";

// Read the secret from the environment, never from source control.
const signer = new KeypairSigner(process.env.SOROBAN_SECRET_KEY!);
const stream = new StreamClient({
  contractId: process.env.STREAM_CONTRACT_ID!,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  publicKey: signer.publicKey,
});

const call = await stream.withdraw();
const { hash } = await call.signAndSend(signer);
```

**A browser app** asks the user's wallet to sign:

```ts
import { FreighterSigner, StreamClient } from "@sororail/sdk";
import { Networks } from "@stellar/stellar-sdk";

// Resolves the account selected in Freighter. Throws SigningError if the
// extension is missing, locked or not connected.
const signer = await FreighterSigner.connect();
const stream = new StreamClient({
  contractId,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  publicKey: signer.publicKey,
});

const call = await stream.withdraw();
// Freighter shows the user the transaction and asks them to approve it.
const { hash } = await call.signAndSend(signer);
```

`connect()` reads `globalThis.freighterApi` by default; if you use the
`@stellar/freighter-api` package, pass its API to `connect()` instead. The
signer keeps the account it connected as, so call `connect()` again when the
user switches accounts. The reference app's
[`wallet.tsx`](apps/web/src/lib/wallet.tsx) does this, along with restoring a
session on reload and surfacing a wrong network.

Anything else (a hardware wallet, an HSM, another browser wallet) can implement
`Signer` directly: a `publicKey` and a `signTransaction(xdr, { networkPassphrase })`
that returns the signed envelope.

### Design rules

**Signing is injected, never performed here.** The SDK builds and submits
transactions but never holds a secret key. Supply a `Signer` — `FreighterSigner`
in a browser, `KeypairSigner` for tests and scripts. `FreighterSigner` re-reads
the extension's selected account and network before every signature and
refuses — with `NetworkMismatchError` for the wrong network — rather than
signing as an account or on a network the transaction was not built for.

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
