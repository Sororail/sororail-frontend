//! Execution price helpers including open-interest price impact.

pub const FACTOR_DENOMINATOR: u128 = 1_000_000;

/// Result of an execution price query for UI preview.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ExecutionPrice {
    /// Oracle index price before price impact.
    pub price_without_impact: i128,
    /// Fill price after applying OI-based price impact.
    pub price_with_impact: i128,
}

/// Raise a `FACTOR_DENOMINATOR`-scaled fixed-point `base` to an integer power.
///
/// `exponent_factor` is itself `FACTOR_DENOMINATOR`-scaled, so `1_000_000`
/// means `^1`, `2_000_000` means `^2`, and so on. Only whole-number exponents
/// are supported; any fractional part of `exponent_factor` is truncated. The
/// result keeps the `FACTOR_DENOMINATOR` scaling (`base^0 == 1.0`).
pub fn pow_factor(base: u128, exponent_factor: u128) -> u128 {
    let exponent = exponent_factor / FACTOR_DENOMINATOR;
    let mut result = FACTOR_DENOMINATOR;
    let mut applied = 0;
    while applied < exponent {
        result = result.saturating_mul(base) / FACTOR_DENOMINATOR;
        applied += 1;
    }
    result
}

/// Compute the signed price impact from the current OI imbalance along the full
/// `factor x (|diff|^exponent)` curve, where `diff` is the normalised OI
/// imbalance and `exponent` comes from `price_impact_exponent_factor`.
///
/// The sign is expressed in "adverse" terms relative to the trade:
/// * positive  — the trade worsens the dominant side's OI share, so the trader
///   pays impact (the magnitude accrues to the impact pool).
/// * negative  — the trade improves the imbalance, so the trader receives
///   favorable impact. Favorable impact is paid out of the impact pool and is
///   therefore capped at `impact_pool_amount`.
///
/// Returns `0` when there is no imbalance to act on or impact is disabled.
#[allow(clippy::too_many_arguments)]
pub fn compute_price_impact_amount(
    index_price: u128,
    size_delta_usd: u128,
    long_oi: u128,
    short_oi: u128,
    is_long: bool,
    is_increase: bool,
    price_impact_factor: u128,
    price_impact_exponent_factor: u128,
    impact_pool_amount: u128,
) -> i128 {
    if size_delta_usd == 0 || price_impact_factor == 0 || index_price == 0 {
        return 0;
    }

    let total_oi = long_oi.saturating_add(short_oi);
    if total_oi == 0 {
        return 0;
    }

    let (imbalance, dominant_long) = if long_oi >= short_oi {
        (long_oi - short_oi, true)
    } else {
        (short_oi - long_oi, false)
    };
    if imbalance == 0 {
        return 0;
    }

    // Normalise the imbalance to [0, FACTOR_DENOMINATOR] before applying the
    // exponent so the curve stays bounded and cannot overflow.
    let ratio = imbalance.saturating_mul(FACTOR_DENOMINATOR) / total_oi;
    let ratio_pow = pow_factor(ratio, price_impact_exponent_factor);

    let magnitude = index_price
        .saturating_mul(price_impact_factor)
        .saturating_mul(ratio_pow)
        / FACTOR_DENOMINATOR
        / FACTOR_DENOMINATOR;
    if magnitude == 0 {
        return 0;
    }

    let worsens_imbalance = (is_long == dominant_long) == is_increase;
    if worsens_imbalance {
        magnitude as i128
    } else {
        // Favorable impact cannot pay out more than the impact pool holds.
        let paid = magnitude.min(impact_pool_amount);
        -(paid as i128)
    }
}

/// Apply signed price impact to an index price for the given trade direction.
///
/// `impact` follows the sign convention of [`compute_price_impact_amount`]:
/// positive worsens the trader's execution price, negative improves it.
pub fn apply_price_impact(
    index_price: u128,
    impact: i128,
    is_long: bool,
    is_increase: bool,
) -> u128 {
    if impact == 0 || index_price == 0 {
        return index_price;
    }

    // Direction in which an adverse (positive) impact moves the price.
    let adverse_sign: i128 = match (is_long, is_increase) {
        (true, true) | (false, false) => 1,
        (true, false) | (false, true) => -1,
    };

    let delta = adverse_sign.saturating_mul(impact);
    let price = (index_price as i128).saturating_add(delta);
    if price < 0 {
        0
    } else {
        price as u128
    }
}

/// Compute execution prices for a position trade preview.
#[allow(clippy::too_many_arguments)]
pub fn get_execution_price(
    index_price: u128,
    size_delta_usd: u128,
    long_oi: u128,
    short_oi: u128,
    is_long: bool,
    is_increase: bool,
    price_impact_factor: u128,
    price_impact_exponent_factor: u128,
    impact_pool_amount: u128,
) -> ExecutionPrice {
    let price_without_impact = index_price as i128;
    let impact = compute_price_impact_amount(
        index_price,
        size_delta_usd,
        long_oi,
        short_oi,
        is_long,
        is_increase,
        price_impact_factor,
        price_impact_exponent_factor,
        impact_pool_amount,
    );
    let price_with_impact = apply_price_impact(index_price, impact, is_long, is_increase) as i128;

    ExecutionPrice {
        price_without_impact,
        price_with_impact,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Exponent of `^1` (linear curve), expressed in FACTOR_DENOMINATOR units.
    const LINEAR: u128 = FACTOR_DENOMINATOR;
    // Exponent of `^2` (quadratic curve).
    const SQUARED: u128 = 2 * FACTOR_DENOMINATOR;

    #[test]
    fn test_pow_factor_known_values() {
        // base^0 == 1.0
        assert_eq!(pow_factor(2_000_000, 0), FACTOR_DENOMINATOR);
        // 1.5^1 == 1.5
        assert_eq!(pow_factor(1_500_000, LINEAR), 1_500_000);
        // 2.0^2 == 4.0
        assert_eq!(pow_factor(2_000_000, SQUARED), 4_000_000);
        // 0.5^2 == 0.25
        assert_eq!(pow_factor(500_000, SQUARED), 250_000);
        // 3.0^3 == 27.0
        assert_eq!(pow_factor(3_000_000, 3 * FACTOR_DENOMINATOR), 27_000_000);
    }

    #[test]
    fn test_balanced_oi_has_no_impact() {
        let result = get_execution_price(100, 1_000, 5_000, 5_000, true, true, 50_000, LINEAR, 0);
        assert_eq!(result.price_without_impact, 100);
        assert_eq!(result.price_with_impact, 100);
    }

    #[test]
    fn test_long_increase_with_long_oi_imbalance_increases_price() {
        // imbalance=6000, total=10000 → ratio=0.6
        // impact = 100 * 100_000/1e6 * 0.6^1 = 6
        let result = get_execution_price(100, 1_000, 8_000, 2_000, true, true, 100_000, LINEAR, 0);
        assert_eq!(result.price_without_impact, 100);
        assert_eq!(result.price_with_impact, 106);
    }

    #[test]
    fn test_long_increase_with_squared_exponent_bends_the_curve() {
        // ratio=0.6, squared → 0.36; impact = 100 * 0.1 * 0.36 = 3 (floored)
        let result = get_execution_price(100, 1_000, 8_000, 2_000, true, true, 100_000, SQUARED, 0);
        assert_eq!(result.price_with_impact, 103);
    }

    #[test]
    fn test_short_increase_with_short_oi_imbalance_worsens_execution_price() {
        let result = get_execution_price(100, 1_000, 2_000, 8_000, false, true, 100_000, LINEAR, 0);
        assert_eq!(result.price_with_impact, 94);
    }

    #[test]
    fn test_favorable_decrease_pays_nothing_with_empty_impact_pool() {
        // Long decrease while longs dominate improves the imbalance, but an
        // empty impact pool means no favorable impact can be paid out.
        let result = get_execution_price(100, 1_000, 8_000, 2_000, true, false, 100_000, LINEAR, 0);
        assert_eq!(result.price_with_impact, 100);
    }

    #[test]
    fn test_favorable_decrease_paid_from_impact_pool() {
        // Favorable impact magnitude is 6; the pool can cover it in full, so a
        // closing long receives a 6-unit better (higher) exit price.
        let result =
            get_execution_price(100, 1_000, 8_000, 2_000, true, false, 100_000, LINEAR, 10);
        assert_eq!(result.price_with_impact, 106);
    }

    #[test]
    fn test_favorable_impact_capped_by_impact_pool_balance() {
        // Pool only holds 4, so the 6-unit favorable impact is clamped to 4.
        let result = get_execution_price(100, 1_000, 8_000, 2_000, true, false, 100_000, LINEAR, 4);
        assert_eq!(result.price_with_impact, 104);
    }
}
