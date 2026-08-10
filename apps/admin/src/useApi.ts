import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiGet, type Params } from './api';

export type Async<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/**
 * Minimal fetch-on-params hook. Params are serialised into the dependency key
 * so a caller can pass a fresh object literal each render without looping.
 */
export function useApi<T>(path: string, params: Params = {}): Async<T> {
  const key = JSON.stringify(params);
  const stable = useMemo(() => JSON.parse(key) as Params, [key]);

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    apiGet<T>(path, stable, ac.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(e instanceof ApiError ? e.code : 'network_error');
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [path, stable, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
