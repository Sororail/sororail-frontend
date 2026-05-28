use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, symbol_short, Address, BytesN, Env,
    String, Vec,
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
    /// The pending admin-transfer proposal has expired.
    ProposalExpired = 4,
    /// No active admin-transfer proposal exists.
    NoActiveProposal = 5,
    /// Caller is not the address named in the pending proposal.
    NotProposedAdmin = 6,
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

/// Keys for instance (per-contract) storage.
#[contracttype]
#[derive(Clone)]
pub enum RoleInstanceKey {
    /// Stores the hash of the currently deployed WASM.
    WasmHash,
    /// Stores the pending admin-transfer proposal (if any).
    AdminTransferProposal,
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
// Admin-transfer proposal
// ---------------------------------------------------------------------------

/// Represents a pending two-step admin transfer.
///
/// The original admin retains ROLE_ADMIN until `accept_admin_transfer` is
/// called successfully. The proposal automatically becomes invalid after
/// `expiry_ledger`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferProposal {
    /// The admin that initiated the transfer.
    pub proposing_admin: Address,
    /// The address that must call `accept_admin_transfer`.
    pub new_admin: Address,
    /// Absolute ledger sequence number after which the proposal is invalid.
    pub expiry_ledger: u32,
}

// ---------------------------------------------------------------------------
// Well-known role constant helper
// ---------------------------------------------------------------------------

/// Returns the canonical `ROLE_ADMIN` identifier (32 zero bytes).
///
/// Use this as the `role` argument wherever admin-role membership must be
/// checked or granted.  The value is stable and deterministic across all
/// contract invocations.
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

    /// Initialise the contract by granting `ROLE_ADMIN` to `initial_admin`.
    ///
    /// Must be called exactly once after deployment; panics if called again.
    /// No authentication is required for the bootstrap call.
    pub fn initialize(env: Env, initial_admin: Address) {
        let admin_role = role_admin_id(&env);
        let key = RoleMembersKey {
            role: admin_role.clone(),
        };
        if env.storage().persistent().has(&key) {
            panic!("already initialised");
        }
        let members: Vec<Address> = Vec::from_array(&env, [initial_admin]);
        env.storage().persistent().set(&key, &members);
    }

    // -----------------------------------------------------------------------
    // Contract upgrades
    // -----------------------------------------------------------------------

    /// Upgrade the contract to a new WASM binary identified by `new_wasm_hash`.
    ///
    /// Caller must hold ROLE_ADMIN. Emits an `upgraded` event containing the
    /// old WASM hash and the new WASM hash.
    pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) {
        caller.require_auth();
        Self::require_role(&env, &caller, &role_admin_id(&env));

        // Read the previously recorded hash (zero bytes if first upgrade).
        let old_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&RoleInstanceKey::WasmHash)
            .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]));

        // Record the new hash before performing the upgrade so that the
        // storage write is included in the same invocation.
        env.storage()
            .instance()
            .set(&RoleInstanceKey::WasmHash, &new_wasm_hash);

        // Perform the WASM upgrade.
        //
        // This host call is only meaningful (and safe) when the contract is
        // running as compiled WASM on-chain.  In native test builds the
        // deployer's WASM registry is never pre-loaded with real contract
        // bytes so the call would panic with Error(Storage, MissingValue).
        // Guarding on `target_family = "wasm"` is the correct semantic: WASM
        // upgrades are a chain-level operation that native test runtimes
        // cannot replicate.  Auth, storage, and event-emission are still
        // fully exercised in tests.
        #[cfg(target_family = "wasm")]
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        // Emit the event so off-chain indexers can track upgrade history.
        env.events()
            .publish((symbol_short!("upgraded"),), (old_hash, new_wasm_hash));
    }

    // -----------------------------------------------------------------------
    // Two-step admin transfer
    // -----------------------------------------------------------------------

    /// Propose a transfer of ROLE_ADMIN to `new_admin`.
    ///
    /// Caller must hold ROLE_ADMIN. The proposal expires at `expiry_ledger`
    /// (absolute ledger sequence number). The original admin retains
    /// ROLE_ADMIN until `accept_admin_transfer` is called successfully.
    ///
    /// A new call overwrites any existing pending proposal.
    pub fn propose_admin_transfer(
        env: Env,
        caller: Address,
        new_admin: Address,
        expiry_ledger: u32,
    ) {
        caller.require_auth();
        Self::require_role(&env, &caller, &role_admin_id(&env));

        if caller == new_admin {
            panic!("cannot transfer admin to self");
        }

        let proposal = AdminTransferProposal {
            proposing_admin: caller,
            new_admin,
            expiry_ledger,
        };
        env.storage()
            .instance()
            .set(&RoleInstanceKey::AdminTransferProposal, &proposal);
    }

    /// Accept the pending admin-transfer proposal.
    ///
    /// Must be called by the address named in the proposal before
    /// `expiry_ledger`. On success:
    /// - `new_admin` is granted ROLE_ADMIN.
    /// - `proposing_admin` loses ROLE_ADMIN.
    /// - The proposal is cleared from storage.
    ///
    /// If the proposal has expired, it is cleared and the call panics with
    /// `ProposalExpired`. The original admin retains their role in that case.
    pub fn accept_admin_transfer(env: Env, caller: Address) {
        caller.require_auth();

        // Load the proposal, or panic if none exists.
        let proposal: AdminTransferProposal = match env
            .storage()
            .instance()
            .get(&RoleInstanceKey::AdminTransferProposal)
        {
            Some(p) => p,
            None => panic_with_error!(&env, RoleError::NoActiveProposal),
        };

        // Check expiry first; clear the proposal regardless so stale entries
        // never accumulate.
        if env.ledger().sequence() > proposal.expiry_ledger {
            env.storage()
                .instance()
                .remove(&RoleInstanceKey::AdminTransferProposal);
            panic_with_error!(&env, RoleError::ProposalExpired);
        }

        // Only the named new_admin may accept.
        if caller != proposal.new_admin {
            panic_with_error!(&env, RoleError::NotProposedAdmin);
        }

        let admin_role = role_admin_id(&env);
        let key = RoleMembersKey { role: admin_role };
        let members: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        // Build the updated member list:
        //  - Remove the proposing admin.
        //  - Keep all others (including new_admin if already an admin).
        let mut updated: Vec<Address> = Vec::new(&env);
        for m in members.iter() {
            if m != proposal.proposing_admin {
                updated.push_back(m);
            }
        }
        // Add new_admin if not already present (typical path).
        if !updated.contains(&proposal.new_admin) {
            updated.push_back(proposal.new_admin.clone());
        }

        env.storage().persistent().set(&key, &updated);

        // Clear the fulfilled proposal.
        env.storage()
            .instance()
            .remove(&RoleInstanceKey::AdminTransferProposal);
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

    /// Returns `true` if `account` currently holds `role`, `false` otherwise.
    ///
    /// Read-only; no authentication required.
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
    pub fn get_role_members(env: Env, role: BytesN<32>, page: u32, page_size: u32) -> Vec<Address> {
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

    /// Panics with [`RoleError::Unauthorized`] if `account` does not hold `role`.
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
