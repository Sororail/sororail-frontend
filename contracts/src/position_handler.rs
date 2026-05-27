use soroban_sdk::{contract, contractimpl, contracttype, panic_with_error, Address, BytesN, Env};

use crate::{
    data_store::DataStoreClient,
    liquidity_handler::LiquidityHandlerClient,
    keys::market_maintenance_margin_factor_key,
    types::{PositionError, PositionProps},
    position_utils,
};

#[contract]
pub struct PositionHandler;

#[contracttype]
enum PositionHandlerKey {
    DataStore,
    LiquidityHandler,
}

#[contractimpl]
impl PositionHandler {
    /// Initialise with references to the deployed `data_store` and `liquidity_handler`.
    pub fn initialize(env: Env, data_store: Address, liquidity_handler: Address) {
        if env.storage().instance().has(&PositionHandlerKey::DataStore) {
            panic!("already initialised");
        }
        env.storage().instance().set(&PositionHandlerKey::DataStore, &data_store);
        env.storage().instance().set(&PositionHandlerKey::LiquidityHandler, &liquidity_handler);
    }

    /// Returns whether the position at `position_key` is liquidatable.
    ///
    /// Loads the position from `data_store`, fetches oracle prices from
    /// `liquidity_handler`, and uses `position_utils::is_liquidatable`.
    pub fn is_liquidatable(env: Env, position_key: BytesN<32>) -> bool {
        let ds = Self::data_store(&env);
        
        let pos: PositionProps = match ds.get_position_props(&position_key) {
            Some(p) => p,
            None => panic_with_error!(&env, PositionError::PositionNotFound),
        };

        if !pos.is_open {
            return false;
        }

        let lh = Self::liquidity_handler(&env);
        let prices = lh.oracle_prices(&pos.market_id);

        // Fetch maintenance margin factor from data_store.
        let margin_factor = ds.get_u128(&market_maintenance_margin_factor_key(&env, pos.market_id))
            .unwrap_or(0);

        // Use maximize = true pricing: choose the worst-case price for this position.
        // For long positions, the worst price is the long token price.
        // For short positions, the worst price is the short token price.
        let price = if pos.is_long {
            prices.long_price
        } else {
            prices.short_price
        };

        position_utils::is_liquidatable(&pos, price, margin_factor)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn data_store(env: &Env) -> DataStoreClient {
        let addr: Address = env
            .storage()
            .instance()
            .get(&PositionHandlerKey::DataStore)
            .expect("not initialised");
        DataStoreClient::new(env, &addr)
    }

    fn liquidity_handler(env: &Env) -> LiquidityHandlerClient {
        let addr: Address = env
            .storage()
            .instance()
            .get(&PositionHandlerKey::LiquidityHandler)
            .expect("not initialised");
        LiquidityHandlerClient::new(env, &addr)
    }
}
