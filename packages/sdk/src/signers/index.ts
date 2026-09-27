import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

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
  override readonly name: string = "SigningError";
}

const NETWORK_NAMES: Record<string, string> = {
  [Networks.TESTNET]: "Testnet",
  [Networks.PUBLIC]: "Mainnet",
  [Networks.FUTURENET]: "Futurenet",
};

/** Human name for a network passphrase, or the passphrase itself. */
function networkName(passphrase: string): string {
  return NETWORK_NAMES[passphrase] ?? passphrase;
}

/**
 * Thrown when the wallet is set to a different network than the one a
 * transaction is for. Signing there would fail or be rejected, so this says
 * which network to switch to instead.
 */
export class NetworkMismatchError extends SigningError {
  override readonly name: string = "NetworkMismatchError";
  /** The passphrase the wallet is currently set to. */
  readonly walletNetworkPassphrase: string;
  /** The passphrase the transaction was built for. */
  readonly expectedNetworkPassphrase: string;

  constructor(walletNetworkPassphrase: string, expectedNetworkPassphrase: string) {
    const expected = networkName(expectedNetworkPassphrase);
    super(
      `Freighter is set to ${networkName(walletNetworkPassphrase)}, but ${expected} is needed here. Switch Freighter to ${expected} and try again.`,
    );
    this.walletNetworkPassphrase = walletNetworkPassphrase;
    this.expectedNetworkPassphrase = expectedNetworkPassphrase;
  }
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
  /** Older versions return the network name, newer ones an object. */
  getNetwork?(): Promise<
    string | { network: string; networkPassphrase: string; error?: string }
  >;
  getNetworkDetails?(): Promise<{
    network: string;
    networkPassphrase: string;
    error?: string;
  }>;
  signTransaction(
    xdr: string,
    options: { networkPassphrase?: string; address?: string },
  ): Promise<string | { signedTxXdr: string; error?: string }>;
}

/** Reads the account currently selected in the extension. */
async function readAddress(api: FreighterApi): Promise<string> {
  let address: string | undefined;
  if (api.getAddress) {
    const result = await api.getAddress();
    if (result.error) throw new SigningError(result.error);
    address = result.address;
  } else if (api.getPublicKey) {
    address = await api.getPublicKey();
  }

  if (!address) {
    throw new SigningError(
      "Freighter did not return an address. Make sure an account is selected.",
    );
  }
  return address;
}

/** Network names older Freighter versions report instead of a passphrase. */
const PASSPHRASES_BY_NAME: Record<string, string> = {
  TESTNET: Networks.TESTNET,
  PUBLIC: Networks.PUBLIC,
  FUTURENET: Networks.FUTURENET,
};

/** Reads the extension's network passphrase, or `null` if it cannot say. */
async function readNetworkPassphrase(api: FreighterApi): Promise<string | null> {
  if (api.getNetworkDetails) {
    const details = await api.getNetworkDetails();
    if (details.error) throw new SigningError(details.error);
    return details.networkPassphrase || null;
  }
  if (api.getNetwork) {
    const network = await api.getNetwork();
    if (typeof network === "string") {
      return PASSPHRASES_BY_NAME[network.toUpperCase()] ?? null;
    }
    if (network.error) throw new SigningError(network.error);
    return (
      network.networkPassphrase ||
      PASSPHRASES_BY_NAME[network.network.toUpperCase()] ||
      null
    );
  }
  return null;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Signs through the Freighter browser extension.
 *
 * Construct it with {@link FreighterSigner.connect}, which resolves the user's
 * address once so that `publicKey` can stay synchronous afterwards. The user
 * can still switch account or network inside the extension afterwards, so
 * {@link FreighterSigner.currentAddress} and
 * {@link FreighterSigner.networkPassphrase} read the live values, and
 * `signTransaction` refuses to sign when either no longer matches.
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

    return new FreighterSigner(resolved, await readAddress(resolved));
  }

  /**
   * The account currently selected in the extension. This differs from
   * `publicKey` once the user switches accounts; connect again to follow it.
   */
  currentAddress(): Promise<string> {
    return readAddress(this.#api);
  }

  /**
   * The network passphrase the extension is currently set to, or `null` when
   * this version of Freighter cannot report it.
   */
  networkPassphrase(): Promise<string | null> {
    return readNetworkPassphrase(this.#api);
  }

  /**
   * Throws {@link NetworkMismatchError} when the extension is on a different
   * network than `expected`. Passes when the network cannot be read.
   */
  async assertNetwork(expected: string): Promise<void> {
    const actual = await this.networkPassphrase();
    if (actual !== null && actual !== expected) {
      throw new NetworkMismatchError(actual, expected);
    }
  }

  async signTransaction(
    xdr: string,
    options: { networkPassphrase: string },
  ): Promise<string> {
    // The transaction was built for `publicKey`. If the user has since
    // switched accounts, signing would ask the wrong account (or fail
    // obscurely), so stop and say what happened instead.
    const active = await this.currentAddress();
    if (active !== this.publicKey) {
      throw new SigningError(
        `Freighter's active account changed to ${shortAddress(active)} after connecting as ${shortAddress(this.publicKey)}. Reconnect the wallet and try again.`,
      );
    }
    await this.assertNetwork(options.networkPassphrase);

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
