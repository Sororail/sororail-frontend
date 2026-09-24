import { beforeEach, describe, expect, it } from "vitest";

import {
  addPosition,
  getPositionsSnapshot,
  importPositions,
  listPositions,
  removePosition,
  subscribePositions,
  type Position,
} from "../src/lib/positions";
import { RPC_URL } from "../src/lib/network";

const DUMMY_CONTRACT_1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DUMMY_CONTRACT_2 = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const storageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageMap.set(key, value);
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  },
};

const listeners = new Set<(event: unknown) => void>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: mockLocalStorage,
  addEventListener: (_event: string, handler: (event: unknown) => void) =>
    listeners.add(handler),
  removeEventListener: (_event: string, handler: (event: unknown) => void) =>
    listeners.delete(handler),
  dispatchEvent: (event: unknown) => {
    listeners.forEach((listener) => listener(event));
  },
};

describe("positions registry", () => {
  beforeEach(() => {
    storageMap.clear();
    subscribePositions(() => {});
    (
      globalThis as unknown as {
        window: { dispatchEvent: (event: unknown) => void };
      }
    ).window.dispatchEvent({ key: null });
  });

  it("stores the network tag when adding a position", () => {
    addPosition("stream", DUMMY_CONTRACT_1, "My Stream");
    const positions = listPositions("stream");
    expect(positions).toHaveLength(1);
    expect(positions[0]!.contractId).toBe(DUMMY_CONTRACT_1);
    expect(positions[0]!.network).toBe(RPC_URL);
  });

  it("supports explicit custom network tags", () => {
    const customNetwork = "https://custom-soroban-rpc.example.com";
    addPosition("vesting", DUMMY_CONTRACT_2, "Custom Vesting", customNetwork);
    const positions = listPositions("vesting");
    expect(positions).toHaveLength(1);
    expect(positions[0]!.network).toBe(customNetwork);
  });

  it("migrates v1 positions without network to v2 with default RPC_URL", () => {
    // Write legacy v1 data to localStorage
    const v1Data = [
      {
        kind: "escrow",
        contractId: DUMMY_CONTRACT_1,
        label: "Legacy Escrow",
        addedAt: 1234567890,
      },
    ];
    mockLocalStorage.setItem("sororail.positions.v1", JSON.stringify(v1Data));

    // listPositions triggers read and migration
    const positions = listPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]!.kind).toBe("escrow");
    expect(positions[0]!.contractId).toBe(DUMMY_CONTRACT_1);
    expect(positions[0]!.network).toBe(RPC_URL);

    // Verify v2 key was saved
    const v2Raw = mockLocalStorage.getItem("sororail.positions.v2");
    expect(v2Raw).not.toBeNull();
    const v2Parsed = JSON.parse(v2Raw!) as Position[];
    expect(v2Parsed[0]!.network).toBe(RPC_URL);
  });

  it("imports legacy JSON positions and assigns default network", () => {
    const json = JSON.stringify([
      {
        kind: "stream",
        contractId: DUMMY_CONTRACT_1,
        label: "Imported Stream",
        addedAt: Date.now(),
      },
    ]);
    const result = importPositions(json);
    expect(result.added).toBe(1);
    const positions = listPositions("stream");
    expect(positions).toHaveLength(1);
    expect(positions[0]!.network).toBe(RPC_URL);
  });
});
