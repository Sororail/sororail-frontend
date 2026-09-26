import { Networks } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  FreighterSigner,
  NetworkMismatchError,
  SigningError,
  type FreighterApi,
} from "../src/signers/index.js";

const ALICE = "GC4RWN3HH5H5GMD3NT4MOIYC3H3Q3NUF4BFWATGDI7NKRVLRURKHSIMC";
const BOB = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";

/** A stub extension whose selected account and network can be changed. */
function stubFreighter(options: { network?: string } = {}) {
  const state = { address: ALICE, network: options.network };
  const signTransaction = vi.fn(async (xdr: string) => ({ signedTxXdr: `signed:${xdr}` }));
  const api: FreighterApi = {
    isConnected: async () => true,
    getAddress: async () => ({ address: state.address }),
    signTransaction,
    ...(state.network !== undefined
      ? {
          getNetworkDetails: async () => ({
            network: "",
            networkPassphrase: state.network ?? "",
          }),
        }
      : {}),
  };
  return { api, state, signTransaction };
}

describe("FreighterSigner account switching", () => {
  it("reads the live account, not the one it connected with", async () => {
    const { api, state } = stubFreighter();
    const signer = await FreighterSigner.connect(api);

    state.address = BOB;

    expect(signer.publicKey).toBe(ALICE);
    await expect(signer.currentAddress()).resolves.toBe(BOB);
  });

  it("refuses to sign once the extension has switched accounts", async () => {
    const { api, state, signTransaction } = stubFreighter();
    const signer = await FreighterSigner.connect(api);

    state.address = BOB;

    const attempt = signer.signTransaction("AAAA", { networkPassphrase: Networks.TESTNET });
    await expect(attempt).rejects.toBeInstanceOf(SigningError);
    await expect(attempt).rejects.toThrow(/active account changed.*Reconnect/);
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("signs as the connected account while it is still selected", async () => {
    const { api, signTransaction } = stubFreighter({ network: Networks.TESTNET });
    const signer = await FreighterSigner.connect(api);

    await expect(
      signer.signTransaction("AAAA", { networkPassphrase: Networks.TESTNET }),
    ).resolves.toBe("signed:AAAA");
    expect(signTransaction).toHaveBeenCalledWith("AAAA", {
      networkPassphrase: Networks.TESTNET,
      address: ALICE,
    });
  });
});

describe("FreighterSigner network checks", () => {
  it("refuses to sign on a different network, saying which one to switch to", async () => {
    const { api, signTransaction } = stubFreighter({ network: Networks.PUBLIC });
    const signer = await FreighterSigner.connect(api);

    const attempt = signer.signTransaction("AAAA", { networkPassphrase: Networks.TESTNET });
    await expect(attempt).rejects.toBeInstanceOf(NetworkMismatchError);
    await expect(attempt).rejects.toThrow(
      "Freighter is set to Mainnet, but Testnet is needed here. Switch Freighter to Testnet and try again.",
    );
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("is a SigningError carrying both passphrases", async () => {
    const { api } = stubFreighter({ network: Networks.PUBLIC });
    const signer = await FreighterSigner.connect(api);

    const error = await signer.assertNetwork(Networks.TESTNET).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SigningError);
    expect(error).toMatchObject({
      name: "NetworkMismatchError",
      walletNetworkPassphrase: Networks.PUBLIC,
      expectedNetworkPassphrase: Networks.TESTNET,
    });
  });

  it("reads the network from each Freighter API shape", async () => {
    const base: FreighterApi = {
      isConnected: async () => true,
      getAddress: async () => ({ address: ALICE }),
      signTransaction: async (xdr) => xdr,
    };

    const legacy = await FreighterSigner.connect({ ...base, getNetwork: async () => "PUBLIC" });
    await expect(legacy.networkPassphrase()).resolves.toBe(Networks.PUBLIC);

    const current = await FreighterSigner.connect({
      ...base,
      getNetwork: async () => ({ network: "TESTNET", networkPassphrase: Networks.TESTNET }),
    });
    await expect(current.networkPassphrase()).resolves.toBe(Networks.TESTNET);

    const unreported = await FreighterSigner.connect(base);
    await expect(unreported.networkPassphrase()).resolves.toBeNull();
    // A network that cannot be read is not treated as a mismatch.
    await expect(unreported.assertNetwork(Networks.TESTNET)).resolves.toBeUndefined();
  });
});

describe("FreighterSigner.connect address resolution", () => {
  const base = {
    isConnected: async () => true,
    signTransaction: async (xdr: string) => xdr,
  };

  it("reads the address from the current getAddress() API shape", async () => {
    const api: FreighterApi = {
      ...base,
      getAddress: async () => ({ address: ALICE }),
    };

    const signer = await FreighterSigner.connect(api);
    expect(signer.publicKey).toBe(ALICE);
  });

  it("falls back to the legacy getPublicKey() API shape", async () => {
    const api: FreighterApi = {
      ...base,
      getPublicKey: async () => ALICE,
    };

    const signer = await FreighterSigner.connect(api);
    expect(signer.publicKey).toBe(ALICE);
  });

  it("throws when getAddress() reports an error", async () => {
    const api: FreighterApi = {
      ...base,
      getAddress: async () => ({ address: "", error: "User declined access" }),
    };

    const attempt = FreighterSigner.connect(api);
    await expect(attempt).rejects.toBeInstanceOf(SigningError);
    await expect(attempt).rejects.toThrow("User declined access");
  });

  it("throws when Freighter reports no address at all", async () => {
    const api: FreighterApi = {
      ...base,
      getAddress: async () => ({ address: "" }),
    };

    const attempt = FreighterSigner.connect(api);
    await expect(attempt).rejects.toBeInstanceOf(SigningError);
    await expect(attempt).rejects.toThrow(/did not return an address/);
  });
});

describe("FreighterSigner.signTransaction result shapes", () => {
  function connectedSigner(signTransaction: FreighterApi["signTransaction"]) {
    return FreighterSigner.connect({
      isConnected: async () => true,
      getAddress: async () => ({ address: ALICE }),
      signTransaction,
    });
  }

  it("accepts a bare signed-XDR string", async () => {
    const signer = await connectedSigner(async (xdr) => `signed:${xdr}`);

    await expect(
      signer.signTransaction("AAAA", { networkPassphrase: Networks.TESTNET }),
    ).resolves.toBe("signed:AAAA");
  });

  it("accepts an {signedTxXdr} object", async () => {
    const signer = await connectedSigner(async (xdr) => ({ signedTxXdr: `signed:${xdr}` }));

    await expect(
      signer.signTransaction("AAAA", { networkPassphrase: Networks.TESTNET }),
    ).resolves.toBe("signed:AAAA");
  });

  it("throws when the result object carries an error", async () => {
    const signer = await connectedSigner(async () => ({
      signedTxXdr: "",
      error: "User declined access",
    }));

    const attempt = signer.signTransaction("AAAA", { networkPassphrase: Networks.TESTNET });
    await expect(attempt).rejects.toBeInstanceOf(SigningError);
    await expect(attempt).rejects.toThrow("User declined access");
  });

  it("wraps a thrown/declined signature in a SigningError", async () => {
    const cause = new Error("User rejected the request");
    const signer = await connectedSigner(async () => {
      throw cause;
    });

    const attempt = signer.signTransaction("AAAA", { networkPassphrase: Networks.TESTNET });
    await expect(attempt).rejects.toBeInstanceOf(SigningError);
    await expect(attempt).rejects.toThrow(/did not sign the transaction/);
    await expect(attempt).rejects.toMatchObject({ cause });
  });
});
