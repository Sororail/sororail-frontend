#![cfg(test)]

use contracts::insurance_fund::{InsuranceFund, InsuranceFundClient};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

fn setup(env: &Env) -> (InsuranceFundClient<'_>, Address, Address) {
    env.mock_all_auths();

    let admin = Address::generate(env);
    let liquidation_handler = Address::generate(env);

    let fund_id = env.register(InsuranceFund, ());
    let fund = InsuranceFundClient::new(env, &fund_id);
    fund.initialize(&admin, &liquidation_handler);

    (fund, admin, liquidation_handler)
}

fn make_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

// ---------------------------------------------------------------------------
// record_bad_debt
// ---------------------------------------------------------------------------

#[test]
fn test_record_bad_debt_increments_balance() {
    let env = Env::default();
    let (fund, _, lh) = setup(&env);

    fund.record_bad_debt(&lh, &1, &500);
    assert_eq!(fund.get_bad_debt(&1), 500);
}

#[test]
fn test_record_bad_debt_accumulates_across_calls() {
    let env = Env::default();
    let (fund, _, lh) = setup(&env);

    fund.record_bad_debt(&lh, &1, &300);
    fund.record_bad_debt(&lh, &1, &200);
    assert_eq!(fund.get_bad_debt(&1), 500);
}

#[test]
fn test_record_bad_debt_is_per_market() {
    let env = Env::default();
    let (fund, _, lh) = setup(&env);

    fund.record_bad_debt(&lh, &1, &100);
    fund.record_bad_debt(&lh, &2, &400);
    assert_eq!(fund.get_bad_debt(&1), 100);
    assert_eq!(fund.get_bad_debt(&2), 400);
}

#[test]
#[should_panic]
fn test_record_bad_debt_non_liquidation_handler_is_rejected() {
    let env = Env::default();
    let (fund, _, _) = setup(&env);

    let stranger = Address::generate(&env);
    fund.record_bad_debt(&stranger, &1, &100);
}

// ---------------------------------------------------------------------------
// replenish
// ---------------------------------------------------------------------------

#[test]
fn test_replenish_decrements_bad_debt() {
    let env = Env::default();
    let (fund, admin, lh) = setup(&env);

    let token = make_token(&env, &admin);
    StellarAssetClient::new(&env, &token).mint(&admin, &1_000);

    fund.record_bad_debt(&lh, &1, &500);
    fund.replenish(&admin, &1, &token, &300);

    assert_eq!(fund.get_bad_debt(&1), 200);
    assert_eq!(TokenClient::new(&env, &token).balance(&admin), 700);
}

#[test]
fn test_replenish_saturates_at_zero() {
    let env = Env::default();
    let (fund, admin, lh) = setup(&env);

    let token = make_token(&env, &admin);
    StellarAssetClient::new(&env, &token).mint(&admin, &1_000);

    fund.record_bad_debt(&lh, &1, &100);
    // Replenishing more than the outstanding debt clamps to zero.
    fund.replenish(&admin, &1, &token, &500);

    assert_eq!(fund.get_bad_debt(&1), 0);
}

#[test]
#[should_panic]
fn test_replenish_non_admin_is_rejected() {
    let env = Env::default();
    let (fund, admin, _) = setup(&env);

    let token = make_token(&env, &admin);
    StellarAssetClient::new(&env, &token).mint(&admin, &1_000);

    let stranger = Address::generate(&env);
    fund.replenish(&stranger, &1, &token, &100);
}

// ---------------------------------------------------------------------------
// get_bad_debt
// ---------------------------------------------------------------------------

#[test]
fn test_get_bad_debt_returns_zero_for_unknown_market() {
    let env = Env::default();
    let (fund, _, _) = setup(&env);
    assert_eq!(fund.get_bad_debt(&99), 0);
}
