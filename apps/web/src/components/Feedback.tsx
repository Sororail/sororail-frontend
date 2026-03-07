"use client";

import { ContractError, NetworkError, ValidationError } from "@sororail/sdk";
import type { ReactNode } from "react";

import { explorerTx } from "@/lib/network";

/**
 * Errors say what happened and what to do about it.
 *
 * A raw contract code is never shown. The SDK has already decoded the failure
 * into a sentence; this adds the recovery step where there is one, and keeps
 * the code visible only as small secondary detail for a bug report.
 */

function recoveryFor(error: unknown): string | null {
  if (!(error instanceof ContractError)) return null;
  switch (error.variant) {
    case "StreamInsufficientAccrued":
      return "The accrued balance moves as time passes. Refresh and try again with the amount shown, or withdraw everything available.";
    case "RecurringPeriodNotElapsed":
      return "Wait until the next charge date shown above. Periods that pass uncharged cannot be claimed later.";
    case "BatchTooLarge":
      return "Split the payroll into smaller batches. The app can do this for you — reload and try again.";
    case "DeadlineNotReached":
      return "Only the arbiter can act before the deadline. Wait, or ask the arbiter to refund.";
    case "VestingCliffNotReached":
      return "Nothing is claimable until the cliff date. The schedule above shows when that is.";
    case "AlreadyInitialized":
      return "This contract already holds a position. Deploy a new instance for a new one.";
    case "NotInitialized":
      return "This contract has not been set up yet. Create the position first.";
    case "Unauthorized":
      return "The connected wallet is not a party to this contract. Switch accounts and try again.";
    default:
      return null;
  }
}

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;

  const recovery = recoveryFor(error);
  const message =
    error instanceof Error ? error.message : "Something went wrong.";

  let heading = "That did not work";
  if (error instanceof ValidationError) heading = "Check the details";
  if (error instanceof NetworkError) heading = "Could not reach the network";

  return (
    <div className="notice notice--error">
      <div className="notice__title">{heading}</div>
      <div>{message}</div>
      {recovery ? <div className="notice__detail">{recovery}</div> : null}
      {error instanceof ContractError ? (
        <div className="notice__detail" style={{ marginTop: "0.35rem" }}>
          {error.contract} · {error.variant} · code {error.code}
        </div>
      ) : null}
    </div>
  );
}

export function SuccessNotice({
  children,
  hash,
}: {
  children: ReactNode;
  hash?: string;
}) {
  return (
    <div className="notice notice--info">
      <div>{children}</div>
      {hash ? (
        <div className="notice__detail">
          <a href={explorerTx(hash)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** Empty states state the next action rather than just reporting emptiness. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 600, color: "var(--text)" }}>{title}</div>
      <div className="small" style={{ marginTop: "0.25rem" }}>
        {children}
      </div>
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}
