# so4-oracle

Cloudflare Worker keeper for the SO4.market Soroban oracle.

This repository is intentionally scoped to the oracle only. The old Axum API server,
contract deployment scripts, Docker stack, and local contract workspace have been
removed so the remaining build surface is the scheduled keeper.

## Deployed Contract Reference

Testnet oracle:

```text
ORACLE=CBABE5O7QJMXT2I42KHUV7ESNER3Z2BGJCF2QRKWMKVTCBEYFQNHV3J6
ROLE_STORE=CBSUAIAMIFFS4AXQYZ7KR7FNO7IMKAPS5WF4DXANVXDTPKH2F7YUIN6Q
DATA_STORE=CCZ3VKBEDLNBO2JM3EXL3SNBDJOV5BTN52FVQPER7F6D5GCE53PITQ3J
ADMIN=GAUHMCMUP5FZO5675W3ISZ6E6CNYJGXBUW5WANE2JR4TGAARYCTSCBKI
NETWORK=testnet
```

Contract source reference lives outside this repo at:

```text
/home/sunny/zero/so4-market-project/contracts
```

## What The Keeper Does

- Loads token feed config from `PRICE_FEED_CONFIG`, falling back to `config/tokens.json`.
- Fetches prices from Binance, Coinbase, and Pyth per token config.
- Filters outliers and computes a min/max price band.
- Signs live price payloads without writing to Cloudflare KV.
- Exposes small operational endpoints:
  - `GET /prices` (live, on-demand)
  - `GET /health`
  - `GET /oracle/status` (live, on-demand; requires admin bearer token)
  - `GET /oracle/failed-submissions` (log-only notice; requires admin bearer token)
  - `GET /keeper/balance` (requires admin bearer token)

## Required Worker Configuration

Secrets:

```bash
wrangler secret put KEEPER_PRIVATE_KEY
wrangler secret put KEEPER_ACCOUNT_ID
wrangler secret put ADMIN_API_TOKEN
wrangler secret put PRICE_FEED_CONFIG
```

Variables are defined in `wrangler.toml` for testnet defaults:

```text
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
ORACLE_CONTRACT_ID=CBABE5O7QJMXT2I42KHUV7ESNER3Z2BGJCF2QRKWMKVTCBEYFQNHV3J6
```

No KV namespace is required. The Worker is stateless; failures and diagnostics are emitted to Worker logs.

## Development

```bash
cargo check --workspace
cargo test --workspace
wrangler dev --test-scheduled
wrangler deploy
```

Install `worker-build` once if it is not already available:

```bash
cargo install worker-build
```
