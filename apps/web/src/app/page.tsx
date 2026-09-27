import Link from "next/link";
import type { ReactNode } from "react";

import { ContractLink } from "@/components/ContractLink";
import {
  ConnectWalletCard,
  PositionCount,
} from "@/components/OverviewInteractive";
import { PositionBackup } from "@/components/PositionRegistry";
import { BATCH_PAYOUT_CONTRACT, shortAddress } from "@/lib/network";

export default function OverviewPage() {
  return (
    <div className="stack">
      <div>
        <h1>Overview</h1>
        <p className="muted page-intro">
          A reference application for the SoroRail payment contracts. Everything
          shown here is read from the chain.
        </p>
      </div>

      <ConnectWalletCard />

      <div className="grid">
        <Tile
          href="/payroll"
          title="Payroll"
          body="Pay many recipients in one transaction."
        />
        <Tile
          href="/streams"
          title="Streams"
          count={<PositionCount kind="stream" />}
          body="Continuous per-second transfer. Withdraw, top up, extend or cancel."
        />
        <Tile
          href="/vesting"
          title="Vesting"
          count={<PositionCount kind="vesting" />}
          body="Scheduled release with a cliff. Claim what has vested, or revoke."
        />
        <Tile
          href="/escrow"
          title="Escrow"
          count={<PositionCount kind="escrow" />}
          body="Funds held until a condition is met, with an optional arbiter."
        />
      </div>

      <div className="card stack stack--tight">
        <h2>How this app finds your positions</h2>
        <p className="small muted m-0">
          Each escrow, stream and grant is its own deployed contract, holding
          exactly one position for its whole life. There is no on-chain index
          tying them to your account, so this app keeps a list of addresses you
          have told it about, in this browser only.
        </p>
        <p className="small muted m-0">
          That list is a convenience, not a record. Every balance and state you
          see is read from the contract itself, and removing an address from the
          list changes nothing on chain.
        </p>
        <p className="small muted m-0">
          <code className="addr">batch_payout</code> is the exception — it is
          stateless, so one shared deployment serves everybody:{" "}
          <ContractLink id={BATCH_PAYOUT_CONTRACT} className="addr">
            {shortAddress(BATCH_PAYOUT_CONTRACT, 6)}
          </ContractLink>
        </p>
      </div>

      <PositionBackup />

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
  count?: ReactNode;
  body: string;
}) {
  return (
    <Link href={href} className="card card--link">
      <div className="spread">
        <h2>{title}</h2>
        {count}
      </div>
      <p className="small muted mb-0">
        {body}
      </p>
    </Link>
  );
}
