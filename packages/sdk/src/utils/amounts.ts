import { ValidationError } from "../errors/index.js";

/**
 * Decimal places for a classic Stellar asset and for the native XLM balance.
 *
 * **The decimals trap.** This is the default, not a guarantee. A custom
 * Soroban token can declare any number of decimals, and the contracts here
 * work in the token's smallest unit without knowing or caring which. Read
 * `decimals()` off the token contract rather than assuming 7 — getting this
 * wrong scales every amount by a factor of ten.
 */
export const STROOPS_DECIMALS = 7;

/**
 * Converts a human-readable decimal string to the token's smallest unit.
 *
 * Takes a **string**, not a number: `0.1 + 0.2 !== 0.3` in float, and a
 * payment amount is exactly the wrong place to discover that. Truncation is
 * refused rather than performed silently — an amount with more precision than
 * the token supports is a mistake worth surfacing.
 *
 * @example toStroops("1.5") === 15000000n
 */
export function toStroops(
  amount: string,
  decimals: number = STROOPS_DECIMALS,
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new ValidationError(`Invalid decimals: ${decimals}`);
  }
  const trimmed = amount.trim();
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === "-") {
    throw new ValidationError(
      `"${amount}" is not a valid decimal amount. Use a plain string such as "12.50".`,
    );
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "", fraction = ""] = unsigned.split(".");

  if (fraction.length > decimals) {
    const significant = fraction.slice(decimals).replace(/0+$/, "");
    if (significant.length > 0) {
      throw new ValidationError(
        `"${amount}" has more than ${decimals} decimal places, which this token cannot represent. Round it before converting rather than losing the remainder silently.`,
      );
    }
  }

  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  const digits = `${whole || "0"}${padded}`;
  const value = BigInt(digits);
  return negative ? -value : value;
}

/**
 * Converts the token's smallest unit back to a decimal string.
 *
 * Returns a string rather than a number so that large balances survive the
 * trip: `Number` loses integer precision above 2^53.
 *
 * @example fromStroops(15000000n) === "1.5"
 */
export function fromStroops(
  amount: bigint,
  decimals: number = STROOPS_DECIMALS,
): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new ValidationError(`Invalid decimals: ${decimals}`);
  }
  if (decimals === 0) return amount.toString();

  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  const body = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${body}` : body;
}

/**
 * Formats an amount for display, keeping the token's full precision but
 * grouping the whole part so long figures stay readable in a table.
 */
export function formatAmount(
  amount: bigint,
  options: { decimals?: number; locale?: string } = {},
): string {
  const { decimals = STROOPS_DECIMALS, locale = "en-US" } = options;
  const plain = fromStroops(amount, decimals);
  const negative = plain.startsWith("-");
  const unsigned = negative ? plain.slice(1) : plain;
  const [whole = "0", fraction] = unsigned.split(".");
  const grouped = BigInt(whole).toLocaleString(locale);
  const body = fraction ? `${grouped}.${fraction}` : grouped;
  return negative ? `-${body}` : body;
}

/** Asserts an amount is strictly positive, as every contract requires. */
export function requirePositive(amount: bigint, label = "amount"): void {
  if (amount <= 0n) {
    throw new ValidationError(`The ${label} must be greater than zero.`);
  }
}
