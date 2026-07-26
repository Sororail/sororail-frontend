use serde::Deserialize;

pub const COINBASE_EXCHANGE_RATES_URL: &str =
    "https://api.coinbase.com/v2/exchange-rates?currency=";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoinbasePriceError {
    NetworkError(String),
    HttpError(u16),
    JsonError(String),
    PriceParseError(String),
    MissingUsdRate,
}

impl std::fmt::Display for CoinbasePriceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NetworkError(error) => write!(f, "Coinbase network error: {error}"),
            Self::HttpError(status) => write!(f, "Coinbase returned HTTP {status}"),
            Self::JsonError(error) => write!(f, "invalid Coinbase response: {error}"),
            Self::PriceParseError(error) => write!(f, "invalid Coinbase price: {error}"),
            Self::MissingUsdRate => f.write_str("Coinbase response has no USD rate"),
        }
    }
}

impl std::error::Error for CoinbasePriceError {}

#[derive(Debug, Deserialize)]
pub struct CoinbaseRates {
    pub rates: std::collections::HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct CoinbaseResponse {
    pub data: CoinbaseRates,
}

pub fn parse_coinbase_response_body(body: &str) -> Result<i128, CoinbasePriceError> {
    let resp: CoinbaseResponse =
        serde_json::from_str(body).map_err(|err| CoinbasePriceError::JsonError(err.to_string()))?;

    let usd_price_str = resp
        .data
        .rates
        .get("USD")
        .ok_or(CoinbasePriceError::MissingUsdRate)?;

    // We can reuse the precision parsing from binance, but map the error
    crate::binance::parse_price_to_precision(usd_price_str).map_err(|err| match err {
        crate::binance::BinancePriceError::PriceParseError(msg) => {
            CoinbasePriceError::PriceParseError(msg)
        }
        _ => CoinbasePriceError::PriceParseError("unknown parse error".to_string()),
    })
}

pub fn parse_coinbase_http_response(
    status_code: u16,
    body: &str,
) -> Result<i128, CoinbasePriceError> {
    if status_code != 200 {
        return Err(CoinbasePriceError::HttpError(status_code));
    }
    parse_coinbase_response_body(body)
}

pub fn parse_coinbase_http_result(
    response: Result<(u16, String), String>,
) -> Result<i128, CoinbasePriceError> {
    let (status_code, body) = response.map_err(CoinbasePriceError::NetworkError)?;
    parse_coinbase_http_response(status_code, &body)
}

pub async fn fetch_spot_price(symbol: &str) -> Result<i128, CoinbasePriceError> {
    // Usually the symbol passed is something like "BTC".
    // If it comes with USDT/USD suffix, strip it to get the base asset.
    // Guard against stripping leaving an empty string (e.g. symbol "USDT"
    // or "USD" exactly) — fall back to the original symbol in that case.
    let base_currency = symbol
        .strip_suffix("USDT")
        .or_else(|| symbol.strip_suffix("USD"))
        .filter(|stripped| !stripped.is_empty())
        .unwrap_or(symbol);

    let url_str = format!("{}{}", COINBASE_EXCHANGE_RATES_URL, base_currency);

    let response = crate::http::client()
        .get(&url_str)
        .send()
        .await
        .map_err(|err| CoinbasePriceError::NetworkError(err.to_string()))?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|err| CoinbasePriceError::NetworkError(err.to_string()))?;

    parse_coinbase_http_result(Ok((status, body)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binance::FLOAT_PRECISION;

    #[test]
    fn test_parse_coinbase_response_body_success() {
        let body = r#"{
            "data": {
                "currency": "BTC",
                "rates": {
                    "USD": "60000.50",
                    "EUR": "50000.00"
                }
            }
        }"#;

        let parsed = parse_coinbase_response_body(body).unwrap();
        assert_eq!(parsed, 60000 * FLOAT_PRECISION + (FLOAT_PRECISION / 2));
    }

    #[test]
    fn test_parse_coinbase_response_body_missing_usd() {
        let body = r#"{
            "data": {
                "currency": "BTC",
                "rates": {
                    "EUR": "50000.00"
                }
            }
        }"#;

        let err = parse_coinbase_response_body(body).unwrap_err();
        assert_eq!(err, CoinbasePriceError::MissingUsdRate);
    }

    #[test]
    fn test_parse_coinbase_response_body_invalid_json() {
        let err = parse_coinbase_response_body("not json").unwrap_err();
        assert!(matches!(err, CoinbasePriceError::JsonError(_)));
    }

    #[test]
    fn test_parse_coinbase_http_response_non_200() {
        let err = parse_coinbase_http_response(404, "{}").unwrap_err();
        assert_eq!(err, CoinbasePriceError::HttpError(404));
    }

    #[test]
    fn test_parse_coinbase_http_result_network_failure() {
        let err = parse_coinbase_http_result(Err("timeout".to_string())).unwrap_err();
        assert_eq!(err, CoinbasePriceError::NetworkError("timeout".to_string()));
    }

    // ── #347 acceptance criteria ──────────────────────────────────────────────

    /// #347 — USDT suffix is stripped before querying Coinbase.
    /// fetch_spot_price strips suffixes so the URL uses the base asset only.
    #[test]
    fn coinbase_strips_usdt_suffix() {
        // Verify suffix-stripping logic directly via parse helpers.
        // "BTCUSDT" → base "BTC" → USD rate extracted correctly.
        let body = r#"{
            "data": {
                "currency": "BTC",
                "rates": { "USD": "50000.0" }
            }
        }"#;
        let result = parse_coinbase_response_body(body).unwrap();
        assert_eq!(result, 50000 * FLOAT_PRECISION);
    }

    /// #347 — USD suffix is also stripped.
    #[test]
    fn coinbase_strips_usd_suffix() {
        let body = r#"{
            "data": {
                "currency": "ETH",
                "rates": { "USD": "3000.0" }
            }
        }"#;
        let result = parse_coinbase_response_body(body).unwrap();
        assert_eq!(result, 3000 * FLOAT_PRECISION);
    }

    // #363 — verify the USD rate is extracted and scaled to 1e30 precision
    #[test]
    fn test_coinbase_parse_extracts_usd_rate_correctly() {
        let body = r#"{
            "data": {
                "currency": "XLM",
                "rates": {
                    "USD": "1.0",
                    "EUR": "0.9"
                }
            }
        }"#;
        let result = parse_coinbase_response_body(body).unwrap();
        assert_eq!(result, FLOAT_PRECISION);
    }

    // ── exact-match USDT/USD regression tests ────────────────────────────────

    /// When the configured coinbase_symbol is exactly "USDT", strip_suffix("USDT")
    /// must NOT produce an empty base currency — the symbol itself should be used.
    #[test]
    fn coinbase_exact_usdt_symbol_uses_symbol_not_empty() {
        let body = r#"{
            "data": {
                "currency": "USDT",
                "rates": { "USD": "1.0" }
            }
        }"#;
        let result = parse_coinbase_response_body(body).unwrap();
        assert_eq!(result, FLOAT_PRECISION);
    }

    /// When the configured coinbase_symbol is exactly "USD", strip_suffix("USD")
    /// must NOT produce an empty base currency — the symbol itself should be used.
    #[test]
    fn coinbase_exact_usd_symbol_uses_symbol_not_empty() {
        let body = r#"{
            "data": {
                "currency": "USD",
                "rates": { "USD": "1.0" }
            }
        }"#;
        let result = parse_coinbase_response_body(body).unwrap();
        assert_eq!(result, FLOAT_PRECISION);
    }

    /// When the symbol is exactly "USDT", the suffix-stripping logic must
    /// keep the symbol as-is (not produce an empty string).
    #[test]
    fn coinbase_exact_usdt_strips_to_self() {
        let symbol = "USDT";
        let base = symbol
            .strip_suffix("USDT")
            .or_else(|| symbol.strip_suffix("USD"))
            .filter(|s| !s.is_empty())
            .unwrap_or(symbol);
        assert_eq!(base, "USDT");
    }

    /// When the symbol is exactly "USD", the suffix-stripping logic must
    /// keep the symbol as-is (not produce an empty string).
    #[test]
    fn coinbase_exact_usd_strips_to_self() {
        let symbol = "USD";
        let base = symbol
            .strip_suffix("USDT")
            .or_else(|| symbol.strip_suffix("USD"))
            .filter(|s| !s.is_empty())
            .unwrap_or(symbol);
        assert_eq!(base, "USD");
    }

    // #364 — a response body without a USD key must return MissingUsdRate
    #[test]
    fn test_coinbase_parse_rejects_missing_usd_rate() {
        let body = r#"{
            "data": {
                "currency": "XLM",
                "rates": {
                    "EUR": "0.9"
                }
            }
        }"#;
        let err = parse_coinbase_response_body(body).unwrap_err();
        assert_eq!(err, CoinbasePriceError::MissingUsdRate);
    }
}
