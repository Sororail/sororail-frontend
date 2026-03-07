"use client";

import { formatAmount } from "@sororail/sdk";

/**
 * A monetary figure.
 *
 * Amounts get more typographic weight than the labels around them and use
 * tabular figures so a column of them lines up digit for digit.
 */
export function Money({
  value,
  unit = "XLM",
  size,
  direction,
  /**
   * Marks a figure that is already stale when rendered.
   *
   * Stream and vesting accrual is computed from ledger time, so an "available"
   * balance keeps rising between the read and the transaction landing. A live
   * run once reported 0.00016 and withdrew 0.00026 seconds later — both
   * correct. Showing such a number as exact invites a support ticket, so it is
   * prefixed with "≥".
   */
  approximate = false,
}: {
  value: bigint;
  unit?: string;
  size?: "lg";
  direction?: "incoming" | "outgoing";
  approximate?: boolean;
}) {
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
      {approximate ? <span className="amount__approx">≥</span> : null}
      {formatAmount(value)}
      <span className="amount__unit">{unit}</span>
    </span>
  );
}

/** A contract or account address, shortened but copyable in full. */
export function Address({ value, href }: { value: string; href?: string }) {
  const short = `${value.slice(0, 6)}…${value.slice(-6)}`;
  if (href) {
    return (
      <a className="addr" href={href} target="_blank" rel="noreferrer" title={value}>
        {short}
      </a>
    );
  }
  return (
    <span className="addr" title={value}>
      {short}
    </span>
  );
}
