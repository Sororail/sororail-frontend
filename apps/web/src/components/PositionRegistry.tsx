"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ContractLink } from "@/components/ContractLink";
import {
  addPosition,
  exportPositions,
  getPositionsSnapshot,
  importPositions,
  looksLikeContractId,
  removePosition,
  renamePosition,
  restorePosition,
  subscribePositions,
  type Position,
  type PositionKind,
} from "@/lib/positions";

const UNDO_WINDOW_MS = 6000;

/** Stable SSR snapshot: localStorage does not exist on the server. */
const SERVER_POSITIONS: Position[] = [];

/**
 * Subscribes to the local registry, re-reading when it changes.
 *
 * `useSyncExternalStore` reads the snapshot during the first client render
 * rather than in an effect, so the empty state can no longer flash before
 * `localStorage` is consulted, and several components on one page share one
 * consistent read instead of four parallel parses.
 */
export function usePositions(kind: PositionKind): Position[] {
  return useSyncExternalStore(
    subscribePositions,
    () => getPositionsSnapshot(kind),
    () => SERVER_POSITIONS,
  );
}

/**
 * Registers a contract address with the app.
 *
 * Needed because each position is its own deployed contract, so there is no
 * on-chain way to ask "which streams are mine?". The note below says so
 * plainly rather than leaving the user wondering why they must paste an
 * address.
 */
export function AddPositionForm({
  kind,
  noun,
}: {
  kind: PositionKind;
  noun: string;
}) {
  const [contractId, setContractId] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!looksLikeContractId(contractId)) {
      setError(
        "That does not look like a contract address. It should start with C and be 56 characters with a valid checksum.",
      );
      return;
    }
    const added = addPosition(kind, contractId, label);
    if (!added) {
      setError("That contract address is already tracked.");
      return;
    }
    setContractId("");
    setLabel("");
    setError(null);
  }

  return (
    <form className="card stack stack--tight" onSubmit={submit}>
      <h3>Track an existing {noun}</h3>
      <p className="small muted m-0">
        Each {noun} is its own deployed contract, so there is no way to look up
        yours from your account. Paste the address and this browser will
        remember it. The list is local only — every figure shown is read from
        the chain, and forgetting an address changes nothing on chain.
      </p>
      <div className="field">
        <label className="label" htmlFor={`${kind}-id`}>
          Contract address
        </label>
        <input
          id={`${kind}-id`}
          className="mono"
          value={contractId}
          onChange={(event) => setContractId(event.target.value)}
          placeholder="C…"
          spellCheck={false}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${kind}-label`}>
          Name (optional)
        </label>
        <input
          id={`${kind}-label`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={`e.g. ${noun} for Ada`}
        />
      </div>
      {error ? <div className="field__error">{error}</div> : null}
      <div>
        <button type="submit" className="button--primary">
          Track {noun}
        </button>
      </div>
    </form>
  );
}

export function PositionHeader({ position }: { position: Position }) {
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(position.label);
  const [pendingRemoval, setPendingRemoval] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  function startRemoval() {
    removePosition(position.contractId);
    setPendingRemoval(true);
    undoTimer.current = setTimeout(() => setPendingRemoval(false), UNDO_WINDOW_MS);
  }

  function undoRemoval() {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    restorePosition(position);
    setPendingRemoval(false);
  }

  function submitRename(event: React.FormEvent) {
    event.preventDefault();
    renamePosition(position.contractId, draftLabel);
    setEditing(false);
  }

  if (pendingRemoval) {
    return (
      <div className="spread" role="status">
        <p className="small muted m-0">
          Stopped tracking &ldquo;{position.label}&rdquo;. The contract is untouched.
        </p>
        <button type="button" className="button--quiet" onClick={undoRemoval}>
          Undo
        </button>
      </div>
    );
  }

  return (
    <div className="spread">
      <div>
        {editing ? (
          <form className="row" onSubmit={submitRename}>
            <input
              autoFocus
              value={draftLabel}
              onChange={(event) => setDraftLabel(event.target.value)}
              aria-label="Rename position"
            />
            <button type="submit" className="button--quiet">
              Save
            </button>
            <button
              type="button"
              className="button--quiet"
              onClick={() => {
                setDraftLabel(position.label);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <h3>
            {position.label}{" "}
            <button
              type="button"
              className="button--quiet"
              onClick={() => setEditing(true)}
              title="Rename"
            >
              Rename
            </button>
          </h3>
        )}
        <ContractLink className="addr" id={position.contractId}>
          {position.contractId}
        </ContractLink>
      </div>
      <button
        type="button"
        className="button--quiet"
        onClick={startRemoval}
        title="Remove from this browser's list. The contract is untouched."
      >
        Stop tracking
      </button>
    </div>
  );
}

/**
 * Backs up or restores the whole local registry as JSON, since it lives
 * only in this browser's `localStorage`.
 */
export function PositionBackup() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleExport() {
    const json = exportPositions();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sororail-positions.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(file: File) {
    setError(null);
    setMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = importPositions(String(reader.result ?? ""));
        setMessage(
          `Imported ${result.added} position${result.added === 1 ? "" : "s"}` +
            (result.skipped ? ` (${result.skipped} already tracked)` : "") +
            ".",
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not import that file.");
      }
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  return (
    <div className="card stack stack--tight">
      <h3>Back up tracked positions</h3>
      <p className="small muted m-0">
        The list of tracked addresses lives only in this browser. Export it to
        move it to another browser, or import a backup made earlier.
      </p>
      <div className="row">
        <button type="button" className="button--quiet" onClick={handleExport}>
          Export as JSON
        </button>
        <button
          type="button"
          className="button--quiet"
          onClick={() => fileInputRef.current?.click()}
        >
          Import from JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleImportFile(file);
            event.target.value = "";
          }}
        />
      </div>
      {message ? <p className="small muted m-0">{message}</p> : null}
      {error ? <p className="small text-danger m-0">{error}</p> : null}
    </div>
  );
}
