use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

use super::{AdminAuth, ApiError};
use crate::state::{AppState, CachedPrice, FailedSubmission};

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
pub struct FailuresResponse {
    pub failures: Vec<FailedSubmission>,
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

pub async fn ready() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

pub async fn prices(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<CachedPrice>>, ApiError> {
    let cache = state.price_cache.read().await;
    if cache.prices.is_empty() {
        return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "no_prices"));
    }
    Ok(Json(cache.prices.values().cloned().collect()))
}

pub async fn failed_submissions(
    _auth: AdminAuth,
    State(state): State<Arc<AppState>>,
) -> Json<FailuresResponse> {
    let failures = state.failures.lock().await.iter().rev().cloned().collect();

    Json(FailuresResponse { failures })
}
