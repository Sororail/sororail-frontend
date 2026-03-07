import { ValidationError } from "../errors/index.js";
import type { Grant } from "../types/index.js";
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
  u64,
} from "../utils/scval.js";
import { BaseClient, type PreparedCall } from "./base.js";

function parseGrant(value: unknown): Grant {
  const raw = asRecord(value, "Grant");
  return {
    grantor: asString(raw["grantor"], "grantor"),
    beneficiary: asString(raw["beneficiary"], "beneficiary"),
    token: asString(raw["token"], "token"),
    total: asBigInt(raw["total"], "total"),
    start: asBigInt(raw["start"], "start"),
    cliff: asBigInt(raw["cliff"], "cliff"),
    duration: asBigInt(raw["duration"], "duration"),
    revocable: asBoolean(raw["revocable"], "revocable"),
    claimed: asBigInt(raw["claimed"], "claimed"),
    returned: asBigInt(raw["returned"], "returned"),
    revokedAt: asOptional(raw["revoked_at"], (v) => asBigInt(v, "revoked_at")),
  };
}

const parseAmount = (value: unknown): bigint => asBigInt(value, "amount");

/**
 * Vesting: scheduled release against a schedule, with a cliff.
 *
 * One grant per deployed contract, funded up front. Nothing vests before the
 * cliff; after it, vesting is linear until fully vested at `start + duration`.
 */
export class VestingClient extends BaseClient {
  /**
   * Creates and fully funds a grant.
   *
   * **`cliff` and `duration` are spans in seconds from `start`, not
   * timestamps.** `cliff === duration` is a legal all-or-nothing unlock;
   * `cliff === 0n` is linear vesting with no cliff. A cliff after the end is
   * rejected.
   */
  create(args: {
    grantor: string;
    beneficiary: string;
    token: string;
    total: bigint;
    start: bigint;
    cliff: bigint;
    duration: bigint;
    revocable: boolean;
  }): Promise<PreparedCall<void>> {
    if (args.total <= 0n) {
      throw new ValidationError("The grant total must be greater than zero.");
    }
    if (args.duration <= 0n) {
      throw new ValidationError("The vesting duration must be greater than zero.");
    }
    if (args.cliff > args.duration) {
      throw new ValidationError(
        "The cliff cannot fall after the end of the schedule.",
      );
    }
    return this.prepare(
      "create",
      [
        addr(args.grantor),
        addr(args.beneficiary),
        addr(args.token),
        i128(args.total),
        u64(args.start),
        u64(args.cliff),
        u64(args.duration),
        bool(args.revocable),
      ],
      asVoid,
    );
  }

  /**
   * Transfers vested-but-unclaimed tokens to the beneficiary, returning the
   * amount claimed. Still available after revocation — a revoked grant keeps
   * its vested portion claimable.
   */
  claim(): Promise<PreparedCall<bigint>> {
    return this.prepare("claim", [], parseAmount);
  }

  /**
   * Reclaims the unvested portion for the grantor, returning the amount
   * returned. Vesting freezes here; whatever had vested stays claimable.
   */
  revoke(): Promise<PreparedCall<bigint>> {
    return this.prepare("revoke", [], parseAmount);
  }

  /** Total vested as of `at` (a ledger timestamp), whether claimed or not. */
  vestedAmount(at: bigint): Promise<bigint> {
    return this.read("vested_amount", [u64(at)], parseAmount);
  }

  /** Vested but not yet claimed, as of now. */
  claimable(): Promise<bigint> {
    return this.read("claimable", [], parseAmount);
  }

  /** What the contract still holds for this grant. */
  remaining(): Promise<bigint> {
    return this.read("remaining", [], parseAmount);
  }

  /** The full grant record. */
  get(): Promise<Grant> {
    return this.read("get", [], parseGrant);
  }
}
