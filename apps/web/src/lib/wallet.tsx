"use client";

import { FreighterSigner, type Signer } from "@sororail/sdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { NETWORK_PASSPHRASE } from "./network";

/**
 * Wallet connection.
 *
 * **No private key ever reaches this application, and none ever reaches a
 * server.** The wallet extension holds the key and returns signed XDR; the SDK
 * takes a `Signer` and never asks for a secret. There is deliberately no code
 * path here that accepts a secret key, not even for development — the moment
 * one exists, someone pastes a real one into it.
 */

interface WalletState {
  address: string | null;
  signer: Signer | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const connected = await FreighterSigner.connect();
      setSigner(connected);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect to a wallet.",
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
    void FreighterSigner.connect()
      .then((restored) => {
        if (!cancelled) setSigner(restored);
      })
      .catch(() => {
        /* No wallet, locked, or not yet authorised. Stay disconnected. */
      });
    return () => {
      cancelled = true;
    };
  }, [disconnected]);

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
      connect,
      disconnect,
    }),
    [signer, connecting, error, connect, disconnect],
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

/** Client options every SDK client in this app shares. */
export function useClientOptions(contractId: string) {
  const { address } = useWallet();
  return useMemo(
    () => ({
      contractId,
      rpcUrl: process.env["NEXT_PUBLIC_RPC_URL"] ?? "https://soroban-testnet.stellar.org",
      networkPassphrase: NETWORK_PASSPHRASE,
      ...(address ? { publicKey: address } : {}),
    }),
    [contractId, address],
  );
}
