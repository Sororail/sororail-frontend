# so4-oracle

Cloudflare Worker keeper for the SO4.market Soroban oracle.

This repository is intentionally scoped to the oracle only. The old Axum API server,
contract deployment scripts, Docker stack, and local contract workspace have been
removed so the remaining build surface is the scheduled keeper.

## Deployed Contract Reference

Testnet oracle:

```text
ORACLE=CAH5Z3RD6UMR6RIDXT4ZGOC5SMDCQRA2T3FO4FJSOYZGQPWS77ZGTXUO
ROLE_STORE=CB3XTQXIZMPDMJYPTZKWD6W2AI6HBXXPGO2DC3XOC7NQU4A2NUA327NA
DATA_STORE=CCJ3PT3DEQ6CYQND2OU3ORLYYCEYHHSPBWBZNG2NTGGMW3DSOAXVTUT2
ADMIN=GAUHMCMUP5FZO5675W3ISZ6E6CNYJGXBUW5WANE2JR4TGAARYCTSCBKI
NETWORK=testnet
```

Contract source reference lives outside this repo at:

```text
/home/sunny/zero/so4-market-project/contracts
```

## What The Keeper Does

- Loads token feed config from `PRICE_FEED_CONFIG`.
- Fetches prices from Binance, Coinbase, and Pyth per token config.
- Filters outliers and computes a min/max price band.
- Applies a movement circuit breaker against the last submitted price in KV.
- Caches current prices and status in Cloudflare KV.
- Exposes small operational endpoints:
  - `GET /prices`
  - `GET /oracle/status`
  - `GET /oracle/failed-submissions`
  - `GET /keeper/balance`

## Required Worker Configuration

Secrets:

```bash
wrangler secret put KEEPER_PRIVATE_KEY
wrangler secret put KEEPER_ACCOUNT_ID
wrangler secret put PRICE_FEED_CONFIG
```

Variables are defined in `wrangler.toml` for testnet defaults:

```text
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
ORACLE_CONTRACT_ID=CAH5Z3RD6UMR6RIDXT4ZGOC5SMDCQRA2T3FO4FJSOYZGQPWS77ZGTXUO
```

`ORACLE_KV` must be bound to a real Cloudflare KV namespace before deployment.

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
