/**
 * `@sororail/sdk` — typed TypeScript client for the SoroRail Soroban payment
 * contracts.
 *
 * Zero framework dependencies: no React, no assumptions about where it runs.
 * Signing is injected rather than performed here, so the SDK never holds a
 * secret key.
 *
 * ```ts
 * import {
 *   StreamClient,
 *   KeypairSigner,
 *   ContractError,
 *   NetworkError,
 *   SigningError,
 *   ValidationError,
 * } from "@sororail/sdk";
 * import { Networks } from "@stellar/stellar-sdk";
 *
 * const signer = new KeypairSigner(process.env.SECRET_KEY!);
 * const stream = new StreamClient({
 *   contractId: "CBEE...CGC7",
 *   rpcUrl: "https://soroban-testnet.stellar.org",
 *   networkPassphrase: Networks.TESTNET,
 *   publicKey: signer.publicKey,
 * });
 *
 * try {
 *   // Build and inspect before anyone signs.
 *   const call = await stream.withdraw();
 *   const wouldReceive = await call.simulate();
 *
 *   // Then commit.
 *   const { hash, result } = await call.signAndSend(signer);
 * } catch (error) {
 *   if (error instanceof ContractError) {
 *     // The contract refused. `message` is a sentence to show a person;
 *     // branch on the variant (or the stable numeric `code`) to recover.
 *     if (error.is("StreamInsufficientAccrued")) {
 *       // Asked for more than has accrued: withdraw less, or wait.
 *     }
 *   } else if (error instanceof ValidationError) {
 *     // Rejected before anything was sent. Fix the arguments.
 *   } else if (error instanceof SigningError) {
 *     // No wallet, locked, declined, or on the wrong network.
 *   } else if (error instanceof NetworkError) {
 *     // Could not simulate or submit. The original failure is `error.cause`.
 *   } else {
 *     throw error;
 *   }
 * }
 * ```
 *
 * Everything the SDK throws extends `SororailError`, so anything else that
 * reaches the final branch is a bug in the calling code, not a failed call.
 *
 * ## Unaudited
 *
 * The contracts this talks to have not been audited. Testnet only — do not use
 * them with real value.
 */

export { BaseClient, PreparedCall } from "./clients/base.js";
export type { ClientOptions, SentCall } from "./clients/base.js";
export { TESTNET_DEFAULTS } from "./config.js";

export { EscrowClient } from "./clients/escrow.js";
export { StreamClient } from "./clients/stream.js";
export { VestingClient } from "./clients/vesting.js";
export { RecurringClient } from "./clients/recurring.js";
export { BatchPayoutClient } from "./clients/batchPayout.js";

export {
  ContractError,
  NetworkError,
  SororailError,
  ValidationError,
  ErrorCode,
  contractForCode,
  decodeError,
  errorCodeNames,
  errorMessages,
  extractErrorCode,
  throwDecoded,
} from "./errors/index.js";
export type { ContractName, ErrorCodeName, ErrorCodeValue } from "./errors/index.js";

export {
  FreighterSigner,
  KeypairSigner,
  NetworkMismatchError,
  SigningError,
} from "./signers/index.js";
export type { FreighterApi, Signer } from "./signers/index.js";

export {
  EscrowState,
  isTerminalEscrowState,
  terminalEscrowStates,
} from "./types/index.js";
export type {
  Authorization,
  Escrow,
  EscrowStateName,
  Grant,
  Payment,
  Receipt,
  Stream,
} from "./types/index.js";

export {
  STROOPS_DECIMALS,
  formatAmount,
  fromStroops,
  requirePositive,
  toStroops,
} from "./utils/amounts.js";

export { batchRead, batchReadSafe } from "./utils/batch.js";
