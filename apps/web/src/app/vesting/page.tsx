"use client";

import { VestingClient, type Grant } from "@sororail/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Confirm } from "@/components/Confirm";
import { EmptyState, ErrorNotice, SuccessNotice } from "@/components/Feedback";
import { Address, Money } from "@/components/Money";
import {
  AddPositionForm,
  PositionHeader,
  usePositions,
} from "@/components/PositionRegistry";
import { Schedule } from "@/components/Schedule";
import { NETWORK_PASSPHRASE, RPC_URL } from "@/lib/network";
import type { Position } from "@/lib/positions";
import { useWallet } from "@/lib/wallet";

export default function VestingPage() {
  const positions = usePositions("vesting");

  return (
    <div className="stack">
      <div>
        <h1>Vesting</h1>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
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
  const [grant, setGrant] = useState<Grant | null>(null);
  const [claimable, setClaimable] = useState<bigint | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pending, setPending] = useState<"claim" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; hash: string } | null>(null);
  const [now, setNow] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));

  const client = useMemo(
    () =>
      new VestingClient({
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
      setGrant(await client.get());
      setClaimable(await client.claimable());
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  }, [client, address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(
      () => setNow(BigInt(Math.floor(Date.now() / 1000))),
      1_000,
    );
    return () => clearInterval(id);
  }, []);

  async function run(action: "claim" | "revoke") {
    if (!signer) return;
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
      </div>
    );
  }
  if (!grant) {
    return (
      <div className="card">
        <PositionHeader position={position} />
        <p className="small muted">Reading from the chain…</p>
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

      <div className="row">
        <button
          type="button"
          className="button--primary"
          disabled={!isBeneficiary || !claimable || claimable <= 0n}
          onClick={() => setPending("claim")}
          title={
            isBeneficiary
              ? beforeCliff
                ? "Nothing vests until the cliff."
                : undefined
              : "Only the beneficiary can claim."
          }
        >
          Claim
        </button>
        <button
          type="button"
          className="button--danger"
          disabled={!isGrantor || !grant.revocable || Boolean(grant.revokedAt)}
          onClick={() => setPending("revoke")}
          title={
            grant.revocable
              ? isGrantor
                ? undefined
                : "Only the grantor can revoke."
              : "This grant was created as non-revocable."
          }
        >
          Revoke
        </button>
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
              value: <Money value={grant.total - grant.claimed - (claimable ?? 0n)} approximate />,
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
