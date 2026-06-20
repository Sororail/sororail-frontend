use serde::Deserialize;

pub const PYTH_HERMES_URL: &str = "https://hermes.pyth.network/api/latest_price_feeds";
pub const FLOAT_PRECISION: i128 = 1_000_000_000_000_000_000_000_000_000_000;

#[derive(Debug, Clone, PartialEq)]
pub enum PythPriceError {
    NetworkError(String),
    HttpError(u16),
    JsonError(String),
    PriceParseError(String),
    MissingFeedId(String),
    StalePrice {
        age_seconds: u64,
        max_age_seconds: u64,
    },
    ConfidenceTooWide {
        confidence_bps: f64,
        max_bps: u32,
    },
    InvalidPublishTime(i64),
}

#[derive(Debug, Deserialize)]
pub struct PythPrice {
    pub price: PythPriceData,
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct PythPriceData {
    pub price: String,
    #[serde(default)]
    pub conf: Option<String>,
    pub expo: i32,
    #[serde(default)]
    pub publish_time: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct PythPriceFeed {
    pub id: String,
    pub price: PythPriceData,
}

#[derive(Debug, Deserialize)]
pub struct PythResponse {
    pub data: PythPriceFeed,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum HermesResponse {
    Array(Vec<PythPriceFeed>),
    Wrapped(PythResponse),
}

pub fn normalize_pyth_price(price_str: &str, exponent: i32) -> Result<i128, PythPriceError> {
    if !(-30..=0).contains(&exponent) {
        return Err(PythPriceError::PriceParseError(format!(
            "unsupported exponent: {exponent}"
        )));
    }

    let price_int = price_str
        .trim()
        .parse::<i128>()
        .map_err(|_| PythPriceError::PriceParseError(format!("invalid price: {}", price_str)))?;

    if price_int < 0 {
        return Err(PythPriceError::PriceParseError(
            "negative prices not supported".to_string(),
        ));
    }

    let exponent_diff = 30 + exponent;

    if exponent_diff >= 0 {
        price_int
            .checked_mul(10i128.pow(exponent_diff as u32))
            .ok_or_else(|| {
                PythPriceError::PriceParseError("price overflow during normalization".to_string())
            })
    } else {
        let divisor = 10i128.pow((-exponent_diff) as u32);
        Ok(price_int / divisor)
    }
}

pub fn validate_pyth_price(
    data: &PythPriceData,
    now_seconds: u64,
    stale_after_seconds: u64,
    max_confidence_bps: u32,
) -> Result<i128, PythPriceError> {
    let price = normalize_pyth_price(&data.price, data.expo)?;
    let publish_time = data
        .publish_time
        .ok_or(PythPriceError::InvalidPublishTime(-1))?;
    if publish_time < 0 {
        return Err(PythPriceError::InvalidPublishTime(publish_time));
    }
    let publish_time = publish_time as u64;
    let age_seconds = now_seconds.saturating_sub(publish_time);
    if age_seconds > stale_after_seconds {
        return Err(PythPriceError::StalePrice {
            age_seconds,
            max_age_seconds: stale_after_seconds,
        });
    }

    if let Some(conf) = &data.conf {
        if price <= 0 {
            return Err(PythPriceError::PriceParseError(
                "price must be greater than zero".to_string(),
            ));
        }
        let confidence = normalize_pyth_price(conf, data.expo)?;
        let confidence_bps = (confidence as f64 / price as f64) * 10_000.0;
        if confidence_bps > max_confidence_bps as f64 {
            return Err(PythPriceError::ConfidenceTooWide {
                confidence_bps,
                max_bps: max_confidence_bps,
            });
        }
    }

    Ok(price)
}

pub async fn fetch_pyth_price(
    feed_id: &str,
    stale_after_seconds: u64,
    max_confidence_bps: u32,
) -> Result<i128, PythPriceError> {
    let url_string = format!("{}?ids[]={}", PYTH_HERMES_URL, feed_id);

    let response = crate::http::client()
        .get(&url_string)
        .send()
        .await
        .map_err(|err| PythPriceError::NetworkError(err.to_string()))?;

    let status = response.status().as_u16();
    if status != 200 {
        return Err(PythPriceError::HttpError(status));
    }

    let body = response
        .text()
        .await
        .map_err(|err| PythPriceError::NetworkError(err.to_string()))?;

    let response: HermesResponse =
        serde_json::from_str(&body).map_err(|err| PythPriceError::JsonError(err.to_string()))?;
    let feed = match response {
        HermesResponse::Array(mut feeds) => feeds
            .pop()
            .ok_or_else(|| PythPriceError::MissingFeedId(feed_id.to_string()))?,
        HermesResponse::Wrapped(wrapped) => wrapped.data,
    };

    validate_pyth_price(
        &feed.price,
        current_timestamp_secs(),
        stale_after_seconds,
        max_confidence_bps,
    )
}

fn current_timestamp_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_pyth_price_positive_exponent() {
        let err = normalize_pyth_price("45000000000", 8).unwrap_err();
        assert!(matches!(err, PythPriceError::PriceParseError(_)));
    }

    #[test]
    fn normalize_pyth_price_negative_exponent() {
        let result = normalize_pyth_price("4500000000", -8).unwrap();
        assert!(result > 0);
    }

    #[test]
    fn normalize_pyth_price_invalid() {
        let err = normalize_pyth_price("invalid", -8).unwrap_err();
        assert!(matches!(err, PythPriceError::PriceParseError(_)));
    }

    #[test]
    fn normalize_pyth_price_negative() {
        let err = normalize_pyth_price("-45000000000", -8).unwrap_err();
        assert!(matches!(err, PythPriceError::PriceParseError(_)));
    }

    #[test]
    fn validate_pyth_price_accepts_fresh_confident_price() {
        let data = PythPriceData {
            price: "100000000".to_string(),
            conf: Some("100000".to_string()),
            expo: -8,
            publish_time: Some(1_000),
        };
        let price = validate_pyth_price(&data, 1_010, 60, 50).unwrap();
        assert_eq!(price, FLOAT_PRECISION);
    }

    #[test]
    fn validate_pyth_price_rejects_stale_price() {
        let data = PythPriceData {
            price: "100000000".to_string(),
            conf: Some("100000".to_string()),
            expo: -8,
            publish_time: Some(1_000),
        };
        let err = validate_pyth_price(&data, 1_500, 60, 50).unwrap_err();
        assert!(matches!(err, PythPriceError::StalePrice { .. }));
    }

    #[test]
    fn validate_pyth_price_rejects_wide_confidence() {
        let data = PythPriceData {
            price: "100000000".to_string(),
            conf: Some("10000000".to_string()),
            expo: -8,
            publish_time: Some(1_000),
        };
        let err = validate_pyth_price(&data, 1_010, 60, 50).unwrap_err();
        assert!(matches!(err, PythPriceError::ConfidenceTooWide { .. }));
    }

    #[test]
    fn validate_pyth_price_rejects_missing_publish_time() {
        let data = PythPriceData {
            price: "100000000".to_string(),
            conf: Some("100000".to_string()),
            expo: -8,
            publish_time: None,
        };
        let err = validate_pyth_price(&data, 1_010, 60, 50).unwrap_err();
        assert_eq!(err, PythPriceError::InvalidPublishTime(-1));
    }

    #[test]
    fn validate_pyth_price_rejects_negative_publish_time() {
        let data = PythPriceData {
            price: "100000000".to_string(),
            conf: Some("100000".to_string()),
            expo: -8,
            publish_time: Some(-1),
        };
        let err = validate_pyth_price(&data, 1_010, 60, 50).unwrap_err();
        assert_eq!(err, PythPriceError::InvalidPublishTime(-1));
    }

    #[test]
    fn validate_pyth_price_rejects_zero_price_when_confidence_present() {
        let data = PythPriceData {
            price: "0".to_string(),
            conf: Some("100000".to_string()),
            expo: -8,
            publish_time: Some(1_000),
        };
        let err = validate_pyth_price(&data, 1_010, 60, 50).unwrap_err();
        assert!(matches!(err, PythPriceError::PriceParseError(_)));
    }

    #[test]
    fn normalize_pyth_price_rejects_overflow() {
        let err = normalize_pyth_price(&i128::MAX.to_string(), 0).unwrap_err();
        assert!(matches!(err, PythPriceError::PriceParseError(_)));
    }
}
