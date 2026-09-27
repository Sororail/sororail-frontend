import { describe, expect, it } from "vitest";
import { Money } from "../src/components/Money";

describe("Money component", () => {
  it("is memoized with React.memo", () => {
    // React memo elements have $$typeof Symbol(react.memo)
    const moneyAny = Money as unknown as { $$typeof: symbol; type: unknown };
    expect(moneyAny.$$typeof).toBe(Symbol.for("react.memo"));
    expect(typeof moneyAny.type).toBe("function");
  });
});
