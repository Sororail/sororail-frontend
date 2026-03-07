/**
 * Contract error codes, mirroring `sororail_common::errors::Error`.
 *
 * These integers are the contracts' public ABI. A released variant is never
 * renumbered and never removed, so this table can be relied on across
 * contract versions. It must stay in lockstep with
 * `contracts/common/src/errors.rs` in the `sororail-contracts` repo — the
 * ranges below are the ones reserved there.
 *
 * | Range   | Owner          |
 * |---------|----------------|
 * | 1–19    | generic        |
 * | 20–39   | `escrow`       |
 * | 40–59   | `stream`       |
 * | 60–79   | `vesting`      |
 * | 80–99   | `recurring`    |
 * | 100–119 | `batch_payout` |
 */
export const ErrorCode = {
  // ----- generic: 1–19 -----
  AlreadyInitialized: 1,
  NotInitialized: 2,
  Unauthorized: 3,
  InvalidAmount: 4,
  InvalidTimeRange: 5,
  Overflow: 6,
  Underflow: 7,
  DivisionByZero: 8,
  InvalidBasisPoints: 9,
  InvalidState: 10,
  DeadlineNotReached: 11,
  DeadlinePassed: 12,
  InsufficientBalance: 13,
  InvalidDuration: 14,

  // ----- escrow: 20–39 -----
  EscrowNotFundable: 20,
  EscrowNotFunded: 21,
  EscrowClosed: 22,
  EscrowNoArbiter: 23,
  EscrowNotDisputed: 24,
  EscrowAlreadyDisputed: 25,

  // ----- stream: 40–59 -----
  StreamNotFound: 40,
  StreamCancelled: 41,
  StreamNotCancellable: 42,
  StreamInsufficientAccrued: 43,
  StreamNotExtendable: 44,

  // ----- vesting: 60–79 -----
  VestingNotFound: 60,
  VestingCliffNotReached: 61,
  VestingNotRevocable: 62,
  VestingRevoked: 63,
  VestingCliffAfterEnd: 64,
  VestingNothingToClaim: 65,

  // ----- recurring: 80–99 -----
  RecurringNotFound: 80,
  RecurringCancelled: 81,
  RecurringPeriodNotElapsed: 82,
  RecurringExhausted: 83,

  // ----- batch_payout: 100–119 -----
  BatchEmpty: 100,
  BatchTooLarge: 101,
  // 102 was `BatchDuplicateRecipient`, removed before release and left burned.
  // Duplicate detection belongs in CSV import, not on-chain.
} as const;

export type ErrorCodeName = keyof typeof ErrorCode;
export type ErrorCodeValue = (typeof ErrorCode)[ErrorCodeName];

/** Reverse lookup: code number to its name. */
export const errorCodeNames: ReadonlyMap<number, ErrorCodeName> = new Map(
  Object.entries(ErrorCode).map(([name, code]) => [code, name as ErrorCodeName]),
);

/**
 * Human-readable messages.
 *
 * A user must never see a bare error code, so every variant has a sentence
 * that says what happened and, where there is one, what to do about it.
 */
export const errorMessages: Record<ErrorCodeName, string> = {
  AlreadyInitialized:
    "This contract has already been set up and holds a position. Deploy a new instance for a new one.",
  NotInitialized:
    "This contract has not been set up yet. Call its create/init function first.",
  Unauthorized: "The account you are acting as is not permitted to do this.",
  InvalidAmount: "The amount must be greater than zero.",
  InvalidTimeRange: "The end of the period must be after its start.",
  Overflow: "The amount is too large for the contract to represent.",
  Underflow: "The amount is too small for the contract to represent.",
  DivisionByZero: "The contract attempted to divide by zero.",
  InvalidBasisPoints:
    "The split must be between 0 and 10000 basis points (0–100%).",
  InvalidState: "This action is not allowed from the current state.",
  DeadlineNotReached: "The deadline has not passed yet.",
  DeadlinePassed: "The deadline has already passed.",
  InsufficientBalance: "There is not enough balance to cover this.",
  InvalidDuration: "The duration must be greater than zero.",

  EscrowNotFundable:
    "This escrow cannot be funded — it has already been funded or closed.",
  EscrowNotFunded: "This escrow is not currently holding funds.",
  EscrowClosed: "This escrow is closed and cannot be changed.",
  EscrowNoArbiter:
    "This escrow was created without an arbiter, so it cannot be disputed.",
  EscrowNotDisputed: "This escrow is not in dispute, so there is nothing to resolve.",
  EscrowAlreadyDisputed: "This escrow is already in dispute.",

  StreamNotFound: "No stream was found.",
  StreamCancelled: "This stream has been cancelled and can no longer be changed.",
  StreamNotCancellable: "This stream was created as non-cancellable.",
  StreamInsufficientAccrued:
    "You asked to withdraw more than has accrued so far.",
  StreamNotExtendable: "The new end time must be later than the current one.",

  VestingNotFound: "No vesting grant was found.",
  VestingCliffNotReached: "Nothing has vested yet — the cliff has not been reached.",
  VestingNotRevocable: "This grant was created as non-revocable.",
  VestingRevoked: "This grant has already been revoked.",
  VestingCliffAfterEnd: "The cliff cannot fall after the end of the schedule.",
  VestingNothingToClaim: "There is nothing vested left to claim right now.",

  RecurringNotFound: "No recurring authorization was found.",
  RecurringCancelled: "This subscription has been cancelled.",
  RecurringPeriodNotElapsed:
    "The next charge is not due yet. Skipped periods are not billable later.",
  RecurringExhausted:
    "This subscription has taken all the charges it was authorized for.",

  BatchEmpty: "The payment list is empty.",
  BatchTooLarge:
    "The payment list is longer than the contract allows. Split it into smaller batches — call maxRecipients() for the limit.",
};
