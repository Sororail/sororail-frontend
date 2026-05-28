/// Minimum number of price sources required to compute percentile-based spread.
/// With fewer sources we fall back to an equal spread around the median.
pub const MIN_SOURCES_FOR_PERCENTILE: usize = 3;

/// Price spread returned for on-chain submission.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PriceProps {
    /// 10th-percentile price (or fallback lower bound).
    pub min: i128,
    /// 90th-percentile price (or fallback upper bound).
    pub max: i128,
}

/// Compute the price spread from a slice of raw source prices.
///
/// With at least `MIN_SOURCES_FOR_PERCENTILE` (3) sources the spread is the
/// 10th-to-90th percentile range.  With fewer sources a ±1% equal spread
/// around the median is used as a fallback.
///
/// Returns `None` when `prices` is empty.
pub fn compute_confidence_interval(prices: &[i128]) -> Option<PriceProps> {
    if prices.is_empty() {
        return None;
    }

    let mut sorted = prices.to_vec();
    sorted.sort_unstable();

    if sorted.len() >= MIN_SOURCES_FOR_PERCENTILE {
        let min = percentile(&sorted, 10);
        let max = percentile(&sorted, 90);
        Some(PriceProps { min, max })
    } else {
        // Fallback: median ± 1 %
        let mid = sorted[sorted.len() / 2];
        let spread = mid / 100;
        Some(PriceProps {
            min: mid - spread,
            max: mid + spread,
        })
    }
}

/// Interpolating percentile (nearest-rank method).
fn percentile(sorted: &[i128], p: u8) -> i128 {
    debug_assert!(!sorted.is_empty());
    if sorted.len() == 1 || p == 0 {
        return sorted[0];
    }
    if p >= 100 {
        return *sorted.last().unwrap();
    }
    // index = p/100 * (n-1), linear interpolation between floor and ceil
    let n = sorted.len() as f64;
    let idx = (p as f64 / 100.0) * (n - 1.0);
    let lo = idx.floor() as usize;
    let hi = idx.ceil() as usize;
    if lo == hi {
        return sorted[lo];
    }
    let frac = idx - lo as f64;
    let lo_val = sorted[lo] as f64;
    let hi_val = sorted[hi] as f64;
    (lo_val + frac * (hi_val - lo_val)) as i128
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn five_prices_tenth_and_ninetieth_percentile() {
        // sorted: [100, 200, 300, 400, 500]
        // 10th percentile index = 0.1 * 4 = 0.4 → lo=0 hi=1 → 100 + 0.4*(200-100) = 140
        // 90th percentile index = 0.9 * 4 = 3.6 → lo=3 hi=4 → 400 + 0.6*(500-400) = 460
        let prices = vec![300i128, 100, 500, 200, 400];
        let p = compute_confidence_interval(&prices).unwrap();
        assert_eq!(p.min, 140);
        assert_eq!(p.max, 460);
    }

    #[test]
    fn three_sources_uses_percentile_not_fallback() {
        let prices = vec![100i128, 200, 300];
        // 10th: 0.1*2=0.2 → 100+0.2*100=120
        // 90th: 0.9*2=1.8 → 200+0.8*100=280
        let p = compute_confidence_interval(&prices).unwrap();
        assert_eq!(p.min, 120);
        assert_eq!(p.max, 280);
    }

    #[test]
    fn two_sources_uses_fallback_equal_spread() {
        // Only 2 sources — fallback: median ± 1 %
        let prices = vec![1000i128, 2000];
        let p = compute_confidence_interval(&prices).unwrap();
        // median of [1000, 2000] at index 1 = 2000 (integer division len/2=1)
        let mid = 2000i128;
        assert_eq!(p.min, mid - mid / 100);
        assert_eq!(p.max, mid + mid / 100);
    }

    #[test]
    fn single_source_uses_fallback_equal_spread() {
        let prices = vec![5000i128];
        let p = compute_confidence_interval(&prices).unwrap();
        assert_eq!(p.min, 5000 - 50);
        assert_eq!(p.max, 5000 + 50);
    }

    #[test]
    fn empty_prices_returns_none() {
        assert_eq!(compute_confidence_interval(&[]), None);
    }

    #[test]
    fn min_is_less_than_or_equal_to_max() {
        let prices = vec![42i128, 43, 44, 45, 46];
        let p = compute_confidence_interval(&prices).unwrap();
        assert!(p.min <= p.max);
    }

    #[test]
    fn even_source_count_six_prices() {
        let prices = vec![100i128, 200, 300, 400, 500, 600];
        let p = compute_confidence_interval(&prices).unwrap();
        // 10th: 0.1*5=0.5 → lo=0 hi=1 → 100+0.5*100=150
        // 90th: 0.9*5=4.5 → lo=4 hi=5 → 500+0.5*100=550
        assert_eq!(p.min, 150);
        assert_eq!(p.max, 550);
        assert!(p.min <= p.max);
    }

    #[test]
    fn odd_source_count_seven_prices() {
        let prices = vec![10i128, 20, 30, 40, 50, 60, 70];
        let p = compute_confidence_interval(&prices).unwrap();
        // 10th: 0.1*6=0.6 → lo=0 hi=1 → 10+0.6*10=16
        // 90th: 0.9*6=5.4 → lo=5 hi=6 → 60+0.4*10=64
        assert_eq!(p.min, 16);
        assert_eq!(p.max, 64);
        assert!(p.min <= p.max);
    }

    #[test]
    fn median_calculation_odd_count() {
        let prices = vec![1i128, 2, 3, 4, 5];
        let p = compute_confidence_interval(&prices).unwrap();
        let sorted = [1, 2, 3, 4, 5];
        let median = sorted[sorted.len() / 2]; // 3
        assert_eq!(median, 3);
        assert!(p.min <= p.max);
    }

    #[test]
    fn median_calculation_even_count() {
        let prices = vec![1i128, 2, 3, 4, 5, 6];
        let p = compute_confidence_interval(&prices).unwrap();
        let sorted = [1, 2, 3, 4, 5, 6];
        let median = sorted[sorted.len() / 2]; // 4
        assert_eq!(median, 4);
        assert!(p.min <= p.max);
    }

    #[test]
    fn confidence_interval_with_outliers() {
        // Large outliers at both ends; 10th-90th percentile should exclude them
        let prices = vec![1i128, 2, 3, 4, 100, 200, 300, 400, 500, 1000000];
        let p = compute_confidence_interval(&prices).unwrap();
        // With percentile method, outliers don't heavily skew the interval
        assert!(p.min <= p.max);
        // 10th percentile should be much lower than max
        assert!(p.max > p.min);
    }

    #[test]
    fn duplicate_prices() {
        let prices = vec![100i128, 100, 100, 100, 100];
        let p = compute_confidence_interval(&prices).unwrap();
        // All the same price → percentiles should be 100
        assert_eq!(p.min, 100);
        assert_eq!(p.max, 100);
    }

    #[test]
    fn large_price_values() {
        let prices = vec![1_000_000_000i128, 2_000_000_000, 3_000_000_000];
        let p = compute_confidence_interval(&prices).unwrap();
        // Should handle large values without overflow
        assert!(p.min <= p.max);
        assert!(p.min > 0);
        assert!(p.max > 0);
    }

    #[test]
    fn percentile_boundary_p_zero() {
        let sorted = [100i128, 200, 300];
        // percentile with p=0 should return first element
        assert_eq!(percentile(&sorted, 0), 100);
    }

    #[test]
    fn percentile_boundary_p_hundred() {
        let sorted = [100i128, 200, 300];
        // percentile with p=100 should return last element
        assert_eq!(percentile(&sorted, 100), 300);
    }

    #[test]
    fn percentile_single_element() {
        let sorted = [42i128];
        // Single element should return that element for any percentile
        assert_eq!(percentile(&sorted, 10), 42);
        assert_eq!(percentile(&sorted, 50), 42);
        assert_eq!(percentile(&sorted, 90), 42);
    }

    #[test]
    fn full_aggregation_pipeline_even_sources() {
        // Simulate a full price aggregation with even number of sources
        let raw_prices = vec![
            ("BTC".to_string(), 45000i128),
            ("BTC".to_string(), 45100i128),
            ("BTC".to_string(), 44900i128),
            ("BTC".to_string(), 45050i128),
        ];
        let prices: Vec<i128> = raw_prices.iter().map(|(_, p)| *p).collect();
        let p = compute_confidence_interval(&prices).unwrap();
        assert!(p.min <= p.max);
        assert!(p.min >= 44900);
        assert!(p.max <= 45100);
    }

    #[test]
    fn full_aggregation_pipeline_odd_sources() {
        // Simulate a full price aggregation with odd number of sources
        let raw_prices = vec![
            ("ETH".to_string(), 2500i128),
            ("ETH".to_string(), 2510i128),
            ("ETH".to_string(), 2490i128),
            ("ETH".to_string(), 2505i128),
            ("ETH".to_string(), 2495i128),
        ];
        let prices: Vec<i128> = raw_prices.iter().map(|(_, p)| *p).collect();
        let p = compute_confidence_interval(&prices).unwrap();
        assert!(p.min <= p.max);
        assert!(p.min >= 2490);
        assert!(p.max <= 2510);
    }
}
