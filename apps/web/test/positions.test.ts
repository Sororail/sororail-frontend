import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
};

const listeners = new Set<(event: unknown) => void>();

Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: localStorageMock,
    addEventListener: (_event: string, handler: (event: unknown) => void) =>
      listeners.add(handler),
    removeEventListener: (_event: string, handler: (event: unknown) => void) =>
      listeners.delete(handler),
    dispatchEvent: (event: unknown) => {
      listeners.forEach((listener) => listener(event));
      return true;
    },
  },
  writable: true,
});

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

import {
  addPosition,
  getPositionsSnapshot,
  importPositions,
  listPositions,
  looksLikeContractId,
  removePosition,
  renamePosition,
  subscribePositions,
  type Position,
} from "../src/lib/positions";
import { RPC_URL } from "../src/lib/network";

const VALID_CONTRACT_1 = "CDKJ56S7K7QC4LG6SFF2OGDTG6N4QBCJOVRWHY7MKCWD5JPQ6MDAHRAM";

describe("looksLikeContractId", () => {
  it("accepts valid contract strkeys", () => {
    expect(looksLikeContractId(VALID_CONTRACT_1)).toBe(true);
  });

  it("accepts lowercase valid contract strkeys", () => {
    expect(looksLikeContractId(VALID_CONTRACT_1.toLowerCase())).toBe(true);
  });

  it("rejects shape-valid contract strkeys with bad checksums", () => {
    // Single character changed at end breaking CRC16 checksum
    const typo = "CDKJ56S7K7QC4LG6SFF2OGDTG6N4QBCJOVRWHY7MKCWD5JPQ6MDAHRAA";
    expect(looksLikeContractId(typo)).toBe(false);
  });

  it("rejects non-contract strkeys (e.g. account addresses)", () => {
    const account = "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJSY3NXMOCLWEZDTWE47XLNZT7";
    expect(looksLikeContractId(account)).toBe(false);
  });

  it("rejects arbitrary invalid strings", () => {
    expect(looksLikeContractId("invalid")).toBe(false);
    expect(looksLikeContractId("")).toBe(false);
  });
});

describe("positions management", () => {
  beforeEach(() => {
    localStorage.clear();
    subscribePositions(() => {});
    window.dispatchEvent({ key: null });
  });

  it("addPosition adds a new position and normalizes contractId to uppercase", () => {
    const result = addPosition("stream", VALID_CONTRACT_1.toLowerCase(), "Test Stream");
    expect(result).toBe(true);

    const positions = getPositionsSnapshot("stream");
    expect(positions).toHaveLength(1);
    expect(positions[0]!.contractId).toBe(VALID_CONTRACT_1);
    expect(positions[0]!.label).toBe("Test Stream");
  });

  it("addPosition returns false when address is already tracked (exact or case variant)", () => {
    expect(addPosition("stream", VALID_CONTRACT_1, "Stream 1")).toBe(true);
    // Duplicate exact match
    expect(addPosition("stream", VALID_CONTRACT_1, "Stream 1 copy")).toBe(false);
    // Duplicate lowercase match
    expect(addPosition("stream", VALID_CONTRACT_1.toLowerCase(), "Stream 1 lower")).toBe(false);

    expect(getPositionsSnapshot("stream")).toHaveLength(1);
  });

  it("removePosition removes position case-insensitively", () => {
    addPosition("stream", VALID_CONTRACT_1, "Stream 1");
    removePosition(VALID_CONTRACT_1.toLowerCase());
    expect(getPositionsSnapshot("stream")).toHaveLength(0);
  });

  it("renamePosition updates position label case-insensitively", () => {
    addPosition("stream", VALID_CONTRACT_1, "Old Label");
    renamePosition(VALID_CONTRACT_1.toLowerCase(), "New Label");
    expect(getPositionsSnapshot("stream")[0]!.label).toBe("New Label");
  });

  it("importPositions handles duplicates case-insensitively", () => {
    addPosition("stream", VALID_CONTRACT_1, "Existing");

    const exportJson = JSON.stringify([
      {
        kind: "stream",
        contractId: VALID_CONTRACT_1.toLowerCase(),
        label: "Incoming Duplicate",
        addedAt: Date.now(),
      },
    ]);

    const res = importPositions(exportJson);
    expect(res.added).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("stores the network tag when adding a position", () => {
    addPosition("stream", VALID_CONTRACT_1, "My Stream");
    const positions = listPositions("stream");
    expect(positions).toHaveLength(1);
    expect(positions[0]!.contractId).toBe(VALID_CONTRACT_1);
    expect(positions[0]!.network).toBe(RPC_URL);
  });

  it("supports explicit custom network tags", () => {
    const customNetwork = "https://custom-soroban-rpc.example.com";
    addPosition("vesting", VALID_CONTRACT_1, "Custom Vesting", customNetwork);
    const positions = listPositions("vesting");
    expect(positions).toHaveLength(1);
    expect(positions[0]!.network).toBe(customNetwork);
  });

  it("migrates v1 positions without network to v2 with default RPC_URL", () => {
    // Write legacy v1 data to localStorage
    const v1Data = [
      {
        kind: "escrow",
        contractId: VALID_CONTRACT_1,
        label: "Legacy Escrow",
        addedAt: 1234567890,
      },
    ];
    localStorageMock.setItem("sororail.positions.v1", JSON.stringify(v1Data));

    // listPositions triggers read and migration
    const positions = listPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]!.kind).toBe("escrow");
    expect(positions[0]!.contractId).toBe(VALID_CONTRACT_1);
    expect(positions[0]!.network).toBe(RPC_URL);

    // Verify v2 key was saved
    const v2Raw = localStorageMock.getItem("sororail.positions.v2");
    expect(v2Raw).not.toBeNull();
    const v2Parsed = JSON.parse(v2Raw!) as Position[];
    expect(v2Parsed[0]!.network).toBe(RPC_URL);
  });

  it("imports legacy JSON positions and assigns default network", () => {
    const json = JSON.stringify([
      {
        kind: "stream",
        contractId: VALID_CONTRACT_1,
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
