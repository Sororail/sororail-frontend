import { ValidationError } from "../errors/index.js";
import type { Authorization } from "../types/index.js";
import {
  addr,
  asBigInt,
  asBoolean,
  asNumber,
  asOptional,
  asRecord,
  asString,
  asVoid,
  i128,
  optionU32,
  u64,
} from "../utils/scval.js";
import { BaseClient, type PreparedCall } from "./base.js";

function parseAuthorization(value: unknown): Authorization {
  const raw = asRecord(value, "Authorization");
  return {
    payer: asString(raw["payer"], "payer"),
    payee: asString(raw["payee"], "payee"),
    token: asString(raw["token"], "token"),
    amountPerPeriod: asBigInt(raw["amount_per_period"], "amount_per_period"),
    periodSeconds: asBigInt(raw["period_seconds"], "period_seconds"),
    maxPeriods: asOptional(raw["max_periods"], (v) => asNumber(v, "max_periods")),
    periodsCharged: asNumber(raw["periods_charged"], "periods_charged"),
    nextChargeableAt: asBigInt(raw["next_chargeable_at"], "next_chargeable_at"),
    cancelled: asBoolean(raw["cancelled"], "cancelled"),
  };
}

/**
 * Recurring: pull-based authorization for subscriptions.
 *
 * **This contract never holds funds.** The payer grants it an allowance on the
 * token with `approve`, and each charge moves money straight from payer to
 * payee via `transfer_from`. Revoking that allowance on the token stops
 * charges immediately, with or without cancelling here — see
 * {@link RecurringClient.authorize}.
 *
 * **Skipped periods are forfeited, not banked.** The next charge is scheduled
 * at `now + periodSeconds` each time, so a payee who forgets to charge for
 * three months cannot then take three payments. Surface this in any UI: it is
 * a deliberate consumer-protection choice and it surprises merchants.
 */
export class RecurringClient extends BaseClient {
  /**
   * Records the authorization. Requires the payer's signature.
   *
   * The first charge becomes available one full period after this call.
   *
   * **This alone does not let the payee take anything.** The payer must also
   * `approve` this contract as a spender on the token, for at least the total
   * they intend to allow. That allowance is the real cap.
   */
  authorize(args: {
    payer: string;
    payee: string;
    token: string;
    amountPerPeriod: bigint;
    periodSeconds: bigint;
    /** Cap on the number of charges. Omit for open-ended. */
    maxPeriods?: number | null;
  }): Promise<PreparedCall<void>> {
    if (args.amountPerPeriod <= 0n) {
      throw new ValidationError("The amount per period must be greater than zero.");
    }
    if (args.periodSeconds <= 0n) {
      throw new ValidationError("The period must be greater than zero seconds.");
    }
    if (args.maxPeriods !== undefined && args.maxPeriods !== null) {
      if (!Number.isInteger(args.maxPeriods) || args.maxPeriods < 1) {
        throw new ValidationError(
          "maxPeriods must be a whole number of at least 1, or omitted for open-ended.",
        );
      }
    }
    return this.prepare(
      "authorize",
      [
        addr(args.payer),
        addr(args.payee),
        addr(args.token),
        i128(args.amountPerPeriod),
        u64(args.periodSeconds),
        optionU32(args.maxPeriods ?? null),
      ],
      asVoid,
    );
  }

  /**
   * Pulls one period's payment from payer to payee, returning the amount.
   * Callable by the payee.
   */
  charge(): Promise<PreparedCall<bigint>> {
    return this.prepare("charge", [], (v) => asBigInt(v, "amount"));
  }

  /** Cancels the authorization immediately. Either party may call. */
  cancel(caller: string): Promise<PreparedCall<void>> {
    return this.prepare("cancel", [addr(caller)], asVoid);
  }

  /**
   * The earliest timestamp at which the next charge may be taken.
   *
   * Reports the stored schedule regardless of cancellation or exhaustion; use
   * {@link RecurringClient.isChargeable} for whether a charge would succeed.
   */
  nextChargeableAt(): Promise<bigint> {
    return this.read("next_chargeable_at", [], (v) =>
      asBigInt(v, "next_chargeable_at"),
    );
  }

  /** Whether a charge would succeed right now. */
  isChargeable(): Promise<boolean> {
    return this.read("is_chargeable", [], (v) => asBoolean(v, "is_chargeable"));
  }

  /** Charges still permitted under the cap, or `null` if open-ended. */
  remainingPeriods(): Promise<number | null> {
    return this.read("remaining_periods", [], (v) =>
      asOptional(v, (inner) => asNumber(inner, "remaining_periods")),
    );
  }

  /** The full authorization record. */
  get(): Promise<Authorization> {
    return this.read("get", [], parseAuthorization);
  }
}
