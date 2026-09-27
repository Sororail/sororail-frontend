---
"@sororail/sdk": minor
---

`FreighterSigner` now checks the extension's live account and network instead
of trusting what it saw at connect.

- `currentAddress()` and `networkPassphrase()` read what is currently selected
  in Freighter. `assertNetwork(expected)` throws the new `NetworkMismatchError`
  when the extension is on a different network.
- `signTransaction` refuses with a `SigningError` if the user switched accounts
  after connecting, and with `NetworkMismatchError` — naming the network to
  switch to — if Freighter is on a different network than the transaction.
- `FreighterApi` accepts the optional `getNetwork` and `getNetworkDetails`
  extension methods.
- The published package now includes `CHANGELOG.md`.
