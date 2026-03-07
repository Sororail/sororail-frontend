# apps/web — reference application

**Not started.**

Planned: a Next.js App Router application demonstrating all five payment
primitives — payroll (batch + recurring), streams, vesting, escrow, and a
unified history feed from an indexer.

Two rules from the spec that must hold when it is built:

**The chain is the source of truth; the database is a cache.** Balances, stream
states and vesting positions are always read from the contract. Postgres exists
to make history queryable and to hold off-chain metadata — recipient names,
invoice notes, email addresses. Any screen showing money must be reconcilable
against chain state, with a visible way to trigger that reconciliation.

**No private keys server-side, ever.** All signing is client-side through the
wallet, via the SDK's injected `Signer`.

See the `frontend` section of SPEC.md in the contracts repo for the full brief.
