import { ContractError, type ErrorCodeName } from "@sororail/sdk";

/**
 * The next step for every contract failure.
 *
 * Typed as a complete `Record`, so adding a variant to the SDK's `ErrorCode`
 * without writing its recovery text here is a type error rather than a user
 * hitting a dead end. `e2e/recovery.spec.ts` checks the same thing at runtime.
 *
 * The SDK message says what happened; these say what to do about it.
 */
export const RECOVERY: Record<ErrorCodeName, string> = {
  // ----- generic -----
  AlreadyInitialized:
    "This contract already holds a position. Deploy a new instance for a new one.",
  NotInitialized:
    "This contract has not been set up yet. Create the position first.",
  Unauthorized:
    "The connected wallet is not a party to this contract. Switch accounts and try again.",
  InvalidAmount: "Enter an amount greater than zero and try again.",
  InvalidTimeRange: "Choose an end time that is later than the start time.",
  Overflow:
    "Use a smaller amount, or split it across several positions.",
  Underflow: "Use a larger amount and try again.",
  DivisionByZero:
    "Check the amounts and dates the position was created with. If they look right, this is a contract fault — report it with the technical details.",
  InvalidBasisPoints:
    "Enter a split between 0 and 10000 basis points, where 10000 is 100%.",
  InvalidState:
    "Refresh to see the position's current state. It may already have been completed, closed or changed by the other party.",
  DeadlineNotReached:
    "Only the arbiter can act before the deadline. Wait, or ask the arbiter to refund.",
  DeadlinePassed:
    "This can only be done before the deadline, and it has passed. If funds are still held, ask the arbiter or the other party how to proceed.",
  InsufficientBalance:
    "Add funds to the wallet, or lower the amount, and try again.",
  InvalidDuration: "Enter a duration longer than zero.",

  // ----- escrow -----
  EscrowNotFundable:
    "Nothing more can be deposited here. If you need a new escrow, deploy a new instance.",
  EscrowNotFunded:
    "The escrow has to be funded first. Fund it, then release, refund or dispute.",
  EscrowClosed:
    "This escrow has already paid out or been refunded. Deploy a new instance for a new agreement.",
  EscrowNoArbiter:
    "Without an arbiter there is nobody to settle a dispute. Release or refund instead, or deploy a new escrow with an arbiter.",
  EscrowNotDisputed:
    "Only a disputed escrow can be resolved. Ask either party to dispute it first.",
  EscrowAlreadyDisputed:
    "The arbiter now decides. Ask the arbiter to resolve the split.",

  // ----- stream -----
  StreamNotFound:
    "Check the contract address, and that a stream was created on this instance.",
  StreamCancelled:
    "A cancelled stream cannot be changed or withdrawn from. Create a new stream to keep paying.",
  StreamNotCancellable:
    "This stream was created as non-cancellable and will run to its end. Only a new stream can be set up differently.",
  StreamInsufficientAccrued:
    "The accrued balance moves as time passes. Refresh and try again with the amount shown, or withdraw everything available.",
  StreamNotExtendable:
    "Choose an end time later than the current one.",

  // ----- vesting -----
  VestingNotFound:
    "Check the contract address, and that a grant was created on this instance.",
  VestingCliffNotReached:
    "Nothing is claimable until the cliff date. The schedule above shows when that is.",
  VestingNotRevocable:
    "This grant was created as non-revocable and will vest in full. Only a new grant can be set up differently.",
  VestingRevoked:
    "A revoked grant stops vesting. Claim what vested before the revocation, if any, or create a new grant.",
  VestingCliffAfterEnd:
    "Choose a cliff that falls on or before the end of the schedule.",
  VestingNothingToClaim:
    "Everything vested so far has been claimed. Check back as more vests.",

  // ----- recurring -----
  RecurringNotFound:
    "Check the contract address, and that a subscription was authorized on this instance.",
  RecurringCancelled:
    "This subscription is over. Authorize a new one to resume charging.",
  RecurringPeriodNotElapsed:
    "The period has not elapsed yet. Try again once enough time has passed.",
  RecurringExhausted:
    "The subscription has taken every charge it was authorized for. Authorize a new one to continue.",

  // ----- batch_payout -----
  BatchEmpty: "Add at least one recipient and try again.",
  BatchTooLarge:
    "Split the payroll into smaller batches and try again.",
};

/** The recovery step for an error, or `null` when it is not a contract failure. */
export function recoveryFor(error: unknown): string | null {
  if (!(error instanceof ContractError)) return null;
  if (error.variant === "Unknown") return null;
  return RECOVERY[error.variant];
}
