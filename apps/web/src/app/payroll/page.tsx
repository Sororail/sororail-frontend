"use client";

import {
  BatchPayoutClient,
  ValidationError,
  toStroops,
  type Payment,
  type Receipt,
} from "@sororail/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Confirm } from "@/components/Confirm";
import { ErrorNotice, SuccessNotice } from "@/components/Feedback";
import { Address, Money } from "@/components/Money";
import {
  BATCH_PAYOUT_CONTRACT,
  NATIVE_TOKEN,
  NETWORK_PASSPHRASE,
  RPC_URL,
  explorerContract,
} from "@/lib/network";
import { useWallet } from "@/lib/wallet";

interface ParsedLine {
  line: number;
  to: string;
  amount: string;
  error?: string;
}

/**
 * Parses pasted CSV of `address,amount`.
 *
 * Every line is reported, valid or not, so the operator sees exactly which row
 * of their spreadsheet is wrong rather than a single "invalid CSV".
 */
function parseCsv(text: string): ParsedLine[] {
  return text
    .split("\n")
    .map((raw, index) => ({ raw: raw.trim(), index }))
    .filter(({ raw }) => raw.length > 0 && !raw.startsWith("#"))
    .map(({ raw, index }): ParsedLine => {
      const [to = "", amount = ""] = raw.split(",").map((part) => part.trim());
      const line = index + 1;

      if (!/^G[A-Z2-7]{55}$/.test(to)) {
        return { line, to, amount, error: "Not a valid account address (G…)" };
      }
      try {
        const stroops = toStroops(amount);
        if (stroops <= 0n) {
          return { line, to, amount, error: "Amount must be greater than zero" };
        }
      } catch (error) {
        return {
          line,
          to,
          amount,
          error: error instanceof ValidationError ? error.message : "Invalid amount",
        };
      }
      return { line, to, amount };
    });
}

export default function PayrollPage() {
  const { address, signer, connect } = useWallet();
  const [csv, setCsv] = useState("");
  const [cap, setCap] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  const [results, setResults] = useState<{ hash: string; count: number }[]>([]);

  const client = useMemo(
    () =>
      new BatchPayoutClient({
        contractId: BATCH_PAYOUT_CONTRACT,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        ...(address ? { publicKey: address } : {}),
      }),
    [address],
  );

  // Read the cap rather than hardcoding: it is derived from network resource
  // limits and can differ between deployments.
  useEffect(() => {
    if (!address) return;
    void client
      .maxRecipients()
      .then(setCap)
      .catch(() => setCap(null));
  }, [client, address]);

  const parsed = useMemo(() => parseCsv(csv), [csv]);
  const invalid = parsed.filter((line) => line.error);
  const valid = parsed.filter((line) => !line.error);

  const payments = useMemo<Payment[]>(
    () => valid.map((line) => ({ to: line.to, amount: toStroops(line.amount) })),
    [valid],
  );

  // Duplicates are legitimate on chain -- two invoices for one contractor --
  // so this warns rather than blocks. Catching them here is exactly where the
  // contract expects the check to live.
  const duplicates = useMemo(() => {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const payment of payments) {
      if (seen.has(payment.to)) repeated.add(payment.to);
      seen.add(payment.to);
    }
    return [...repeated];
  }, [payments]);

  const batches = useMemo(
    () => (cap ? BatchPayoutClient.chunk(payments, cap) : [payments]),
    [payments, cap],
  );

  const preview = useCallback(async () => {
    setPreviewError(null);
    setReceipt(null);
    try {
      // Preview runs exactly the validation execute does, against the chain.
      setReceipt(await client.preview(payments));
    } catch (error) {
      setPreviewError(error);
    }
  }, [client, payments]);

  async function send() {
    if (!signer || !address) return;
    setBusy(true);
    setSendError(null);
    const sent: { hash: string; count: number }[] = [];
    try {
      for (const chunk of batches) {
        const call = await client.execute({
          funder: address,
          token: NATIVE_TOKEN,
          recipients: chunk,
        });
        const result = await call.signAndSend(signer);
        sent.push({ hash: result.hash, count: result.result.count });
        setResults([...sent]);
      }
      setConfirming(false);
      setCsv("");
      setReceipt(null);
    } catch (error) {
      setSendError(error);
    } finally {
      setBusy(false);
    }
  }

  const total = payments.reduce((sum, payment) => sum + payment.amount, 0n);

  return (
    <div className="stack">
      <div>
        <h1>Payroll</h1>
        <p className="muted" style={{ marginTop: "0.35rem" }}>
          Pay many recipients in one transaction. All-or-nothing: if any
          transfer fails, nobody is paid.
        </p>
      </div>

      {!address ? (
        <div className="card">
          <p className="small muted">Connect a wallet to run a payout.</p>
          <button type="button" className="button--primary" onClick={() => void connect()}>
            Connect wallet
          </button>
        </div>
      ) : null}

      <div className="card stack stack--tight">
        <h2>Recipients</h2>
        <p className="small muted" style={{ margin: 0 }}>
          One per line: <code>account address, amount</code>. Lines starting
          with <code>#</code> are ignored.
        </p>
        <textarea
          value={csv}
          onChange={(event) => {
            setCsv(event.target.value);
            setReceipt(null);
          }}
          placeholder={"# address,amount\nGABC…,12.50\nGDEF…,100"}
          spellCheck={false}
        />

        {parsed.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Recipient</th>
                  <th className="numeric">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((line) => (
                  <tr key={line.line}>
                    <td className="muted">{line.line}</td>
                    <td>
                      {line.to ? (
                        <Address value={line.to} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="numeric">
                      {line.error ? (
                        <span className="muted">{line.amount || "—"}</span>
                      ) : (
                        <Money value={toStroops(line.amount)} />
                      )}
                    </td>
                    <td>
                      {line.error ? (
                        <span style={{ color: "var(--danger)" }}>{line.error}</span>
                      ) : (
                        <span className="muted">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {duplicates.length > 0 ? (
          <div className="notice notice--warn">
            <div className="notice__title">
              {duplicates.length} address
              {duplicates.length === 1 ? " appears" : "es appear"} more than once
            </div>
            <div className="notice__detail">
              That is allowed — the contract does not reject duplicates, and two
              lines for one contractor is a normal thing to want. Check it is
              deliberate before sending.
            </div>
          </div>
        ) : null}

        {cap !== null && payments.length > cap ? (
          <div className="notice notice--info">
            <div className="notice__title">
              This will be sent as {batches.length} transactions
            </div>
            <div className="notice__detail">
              The contract accepts at most {cap} recipients per batch, so the
              payroll is split. Each batch is all-or-nothing on its own — an
              earlier batch stays paid if a later one fails.
            </div>
          </div>
        ) : null}

        <div className="spread">
          <div>
            <div className="label">Total</div>
            <Money value={total} size="lg" />
            <span className="small muted" style={{ marginLeft: "0.5rem" }}>
              {valid.length} recipient{valid.length === 1 ? "" : "s"}
              {invalid.length > 0 ? `, ${invalid.length} line(s) to fix` : ""}
            </span>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => void preview()}
              disabled={!address || valid.length === 0 || invalid.length > 0}
            >
              Check against chain
            </button>
            <button
              type="button"
              className="button--primary"
              onClick={() => setConfirming(true)}
              disabled={!signer || valid.length === 0 || invalid.length > 0}
            >
              Pay {valid.length || ""}
            </button>
          </div>
        </div>

        {previewError ? <ErrorNotice error={previewError} /> : null}
        {receipt ? (
          <SuccessNotice>
            The contract accepts this batch: {receipt.count} recipients,{" "}
            <Money value={receipt.total} /> total. Nothing has been sent.
          </SuccessNotice>
        ) : null}
        {sendError ? <ErrorNotice error={sendError} /> : null}
        {results.map((result) => (
          <SuccessNotice key={result.hash} hash={result.hash}>
            Paid {result.count} recipient{result.count === 1 ? "" : "s"}.
          </SuccessNotice>
        ))}
      </div>

      <p className="small muted">
        Batch payout contract{" "}
        <a
          className="addr"
          href={explorerContract(BATCH_PAYOUT_CONTRACT)}
          target="_blank"
          rel="noreferrer"
        >
          {BATCH_PAYOUT_CONTRACT}
        </a>
        . It is stateless and holds no funds, so this one deployment is shared
        by everybody.
      </p>

      {confirming ? (
        <Confirm
          title={`Pay ${valid.length} recipient${valid.length === 1 ? "" : "s"}`}
          lines={[
            { label: "Total", value: <Money value={total} /> },
            { label: "Recipients", value: valid.length },
            { label: "Transactions", value: batches.length },
            { label: "Paid from", value: address ? <Address value={address} /> : "—" },
          ]}
          irreversible={
            batches.length > 1
              ? `The payments settle on chain and cannot be reversed. This is sent as ${batches.length} separate transactions — each is all-or-nothing on its own, so an earlier batch stays paid even if a later one fails.`
              : "The payments settle on chain and cannot be reversed. If any single transfer fails, the whole batch is rolled back and nobody is paid."
          }
          confirmLabel={`Pay ${valid.length}`}
          busy={busy}
          error={sendError ? <ErrorNotice error={sendError} /> : null}
          onConfirm={() => void send()}
          onCancel={() => {
            setConfirming(false);
            setSendError(null);
          }}
        />
      ) : null}
    </div>
  );
}
