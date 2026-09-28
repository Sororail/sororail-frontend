"use client";

import { EscrowClient, StreamClient, VestingClient } from "@sororail/sdk";
import { useState, type FormEvent } from "react";

import { ErrorNotice, SuccessNotice } from "@/components/Feedback";
import { NETWORK_PASSPHRASE, NATIVE_TOKEN, RPC_URL } from "@/lib/network";
import { addPosition, looksLikeContractId, type PositionKind } from "@/lib/positions";
import { useWallet } from "@/lib/wallet";

const titles: Record<Exclude<PositionKind, "recurring">, string> = {
  stream: "Create a stream",
  vesting: "Create a grant",
  escrow: "Create an escrow",
};

export function CreatePositionForm({
  kind,
}: {
  kind: Exclude<PositionKind, "recurring">;
}) {
  const { address, signer } = useWallet();
  const [contractId, setContractId] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [arbiter, setArbiter] = useState("");
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("");
  const [cliff, setCliff] = useState("0");
  const [rate, setRate] = useState("");
  const [cancellable, setCancellable] = useState(true);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<{ hash: string; saved: boolean } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!address || !signer) {
      setError(new Error("Connect and fund a testnet wallet before creating a position."));
      return;
    }
    if (!looksLikeContractId(contractId)) {
      setError(new Error("Enter the address of a deployed, uninitialized contract."));
      return;
    }

    setBusy(true);
    try {
      const options = {
        contractId: contractId.trim(),
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        publicKey: address,
      };
      let call;
      if (kind === "stream") {
        const seconds = positiveInteger(duration, "Duration");
        call = await new StreamClient(options).create({
          sender: address,
          recipient: requiredAddress(counterparty, "Recipient"),
          token: NATIVE_TOKEN,
          ratePerSecond: positiveInteger(rate, "Rate"),
          start: BigInt(Math.floor(Date.now() / 1000)),
          stop: BigInt(Math.floor(Date.now() / 1000)) + seconds,
          cancellable,
        });
      } else if (kind === "vesting") {
        const seconds = positiveInteger(duration, "Duration");
        const cliffSeconds = nonNegativeInteger(cliff, "Cliff");
        call = await new VestingClient(options).create({
          grantor: address,
          beneficiary: requiredAddress(counterparty, "Beneficiary"),
          token: NATIVE_TOKEN,
          total: positiveInteger(amount, "Amount"),
          start: BigInt(Math.floor(Date.now() / 1000)),
          cliff: cliffSeconds,
          duration: seconds,
          revocable: cancellable,
        });
      } else {
        const now = BigInt(Math.floor(Date.now() / 1000));
        call = await new EscrowClient(options).init({
          depositor: address,
          beneficiary: requiredAddress(counterparty, "Beneficiary"),
          arbiter: arbiter.trim() || null,
          token: NATIVE_TOKEN,
          amount: positiveInteger(amount, "Amount"),
          deadline: now + positiveInteger(duration, "Deadline offset"),
        });
      }

      const sent = await call.signAndSend(signer);
      const saved = addPosition(kind, contractId, label);
      setSuccess({ hash: sent.hash, saved });
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack stack--tight" onSubmit={(event) => void submit(event)}>
      <h3>{titles[kind]}</h3>
      <p className="small muted m-0">
        Use a fresh, uninitialized contract instance. Deploy its WASM first; this form initializes the position and adds it to this browser. Contract deployment is not available here. Amounts and stream rates use stroops.
      </p>
      <Field label="Deployed contract address" value={contractId} onChange={setContractId} required />
      <Field label={kind === "stream" ? "Recipient address" : "Beneficiary address"} value={counterparty} onChange={setCounterparty} required />
      {kind === "escrow" ? <Field label="Arbiter address (optional)" value={arbiter} onChange={setArbiter} /> : null}
      {kind !== "stream" ? <Field label="Amount (stroops)" value={amount} onChange={setAmount} required inputMode="numeric" /> : null}
      {kind === "stream" ? <Field label="Rate per second (stroops)" value={rate} onChange={setRate} required inputMode="numeric" /> : null}
      <Field
        label={kind === "escrow" ? "Seconds until deadline" : "Duration (seconds)"}
        value={duration}
        onChange={setDuration}
        required
        inputMode="numeric"
      />
      {kind === "vesting" ? <Field label="Cliff (seconds)" value={cliff} onChange={setCliff} required inputMode="numeric" /> : null}
      {kind === "stream" || kind === "vesting" ? (
        <label className="row small"><input type="checkbox" checked={cancellable} onChange={(event) => setCancellable(event.target.checked)} />{kind === "stream" ? "Allow cancellation" : "Revocable grant"}</label>
      ) : null}
      <Field label="Name (optional)" value={label} onChange={setLabel} />
      {error ? <ErrorNotice error={error} /> : null}
      {success ? (
        <SuccessNotice hash={success.hash}>
          {success.saved ? "Position initialized and added to this browser." : `Position initialized, but the local list was unchanged. Track this contract address if it is not already listed: ${contractId.trim()}`}
        </SuccessNotice>
      ) : null}
      <button type="submit" className="button--primary" disabled={busy || !address}>
        {busy ? "Submitting…" : titles[kind]}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  inputMode?: "numeric";
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} required={required} inputMode={inputMode} />
    </label>
  );
}

function positiveInteger(value: string, name: string): bigint {
  const parsed = nonNegativeInteger(value, name);
  if (parsed <= 0n) throw new Error(`${name} must be greater than zero.`);
  return parsed;
}

function nonNegativeInteger(value: string, name: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number.`);
  return BigInt(value);
}

function requiredAddress(value: string, name: string): string {
  const trimmed = value.trim();
  if (!/^G[A-Z2-7]{55}$/.test(trimmed)) throw new Error(`${name} must be a valid Stellar account address.`);
  return trimmed;
}
