use std::sync::Arc;
use std::time::{Instant, SystemTime};

use shared_config::TokenConfig;
use tokio::time::{interval, MissedTickBehavior};

use crate::prices::AggregatedPrice;
use crate::state::{AppState, CachedPrice, FailedSubmission};

const SOURCE_RETRY_ATTEMPTS: u32 = 3;
const SOURCE_RETRY_BASE_DELAY_MS: u64 = 100;

/// Unified error type for all price sources, preserving structure through retries.
#[derive(Debug, Clone)]
pub enum PriceSourceError {
    Binance(crate::binance::BinancePriceError),
    Coinbase(crate::coinbase::CoinbasePriceError),
    Pyth(crate::pyth::PythPriceError),
    Fixed(crate::fixed::FixedPriceError),
    Config(String),
    Unsupported(String),
}

impl std::fmt::Display for PriceSourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Binance(e) => write!(f, "{}", e),
            Self::Coinbase(e) => write!(f, "{}", e),
            Self::Pyth(e) => write!(f, "{}", e),
            Self::Fixed(e) => write!(f, "{}", e),
            Self::Config(msg) => write!(f, "config error: {}", msg),
            Self::Unsupported(source) => write!(f, "unsupported source: {}", source),
        }
    }
}

impl crate::retry::Retryable for PriceSourceError {
    fn is_retryable(&self) -> bool {
        match self {
            Self::Binance(e) => e.is_retryable(),
            Self::Coinbase(e) => e.is_retryable(),
            Self::Pyth(e) => e.is_retryable(),
            Self::Fixed(e) => e.is_retryable(),
            // Config and unsupported errors are permanent
            Self::Config(_) | Self::Unsupported(_) => false,
        }
    }
}

pub async fn run_price_loop(state: Arc<AppState>) {
    let mut ticker = interval(state.config.price_loop_interval);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            _ = state.shutdown_token.cancelled() => {
                tracing::info!("price_loop shutting down");
                break;
            }
        }
        run_price_cycle(Arc::clone(&state)).await;
    }
}

/// Executes a single price collection and processing cycle (Resolves Issue #391).
/// Fetches the latest Stellar ledger sequence, iterates through configured tokens,
/// builds and aggregates their prices, signs the results, and updates the cache.
/// Never panics on individual errors; they are recorded as failure submissions.
pub async fn run_price_cycle(state: Arc<AppState>) {
    let started = Instant::now();
    {
        let mut status = state.cycle_status.write().await;
        status.price_cycle_running = true;
    }

    let mut tokens_ok = 0usize;
    let mut tokens_failed = 0usize;
    let ledger_seq =
        match crate::stellar_rpc::get_latest_ledger_sequence(&state.config.stellar_rpc_url).await {
            Ok(ledger_seq) => ledger_seq,
            Err(error) => {
                tracing::error!(
                    error = %error,
                    rpc_url = %state.config.stellar_rpc_url,
                    "price cycle aborted: failed to fetch latest ledger sequence from RPC"
                );
                record_error(&state, "get_latest_ledger", error.to_string()).await;
                finish_cycle(&state, started, tokens_ok, tokens_failed).await;
                return;
            }
        };

    // Hermes accepts multiple `ids[]` values. Fetch all Pyth feeds once per
    // cycle, rather than spending one rate-limited request per token.
    let pyth_feed_ids: Vec<&str> = state
        .config
        .price_feed
        .tokens
        .iter()
        .filter(|token| token.sources.iter().any(|source| source == "pyth"))
        .filter_map(|token| token.pyth_feed_id.as_deref())
        .collect();
    let pyth_prices = match crate::pyth::fetch_pyth_prices(
        &pyth_feed_ids,
        state.config.pyth_api_key.as_ref().map(|key| key.as_str()),
    )
    .await
    {
        Ok(prices) => prices,
        Err(error) => {
            tracing::warn!(error = %error, "batched Pyth request failed");
            std::collections::HashMap::new()
        }
    };

    let mut new_prices = std::collections::BTreeMap::new();
    for token in &state.config.price_feed.tokens {
        match build_cached_price(&state, token, ledger_seq, &pyth_prices).await {
            Ok(price) => {
                new_prices.insert(token.lookup_key(), price);
                tokens_ok += 1;
            }
            Err(error) => {
                tokens_failed += 1;
                let ctx = ErrorContext {
                    token: token.stellar_address.clone(),
                    symbol: token.symbol.clone(),
                };
                record_error_with_context(&state, format!("price:{}", token.symbol), error, ctx)
                    .await;
            }
        }
    }

    if tokens_ok > 0 {
        let mut cache = state.price_cache.write().await;
        cache.prices = new_prices;
        cache.last_updated = Some(SystemTime::now());
    }

    finish_cycle(&state, started, tokens_ok, tokens_failed).await;
}

/// Finalizes the cycle timing and updates `CycleStatus` state flags (Resolves Issue #394).
async fn finish_cycle(
    state: &Arc<AppState>,
    started: Instant,
    tokens_ok: usize,
    tokens_failed: usize,
) {
    {
        let mut status = state.cycle_status.write().await;
        status.price_cycle_running = false;
        status.last_price_cycle_at = Some(SystemTime::now());
    }

    let latency_ms = started.elapsed().as_millis() as u64;
    state
        .metrics
        .record_price_cycle(latency_ms, tokens_ok, tokens_failed);

    tracing::info!(tokens_ok, tokens_failed, latency_ms, "cycle_complete");
}

/// Fetches prices from all configured sources, filters and aggregates them,
/// and produces a signed cached price (Resolves Issue #392).
async fn build_cached_price(
    state: &Arc<AppState>,
    token: &TokenConfig,
    ledger_seq: u32,
    pyth_prices: &std::collections::HashMap<String, crate::pyth::PythPriceFeed>,
) -> Result<CachedPrice, String> {
    let mut prices = Vec::new();
    let mut sources = Vec::new();

    for source in &token.sources {
        match fetch_source_with_retry(
            source,
            token,
            state.config.pyth_api_key.as_ref().map(|key| key.as_str()),
            pyth_prices,
        )
        .await
        {
            Ok(price) => {
                prices.push(price);
                sources.push(source.clone());
            }
            Err(error) => {
                state.metrics.record_token_source_fetch_failure(
                    &token.symbol,
                    &token.stellar_address,
                    source,
                );
                let ctx = ErrorContext {
                    token: token.stellar_address.clone(),
                    symbol: token.symbol.clone(),
                };
                record_error_with_context(
                    state,
                    format!("source:{}:{}", token.symbol, source),
                    error_str.clone(),
                    ctx,
                )
                .await;
                tracing::warn!(symbol = %token.symbol, source = %source, error = %error_str, "price source failed");
            }
        }
    }

    let aggregate = crate::prices::aggregate_prices(
        &prices,
        &sources,
        token.min_sources,
        token.max_deviation_bps,
    )?;
    signed_cached_price(state, token, ledger_seq, aggregate)
}

async fn fetch_source_with_retry(
    source: &str,
    token: &TokenConfig,
    pyth_api_key: Option<&str>,
    pyth_prices: &std::collections::HashMap<String, crate::pyth::PythPriceFeed>,
) -> Result<i128, PriceSourceError> {
    crate::retry::retry_with_backoff(
        || async { fetch_source_price(source, token, pyth_api_key, pyth_prices).await },
        SOURCE_RETRY_ATTEMPTS,
        SOURCE_RETRY_BASE_DELAY_MS,
    )
    .await
}

async fn fetch_source_price(
    source: &str,
    token: &TokenConfig,
    pyth_api_key: Option<&str>,
    pyth_prices: &std::collections::HashMap<String, crate::pyth::PythPriceFeed>,
) -> Result<i128, PriceSourceError> {
    match source {
        "binance" => {
            let symbol = token
                .binance_symbol
                .as_ref()
                .ok_or_else(|| PriceSourceError::Config("missing binance_symbol".to_string()))?;
            let results = crate::binance::fetch_spot_prices(std::slice::from_ref(symbol))
                .await
                .map_err(PriceSourceError::Binance)?;
            results
                .into_iter()
                .find(|(got_symbol, _)| got_symbol == symbol)
                .map(|(_, price)| price)
                .ok_or_else(|| {
                    PriceSourceError::Config(format!("binance symbol not returned: {symbol}"))
                })
        }
        "coinbase" => {
            let symbol = token
                .coinbase_symbol
                .as_ref()
                .ok_or_else(|| PriceSourceError::Config("missing coinbase_symbol".to_string()))?;
            crate::coinbase::fetch_spot_price(symbol)
                .await
                .map_err(PriceSourceError::Coinbase)
        }
        "pyth" => {
            let feed_id = token
                .pyth_feed_id
                .as_ref()
                .ok_or_else(|| PriceSourceError::Config("missing pyth_feed_id".to_string()))?;
            if let Some(feed) = pyth_prices.get(feed_id) {
                crate::pyth::validate_pyth_price(
                    &feed.price,
                    crate::current_timestamp_secs(),
                    token.stale_after_seconds,
                    50,
                )
            } else {
                crate::pyth::fetch_pyth_prices(&[feed_id], pyth_api_key)
                    .await
                    .and_then(|mut feeds| {
                        feeds.remove(feed_id).ok_or_else(|| {
                            crate::pyth::PythPriceError::MissingFeedId(feed_id.clone())
                        })
                    })
                    .and_then(|feed| {
                        crate::pyth::validate_pyth_price(
                            &feed.price,
                            crate::current_timestamp_secs(),
                            token.stale_after_seconds,
                            50,
                        )
                    })
            }
            .map_err(PriceSourceError::Pyth)
        }
        "fixed" => crate::fixed::fixed_price(token).map_err(PriceSourceError::Fixed),
        other => Err(PriceSourceError::Unsupported(other.to_string())),
    }
}

/// Signs the aggregated price payload and returns a CachedPrice (Resolves Issue #393).
/// The signature matches the required format and is encoded to a 128 hex character string.
fn signed_cached_price(
    state: &Arc<AppState>,
    token: &TokenConfig,
    ledger_seq: u32,
    aggregate: AggregatedPrice,
) -> Result<CachedPrice, String> {
    let timestamp = crate::current_timestamp_secs();
    let signature = crate::signing::sign_price(
        state.config.keeper_private_key.as_str(),
        &state.config.network_passphrase,
        ledger_seq,
        &token.stellar_address,
        aggregate.min,
        aggregate.max,
        timestamp,
    )
    .map_err(|err| err.to_string())?;

    Ok(CachedPrice {
        token_address: token.stellar_address.clone(),
        symbol: token.symbol.clone(),
        display_symbol: token.display_symbol().to_string(),
        keeper_index: state.config.keeper_index,
        min: aggregate.min,
        max: aggregate.max,
        median: aggregate.median,
        timestamp,
        ledger_seq,
        sources_used: aggregate.sources_used,
        signature: hex::encode(signature.to_bytes()),
    })
}

struct ErrorContext {
    token: String,
    symbol: String,
}

async fn record_error(
    state: &Arc<AppState>,
    operation: impl Into<String>,
    error: impl Into<String>,
) {
    record_error_with_context(
        state,
        operation,
        error,
        ErrorContext {
            token: String::new(),
            symbol: String::new(),
        },
    )
    .await;
}

async fn record_error_with_context(
    state: &Arc<AppState>,
    operation: impl Into<String>,
    error: impl Into<String>,
    ctx: ErrorContext,
) {
    state.failures.lock().await.push(FailedSubmission {
        at: SystemTime::now(),
        operation: operation.into(),
        network: state.config.network.as_str().to_string(),
        token: ctx.token,
        symbol: ctx.symbol,
        min: 0,
        max: 0,
        tx_hash: None,
        error: error.into(),
        timestamp: 0,
        ledger_seq: 0,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, Network, PriceFeedConfig, SecretString};
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};
    use std::time::Duration;

    fn test_state(token: TokenConfig) -> Arc<AppState> {
        let config = Config {
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            network: Network::Testnet,
            network_passphrase: "Test SDF Network ; September 2015".to_string(),
            stellar_rpc_url: "http://localhost:0".to_string(),
            horizon_url: "http://localhost:0".to_string(),
            oracle_contract_id: "CORACLE".to_string(),
            role_store_contract_id: "CROLE".to_string(),
            data_store_contract_id: "CDATA".to_string(),
            order_handler_contract_id: "CORDER".to_string(),
            deposit_handler_contract_id: "CDEPOSIT".to_string(),
            withdrawal_handler_contract_id: "CWITHDRAW".to_string(),
            reader_contract_id: "CREADER".to_string(),
            keeper_private_key: SecretString::new(
                "1111111111111111111111111111111111111111111111111111111111111111".to_string(),
            ),
            keeper_secret_key: SecretString::new("SSECRET".to_string()),
            keeper_account_id: "GACCOUNT".to_string(),
            keeper_index: 0,
            admin_api_token: None,
            pyth_api_key: None,
            min_keeper_balance_xlm: 0.0,
            price_loop_interval: Duration::from_millis(1),
            keeper_loop_interval: Duration::from_millis(1),
            price_feed: PriceFeedConfig {
                tokens: vec![token],
            },
        };
        Arc::new(AppState::new(Arc::new(config)))
    }

    // ── #512: run_price_loop shutdown coverage ───────────────────────────────

    fn shutdown_test_state() -> Arc<AppState> {
        let config = Config {
            bind_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
            network: Network::Testnet,
            network_passphrase: "Test SDF Network ; September 2015".to_string(),
            stellar_rpc_url: "not-a-valid-url".to_string(), // immediate error — no network
            horizon_url: "not-a-valid-url".to_string(),
            oracle_contract_id: "CORACLE".to_string(),
            role_store_contract_id: "CROLE".to_string(),
            data_store_contract_id: "CDATA".to_string(),
            order_handler_contract_id: "CORDER".to_string(),
            deposit_handler_contract_id: "CDEPOSIT".to_string(),
            withdrawal_handler_contract_id: "CWITHDRAW".to_string(),
            reader_contract_id: "CREADER".to_string(),
            keeper_private_key: SecretString::new(
                "1111111111111111111111111111111111111111111111111111111111111111".to_string(),
            ),
            keeper_secret_key: SecretString::new("SSECRET".to_string()),
            keeper_account_id: "GACCOUNT".to_string(),
            keeper_index: 0,
            admin_api_token: None,
            pyth_api_key: None,
            min_keeper_balance_xlm: 0.0,
            price_loop_interval: Duration::from_millis(50),
            keeper_loop_interval: Duration::from_millis(50),
            price_feed: PriceFeedConfig { tokens: vec![] },
        };
        Arc::new(AppState::new(Arc::new(config)))
    }

    #[tokio::test]
    async fn run_price_loop_exits_promptly_on_shutdown() {
        let state = shutdown_test_state();
        let state2 = Arc::clone(&state);

        let handle = tokio::spawn(run_price_loop(state2));

        // Let the loop tick at least once.
        tokio::time::sleep(Duration::from_millis(120)).await;

        state.shutdown_token.cancel();

        let completed = tokio::time::timeout(Duration::from_millis(500), handle).await;
        assert!(
            completed.is_ok(),
            "run_price_loop must exit within 500 ms of shutdown_token cancellation"
        );
    }

    #[tokio::test]
    async fn fixed_source_builds_signed_cached_price() {
        let token = TokenConfig {
            symbol: "TUSDC".to_string(),
            display_symbol: Some("USDC".to_string()),
            stellar_address: "CBAN5YU3KRDKPTQ2H76D6S7HQFPRBGUD524F65BUM2RQCITPTRLKWKES".to_string(),
            sources: vec!["fixed".to_string()],
            binance_symbol: None,
            coinbase_symbol: None,
            pyth_feed_id: None,
            fixed_price: Some("1000000000000000000000000000000".to_string()),
            min_sources: 1,
            max_deviation_bps: 100,
            stale_after_seconds: 60,
            submit_threshold_bps: 10,
            min: 0.0,
            max: 0.0,
            sources_used: vec![],
        };

        let state = test_state(token.clone());
        let cached = build_cached_price(&state, &token, 123).await.unwrap();
        let configured_price = token.fixed_price.as_ref().unwrap().parse::<i128>().unwrap();
        let spread = configured_price * token.max_deviation_bps as i128 / 10_000;

        // Verify all fields are correct (closes #400)
        assert_eq!(
            cached.token_address,
            "CBAN5YU3KRDKPTQ2H76D6S7HQFPRBGUD524F65BUM2RQCITPTRLKWKES"
        );
        assert_eq!(cached.symbol, "TUSDC");
        assert_eq!(cached.display_symbol, "USDC");
        assert_eq!(cached.min, configured_price - spread);
        assert_eq!(cached.max, configured_price + spread);
        assert_eq!(cached.median, configured_price);
        assert_eq!(cached.ledger_seq, 123);
        assert_eq!(cached.sources_used, vec!["fixed"]);
        assert_eq!(cached.signature.len(), 128);
        assert!(cached.timestamp > 0, "timestamp should be positive");
    }
}
