use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use super::AdminAuth;
use crate::state::{AppState, CachedPrice, FailedSubmission};

#[derive(Debug, Serialize)]
pub struct OracleStatusResponse {
    pub last_cycle_time: Option<u64>,
    pub keeper_balance: Option<f64>,
    pub prices: Vec<CachedPrice>,
    pub recent_errors: Vec<FailedSubmission>,
}

pub async fn oracle_status(
    _auth: AdminAuth,
    State(state): State<Arc<AppState>>,
) -> Json<OracleStatusResponse> {
    let last_cycle_time = state
        .cycle_status
        .read()
        .await
        .last_price_cycle_at
        .and_then(system_time_secs);
    let prices = state
        .price_cache
        .read()
        .await
        .prices
        .values()
        .cloned()
        .collect();
    let recent_errors = state.failures.lock().await.iter().rev().cloned().collect();

    Json(OracleStatusResponse {
        last_cycle_time,
        keeper_balance: None,
        prices,
        recent_errors,
    })
}

fn system_time_secs(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}
