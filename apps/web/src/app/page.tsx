"use client";

import Link from "next/link";

import { usePositions } from "@/components/PositionRegistry";
import { BATCH_PAYOUT_CONTRACT, explorerContract } from "@/lib/network";
import { useWallet } from "@/lib/wallet";

export default function OverviewPage() {
  const { address, connect, connecting } = useWallet();
  const streams = usePositions("stream");
  const grants = usePositions("vesting");
  const escrows = usePositions("escrow");
  const subscriptions = usePositions("recurring");

  return (
    <div className="stack">
      <div>
        <h1>Overview</h1>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
          A reference application for the SoroRail payment contracts. Everything
          shown here is read from the chain.
        </p>
      </div>

      {!address ? (
        <div className="card stack stack--tight">
          <h2>Connect a wallet to begin</h2>
          <p className="small muted" style={{ margin: 0 }}>
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
      ) : null}

      <div className="grid">
        <Tile
          href="/payroll"
          title="Payroll"
          count={null}
          body="Pay many recipients in one transaction, or set up a recurring charge."
        />
        <Tile
          href="/streams"
          title="Streams"
          count={streams.length}
          body="Continuous per-second transfer. Withdraw, top up, extend or cancel."
        />
        <Tile
          href="/vesting"
          title="Vesting"
          count={grants.length}
          body="Scheduled release with a cliff. Claim what has vested, or revoke."
        />
        <Tile
          href="/escrow"
          title="Escrow"
          count={escrows.length}
          body="Funds held until a condition is met, with an optional arbiter."
        />
      </div>

      <div className="card stack stack--tight">
        <h2>How this app finds your positions</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Each escrow, stream, grant and subscription is its own deployed
          contract, holding exactly one position for its whole life. There is no
          on-chain index tying them to your account, so this app keeps a list of
          addresses you have told it about, in this browser only.
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          That list is a convenience, not a record. Every balance and state you
          see is read from the contract itself, and removing an address from the
          list changes nothing on chain.
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          <strong>{subscriptions.length}</strong> subscription
          {subscriptions.length === 1 ? "" : "s"} tracked.{" "}
          <code className="addr">batch_payout</code> is the exception — it is
          stateless, so one shared deployment serves everybody:{" "}
          <a
            href={explorerContract(BATCH_PAYOUT_CONTRACT)}
            target="_blank"
            rel="noreferrer"
            className="addr"
          >
            {BATCH_PAYOUT_CONTRACT.slice(0, 8)}…
          </a>
        </p>
      </div>

      <div className="notice notice--warn">
        <div className="notice__title">Not yet built</div>
        <div className="notice__detail">
          The indexer, unified history feed and CSV export described in the spec
          are not implemented. There is no database and no backend — this app is
          entirely client-side against Soroban RPC.
        </div>
      </div>
    </div>
  );
}

function Tile({
  href,
  title,
  count,
  body,
}: {
  href: string;
  title: string;
  count: number | null;
  body: string;
}) {
  return (
    <Link href={href} className="card" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="spread">
        <h2>{title}</h2>
        {count !== null ? <span className="pill">{count} tracked</span> : null}
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        {body}
      </p>
    </Link>
  );
}
