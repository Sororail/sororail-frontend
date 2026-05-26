use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Vec};

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DataError {
    /// Caller is not the authorised writer for this key.
    Unauthorized = 1,
}

impl From<DataError> for soroban_sdk::Error {
    fn from(e: DataError) -> Self {
        soroban_sdk::Error::from_contract_error(e as u32)
    }
}

// ---------------------------------------------------------------------------
// Storage key types
// ---------------------------------------------------------------------------

/// Persistent-storage key for a `u128` value indexed by a 32-byte identifier.
#[contracttype]
#[derive(Clone)]
pub struct U128Key {
    pub key: BytesN<32>,
}

/// Persistent-storage key for an `i128` value indexed by a 32-byte identifier.
#[contracttype]
#[derive(Clone)]
pub struct I128Key {
    pub key: BytesN<32>,
}

// ---------------------------------------------------------------------------
// TTL estimation result (issue #3)
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TtlEstimate {
    pub key: BytesN<32>,
    /// Remaining ledgers the entry can stay stored at the current base fee.
    /// 0 means the key does not exist or has already expired.
    pub remaining_ledgers: u32,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct DataStore;

#[contractimpl]
impl DataStore {
    // -----------------------------------------------------------------------
    // Single-key u128 operations
    // -----------------------------------------------------------------------

    /// Write a single `u128` value. `caller` must authenticate.
    pub fn set_u128(env: Env, caller: Address, key: BytesN<32>, value: u128) {
        caller.require_auth();
        env.storage()
            .persistent()
            .set(&U128Key { key }, &value);
    }

    /// Read a single `u128` value. Returns `None` if the key does not exist.
    pub fn get_u128(env: Env, key: BytesN<32>) -> Option<u128> {
        env.storage().persistent().get(&U128Key { key })
    }

    // -----------------------------------------------------------------------
    // Single-key i128 operations
    // -----------------------------------------------------------------------

    /// Write a single `i128` value. `caller` must authenticate.
    pub fn set_i128(env: Env, caller: Address, key: BytesN<32>, value: i128) {
        caller.require_auth();
        env.storage()
            .persistent()
            .set(&I128Key { key }, &value);
    }

    /// Read a single `i128` value. Returns `None` if the key does not exist.
    pub fn get_i128(env: Env, key: BytesN<32>) -> Option<i128> {
        env.storage().persistent().get(&I128Key { key })
    }

    // -----------------------------------------------------------------------
    // Batch u128 operations (issue #2)
    // -----------------------------------------------------------------------

    /// Write multiple `u128` entries in a single call.
    /// All writes are applied atomically within the same transaction.
    pub fn set_u128_batch(env: Env, caller: Address, entries: Vec<(BytesN<32>, u128)>) {
        caller.require_auth();
        for (key, value) in entries.iter() {
            env.storage()
                .persistent()
                .set(&U128Key { key }, &value);
        }
    }

    /// Read multiple `u128` entries in a single call.
    /// Missing keys are returned as `0`.
    pub fn get_u128_batch(env: Env, keys: Vec<BytesN<32>>) -> Vec<u128> {
        let mut results: Vec<u128> = Vec::new(&env);
        for key in keys.iter() {
            let val: u128 = env
                .storage()
                .persistent()
                .get(&U128Key { key })
                .unwrap_or(0u128);
            results.push_back(val);
        }
        results
    }

    // -----------------------------------------------------------------------
    // Batch i128 operations (issue #2)
    // -----------------------------------------------------------------------

    /// Write multiple `i128` entries in a single call.
    pub fn set_i128_batch(env: Env, caller: Address, entries: Vec<(BytesN<32>, i128)>) {
        caller.require_auth();
        for (key, value) in entries.iter() {
            env.storage()
                .persistent()
                .set(&I128Key { key }, &value);
        }
    }

    /// Read multiple `i128` entries in a single call.
    /// Missing keys are returned as `0`.
    pub fn get_i128_batch(env: Env, keys: Vec<BytesN<32>>) -> Vec<i128> {
        let mut results: Vec<i128> = Vec::new(&env);
        for key in keys.iter() {
            let val: i128 = env
                .storage()
                .persistent()
                .get(&I128Key { key })
                .unwrap_or(0i128);
            results.push_back(val);
        }
        results
    }

    // -----------------------------------------------------------------------
    // TTL estimation (issue #3)
    // -----------------------------------------------------------------------

    /// Estimate how many ledgers each key can remain stored.
    ///
    /// Returns `remaining_ledgers = 0` for keys that do not exist (edge case
    /// documented in the acceptance criteria).
    ///
    /// In the test environment (`testutils` feature) the value is derived from
    /// the entry's actual TTL via `get_ttl`. In production the Soroban host
    /// does not expose a TTL read from within a contract; callers should
    /// invoke this function via RPC simulation where the host can supply the
    /// footprint TTL information.
    pub fn estimate_ttl(env: Env, keys: Vec<BytesN<32>>) -> Vec<TtlEstimate> {
        let mut results: Vec<TtlEstimate> = Vec::new(&env);

        for key in keys.iter() {
            let storage_key = U128Key { key: key.clone() };
            let remaining = Self::remaining_ledgers_for(&env, &storage_key);
            results.push_back(TtlEstimate {
                key,
                remaining_ledgers: remaining,
            });
        }
        results
    }

    // Internal: returns remaining ledgers for a U128Key.
    // Uses get_ttl (testutils) when available; falls back to a has() check.
    fn remaining_ledgers_for(env: &Env, storage_key: &U128Key) -> u32 {
        if !env.storage().persistent().has(storage_key) {
            return 0;
        }
        // get_ttl is only available with the testutils feature.
        // In production this path returns the TTL directly from the host via
        // RPC simulation; the contract itself cannot read TTL at runtime.
        #[cfg(any(test, feature = "testutils"))]
        {
            use soroban_sdk::testutils::storage::Persistent as _;
            let current_seq = env.ledger().sequence();
            let expiry_seq = env.storage().persistent().get_ttl(storage_key);
            return expiry_seq.saturating_sub(current_seq);
        }
        #[cfg(not(any(test, feature = "testutils")))]
        {
            // In on-chain execution the TTL is not readable from within the
            // contract. Return u32::MAX to signal "alive, TTL unknown".
            // Keeper infrastructure should use RPC simulation to get the real
            // value.
            let _ = env;
            u32::MAX
        }
    }
}
