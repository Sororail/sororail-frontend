"use client";

import { memo } from "react";
import { formatAmount } from "@sororail/sdk";

import { shortAddress } from "@/lib/network";

export interface MoneyProps {
  value: bigint;
  unit?: string;
  size?: "lg";
  direction?: "incoming" | "outgoing";
  /**
   * Marks a figure that is already stale when rendered.
   *
   * Stream and vesting accrual is computed from ledger time, so an "available"
   * balance keeps rising between the read and the transaction landing. A live
   * run once reported 0.00016 and withdrew 0.00026 seconds later — both
   * correct. Showing such a number as exact invites a support ticket, so it is
   * prefixed with "≥".
   */
  approximate?: boolean;
}

/**
 * #76 — Derive the display locale from the browser once at module scope so
 * every `formatAmount` call uses the visitor's grouping/decimal conventions
 * instead of always defaulting to "en-US".
 */
const BROWSER_LOCALE =
  typeof navigator !== "undefined" ? navigator.language : "en-US";

/**
 * A monetary figure.
 *
 * Amounts get more typographic weight than the labels around them and use
 * tabular figures so a column of them lines up digit for digit.
 */
export const Money = memo(function Money({
  value,
  unit = "XLM",
  size,
  direction,
  approximate = false,
}: MoneyProps) {
  const classes = [
    "amount",
    size === "lg" ? "amount--lg" : "",
    direction ? `amount--${direction}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      title={approximate ? "At least this much — accrual continues" : undefined}
    >
      {approximate ? (
        <>
          <span className="amount__approx" aria-hidden="true">
            ≥
          </span>
          <span className="sr-only">At least </span>
        </>
      ) : null}
      {formatAmount(value, { locale: BROWSER_LOCALE, ...(decimals === undefined ? {} : { decimals }) })}
      <span className="amount__unit">{unit}</span>
    </span>
  );
});

/** A contract or account address, shortened but copyable in full. */
export function Address({ value, href }: { value: string; href?: string }) {
  const short = shortAddress(value, 6);
  if (href) {
    return (
      <a className="addr" href={href} target="_blank" rel="noreferrer" title={value}>
        <span aria-hidden="true">{short}</span>
        <span className="sr-only">{value}</span>
      </a>
    );
  }
  return (
    <span className="addr" title={value}>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
