# Contributing

This repo holds the TypeScript half of SoroRail: the SDK, the reference app and
the docs site. The contracts live in
[Sororail/sororail-contracts](https://github.com/Sororail/sororail-contracts).

## Setup

```bash
pnpm install
pnpm test
pnpm typecheck
```

Node ≥20, pnpm 10.

## What a complete PR looks like

- [ ] Tests added
- [ ] `pnpm test` and `pnpm typecheck` green
- [ ] Docs updated — a PR that changes public behavior without touching docs is
      incomplete
- [ ] No unrelated changes
- [ ] Breaking changes called out explicitly

## Rules that will fail review

**Amounts are `bigint`, never `number`.** `Number` loses integer precision above
2^53. Converting a balance to `number` anywhere will be asked to change, even
where it happens to be safe, because the invariant is easier to hold with no
exceptions.

**Never surface a raw contract error code.** Decode through `ContractError` so
the user sees a sentence. If a code has no message, add one to
`src/errors/codes.ts`.

**The error code table is ABI.** `src/errors/codes.ts` mirrors
`sororail_common::errors` in the contracts repo. Do not renumber entries; add
new ones inside the owning range and leave retired numbers burned.

**Signing stays injected.** The SDK must never hold or ask for a secret key.

**No secret keys server-side in the app.** All signing is client-side through
the wallet.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org)
- **Branching:** trunk-based, squash merge, linear history
- **CI must be green to merge**, with no exceptions for maintainers

## Security

Do not report vulnerabilities through public issues. See [SECURITY.md](SECURITY.md).
