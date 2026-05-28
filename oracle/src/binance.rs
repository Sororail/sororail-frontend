use serde::Deserialize;

pub const BINANCE_TICKER_PRICE_URL: &str = "https://api.binance.com/api/v3/ticker/price";
pub const FLOAT_PRECISION: i128 = 1_000_000_000_000_000_000_000_000_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BinancePriceError {
    NetworkError(String),
    HttpError(u16),
    JsonError(String),
    PriceParseError(String),
}

#[derive(Debug, Deserialize)]
pub struct BinanceTickerEntry {
    pub symbol: String,
    pub price: String,
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
    use super::{parse_price_to_precision, FLOAT_PRECISION};

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
}
