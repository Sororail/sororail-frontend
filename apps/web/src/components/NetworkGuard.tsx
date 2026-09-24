"use client";

import { useEffect, useState, type ReactNode } from "react";

import { NETWORK_PASSPHRASE, RPC_URL } from "@/lib/network";

export function NetworkGuard({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"checking" | "ready" | "error">("checking");

  useEffect(() => {
    let mounted = true;
    void fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getNetwork" }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
        const payload: unknown = await response.json();
        if (typeof payload !== "object" || payload === null || !("result" in payload)) {
          throw new Error("RPC returned an invalid getNetwork response.");
        }
        const result = (payload as { result?: { passphrase?: unknown } }).result;
        return result?.passphrase;
      })
      .then((network) => {
        if (!mounted) return;
        if (network !== NETWORK_PASSPHRASE) {
          console.error("Configured RPC network does not match testnet.");
          setStatus("error");
          return;
        }
        setStatus("ready");
      })
      .catch((error: unknown) => {
        console.error("Unable to validate the configured RPC network.", error);
        if (mounted) setStatus("error");
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (status === "checking") return <p>Validating testnet connection…</p>;
  if (status === "error") {
    return (
      <p role="alert">
        This app is unavailable because the configured RPC endpoint is not the
        Stellar testnet. Check NEXT_PUBLIC_RPC_URL and try again.
      </p>
    );
  }
  return children;
}
