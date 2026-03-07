/**
 * `@sororail/sdk` — typed TypeScript client for the SoroRail Soroban payment
 * contracts.
 *
 * Zero framework dependencies: no React, no assumptions about where it runs.
 * Signing is injected rather than performed here, so the SDK never holds a
 * secret key.
 *
 * ```ts
 * import { StreamClient, KeypairSigner, toStroops } from "@sororail/sdk";
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
 * // Build and inspect before anyone signs.
 * const call = await stream.withdraw();
 * const wouldReceive = await call.simulate();
 *
 * // Then commit.
 * const { hash, result } = await call.signAndSend(signer);
 * ```
 *
 * ## Unaudited
 *
 * The contracts this talks to have not been audited. Testnet only — do not use
 * them with real value.
 */

export { BaseClient, PreparedCall } from "./clients/base.js";
export type { ClientOptions, SentCall } from "./clients/base.js";

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

export { FreighterSigner, KeypairSigner, SigningError } from "./signers/index.js";
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
