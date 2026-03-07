import {
  ErrorCode,
  errorCodeNames,
  errorMessages,
  type ErrorCodeName,
} from "./codes.js";

export { ErrorCode, errorCodeNames, errorMessages };
export type { ErrorCodeName, ErrorCodeValue } from "./codes.js";

/** Which contract a decoded error came from, inferred from its code range. */
export type ContractName =
  | "escrow"
  | "stream"
  | "vesting"
  | "recurring"
  | "batch_payout"
  | "common";

/** Maps a code to the contract that owns its reserved range. */
export function contractForCode(code: number): ContractName {
  if (code >= 100 && code <= 119) return "batch_payout";
  if (code >= 80 && code <= 99) return "recurring";
  if (code >= 60 && code <= 79) return "vesting";
  if (code >= 40 && code <= 59) return "stream";
  if (code >= 20 && code <= 39) return "escrow";
  return "common";
}

/** Base class for everything this SDK throws. */
export class SororailError extends Error {
  override readonly name: string = "SororailError";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * A failure returned by a contract, decoded from its numeric code.
 *
 * The numeric `code` is preserved so callers can branch on it precisely,
 * `name` gives the variant, and `message` is the sentence to show a user.
 */
export class ContractError extends SororailError {
  override readonly name: string = "ContractError";
  /** The ABI integer. Stable across contract versions. */
  readonly code: number;
  /** The variant name, e.g. `StreamInsufficientAccrued`. */
  readonly variant: ErrorCodeName | "Unknown";
  /** Which contract owns this code's range. */
  readonly contract: ContractName;

  constructor(
    code: number,
    variant: ErrorCodeName | "Unknown",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.code = code;
    this.variant = variant;
    this.contract = contractForCode(code);
  }

  /** Whether this is the given variant. */
  is(variant: ErrorCodeName): boolean {
    return this.variant === variant;
  }
}

/** Thrown when a call could not be simulated or submitted at all. */
export class NetworkError extends SororailError {
  override readonly name: string = "NetworkError";
}

/** Thrown when arguments fail validation before anything is sent. */
export class ValidationError extends SororailError {
  override readonly name: string = "ValidationError";
}

/**
 * Extracts the numeric contract error code from a host error.
 *
 * The RPC surfaces contract failures as strings containing
 * `Error(Contract, #N)`. This is deliberately tolerant: the exact shape has
 * changed between protocol versions, so several spellings are matched, and
 * anything unrecognised returns `undefined` rather than a wrong code.
 */
export function extractErrorCode(input: unknown): number | undefined {
  const text =
    typeof input === "string"
      ? input
      : input instanceof Error
        ? `${input.message} ${JSON.stringify((input as { cause?: unknown }).cause ?? "")}`
        : (() => {
            try {
              return JSON.stringify(input);
            } catch {
              return String(input);
            }
          })();

  const patterns = [
    /Error\(Contract,\s*#(\d+)\)/, // Error(Contract, #42)
    /ContractError\((\d+)\)/, // ContractError(42)
    /"contract_error"\s*:\s*(\d+)/, // JSON-ish
    /#(\d+)\s*\)?\s*$/, // trailing #42
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1] !== undefined) {
      const code = Number.parseInt(match[1], 10);
      if (Number.isFinite(code)) return code;
    }
  }
  return undefined;
}

/**
 * Turns whatever the RPC threw into a typed error.
 *
 * A recognised contract code becomes a {@link ContractError} carrying a
 * readable message. Anything else becomes a {@link NetworkError} with the
 * original attached as `cause` — never a bare code, and never a silently
 * swallowed failure.
 */
export function decodeError(input: unknown): SororailError {
  if (input instanceof SororailError) return input;

  const code = extractErrorCode(input);
  if (code !== undefined) {
    const variant = errorCodeNames.get(code);
    if (variant) {
      return new ContractError(code, variant, errorMessages[variant], {
        cause: input,
      });
    }
    return new ContractError(
      code,
      "Unknown",
      `The contract failed with code ${code}, which this version of the SDK does not recognise. It may be newer than the SDK.`,
      { cause: input },
    );
  }

  const message = input instanceof Error ? input.message : String(input);
  return new NetworkError(message, { cause: input });
}

/** Rethrows `input` as a typed SoroRail error. Never returns. */
export function throwDecoded(input: unknown): never {
  throw decodeError(input);
}
