use soroban_sdk::{BytesN, Env};

// ---------------------------------------------------------------------------
// Market key generators
// ---------------------------------------------------------------------------

/// Returns the data-store key that holds the config for `market_id`.
pub fn market_props_key(env: &Env, market_id: u32) -> BytesN<32> {
    let mut buf = [0u8; 32];
    buf[..6].copy_from_slice(b"mprops");
    let id_bytes = market_id.to_be_bytes();
    buf[6..10].copy_from_slice(&id_bytes);
    BytesN::from_array(env, &buf)
}

/// Returns the data-store key for the long-token address of `market_id`.
pub fn market_long_token_key(env: &Env, market_id: u32) -> BytesN<32> {
    let mut buf = [0u8; 32];
    buf[..8].copy_from_slice(b"mlt_addr");
    let id_bytes = market_id.to_be_bytes();
    buf[8..12].copy_from_slice(&id_bytes);
    BytesN::from_array(env, &buf)
}

/// Returns the data-store key for the short-token address of `market_id`.
pub fn market_short_token_key(env: &Env, market_id: u32) -> BytesN<32> {
    let mut buf = [0u8; 32];
    buf[..8].copy_from_slice(b"mst_addr");
    let id_bytes = market_id.to_be_bytes();
    buf[8..12].copy_from_slice(&id_bytes);
    BytesN::from_array(env, &buf)
}

/// Returns the data-store key for the market-token address of `market_id`.
pub fn market_token_key(env: &Env, market_id: u32) -> BytesN<32> {
    let mut buf = [0u8; 32];
    buf[..7].copy_from_slice(b"mtkaddr");
    let id_bytes = market_id.to_be_bytes();
    buf[7..11].copy_from_slice(&id_bytes);
    BytesN::from_array(env, &buf)
}

/// Returns the data-store key that holds a `u128` flag (1 = paused) for
/// `market_id`.  Used by issue #11 pause/unpause logic.
pub fn market_paused_key(env: &Env, market_id: u32) -> BytesN<32> {
    let mut buf = [0u8; 32];
    buf[..8].copy_from_slice(b"mpaused_");
    let id_bytes = market_id.to_be_bytes();
    buf[8..12].copy_from_slice(&id_bytes);
    BytesN::from_array(env, &buf)
}

/// Returns the data-store key holding the total number of markets ever created
/// (monotonically increasing counter).
pub fn market_count_key(env: &Env) -> BytesN<32> {
    let mut buf = [0u8; 32];
    buf[..9].copy_from_slice(b"mkt_count");
    BytesN::from_array(env, &buf)
}
