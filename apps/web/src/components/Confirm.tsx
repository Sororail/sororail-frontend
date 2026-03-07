"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Confirmation before consequence.
 *
 * Every state-changing action in this app goes through here. The dialog shows
 * exactly what will happen — amounts, recipients, and what cannot be undone —
 * *before* the wallet prompt appears, because a signing prompt on its own tells
 * the user nothing about what they are agreeing to.
 *
 * The `irreversible` note is required rather than optional. If an action has no
 * irreversible consequence worth stating, it probably does not need a
 * confirmation dialog at all.
 */

export interface ConfirmLine {
  label: string;
  value: ReactNode;
}

export function Confirm({
  title,
  lines,
  irreversible,
  confirmLabel,
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  title: string;
  /** What will happen, itemised. Amounts, recipients, fees. */
  lines: ConfirmLine[];
  /** What cannot be undone, in plain words. */
  irreversible: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  if (!mounted) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="modal stack stack--tight">
        <h2>{title}</h2>

        <div className="modal__consequence">
          {lines.map((line) => (
            <div className="modal__line" key={line.label}>
              <span className="muted">{line.label}</span>
              <span>{line.value}</span>
            </div>
          ))}
        </div>

        <div className="notice notice--warn">
          <div className="notice__title">This cannot be undone</div>
          <div className="notice__detail">{irreversible}</div>
        </div>

        <p className="small muted" style={{ margin: 0 }}>
          Your wallet will ask you to sign after you confirm. Nothing is sent
          until you do.
        </p>

        {error ? <div className="notice notice--error">{error}</div> : null}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? "button--danger" : "button--primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Waiting for wallet…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
