#![cfg(test)]

use contracts::{
    data_store::{DataStore, DataStoreClient},
    liquidity_handler::{LiquidityHandler, LiquidityHandlerClient},
    role_store::{RoleStore, RoleStoreClient},
    router::{Router, RouterClient},
    types::RouterAction,
};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, IntoVal,
};

const MARKET: u32 = 1;

fn setup(
    env: &Env,
) -> (
    RouterClient<'_>,
    LiquidityHandlerClient<'_>,
    Address,
    Address,
    Address,
) {
    let rs_addr = env.register(RoleStore, ());
    let ds_addr = env.register(DataStore, ());
    let lh_addr = env.register(LiquidityHandler, ());
    let r_addr = env.register(Router, ());

    let rs = RoleStoreClient::new(env, &rs_addr);
    let ds = DataStoreClient::new(env, &ds_addr);
    let lh = LiquidityHandlerClient::new(env, &lh_addr);
    let r = RouterClient::new(env, &r_addr);

    let admin = Address::generate(env);
    rs.initialize(&admin);
    ds.initialize(&admin);
    lh.initialize(&rs_addr, &ds_addr);
    r.initialize(&lh_addr);

    // Register a market
    let long = env.register_stellar_asset_contract(admin.clone());
    let short = env.register_stellar_asset_contract(admin.clone());
    lh.register_market(&admin, &MARKET, &long, &short);
    lh.set_oracle_prices(&admin, &MARKET, &100u128, &100u128);

    (r, lh, long, short, admin)
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    let client = StellarAssetClient::new(env, token);
    client.mint(to, &amount);
}

#[test]
fn test_multicall_3_actions_success() {
    let env = Env::default();
    env.mock_all_auths();
    let (r, lh, long, _short, _admin) = setup(&env);

    let user = Address::generate(&env);
    mint(&env, &long, &user, 1000);

    let receiver = Address::generate(&env);
    let long_tok = TokenClient::new(&env, &long);

    // 3-action multicall: SendTokens → CreateDeposit → CreateOrder (placeholder)
    let actions = vec![
        &env,
        RouterAction::SendTokens(long.clone(), receiver.clone(), 100),
        RouterAction::CreateDeposit(MARKET, 200, 0, user.clone()),
        RouterAction::CreateOrder(MARKET, 1000, true),
    ];

    r.multicall(&user, &actions);

    // 1. Verify SendTokens
    assert_eq!(long_tok.balance(&receiver), 100);

    // 2. Verify CreateDeposit
    // 200 tokens * 100 price = 20000 LP (since it's the first deposit)
    assert_eq!(lh.lp_balance_of(&MARKET, &user), 20000u128);

    // 3. Verify user balance
    // 1000 - 100 (sent) - 200 (deposited) = 700
    assert_eq!(long_tok.balance(&user), 700);
}

#[test]
fn test_multicall_atomicity_reverts_entirely() {
    let env = Env::default();
    env.mock_all_auths();
    let (r, lh, long, _short, _admin) = setup(&env);

    let user = Address::generate(&env);
    mint(&env, &long, &user, 1000);

    let receiver = Address::generate(&env);
    let long_tok = TokenClient::new(&env, &long);

    // Action 1: Send tokens (should succeed if executed alone)
    // Action 2: CreateDeposit with 0 amounts (deliberate failure: panics with LiquidityError::ZeroAmount)
    // Action 3: Send more tokens
    let actions = vec![
        &env,
        RouterAction::SendTokens(long.clone(), receiver.clone(), 100),
        RouterAction::CreateDeposit(MARKET, 0, 0, user.clone()),
        RouterAction::SendTokens(long.clone(), receiver.clone(), 50),
    ];

    // Try invoke multicall; it should fail.
    let result = env.try_invoke_contract::<(), soroban_sdk::Error>(
        &r.address,
        &soroban_sdk::Symbol::new(&env, "multicall"),
        vec![&env, user.clone().into_val(&env), actions.into_val(&env)],
    );

    assert!(result.is_err(), "multicall should have failed");

    // Verify atomicity: Action 1 must have been rolled back.
    assert_eq!(
        long_tok.balance(&receiver),
        0,
        "Action 1 should be rolled back"
    );
    assert_eq!(
        long_tok.balance(&user),
        1000,
        "User balance should be restored"
    );
    assert_eq!(
        lh.lp_balance_of(&MARKET, &user),
        0,
        "No LP should have been minted"
    );
}
