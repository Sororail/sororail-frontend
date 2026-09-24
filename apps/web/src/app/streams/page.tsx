"use client";

import { SigningError, StreamClient, type Stream } from "@sororail/sdk";
import { useCallback, useEffect, useState } from "react";

import { CardSkeleton } from "@/components/CardSkeleton";
import { Confirm } from "@/components/Confirm";
import { EmptyState, ErrorNotice, SuccessNotice } from "@/components/Feedback";
import { Money, Address } from "@/components/Money";
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

export default function StreamsPage() {
  const positions = usePositions("stream");

  return (
    <div className="stack">
      <div>
        <h1>Streams</h1>
        <p className="muted page-intro">
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
  const [available, setAvailable] = useState<bigint | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pending, setPending] = useState<"withdraw" | "cancel" | "topUp" | "extend" | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [extendDate, setExtendDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; hash: string } | null>(null);
  const [now, setNow] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));

  const { data: stream, loadError, client, refresh } = usePositionCard(
    StreamClient,
    position,
    address,
  );

  // Read balance separately after stream data loads
  useEffect(() => {
    if (!address || !stream) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    client
      .balanceOf(stream.recipient)
      .then((bal) => {
        if (!cancelled) setAvailable(bal);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to read balance", error);
          setAvailable(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address, stream, client]);

  // Keep the clock moving so the schedule and accrual stay honest on screen.
  useEffect(() => {
    const id = setInterval(
      () => setNow(BigInt(Math.floor(Date.now() / 1000))),
      1_000,
    );
    return () => clearInterval(id);
  }, []);

  async function run(action: "withdraw" | "cancel" | "topUp" | "extend") {
    if (!signer) {
      setActionError(
        new SigningError("Wallet disconnected. Reconnect to continue."),
      );
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      let call;
      let successText: string;
      if (action === "withdraw") {
        call = await client.withdraw();
        successText = "Withdrew accrued funds.";
      } else if (action === "cancel") {
        call = await client.cancel();
        successText = "Stream cancelled.";
      } else if (action === "topUp") {
        const stroops = BigInt(Math.round(parseFloat(topUpAmount) * 1e7));
        call = await client.topUp(stroops);
        successText = "Stream topped up.";
      } else {
        const ts = BigInt(Math.floor(new Date(extendDate).getTime() / 1000));
        call = await client.extend(ts);
        successText = "Stream end date extended.";
      }
      const sent = await call.signAndSend(signer);
      setDone({ text: successText, hash: sent.hash });
      setPending(null);
      setTopUpAmount("");
      setExtendDate("");
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
        <div>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="card">
        <PositionHeader position={position} />
        <CardSkeleton />
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

      <div className="stack stack--tight">
        <div className="row">
          <button
            type="button"
            className="button--primary"
            disabled={!isRecipient || available === null || available <= 0n}
            aria-disabled={!isRecipient || available === null || available <= 0n}
            onClick={() => setPending("withdraw")}
          >
            Withdraw
          </button>
          <button
            type="button"
            disabled={Boolean(stream.cancelledAt) || ended}
            aria-disabled={Boolean(stream.cancelledAt) || ended}
            onClick={() => setPending("topUp")}
          >
            Top up
          </button>
          <button
            type="button"
            disabled={Boolean(stream.cancelledAt) || ended}
            aria-disabled={Boolean(stream.cancelledAt) || ended}
            onClick={() => setPending("extend")}
          >
            Extend
          </button>
          <button
            type="button"
            className="button--danger"
            disabled={!isSender || !stream.cancellable || Boolean(stream.cancelledAt)}
            aria-disabled={!isSender || !stream.cancellable || Boolean(stream.cancelledAt)}
            onClick={() => setPending("cancel")}
          >
            Cancel stream
          </button>
        </div>
        {(!isRecipient || available === null) && (
          <div className="small muted">
            {!isRecipient && "Only the recipient can withdraw from a stream."}
            {isRecipient && available === null && "Unable to read balance from chain."}
          </div>
        )}
        {(stream.cancelledAt || ended) && (
          <div className="small muted">
            {stream.cancelledAt && "This stream has been cancelled."}
            {!stream.cancelledAt && ended && "This stream has already ended."}
          </div>
        )}
        {(!isSender || !stream.cancellable || stream.cancelledAt) && (
          <div className="small muted">
            {!isSender && !stream.cancellable && !stream.cancelledAt && "Only the sender can cancel this stream, and it was created as non-cancellable."}
            {!isSender && stream.cancellable && !stream.cancelledAt && "Only the sender can cancel this stream."}
            {!stream.cancellable && isSender && !stream.cancelledAt && "This stream was created as non-cancellable."}
            {stream.cancelledAt && "This stream has been cancelled."}
          </div>
        )}
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

      {pending === "topUp" ? (
        <Confirm
          title="Top up this stream"
          lines={[
            {
              label: "Amount (XLM)",
              value: (
                <input
                  type="number"
                  min="0"
                  step="0.0000001"
                  placeholder="e.g. 10"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="input"
                />
              ),
            },
            { label: "Contract", value: <Address value={position.contractId} /> },
          ]}
          irreversible="Funds are transferred immediately from your account to the stream contract. The stop time advances by the span they buy at the current rate. The amount must be an exact multiple of the rate per second."
          confirmLabel="Top up"
          busy={busy}
          error={actionError ? <ErrorNotice error={actionError} /> : null}
          onConfirm={() => void run("topUp")}
          onCancel={() => {
            setPending(null);
            setTopUpAmount("");
            setActionError(null);
          }}
        />
      ) : null}

      {pending === "extend" ? (
        <Confirm
          title="Extend this stream"
          lines={[
            {
              label: "New end date",
              value: (
                <input
                  type="datetime-local"
                  value={extendDate}
                  onChange={(e) => setExtendDate(e.target.value)}
                  className="input"
                />
              ),
            },
            { label: "Contract", value: <Address value={position.contractId} /> },
          ]}
          irreversible="Funds covering the extra span are pulled from your account immediately. The new stop time must be later than the current one."
          confirmLabel="Extend"
          busy={busy}
          error={actionError ? <ErrorNotice error={actionError} /> : null}
          onConfirm={() => void run("extend")}
          onCancel={() => {
            setPending(null);
            setExtendDate("");
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
                  value={stream.deposited - stream.withdrawn - (available ?? 0n) > 0n ? stream.deposited - stream.withdrawn - (available ?? 0n) : 0n}
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
