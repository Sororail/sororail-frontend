import { ValidationError } from "../errors/index.js";
import type { Stream } from "../types/index.js";
import {
  addr,
  asBigInt,
  asBoolean,
  asOptional,
  asRecord,
  asString,
  asVoid,
  bool,
  i128,
  optionI128,
  u64,
} from "../utils/scval.js";
import { BaseClient, type PreparedCall } from "./base.js";

function parseStream(value: unknown): Stream {
  const raw = asRecord(value, "Stream");
  return {
    sender: asString(raw["sender"], "sender"),
    recipient: asString(raw["recipient"], "recipient"),
    token: asString(raw["token"], "token"),
    ratePerSecond: asBigInt(raw["rate_per_second"], "rate_per_second"),
    start: asBigInt(raw["start"], "start"),
    stop: asBigInt(raw["stop"], "stop"),
    cancellable: asBoolean(raw["cancellable"], "cancellable"),
    deposited: asBigInt(raw["deposited"], "deposited"),
    withdrawn: asBigInt(raw["withdrawn"], "withdrawn"),
    refunded: asBigInt(raw["refunded"], "refunded"),
    cancelledAt: asOptional(raw["cancelled_at"], (v) =>
      asBigInt(v, "cancelled_at"),
    ),
  };
}

const parseAmount = (value: unknown): bigint => asBigInt(value, "amount");

/**
 * Stream: continuous per-second transfer from sender to recipient.
 *
 * One stream per deployed contract, funded up front for its whole span. There
 * is no per-second state on chain — accrual is computed from the ledger
 * timestamp whenever it is read.
 */
export class StreamClient extends BaseClient {
  /**
   * Creates and fully funds a stream.
   *
   * `ratePerSecond * (stop - start)` is pulled from the sender immediately, so
   * the recipient can rely on the whole span being covered. `start` may be in
   * the past, which backdates accrual.
   */
  create(args: {
    sender: string;
    recipient: string;
    token: string;
    ratePerSecond: bigint;
    start: bigint;
    stop: bigint;
    cancellable: boolean;
  }): Promise<PreparedCall<void>> {
    if (args.ratePerSecond <= 0n) {
      throw new ValidationError("The rate must be greater than zero.");
    }
    if (args.stop <= args.start) {
      throw new ValidationError("The stream must stop after it starts.");
    }
    return this.prepare(
      "create",
      [
        addr(args.sender),
        addr(args.recipient),
        addr(args.token),
        i128(args.ratePerSecond),
        u64(args.start),
        u64(args.stop),
        bool(args.cancellable),
      ],
      asVoid,
    );
  }

  /**
   * Withdraws accrued funds to the recipient, returning the amount taken.
   *
   * Omit `amount` to withdraw everything currently available.
   */
  withdraw(amount?: bigint | null): Promise<PreparedCall<bigint>> {
    return this.prepare("withdraw", [optionI128(amount ?? null)], parseAmount);
  }

  /**
   * Cancels the stream: settles what has accrued to the recipient and returns
   * the rest to the sender. Sender only, and only if created cancellable.
   */
  cancel(): Promise<PreparedCall<void>> {
    return this.prepare("cancel", [], asVoid);
  }

  /**
   * Adds funds, extending `stop` by the span they buy.
   *
   * `amount` must be an exact multiple of `ratePerSecond`; a partial second
   * cannot be represented, and the contract rejects it rather than stranding
   * the remainder.
   */
  topUp(amount: bigint): Promise<PreparedCall<void>> {
    if (amount <= 0n) {
      throw new ValidationError("The top-up must be greater than zero.");
    }
    return this.prepare("top_up", [i128(amount)], asVoid);
  }

  /** Extends `stop`, pulling the additional funds the longer span requires. */
  extend(newStop: bigint): Promise<PreparedCall<void>> {
    return this.prepare("extend", [u64(newStop)], asVoid);
  }

  /**
   * Accrued but unwithdrawn for the recipient; refundable remainder for the
   * sender; zero for anyone else.
   */
  balanceOf(who: string): Promise<bigint> {
    return this.read("balance_of", [addr(who)], parseAmount);
  }

  /** What the contract still holds for this stream. */
  remaining(): Promise<bigint> {
    return this.read("remaining", [], parseAmount);
  }

  /** The full stream record. */
  get(): Promise<Stream> {
    return this.read("get", [], parseStream);
  }
}
