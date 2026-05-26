use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, Address, BytesN, Env, String, Vec,
};

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RoleError {
    /// Caller does not hold the required role.
    Unauthorized = 1,
    /// Attempt to remove the last ROLE_ADMIN holder.
    LastAdminGuard = 2,
    /// Requested page is out of range.
    PageOutOfRange = 3,
}

impl From<RoleError> for soroban_sdk::Error {
    fn from(e: RoleError) -> Self {
        soroban_sdk::Error::from_contract_error(e as u32)
    }
}

// ---------------------------------------------------------------------------
// Storage key types
// ---------------------------------------------------------------------------

/// Key for the set of members that hold a given role.
/// Stored as `Vec<Address>` in persistent storage.
#[contracttype]
#[derive(Clone)]
pub struct RoleMembersKey {
    pub role: BytesN<32>,
}

/// Key for the human-readable metadata attached to a role.
#[contracttype]
#[derive(Clone)]
pub struct RoleMetaKey {
    pub role: BytesN<32>,
}

// ---------------------------------------------------------------------------
// Metadata struct (issue #1)
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleMetadata {
    pub name: String,
    pub description: String,
    /// Ledger sequence number at which the metadata was first written.
    pub created_at: u32,
}

// ---------------------------------------------------------------------------
// Well-known role constant helper
// ---------------------------------------------------------------------------

/// Returns the canonical ROLE_ADMIN identifier (32 zero bytes).
/// Callers that need the admin role should use this value as the `role`
/// argument.
pub fn role_admin_id(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct RoleStore;

#[contractimpl]
impl RoleStore {
    // -----------------------------------------------------------------------
    // Bootstrap
    // -----------------------------------------------------------------------

    /// Initialise the contract by granting ROLE_ADMIN to `initial_admin`.
    /// Can only be called once (panics if already initialised).
    pub fn initialize(env: Env, initial_admin: Address) {
        let admin_role = role_admin_id(&env);
        let key = RoleMembersKey {
            role: admin_role.clone(),
        };
        if env
            .storage()
            .persistent()
            .has(&key)
        {
            panic!("already initialised");
        }
        let members: Vec<Address> = Vec::from_array(&env, [initial_admin]);
        env.storage().persistent().set(&key, &members);
    }

    // -----------------------------------------------------------------------
    // Role management
    // -----------------------------------------------------------------------

    /// Grant `role` to `account`. Caller must hold ROLE_ADMIN.
    pub fn grant_role(env: Env, caller: Address, role: BytesN<32>, account: Address) {
        caller.require_auth();
        Self::require_role(&env, &caller, &role_admin_id(&env));

        let key = RoleMembersKey { role };
        let mut members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        // Idempotent: only add if not already present.
        if !members.contains(&account) {
            members.push_back(account);
            env.storage().persistent().set(&key, &members);
        }
    }

    /// Revoke `role` from `account`. Caller must hold ROLE_ADMIN.
    /// Panics with `LastAdminGuard` if this would remove the last ROLE_ADMIN.
    pub fn revoke_role(env: Env, caller: Address, role: BytesN<32>, account: Address) {
        caller.require_auth();
        Self::require_role(&env, &caller, &role_admin_id(&env));

        let admin_role = role_admin_id(&env);
        let key = RoleMembersKey { role: role.clone() };
        let members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        // Guard: cannot remove the last ROLE_ADMIN.
        if role == admin_role && members.len() == 1 {
            panic_with_error!(&env, RoleError::LastAdminGuard);
        }

        let mut updated: Vec<Address> = Vec::new(&env);
        for m in members.iter() {
            if m != account {
                updated.push_back(m);
            }
        }
        env.storage().persistent().set(&key, &updated);
    }

    /// Returns `true` if `account` holds `role`.
    pub fn has_role(env: Env, role: BytesN<32>, account: Address) -> bool {
        let key = RoleMembersKey { role };
        let members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        members.contains(&account)
    }

    /// Returns one page of members for `role`.
    ///
    /// `page_size` must be > 0. Returns an empty vec when `page` is beyond
    /// the last page rather than panicking, so callers can detect end-of-list.
    pub fn get_role_members(
        env: Env,
        role: BytesN<32>,
        page: u32,
        page_size: u32,
    ) -> Vec<Address> {
        let key = RoleMembersKey { role };
        let members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        let total = members.len();
        let start = page * page_size;
        if start >= total {
            return Vec::new(&env);
        }
        let end = (start + page_size).min(total);
        let mut page_vec: Vec<Address> = Vec::new(&env);
        for i in start..end {
            page_vec.push_back(members.get(i).unwrap());
        }
        page_vec
    }

    // -----------------------------------------------------------------------
    // Role metadata (issue #1)
    // -----------------------------------------------------------------------

    /// Store human-readable metadata for `role`. Caller must hold ROLE_ADMIN.
    pub fn set_role_metadata(
        env: Env,
        caller: Address,
        role: BytesN<32>,
        name: String,
        description: String,
    ) {
        caller.require_auth();
        Self::require_role(&env, &caller, &role_admin_id(&env));

        let meta = RoleMetadata {
            name,
            description,
            created_at: env.ledger().sequence(),
        };
        let key = RoleMetaKey { role };
        env.storage().persistent().set(&key, &meta);
    }

    /// Retrieve metadata for `role`. Returns `None` if no metadata has been set.
    pub fn get_role_metadata(env: Env, role: BytesN<32>) -> Option<RoleMetadata> {
        let key = RoleMetaKey { role };
        env.storage().persistent().get(&key)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn require_role(env: &Env, account: &Address, role: &BytesN<32>) {
        let key = RoleMembersKey { role: role.clone() };
        let members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(env));
        if !members.contains(account) {
            panic_with_error!(env, RoleError::Unauthorized);
        }
    }
}
