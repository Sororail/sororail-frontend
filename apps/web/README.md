# apps/web — reference application

**Not started.** A design-token stylesheet was drafted and then removed rather
than left as half a scaffold pretending to be an app.

Planned: a Next.js App Router application demonstrating all five payment
primitives — payroll (batch + recurring), streams, vesting, escrow, and a
unified history feed from an indexer.

Three rules that must hold when it is built:

**The chain is the source of truth; the database is a cache.** Balances, stream
states and vesting positions are always read from the contract. Postgres exists
to make history queryable and to hold off-chain metadata — recipient names,
invoice notes, email addresses. Any screen showing money must be reconcilable
against chain state, with a visible way to trigger that reconciliation.

**No private keys server-side, ever.** All signing is client-side through the
wallet, via the SDK's injected `Signer`.

**Never present an accrued balance as exact.** Stream and vesting figures are
computed from ledger time and keep rising between the read and the transaction
landing — a live run saw `0.00016` reported and `0.00026` withdrawn seconds
later. Show "at least", or re-read immediately before submitting.

See the `apps/web` section of SPEC.md in the contracts repo for the full brief.
