"use client";

/**
 * The registry of contract instances this browser knows about.
 *
 * Each SoroRail contract except `batch_payout` holds **one position per
 * deployed instance** — one escrow, one stream, one grant, one subscription.
 * There is therefore no on-chain index to enumerate: nothing links "my
 * streams" to an account, because each stream is its own contract.
 *
 * So the app keeps a list of addresses the user has told it about. This is
 * exactly the "database is a cache" rule from the spec, in its smallest form:
 * **the addresses are a convenience, and every figure shown for one is read
 * from the chain.** Losing this list loses no money and no state — the
 * contracts are untouched, and re-adding the address restores the view.
 *
 * If the contracts move to an id-keyed design, this file is what disappears.
 */

export type PositionKind = "stream" | "vesting" | "escrow" | "recurring";

export interface Position {
  kind: PositionKind;
  contractId: string;
  /** A name the user gave it. Purely local; never on chain. */
  label: string;
  addedAt: number;
}

const STORAGE_KEY = "sororail.positions.v1";

function read(): Position[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPosition);
  } catch {
    // A corrupt or unreadable store must not take the app down; the contracts
    // are the source of truth and the user can re-add addresses.
    return [];
  }
}

function isPosition(value: unknown): value is Position {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["contractId"] === "string" &&
    typeof candidate["label"] === "string" &&
    typeof candidate["kind"] === "string" &&
    ["stream", "vesting", "escrow", "recurring"].includes(
      candidate["kind"] as string,
    )
  );
}

function write(positions: Position[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Private browsing, or a full quota. Nothing is lost that matters.
  }
  window.dispatchEvent(new Event("sororail:positions"));
}

export function listPositions(kind?: PositionKind): Position[] {
  const all = read().sort((a, b) => b.addedAt - a.addedAt);
  return kind ? all.filter((p) => p.kind === kind) : all;
}

export function addPosition(
  kind: PositionKind,
  contractId: string,
  label: string,
): void {
  const trimmed = contractId.trim();
  const existing = read();
  if (existing.some((p) => p.contractId === trimmed)) return;
  write([
    ...existing,
    { kind, contractId: trimmed, label: label.trim() || trimmed, addedAt: Date.now() },
  ]);
}

export function removePosition(contractId: string): void {
  write(read().filter((p) => p.contractId !== contractId));
}

/** A contract address is a 56-character `C…` strkey. */
export function looksLikeContractId(value: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(value.trim());
}
