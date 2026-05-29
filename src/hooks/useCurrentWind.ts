// src/hooks/useCurrentWind.ts
// React hook wrapping fetchCurrentWind with:
//   - automatic refresh every 10 min
//   - pause when tab is hidden (no point fetching if user isn't looking)
//   - immediate refresh when tab regains focus
//   - cleanup on unmount

import { useEffect, useState } from 'react';
import { fetchCurrentWind, type CurrentWindResult } from '../api/weather';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export interface UseCurrentWindState {
  data: CurrentWindResult | null;
  loading: boolean;
  error: Error | null;
}

export function useCurrentWind(lat: number, lon: number): UseCurrentWindState {
  const [state, setState] = useState<UseCurrentWindState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    async function load() {
      try {
        const result = await fetchCurrentWind(lat, lon, abortController.signal);
        if (!cancelled) {
          setState({ data: result, loading: false, error: null });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setState((prev) => ({ ...prev, loading: false, error: err as Error }));
      }
    }

    load();

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      abortController.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [lat, lon]);

  return state;
}