import { describe, expect, it } from "vitest";

import {
  STROOPS_DECIMALS,
  formatAmount,
  fromStroops,
  toStroops,
} from "../src/utils/amounts.js";
import { ValidationError } from "../src/errors/index.js";

describe("toStroops", () => {
  it("converts whole and fractional amounts", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("1.5")).toBe(15_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
    expect(toStroops("0")).toBe(0n);
  });

  it("handles negatives and odd but valid spellings", () => {
    expect(toStroops("-2.5")).toBe(-25_000_000n);
    expect(toStroops(".5")).toBe(5_000_000n);
    expect(toStroops("3.")).toBe(30_000_000n);
    expect(toStroops("  1.25  ")).toBe(12_500_000n);
  });

  it("keeps precision that a float would lose", () => {
    // 0.1 + 0.2 !== 0.3 in float; in stroops it is exact.
    expect(toStroops("0.1") + toStroops("0.2")).toBe(toStroops("0.3"));
  });

  it("survives amounts beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = "922337203685.4775807";
    expect(toStroops(huge)).toBe(9_223_372_036_854_775_807n);
  });

  it("refuses to silently truncate excess precision", () => {
    expect(() => toStroops("1.12345678")).toThrow(ValidationError);
    // ...but trailing zeros beyond the limit are not a loss.
    expect(toStroops("1.50000000")).toBe(15_000_000n);
  });

  it("rejects things that are not decimal amounts", () => {
    for (const bad of ["", "-", "abc", "1.2.3", "1e5", "0x10", "1,000"]) {
      expect(() => toStroops(bad), bad).toThrow(ValidationError);
    }
  });

  it("honours a custom decimals value", () => {
    expect(toStroops("1.5", 2)).toBe(150n);
    expect(toStroops("1", 0)).toBe(1n);
    expect(() => toStroops("1", -1)).toThrow(ValidationError);
  });
});

describe("fromStroops", () => {
  it("round-trips", () => {
    for (const amount of ["0", "1", "1.5", "-2.25", "0.0000001", "12345.6789"]) {
      expect(fromStroops(toStroops(amount))).toBe(
        amount === "0" ? "0" : amount,
      );
    }
  });

  it("trims trailing zeros but keeps significant digits", () => {
    expect(fromStroops(15_000_000n)).toBe("1.5");
    expect(fromStroops(10_000_000n)).toBe("1");
    expect(fromStroops(1n)).toBe("0.0000001");
    expect(fromStroops(0n)).toBe("0");
  });

  it("handles negatives and zero decimals", () => {
    expect(fromStroops(-15_000_000n)).toBe("-1.5");
    expect(fromStroops(42n, 0)).toBe("42");
  });

  it("does not lose precision on large balances", () => {
    const huge = 9_223_372_036_854_775_807n;
    expect(fromStroops(huge)).toBe("922337203685.4775807");
  });
});

describe("formatAmount", () => {
  it("groups the whole part for legibility", () => {
    expect(formatAmount(12_345_678_900_000n)).toBe("1,234,567.89");
    expect(formatAmount(10_000_000n)).toBe("1");
    expect(formatAmount(-12_345_678_900_000n)).toBe("-1,234,567.89");
  });
});

it("documents the default decimals", () => {
  expect(STROOPS_DECIMALS).toBe(7);
});
