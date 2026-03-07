import { ValidationError } from "../errors/index.js";
import {
  EscrowState,
  type Escrow,
  type EscrowStateName,
} from "../types/index.js";
import {
  addr,
  asBigInt,
  asOptional,
  asRecord,
  asString,
  asVoid,
  i128,
  optionAddress,
  u32,
  u64,
} from "../utils/scval.js";
import { BaseClient, type PreparedCall } from "./base.js";

const stateNames = Object.entries(EscrowState).reduce<
  Record<number, EscrowStateName>
>((acc, [name, code]) => {
  acc[code] = name as EscrowStateName;
  return acc;
}, {});

function parseState(value: unknown): EscrowStateName {
  // Soroban unit enums cross the boundary as their u32 discriminant; some
  // versions hand back the variant name instead, so both are accepted.
  if (typeof value === "string" && value in EscrowState) {
    return value as EscrowStateName;
  }
  const code = Number(asBigInt(value, "state"));
  const name = stateNames[code];
  if (!name) {
    throw new ValidationError(
      `The contract returned escrow state ${code}, which this SDK does not know. It may be newer than the SDK.`,
    );
  }
  return name;
}

function parseEscrow(value: unknown): Escrow {
  const raw = asRecord(value, "Escrow");
  return {
    depositor: asString(raw["depositor"], "depositor"),
    beneficiary: asString(raw["beneficiary"], "beneficiary"),
    arbiter: asOptional(raw["arbiter"], (v) => asString(v, "arbiter")),
    token: asString(raw["token"], "token"),
    amount: asBigInt(raw["amount"], "amount"),
    deadline: asBigInt(raw["deadline"], "deadline"),
    state: parseState(raw["state"]),
  };
}

/**
 * Escrow: funds held by the contract, released on a condition.
 *
 * One agreement per deployed contract. `init` claims the instance
 * permanently — a second call fails with `AlreadyInitialized` — so deploy one
 * contract per escrow rather than reusing an address.
 */
export class EscrowClient extends BaseClient {
  /**
   * Configures the escrow. Requires the depositor's signature: `init` decides
   * whose funds `fund` will later pull.
   *
   * `deadline` is a ledger timestamp in seconds and must be in the future.
   */
  init(args: {
    depositor: string;
    beneficiary: string;
    /** Optional. Without one, `dispute` and `resolve` are unavailable. */
    arbiter?: string | null;
    token: string;
    amount: bigint;
    deadline: bigint;
  }): Promise<PreparedCall<void>> {
    if (args.amount <= 0n) {
      throw new ValidationError("The escrow amount must be greater than zero.");
    }
    return this.prepare(
      "init",
      [
        addr(args.depositor),
        addr(args.beneficiary),
        optionAddress(args.arbiter),
        addr(args.token),
        i128(args.amount),
        u64(args.deadline),
      ],
      asVoid,
    );
  }

  /** Pulls the agreed amount from the depositor into the contract. */
  fund(): Promise<PreparedCall<void>> {
    return this.prepare("fund", [], asVoid);
  }

  /**
   * Pays the beneficiary. Callable by the depositor or the arbiter — never by
   * the beneficiary, which is the point of the escrow.
   */
  release(caller: string): Promise<PreparedCall<void>> {
    return this.prepare("release", [addr(caller)], asVoid);
  }

  /**
   * Returns the funds to the depositor.
   *
   * The depositor may only do this once the deadline has passed; the arbiter
   * may do it at any time.
   */
  refund(caller: string): Promise<PreparedCall<void>> {
    return this.prepare("refund", [addr(caller)], asVoid);
  }

  /** Freezes the escrow pending an arbiter decision. Either party may call. */
  dispute(caller: string): Promise<PreparedCall<void>> {
    return this.prepare("dispute", [addr(caller)], asVoid);
  }

  /**
   * Splits the funds. Arbiter only.
   *
   * @param splitBps The beneficiary's share in basis points, 0–10000. The
   *   depositor receives the remainder, computed by subtraction so the two
   *   payments always sum to exactly the escrowed amount.
   */
  resolve(splitBps: number): Promise<PreparedCall<void>> {
    if (!Number.isInteger(splitBps) || splitBps < 0 || splitBps > 10_000) {
      throw new ValidationError(
        "The split must be a whole number of basis points between 0 and 10000.",
      );
    }
    return this.prepare("resolve", [u32(splitBps)], asVoid);
  }

  /** The current lifecycle position. */
  state(): Promise<EscrowStateName> {
    return this.read("state", [], parseState);
  }

  /** The full agreement. */
  get(): Promise<Escrow> {
    return this.read("get", [], parseEscrow);
  }
}
