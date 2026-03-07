/**
 * Types mirroring the contract structs.
 *
 * Every monetary value is a `bigint` in the token's smallest unit, never a
 * `number` — `Number` loses integer precision above 2^53, which is well inside
 * the range of a real balance. Use `toStroops` / `fromStroops` at the edges.
 *
 * Timestamps are `bigint` seconds (ledger time), for the same reason: the
 * contracts use `u64`.
 */

/** Escrow lifecycle. Discriminants match the contract's ABI. */
export const EscrowState = {
  Created: 0,
  Funded: 1,
  Released: 2,
  Refunded: 3,
  Disputed: 4,
  Resolved: 5,
} as const;

export type EscrowStateName = keyof typeof EscrowState;

/** States from which no further transition is possible. */
export const terminalEscrowStates: readonly EscrowStateName[] = [
  "Released",
  "Refunded",
  "Resolved",
];

export function isTerminalEscrowState(state: EscrowStateName): boolean {
  return terminalEscrowStates.includes(state);
}

/** An escrow agreement. */
export interface Escrow {
  depositor: string;
  beneficiary: string;
  /** `null` when the escrow was created without one; dispute is then unavailable. */
  arbiter: string | null;
  token: string;
  amount: bigint;
  /** Ledger timestamp after which the depositor may unilaterally refund. */
  deadline: bigint;
  state: EscrowStateName;
}

/** A payment stream. */
export interface Stream {
  sender: string;
  recipient: string;
  token: string;
  ratePerSecond: bigint;
  start: bigint;
  stop: bigint;
  cancellable: boolean;
  /** Always `ratePerSecond * (stop - start)`. */
  deposited: bigint;
  withdrawn: bigint;
  refunded: bigint;
  /** When it was cancelled, if it was. Accrual stops here. */
  cancelledAt: bigint | null;
}

/** A vesting grant. `cliff` and `duration` are spans from `start`, not timestamps. */
export interface Grant {
  grantor: string;
  beneficiary: string;
  token: string;
  total: bigint;
  start: bigint;
  /** Seconds after `start` before anything vests. */
  cliff: bigint;
  /** Seconds after `start` at which the grant is fully vested. */
  duration: bigint;
  revocable: boolean;
  claimed: bigint;
  returned: bigint;
  revokedAt: bigint | null;
}

/** A recurring pull authorization. */
export interface Authorization {
  payer: string;
  payee: string;
  token: string;
  amountPerPeriod: bigint;
  periodSeconds: bigint;
  /** `null` is open-ended. */
  maxPeriods: number | null;
  periodsCharged: number;
  nextChargeableAt: bigint;
  cancelled: boolean;
}

/** One line of a batch payout. */
export interface Payment {
  to: string;
  amount: bigint;
}

/** The outcome of a batch. */
export interface Receipt {
  count: number;
  total: bigint;
}
