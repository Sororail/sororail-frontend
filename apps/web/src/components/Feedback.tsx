"use client";

import {
  ContractError,
  NetworkError,
  NetworkMismatchError,
  SigningError,
  ValidationError,
} from "@sororail/sdk";
import type { ReactNode } from "react";

import { explorerTx } from "@/lib/network";
import { recoveryFor } from "@/lib/recovery";

/**
 * Errors say what happened and what to do about it.
 *
 * A raw contract code is never shown. The SDK has already decoded the failure
 * into a sentence; `recoveryFor` adds the next step for every variant, and
 * this keeps technical details behind a disclosure for a bug report. Unknown
 * failures use a generic message instead of exposing raw browser or library
 * output.
 */

export function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;

  const recovery = recoveryFor(error);
  // Wallet failures (declined, locked, switched account, wrong network) carry
  // a message written for a person too, so they are shown rather than hidden.
  const isSdkError =
    error instanceof ContractError ||
    error instanceof NetworkError ||
    error instanceof ValidationError ||
    error instanceof SigningError;
  const message =
    isSdkError ? error.message : "Something went wrong. Please try again.";
  const details =
    error instanceof ContractError
      ? `${error.contract} · ${error.variant} · code ${error.code}`
      : !isSdkError && error instanceof Error
        ? `${error.name}: ${error.message}`
        : typeof error === "string"
          ? error
          : null;

  let heading = "That did not work";
  if (error instanceof ValidationError) heading = "Check the details";
  if (error instanceof NetworkError) heading = "Could not reach the network";
  if (error instanceof SigningError) heading = "Check your wallet";
  if (error instanceof NetworkMismatchError) heading = "Wrong network in Freighter";

  return (
    <div className="notice notice--error" role="alert" aria-live="assertive">
      <div className="notice__title">{heading}</div>
      <div>{message}</div>
      {recovery ? <div className="notice__detail">{recovery}</div> : null}
      {details ? (
        <details className="notice__detail notice__technical">
          <summary>Technical details</summary>
          <div>{details}</div>
        </details>
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
  // No link when the configured network has no explorer to point at.
  const href = hash ? explorerTx(hash) : null;
  return (
    <div className="notice notice--info" role="status" aria-live="polite">
      <div>{children}</div>
      {href ? (
        <div className="notice__detail">
          <a href={href} target="_blank" rel="noreferrer">
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
      <div className="empty__title">{title}</div>
      <div className="small empty__description">
        {children}
      </div>
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}
