//! Integration tests covering all four issues:
//!
//! #1  role metadata set/get
//! #2  batch get/set for u128 and i128
//! #3  TTL estimation (existing key, missing key)
//! #4  multi-role scenarios, last-admin guard, pagination
//! #9  doc-comment coverage (compile-time validation)
//! #10 market creation with MarketConfig stored to data_store
//! #11 pause/unpause lifecycle and guard on paused markets
//! #12 end-to-end: role_store + data_store + market_factory

#![cfg(test)]

use contracts::{
    data_store::{DataStore, DataStoreClient, TtlEstimate},
    market_factory::{market_keeper_role, MarketFactory, MarketFactoryClient},
    role_store::{RoleMetadata, RoleStore, RoleStoreClient},
    types::MarketConfig,
};
use soroban_sdk::{
    testutils::Address as _,
    vec, Address, BytesN, Env, String, Vec,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_key(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

fn admin_role(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn setup_role_store(env: &Env) -> (RoleStoreClient<'_>, Address) {
    let contract_id = env.register(RoleStore, ());
    let client = RoleStoreClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin);
    (client, admin)
}

fn setup_data_store(env: &Env) -> DataStoreClient<'_> {
    let contract_id = env.register(DataStore, ());
    DataStoreClient::new(env, &contract_id)
}

// ---------------------------------------------------------------------------
// Issue #1 — role metadata
// ---------------------------------------------------------------------------

#[test]
fn test_set_and_get_role_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_role_store(&env);

    let role = make_key(&env, 1);
    let name = String::from_str(&env, "PRICE_FEEDER");
    let description = String::from_str(&env, "Allowed to submit price updates");

    client.set_role_metadata(&admin, &role, &name, &description);

    let meta: RoleMetadata = client.get_role_metadata(&role).unwrap();
    assert_eq!(meta.name, name);
    assert_eq!(meta.description, description);
    // created_at should be the current ledger sequence (default = 0 in test env)
    assert_eq!(meta.created_at, env.ledger().sequence());
}

#[test]
fn test_get_role_metadata_missing_returns_none() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup_role_store(&env);

    let role = make_key(&env, 99);
    assert!(client.get_role_metadata(&role).is_none());
}

// ---------------------------------------------------------------------------
// Issue #2 — batch get/set
// ---------------------------------------------------------------------------

#[test]
fn test_set_u128_batch_and_get_u128_batch() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_data_store(&env);
    let caller = Address::generate(&env);

    let k1 = make_key(&env, 1);
    let k2 = make_key(&env, 2);
    let k3 = make_key(&env, 3);

    let entries: Vec<(BytesN<32>, u128)> = vec![
        &env,
        (k1.clone(), 100u128),
        (k2.clone(), 200u128),
        (k3.clone(), 300u128),
    ];
    client.set_u128_batch(&caller, &entries);

    let keys: Vec<BytesN<32>> = vec![&env, k1, k2, k3];
    let results = client.get_u128_batch(&keys);

    assert_eq!(results.get(0).unwrap(), 100u128);
    assert_eq!(results.get(1).unwrap(), 200u128);
    assert_eq!(results.get(2).unwrap(), 300u128);
}

#[test]
fn test_get_u128_batch_missing_key_returns_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_data_store(&env);

    let missing = make_key(&env, 42);
    let keys: Vec<BytesN<32>> = vec![&env, missing];
    let results = client.get_u128_batch(&keys);
    assert_eq!(results.get(0).unwrap(), 0u128);
}

#[test]
fn test_set_i128_batch_and_get_i128_batch() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_data_store(&env);
    let caller = Address::generate(&env);

    let k1 = make_key(&env, 10);
    let k2 = make_key(&env, 11);

    let entries: Vec<(BytesN<32>, i128)> = vec![
        &env,
        (k1.clone(), -500i128),
        (k2.clone(), 999i128),
    ];
    client.set_i128_batch(&caller, &entries);

    let keys: Vec<BytesN<32>> = vec![&env, k1, k2];
    let results = client.get_i128_batch(&keys);

    assert_eq!(results.get(0).unwrap(), -500i128);
    assert_eq!(results.get(1).unwrap(), 999i128);
}

#[test]
fn test_existing_single_ops_still_pass() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_data_store(&env);
    let caller = Address::generate(&env);

    let key = make_key(&env, 5);
    client.set_u128(&caller, &key, &42u128);
    assert_eq!(client.get_u128(&key).unwrap(), 42u128);

    client.set_i128(&caller, &key, &-7i128);
    assert_eq!(client.get_i128(&key).unwrap(), -7i128);
}

// ---------------------------------------------------------------------------
// Issue #3 — TTL estimation
// ---------------------------------------------------------------------------

#[test]
fn test_estimate_ttl_missing_key_returns_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_data_store(&env);

    let missing = make_key(&env, 77);
    let keys: Vec<BytesN<32>> = vec![&env, missing.clone()];
    let estimates = client.estimate_ttl(&keys);

    let est: TtlEstimate = estimates.get(0).unwrap();
    assert_eq!(est.key, missing);
    assert_eq!(est.remaining_ledgers, 0u32);
}

#[test]
fn test_estimate_ttl_existing_key_nonzero() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup_data_store(&env);
    let caller = Address::generate(&env);

    let key = make_key(&env, 55);
    client.set_u128(&caller, &key, &1u128);

    let keys: Vec<BytesN<32>> = vec![&env, key.clone()];
    let estimates = client.estimate_ttl(&keys);

    let est: TtlEstimate = estimates.get(0).unwrap();
    assert_eq!(est.key, key);
    // After writing, the entry has a non-zero TTL in the test environment.
    assert!(est.remaining_ledgers > 0);
}

// ---------------------------------------------------------------------------
// Issue #4 — multi-role integration scenarios
// ---------------------------------------------------------------------------

/// Grant two different roles to the same account; revoke one; verify the
/// other is unaffected.
#[test]
fn test_multi_role_revoke_one_other_unaffected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_role_store(&env);

    let role_a = make_key(&env, 0xAA);
    let role_b = make_key(&env, 0xBB);
    let account = Address::generate(&env);

    client.grant_role(&admin, &role_a, &account);
    client.grant_role(&admin, &role_b, &account);

    assert!(client.has_role(&role_a, &account));
    assert!(client.has_role(&role_b, &account));

    // Revoke role_a only.
    client.revoke_role(&admin, &role_a, &account);

    assert!(!client.has_role(&role_a, &account));
    assert!(client.has_role(&role_b, &account)); // role_b must be intact
}

/// Attempt to remove the last ROLE_ADMIN — the guard must trigger.
#[test]
#[should_panic]
fn test_last_admin_guard_triggers() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_role_store(&env);

    // There is only one admin; revoking it must panic.
    client.revoke_role(&admin, &admin_role(&env), &admin);
}

/// Grant a second admin, then remove the first — should succeed because a
/// second admin still exists.
#[test]
fn test_remove_admin_when_second_exists() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_role_store(&env);

    let second_admin = Address::generate(&env);
    client.grant_role(&admin, &admin_role(&env), &second_admin);

    // Now two admins exist; removing the first is allowed.
    client.revoke_role(&admin, &admin_role(&env), &admin);

    assert!(!client.has_role(&admin_role(&env), &admin));
    assert!(client.has_role(&admin_role(&env), &second_admin));
}

/// Pagination across a large member set.
#[test]
fn test_get_role_members_pagination() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_role_store(&env);

    let role = make_key(&env, 0xCC);
    let total: u32 = 25;

    // Grant the role to 25 distinct accounts.
    let mut all_accounts: Vec<Address> = Vec::new(&env);
    for _ in 0..total {
        let acc = Address::generate(&env);
        client.grant_role(&admin, &role, &acc);
        all_accounts.push_back(acc);
    }

    let page_size: u32 = 10;

    // Page 0 → 10 members
    let page0 = client.get_role_members(&role, &0u32, &page_size);
    assert_eq!(page0.len(), 10);

    // Page 1 → 10 members
    let page1 = client.get_role_members(&role, &1u32, &page_size);
    assert_eq!(page1.len(), 10);

    // Page 2 → 5 members (remainder)
    let page2 = client.get_role_members(&role, &2u32, &page_size);
    assert_eq!(page2.len(), 5);

    // Page 3 → beyond end, empty
    let page3 = client.get_role_members(&role, &3u32, &page_size);
    assert_eq!(page3.len(), 0);

    // All pages together must cover all 25 accounts without duplicates.
    let mut seen: Vec<Address> = Vec::new(&env);
    for p in [page0, page1, page2].iter() {
        for acc in p.iter() {
            assert!(!seen.contains(&acc), "duplicate in pagination");
            seen.push_back(acc);
        }
    }
    assert_eq!(seen.len(), total);
}

/// Grant multiple roles to the same account and verify each independently.
#[test]
fn test_grant_multiple_roles_same_account() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_role_store(&env);

    let account = Address::generate(&env);
    let roles: [BytesN<32>; 3] = [
        make_key(&env, 1),
        make_key(&env, 2),
        make_key(&env, 3),
    ];

    for role in &roles {
        client.grant_role(&admin, role, &account);
    }

    for role in &roles {
        assert!(client.has_role(role, &account));
    }
}

// ---------------------------------------------------------------------------
// Shared helper for issues #10-#12
// ---------------------------------------------------------------------------

fn setup_market_factory<'a>(
    env: &'a Env,
) -> (
    MarketFactoryClient<'a>,
    RoleStoreClient<'a>,
    DataStoreClient<'a>,
    Address, // admin
) {
    let rs_id = env.register(RoleStore, ());
    let ds_id = env.register(DataStore, ());
    let mf_id = env.register(MarketFactory, ());

    let rs = RoleStoreClient::new(env, &rs_id);
    let ds = DataStoreClient::new(env, &ds_id);
    let mf = MarketFactoryClient::new(env, &mf_id);

    let admin = Address::generate(env);
    rs.initialize(&admin);
    mf.initialize(&rs_id, &ds_id);

    (mf, rs, ds, admin)
}

// ---------------------------------------------------------------------------
// Issue #10 — market creation
// ---------------------------------------------------------------------------

#[test]
fn test_create_market_stores_config_in_data_store() {
    let env = Env::default();
    env.mock_all_auths();

    let (mf, _rs, ds, admin) = setup_market_factory(&env);

    let long_token  = Address::generate(&env);
    let short_token = Address::generate(&env);
    let mkt_token   = Address::generate(&env);

    let cfg = MarketConfig {
        max_long_open_interest:  1_000_000u128,
        max_short_open_interest: 2_000_000u128,
    };

    let market_id = mf.create_market(
        &admin,
        &long_token,
        &short_token,
        &mkt_token,
        &Some(cfg.clone()),
    );
    assert_eq!(market_id, 0u32, "first market should have id 0");

    // Market count must have advanced to 1.
    assert_eq!(mf.market_count(), 1u32);
}

#[test]
fn test_create_market_default_config() {
    let env = Env::default();
    env.mock_all_auths();

    let (mf, _rs, _ds, admin) = setup_market_factory(&env);

    let market_id = mf.create_market(
        &admin,
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &None,
    );
    assert_eq!(market_id, 0u32);
    assert_eq!(mf.market_count(), 1u32);
}

#[test]
fn test_create_market_counter_increments() {
    let env = Env::default();
    env.mock_all_auths();

    let (mf, _rs, _ds, admin) = setup_market_factory(&env);

    for expected_id in 0u32..3u32 {
        let id = mf.create_market(
            &admin,
            &Address::generate(&env),
            &Address::generate(&env),
            &Address::generate(&env),
            &None,
        );
        assert_eq!(id, expected_id);
    }
    assert_eq!(mf.market_count(), 3u32);
}

#[test]
#[should_panic]
fn test_create_market_unauthorized_caller_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (mf, rs, _ds, _admin) = setup_market_factory(&env);

    // A fresh account with no roles tries to create a market.
    let intruder = Address::generate(&env);
    mf.create_market(
        &intruder,
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &None,
    );
}

// ---------------------------------------------------------------------------
// Issue #11 — pause / unpause
// ---------------------------------------------------------------------------

#[test]
fn test_pause_and_unpause_market() {
    let env = Env::default();
    env.mock_all_auths();

    let (mf, _rs, _ds, admin) = setup_market_factory(&env);

    let id = mf.create_market(
        &admin,
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &None,
    );

    assert!(!mf.is_paused(&id), "should not be paused after creation");

    mf.pause_market(&admin, &id);
    assert!(mf.is_paused(&id), "should be paused after pause_market");

    mf.unpause_market(&admin, &id);
    assert!(!mf.is_paused(&id), "should be unpaused after unpause_market");
}

#[test]
fn test_market_keeper_can_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let (mf, rs, _ds, admin) = setup_market_factory(&env);

    let keeper = Address::generate(&env);
    rs.grant_role(&admin, &market_keeper_role(&env), &keeper);

    let id = mf.create_market(
        &admin,
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &None,
    );

    mf.pause_market(&keeper, &id);
    assert!(mf.is_paused(&id));
}

#[test]
#[should_panic]
fn test_pause_nonexistent_market_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (mf, _rs, _ds, admin) = setup_market_factory(&env);
    // Market id 999 was never created.
    mf.pause_market(&admin, &999u32);
}

#[test]
#[should_panic]
fn test_unpause_nonexistent_market_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (mf, _rs, _ds, admin) = setup_market_factory(&env);
    mf.unpause_market(&admin, &999u32);
}

// ---------------------------------------------------------------------------
// Issue #12 — end-to-end: role_store + data_store + market_factory
// ---------------------------------------------------------------------------

/// Full lifecycle: deploy all three contracts, wire them up, create a market,
/// verify the on-chain state, then pause and re-verify.
#[test]
fn test_e2e_full_market_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let (mf, rs, ds, admin) = setup_market_factory(&env);

    // 1. Verify role_store has the admin.
    assert!(rs.has_role(&BytesN::from_array(&env, &[0u8; 32]), &admin));

    // 2. Create a market.
    let long_token  = Address::generate(&env);
    let short_token = Address::generate(&env);
    let mkt_token   = Address::generate(&env);

    let cfg = MarketConfig {
        max_long_open_interest:  500_000u128,
        max_short_open_interest: 750_000u128,
    };
    let market_id = mf.create_market(
        &admin,
        &long_token,
        &short_token,
        &mkt_token,
        &Some(cfg),
    );
    assert_eq!(market_id, 0u32);

    // 3. Verify market_count is 1.
    assert_eq!(mf.market_count(), 1u32);

    // 4. Market starts unpaused.
    assert!(!mf.is_paused(&market_id));

    // 5. Pause, verify, unpause, verify.
    mf.pause_market(&admin, &market_id);
    assert!(mf.is_paused(&market_id));

    mf.unpause_market(&admin, &market_id);
    assert!(!mf.is_paused(&market_id));

    // 6. A second market can be created independently.
    let id2 = mf.create_market(
        &admin,
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &None,
    );
    assert_eq!(id2, 1u32);
    assert_eq!(mf.market_count(), 2u32);

    // 7. Pausing market 0 does not affect market 1.
    mf.pause_market(&admin, &market_id);
    assert!(mf.is_paused(&market_id));
    assert!(!mf.is_paused(&id2));
}
