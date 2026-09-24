import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Position } from "@/lib/positions";
import { NETWORK_PASSPHRASE, RPC_URL } from "@/lib/network";

interface ClientOptions {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  publicKey?: string;
}

interface PositionClient {
  get(): Promise<unknown>;
}

export function usePositionCard<ClientType extends PositionClient>(
  ClientConstructor: new (opts: ClientOptions) => ClientType,
  position: Position,
  address: string | null,
  onRefresh?: (client: ClientType, isCurrent: () => boolean) => Promise<void>,
) {
  type DataType = Awaited<ReturnType<ClientType["get"]>>;
  const [data, setData] = useState<DataType | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const activeRequestIdRef = useRef(0);

  const client = useMemo(
    () =>
      new ClientConstructor({
        contractId: position.contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        ...(address ? { publicKey: address } : {}),
      }),
    [ClientConstructor, position.contractId, address],
  );

  const refresh = useCallback(async () => {
    if (!address) {
      setData(null);
      setLoadError(null);
      return;
    }
    const requestId = ++activeRequestIdRef.current;
    const isCurrent = () => requestId === activeRequestIdRef.current;
    try {
      const result = (await client.get()) as DataType;
      if (!isCurrent()) return;
      setData(result);
      setLoadError(null);
      if (onRefresh) {
        await onRefresh(client, isCurrent);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setLoadError(error);
    }
  }, [client, address, onRefresh]);

  useEffect(() => {
    void refresh();
    return () => {
      activeRequestIdRef.current += 1;
    };
  }, [refresh]);

  return { data, loadError, client, refresh };
}
