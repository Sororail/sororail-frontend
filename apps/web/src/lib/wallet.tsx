"use client";

import { FreighterSigner, type Signer } from "@sororail/sdk";
import {
  createContext,
  useCallback,
  useContext,
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

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
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

  const disconnect = useCallback(() => {
    // Forgets the session locally. The extension stays connected to the site
    // until the user revokes it there, which is the extension's call to make.
    setSigner(null);
    setError(null);
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
