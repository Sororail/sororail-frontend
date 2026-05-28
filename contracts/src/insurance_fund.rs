//! Insurance fund contract — tracks per-market bad debt and accepts governance
//! replenishment deposits to offset it.

use soroban_sdk::{contract, contractimpl, contracttype, panic_with_error, token, Address, Env};

use crate::types::InsuranceFundError;

#[contract]
pub struct InsuranceFund;

#[contracttype]
enum InsuranceFundKey {
    /// Address authorised to call `record_bad_debt` (the liquidation handler).
    LiquidationHandler,
    /// Address authorised to call `replenish` (governance / admin).
    Admin,
    /// Accumulated bad debt for a specific market, stored as `u128`.
    BadDebt(u32),
}

#[contractimpl]
impl InsuranceFund {
    pub fn initialize(env: Env, admin: Address, liquidation_handler: Address) {
        if env.storage().instance().has(&InsuranceFundKey::Admin) {
            panic!("already initialised");
        }
        env.storage()
            .instance()
            .set(&InsuranceFundKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&InsuranceFundKey::LiquidationHandler, &liquidation_handler);
    }

    /// Record `amount` of bad debt for `market_id`.
    /// Only the registered liquidation handler may call this.
    pub fn record_bad_debt(env: Env, caller: Address, market_id: u32, amount: u128) {
        caller.require_auth();
        let handler: Address = env
            .storage()
            .instance()
            .get(&InsuranceFundKey::LiquidationHandler)
            .expect("not initialised");
        if caller != handler {
            panic_with_error!(&env, InsuranceFundError::Unauthorized);
        }

        let key = InsuranceFundKey::BadDebt(market_id);
        let current: u128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&key, &current.saturating_add(amount));

        env.events().publish(
            ("bad_debt_recorded",),
            (market_id, amount, current.saturating_add(amount)),
        );
    }

    /// Deposit `amount` of `token` from `caller` (admin/governance) and
    /// decrement the bad debt balance for `market_id` by the same amount.
    pub fn replenish(env: Env, caller: Address, market_id: u32, token: Address, amount: u128) {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&InsuranceFundKey::Admin)
            .expect("not initialised");
        if caller != admin {
            panic_with_error!(&env, InsuranceFundError::Unauthorized);
        }

        token::TokenClient::new(&env, &token).transfer(
            &caller,
            &env.current_contract_address(),
            &(amount as i128),
        );

        let key = InsuranceFundKey::BadDebt(market_id);
        let current: u128 = env.storage().persistent().get(&key).unwrap_or(0);
        let new_balance = current.saturating_sub(amount);
        env.storage().persistent().set(&key, &new_balance);

        env.events()
            .publish(("replenished",), (market_id, amount, new_balance));
    }

    /// Return the accumulated bad debt for `market_id`.
    pub fn get_bad_debt(env: Env, market_id: u32) -> u128 {
        env.storage()
            .persistent()
            .get(&InsuranceFundKey::BadDebt(market_id))
            .unwrap_or(0)
    }
}
