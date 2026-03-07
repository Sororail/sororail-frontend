import { nativeToScVal, xdr } from "@stellar/stellar-sdk";

import { ValidationError } from "../errors/index.js";

/** Builders for contract arguments, so call sites stay readable. */

export function addr(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "address" });
}

export function i128(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

export function u64(value: bigint | number): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: "u64" });
}

export function u32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

export function bool(value: boolean): xdr.ScVal {
  return nativeToScVal(value, { type: "bool" });
}

/** `Option<T>`: `null`/`undefined` becomes void, anything else the value. */
export function some(value: xdr.ScVal | null | undefined): xdr.ScVal {
  return value ?? xdr.ScVal.scvVoid();
}

export function optionAddress(value: string | null | undefined): xdr.ScVal {
  return value == null ? xdr.ScVal.scvVoid() : addr(value);
}

export function optionI128(value: bigint | null | undefined): xdr.ScVal {
  return value == null ? xdr.ScVal.scvVoid() : i128(value);
}

export function optionU32(value: number | null | undefined): xdr.ScVal {
  return value == null ? xdr.ScVal.scvVoid() : u32(value);
}

export function vec(values: xdr.ScVal[]): xdr.ScVal {
  return xdr.ScVal.scvVec(values);
}

/** Parsers for what `scValToNative` hands back. */

export function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  throw new ValidationError(
    `Expected an integer for "${field}", got ${JSON.stringify(value)}. The deployed contract may not match this SDK version.`,
  );
}

export function asNumber(value: unknown, field: string): number {
  const big = asBigInt(value, field);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError(`"${field}" is too large to represent as a number.`);
  }
  return Number(big);
}

export function asString(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  throw new ValidationError(
    `Expected an address or string for "${field}", got ${JSON.stringify(value)}.`,
  );
}

export function asBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  throw new ValidationError(
    `Expected a boolean for "${field}", got ${JSON.stringify(value)}.`,
  );
}

/** `Option<T>` comes back as `undefined` or `null` when empty. */
export function asOptional<T>(
  value: unknown,
  parse: (value: unknown) => T,
): T | null {
  return value === undefined || value === null ? null : parse(value);
}

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new ValidationError(
    `Expected a ${what} struct from the contract, got ${JSON.stringify(value)}.`,
  );
}

/** Discards a return value, for entry points that return `()`. */
export function asVoid(): void {
  return undefined;
}
