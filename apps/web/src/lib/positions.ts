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
    typeof candidate["addedAt"] === "number" &&
    Number.isFinite(candidate["addedAt"]) &&
    typeof candidate["kind"] === "string" &&
    ["stream", "vesting", "escrow", "recurring"].includes(
      candidate["kind"] as string,
    )
  );
}

function write(positions: Position[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Do not notify subscribers when persistence failed; their next read
    // would return stale data and imply that the update was saved.
    return false;
  }
  window.dispatchEvent(new Event("sororail:positions"));
  return true;
}

export function listPositions(kind?: PositionKind): Position[] {
  const all = read().sort((a, b) => b.addedAt - a.addedAt);
  return kind ? all.filter((p) => p.kind === kind) : all;
}

export function addPosition(
  kind: PositionKind,
  contractId: string,
  label: string,
): boolean {
  const trimmed = contractId.trim();
  const existing = read();
  if (existing.some((p) => p.contractId === trimmed)) return false;
  return write([
    ...existing,
    { kind, contractId: trimmed, label: label.trim() || trimmed, addedAt: Date.now() },
  ]);
}

export function removePosition(contractId: string): void {
  write(read().filter((p) => p.contractId !== contractId));
}

/** Reinsert a previously removed position, e.g. from an undo toast. */
export function restorePosition(position: Position): void {
  const existing = read();
  if (existing.some((p) => p.contractId === position.contractId)) return;
  write([...existing, position]);
}

export function renamePosition(contractId: string, label: string): void {
  const trimmed = label.trim();
  if (!trimmed) return;
  write(
    read().map((p) => (p.contractId === contractId ? { ...p, label: trimmed } : p)),
  );
}

/** Serialise the registry so it can be backed up or moved to another browser. */
export function exportPositions(): string {
  return JSON.stringify(read(), null, 2);
}

export interface ImportPositionsResult {
  added: number;
  skipped: number;
}

/**
 * Merge positions from a previously exported JSON string into the
 * registry. Existing contract IDs are left untouched (skipped) rather than
 * overwritten, so importing never silently discards a local rename.
 */
export function importPositions(json: string): ImportPositionsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array of positions.");
  }
  const incoming = parsed.filter(isPosition);
  if (incoming.length === 0) {
    throw new Error("No valid positions found in that file.");
  }

  const existing = read();
  const existingIds = new Set(existing.map((p) => p.contractId));
  const toAdd = incoming.filter((p) => !existingIds.has(p.contractId));

  write([...existing, ...toAdd]);

  return { added: toAdd.length, skipped: incoming.length - toAdd.length };
}

/** A contract address is a 56-character `C…` strkey. */
export function looksLikeContractId(value: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(value.trim());
}
