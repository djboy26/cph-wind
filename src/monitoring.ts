// src/monitoring.ts
// Optional error tracking via Sentry. Active only when VITE_SENTRY_DSN is set (in the
// Vercel project env); local dev and unconfigured builds are complete no-ops, so this
// is safe to commit without a key.

import * as Sentry from '@sentry/react';

let enabled = false;

export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Errors only — no performance tracing or replay, to keep it light and avoid
    // collecting extra data.
    tracesSampleRate: 0,
  });
  enabled = true;
}

/** Report a caught error if monitoring is configured; otherwise a no-op. */
export function reportError(error: unknown): void {
  if (enabled) Sentry.captureException(error);
}
