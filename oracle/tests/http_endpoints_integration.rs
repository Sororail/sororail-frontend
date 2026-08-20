use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;
use wiremock::MockServer;

mod common;

use common::test_config;
use oracle::api::build_router;
use oracle::state::{AppState, CachedPrice};

fn auth_header() -> String {
    "Bearer test-admin-token".to_string()
}

fn test_cached_price() -> CachedPrice {
    CachedPrice {
        token_address: "GAUHMCMUP5FZO5675W3ISZ6E6CNYJGXBUW5WANE2JR4TGAARYCTSCBKI".to_string(),
        symbol: "TUSDC".to_string(),
        display_symbol: "USDC".to_string(),
        keeper_index: 0,
        min: 1_000_000_000_000_000_000_000_000_000_000,
        max: 1_000_000_000_000_000_000_000_000_000_000,
        median: 1_000_000_000_000_000_000_000_000_000_000,
        timestamp: 1718400000,
        ledger_seq: 12345,
        sources_used: vec!["fixed".to_string()],
        signature: "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000".to_string(),
    }
}

#[tokio::test]
async fn http_get_prices_with_populated_cache() {
    let mock_server = MockServer::start().await;
    let config = test_config(&mock_server.uri(), "http://127.0.0.1:9");
    let state = Arc::new(AppState::new(config));

    {
        let mut cache = state.price_cache.write().await;
        cache
            .prices
            .insert("TUSDC".to_string(), test_cached_price());
    }

    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/prices")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json.is_array());
    let arr = json.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["symbol"], "TUSDC");
}

#[tokio::test]
async fn http_get_prices_with_empty_cache() {
    let mock_server = MockServer::start().await;
    let config = test_config(&mock_server.uri(), "http://127.0.0.1:9");
    let state = Arc::new(AppState::new(config));

    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/prices")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn http_get_metrics_rejects_without_token() {
    let mock_server = MockServer::start().await;
    let config = test_config(&mock_server.uri(), "http://127.0.0.1:9");
    let state = Arc::new(AppState::new(config));

    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn http_get_metrics_succeeds_with_valid_token() {
    let mock_server = MockServer::start().await;
    let config = test_config(&mock_server.uri(), "http://127.0.0.1:9");
    let state = Arc::new(AppState::new(config));

    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .header("Authorization", auth_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn http_get_oracle_status_rejects_without_token() {
    let mock_server = MockServer::start().await;
    let config = test_config(&mock_server.uri(), "http://127.0.0.1:9");
    let state = Arc::new(AppState::new(config));

    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/oracle/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn http_get_oracle_status_succeeds_with_valid_token() {
    let mock_server = MockServer::start().await;
    let config = test_config(&mock_server.uri(), "http://127.0.0.1:9");
    let state = Arc::new(AppState::new(config));

    let app = build_router(state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/oracle/status")
                .header("Authorization", auth_header())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
