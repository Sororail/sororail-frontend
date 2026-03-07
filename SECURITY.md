# Security Policy

## Status: unaudited, testnet only

**These contracts have not been audited. Do not deploy them to mainnet and do
not use them to handle real value.** No mainnet addresses will be published
until an external audit is complete.

This is stated here, in the README, and in the reference application's UI. The
credibility of this project rests on not overstating its maturity.

## Reporting a vulnerability

**Do not open a public issue for a security report.**

Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability), which opens a private advisory visible
only to maintainers.

Please include: the affected contract and version or commit, a description of
the impact, and the smallest reproduction you have — ideally a failing test.

We aim to acknowledge a report within 72 hours and to give an assessment with a
remediation timeline within seven days. We will credit reporters in the
advisory unless asked not to.

## Scope

In scope: the contracts these clients talk to — incorrect authorization, loss or
lock-up of funds, conservation violations (withdrawn + refunded + remaining not
equalling deposited), arithmetic errors, and state-machine transitions that
should be illegal.

Out of scope: findings that require a compromised wallet or leaked key,
issues in the Stellar network or `soroban-sdk` itself (report those upstream),
and anything that depends on deploying to mainnet, which we ask you not to do.

## Automated checks

CI runs dependency audits on every pull request. Adding CoinFabrik's Scout, an
open-source static analyzer built for Soroban, is tracked as follow-up work.

The Stellar bug bounty covers Soroban platform exploits; contract-level
findings in this repository are ours, not theirs.
