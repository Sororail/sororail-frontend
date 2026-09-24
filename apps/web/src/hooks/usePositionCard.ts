import { useCallback, useEffect, useMemo, useState } from "react";
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
  onRefresh?: (client: ClientType) => Promise<void>,
) {
  const [data, setData] = useState<Awaited<ReturnType<ClientType["get"]>> | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const client = useMemo(
    () =>
      new ClientConstructor({
        contractId: position.contractId,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
        ...(address ? { publicKey: address } : {}),
      }),
    [position.contractId, address],
  );

  const refresh = useCallback(async () => {
    if (!address) return;
    if (position.network && position.network !== RPC_URL) return;
    try {
      setData((await client.get()) as Awaited<ReturnType<ClientType["get"]>>);
      setLoadError(null);
      if (onRefresh) await onRefresh(client);
    } catch (error) {
      setLoadError(error);
    }
  }, [client, address, position.network, onRefresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loadError, client, refresh };
}
