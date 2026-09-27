# apps/docs — documentation site

An [Astro Starlight](https://starlight.astro.build) site. **Scaffolded, not
complete.**

```bash
pnpm --filter @sororail/docs dev      # http://localhost:4321
pnpm --filter @sororail/docs build    # static site in apps/docs/dist
```

Needs Node 22.12 or later (Astro's minimum), stricter than the rest of the
workspace.

Pages live in `src/content/docs/`; the sidebar is configured in
`astro.config.mjs`.

## What is here

- A landing page.
- **Getting started**: setting up the workspace and running an example, with
  the full `stream-lifecycle.ts` example included from `packages/sdk/examples/`.
- **Concepts → Amounts and the decimals trap.**

## Still planned

One concepts page per payment primitive, a page on Soroban TTL / state expiry,
contract and SDK reference, guides, and security. Until then, the root
[README](../../README.md) covers signers, errors and running the app, and
Getting started links there.

## Two constraints to keep

**Every code sample must be extracted from a compiling example** in
`packages/sdk/examples/`, not hand-written into the docs where it will rot.
Import the file with Vite's `?raw` suffix and render it with Starlight's
`<Code>` component, as `getting-started.mdx` does.

**Concepts pages must be readable by someone who has never used Soroban.** This
is the on-ramp. Include a page on the decimals trap and one on Soroban TTL /
state expiry — both bite every new integrator.
