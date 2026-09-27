import { ErrorNotice } from "./Feedback";
import { PositionHeader } from "./PositionRegistry";
import type { Position } from "@/lib/positions";

interface PositionCardStateProps {
  position: Position;
  address: string | null;
  loadError: unknown;
  isLoading: boolean;
  noun: string;
  children: React.ReactNode;
}

export function PositionCardState({
  position,
  address,
  loadError,
  isLoading,
  noun,
  children,
}: PositionCardStateProps) {
  if (!address) {
    return (
      <div className="card">
        <PositionHeader position={position} />
        <p className="small muted">Connect a wallet to read this {noun}.</p>
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

  if (isLoading) {
    return (
      <div className="card">
        <PositionHeader position={position} />
        <p className="small muted">Reading from the chain…</p>
      </div>
    );
  }

  return children;
}
