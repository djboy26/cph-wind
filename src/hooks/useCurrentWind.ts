// src/hooks/useCurrentWind.ts
// React hook wrapping fetchCurrentWind with:
//   - automatic refresh every 10 min
//   - retry with exponential backoff on transient failures (so a single MET hiccup
//     doesn't strand the rider until the next 10-min refresh)
//   - pause when tab is hidden (no point fetching if user isn't looking)
//   - immediate refresh when tab regains focus
//   - cleanup on unmount

import { useEffect, useState } from 'react';
import { fetchCurrentWind, type CurrentWindResult } from '../api/weather';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
// Backoff schedule for transient failures. After these are exhausted the error is
// surfaced and we wait for the next scheduled refresh / tab-focus.
const RETRY_BACKOFFS_MS = [2000, 5000, 12000];

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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function load(attempt = 0) {
      try {
        const result = await fetchCurrentWind(lat, lon, abortController.signal);
        if (!cancelled) {
          setState({ data: result, loading: false, error: null });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        if (attempt < RETRY_BACKOFFS_MS.length) {
          // Keep showing the last good data (if any) and stay quiet while we retry,
          // so a transient blip doesn't flash an error at the rider.
          setState((prev) => (prev.data ? prev : { ...prev, loading: true, error: null }));
          retryTimer = setTimeout(() => load(attempt + 1), RETRY_BACKOFFS_MS[attempt]);
        } else {
          setState((prev) => ({ ...prev, loading: false, error: err as Error }));
        }
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
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [lat, lon]);

  return state;
}