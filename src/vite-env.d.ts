/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN; set in the Vercel project env to enable error tracking. */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
