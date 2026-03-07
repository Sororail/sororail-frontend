---
"@sororail/sdk": minor
---

Initial release: typed clients for all five SoroRail payment contracts.

- `EscrowClient`, `StreamClient`, `VestingClient`, `RecurringClient` and
  `BatchPayoutClient`, matching the contracts deployed to Stellar testnet.
- Separately accessible call stages — `prepare` → `simulate` → `signAndSend` —
  so a confirmation screen can show what a transaction will do before anyone
  signs it.
- Injected signing: the SDK never holds a secret key. Ships `FreighterSigner`
  (accepting both the `getPublicKey` and `getAddress` extension API shapes) and
  `KeypairSigner` for tests and scripts.
- Contract failures decode to a typed `ContractError` carrying the ABI integer,
  the variant name, the owning contract and a message written for a person.
- Amounts are `bigint` throughout, with `toStroops` / `fromStroops` /
  `formatAmount`. `toStroops` takes a string and refuses to truncate excess
  precision rather than silently dropping it.
