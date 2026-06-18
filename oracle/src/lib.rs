#![allow(unused_must_use)]

use axum::http::header::AUTHORIZATION;
use axum::{routing::get, Router};
use tower_service::Service;
use worker::*;

pub mod binance;
pub mod coinbase;
pub mod config;
pub mod keeper;
pub mod log;
pub mod network_config;
pub mod prices;
pub mod pyth;
pub mod retry;
pub mod signing;
pub mod stellar_rpc;
pub mod submit;

use network_config::StellarNetwork;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

fn ser_i128_str<S: Serializer>(v: &i128, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&v.to_string())
}

fn de_i128_str<'de, D: Deserializer<'de>>(d: D) -> Result<i128, D::Error> {
    let raw = serde_json::Value::deserialize(d)?;
    match &raw {
        serde_json::Value::String(s) => s.parse::<i128>().map_err(serde::de::Error::custom),
        serde_json::Value::Number(n) => n
            .as_i64()
            .map(|v| v as i128)
            .or_else(|| n.as_u64().map(|v| v as i128))
            .ok_or_else(|| serde::de::Error::custom("i128 out of i64 range")),
        _ => Err(serde::de::Error::custom("expected string or number for i128")),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedPrice {
    pub token: String,
    pub symbol: String,
    #[serde(serialize_with = "ser_i128_str", deserialize_with = "de_i128_str")]
    pub min: i128,
    #[serde(serialize_with = "ser_i128_str", deserialize_with = "de_i128_str")]
    pub max: i128,
    pub timestamp: u64,
    pub ledger_seq: u32,
    pub sources_used: Vec<String>,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPrice {
    pub token: String,
    pub symbol: String,
    pub price: i128,
    pub min: i128,
    pub max: i128,
    pub timestamp: u64,
    pub sources_used: Vec<String>,
    pub onchain_status: String,
    pub confirmed_ledger: Option<u32>,
    pub tx_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OracleStatus {
    pub last_submission_time: Option<u64>,
    pub last_onchain_submission_time: Option<u64>,
    pub last_cache_update_time: Option<u64>,
    pub network: String,
    pub keeper_balance_xlm: Option<f64>,
    pub tokens: Vec<TokenPrice>,
    pub recent_errors: Vec<String>,
    pub onchain_submission_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveOracleSnapshot {
    pub network: String,
    pub keeper_balance_xlm: Option<f64>,
    pub ledger_seq: Option<u32>,
    pub timestamp: u64,
    pub prices: Vec<CachedPrice>,
    pub recent_errors: Vec<String>,
    pub onchain_submission_supported: bool,
}

fn router() -> Router {
    Router::new().route("/", get(root))
}

/// HTTP fetch handler.
///
/// Most routes are handled by Axum.  The `/keeper/balance` route is handled
/// directly here because it makes async `worker::Fetch` calls, whose futures
/// are not `Send`, preventing them from satisfying Axum's `Handler` bound on
/// this WASM target.
#[event(fetch)]
async fn fetch(
    req: HttpRequest,
    env: Env,
    _ctx: Context,
) -> Result<axum::http::Response<axum::body::Body>> {
    let path = req.uri().path().to_string();
    match path.as_str() {
        "/health" => json_response(200, r#"{"status":"ok"}"#),
        "/keeper/balance" => {
            if let Err(resp) = require_admin(&req, &env) {
                return Ok(resp);
            }
            handle_keeper_balance(&env).await
        }
        "/oracle/status" => {
            if let Err(resp) = require_admin(&req, &env) {
                return Ok(resp);
            }
            handle_oracle_status(&env).await
        }
        "/oracle/failed-submissions" => {
            if let Err(resp) = require_admin(&req, &env) {
                return Ok(resp);
            }
            handle_failed_submissions(&env).await
        }
        "/prices" => handle_get_prices(&env).await,
        _ => Ok(router().call(req).await?),
    }
}

fn require_admin(
    req: &HttpRequest,
    env: &Env,
) -> std::result::Result<(), axum::http::Response<axum::body::Body>> {
    let expected = match env.var("ADMIN_API_TOKEN") {
        Ok(v) => v.to_string(),
        Err(_) => {
            return Err(json_error_response(
                503,
                "ADMIN_API_TOKEN is not configured",
            ))
        }
    };
    let actual = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if actual == Some(expected.as_str()) {
        Ok(())
    } else {
        Err(json_error_response(401, "unauthorized"))
    }
}

/// `GET /keeper/balance` — current XLM balance of the keeper account.
async fn handle_keeper_balance(env: &Env) -> Result<axum::http::Response<axum::body::Body>> {
    let net_cfg = match network_config::load_network_config(env) {
        Ok(c) => c,
        Err(e) => return json_error(503, &e.to_string()),
    };
    let horizon_url = default_horizon_url(&net_cfg.network);
    let keeper_cfg = match keeper::load_keeper_config(env, horizon_url) {
        Ok(c) => c,
        Err(e) => return json_error(503, &e),
    };
    match keeper::check_keeper_balance(&keeper_cfg).await {
        Ok(stroops) => {
            let resp = keeper::build_balance_response(&keeper_cfg, stroops);
            let body = serde_json::to_string(&resp)
                .unwrap_or_else(|_| r#"{"error":"serialization failed"}"#.to_string());
            Ok(axum::http::Response::builder()
                .status(200)
                .header("Content-Type", "application/json")
                .body(axum::body::Body::from(body))
                .unwrap())
        }
        Err(e) => json_error(503, &e.to_string()),
    }
}

fn json_error(status: u16, msg: &str) -> Result<axum::http::Response<axum::body::Body>> {
    Ok(json_error_response(status, msg))
}

fn json_error_response(status: u16, msg: &str) -> axum::http::Response<axum::body::Body> {
    let body = format!(r#"{{"error":{msg:?}}}"#);
    axum::http::Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(body))
        .unwrap()
}

fn json_response(status: u16, body: &str) -> Result<axum::http::Response<axum::body::Body>> {
    Ok(axum::http::Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(body.to_string()))
        .unwrap())
}

/// Scheduled handler — runs the full price-update pipeline on every cron tick.
///
/// Local testing: `wrangler dev --test-scheduled`
#[allow(unused_must_use)]
#[event(scheduled)]
async fn scheduled(_event: ScheduledEvent, env: Env, _ctx: ScheduleContext) -> Result<()> {
    use serde_json::json;

    let start_time = current_timestamp();
    match collect_live_prices(&env, true).await {
        Ok(snapshot) => {
            let latency = current_timestamp() - start_time;
            log::info(
                "cycle_complete",
                json!({
                    "ledger_seq": snapshot.ledger_seq,
                    "prices": snapshot.prices.len(),
                    "errors": snapshot.recent_errors.len(),
                    "latency_ms": latency,
                    "storage": "stateless"
                }),
            );
            Ok(())
        }
        Err(e) => {
            log::error("cycle_failed", json!({"error": e}));
            Err(Error::from(e))
        }
    }
}

async fn collect_live_prices(
    env: &Env,
    fund_low_balance: bool,
) -> std::result::Result<LiveOracleSnapshot, String> {
    use serde_json::json;

    // 1. Parse feed configuration.
    let feed_cfg = match config::load_from_env(env) {
        Ok(cfg) => cfg,
        Err(e) => {
            log::error("config_error", json!({"error": e.to_string()}));
            return Err(e.to_string());
        }
    };

    // 2. Load network config.
    let net_cfg = match network_config::load_network_config(env) {
        Ok(cfg) => cfg,
        Err(e) => {
            log::error("network_config_error", json!({"error": e.to_string()}));
            return Err(e.to_string());
        }
    };

    log::info(
        "cycle_start",
        json!({
            "network": format!("{:?}", net_cfg.network),
            "oracle_contract_id": net_cfg.oracle_contract_id
        }),
    );

    // 3. Check keeper balance.
    let horizon_url = default_horizon_url(&net_cfg.network);
    let keeper_cfg = match keeper::load_keeper_config(env, horizon_url) {
        Ok(cfg) => cfg,
        Err(e) => {
            log::error("keeper_config_error", json!({"error": e.to_string()}));
            return Err(e);
        }
    };

    let balance_stroops = match keeper::check_keeper_balance(&keeper_cfg).await {
        Ok(b) => b,
        Err(e) => {
            log::error("balance_check_error", json!({"error": e.to_string()}));
            return Err(e.to_string());
        }
    };

    let balance_xlm = balance_stroops as f64 / keeper::XLM_IN_STROOPS as f64;
    if balance_xlm < keeper_cfg.min_balance_xlm {
        // Issue #120 — auto-fund on testnet; alert-only on mainnet.
        match net_cfg.network {
            StellarNetwork::Testnet if fund_low_balance => {
                log::warn(
                    "low_balance_funding",
                    json!({
                        "balance_xlm": balance_xlm,
                        "min_balance_xlm": keeper_cfg.min_balance_xlm,
                        "action": "calling_friendbot"
                    }),
                );
                match keeper::fund_keeper_via_friendbot(&keeper_cfg.account_id).await {
                    Ok(()) => log::info(
                        "friendbot_funded",
                        json!({"account": keeper_cfg.account_id}),
                    ),
                    Err(e) => log::error("friendbot_failed", json!({"error": e})),
                }
                // Skip this cycle — balance will be confirmed on next cron tick.
                return Ok(LiveOracleSnapshot {
                    network: format!("{:?}", net_cfg.network).to_lowercase(),
                    keeper_balance_xlm: Some(balance_xlm),
                    ledger_seq: None,
                    timestamp: current_timestamp_secs(),
                    prices: vec![],
                    recent_errors: vec![
                        "keeper balance below minimum; funding requested".to_string()
                    ],
                    onchain_submission_supported: false,
                });
            }
            StellarNetwork::Testnet => {
                log::warn(
                    "low_balance",
                    json!({
                        "balance_xlm": balance_xlm,
                        "min_balance_xlm": keeper_cfg.min_balance_xlm
                    }),
                );
            }
            StellarNetwork::Mainnet => {
                log::error(
                    "insufficient_balance",
                    json!({
                        "balance_xlm": balance_xlm,
                        "min_balance_xlm": keeper_cfg.min_balance_xlm,
                        "action": "manual_top_up_required"
                    }),
                );
                return Err(format!(
                    "keeper balance below minimum: {balance_xlm:.7} XLM < {:.7} XLM",
                    keeper_cfg.min_balance_xlm
                ));
            }
        }
    }

    // 4. Fetch ledger sequence.
    let ledger_seq = match stellar_rpc::get_latest_ledger_sequence(&net_cfg.rpc_url).await {
        Ok(seq) => seq,
        Err(e) => {
            log::error("ledger_fetch_error", json!({"error": e.to_string()}));
            return Err(e.to_string());
        }
    };

    // 5. Fetch prices from all sources.
    #[derive(Debug)]
    struct TokenPrices {
        prices: Vec<i128>,
        sources: Vec<String>,
    }

    let mut all_prices: std::collections::BTreeMap<String, TokenPrices> =
        std::collections::BTreeMap::new();

    for token in &feed_cfg.tokens {
        let mut token_prices = Vec::new();
        let mut sources_used = Vec::new();

        for source in &token.sources {
            match source.as_str() {
                "binance" => {
                    let symbol = token
                        .binance_symbol
                        .as_ref()
                        .map(|s| s.clone())
                        .unwrap_or_else(|| format!("{}USDT", token.symbol));

                    match retry::retry_with_backoff(
                        || {
                            let sym = symbol.clone();
                            async move { binance::fetch_spot_prices(&[sym]).await }
                        },
                        3,
                        200,
                    )
                    .await
                    {
                        Ok(prices) => {
                            if !prices.is_empty() {
                                token_prices.push(prices[0].1);
                                sources_used.push("binance".to_string());
                            }
                        }
                        Err(e) => {
                            log::error(
                                "binance_fetch_error",
                                json!({"token": token.symbol.clone(), "error": format!("{:?}", e)}),
                            );
                        }
                    }
                }
                "fixed" => {
                    if let Some(raw) = &token.fixed_price {
                        match raw.parse::<i128>() {
                            Ok(price) if price > 0 => {
                                token_prices.push(price);
                                sources_used.push("fixed".to_string());
                            }
                            _ => log::error(
                                "fixed_price_error",
                                json!({"token": token.symbol.clone(), "price": raw}),
                            ),
                        }
                    }
                }
                "pyth" => {
                    if let Some(feed_id) = &token.pyth_feed_id {
                        match pyth::fetch_pyth_price(
                            feed_id,
                            token.stale_after_seconds(),
                            token.max_deviation_bps(),
                        )
                        .await
                        {
                            Ok(price) => {
                                token_prices.push(price);
                                sources_used.push("pyth".to_string());
                            }
                            Err(e) => {
                                log::error(
                                    "pyth_fetch_error",
                                    json!({"token": token.symbol.clone(), "error": format!("{:?}", e)}),
                                );
                            }
                        }
                    }
                }
                "coinbase" => {
                    let symbol = token
                        .coinbase_symbol
                        .clone()
                        .unwrap_or_else(|| token.display_symbol().to_string());
                    match retry::retry_with_backoff(
                        || {
                            let sym = symbol.clone();
                            async move { coinbase::fetch_spot_price(&sym).await }
                        },
                        3,
                        200,
                    )
                    .await
                    {
                        Ok(price) => {
                            token_prices.push(price);
                            sources_used.push("coinbase".to_string());
                        }
                        Err(e) => {
                            log::error(
                                "coinbase_fetch_error",
                                json!({"token": token.symbol.clone(), "error": format!("{:?}", e)}),
                            );
                        }
                    }
                }
                _ => {}
            }
        }

        if !token_prices.is_empty() {
            all_prices.insert(
                token.symbol.clone(),
                TokenPrices {
                    prices: token_prices,
                    sources: sources_used,
                },
            );
        }
    }

    if all_prices.is_empty() {
        log::error("no_prices_fetched", json!({}));
        return Ok(LiveOracleSnapshot {
            network: format!("{:?}", net_cfg.network).to_lowercase(),
            keeper_balance_xlm: Some(balance_xlm),
            ledger_seq: Some(ledger_seq),
            timestamp: current_timestamp_secs(),
            prices: vec![],
            recent_errors: vec!["no prices fetched".to_string()],
            onchain_submission_supported: false,
        });
    }

    let mut cached_prices: Vec<CachedPrice> = Vec::new();
    let mut recent_errors: Vec<String> = Vec::new();

    for token in &feed_cfg.tokens {
        if let Some(token_prices) = all_prices.get(&token.symbol) {
            if token_prices.prices.is_empty() {
                continue;
            }

            let aggregated = match prices::aggregate_prices(
                &token_prices.prices,
                &token_prices.sources,
                token.min_sources(),
                token.max_deviation_bps(),
            ) {
                Ok(aggregated) => aggregated,
                Err(e) => {
                    log::warn(
                        "aggregation_failed",
                        json!({"token": token.symbol.clone(), "error": e}),
                    );
                    recent_errors.push(format!("{}: {}", token.symbol, e));
                    continue;
                }
            };

            for rejected in &aggregated.rejected_sources {
                log::error(
                    "outlier_rejected",
                    json!({
                        "token": token.symbol.clone(),
                        "source": rejected.source,
                        "price": rejected.price,
                        "deviation_bps": rejected.deviation_bps
                    }),
                );
                recent_errors.push(format!(
                    "{}: rejected outlier from {} at {}",
                    token.symbol, rejected.source, rejected.price
                ));
            }

            let min = aggregated.min;
            let max = aggregated.max;

            {
                let timestamp = current_timestamp_secs();
                let signature = match signing::get_keeper_private_key(env) {
                    Ok(private_key) => match signing::sign_price(
                        &private_key,
                        &net_cfg.passphrase,
                        ledger_seq,
                        &token.stellar_address,
                        min,
                        max,
                        timestamp,
                    ) {
                        Ok(sig) => hex::encode(sig.to_bytes()),
                        Err(e) => {
                            recent_errors.push(format!("{}: signing failed: {}", token.symbol, e));
                            log::error(
                                "signing_failed",
                                json!({
                                    "network": format!("{:?}", net_cfg.network).to_lowercase(),
                                    "token": token.stellar_address.clone(),
                                    "symbol": token.symbol.clone(),
                                    "min": min,
                                    "max": max,
                                    "timestamp": timestamp,
                                    "error": e.to_string(),
                                    "sources_used": aggregated.sources_used.clone(),
                                    "ledger_seq": ledger_seq
                                }),
                            );
                            continue;
                        }
                    },
                    Err(e) => {
                        recent_errors.push(format!("{}: {}", token.symbol, e));
                        continue;
                    }
                };
                cached_prices.push(CachedPrice {
                    token: token.stellar_address.clone(),
                    symbol: token.symbol.clone(),
                    min,
                    max,
                    timestamp,
                    ledger_seq,
                    sources_used: aggregated.sources_used.clone(),
                    signature,
                });
            }
        }
    }

    log::info(
        "prices_collected",
        json!({"ledger_seq": ledger_seq, "prices": cached_prices.len(), "storage": "stateless"}),
    );

    Ok(LiveOracleSnapshot {
        network: format!("{:?}", net_cfg.network).to_lowercase(),
        keeper_balance_xlm: Some(balance_xlm),
        ledger_seq: Some(ledger_seq),
        timestamp: current_timestamp_secs(),
        prices: cached_prices,
        recent_errors,
        onchain_submission_supported: false,
    })
}

#[cfg(target_arch = "wasm32")]
fn current_timestamp() -> u64 {
    js_sys::Date::now() as u64
}

#[cfg(not(target_arch = "wasm32"))]
fn current_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(target_arch = "wasm32")]
fn current_timestamp_secs() -> u64 {
    (js_sys::Date::now() / 1000.0) as u64
}

#[cfg(not(target_arch = "wasm32"))]
fn current_timestamp_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

async fn handle_oracle_status(env: &Env) -> Result<axum::http::Response<axum::body::Body>> {
    match collect_live_prices(env, false).await {
        Ok(snapshot) => {
            let status = snapshot_to_status(snapshot);
            let body = serde_json::to_string(&status)
                .unwrap_or_else(|_| r#"{"error":"serialization failed"}"#.to_string());
            Ok(axum::http::Response::builder()
                .status(200)
                .header("Content-Type", "application/json")
                .body(axum::body::Body::from(body))
                .unwrap())
        }
        Err(e) => json_error(503, &e),
    }
}

async fn handle_failed_submissions(env: &Env) -> Result<axum::http::Response<axum::body::Body>> {
    let net_cfg = match network_config::load_network_config(env) {
        Ok(c) => c,
        Err(e) => return json_error(503, &e.to_string()),
    };
    let body = serde_json::json!({
        "network": format!("{:?}", net_cfg.network).to_lowercase(),
        "submissions": [],
        "storage": "stateless",
        "message": "failed submissions are emitted to Worker logs; KV persistence is disabled"
    })
    .to_string();
    Ok(axum::http::Response::builder()
        .status(200)
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(body))
        .unwrap())
}

pub async fn root() -> &'static str {
    "so4-oracle"
}

async fn handle_get_prices(env: &Env) -> Result<axum::http::Response<axum::body::Body>> {
    match collect_live_prices(env, false).await {
        Ok(snapshot) => {
            if snapshot.prices.is_empty() {
                let body = r#"{"error":"no_prices","reason":"live_fetch_empty"}"#;
                return Ok(axum::http::Response::builder()
                    .status(503)
                    .header("Content-Type", "application/json")
                    .body(axum::body::Body::from(body))
                    .unwrap());
            }
            let body = serde_json::to_string(&snapshot.prices)
                .unwrap_or_else(|_| r#"{"error":"serialization failed"}"#.to_string());
            Ok(axum::http::Response::builder()
                .status(200)
                .header("Content-Type", "application/json")
                .body(axum::body::Body::from(body))
                .unwrap())
        }
        Err(e) => json_error(503, &e),
    }
}

fn snapshot_to_status(snapshot: LiveOracleSnapshot) -> OracleStatus {
    let last_update_time = if snapshot.prices.is_empty() {
        None
    } else {
        Some(snapshot.timestamp)
    };
    OracleStatus {
        last_submission_time: last_update_time,
        last_onchain_submission_time: None,
        last_cache_update_time: None,
        network: snapshot.network,
        keeper_balance_xlm: snapshot.keeper_balance_xlm,
        tokens: snapshot
            .prices
            .iter()
            .map(|p| TokenPrice {
                token: p.token.clone(),
                symbol: p.symbol.clone(),
                price: prices::compute_median_allow_single(&[p.min, p.max]).unwrap_or(p.min),
                min: p.min,
                max: p.max,
                timestamp: p.timestamp,
                sources_used: p.sources_used.clone(),
                onchain_status: "live_only_tx_builder_not_configured".to_string(),
                confirmed_ledger: None,
                tx_hash: None,
            })
            .collect(),
        recent_errors: snapshot.recent_errors,
        onchain_submission_supported: snapshot.onchain_submission_supported,
    }
}

fn default_horizon_url(network: &StellarNetwork) -> &'static str {
    match network {
        StellarNetwork::Testnet => "https://horizon-testnet.stellar.org",
        StellarNetwork::Mainnet => "https://horizon.stellar.org",
    }
}
