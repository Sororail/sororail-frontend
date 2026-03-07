"use client";

import { useCallback, useEffect, useState } from "react";

import { explorerContract } from "@/lib/network";
import {
  addPosition,
  listPositions,
  looksLikeContractId,
  removePosition,
  type Position,
  type PositionKind,
} from "@/lib/positions";

/** Subscribes to the local registry, re-reading when it changes. */
export function usePositions(kind: PositionKind): Position[] {
  const [positions, setPositions] = useState<Position[]>([]);

  const refresh = useCallback(() => setPositions(listPositions(kind)), [kind]);

  useEffect(() => {
    refresh();
    window.addEventListener("sororail:positions", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("sororail:positions", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  return positions;
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
        "That does not look like a contract address. It should start with C and be 56 characters.",
      );
      return;
    }
    addPosition(kind, contractId, label);
    setContractId("");
    setLabel("");
    setError(null);
  }

  return (
    <form className="card stack stack--tight" onSubmit={submit}>
      <h3>Track an existing {noun}</h3>
      <p className="small muted" style={{ margin: 0 }}>
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
  return (
    <div className="spread">
      <div>
        <h3>{position.label}</h3>
        <a
          className="addr"
          href={explorerContract(position.contractId)}
          target="_blank"
          rel="noreferrer"
        >
          {position.contractId}
        </a>
      </div>
      <button
        type="button"
        className="button--quiet"
        onClick={() => removePosition(position.contractId)}
        title="Remove from this browser's list. The contract is untouched."
      >
        Stop tracking
      </button>
    </div>
  );
}
