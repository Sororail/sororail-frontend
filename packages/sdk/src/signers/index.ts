import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

import { SororailError, ValidationError } from "../errors/index.js";

/**
 * Signing is injected, never performed by the SDK.
 *
 * The SDK builds and submits transactions but never holds a secret key. A
 * caller supplies whatever can produce a signature — a browser wallet, an HSM,
 * a test keypair — and the SDK only ever sees signed XDR coming back.
 */
export interface Signer {
  /** The account the signature will be attributed to (`G...`). */
  readonly publicKey: string;
  /**
   * Signs a transaction envelope.
   *
   * @param xdr Base64 transaction envelope XDR.
   * @returns The signed envelope, also base64 XDR.
   */
  signTransaction(
    xdr: string,
    options: { networkPassphrase: string },
  ): Promise<string>;
}

/** Thrown when a wallet is missing, locked, or the user declines to sign. */
export class SigningError extends SororailError {
  override readonly name = "SigningError";
}

/**
 * Signs with a raw secret key held in memory.
 *
 * **For tests, scripts and server-side keys you already control.** Never ship
 * this to a browser: it means the secret is in page memory, where any script
 * on the origin can read it. Use {@link FreighterSigner} there.
 */
export class KeypairSigner implements Signer {
  readonly #keypair: Keypair;

  constructor(secretKey: string) {
    try {
      this.#keypair = Keypair.fromSecret(secretKey);
    } catch (cause) {
      throw new ValidationError(
        "That is not a valid Stellar secret key. It should begin with S and be 56 characters.",
        { cause },
      );
    }
  }

  /** Generates a fresh random keypair. Useful in tests. */
  static random(): KeypairSigner {
    return new KeypairSigner(Keypair.random().secret());
  }

  get publicKey(): string {
    return this.#keypair.publicKey();
  }

  async signTransaction(
    xdr: string,
    options: { networkPassphrase: string },
  ): Promise<string> {
    const tx = TransactionBuilder.fromXDR(xdr, options.networkPassphrase);
    tx.sign(this.#keypair);
    return tx.toXDR();
  }
}

/** The subset of the Freighter browser API this SDK uses. */
export interface FreighterApi {
  isConnected(): Promise<boolean | { isConnected: boolean }>;
  getAddress?(): Promise<{ address: string; error?: string }>;
  getPublicKey?(): Promise<string>;
  signTransaction(
    xdr: string,
    options: { networkPassphrase?: string; address?: string },
  ): Promise<string | { signedTxXdr: string; error?: string }>;
}

/**
 * Signs through the Freighter browser extension.
 *
 * Construct it with {@link FreighterSigner.connect}, which resolves the user's
 * address once so that `publicKey` can stay synchronous afterwards.
 *
 * The Freighter API has changed shape across versions — `getPublicKey` became
 * `getAddress`, and `signTransaction` began returning an object rather than a
 * string — so both spellings are accepted rather than pinning users to one
 * extension version.
 */
export class FreighterSigner implements Signer {
  readonly publicKey: string;
  readonly #api: FreighterApi;

  private constructor(api: FreighterApi, publicKey: string) {
    this.#api = api;
    this.publicKey = publicKey;
  }

  /**
   * Connects to the extension and resolves the active address.
   *
   * @param api Defaults to `globalThis.freighterApi`. Pass explicitly when
   *   using the `@stellar/freighter-api` package, or a stub in tests.
   */
  static async connect(api?: FreighterApi): Promise<FreighterSigner> {
    const resolved =
      api ?? (globalThis as { freighterApi?: FreighterApi }).freighterApi;
    if (!resolved) {
      throw new SigningError(
        "Freighter was not found. Install the extension and reload the page.",
      );
    }

    const connected = await resolved.isConnected();
    const isConnected =
      typeof connected === "boolean" ? connected : connected.isConnected;
    if (!isConnected) {
      throw new SigningError(
        "Freighter is installed but not connected. Open the extension and unlock it.",
      );
    }

    let address: string | undefined;
    if (resolved.getAddress) {
      const result = await resolved.getAddress();
      if (result.error) throw new SigningError(result.error);
      address = result.address;
    } else if (resolved.getPublicKey) {
      address = await resolved.getPublicKey();
    }

    if (!address) {
      throw new SigningError(
        "Freighter did not return an address. Make sure an account is selected.",
      );
    }
    return new FreighterSigner(resolved, address);
  }

  async signTransaction(
    xdr: string,
    options: { networkPassphrase: string },
  ): Promise<string> {
    let result: string | { signedTxXdr: string; error?: string };
    try {
      result = await this.#api.signTransaction(xdr, {
        networkPassphrase: options.networkPassphrase,
        address: this.publicKey,
      });
    } catch (cause) {
      throw new SigningError(
        "Freighter did not sign the transaction. It may have been declined.",
        { cause },
      );
    }

    if (typeof result === "string") return result;
    if (result.error) throw new SigningError(result.error);
    return result.signedTxXdr;
  }
}
