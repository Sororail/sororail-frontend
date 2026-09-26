"use client";

import { usePositionCount } from "@/components/PositionRegistry";
import type { PositionKind } from "@/lib/positions";
import { useWallet } from "@/lib/wallet";

export function ConnectWalletCard() {
  const { address, connect, connecting } = useWallet();

  if (address) return null;

  return (
    <div className="card stack stack--tight">
      <h2>Connect a wallet to begin</h2>
      <p className="small muted m-0">
        Signing happens entirely in your wallet. This app never sees a
        secret key, and there is no server here that could store one.
      </p>
      <div>
        <button
          type="button"
          className="button--primary"
          onClick={() => void connect()}
          disabled={connecting}
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      </div>
    </div>
  );
}

export function PositionCount({ kind }: { kind: PositionKind }) {
  const count = usePositionCount(kind);

  return <span className="pill">{count} tracked</span>;
}
