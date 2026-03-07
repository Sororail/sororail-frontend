"use client";

import { StreamClient, type Stream } from "@sororail/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Confirm } from "@/components/Confirm";
import { EmptyState, ErrorNotice, SuccessNotice } from "@/components/Feedback";
import { Money, Address } from "@/components/Money";
import {
  AddPositionForm,
  PositionHeader,
  usePositions,
} from "@/components/PositionRegistry";
import { Schedule } from "@/components/Schedule";
import { NETWORK_PASSPHRASE, RPC_URL } from "@/lib/network";
import type { Position } from "@/lib/positions";
import { useWallet } from "@/lib/wallet";

export default function StreamsPage() {
  const positions = usePositions("stream");

  return (
    <div className="stack">
      <div>
        <h1>Streams</h1>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
          Continuous per-second transfer. Accrual is computed from ledger time,
          so a balance rises without any transaction being sent.
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="card">
          <EmptyState title="No streams tracked yet">
            Deploy a stream contract, then paste its address below to watch it.
          </EmptyState>
        </div>
      ) : (
        positions.map((position) => (
          <StreamCard key={position.contractId} position={position} />
        ))
      )}

      <AddPositionForm kind="stream" noun="stream" />
    </div>
  );
}

function StreamCard({ position }: { position: Position }) {
  const { address, signer } = useWallet();
  const [stream, setStream] = useState<Stream | null>(null);
  const [available, setAvailable] = useState<bigint | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pending, setPending] = useState<"withdraw" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; hash: string } | null>(null);
  const [now, setNow] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));

  const client = useMemo(
    () =>
      new StreamClient({
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
      const record = await client.get();
      setStream(record);
      setLoadError(null);
      // Read the recipient's position; if the connected wallet is the sender,
      // balanceOf reports their refundable remainder instead.
      setAvailable(await client.balanceOf(record.recipient));
    } catch (error) {
      setLoadError(error);
    }
  }, [client, address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the clock moving so the schedule and accrual stay honest on screen.
  useEffect(() => {
    const id = setInterval(
      () => setNow(BigInt(Math.floor(Date.now() / 1000))),
      1_000,
    );
    return () => clearInterval(id);
  }, []);

  async function run(action: "withdraw" | "cancel") {
    if (!signer) return;
    setBusy(true);
    setActionError(null);
    try {
      const call =
        action === "withdraw" ? await client.withdraw() : await client.cancel();
      const sent = await call.signAndSend(signer);
      setDone({
        text: action === "withdraw" ? "Withdrew accrued funds." : "Stream cancelled.",
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
        <p className="small muted">Connect a wallet to read this stream.</p>
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

  if (!stream) {
    return (
      <div className="card">
        <PositionHeader position={position} />
        <p className="small muted">Reading from the chain…</p>
      </div>
    );
  }

  const isRecipient = address === stream.recipient;
  const isSender = address === stream.sender;
  const ended = now >= stream.stop;

  return (
    <div className="card stack stack--tight">
      <PositionHeader position={position} />

      <div className="row">
        {stream.cancelledAt ? (
          <span className="pill pill--done">Cancelled</span>
        ) : ended ? (
          <span className="pill pill--done">Ended</span>
        ) : (
          <span className="pill pill--active">Streaming</span>
        )}
        {stream.cancellable && !stream.cancelledAt ? (
          <span className="pill">Cancellable</span>
        ) : null}
        {isRecipient ? <span className="pill">You receive</span> : null}
        {isSender ? <span className="pill">You send</span> : null}
      </div>

      <Schedule
        start={stream.start}
        end={stream.stop}
        now={now}
        {...(stream.cancelledAt
          ? { marks: [{ at: stream.cancelledAt, label: "cancelled" }] }
          : {})}
      />

      <div className="grid">
        <Figure label="Rate">
          <Money value={stream.ratePerSecond} unit="XLM/s" />
        </Figure>
        <Figure label="Deposited">
          <Money value={stream.deposited} />
        </Figure>
        <Figure label="Withdrawn">
          <Money value={stream.withdrawn} direction="outgoing" />
        </Figure>
        <Figure label="Available to recipient">
          {available === null ? (
            <span className="muted small">—</span>
          ) : (
            /* Approximate: accrual continues between this read and any
               transaction landing. */
            <Money value={available} direction="incoming" approximate />
          )}
        </Figure>
      </div>

      <div className="small muted">
        <div>
          Sender <Address value={stream.sender} />
        </div>
        <div>
          Recipient <Address value={stream.recipient} />
        </div>
      </div>

      {done ? <SuccessNotice hash={done.hash}>{done.text}</SuccessNotice> : null}
      {actionError && !pending ? <ErrorNotice error={actionError} /> : null}

      <div className="row">
        <button
          type="button"
          className="button--primary"
          disabled={!isRecipient || !available || available <= 0n}
          onClick={() => setPending("withdraw")}
          title={
            isRecipient
              ? undefined
              : "Only the recipient can withdraw from a stream."
          }
        >
          Withdraw
        </button>
        <button
          type="button"
          className="button--danger"
          disabled={!isSender || !stream.cancellable || Boolean(stream.cancelledAt)}
          onClick={() => setPending("cancel")}
          title={
            stream.cancellable
              ? isSender
                ? undefined
                : "Only the sender can cancel."
              : "This stream was created as non-cancellable."
          }
        >
          Cancel stream
        </button>
      </div>

      {pending === "withdraw" && available !== null ? (
        <Confirm
          title="Withdraw accrued funds"
          lines={[
            { label: "To", value: <Address value={stream.recipient} /> },
            {
              label: "Amount",
              value: <Money value={available} approximate direction="incoming" />,
            },
            { label: "Contract", value: <Address value={position.contractId} /> },
          ]}
          irreversible={
            "The transfer settles on chain and cannot be reversed. The exact amount may be slightly higher than shown, because the stream keeps accruing until the transaction lands."
          }
          confirmLabel="Withdraw"
          busy={busy}
          error={actionError ? <ErrorNotice error={actionError} /> : null}
          onConfirm={() => void run("withdraw")}
          onCancel={() => {
            setPending(null);
            setActionError(null);
          }}
        />
      ) : null}

      {pending === "cancel" ? (
        <Confirm
          title="Cancel this stream"
          danger
          lines={[
            {
              label: "Settles to recipient",
              value: available ? <Money value={available} approximate /> : "—",
            },
            {
              label: "Returns to you",
              value: (
                <Money
                  value={stream.deposited - stream.withdrawn - (available ?? 0n)}
                  approximate
                />
              ),
            },
            { label: "Recipient", value: <Address value={stream.recipient} /> },
          ]}
          irreversible={
            "The stream stops permanently and cannot be restarted. Whatever has accrued is paid to the recipient immediately; the rest returns to you."
          }
          confirmLabel="Cancel stream"
          busy={busy}
          error={actionError ? <ErrorNotice error={actionError} /> : null}
          onConfirm={() => void run("cancel")}
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
