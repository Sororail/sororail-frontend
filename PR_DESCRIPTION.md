# fix: #512 #516 #532 #540 — shutdown coverage, RPC error branches, pyth feed_id match, atomic price cache

## Summary

Closes #512, #516, #532, #540.

Four independent fixes across `price_loop`, `keeper_loop`, and `pyth` — each
addressing a distinct correctness or coverage gap identified in the issue
tracker. A pre-existing compile error in `signing.rs` (duplicate function +
dead code) is also resolved as a prerequisite.

---

## #532 — `fetch_pyth_price` must verify the returned feed id matches the request

**File:** `oracle/src/pyth.rs`

**Problem:** The Hermes array-response branch called `feeds.pop()`, silently
accepting whatever the last element happened to be. If the endpoint ever
returned more than one feed (batched response, API change, or a
compromised/MITM'd endpoint), the oracle would price a token using an
unrelated feed's value with no error raised.

**Fix:** Replace `pop()` with `find(|f| f.id == feed_id)`. If no entry matches,
`MissingFeedId` is returned — the same error already used for an empty array.

```rust
// before
HermesResponse::Array(mut feeds) => feeds
    .pop()
    .ok_or_else(|| PythPriceError::MissingFeedId(feed_id.to_string()))?,

// after
HermesResponse::Array(feeds) => feeds
    .into_iter()
    .find(|f| f.id == feed_id)
    .ok_or_else(|| PythPriceError::MissingFeedId(feed_id.to_string()))?,
```

**Tests added:**
- `hermes_array_with_wrong_feed_id_returns_missing_feed_id_error` — find() returns None when no id matches
- `hermes_array_with_matching_feed_id_returns_correct_feed` — correct feed selected from a multi-entry array

---

## #540 — Atomic price cache update (torn-read fix)

**File:** `oracle/src/price_loop.rs`

**Problem:** `run_price_cycle` acquired and released the `RwLock<PriceCache>`
once per token (N separate critical sections), plus a final acquisition for
`last_updated`. Because `build_cached_price` performs retried HTTP calls between
those acquisitions, the write loop can span several seconds. The keeper's
independent ticker can fire mid-cycle and read a mix of stale entries from the
previous cycle and fresh entries from the in-progress one, submitting that
incoherent snapshot as a single `set_prices` on-chain call.

**Fix:** Build the full price map into a local `BTreeMap` with no lock held,
then commit `prices` and `last_updated` together under a single `write().await`.
Any reader now always observes a fully-formed snapshot from one completed cycle.

```rust
// before: N+1 separate lock acquisitions
for token in &state.config.price_feed.tokens {
    if let Ok(price) = build_cached_price(...).await {
        state.price_cache.write().await.prices.insert(key, price); // lock per token
    }
}
if tokens_ok > 0 {
    state.price_cache.write().await.last_updated = Some(SystemTime::now()); // +1 lock
}

// after: single atomic commit
let mut new_prices = BTreeMap::new();
for token in &state.config.price_feed.tokens {
    if let Ok(price) = build_cached_price(...).await {
        new_prices.insert(token.lookup_key(), price);
    }
}
if tokens_ok > 0 {
    let mut cache = state.price_cache.write().await;
    cache.prices = new_prices;
    cache.last_updated = Some(SystemTime::now());
}
```

---

## #516 — Test `get_account_sequence` and `simulate_contract_call` error branches

**File:** `oracle/tests/keeper_cycle_integration.rs`

**Problem:** Both functions have three failure branches triggered by a
malformed-but-200 JSON-RPC response (an `error` field present, a missing
`result`/`sequence` field, and a non-parseable sequence string). None of these
branches had test coverage. A malformed-200 is a realistic failure mode that the
outer HTTP client would not catch.

**Tests added (5 total):**

`get_account_sequence`:
- `get_account_sequence_rpc_error_field_propagates` — response contains `"error"` key → cycle errors with `"getAccount error"`
- `get_account_sequence_missing_sequence_field_propagates` — `result` present but no `sequence` key → `"Missing sequence"`
- `get_account_sequence_non_numeric_sequence_propagates` — `sequence: "not-a-number"` → `"failed to parse sequence"`

`simulate_contract_call`:
- `simulate_contract_call_rpc_error_field_propagates` — response contains `"error"` key → `"Simulation error"`
- `simulate_contract_call_missing_result_field_propagates` — neither `result` nor `error` present → `"Missing result"`

All tests use `wiremock` to serve a real HTTP 200 with the malformed body,
exercising the exact shape-check logic inside each function.

---

## #512 — `run_price_loop` / `run_keeper_loop` shutdown path coverage

**Files:** `oracle/src/price_loop.rs`, `oracle/src/keeper_loop.rs`

**Problem:** The `tokio::select!` shutdown arm (`shutdown_token.cancelled() =>
break`) in both long-running loops was never exercised by any test. A regression
(e.g. reordering the `select!` arms) would not be caught.

**Tests added:**
- `run_price_loop_exits_promptly_on_shutdown` (in `price_loop.rs`)
- `run_keeper_loop_exits_promptly_on_shutdown` (in `keeper_loop.rs`)

Each test:
1. Constructs an `AppState` with a 50 ms loop interval pointing at an unreachable RPC (cycles error-out harmlessly)
2. Spawns the real loop function via `tokio::spawn`
3. Sleeps 120 ms to guarantee at least one tick fires
4. Calls `state.shutdown_token.cancel()`
5. Asserts the task handle resolves within 500 ms via `tokio::time::timeout`

---

## Bonus — Pre-existing `signing.rs` compile errors fixed

`oracle/src/signing.rs` had two bugs that prevented `cargo test` from compiling:

1. `build_price_message` was defined twice (duplicate function body)
2. Dead code after `Ok(signature)` in `sign_price` (a second `let payload` / `signing_key.sign` / `Ok(signature)` block that could never be reached)

Both are removed. No behaviour change — the first (correct) definition and the
first `Ok(signature)` are kept.

---

## Testing

```bash
cargo check --workspace          # clean
cargo test --workspace           # all existing + new tests pass
```

All new tests are self-contained (wiremock / in-process tokio) and require no
network access or live RPC.
