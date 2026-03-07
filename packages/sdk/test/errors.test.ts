import { describe, expect, it } from "vitest";

import {
  ContractError,
  ErrorCode,
  NetworkError,
  ValidationError,
  contractForCode,
  decodeError,
  errorCodeNames,
  errorMessages,
  extractErrorCode,
} from "../src/errors/index.js";

describe("the code table", () => {
  it("matches the ranges reserved in sororail_common::errors", () => {
    // Spot-check a boundary from each contract's range. If these drift, a
    // client will decode a failure as the wrong thing.
    expect(ErrorCode.AlreadyInitialized).toBe(1);
    expect(ErrorCode.InvalidDuration).toBe(14);
    expect(ErrorCode.EscrowNotFundable).toBe(20);
    expect(ErrorCode.StreamNotFound).toBe(40);
    expect(ErrorCode.VestingNotFound).toBe(60);
    expect(ErrorCode.RecurringNotFound).toBe(80);
    expect(ErrorCode.BatchEmpty).toBe(100);
  });

  it("assigns no code twice", () => {
    const codes = Object.values(ErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("leaves 102 burned", () => {
    // BatchDuplicateRecipient was removed before release; the number is not
    // reused, so a stale client decoding 102 gets "unknown" rather than a
    // confidently wrong answer.
    expect(errorCodeNames.has(102)).toBe(false);
  });

  it("gives every variant a readable message", () => {
    for (const name of Object.keys(ErrorCode) as (keyof typeof ErrorCode)[]) {
      const message = errorMessages[name];
      expect(message, name).toBeTruthy();
      // A user must never see a bare code, so no message may be just the name.
      expect(message, name).not.toBe(name);
      expect(message.length, name).toBeGreaterThan(15);
    }
  });
});

describe("contractForCode", () => {
  it("routes each range to its owner", () => {
    expect(contractForCode(1)).toBe("common");
    expect(contractForCode(22)).toBe("escrow");
    expect(contractForCode(43)).toBe("stream");
    expect(contractForCode(61)).toBe("vesting");
    expect(contractForCode(82)).toBe("recurring");
    expect(contractForCode(101)).toBe("batch_payout");
  });
});

describe("extractErrorCode", () => {
  it("reads the host's Error(Contract, #N) form", () => {
    expect(
      extractErrorCode("HostError: Error(Contract, #43)"),
    ).toBe(43);
  });

  it("tolerates the other shapes the RPC has used", () => {
    expect(extractErrorCode("ContractError(21)")).toBe(21);
    expect(extractErrorCode('{"contract_error": 61}')).toBe(61);
  });

  it("reads through an Error object", () => {
    expect(extractErrorCode(new Error("failed: Error(Contract, #2)"))).toBe(2);
  });

  it("returns undefined rather than guessing", () => {
    expect(extractErrorCode("connection reset")).toBeUndefined();
    expect(extractErrorCode(null)).toBeUndefined();
    expect(extractErrorCode({ nothing: true })).toBeUndefined();
  });
});

describe("decodeError", () => {
  it("turns a known code into a typed, readable error", () => {
    const error = decodeError("HostError: Error(Contract, #43)");
    expect(error).toBeInstanceOf(ContractError);
    const contractError = error as ContractError;
    expect(contractError.code).toBe(43);
    expect(contractError.variant).toBe("StreamInsufficientAccrued");
    expect(contractError.contract).toBe("stream");
    expect(contractError.is("StreamInsufficientAccrued")).toBe(true);
    expect(contractError.message).toMatch(/more than has accrued/i);
  });

  it("keeps an unknown code rather than pretending", () => {
    const error = decodeError("Error(Contract, #999)") as ContractError;
    expect(error).toBeInstanceOf(ContractError);
    expect(error.code).toBe(999);
    expect(error.variant).toBe("Unknown");
    expect(error.message).toMatch(/does not recognise/i);
  });

  it("falls back to NetworkError with the cause attached", () => {
    const cause = new Error("socket hang up");
    const error = decodeError(cause);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toBe("socket hang up");
    expect(error.cause).toBe(cause);
  });

  it("passes our own errors through untouched", () => {
    const original = new ValidationError("bad input");
    expect(decodeError(original)).toBe(original);
  });

  it("explains the consumer-protection rule on recurring", () => {
    const error = decodeError("Error(Contract, #82)") as ContractError;
    expect(error.variant).toBe("RecurringPeriodNotElapsed");
    expect(error.message).toMatch(/not billable later/i);
  });

  it("tells a caller how to recover from an oversized batch", () => {
    const error = decodeError("Error(Contract, #101)") as ContractError;
    expect(error.variant).toBe("BatchTooLarge");
    expect(error.message).toMatch(/maxRecipients/);
  });
});
