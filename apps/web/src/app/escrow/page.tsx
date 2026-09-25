"use client";

import {
  EscrowClient,
  SigningError,
  isTerminalEscrowState,
  type Escrow,
} from "@sororail/sdk";
import { useEffect, useState } from "react";

import { CardSkeleton } from "@/components/CardSkeleton";
import { Confirm } from "@/components/Confirm";
import { EmptyState, ErrorNotice, SuccessNotice } from "@/components/Feedback";
import { Address, Money } from "@/components/Money";
import {
  AddPositionForm,
  PositionHeader,
  usePositions,
} from "@/components/PositionRegistry";
import { PositionCardState } from "@/components/PositionCardState";
import { WhenLabel } from "@/components/Schedule";
import type { Position } from "@/lib/positions";
import { useWallet } from "@/lib/wallet";
import { usePositionCard } from "@/hooks/usePositionCard";

type Action = "fund" | "release" | "refund" | "dispute";

export default function EscrowPage() {
  const positions = usePositions("escrow");

  return (
    <div className="stack">
      <div>
        <h1>Escrow</h1>
        <p className="muted page-intro">
          Funds held by the contract until released, refunded, or split by an
          arbiter. The beneficiary cannot release to themselves.
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="card">
          <EmptyState title="No escrows tracked yet">
            Deploy an escrow contract, then paste its address below to watch it.
          </EmptyState>
        </div>
      ) : (
        positions.map((position) => (
          <EscrowCard key={position.contractId} position={position} />
        ))
      )}

      <AddPositionForm kind="escrow" noun="escrow" />
    </div>
  );
}

function EscrowCard({ position }: { position: Position }) {
  const { address, signer } = useWallet();
  const [actionError, setActionError] = useState<unknown>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; hash: string } | null>(null);
  const [now, setNow] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));

  const { data: escrow, loadError, client, refresh } = usePositionCard(
    EscrowClient,
    position,
    address,
  );

  useEffect(() => {
    const id = setInterval(
      () => setNow(BigInt(Math.floor(Date.now() / 1000))),
      1_000,
    );
    return () => clearInterval(id);
  }, []);

  async function run(action: Action) {
    if (!signer || !address) {
      setActionError(
        new SigningError("Wallet disconnected. Reconnect to continue."),
      );
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const call =
        action === "fund"
          ? await client.fund()
          : action === "release"
            ? await client.release(address)
            : action === "refund"
              ? await client.refund(address)
              : await client.dispute(address);
      const sent = await call.signAndSend(signer);
      setDone({ text: successMessage(action), hash: sent.hash });
      setPending(null);
      await refresh();
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(false);
    }
  }

  if (!address) {
    return (
      <div className="card">
        <PositionHeader position={position} />
        <p className="small muted">Connect a wallet to read this escrow.</p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="card stack stack--tight">
        <PositionHeader position={position} />
        <ErrorNotice error={loadError} />
        <div>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!escrow) {
    return (
      <div className="card">
        <PositionHeader position={position} />
        <CardSkeleton />
      </div>
    );
  }

  const isDepositor = address === escrow.depositor;
  const isArbiter = escrow.arbiter !== null && address === escrow.arbiter;
  const isBeneficiary = address === escrow.beneficiary;
  const closed = isTerminalEscrowState(escrow.state);
  const pastDeadline = now >= escrow.deadline;

  return (
    <div className="card stack stack--tight">
      <PositionHeader position={position} />

      <div className="row">
        <span className={`pill ${closed ? "pill--done" : "pill--active"}`}>
          {escrow.state}
        </span>
        {escrow.arbiter ? (
          <span className="pill">Arbitrated</span>
        ) : (
          <span className="pill">No arbiter</span>
        )}
        {isDepositor ? <span className="pill">You deposited</span> : null}
        {isBeneficiary ? <span className="pill">You receive</span> : null}
        {isArbiter ? <span className="pill">You arbitrate</span> : null}
      </div>

      <div className="grid">
        <div>
          <div className="label">Amount</div>
          <Money value={escrow.amount} size="lg" />
        </div>
        <div>
          <div className="label">Deadline</div>
          <div>
            <WhenLabel at={escrow.deadline} now={now} />
          </div>
          <div className="small muted">
            {pastDeadline
              ? "The depositor can now refund unilaterally."
              : "Until then, only the arbiter can refund."}
          </div>
        </div>
      </div>

      <div className="small muted">
        <div>
          Depositor <Address value={escrow.depositor} />
        </div>
        <div>
          Beneficiary <Address value={escrow.beneficiary} />
        </div>
        {escrow.arbiter ? (
          <div>
            Arbiter <Address value={escrow.arbiter} />
          </div>
        ) : (
          <div>
            No arbiter — this escrow cannot be disputed, and only the depositor
            can refund, after the deadline.
          </div>
        )}
      </div>

      {done ? <SuccessNotice hash={done.hash}>{done.text}</SuccessNotice> : null}
      {actionError && !pending ? <ErrorNotice error={actionError} /> : null}

      <div className="stack stack--tight">
        <div className="row">
          <button
            type="button"
            className="button--primary"
            disabled={escrow.state !== "Created" || !isDepositor}
            aria-disabled={escrow.state !== "Created" || !isDepositor}
            onClick={() => setPending("fund")}
          >
            Fund
          </button>
          <button
            type="button"
            className="button--primary"
            disabled={escrow.state !== "Funded" || !(isDepositor || isArbiter)}
            aria-disabled={escrow.state !== "Funded" || !(isDepositor || isArbiter)}
            onClick={() => setPending("release")}
          >
            Release
          </button>
          <button
            type="button"
            disabled={
              escrow.state !== "Funded" ||
              !(isArbiter || (isDepositor && pastDeadline))
            }
            aria-disabled={
              escrow.state !== "Funded" ||
              !(isArbiter || (isDepositor && pastDeadline))
            }
            onClick={() => setPending("refund")}
          >
            Refund
          </button>
          <button
            type="button"
            className="button--danger"
            disabled={
              escrow.state !== "Funded" ||
              escrow.arbiter === null ||
              !(isDepositor || isBeneficiary)
            }
            aria-disabled={
              escrow.state !== "Funded" ||
              escrow.arbiter === null ||
              !(isDepositor || isBeneficiary)
            }
            onClick={() => setPending("dispute")}
          >
            Dispute
          </button>
        </div>
        {isBeneficiary && !isDepositor && escrow.state === "Funded" && (
          <div className="small muted">
            The beneficiary cannot release to themselves — that is the point of the escrow.
          </div>
        )}
        {isDepositor && !pastDeadline && escrow.state === "Funded" && (
          <div className="small muted">
            The depositor can only refund after the deadline.
          </div>
        )}
        {escrow.arbiter === null && escrow.state === "Funded" && (
          <div className="small muted">
            No arbiter was configured, so there is nobody to resolve a dispute.
          </div>
        )}
      </div>

      {pending ? (
        <Confirm
          title={confirmTitle(pending)}
          danger={pending === "dispute"}
          lines={[
            { label: "Amount", value: <Money value={escrow.amount} /> },
            {
              label: pending === "refund" ? "Returns to" : "Goes to",
              value: (
                <Address
                  value={
                    pending === "release" ? escrow.beneficiary : escrow.depositor
                  }
                />
              ),
            },
            { label: "Contract", value: <Address value={position.contractId} /> },
          ]}
          irreversible={irreversibleNote(pending)}
          confirmLabel={confirmTitle(pending)}
          busy={busy}
          error={actionError ? <ErrorNotice error={actionError} /> : null}
          onConfirm={() => void run(pending)}
          onCancel={() => {
            setPending(null);
            setActionError(null);
          }}
        />
      ) : null}
    </div>
  );
}

function successMessage(action: Action): string {
  switch (action) {
    case "fund":
      return "Escrow funded.";
    case "release":
      return "Funds released to the beneficiary.";
    case "refund":
      return "Funds refunded to the depositor.";
    case "dispute":
      return "Dispute raised. The arbiter will now decide.";
  }
}

function confirmTitle(action: Action): string {
  switch (action) {
    case "fund":
      return "Fund escrow";
    case "release":
      return "Release to beneficiary";
    case "refund":
      return "Refund to depositor";
    case "dispute":
      return "Raise a dispute";
  }
}

function irreversibleNote(action: Action): string {
  switch (action) {
    case "fund":
      return "The funds leave your account and are held by the contract. From then on they can only be released to the beneficiary, refunded to you after the deadline, or split by the arbiter.";
    case "release":
      return "The beneficiary is paid in full and the escrow closes permanently. There is no way to claw this back.";
    case "refund":
      return "The full amount returns to the depositor and the escrow closes permanently.";
    case "dispute":
      return "The escrow freezes. Neither release nor refund is possible afterwards — only the arbiter can decide how the funds are split, and their decision is final.";
  }
}
