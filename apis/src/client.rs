use crate::state::{Reader, ReaderError, MarketSummary};
use async_trait::async_trait;
use serde_json::json;
use std::time::Duration;
use tokio::time::sleep;

// Simple retry wrapper for RPC calls
async fn retry<F, T, E>(mut f: F) -> Result<T, E>
where
    F: FnMut() -> futures::future::BoxFuture<'static, Result<T, E>>,
{
    let mut backoff = 50u64;
    for _ in 0..3 {
        match f().await {
            Ok(v) => return Ok(v),
            Err(_) => {
                sleep(Duration::from_millis(backoff)).await;
                backoff *= 2;
            }
        }
    }
    // final attempt
    f().await
}

pub struct RpcClient;

#[async_trait]
impl Reader for RpcClient {
    async fn get_markets(&self) -> Result<Vec<String>, ReaderError> {
        retry(|| Box::pin(async move { Ok(vec![]) })).await.map_err(|_| ReaderError::RpcError)
    }

    async fn get_market_pool_value_info(&self, _market: &str) -> Result<MarketSummary, ReaderError> {
        retry(|| Box::pin(async move {
            Ok(MarketSummary {
                market_token_address: "".to_string(),
                index_token: "".to_string(),
                long_token: "".to_string(),
                short_token: "".to_string(),
                pool_value_usd: 0.0,
                long_oi: 0.0,
                short_oi: 0.0,
                current_funding_rate: 0.0,
            })
        }))
        .await
        .map_err(|_| ReaderError::RpcError)
    }

    async fn get_market_detail(&self, _market: &str) -> Result<serde_json::Value, ReaderError> {
        retry(|| Box::pin(async move { Ok(json!({})) })).await.map_err(|_| ReaderError::RpcError)
    }

    async fn get_account_positions(&self, _account: &str) -> Result<Vec<String>, ReaderError> {
        retry(|| Box::pin(async move { Ok(vec![]) })).await.map_err(|_| ReaderError::RpcError)
    }

    async fn get_position_info(&self, _position_id: &str) -> Result<serde_json::Value, ReaderError> {
        retry(|| Box::pin(async move { Ok(json!({})) })).await.map_err(|_| ReaderError::RpcError)
    }

    async fn get_latest_price(&self, _token: &str) -> Result<f64, ReaderError> {
        retry(|| Box::pin(async move { Ok(0.0) })).await.map_err(|_| ReaderError::RpcError)
    }
}
