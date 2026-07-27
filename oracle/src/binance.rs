use serde::Deserialize;

pub const BINANCE_TICKER_PRICE_URL: &str = "https://data-api.binance.vision/api/v3/ticker/price";
pub const FLOAT_PRECISION: i128 = 1_000_000_000_000_000_000_000_000_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BinancePriceError {
    NetworkError(String),
    HttpError(u16),
    JsonError(String),
    PriceParseError(String),
}

impl std::fmt::Display for BinancePriceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NetworkError(error) => write!(f, "Binance network error: {error}"),
            Self::HttpError(status) => write!(f, "Binance returned HTTP {status}"),
            Self::JsonError(error) => write!(f, "invalid Binance response: {error}"),
            Self::PriceParseError(error) => write!(f, "invalid Binance price: {error}"),
        }
    }
}

impl std::error::Error for BinancePriceError {}

impl crate::retry::Retryable for BinancePriceError {
    fn is_retryable(&self) -> bool {
        match self {
            // Network errors and 5xx HTTP errors are transient
            Self::NetworkError(_) => true,
            Self::HttpError(status) => *status >= 500,
            // Parse/JSON errors are permanent failures
            Self::JsonError(_) | Self::PriceParseError(_) => false,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct BinanceTickerEntry {
    pub symbol: String,
    pub price: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BinanceTickerResponse {
    Single(BinanceTickerEntry),
    Many(Vec<BinanceTickerEntry>),
}

pub fn parse_ticker_response_body(
    body: &str,
    symbols: &[String],
) -> Result<Vec<(String, i128)>, BinancePriceError> {
    let response: BinanceTickerResponse =
        serde_json::from_str(body).map_err(|err| BinancePriceError::JsonError(err.to_string()))?;
    let entries = match response {
        BinanceTickerResponse::Single(entry) => vec![entry],
        BinanceTickerResponse::Many(entries) => entries,
    };

    let mut results = Vec::new();
    for symbol in symbols {
        let maybe = entries.iter().find(|entry| entry.symbol == *symbol);
        if let Some(found) = maybe {
            let scaled = parse_price_to_precision(&found.price)?;
            results.push((found.symbol.clone(), scaled));
        }
    }
    Ok(results)
}

pub fn parse_ticker_http_response(
    status_code: u16,
    body: &str,
    symbols: &[String],
) -> Result<Vec<(String, i128)>, BinancePriceError> {
    if status_code != 200 {
        return Err(BinancePriceError::HttpError(status_code));
    }
    parse_ticker_response_body(body, symbols)
}

pub fn parse_ticker_http_result(
    response: Result<(u16, String), String>,
    symbols: &[String],
) -> Result<Vec<(String, i128)>, BinancePriceError> {
    let (status_code, body) = response.map_err(BinancePriceError::NetworkError)?;
    parse_ticker_http_response(status_code, &body, symbols)
}

fn build_spot_price_url(symbols: &[String]) -> String {
    if symbols.len() == 1 {
        format!("{}?symbol={}", BINANCE_TICKER_PRICE_URL, symbols[0])
    } else {
        format!(
            "{}?symbols={}",
            BINANCE_TICKER_PRICE_URL,
            percent_encode_query_value(&serde_json::to_string(symbols).unwrap())
            serde_json::to_string(symbols).unwrap_or_default()
        )
    }
}

fn percent_encode_query_value(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());

    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push('%');
                encoded.push(HEX[(byte >> 4) as usize] as char);
                encoded.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }

    encoded
}

pub async fn fetch_spot_prices(
    symbols: &[String],
) -> Result<Vec<(String, i128)>, BinancePriceError> {
    fetch_spot_prices_with_url(BINANCE_TICKER_PRICE_URL, symbols).await
}

pub(crate) async fn fetch_spot_prices_with_url(
    base_url: &str,
    symbols: &[String],
) -> Result<Vec<(String, i128)>, BinancePriceError> {
    let mut req = crate::http::client().get(base_url);
    if symbols.len() == 1 {
        req = req.query(&[("symbol", &symbols[0])]);
    } else {
        let symbols_json = serde_json::to_string(symbols).unwrap_or_default();
        req = req.query(&[("symbols", &symbols_json)]);
    }
    let response = req
        .send()
        .await
        .map_err(|err| BinancePriceError::NetworkError(err.to_string()))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|err| BinancePriceError::NetworkError(err.to_string()))?;
    parse_ticker_http_result(Ok((status, body)), symbols)
}

pub fn parse_price_to_precision(raw: &str) -> Result<i128, BinancePriceError> {
    let text = raw.trim();
    if text.is_empty() {
        return Err(BinancePriceError::PriceParseError(
            "empty price string".to_string(),
        ));
    }
    if text.starts_with('-') {
        return Err(BinancePriceError::PriceParseError(
            "negative prices are not supported".to_string(),
        ));
    }

    let mut split = text.split('.');
    let whole = split.next().unwrap_or("0");
    let frac = split.next().unwrap_or("");
    if split.next().is_some() {
        return Err(BinancePriceError::PriceParseError(format!(
            "invalid decimal format: {text}"
        )));
    }

    let whole_val = whole
        .parse::<i128>()
        .map_err(|_| BinancePriceError::PriceParseError(format!("invalid whole part: {text}")))?;

    let scale_digits = 30usize;
    let normalized_frac = if frac.len() >= scale_digits {
        frac[..scale_digits].to_string()
    } else {
        let mut padded = frac.to_string();
        while padded.len() < scale_digits {
            padded.push('0');
        }
        padded
    };

    let frac_val = if normalized_frac.is_empty() {
        0
    } else {
        normalized_frac.parse::<i128>().map_err(|_| {
            BinancePriceError::PriceParseError(format!("invalid fractional part: {text}"))
        })?
    };

    let whole_scaled = whole_val
        .checked_mul(FLOAT_PRECISION)
        .ok_or_else(|| BinancePriceError::PriceParseError(format!("overflow for price: {text}")))?;
    whole_scaled
        .checked_add(frac_val)
        .ok_or_else(|| BinancePriceError::PriceParseError(format!("overflow for price: {text}")))
}

#[cfg(test)]
mod tests {
    use super::{
        build_spot_price_url, parse_price_to_precision, parse_ticker_http_response,
        parse_ticker_http_result, parse_ticker_response_body, BinancePriceError,
        BINANCE_TICKER_PRICE_URL, FLOAT_PRECISION,
    };

    #[test]
    fn parse_price_integer() {
        assert_eq!(parse_price_to_precision("2").unwrap(), 2 * FLOAT_PRECISION);
    }

    #[test]
    fn parse_price_decimal() {
        assert_eq!(
            parse_price_to_precision("1.5").unwrap(),
            FLOAT_PRECISION + (FLOAT_PRECISION / 2)
        );
    }

    #[test]
    fn parse_price_invalid() {
        assert!(parse_price_to_precision("abc").is_err());
    }

    // #345 — rejects negatives and multiple dots
    #[test]
    fn parse_price_rejects_negative() {
        let err = parse_price_to_precision("-1.5").unwrap_err();
        assert!(matches!(err, BinancePriceError::PriceParseError(_)));
    }

    #[test]
    fn parse_price_rejects_multiple_dots() {
        let err = parse_price_to_precision("1.2.3").unwrap_err();
        assert!(matches!(err, BinancePriceError::PriceParseError(_)));
    }

    #[test]
    fn parse_price_truncates_fractional_part_to_30_digits() {
        // 40 fractional digits should be truncated to 30
        let result =
            parse_price_to_precision("1.1234567890123456789012345678901234567890").unwrap();
        // Only first 30 digits used: 123456789012345678901234567890
        let expected_frac = 123_456_789_012_345_678_901_234_567_890i128;
        assert_eq!(result, FLOAT_PRECISION + expected_frac);
    }

    #[test]
    fn parse_price_truncates_fractional_with_leading_zeros() {
        // 31 fractional digits, first 30 are zeros; truncation loses the trailing 5
        let result = parse_price_to_precision("1.0000000000000000000000000000005").unwrap();
        assert_eq!(result, FLOAT_PRECISION);
    }

    #[test]
    fn parse_price_pads_fractional_to_30_digits() {
        // 2 fractional digits padded to 30 zeros
        let result = parse_price_to_precision("1.5").unwrap();
        assert_eq!(result, FLOAT_PRECISION + (FLOAT_PRECISION / 2));
    }

    #[test]
    fn parse_price_exact_30_fractional_digits() {
        // Exactly 30 fractional digits, no truncation or padding needed
        let result = parse_price_to_precision("1.123456789012345678901234567890").unwrap();
        let expected_frac = 123_456_789_012_345_678_901_234_567_890i128;
        assert_eq!(result, FLOAT_PRECISION + expected_frac);
    }

    #[test]
    fn parse_price_correct_scaling_to_1e30() {
        assert_eq!(parse_price_to_precision("1").unwrap(), FLOAT_PRECISION);
        assert_eq!(
            parse_price_to_precision("0.5").unwrap(),
            FLOAT_PRECISION / 2
        );
    }

    #[test]
    fn parse_ticker_response_filters_symbols() {
        let body = r#"[{"symbol":"BTCUSDT","price":"100.25"},{"symbol":"ETHUSDT","price":"10.5"}]"#;
        let symbols = vec!["ETHUSDT".to_string()];
        let parsed = parse_ticker_response_body(body, &symbols).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].0, "ETHUSDT".to_string());
        assert_eq!(parsed[0].1, 10 * FLOAT_PRECISION + (FLOAT_PRECISION / 2));
    }

    #[test]
    fn parse_single_ticker_response() {
        let body = r#"{"symbol":"BTCUSDT","price":"60733.99000000"}"#;
        let symbols = vec!["BTCUSDT".to_string()];
        let parsed = parse_ticker_response_body(body, &symbols).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].0, "BTCUSDT".to_string());
        assert_eq!(
            parsed[0].1,
            60733 * FLOAT_PRECISION + 99 * (FLOAT_PRECISION / 100)
        );
    }

    #[test]
    fn parse_ticker_http_response_non_200_returns_error() {
        let symbols = vec!["BTCUSDT".to_string()];
        let err = parse_ticker_http_response(503, "[]", &symbols).unwrap_err();
        assert_eq!(err, BinancePriceError::HttpError(503));
    }

    #[test]
    fn parse_ticker_http_result_network_failure_returns_error() {
        let symbols = vec!["BTCUSDT".to_string()];
        let err = parse_ticker_http_result(Err("timeout".to_string()), &symbols).unwrap_err();
        assert_eq!(err, BinancePriceError::NetworkError("timeout".to_string()));
    }

    // ── HTTP-level wiremock tests ─────────────────────────────────────────────

    #[tokio::test]
    async fn fetch_spot_prices_single_symbol_success() {
        use wiremock::matchers::{method, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let body = r#"{"symbol":"BTCUSDT","price":"60733.99"}"#;

        Mock::given(method("GET"))
            .and(query_param("symbol", "BTCUSDT"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(body, "application/json"))
            .mount(&server)
            .await;

        let symbols = vec!["BTCUSDT".to_string()];
        let result = super::fetch_spot_prices_with_url(&server.uri(), &symbols)
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, "BTCUSDT");
    }

    #[tokio::test]
    async fn fetch_spot_prices_multi_symbol_success() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let body = r#"[
            {"symbol":"BTCUSDT","price":"60733.99"},
            {"symbol":"ETHUSDT","price":"3500.50"}
        ]"#;

        Mock::given(method("GET"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(body, "application/json"))
            .mount(&server)
            .await;

        let symbols = vec!["BTCUSDT".to_string(), "ETHUSDT".to_string()];
        let result = super::fetch_spot_prices_with_url(&server.uri(), &symbols)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
    }

    #[tokio::test]
    async fn fetch_spot_prices_404_returns_http_error() {
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let symbols = vec!["BTCUSDT".to_string()];
        let err = super::fetch_spot_prices_with_url(&server.uri(), &symbols)
            .await
            .unwrap_err();
        assert_eq!(err, BinancePriceError::HttpError(404));
    }

    #[tokio::test]
    async fn fetch_spot_prices_500_returns_http_error() {
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let symbols = vec!["BTCUSDT".to_string()];
        let err = super::fetch_spot_prices_with_url(&server.uri(), &symbols)
            .await
            .unwrap_err();
        assert_eq!(err, BinancePriceError::HttpError(500));
    #[test]
    fn build_spot_price_url_includes_symbols_parameter_for_multiple_symbols() {
        let symbols = vec!["BTCUSDT".to_string(), "ETHUSDT".to_string()];
        let url = build_spot_price_url(&symbols);
        assert!(url.starts_with(BINANCE_TICKER_PRICE_URL));
        assert!(url.contains(r#"symbols=["BTCUSDT","ETHUSDT"]"#));
    }
}
