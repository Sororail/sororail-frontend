"use client";

import { SigningError, VestingClient, type Grant } from "@sororail/sdk";
import { useCallback, useEffect, useState } from "react";

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
import { Schedule } from "@/components/Schedule";
import type { Position } from "@/lib/positions";
import { useWallet } from "@/lib/wallet";
import { usePositionCard } from "@/hooks/usePositionCard";

export default function VestingPage() {
  const positions = usePositions("vesting");

  return (
    <div className="stack">
      <div>
        <h1>Vesting</h1>
        <p className="muted page-intro">
          Nothing vests before the cliff. After it, vesting is linear until the
          schedule ends.
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="card">
          <EmptyState title="No grants tracked yet">
            Deploy a vesting contract, then paste its address below to watch it.
          </EmptyState>
        </div>
      ) : (
        positions.map((position) => (
          <GrantCard key={position.contractId} position={position} />
        ))
      )}

      <AddPositionForm kind="vesting" noun="grant" />
    </div>
  );
}

function GrantCard({ position }: { position: Position }) {
  const { address, signer } = useWallet();
  const [claimable, setClaimable] = useState<bigint | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pending, setPending] = useState<"claim" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; hash: string } | null>(null);
  const [now, setNow] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));

  const { data: grant, loadError, client, refresh } = usePositionCard(
    VestingClient,
    position,
    address,
    useCallback(async (client: VestingClient, isCurrent?: () => boolean) => {
      try {
        const amount = await client.claimable();
        if (isCurrent && !isCurrent()) return;
        setClaimable(amount);
      } catch (error) {
        if (isCurrent && !isCurrent()) return;
        console.error("Failed to read claimable", error);
        setClaimable(null);
      }
    }, []),
  );

  useEffect(() => {
    if (!address) {
      setClaimable(null);
    }
  }, [address]);

  useEffect(() => {
    const id = setInterval(
      () => setNow(BigInt(Math.floor(Date.now() / 1000))),
      1_000,
    );
    return () => clearInterval(id);
  }, []);

  async function run(action: "claim" | "revoke") {
    if (!signer) {
      setActionError(
        new SigningError("Wallet disconnected. Reconnect to continue."),
      );
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const call = action === "claim" ? await client.claim() : await client.revoke();
      const sent = await call.signAndSend(signer);
      setDone({
        text:
          action === "claim"
            ? "Claimed vested tokens."
            : "Grant revoked. The vested portion stays claimable.",
        hash: sent.hash,
      });
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
        <p className="small muted">Connect a wallet to read this grant.</p>
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
  if (!grant) {
    return (
      <div className="card">
        <PositionHeader position={position} />
        <CardSkeleton />
      </div>
    );
  }

  // cliff and duration are spans from start, not timestamps.
  const cliffAt = grant.start + grant.cliff;
  const endAt = grant.start + grant.duration;
  const isBeneficiary = address === grant.beneficiary;
  const isGrantor = address === grant.grantor;
  const beforeCliff = now < cliffAt;

  return (
    <div className="card stack stack--tight">
      <PositionHeader position={position} />

      <div className="row">
        {grant.revokedAt ? (
          <span className="pill pill--done">Revoked</span>
        ) : now >= endAt ? (
          <span className="pill pill--done">Fully vested</span>
        ) : beforeCliff ? (
          <span className="pill pill--warn">Before cliff</span>
        ) : (
          <span className="pill pill--active">Vesting</span>
        )}
        {grant.revocable && !grant.revokedAt ? (
          <span className="pill">Revocable</span>
        ) : null}
        {isBeneficiary ? <span className="pill">You receive</span> : null}
        {isGrantor ? <span className="pill">You granted</span> : null}
      </div>

      <Schedule
        start={grant.start}
        end={endAt}
        now={now}
        marks={[
          { at: cliffAt, label: "cliff" },
          ...(grant.revokedAt ? [{ at: grant.revokedAt, label: "revoked" }] : []),
        ]}
      />

      <div className="grid">
        <Figure label="Total granted">
          <Money value={grant.total} />
        </Figure>
        <Figure label="Claimed">
          <Money value={grant.claimed} direction="outgoing" />
        </Figure>
        <Figure label="Claimable now">
          {claimable === null ? (
            <span className="muted small">—</span>
          ) : (
            <Money
              value={claimable}
              direction="incoming"
              approximate={!grant.revokedAt}
            />
          )}
        </Figure>
        <Figure label="Returned to grantor">
          <Money value={grant.returned} />
        </Figure>
      </div>

      <div className="small muted">
        <div>
          Grantor <Address value={grant.grantor} />
        </div>
        <div>
          Beneficiary <Address value={grant.beneficiary} />
        </div>
      </div>

      {done ? <SuccessNotice hash={done.hash}>{done.text}</SuccessNotice> : null}
      {actionError && !pending ? <ErrorNotice error={actionError} /> : null}

      <div className="stack stack--tight">
        <div className="row">
          <button
            type="button"
            className="button--primary"
            disabled={!isBeneficiary || !claimable || claimable <= 0n}
            aria-disabled={!isBeneficiary || !claimable || claimable <= 0n}
            onClick={() => setPending("claim")}
          >
            Claim
          </button>
          <button
            type="button"
            className="button--danger"
            disabled={!isGrantor || !grant.revocable || Boolean(grant.revokedAt)}
            aria-disabled={!isGrantor || !grant.revocable || Boolean(grant.revokedAt)}
            onClick={() => setPending("revoke")}
          >
            Revoke
          </button>
        </div>
        {(!isBeneficiary || beforeCliff) && (
          <div className="small muted">
            {!isBeneficiary && "Only the beneficiary can claim."}
            {isBeneficiary && beforeCliff && "Nothing vests until the cliff."}
          </div>
        )}
        {(!isGrantor || !grant.revocable || grant.revokedAt) && (
          <div className="small muted">
            {!isGrantor && !grant.revocable && !grant.revokedAt && "Only the grantor can revoke, and this grant was created as non-revocable."}
            {!isGrantor && grant.revocable && !grant.revokedAt && "Only the grantor can revoke."}
            {!grant.revocable && isGrantor && !grant.revokedAt && "This grant was created as non-revocable."}
            {grant.revokedAt && "This grant has been revoked."}
          </div>
        )}
      </div>

      {pending === "claim" && claimable !== null ? (
        <Confirm
          title="Claim vested tokens"
          lines={[
            { label: "To", value: <Address value={grant.beneficiary} /> },
            { label: "Amount", value: <Money value={claimable} approximate /> },
          ]}
          irreversible="The transfer settles on chain and cannot be reversed. The exact amount may be slightly higher than shown, because vesting continues until the transaction lands."
          confirmLabel="Claim"
          busy={busy}
          error={actionError ? <ErrorNotice error={actionError} /> : null}
          onConfirm={() => void run("claim")}
          onCancel={() => {
            setPending(null);
            setActionError(null);
          }}
        />
      ) : null}

      {pending === "revoke" ? (
        <Confirm
          title="Revoke this grant"
          danger
          lines={[
            {
              label: "Returns to you",
              value: <Money value={grant.total - grant.claimed - (claimable ?? 0n) > 0n ? grant.total - grant.claimed - (claimable ?? 0n) : 0n} approximate />,
            },
            {
              label: "Stays claimable by beneficiary",
              value: claimable ? <Money value={claimable} approximate /> : "—",
            },
            { label: "Beneficiary", value: <Address value={grant.beneficiary} /> },
          ]}
          irreversible="Vesting stops permanently and the grant cannot be restarted. Whatever has already vested stays in the contract and remains claimable by the beneficiary — only the unvested remainder comes back to you."
          confirmLabel="Revoke grant"
          busy={busy}
          error={actionError ? <ErrorNotice error={actionError} /> : null}
          onConfirm={() => void run("revoke")}
          onCancel={() => {
            setPending(null);
            setActionError(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div>{children}</div>
    </div>
  );
}
