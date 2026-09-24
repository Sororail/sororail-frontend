"use client";

import {
  BatchPayoutClient,
  SigningError,
  type Payment,
  type Receipt,
} from "@sororail/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Confirm } from "@/components/Confirm";
import { ContractLink } from "@/components/ContractLink";
import { ErrorNotice, SuccessNotice } from "@/components/Feedback";
import { Address, Money } from "@/components/Money";
import {
  BATCH_PAYOUT_CONTRACT,
  NATIVE_TOKEN,
  NETWORK_PASSPHRASE,
  RPC_URL,
} from "@/lib/network";
import { parseCsv, removeCsvLines, type ParsedLine } from "@/lib/payroll";
import { fetchTokenDecimals } from "@/lib/token";
import { useWallet } from "@/lib/wallet";

const MAX_VISIBLE_VALID_ROWS = 200;

export default function PayrollPage() {
  const { address, signer, connect } = useWallet();
  const [csv, setCsv] = useState("");
  const [cap, setCap] = useState<number | null>(null);
  const [capError, setCapError] = useState<unknown>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  const [results, setResults] = useState<{ hash: string; count: number }[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  // The token's decimals, read from the token contract. Amounts are scaled by
  // this, so nothing can be sent until it is known (#138).
  const [decimals, setDecimals] = useState<number | null>(null);
  const [decimalsError, setDecimalsError] = useState<unknown>(null);

  const loadCsvFile = useCallback((file: File) => {
    setFileError(null);
    if (!/\.csv$/i.test(file.name) && file.type && file.type !== "text/csv") {
      setFileError("Only .csv files are supported.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(typeof reader.result === "string" ? reader.result : "");
      setReceipt(null);
      setResults([]);
    };
    reader.onerror = () => setFileError("Could not read that file.");
    reader.readAsText(file);
  }, []);

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
    setCapError(null);
    void client
      .maxRecipients()
      .then((value) => {
        setCap(value);
        setCapError(null);
      })
      .catch((error) => {
        setCap(null);
        setCapError(error);
      });
  }, [client, address]);

  // Read the token's decimals rather than assuming 7 (the decimals trap).
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setDecimals(null);
    setDecimalsError(null);
    void fetchTokenDecimals(NATIVE_TOKEN, address)
      .then((value) => {
        if (!cancelled) setDecimals(value);
      })
      .catch((error) => {
        if (!cancelled) setDecimalsError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);


  // Everything below derives from `parsed`, and a payroll can run to thousands
  // of lines, so each value is memoised: a keystroke in the textarea that
  // changes `csv` recomputes them once, and unrelated state changes (busy,
  // receipt, the confirm dialog) recompute nothing. `valid` in particular must
  // keep a stable identity, or `payments`, `duplicates` and `batches` would
  // all be rebuilt on every render regardless of their own memoisation.
  const parsed = useMemo(
    () => parseCsv(csv, decimals ?? undefined),
    [csv, decimals],
  );
  const invalid = useMemo(() => parsed.filter((line) => line.error), [parsed]);
  const valid = useMemo(() => parsed.filter((line) => !line.error), [parsed]);

  // Errors always render in full -- an operator needs to see every bad row to
  // fix their CSV. Valid rows are capped, since there is nothing left to do
  // with them but confirm the total, and thousands of DOM rows for a large
  // payroll would make every keystroke slow.
  const hiddenValidCount = Math.max(0, valid.length - MAX_VISIBLE_VALID_ROWS);
  const visible = useMemo(() => {
    const visibleValidLines = new Set(
      valid.slice(0, MAX_VISIBLE_VALID_ROWS).map((line) => line.line),
    );
    return parsed.filter(
      (line) => line.error || visibleValidLines.has(line.line),
    );
  }, [parsed, valid]);

  const payments = useMemo<Payment[]>(
    () => valid.map((line) => ({ to: line.to, amount: line.stroops! })),
    [valid],
  );

  const total = useMemo(
    () => payments.reduce((sum, payment) => sum + payment.amount, 0n),
    [payments],
  );

  // Duplicates are legitimate on chain -- two invoices for one contractor --
  // so this warns rather than blocks. Catching them here is exactly where the
  // contract expects the check to live. Check against all parsed lines (valid
  // and invalid), not just valid ones, to catch cases where the same address
  // appears in both a valid line and a line with a parsing error.
  const duplicates = useMemo(() => {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const line of parsed) {
      if (line.to && seen.has(line.to)) repeated.add(line.to);
      if (line.to) seen.add(line.to);
    }
    return [...repeated];
  }, [parsed]);

  const decimalsKnown = decimals !== null;

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
    if (!signer || !address) {
      setSendError(
        new SigningError("Wallet disconnected. Reconnect to continue."),
      );
      return;
    }
    setBusy(true);
    setSendError(null);
    const sourceCsv = csv;
    let paidCount = 0;
    try {
      for (const chunk of batches) {
        const call = await client.execute({
          funder: address,
          token: NATIVE_TOKEN,
          recipients: chunk,
        });
        const result = await call.signAndSend(signer);
        paidCount += chunk.length;
        setResults((current) => [
          ...current,
          { hash: result.hash, count: result.result.count },
        ]);
        setCsv(
          removeCsvLines(
            sourceCsv,
            valid.slice(0, paidCount).map((line) => line.line),
          ),
        );
        setReceipt(null);
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

  return (
    <div className="stack">
      <div>
        <h1>Payroll</h1>
        <p className="muted page-intro">
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
        <h2 id="recipients-heading">Recipients</h2>
        <p className="small muted m-0">
          One per line: <code>account address, amount</code>. Lines starting
          with <code>#</code> are ignored. Paste below, or drop/upload a CSV
          file.
        </p>

        <div
          className={`dropzone${dragActive ? " dropzone--active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            const file = event.dataTransfer.files?.[0];
            if (file) loadCsvFile(file);
          }}
        >
          <p className="small muted m-0">Drag a .csv file here, or</p>
          <label className="button" htmlFor="payroll-csv-file">
            Choose file
          </label>
          <input
            id="payroll-csv-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) loadCsvFile(file);
              event.target.value = "";
            }}
          />
        </div>
        {fileError ? <p className="small text-danger m-0">{fileError}</p> : null}

        <label htmlFor="payroll-csv-textarea" className="sr-only">
          Payroll CSV data
        </label>
        <textarea
          id="payroll-csv-textarea"
          value={csv}
          onChange={(event) => {
            setCsv(event.target.value);
            setReceipt(null);
            // A new batch starts here; earlier "Paid N recipients" notices no
            // longer describe what is on screen (#137).
            setResults([]);
          }}
          placeholder={"# address,amount\nGABC…,12.50\nGDEF…,100"}
          spellCheck={false}
        />

        {parsed.length > 0 ? (
          <div className="table-scroll">
            <table aria-describedby="recipients-heading">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Recipient</th>
                  <th className="numeric">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((line) => (
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
                        <Money value={line.stroops!} decimals={decimals ?? undefined} />
                      )}
                    </td>
                    <td>
                      {line.error ? (
                        <span className="text-danger">{line.error}</span>
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

        {hiddenValidCount > 0 ? (
          <div className="notice notice--info">
            <div className="notice__title">
              {hiddenValidCount} more valid row{hiddenValidCount === 1 ? "" : "s"} not shown
            </div>
            <div className="notice__detail">
              Only the first {MAX_VISIBLE_VALID_ROWS} valid rows are rendered.
              They are still included in the total and in what gets paid — any
              row with an error is always shown, no matter how many there are.
            </div>
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

        {decimalsError ? (
          <div className="notice notice--warn">
            <div className="notice__title">
              Could not read the token&apos;s decimals
            </div>
            <div className="notice__detail">
              Amounts are scaled by the token&apos;s decimals, so payouts stay
              disabled until they can be read. Check the network and the
              configured token, then reconnect.
            </div>
          </div>
        ) : null}

        {capError ? (
          <div className="notice notice--warn">
            <div className="notice__title">
              Could not verify the maximum recipients per batch
            </div>
            <div className="notice__detail">
              The batch cap could not be determined (network issue, contract not
              found, or RPC error). The payroll will be sent as one transaction.
              If it fails, you may need to split it manually.
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
            <Money value={total} size="lg" decimals={decimals ?? undefined} />
            <span className="small muted ml-md">
              {valid.length} recipient{valid.length === 1 ? "" : "s"}
              {invalid.length > 0 ? `, ${invalid.length} line(s) to fix` : ""}
            </span>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => void preview()}
              disabled={!address || !decimalsKnown || valid.length === 0 || invalid.length > 0}
            >
              Check against chain
            </button>
            <button
              type="button"
              className="button--primary"
              onClick={() => setConfirming(true)}
              disabled={!signer || !decimalsKnown || valid.length === 0 || invalid.length > 0}
            >
              Pay {valid.length || ""}
            </button>
          </div>
        </div>

        {previewError ? <ErrorNotice error={previewError} /> : null}
        {receipt ? (
          <SuccessNotice>
            The contract accepts this batch: {receipt.count} recipients,{" "}
            <Money value={receipt.total} decimals={decimals ?? undefined} /> total. Nothing has been sent.
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
        <ContractLink className="addr" id={BATCH_PAYOUT_CONTRACT}>
          {BATCH_PAYOUT_CONTRACT}
        </ContractLink>
        . It is stateless and holds no funds, so this one deployment is shared
        by everybody.
      </p>

      {confirming ? (
        <Confirm
          title={`Pay ${valid.length} recipient${valid.length === 1 ? "" : "s"}`}
          lines={[
            { label: "Total", value: <Money value={total} decimals={decimals ?? undefined} /> },
            { label: "Recipients", value: valid.length },
            { label: "Transactions", value: batches.length },
            { label: "Paid from", value: address ? <Address value={address} /> : "—" },
          ]}
          irreversible={
            batches.length > 1
              ? `The payments settle on chain and cannot be reversed. This is sent as ${batches.length} separate transactions — each is all-or-nothing on its own, so an earlier batch stays paid even if a later one fails. Ensure your account balance covers the total amount.`
              : "The payments settle on chain and cannot be reversed. If any single transfer fails, the whole batch is rolled back and nobody is paid. Ensure your account balance covers the total amount."
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
