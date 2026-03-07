# apps/docs — documentation site

**Not started.**

Planned: an Astro Starlight site covering getting started, one concepts page per
payment primitive, contract and SDK reference, guides, and security.

Two constraints worth keeping when it is built:

**Every code sample must be extracted from a compiling example** in
`packages/sdk/examples/`, not hand-written into the docs where it will rot.

**Concepts pages must be readable by someone who has never used Soroban.** This
is the on-ramp. Include a page on the decimals trap and one on Soroban TTL /
state expiry — both bite every new integrator.
