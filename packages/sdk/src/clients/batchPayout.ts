import { nativeToScVal, type xdr } from "@stellar/stellar-sdk";

import { ValidationError } from "../errors/index.js";
import type { Payment, Receipt } from "../types/index.js";
import { addr, asBigInt, asNumber, asRecord, i128, vec } from "../utils/scval.js";
import { BaseClient, type PreparedCall } from "./base.js";

function paymentToScVal(payment: Payment): xdr.ScVal {
  return nativeToScVal(
    { to: payment.to, amount: payment.amount },
    { type: { to: ["symbol", "address"], amount: ["symbol", "i128"] } },
  );
}

function parseReceipt(value: unknown): Receipt {
  const raw = asRecord(value, "Receipt");
  return {
    count: asNumber(raw["count"], "count"),
    total: asBigInt(raw["total"], "total"),
  };
}

function validate(payments: readonly Payment[]): void {
  if (payments.length === 0) {
    throw new ValidationError("The payment list is empty.");
  }
  for (const [index, payment] of payments.entries()) {
    if (payment.amount <= 0n) {
      throw new ValidationError(
        `Payment ${index + 1} of ${payments.length} (to ${payment.to}) has a non-positive amount. Every line must be greater than zero.`,
      );
    }
  }
}

/**
 * Batch payout: one transaction, many recipients.
 *
 * **Stateless and reusable.** Unlike the other contracts, this one holds no
 * position and no funds, so a single deployed address serves everybody.
 *
 * **All-or-nothing.** If any transfer fails, the whole batch reverts and
 * nobody is paid. Check {@link BatchPayoutClient.maxRecipients} and split
 * larger payrolls client-side; duplicates are allowed on-chain, so catch those
 * in your CSV import if you do not want them.
 */
export class BatchPayoutClient extends BaseClient {
  /** Pays each recipient their own amount. */
  execute(args: {
    funder: string;
    token: string;
    recipients: readonly Payment[];
  }): Promise<PreparedCall<Receipt>> {
    validate(args.recipients);
    return this.prepare(
      "execute",
      [
        addr(args.funder),
        addr(args.token),
        vec(args.recipients.map(paymentToScVal)),
      ],
      parseReceipt,
    );
  }

  /**
   * Pays every recipient the same amount.
   *
   * Cheaper to submit than {@link BatchPayoutClient.execute} because the
   * amount crosses the wire once rather than once per line.
   */
  executeEqual(args: {
    funder: string;
    token: string;
    recipients: readonly string[];
    amountEach: bigint;
  }): Promise<PreparedCall<Receipt>> {
    if (args.recipients.length === 0) {
      throw new ValidationError("The recipient list is empty.");
    }
    if (args.amountEach <= 0n) {
      throw new ValidationError("The amount must be greater than zero.");
    }
    return this.prepare(
      "execute_equal",
      [
        addr(args.funder),
        addr(args.token),
        vec(args.recipients.map((r) => addr(r))),
        i128(args.amountEach),
      ],
      parseReceipt,
    );
  }

  /**
   * Totals and validates a batch without moving anything.
   *
   * Runs exactly the checks `execute` does, so a preview that succeeds means
   * the batch will not be rejected for size, an invalid amount, or an
   * overflowing total. Show this before asking for a signature.
   */
  preview(recipients: readonly Payment[]): Promise<Receipt> {
    validate(recipients);
    return this.read(
      "preview",
      [vec(recipients.map(paymentToScVal))],
      parseReceipt,
    );
  }

  /**
   * The maximum recipients one batch may contain.
   *
   * Read it rather than hardcoding: the contract's cap is derived from network
   * resource limits and may change between deployments.
   */
  maxRecipients(): Promise<number> {
    return this.read("max_recipients", [], (v) => asNumber(v, "max_recipients"));
  }

  /** Splits an oversized payroll into batches this contract will accept. */
  static chunk(
    recipients: readonly Payment[],
    maxRecipients: number,
  ): Payment[][] {
    if (!Number.isInteger(maxRecipients) || maxRecipients < 1) {
      throw new ValidationError("maxRecipients must be a whole number of at least 1.");
    }
    const batches: Payment[][] = [];
    for (let i = 0; i < recipients.length; i += maxRecipients) {
      batches.push(recipients.slice(i, i + maxRecipients));
    }
    return batches;
  }
}
