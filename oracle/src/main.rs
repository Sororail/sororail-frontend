use std::sync::Arc;

use oracle::{api, AppState, Config};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    init_tracing();
    dotenvy::dotenv().ok();

    let config = match Config::from_env() {
        Ok(config) => Arc::new(config),
        Err(errors) => {
            for error in &errors.0 {
                tracing::error!(%error, "configuration failed");
                eprintln!("configuration error: {error}");
            }
            std::process::exit(1);
        }
    };

    let bind_addr = config.bind_addr;
    let state = Arc::new(AppState::new(Arc::clone(&config)));
    let app = api::build_router(Arc::clone(&state));

    #[allow(unused_mut)]
    let listener = match TcpListener::bind(bind_addr).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(%error, %bind_addr, "failed to bind listener");
            eprintln!("failed to bind {bind_addr}: {error}");
            std::process::exit(1);
        }
    };

    let mut price_loop = tokio::spawn(oracle::price_loop::run_price_loop(Arc::clone(&state)));
    let mut keeper_loop = tokio::spawn(oracle::keeper_loop::run_keeper_loop(Arc::clone(&state)));

    tracing::info!(
        %bind_addr,
        network = config.network.as_str(),
        "oracle server listening"
    );

    let mut server_handle = tokio::spawn({
        let state = Arc::clone(&state);
        async move {
            axum::serve(listener, app)
                .with_graceful_shutdown({
                    let token = state.shutdown_token.clone();
                    async move {
                        tokio::select! {
                            _ = shutdown_signal() => {
                                token.cancel();
                            }
                            _ = token.cancelled() => {}
                        }
                    }
                })
                .await
        }
    });

    let loop_died_early = tokio::select! {
        result = &mut server_handle => {
            match result {
                Ok(Ok(())) => false,
                Ok(Err(error)) => {
                    tracing::error!(%error, "server error");
                    eprintln!("server error: {error}");
                    std::process::exit(1);
                }
                Err(error) => {
                    tracing::error!(%error, "server panicked");
                    std::process::exit(1);
                }
            }
        }
        result = &mut price_loop => {
            match result {
                Ok(()) => tracing::error!("price_loop exited unexpectedly before shutdown"),
                Err(error) => tracing::error!(%error, "price_loop panicked"),
            }
            true
        }
        result = &mut keeper_loop => {
            match result {
                Ok(()) => tracing::error!("keeper_loop exited unexpectedly before shutdown"),
                Err(error) => tracing::error!(%error, "keeper_loop panicked"),
            }
            true
        }
    };

    if loop_died_early {
        state.shutdown_token.cancel();
        if tokio::time::timeout(std::time::Duration::from_secs(30), &mut server_handle)
            .await
            .is_err()
        {
            tracing::warn!("server shutdown timed out after 30s");
        }
    }

    tracing::info!("shutdown initiated, draining...");
    state.shutdown_token.cancel();

    let _ = tokio::join!(price_loop, keeper_loop);
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_current_span(false)
        .with_span_list(false)
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "failed to install SIGINT handler");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(%error, "failed to install SIGTERM handler");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("received SIGINT"),
        _ = terminate => tracing::info!("received SIGTERM"),
    }
}
