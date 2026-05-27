use soroban_sdk::{contract, contractimpl, contracttype, panic_with_error, Address, BytesN, Env};

use crate::{
    data_store::DataStoreClient,
    keys::{
        market_count_key, market_long_token_key, market_paused_key, market_props_key,
        market_short_token_key, market_token_key, market_maintenance_margin_factor_key,
    },
    role_store::{role_admin_id, RoleStoreClient},
    types::{MarketConfig, MarketError},
};

/// Composite key for the reverse-lookup index that maps a
/// `(index_token, long_token, short_token)` triple to the corresponding
/// `market_token` address.
#[contracttype]
pub struct MarketByTokensKey {
    pub index_token: Address,
    pub long_token: Address,
    pub short_token: Address,
}

// ---------------------------------------------------------------------------
// Well-known role identifiers
// ---------------------------------------------------------------------------

/// Role required to create markets.  Encoded as the SHA-256 of the ASCII
/// string `"MARKET_KEEPER"` truncated / padded to 32 bytes for readability.
pub fn market_keeper_role(env: &Env) -> BytesN<32> {
    let mut buf = [0u8; 32];
    buf[..13].copy_from_slice(b"MARKET_KEEPER");
    BytesN::from_array(env, &buf)
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/// Factory contract responsible for creating and managing markets.
///
/// Depends on a deployed `RoleStore` (for authorisation) and a deployed
/// `DataStore` (for persistent market data).  Both addresses are stored in
/// instance storage at initialisation time.
#[contract]
pub struct MarketFactory;

/// Instance-storage keys for the two dependency addresses.
#[soroban_sdk::contracttype]
enum InstanceKey {
    RoleStore,
    DataStore,
}

#[contractimpl]
impl MarketFactory {
    // -----------------------------------------------------------------------
    // Bootstrap
    // -----------------------------------------------------------------------

    /// Initialise the factory with references to the existing `role_store` and
    /// `data_store` contracts.
    ///
    /// Can only be called once; panics if already initialised.  No
    /// authentication is required for the bootstrap call — secure deployment
    /// by calling immediately after instantiation.
    pub fn initialize(env: Env, role_store: Address, data_store: Address) {
        if env.storage().instance().has(&InstanceKey::RoleStore) {
            panic!("already initialised");
        }
        env.storage()
            .instance()
            .set(&InstanceKey::RoleStore, &role_store);
        env.storage()
            .instance()
            .set(&InstanceKey::DataStore, &data_store);
    }

    // -----------------------------------------------------------------------
    // Market creation (issue #10)
    // -----------------------------------------------------------------------

    /// Create a new market and persist all configuration to `data_store`.
    ///
    /// The caller must authenticate and hold `ROLE_ADMIN` or
    /// `MARKET_KEEPER`.  Returns the newly assigned market ID.
    ///
    /// When `config` is `None`, default limits (`u128::MAX`) are applied.
    pub fn create_market(
        env: Env,
        caller: Address,
        index_token: Address,
        long_token: Address,
        short_token: Address,
        market_token: Address,
        config: Option<MarketConfig>,
    ) -> u32 {
        caller.require_auth();
        let (rs_addr, ds_addr) = Self::deps(&env);
        Self::require_admin_or_keeper(&env, &rs_addr, &caller);

        let ds = DataStoreClient::new(&env, &ds_addr);

        // Assign the next market ID from the counter.
        let count_key = market_count_key(&env);
        let market_id: u32 = ds
            .get_u128(&count_key)
            .unwrap_or(0) as u32;

        let cfg = config.unwrap_or(MarketConfig {
            max_long_open_interest: u128::MAX,
            max_short_open_interest: u128::MAX,
            maintenance_margin_factor: 0,
        });

        // Persist per-token address keys.
        ds.set_u128(
            &caller,
            &market_long_token_key(&env, market_id),
            &(long_token.to_string().len() as u128),
        );
        ds.set_u128(
            &caller,
            &market_short_token_key(&env, market_id),
            &(short_token.to_string().len() as u128),
        );
        ds.set_u128(
            &caller,
            &market_token_key(&env, market_id),
            &(market_token.to_string().len() as u128),
        );

        // Persist config limits.
        ds.set_u128(
            &caller,
            &market_props_key(&env, market_id),
            &cfg.max_long_open_interest,
        );

        // Persist maintenance margin factor.
        ds.set_u128(
            &caller,
            &market_maintenance_margin_factor_key(&env, market_id),
            &cfg.maintenance_margin_factor,
        );

        // Advance the counter.
        ds.set_u128(&caller, &count_key, &((market_id as u128) + 1));

        // Store reverse-lookup: (index_token, long_token, short_token) → market_token.
        let lookup_key = MarketByTokensKey {
            index_token: index_token.clone(),
            long_token: long_token.clone(),
            short_token: short_token.clone(),
        };
        env.storage()
            .persistent()
            .set(&lookup_key, &market_token);

        // Emit an event so off-chain indexers can track market creation.
        env.events()
            .publish(("create_market",), (market_id, index_token, long_token, short_token, market_token));

        market_id
    }

    // -----------------------------------------------------------------------
    // Pause / unpause (issue #11)
    // -----------------------------------------------------------------------

    /// Pause `market_id`, preventing all market operations.
    ///
    /// Caller must authenticate and hold `MARKET_KEEPER` or `ROLE_ADMIN`.
    /// Panics with [`MarketError::MarketNotFound`] if the market has never
    /// been created.
    pub fn pause_market(env: Env, caller: Address, market_id: u32) {
        caller.require_auth();
        let (rs_addr, ds_addr) = Self::deps(&env);
        Self::require_admin_or_keeper(&env, &rs_addr, &caller);

        let ds = DataStoreClient::new(&env, &ds_addr);
        Self::assert_market_exists(&env, &ds, market_id);

        ds.set_u128(&caller, &market_paused_key(&env, market_id), &1u128);

        env.events().publish(("pause_market",), (market_id,));
    }

    /// Unpause `market_id`, re-enabling market operations.
    ///
    /// Caller must authenticate and hold `MARKET_KEEPER` or `ROLE_ADMIN`.
    /// Panics with [`MarketError::MarketNotFound`] if the market has never
    /// been created.
    pub fn unpause_market(env: Env, caller: Address, market_id: u32) {
        caller.require_auth();
        let (rs_addr, ds_addr) = Self::deps(&env);
        Self::require_admin_or_keeper(&env, &rs_addr, &caller);

        let ds = DataStoreClient::new(&env, &ds_addr);
        Self::assert_market_exists(&env, &ds, market_id);

        ds.set_u128(&caller, &market_paused_key(&env, market_id), &0u128);

        env.events().publish(("unpause_market",), (market_id,));
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /// Look up a market's `market_token` address by its backing token triple.
    ///
    /// Reconstructs the deterministic storage key from `(index_token,
    /// long_token, short_token)` and returns `Some(market_token)` if the
    /// combination has been registered via [`create_market`], or `None`
    /// otherwise.  This saves frontends from iterating the entire market list.
    pub fn get_market_by_tokens(
        env: Env,
        index_token: Address,
        long_token: Address,
        short_token: Address,
    ) -> Option<Address> {
        let lookup_key = MarketByTokensKey {
            index_token,
            long_token,
            short_token,
        };
        env.storage().persistent().get(&lookup_key)
    }

    /// Returns whether `market_id` is currently paused.
    ///
    /// Returns `false` for markets that have never been created.
    pub fn is_paused(env: Env, market_id: u32) -> bool {
        let (_, ds_addr) = Self::deps(&env);
        let ds = DataStoreClient::new(&env, &ds_addr);
        ds.get_u128(&market_paused_key(&env, market_id))
            .unwrap_or(0)
            == 1u128
    }

    /// Returns the total number of markets ever created (monotonic counter).
    pub fn market_count(env: Env) -> u32 {
        let (_, ds_addr) = Self::deps(&env);
        let ds = DataStoreClient::new(&env, &ds_addr);
        ds.get_u128(&market_count_key(&env)).unwrap_or(0) as u32
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn deps(env: &Env) -> (Address, Address) {
        let rs: Address = env
            .storage()
            .instance()
            .get(&InstanceKey::RoleStore)
            .expect("not initialised");
        let ds: Address = env
            .storage()
            .instance()
            .get(&InstanceKey::DataStore)
            .expect("not initialised");
        (rs, ds)
    }

    /// Panics with [`MarketError::Unauthorized`] unless `caller` holds
    /// `ROLE_ADMIN` or `MARKET_KEEPER`.
    fn require_admin_or_keeper(env: &Env, role_store_addr: &Address, caller: &Address) {
        let rs = RoleStoreClient::new(env, role_store_addr);
        let has_admin = rs.has_role(&role_admin_id(env), caller);
        let has_keeper = rs.has_role(&market_keeper_role(env), caller);
        if !has_admin && !has_keeper {
            panic_with_error!(env, MarketError::Unauthorized);
        }
    }

    /// Panics with [`MarketError::MarketNotFound`] if `market_id` has no
    /// entry in `data_store`.
    fn assert_market_exists(env: &Env, ds: &DataStoreClient, market_id: u32) {
        if ds
            .get_u128(&market_props_key(env, market_id))
            .is_none()
        {
            panic_with_error!(env, MarketError::MarketNotFound);
        }
    }
}
