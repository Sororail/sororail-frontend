//! Tests for reader::get_execution_price (issue #75).

#![cfg(test)]

use contracts::{
    data_store::{DataStore, DataStoreClient},
    keys::{
        impact_pool_amount_key, open_interest_long_key, open_interest_short_key,
        price_impact_exponent_factor_key, price_impact_factor_key,
    },
    liquidity_handler::{LiquidityHandler, LiquidityHandlerClient},
    reader::{Reader, ReaderClient},
    role_store::{RoleStore, RoleStoreClient},
    types::PositionProps,
};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

fn make_key(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

fn zero_code(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn setup(
    env: &Env,
) -> (
    ReaderClient<'_>,
    DataStoreClient<'_>,
    LiquidityHandlerClient<'_>,
    Address,
) {
    env.mock_all_auths();

    let rs_id = env.register(RoleStore, ());
    let admin = Address::generate(env);
    RoleStoreClient::new(env, &rs_id).initialize(&admin);

    let ds_id = env.register(DataStore, ());
    let ds = DataStoreClient::new(env, &ds_id);
    ds.initialize(&admin);

    let lh_id = env.register(LiquidityHandler, ());
    let lh = LiquidityHandlerClient::new(env, &lh_id);
    lh.initialize(&rs_id, &ds_id);

    let reader_id = env.register(Reader, ());
    let reader = ReaderClient::new(env, &reader_id);
    reader.initialize(&ds_id, &lh_id);

    (reader, ds, lh, admin)
}

#[test]
fn test_get_execution_price_known_oi_state() {
    let env = Env::default();
    let (reader, ds, lh, admin) = setup(&env);

    let market_id: u32 = 7;
    let key = make_key(&env, 42);
    ds.set_position_props(
        &admin,
        &key,
        &PositionProps {
            position_key: key.clone(),
            account: Address::generate(&env),
            market_id,
            quantity: 10_000,
            collateral_amount: 1_000,
            average_price: 100,
            is_long: true,
            is_open: true,
            referral_code: zero_code(&env),
        },
    );

    lh.set_oracle_prices(&admin, &market_id, &100, &100);
    ds.set_u128(&admin, &open_interest_long_key(&env, market_id), &8_000);
    ds.set_u128(&admin, &open_interest_short_key(&env, market_id), &2_000);
    ds.set_u128(&admin, &price_impact_factor_key(&env, market_id), &100_000);

    let result = reader.get_execution_price(&key, &1_000, &true);
    assert_eq!(result.price_without_impact, 100);
    assert_eq!(result.price_with_impact, 106);
}

#[test]
fn test_get_execution_price_balanced_oi_no_impact() {
    let env = Env::default();
    let (reader, ds, lh, admin) = setup(&env);

    let market_id: u32 = 8;
    let key = make_key(&env, 1);
    ds.set_position_props(
        &admin,
        &key,
        &PositionProps {
            position_key: key.clone(),
            account: Address::generate(&env),
            market_id,
            quantity: 5_000,
            collateral_amount: 500,
            average_price: 200,
            is_long: false,
            is_open: true,
            referral_code: zero_code(&env),
        },
    );

    lh.set_oracle_prices(&admin, &market_id, &200, &200);
    ds.set_u128(&admin, &open_interest_long_key(&env, market_id), &5_000);
    ds.set_u128(&admin, &open_interest_short_key(&env, market_id), &5_000);
    ds.set_u128(&admin, &price_impact_factor_key(&env, market_id), &100_000);

    let result = reader.get_execution_price(&key, &2_000, &true);
    assert_eq!(result.price_without_impact, 200);
    assert_eq!(result.price_with_impact, 200);
}

#[test]
fn test_get_execution_price_squared_exponent() {
    let env = Env::default();
    let (reader, ds, lh, admin) = setup(&env);

    let market_id: u32 = 9;
    let key = make_key(&env, 99);
    ds.set_position_props(
        &admin,
        &key,
        &PositionProps {
            position_key: key.clone(),
            account: Address::generate(&env),
            market_id,
            quantity: 10_000,
            collateral_amount: 1_000,
            average_price: 100,
            is_long: true,
            is_open: true,
            referral_code: zero_code(&env),
        },
    );

    lh.set_oracle_prices(&admin, &market_id, &100, &100);
    ds.set_u128(&admin, &open_interest_long_key(&env, market_id), &8_000);
    ds.set_u128(&admin, &open_interest_short_key(&env, market_id), &2_000);
    ds.set_u128(&admin, &price_impact_factor_key(&env, market_id), &100_000);
    // ratio=0.6, squared -> 0.36; impact = 100 * 0.1 * 0.36 = 3 (floored).
    ds.set_u128(
        &admin,
        &price_impact_exponent_factor_key(&env, market_id),
        &2_000_000,
    );

    let result = reader.get_execution_price(&key, &1_000, &true);
    assert_eq!(result.price_without_impact, 100);
    assert_eq!(result.price_with_impact, 103);
}

#[test]
fn test_get_execution_price_favorable_impact_paid_from_pool() {
    let env = Env::default();
    let (reader, ds, lh, admin) = setup(&env);

    let market_id: u32 = 10;
    let key = make_key(&env, 100);
    ds.set_position_props(
        &admin,
        &key,
        &PositionProps {
            position_key: key.clone(),
            account: Address::generate(&env),
            market_id,
            quantity: 10_000,
            collateral_amount: 1_000,
            average_price: 100,
            is_long: true,
            is_open: true,
            referral_code: zero_code(&env),
        },
    );

    lh.set_oracle_prices(&admin, &market_id, &100, &100);
    ds.set_u128(&admin, &open_interest_long_key(&env, market_id), &8_000);
    ds.set_u128(&admin, &open_interest_short_key(&env, market_id), &2_000);
    ds.set_u128(&admin, &price_impact_factor_key(&env, market_id), &100_000);
    // Closing a long while longs dominate improves the imbalance; the funded
    // impact pool pays the 6-unit favorable impact, raising the exit price.
    ds.set_u128(&admin, &impact_pool_amount_key(&env, market_id), &10);

    let result = reader.get_execution_price(&key, &1_000, &false);
    assert_eq!(result.price_without_impact, 100);
    assert_eq!(result.price_with_impact, 106);
}
