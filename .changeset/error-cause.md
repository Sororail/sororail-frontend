---
"@sororail/sdk": patch
---

Keep the original failure as `cause` on every wrapped RPC and simulation error (#370).

- Simulation errors, rejected submissions and failed transactions now carry the
  full RPC response as `error.cause`, not just the extracted error string or
  result XDR. Incomplete simulations and unconfirmed (`NOT_FOUND`) transactions,
  which previously had no `cause`, carry their response too.
- `decodeError(input, { cause })` decodes the code and message from `input` and
  attaches `cause` instead; `cause` still defaults to `input`.
- `SororailError#toString()` is always the one-line `Name: message` and never
  includes `cause`. A non-string, non-Error input now gets a short message
  instead of `[object Object]`.
