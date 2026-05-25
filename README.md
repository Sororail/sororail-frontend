# so4-oracle

Oracle keeper and API server for [SO4 Markets](https://github.com/SO4-Markets) — a decentralised perpetuals and spot exchange on Stellar/Soroban.

This workspace feeds signed prices into the on-chain `oracle` contract and exposes REST/WebSocket APIs for frontends and integrators.

---

## Workspace Structure

```
so4-oracle/
├── Cargo.toml          # Workspace manifest
├── wrangler.toml       # Cloudflare Worker deployment config
│
├── oracle/             # Cloudflare Worker — keeper price submission
│   ├── Cargo.toml
│   └── src/lib.rs
│
└── apis/               # Native Axum server — REST + WebSocket API
    ├── Cargo.toml
    └── src/main.rs
```

---

## Crates

### `oracle` — Cloudflare Worker

Runs on Cloudflare's edge network. Fetches prices from external exchanges, aggregates them, signs with the keeper ed25519 key, and submits to the on-chain `oracle` Soroban contract via Stellar RPC.

Deployed via `wrangler deploy`.

### `apis` — Axum API Server

A standard Tokio/Axum binary that projects can run alongside or independently. Exposes price feeds, market data, and oracle status over HTTP and WebSocket so frontends and integrators don't need to hit Stellar RPC directly.

Runs with `cargo run -p apis`.

---

## Features

### Oracle Worker (`oracle/`)

- [x] Cloudflare Worker scaffolding (Axum + worker-build)
- [ ] Fetch prices from Binance
- [ ] Fetch prices from Coinbase
- [ ] Fetch prices from Pyth Network
- [ ] Multi-source median price aggregation
- [ ] Outlier rejection (> 3σ from median)
- [ ] Confidence interval calculation
- [ ] Ed25519 keeper key signing (on-chain oracle message format)
- [ ] Stellar RPC client — submit signed prices to on-chain oracle
- [ ] Cloudflare Cron Trigger — scheduled price updates (every ~30s)
- [ ] Multi-token feed configuration (token list + per-token source mapping)
- [ ] Retry logic with exponential backoff
- [ ] Network selection via env vars (testnet / mainnet)
- [ ] Keeper wallet balance monitoring
- [ ] Dead-letter queue for failed submissions

### APIs Server (`apis/`)

- [x] `GET /health` — `{"status":"ok"}`
- [ ] `GET /prices` — latest aggregated prices for all tokens
- [ ] `GET /prices/:token` — single token price (min/max/timestamp)
- [ ] `GET /markets` — all active markets with pool stats
- [ ] `GET /markets/:market_token` — single market detail (pool value, OI, funding rate)
- [ ] `GET /positions/:account` — account open positions
- [ ] `GET /orders/:account` — account pending orders
- [ ] `GET /oracle/status` — keeper health, last update time, submission latency
- [ ] `WS /prices/stream` — real-time price push over WebSocket
- [ ] Redis / in-memory cache layer for oracle prices
- [ ] CORS configuration for frontend integration
- [ ] Rate limiting middleware
- [ ] Structured logging (`tracing` subscriber)
- [ ] Graceful shutdown
- [ ] OpenAPI / Swagger spec generation
- [ ] Admin endpoint authentication

---

## Getting Started

**Prerequisites:** Rust (stable), `wrangler` CLI, a Cloudflare account for the worker.

```bash
# Check the workspace builds
cargo check

# Run the APIs server locally
cargo run -p apis
# → listening on 0.0.0.0:3000

# Deploy the oracle worker to Cloudflare
wrangler deploy
```

---

## Environment Variables

| Variable | Crate | Description |
|---|---|---|
| `KEEPER_PRIVATE_KEY` | oracle | Ed25519 private key (hex) for signing prices |
| `STELLAR_RPC_URL` | oracle | Stellar RPC endpoint |
| `ORACLE_CONTRACT_ID` | oracle | On-chain oracle contract address |
| `NETWORK_PASSPHRASE` | oracle | `"Test SDF Network ; September 2015"` or mainnet |
| `PORT` | apis | Listen port (default `3000`) |
| `REDIS_URL` | apis | Redis connection string for price cache |

---

## Related Repos

| Repo | Description |
|---|---|
| [SO4-Markets/contracts](https://github.com/SO4-Markets/contracts) | Soroban smart contracts |
| [SO4-Markets/interface](https://github.com/SO4-Markets/interface) | Frontend |

---

## License

MIT
