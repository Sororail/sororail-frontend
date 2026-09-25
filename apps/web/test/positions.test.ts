import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
};

Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: localStorageMock,
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  writable: true,
});

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

import {
  addPosition,
  getPositionCountSnapshot,
  getPositionCountsSnapshot,
  getPositionsSnapshot,
  importPositions,
  looksLikeContractId,
  removePosition,
  renamePosition,
} from "../src/lib/positions";

const VALID_CONTRACT_1 = "CDKJ56S7K7QC4LG6SFF2OGDTG6N4QBCJOVRWHY7MKCWD5JPQ6MDAHRAM";
const VALID_CONTRACT_2 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const VALID_CONTRACT_3 = "CBEE4SRXRGCJDWXP6DDOSX6FR4S2PJ5KHUQCHI3ABY3SQTCHYSA7CGC7";

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

  it("computes and memoizes derived position counts", () => {
    expect(getPositionCountsSnapshot()).toEqual({
      stream: 0,
      vesting: 0,
      escrow: 0,
    });
    expect(getPositionCountSnapshot("stream")).toBe(0);
    expect(getPositionCountSnapshot("vesting")).toBe(0);
    expect(getPositionCountSnapshot("escrow")).toBe(0);

    addPosition("stream", VALID_CONTRACT_1, "Stream 1");
    addPosition("vesting", VALID_CONTRACT_2, "Grant 1");
    addPosition("stream", VALID_CONTRACT_3, "Stream 2");

    const countsBefore = getPositionCountsSnapshot();
    expect(countsBefore).toEqual({
      stream: 2,
      vesting: 1,
      escrow: 0,
    });
    expect(getPositionCountSnapshot("stream")).toBe(2);
    expect(getPositionCountSnapshot("vesting")).toBe(1);
    expect(getPositionCountSnapshot("escrow")).toBe(0);

    // Verify memoized reference equality when registry has not changed
    expect(getPositionCountsSnapshot()).toBe(countsBefore);

    removePosition(VALID_CONTRACT_1);
    const countsAfter = getPositionCountsSnapshot();
    expect(countsAfter).toEqual({
      stream: 1,
      vesting: 1,
      escrow: 0,
    });
    expect(getPositionCountSnapshot("stream")).toBe(1);
  });
});
