use shared_config::{ConfigError, TokenConfig};

pub const ENV_KEY: &str = "PRICE_FEED_CONFIG";

/// Oracle-specific view of a token feed config.
/// Re-exports fields from `TokenConfig` for backward compatibility with
/// the rest of the oracle crate.
pub type TokenFeedConfig = TokenConfig;

#[derive(Debug, Clone)]
pub struct PriceFeedConfig {
    pub tokens: Vec<TokenFeedConfig>,
}

/// Parse and validate the `PRICE_FEED_CONFIG` JSON string.
///
/// Expected format:
/// ```json
/// [{"symbol":"BTC","stellar_address":"C...","sources":["binance","coinbase"]}]
/// ```
pub fn parse_price_feed_config(raw: &str) -> Result<PriceFeedConfig, ConfigError> {
    let tokens = shared_config::parse_token_configs(raw)?;

    // Oracle-specific validation: stellar_address and sources are required.
    for token in &tokens {
        if token.stellar_address.is_empty() {
            return Err(ConfigError::InvalidToken {
                symbol: token.symbol.clone(),
                reason: "stellar_address must not be empty".to_string(),
            });
        }
        if token.sources.is_empty() {
            return Err(ConfigError::InvalidToken {
                symbol: token.symbol.clone(),
                reason: "sources list must not be empty".to_string(),
            });
        }
        for source in &token.sources {
            if source.is_empty() {
                return Err(ConfigError::InvalidToken {
                    symbol: token.symbol.clone(),
                    reason: "source names must not be empty strings".to_string(),
                });
            }
            match source.as_str() {
                "binance" if token.binance_symbol.is_none() => {
                    return Err(ConfigError::InvalidToken {
                        symbol: token.symbol.clone(),
                        reason: "binance_symbol is required for binance source".to_string(),
                    });
                }
                "coinbase" if token.coinbase_symbol.is_none() => {
                    return Err(ConfigError::InvalidToken {
                        symbol: token.symbol.clone(),
                        reason: "coinbase_symbol is required for coinbase source".to_string(),
                    });
                }
                "pyth" if token.pyth_feed_id.is_none() => {
                    return Err(ConfigError::InvalidToken {
                        symbol: token.symbol.clone(),
                        reason: "pyth_feed_id is required for pyth source".to_string(),
                    });
                }
                "fixed" if token.fixed_price.is_none() => {
                    return Err(ConfigError::InvalidToken {
                        symbol: token.symbol.clone(),
                        reason: "fixed_price is required for fixed source".to_string(),
                    });
                }
                "binance" | "coinbase" | "pyth" | "fixed" => {}
                other => {
                    return Err(ConfigError::InvalidToken {
                        symbol: token.symbol.clone(),
                        reason: format!("unsupported source '{other}'"),
                    });
                }
            }
        }
        if token.min_sources() == 0 {
            return Err(ConfigError::InvalidToken {
                symbol: token.symbol.clone(),
                reason: "min_sources must be greater than zero".to_string(),
            });
        }
    }

    Ok(PriceFeedConfig { tokens })
}

/// Load and validate `PRICE_FEED_CONFIG` from the Worker environment.
pub fn load_from_env(env: &worker::Env) -> Result<PriceFeedConfig, ConfigError> {
    let raw = env
        .var(ENV_KEY)
        .map(|v| v.to_string())
        .unwrap_or_else(|_| include_str!("../../config/tokens.json").to_string());
    parse_price_feed_config(&raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_JSON: &str = r#"[
        {"symbol":"BTC","stellar_address":"CBTCADDR","sources":["binance","coinbase"],"binance_symbol":"BTCUSDT","coinbase_symbol":"BTC"},
        {"symbol":"ETH","stellar_address":"CETHADDR","sources":["binance"],"binance_symbol":"ETHUSDT"}
    ]"#;

    #[test]
    fn parse_valid_config() {
        let cfg = parse_price_feed_config(VALID_JSON).unwrap();
        assert_eq!(cfg.tokens.len(), 2);
        assert_eq!(cfg.tokens[0].symbol, "BTC");
        assert_eq!(cfg.tokens[0].sources, vec!["binance", "coinbase"]);
        assert_eq!(cfg.tokens[1].symbol, "ETH");
        assert_eq!(cfg.tokens[1].sources, vec!["binance"]);
    }

    #[test]
    fn reject_malformed_json() {
        let err = parse_price_feed_config("{not json}").unwrap_err();
        assert!(matches!(err, ConfigError::MalformedJson(_)));
    }

    #[test]
    fn reject_empty_token_list() {
        let err = parse_price_feed_config("[]").unwrap_err();
        assert!(matches!(err, ConfigError::EmptyTokenList));
    }

    #[test]
    fn reject_token_with_empty_symbol() {
        let json = r#"[{"symbol":"","stellar_address":"CADDR","sources":["binance"],"binance_symbol":"BTCUSDT"}]"#;
        let err = parse_price_feed_config(json).unwrap_err();
        assert!(matches!(err, ConfigError::InvalidToken { .. }));
    }

    #[test]
    fn reject_token_with_empty_stellar_address() {
        let json = r#"[{"symbol":"BTC","stellar_address":"","sources":["binance"],"binance_symbol":"BTCUSDT"}]"#;
        let err = parse_price_feed_config(json).unwrap_err();
        assert!(matches!(
            err,
            ConfigError::InvalidToken { ref symbol, .. } if symbol == "BTC"
        ));
    }

    #[test]
    fn reject_token_with_empty_sources() {
        let json = r#"[{"symbol":"BTC","stellar_address":"CADDR","sources":[]}]"#;
        let err = parse_price_feed_config(json).unwrap_err();
        assert!(matches!(
            err,
            ConfigError::InvalidToken { ref symbol, .. } if symbol == "BTC"
        ));
    }

    #[test]
    fn per_token_source_list_preserved() {
        let json = r#"[
            {"symbol":"BTC","stellar_address":"CBADDR","sources":["binance"],"binance_symbol":"BTCUSDT"},
            {"symbol":"ETH","stellar_address":"CEADDR","sources":["coinbase"],"coinbase_symbol":"ETH"}
        ]"#;
        let cfg = parse_price_feed_config(json).unwrap();
        assert_eq!(cfg.tokens[0].sources, vec!["binance"]);
        assert_eq!(cfg.tokens[1].sources, vec!["coinbase"]);
    }

    #[test]
    fn reject_missing_coinbase_symbol() {
        let json = r#"[{"symbol":"TWBTC","stellar_address":"CADDR","sources":["coinbase"]}]"#;
        let err = parse_price_feed_config(json).unwrap_err();
        assert!(matches!(err, ConfigError::InvalidToken { .. }));
    }

    #[test]
    fn parse_current_testnet_shape() {
        let json = r#"[
            {"symbol":"TUSDC","display_symbol":"USDC","stellar_address":"CBAN5YU3KRDKPTQ2H76D6S7HQFPRBGUD524F65BUM2RQCITPTRLKWKES","sources":["fixed"],"fixed_price":"1000000000000000000000000000000","min_sources":1},
            {"symbol":"TWBTC","display_symbol":"BTC","stellar_address":"CCFTOPHUPSUDO2MB4X5D3XYJ2HRJ7NJPAW4UVPAVN7ZLE63EZLSMXDUO","sources":["binance","coinbase","pyth"],"binance_symbol":"BTCUSDT","coinbase_symbol":"BTC","pyth_feed_id":"e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43","min_sources":2}
        ]"#;
        let cfg = parse_price_feed_config(json).unwrap();
        assert_eq!(cfg.tokens[0].display_symbol(), "USDC");
        assert_eq!(cfg.tokens[1].coinbase_symbol.as_deref(), Some("BTC"));
    }
}
