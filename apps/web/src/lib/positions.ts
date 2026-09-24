"use client";

import { StrKey } from "@stellar/stellar-sdk";

import { RPC_URL } from "./network";

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

export type PositionKind = "stream" | "vesting" | "escrow";

export interface Position {
  kind: PositionKind;
  contractId: string;
  /** A name the user gave it. Purely local; never on chain. */
  label: string;
  addedAt: number;
  /** The network/RPC endpoint this position was added against. */
  network: string;
}

const STORAGE_KEY_PREFIX = "sororail.positions";

/**
 * Schema version of the registry written by this build.
 *
 * The on-disk key carries the version (`sororail.positions.vN`) so a future
 * build can read older keys and upgrade them — see `MIGRATIONS`.
 */
const SCHEMA_VERSION = 2;

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}.v${SCHEMA_VERSION}`;

/**
 * Versioned upgraders applied when reading. The key is the version being
 * upgraded *from*; each step must produce data the next step (or the final
 * validator) accepts, and steps chain until `SCHEMA_VERSION`.
 *
 * When the stored shape changes — say a `network` or `token` field is added —
 * add a step here that fills the new field on every existing entry, then bump
 * `SCHEMA_VERSION` and the key suffix. Without this hook `isPosition` would
 * silently drop every pre-upgrade entry instead of upgrading it.
 */
const MIGRATIONS: Record<number, (data: unknown) => unknown> = {
  1: (data) => {
    if (!Array.isArray(data)) return [];
    return data.map((entry) => {
      if (typeof entry === "object" && entry !== null) {
        return {
          ...entry,
          network: (entry as Record<string, unknown>)["network"] ?? RPC_URL,
        };
      }
      return entry;
    });
  },
};

/** Listeners notified whenever the registry changes (this tab or another). */
const storeListeners = new Set<() => void>();

/**
 * Snapshot caches. `useSyncExternalStore` requires `getSnapshot` to return a
 * stable reference until the store actually changes, so sorted/filtered
 * results are memoised and dropped together on invalidation.
 */
let allSnapshot: Position[] | null = null;
const kindSnapshots = new Map<PositionKind, Position[]>();

function invalidateSnapshot(): void {
  allSnapshot = null;
  kindSnapshots.clear();
}

function emit(): void {
  invalidateSnapshot();
  for (const listener of storeListeners) listener();
}

function handleStorageEvent(event: StorageEvent): void {
  // `key === null` means the whole area was cleared.
  if (event.key !== null && !event.key.startsWith(STORAGE_KEY_PREFIX)) return;
  emit();
}

/**
 * Subscribe to registry changes. Compatible with `useSyncExternalStore`:
 * the returned function unsubscribes, and same-tab writes plus other-tab
 * `storage` events both notify.
 */
export function subscribePositions(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const first = storeListeners.size === 0;
  storeListeners.add(listener);
  if (first) window.addEventListener("storage", handleStorageEvent);
  return () => {
    storeListeners.delete(listener);
    if (storeListeners.size === 0) {
      window.removeEventListener("storage", handleStorageEvent);
    }
  };
}

/**
 * Memoised registry snapshot for `useSyncExternalStore`.
 *
 * Returns the same array reference until the store changes, which React
 * needs to compare snapshots, and reads localStorage during the first client
 * render — not in an effect — so consumers never paint an empty state first.
 */
export function getPositionsSnapshot(kind?: PositionKind): Position[] {
  if (!kind) {
    if (allSnapshot === null) {
      allSnapshot = read().sort((a, b) => b.addedAt - a.addedAt);
    }
    return allSnapshot;
  }
  let snapshot = kindSnapshots.get(kind);
  if (!snapshot) {
    snapshot = getPositionsSnapshot().filter((position) => position.kind === kind);
    kindSnapshots.set(kind, snapshot);
  }
  return snapshot;
}

/**
 * Run stored JSON through the migration chain so entries written by older
 * builds upgrade to the current schema instead of failing validation.
 *
 * `fromVersion` is the schema of the key the raw JSON came from. Returns
 * `null` when a required step is missing (should not happen while steps are
 * kept chained to `SCHEMA_VERSION`).
 */
function migrate(data: unknown, fromVersion: number): unknown | null {
  let current = data;
  let version = fromVersion;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return null;
    current = step(current);
    version += 1;
  }
  return current;
}

function read(): Position[] {
  if (typeof window === "undefined") return [];

  // Prefer the current key, then walk down to older versioned keys so data
  // written before a schema bump is migrated rather than abandoned.
  for (let version = SCHEMA_VERSION; version >= 1; version -= 1) {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}.v${version}`);
    } catch {
      return [];
    }
    if (raw === null) continue;

    try {
      const parsed: unknown = JSON.parse(raw);
      const upgraded = migrate(parsed, version);
      if (upgraded === null || !Array.isArray(upgraded)) return [];
      const positions = upgraded.filter(isPosition);
      if (version < SCHEMA_VERSION) {
        // Persist the upgrade under the current key so the next read starts
        // clean. Best effort: a failed write is retried on the next load.
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
        } catch {
          // Quota or private browsing; the in-memory upgrade still applies.
        }
      }
      return positions;
    } catch {
      // A corrupt or unreadable store must not take the app down; the contracts
      // are the source of truth and the user can re-add addresses.
      return [];
    }
  }
  return [];
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
    ["stream", "vesting", "escrow"].includes(
      candidate["kind"] as string,
    ) &&
    typeof candidate["network"] === "string"
  );
}

function write(positions: Position[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Private browsing, or a full quota. Nothing is lost that matters.
  }
  emit();
}

export function listPositions(kind?: PositionKind): Position[] {
  return getPositionsSnapshot(kind);
}

export function addPosition(
  kind: PositionKind,
  contractId: string,
  label: string,
  network: string = RPC_URL,
): boolean {
  const normalized = contractId.trim().toUpperCase();
  const existing = read();
  if (
    existing.some(
      (p) => p.contractId.toUpperCase() === normalized && p.network === network,
    )
  ) {
    return false;
  }
  write([
    ...existing,
    {
      kind,
      contractId: normalized,
      label: label.trim() || normalized,
      addedAt: Date.now(),
      network,
    },
  ]);
  return true;
}

export function removePosition(contractId: string): void {
  const normalized = contractId.trim().toUpperCase();
  write(read().filter((p) => p.contractId.toUpperCase() !== normalized));
}

/** Reinsert a previously removed position, e.g. from an undo toast. */
export function restorePosition(position: Position): void {
  const normalized = position.contractId.trim().toUpperCase();
  const existing = read();
  if (
    existing.some(
      (p) =>
        p.contractId.toUpperCase() === normalized &&
        p.network === position.network,
    )
  ) {
    return;
  }
  write([...existing, { ...position, contractId: normalized }]);
}

export function renamePosition(contractId: string, label: string): void {
  const trimmed = label.trim();
  if (!trimmed) return;
  const normalized = contractId.trim().toUpperCase();
  write(
    read().map((p) => (p.contractId.toUpperCase() === normalized ? { ...p, label: trimmed } : p)),
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
  const upgraded = parsed.map((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>)["network"] !== "string"
    ) {
      return { ...item, network: RPC_URL };
    }
    return item;
  });
  const incoming = upgraded.filter(isPosition);
  if (incoming.length === 0) {
    throw new Error("No valid positions found in that file.");
  }

  const existing = read();
  const existingKeys = new Set(
    existing.map((p) => `${p.network}::${p.contractId.toUpperCase()}`),
  );
  const toAdd: Position[] = [];
  for (const p of incoming) {
    const normalizedId = p.contractId.trim().toUpperCase();
    const key = `${p.network}::${normalizedId}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      toAdd.push({ ...p, contractId: normalizedId });
    }
  }

  write([...existing, ...toAdd]);

  return { added: toAdd.length, skipped: incoming.length - toAdd.length };
}

/** A contract address is a 56-character `C…` strkey. */
export function looksLikeContractId(value: string): boolean {
  const trimmed = value.trim().toUpperCase();
  return StrKey.isValidContract(trimmed);
}
