/**
 * The two places this site points anywhere else: the backend API (one public
 * lead-capture route) and the web application (the Sign in links). Both come
 * from PUBLIC build-time env vars — this site holds no secrets of any kind.
 */

function normalizeOrigin(raw: string | undefined): string {
  const v = (raw ?? '').trim().replace(/\/+$/, '')
  if (!v) return ''
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

/** Base for API calls — the backend's web surface, e.g. `${apiBase()}/leads`.
 *  Blank VITE_API_BASE ⇒ same-origin /api/web (the dev proxy serves it). */
export function apiBase(): string {
  const base = normalizeOrigin(import.meta.env.VITE_API_BASE)
  return base ? `${base}/api/web` : '/api/web'
}

/** The web application's sign-in page (an EXTERNAL app now — plain <a> links).
 *  VITE_APP_ORIGIN is REQUIRED for production builds (vite.config.ts enforces
 *  it): this site has no /login of its own, so the blank fallback below exists
 *  only so `vite dev` runs without a .env. */
export function appLoginUrl(): string {
  return `${normalizeOrigin(import.meta.env.VITE_APP_ORIGIN)}/login`
}
