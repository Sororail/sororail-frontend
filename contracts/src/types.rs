use soroban_sdk::{contracttype, Address};

// ---------------------------------------------------------------------------
// Market errors
// ---------------------------------------------------------------------------

/// Errors returned by the `market_factory` contract.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MarketError {
    /// Caller does not hold the required role.
    Unauthorized = 1,
    /// The requested market does not exist.
    MarketNotFound = 2,
    /// The market is currently paused; the operation is not permitted.
    MarketPaused = 3,
    /// The market already exists and cannot be created again.
    MarketAlreadyExists = 4,
}

impl From<MarketError> for soroban_sdk::Error {
    fn from(e: MarketError) -> Self {
        soroban_sdk::Error::from_contract_error(e as u32)
    }
}

// ---------------------------------------------------------------------------
// Market configuration
// ---------------------------------------------------------------------------

/// Optional configuration supplied when creating a new market.
///
/// All fields have sensible defaults when `None` is passed to `create_market`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketConfig {
    /// Maximum open interest allowed on the long side (u128 units).
    /// Defaults to `u128::MAX` when not provided.
    pub max_long_open_interest: u128,
    /// Maximum open interest allowed on the short side (u128 units).
    /// Defaults to `u128::MAX` when not provided.
    pub max_short_open_interest: u128,
}

// ---------------------------------------------------------------------------
// Market properties (on-chain record)
// ---------------------------------------------------------------------------

/// Full on-chain record for a created market.
///
/// Written to `data_store` at market creation time and updated as the market
/// lifecycle progresses.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketProps {
    /// Unique numeric identifier assigned at creation time.
    pub market_id: u32,
    /// The Soroban token contract address used for long positions.
    pub long_token: Address,
    /// The Soroban token contract address used for short positions.
    pub short_token: Address,
    /// The market LP / receipt token contract address.
    pub market_token: Address,
    /// Maximum open interest for the long side.
    pub max_long_open_interest: u128,
    /// Maximum open interest for the short side.
    pub max_short_open_interest: u128,
    /// Whether the market is currently paused.
    pub is_paused: bool,
}
