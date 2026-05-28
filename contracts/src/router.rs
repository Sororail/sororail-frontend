use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Vec};

use crate::{liquidity_handler::LiquidityHandlerClient, types::RouterAction};

#[contract]
pub struct Router;

#[contracttype]
enum RouterKey {
    LiquidityHandler,
}

#[contractimpl]
impl Router {
    /// Initialise the router with references to other system contracts.
    pub fn initialize(env: Env, liquidity_handler: Address) {
        if env.storage().instance().has(&RouterKey::LiquidityHandler) {
            panic!("already initialised");
        }
        env.storage()
            .instance()
            .set(&RouterKey::LiquidityHandler, &liquidity_handler);
    }

    /// Execute a sequence of actions atomically. If any action fails, the
    /// entire transaction reverts.
    pub fn multicall(env: Env, caller: Address, actions: Vec<RouterAction>) {
        caller.require_auth();

        for action in actions.iter() {
            match action {
                RouterAction::SendTokens(token, receiver, amount) => {
                    if amount > 0 {
                        token::TokenClient::new(&env, &token).transfer(
                            &caller,
                            &receiver,
                            &(amount as i128),
                        );
                    }
                }

                RouterAction::CreateDeposit(market_id, long_amount, short_amount, receiver) => {
                    let lh = Self::liquidity_handler(&env);
                    lh.execute_deposit(&caller, &market_id, &long_amount, &short_amount, &receiver);
                }

                RouterAction::CancelDeposit(_) => {
                    // Placeholder: pending-request logic not yet implemented.
                }

                RouterAction::CreateWithdrawal(
                    market_id,
                    lp_amount,
                    receiver,
                    min_long_out,
                    min_short_out,
                ) => {
                    let lh = Self::liquidity_handler(&env);
                    lh.create_withdrawal(
                        &caller,
                        &market_id,
                        &lp_amount,
                        &receiver,
                        &min_long_out,
                        &min_short_out,
                    );
                }

                RouterAction::CancelWithdrawal(_) => {
                    // Placeholder: pending-request logic not yet implemented.
                }

                RouterAction::CreateOrder(..) => {
                    // Placeholder: order logic not yet implemented.
                }

                RouterAction::UpdateOrder(..) => {
                    // Placeholder: order logic not yet implemented.
                }

                RouterAction::CancelOrder(_) => {
                    // Placeholder: order logic not yet implemented.
                }

                RouterAction::ClaimFundingFees(..) => {
                    // Placeholder: funding fee logic not yet implemented.
                }
            }
        }

        env.events()
            .publish(("multicall",), (caller, actions.len()));
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn liquidity_handler(env: &Env) -> LiquidityHandlerClient {
        let addr: Address = env
            .storage()
            .instance()
            .get(&RouterKey::LiquidityHandler)
            .expect("not initialised");
        LiquidityHandlerClient::new(env, &addr)
    }
}
