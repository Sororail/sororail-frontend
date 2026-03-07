"use client";

import { EscrowClient, isTerminalEscrowState, type Escrow } from "@sororail/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Confirm } from "@/components/Confirm";
import { EmptyState, ErrorNotice, SuccessNotice } from "@/components/Feedback";
import { Address, Money } from "@/components/Money";
import {
  AddPositionForm,
  PositionHeader,
  usePositions,
} from "@/components/PositionRegistry";
import { WhenLabel } from "@/components/Schedule";
import { NETWORK_PASSPHRASE, RPC_URL } from "@/lib/network";
import type { Position } from "@/lib/positions";
import { useWallet } from "@/lib/wallet";

type Action = "fund" | "release" | "refund" | "dispute";

export default function EscrowPage() {
  const positions = usePositions("escrow");

  return (
    <div className="stack">
      <div>
        <h1>Escrow</h1>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
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
  const [escrow, setEscrow] = useState<Escrow | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; hash: string } | null>(null);
  const now = BigInt(Math.floor(Date.now() / 1000));

  const client = useMemo(
    () =>
      new EscrowClient({
        contractId: position.contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        ...(address ? { publicKey: address } : {}),
      }),
    [position.contractId, address],
  );

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setEscrow(await client.get());
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  }, [client, address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: Action) {
    if (!signer || !address) return;
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
      setDone({ text: `${action} succeeded.`, hash: sent.hash });
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
      </div>
    );
  }
  if (!escrow) {
    return (
      <div className="card">
        <PositionHeader position={position} />
        <p className="small muted">Reading from the chain…</p>
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

      <div className="row">
        <button
          type="button"
          className="button--primary"
          disabled={escrow.state !== "Created" || !isDepositor}
          onClick={() => setPending("fund")}
        >
          Fund
        </button>
        <button
          type="button"
          className="button--primary"
          disabled={escrow.state !== "Funded" || !(isDepositor || isArbiter)}
          onClick={() => setPending("release")}
          title={
            isBeneficiary && !isDepositor
              ? "The beneficiary cannot release to themselves — that is the point of the escrow."
              : undefined
          }
        >
          Release
        </button>
        <button
          type="button"
          disabled={
            escrow.state !== "Funded" ||
            !(isArbiter || (isDepositor && pastDeadline))
          }
          onClick={() => setPending("refund")}
          title={
            isDepositor && !pastDeadline
              ? "The depositor can only refund after the deadline."
              : undefined
          }
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
          onClick={() => setPending("dispute")}
          title={
            escrow.arbiter === null
              ? "No arbiter was configured, so there is nobody to resolve a dispute."
              : undefined
          }
        >
          Dispute
        </button>
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
