use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Vec};

use crate::{
    data_store::DataStoreClient,
    keys::{
        borrowing_factor_key, funding_factor_key, impact_pool_amount_key,
        market_maintenance_margin_factor_key, open_interest_long_key,
        open_interest_short_key, position_fee_factor_key,
        price_impact_exponent_factor_key, price_impact_factor_key,
    },
    liquidity_handler::LiquidityHandlerClient,
    market_utils,
    position_utils::{
        calculate_pnl, get_position_fees, get_position_liquidation_price,
        get_position_pnl_usd,
    },
    pricing_utils::{get_execution_price as compute_execution_price, FACTOR_DENOMINATOR},
    types::{
        ExecutionPriceResult, FundingInfo, PositionFees, PositionInfo, PositionProps,
        PoolValueInfo,
    },
};

#[contract]
pub struct Reader;

#[contracttype]
enum ReaderKey {
    DataStore,
    LiquidityHandler,
}

/// ADL target entry: (account, position_key, unrealised_pnl_usd).
pub type AdlTarget = (Address, BytesN<32>, i128);

#[contractimpl]
impl Reader {
    pub fn initialize(env: Env, data_store: Address, liquidity_handler: Address) {
        if env.storage().instance().has(&ReaderKey::DataStore) {
            panic!("already initialised");
        }
        env.storage().instance().set(&ReaderKey::DataStore, &data_store);
        env.storage().instance().set(&ReaderKey::LiquidityHandler, &liquidity_handler);
    }

    /// Returns the top-`count` most profitable open positions for `market_id`
    /// on the given side (`is_long`), sorted by `unrealised_pnl_usd` descending.
    ///
    /// Each entry is `(account, position_key, unrealised_pnl_usd)`.
    pub fn get_adl_targets(
        env: Env,
        market_id: u32,
        is_long: bool,
        count: u32,
    ) -> Vec<AdlTarget> {
        let ds = Self::data_store(&env);
        let lh = Self::liquidity_handler(&env);

        let prices = lh.oracle_prices(&market_id);
        let current_price = if is_long {
            prices.long_price
        } else {
            prices.short_price
        };

        let positions: Vec<PositionProps> =
            ds.get_all_positions_for_market(&market_id, &is_long, &0, &u32::MAX);

        let mut entries: Vec<AdlTarget> = Vec::new(&env);
        for pos in positions.iter() {
            let pnl = calculate_pnl(&pos, current_price);
            entries.push_back((pos.account.clone(), pos.position_key.clone(), pnl));
        }

        // Sort by PnL descending using insertion sort (no_std compatible).
        let len = entries.len();
        for i in 1..len {
            let current = entries.get(i).unwrap();
            let mut j = i;
            while j > 0 {
                let prev = entries.get(j - 1).unwrap();
                if prev.2 >= current.2 {
                    break;
                }
                entries.set(j, prev);
                j -= 1;
            }
            entries.set(j, current);
        }

        // Truncate to `count` entries.
        let limit = if count < entries.len() { count } else { entries.len() };
        let mut result: Vec<AdlTarget> = Vec::new(&env);
        for i in 0..limit {
            result.push_back(entries.get(i).unwrap());
        }
        result
    }

    /// Preview the execution price for `size_delta_usd` on the given position,
    /// including OI-based price impact. Returns prices with and without impact.
    pub fn get_execution_price(
        env: Env,
        position_key: BytesN<32>,
        size_delta_usd: u128,
        is_increase: bool,
    ) -> ExecutionPriceResult {
        let ds = Self::data_store(&env);
        let lh = Self::liquidity_handler(&env);

        let pos: PositionProps = ds
            .get_position_props(&position_key)
            .expect("position not found");

        let prices = lh.oracle_prices(&pos.market_id);
        let index_price = if pos.is_long {
            prices.long_price
        } else {
            prices.short_price
        };

        let long_oi = ds
            .get_u128(&open_interest_long_key(&env, pos.market_id))
            .unwrap_or(0);
        let short_oi = ds
            .get_u128(&open_interest_short_key(&env, pos.market_id))
            .unwrap_or(0);
        let impact_factor = ds
            .get_u128(&price_impact_factor_key(&env, pos.market_id))
            .unwrap_or(0);
        // Unset exponent defaults to `^1` (a linear curve).
        let impact_exponent_factor = ds
            .get_u128(&price_impact_exponent_factor_key(&env, pos.market_id))
            .unwrap_or(FACTOR_DENOMINATOR);
        let impact_pool_amount = ds
            .get_u128(&impact_pool_amount_key(&env, pos.market_id))
            .unwrap_or(0);

        let result = compute_execution_price(
            index_price,
            size_delta_usd,
            long_oi,
            short_oi,
            pos.is_long,
            is_increase,
            impact_factor,
            impact_exponent_factor,
            impact_pool_amount,
        );

        ExecutionPriceResult {
            price_without_impact: result.price_without_impact,
            price_with_impact: result.price_with_impact,
        }
    }

    pub fn get_position_info(
        env: Env,
        position_key: BytesN<32>,
        maximize: bool,
    ) -> PositionInfo {
        let ds = Self::data_store(&env);
        let lh = Self::liquidity_handler(&env);

        let mut pos: PositionProps = ds
            .get_position_props(&position_key)
            .expect("position not found");

        let prices = lh.oracle_prices(&pos.market_id);
        let current_price = if pos.is_long {
            if maximize {
                prices.long_price.min(prices.short_price)
            } else {
                prices.long_price.max(prices.short_price)
            }
        } else if maximize {
            prices.long_price.max(prices.short_price)
        } else {
            prices.long_price.min(prices.short_price)
        };

        let pnl_usd = get_position_pnl_usd(&pos, current_price);

        let funding_factor = ds
            .get_u128(&funding_factor_key(&env, pos.market_id))
            .unwrap_or(0);
        let borrowing_factor = ds
            .get_u128(&borrowing_factor_key(&env, pos.market_id))
            .unwrap_or(0);
        let position_fee_factor = ds
            .get_u128(&position_fee_factor_key(&env, pos.market_id))
            .unwrap_or(0);
        let maintenance_margin_factor = ds
            .get_u128(&market_maintenance_margin_factor_key(&env, pos.market_id))
            .unwrap_or(0);

        let (funding_fee, borrowing_fee, position_fee, total_fee) = get_position_fees(
            pos.quantity,
            funding_factor,
            borrowing_factor,
            position_fee_factor,
        );

        let pending_fees = PositionFees {
            borrowing_fee,
            funding_fee,
            position_fee,
            total_fee,
        };

        let liquidation_price = get_position_liquidation_price(
            &pos,
            maintenance_margin_factor,
            funding_factor,
            borrowing_factor,
            position_fee_factor,
        );

        let funding_info = FundingInfo {
            borrowing_factor,
            funding_factor,
            position_fee_factor,
        };

        PositionInfo {
            position: pos,
            pnl_usd,
            pending_fees,
            liquidation_price,
            funding_info,
        }
    }

    pub fn get_market_pool_value_info(
        env: Env,
        market_id: u32,
        long_price: u128,
        short_price: u128,
        maximize: bool,
    ) -> PoolValueInfo {
        let ds = Self::data_store(&env);
        let lh = Self::liquidity_handler(&env);

        let (pool_long, pool_short) = lh.pool_amounts(&market_id);
        let impact_pool_amount = ds
            .get_u128(&impact_pool_amount_key(&env, market_id))
            .unwrap_or(0);
        let lp_supply = lh.lp_supply(&market_id);

        market_utils::get_pool_value(
            pool_long,
            pool_short,
            long_price,
            short_price,
            impact_pool_amount,
            lp_supply,
            maximize,
        )
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn data_store(env: &Env) -> DataStoreClient<'_> {
        let addr: Address = env
            .storage()
            .instance()
            .get(&ReaderKey::DataStore)
            .expect("not initialised");
        DataStoreClient::new(env, &addr)
    }

    fn liquidity_handler(env: &Env) -> LiquidityHandlerClient<'_> {
        let addr: Address = env
            .storage()
            .instance()
            .get(&ReaderKey::LiquidityHandler)
            .expect("not initialised");
        LiquidityHandlerClient::new(env, &addr)
    }
}
