use crate::types::PoolValueInfo;

/// Compute market pool value information from on-chain amounts and oracle prices.
pub fn get_pool_value(
    pool_long: u128,
    pool_short: u128,
    long_price: u128,
    short_price: u128,
    impact_pool_amount: u128,
    lp_supply: u128,
    maximize: bool,
) -> PoolValueInfo {
    let pool_value = pool_long.saturating_mul(long_price).saturating_add(pool_short.saturating_mul(short_price));

    let long_pnl: i128 = 0;
    let short_pnl: i128 = 0;
    let net_pnl = long_pnl.saturating_add(short_pnl);
    let index_token_price = if maximize { short_price } else { long_price };

    PoolValueInfo {
        pool_value,
        long_pnl,
        short_pnl,
        impact_pool_amount,
        net_pnl,
        lp_supply,
        index_token_price,
    }
}
