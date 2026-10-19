import { describe, expect, it } from "vitest";

import {
  STROOPS_DECIMALS,
  formatAmount,
  fromStroops,
  requirePositive,
  toStroops,
} from "../src/utils/amounts.js";
import { SororailError, ValidationError } from "../src/errors/index.js";

describe("toStroops", () => {
  it("converts whole and fractional amounts", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("1.5")).toBe(15_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
    expect(toStroops("0")).toBe(0n);
  });

  // #228: Cover thousands separators
  it("handles thousands separators across spreadsheet and human inputs (#228)", () => {
    expect(toStroops("1,000")).toBe(10_000_000_000n);
    expect(toStroops("1,234.50")).toBe(12_345_000_000n);
    expect(toStroops("1,000,000")).toBe(10_000_000_000_000n);
    expect(toStroops("1,234,567.8901234")).toBe(12_345_678_901_234n);
    expect(toStroops("-1,234.50")).toBe(-12_345_000_000n);
    expect(toStroops("10,000,000.0000001")).toBe(100_000_000_000_001n);
  });

  // #228: Cover negative sign handling
  it("handles negative sign variations and values (#228)", () => {
    expect(toStroops("-1")).toBe(-10_000_000n);
    expect(toStroops("-2.5")).toBe(-25_000_000n);
    expect(toStroops("-0.0000001")).toBe(-1n);
    expect(toStroops("-0.5")).toBe(-5_000_000n);
    expect(toStroops("-.5")).toBe(-5_000_000n);
    expect(toStroops("-.0000001")).toBe(-1n);
    expect(toStroops("-0")).toBe(0n);
    expect(toStroops("-0.0")).toBe(0n);
    expect(toStroops("-0.0000000")).toBe(0n);
    expect(toStroops("-922337203685.4775807")).toBe(-9_223_372_036_854_775_807n);
  });

  // #228: Rejects malformed negative signs
  it("rejects invalid negative sign placement and syntax (#228)", () => {
    for (const bad of ["--1", "- 1", "-.", " - . ", "+1", "+1.5", "-abc"]) {
      expect(() => toStroops(bad), bad).toThrow(ValidationError);
    }
  });

  // #228: Cover leading-dot input
  it("handles leading-dot inputs correctly (#228)", () => {
    expect(toStroops(".5")).toBe(5_000_000n);
    expect(toStroops(".0000001")).toBe(1n);
    expect(toStroops(".1234567")).toBe(1_234_567n);
    expect(toStroops(".0")).toBe(0n);
    expect(toStroops(".00")).toBe(0n);
    expect(toStroops("  .5  ")).toBe(5_000_000n);
    // Trailing zeros beyond token precision do not lose value
    expect(toStroops(".50000000")).toBe(5_000_000n);
    // Excess non-zero precision with leading dot throws
    expect(() => toStroops(".12345678")).toThrow(ValidationError);
  });

  // #228: Cover decimals bounds check (0 and 38)
  it("respects decimals boundary values 0 and 38 (#228)", () => {
    // 0 decimals boundary
    expect(toStroops("1", 0)).toBe(1n);
    expect(toStroops("0", 0)).toBe(0n);
    expect(toStroops("-42", 0)).toBe(-42n);
    expect(toStroops("100.0", 0)).toBe(100n);
    expect(() => toStroops("100.1", 0)).toThrow(ValidationError);

    // 38 decimals boundary
    const expected38 = 10n ** 38n;
    expect(toStroops("1", 38)).toBe(expected38);
    expect(toStroops("0", 38)).toBe(0n);
    expect(toStroops("-1", 38)).toBe(-expected38);
    expect(toStroops("0." + "0".repeat(37) + "1", 38)).toBe(1n);

    // Rejecting excess precision at 38 decimals
    expect(() => toStroops("0." + "0".repeat(38) + "1", 38)).toThrow(
      ValidationError,
    );
  });

  // #228: Decimals out of bounds check
  it("rejects invalid decimals bounds and non-integers (#228)", () => {
    expect(() => toStroops("1", -1)).toThrow(ValidationError);
    expect(() => toStroops("1", -1)).toThrow("Invalid decimals: -1");
    expect(() => toStroops("1", 39)).toThrow(ValidationError);
    expect(() => toStroops("1", 39)).toThrow("Invalid decimals: 39");
    expect(() => toStroops("1", 100)).toThrow(ValidationError);
    expect(() => toStroops("1", 1.5)).toThrow(ValidationError);
    expect(() => toStroops("1", NaN)).toThrow(ValidationError);
    expect(() => toStroops("1", Infinity)).toThrow(ValidationError);
  });

  it("handles odd but valid spellings", () => {
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
    expect(toStroops(huge) + toStroops("0.0000001")).toBe(
      9_223_372_036_854_775_808n,
    );
  });

  it("refuses to silently truncate excess precision", () => {
    expect(() => toStroops("1.12345678")).toThrow(ValidationError);
    // ...but trailing zeros beyond the limit are not a loss.
    expect(toStroops("1.50000000")).toBe(15_000_000n);
  });

  it("rejects things that are not decimal amounts", () => {
    for (const bad of ["", "-", "abc", "1.2.3", "1e5", "0x10", "1 000"]) {
      expect(() => toStroops(bad), bad).toThrow(ValidationError);
    }
  });

  it("honours a custom decimals value", () => {
    expect(toStroops("1.5", 2)).toBe(150n);
    expect(toStroops("1", 0)).toBe(1n);
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

  // #229: Cover zero across different decimal settings
  it("converts zero amounts across all valid decimals (#229)", () => {
    expect(fromStroops(0n)).toBe("0");
    expect(fromStroops(0n, 0)).toBe("0");
    expect(fromStroops(0n, 1)).toBe("0");
    expect(fromStroops(0n, 2)).toBe("0");
    expect(fromStroops(0n, 7)).toBe("0");
    expect(fromStroops(0n, 18)).toBe("0");
    expect(fromStroops(0n, 38)).toBe("0");
    expect(fromStroops(-0n)).toBe("0");
  });

  // #229: Cover negative values
  it("converts negative values and preserves signs (#229)", () => {
    expect(fromStroops(-10_000_000n)).toBe("-1");
    expect(fromStroops(-15_000_000n)).toBe("-1.5");
    expect(fromStroops(-1n)).toBe("-0.0000001");
    expect(fromStroops(-5_000_000n)).toBe("-0.5");
    expect(fromStroops(-42n, 0)).toBe("-42");
    expect(fromStroops(-150n, 2)).toBe("-1.5");
    expect(fromStroops(-9_223_372_036_854_775_807n)).toBe("-922337203685.4775807");
    expect(fromStroops(-(10n ** 38n), 38)).toBe("-1");
    expect(fromStroops(-1n, 38)).toBe("-0." + "0".repeat(37) + "1");
  });

  // #229: Cover values with trailing zeros in the fraction being trimmed
  it("trims trailing zeros from the fraction and drops trailing decimal point (#229)", () => {
    expect(fromStroops(15_000_000n)).toBe("1.5");
    expect(fromStroops(10_000_000n)).toBe("1");
    expect(fromStroops(12_340_000n)).toBe("1.234");
    expect(fromStroops(100_000_000n)).toBe("10");
    expect(fromStroops(1_000_000n)).toBe("0.1");
    expect(fromStroops(100n)).toBe("0.00001");
    expect(fromStroops(10n)).toBe("0.000001");
    expect(fromStroops(1n)).toBe("0.0000001");

    // Negative values with trailing zeros trimmed
    expect(fromStroops(-15_000_000n)).toBe("-1.5");
    expect(fromStroops(-10_000_000n)).toBe("-1");
    expect(fromStroops(-12_340_000n)).toBe("-1.234");
    expect(fromStroops(-100_000_000n)).toBe("-10");
    expect(fromStroops(-1_000_000n)).toBe("-0.1");

    // Custom decimals (e.g. 18 decimals)
    expect(fromStroops(1_500_000_000_000_000_000n, 18)).toBe("1.5");
    expect(fromStroops(1_000_000_000_000_000_000n, 18)).toBe("1");
    expect(fromStroops(2_000_000_000_000_000_000n, 18)).toBe("2");
  });

  it("handles decimals bounds validation", () => {
    expect(() => fromStroops(100n, -1)).toThrow(ValidationError);
    expect(() => fromStroops(100n, -1)).toThrow("Invalid decimals: -1");
    expect(() => fromStroops(100n, 39)).toThrow(ValidationError);
    expect(() => fromStroops(100n, 39)).toThrow("Invalid decimals: 39");
    expect(() => fromStroops(100n, 2.5)).toThrow(ValidationError);
    expect(() => fromStroops(100n, NaN)).toThrow(ValidationError);
  });

  it("does not lose precision on large balances", () => {
    const huge = 9_223_372_036_854_775_807n;
    expect(fromStroops(huge)).toBe("922337203685.4775807");
  });
});

describe("formatAmount", () => {
  // #230: Cover grouping separators
  it("groups the whole part for legibility across amounts (#230)", () => {
    expect(formatAmount(12_345_678_900_000n)).toBe("1,234,567.89");
    expect(formatAmount(1_000_0000000n)).toBe("1,000");
    expect(formatAmount(10_000_000n)).toBe("1");
    expect(formatAmount(100_0000000n)).toBe("100");
    expect(formatAmount(999_0000000n)).toBe("999");
    expect(formatAmount(1_000_000_000_0000000n)).toBe("1,000,000,000");
    expect(formatAmount(0n)).toBe("0");
    expect(formatAmount(5_000_000n)).toBe("0.5");
    expect(formatAmount(1n)).toBe("0.0000001");
  });

  // #230: Negative values with grouping separators
  it("formats negative amounts with grouping separators (#230)", () => {
    expect(formatAmount(-12_345_678_900_000n)).toBe("-1,234,567.89");
    expect(formatAmount(-1_000_0000000n)).toBe("-1,000");
    expect(formatAmount(-10_000_000n)).toBe("-1");
    expect(formatAmount(-5_000_000n)).toBe("-0.5");
    expect(formatAmount(-1n)).toBe("-0.0000001");
  });

  // #230: Custom decimals argument
  it("honours custom decimals arguments (#230)", () => {
    // 0 decimals
    expect(formatAmount(1_000n, { decimals: 0 })).toBe("1,000");
    expect(formatAmount(1_234_567n, { decimals: 0 })).toBe("1,234,567");
    expect(formatAmount(-1_000_000n, { decimals: 0 })).toBe("-1,000,000");

    // 2 decimals
    expect(formatAmount(123_456n, { decimals: 2 })).toBe("1,234.56");
    expect(formatAmount(100_000n, { decimals: 2 })).toBe("1,000");
    expect(formatAmount(50n, { decimals: 2 })).toBe("0.5");

    // 18 decimals
    expect(
      formatAmount(1_234_567_000_000_000_000_000_000n, { decimals: 18 }),
    ).toBe("1,234,567");
    expect(
      formatAmount(1_234_567_500_000_000_000_000_000n, { decimals: 18 }),
    ).toBe("1,234,567.5");
  });

  // #230: Very large bigint inputs
  it("formats very large bigint inputs beyond Number.MAX_SAFE_INTEGER (#230)", () => {
    const huge = 9_223_372_036_854_775_807n;
    expect(formatAmount(huge)).toBe("922,337,203,685.4775807");

    // Bigint with massive whole part
    const quintillionStroops = 1_000_000_000_000_000_000_0000000n;
    expect(formatAmount(quintillionStroops)).toBe("1,000,000,000,000,000,000");

    const hugeWithFraction = 1_000_000_000_000_000_000_0000001n;
    expect(formatAmount(hugeWithFraction)).toBe(
      "1,000,000,000,000,000,000.0000001",
    );
    expect(formatAmount(-hugeWithFraction)).toBe(
      "-1,000,000,000,000,000,000.0000001",
    );

    // Astronomical size
    const astronomical = 10n ** 37n;
    expect(formatAmount(astronomical)).toBe(
      "1,000,000,000,000,000,000,000,000,000,000",
    );
  });
});

describe("requirePositive", () => {
  // #231: Assert zero throws ValidationError with label included
  it("throws ValidationError for zero input with default and custom labels (#231)", () => {
    // Default label: "amount"
    expect(() => requirePositive(0n)).toThrow(ValidationError);
    expect(() => requirePositive(0n)).toThrow(
      "The amount must be greater than zero.",
    );

    // Custom labels
    expect(() => requirePositive(0n, "payout amount")).toThrow(ValidationError);
    expect(() => requirePositive(0n, "payout amount")).toThrow(
      "The payout amount must be greater than zero.",
    );

    expect(() => requirePositive(0n, "deposit")).toThrow(
      "The deposit must be greater than zero.",
    );
    expect(() => requirePositive(0n, "balance")).toThrow(
      "The balance must be greater than zero.",
    );
  });

  // #231: Assert negative throws ValidationError with label included
  it("throws ValidationError for negative inputs with default and custom labels (#231)", () => {
    // Default label: "amount"
    expect(() => requirePositive(-1n)).toThrow(ValidationError);
    expect(() => requirePositive(-1n)).toThrow(
      "The amount must be greater than zero.",
    );
    expect(() => requirePositive(-10_000_000n)).toThrow(
      "The amount must be greater than zero.",
    );

    // Custom labels
    expect(() => requirePositive(-1n, "fee")).toThrow(ValidationError);
    expect(() => requirePositive(-1n, "fee")).toThrow(
      "The fee must be greater than zero.",
    );

    expect(() => requirePositive(-500n, "initial balance")).toThrow(
      "The initial balance must be greater than zero.",
    );
    expect(() => requirePositive(-9_223_372_036_854_775_807n, "transfer limit")).toThrow(
      "The transfer limit must be greater than zero.",
    );
  });

  // #231: Assert strictly positive values succeed
  it("succeeds without throwing for strictly positive values (#231)", () => {
    expect(() => requirePositive(1n)).not.toThrow();
    expect(() => requirePositive(10_000_000n)).not.toThrow();
    expect(() => requirePositive(10_000_000n, "custom")).not.toThrow();
    expect(() => requirePositive(9_223_372_036_854_775_807n)).not.toThrow();
    expect(() => requirePositive(10n ** 30n, "huge amount")).not.toThrow();
  });

  // #231: Verify error inheritance and instance properties
  it("throws an error that is an instance of ValidationError and SororailError (#231)", () => {
    try {
      requirePositive(0n, "stream amount");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err).toBeInstanceOf(SororailError);
      expect((err as ValidationError).message).toBe(
        "The stream amount must be greater than zero.",
      );
    }
  });
});

it("documents the default decimals", () => {
  expect(STROOPS_DECIMALS).toBe(7);
});
