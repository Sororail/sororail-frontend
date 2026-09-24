"use client";

import type { FreighterSigner, Signer } from "@sororail/sdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { NETWORK_PASSPHRASE, RPC_URL } from "./network";

/**
 * Wallet connection.
 *
 * **No private key ever reaches this application, and none ever reaches a
 * server.** The wallet extension holds the key and returns signed XDR; the SDK
 * takes a `Signer` and never asks for a secret. There is deliberately no code
 * path here that accepts a secret key, not even for development — the moment
 * one exists, someone pastes a real one into it.
 *
 * `FreighterSigner` is imported dynamically (not at module scope) because
 * `@sororail/sdk`'s entrypoint re-exports every client alongside
 * `@stellar/stellar-sdk`. `WalletProvider` wraps the whole app in
 * `RootLayout`, so a static import here would pull that entire SDK into every
 * route, including ones that never touch a wallet.
 */

interface WalletState {
  address: string | null;
  signer: Signer | null;
  connecting: boolean;
  error: Error | null;
  /**
   * Set while Freighter is on a different network than the app, saying which
   * network to switch to. Signing is refused until it clears.
   */
  networkError: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

/**
 * How often the extension is re-read for account and network switches.
 * Freighter has no change event, so this polls, and also re-checks whenever
 * the tab regains focus — which is when a switch made in the extension
 * popup usually becomes visible.
 */
const WALLET_WATCH_INTERVAL_MS = 3_000;

/** The network-mismatch message for `signer`, or `null` when it matches. */
async function networkErrorFor(signer: FreighterSigner): Promise<string | null> {
  const { NetworkMismatchError } = await import("@sororail/sdk");
  try {
    await signer.assertNetwork(NETWORK_PASSPHRASE);
    return null;
  } catch (cause) {
    if (cause instanceof NetworkMismatchError) return cause.message;
    // The network could not be read (locked, older extension): signing will
    // report whatever is actually wrong, so do not guess here.
    return null;
  }
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [signer, setSigner] = useState<FreighterSigner | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  /**
   * Set when the user explicitly disconnects, to stop the restore effect below
   * immediately reconnecting them. Without it, Disconnect would appear to do
   * nothing at all.
   */
  const [disconnected, setDisconnected] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    setDisconnected(false);
    try {
      const { FreighterSigner } = await import("@sororail/sdk");
      const connected = await FreighterSigner.connect();
      setSigner(connected);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause
          : new Error("Could not connect to a wallet."),
      );
    } finally {
      setConnecting(false);
    }
  }, []);

  /**
   * Restores the session on load.
   *
   * The connection lives in React state, so a refresh or a direct link would
   * otherwise land the user on a disconnected page and make them click
   * Connect again on every navigation that is not a client-side one.
   *
   * Freighter's `isConnected()` reports whether this site is *already*
   * authorised, so this re-establishes an existing grant rather than asking
   * for a new one — no popup appears. A failure here is silent by design: not
   * having a wallet is the normal first-visit state, not an error to report.
   */
  useEffect(() => {
    if (disconnected) return;
    let cancelled = false;
    void (async () => {
      try {
        const { FreighterSigner, SigningError } = await import("@sororail/sdk");
        try {
          const restored = await FreighterSigner.connect();
          if (!cancelled) setSigner(restored);
        } catch (cause) {
          // Missing, locked, or not-yet-authorised wallets are normal while
          // restoring. Anything else means the integration itself failed and
          // must not be made to look like a disconnected wallet.
          if (cause instanceof SigningError) return;
          throw cause;
        }
      } catch (cause) {
        console.error("Failed to restore the wallet session", cause);
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause
              : new Error("Could not restore the wallet session."),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [disconnected]);

  /**
   * Follows account and network switches made inside the extension.
   *
   * `FreighterSigner` resolves its address once, at connect. Without this, a
   * switch in Freighter left `address` — and every role check derived from it
   * — on the old account until a manual disconnect and reconnect. When the
   * active account changes, the signer is replaced by a fresh one for the new
   * account; when the network stops matching, `networkError` says so.
   */
  useEffect(() => {
    if (!signer) {
      setNetworkError(null);
      return;
    }
    let cancelled = false;

    const check = async () => {
      try {
        const [active, mismatch] = await Promise.all([
          signer.currentAddress(),
          networkErrorFor(signer),
        ]);
        if (cancelled) return;
        setNetworkError(mismatch);
        if (active !== signer.publicKey) {
          const { FreighterSigner } = await import("@sororail/sdk");
          const switched = await FreighterSigner.connect();
          if (!cancelled) setSigner(switched);
        }
      } catch {
        /* Locked or revoked mid-session. Signing will say so; keep state. */
      }
    };

    void check();
    const interval = window.setInterval(() => void check(), WALLET_WATCH_INTERVAL_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [signer]);

  const disconnect = useCallback(() => {
    // Forgets the session locally. The extension stays connected to the site
    // until the user revokes it there, which is the extension's call to make.
    setSigner(null);
    setError(null);
    setDisconnected(true);
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      address: signer?.publicKey ?? null,
      signer,
      connecting,
      error,
      networkError,
      connect,
      disconnect,
    }),
    [signer, connecting, error, networkError, connect, disconnect],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used inside a WalletProvider");
  }
  return context;
}
