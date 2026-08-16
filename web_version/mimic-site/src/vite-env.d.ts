/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute origin of the backend API (e.g. https://api.talbotiq.com).
   *  Blank in dev — the Vite proxy forwards /api to localhost:8787. */
  readonly VITE_API_BASE?: string
  /** Absolute origin of the web APPLICATION (e.g. https://app.talbotiq.com),
   *  used by the "Sign in" links. REQUIRED for production builds (enforced in
   *  vite.config.ts) — this site has no /login of its own. */
  readonly VITE_APP_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
