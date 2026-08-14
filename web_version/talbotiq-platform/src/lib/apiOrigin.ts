/**
 * Single source of truth for where the backend lives.
 *
 * Web/dev — VITE_API_BASE is blank, so every URL stays same-origin and the Vite
 * proxy in vite.config.ts keeps serving /api (HTTP and WS) exactly as before.
 * Vercel/Capacitor — VITE_API_BASE points at the Render service
 * (e.g. https://talbotiq-api.onrender.com), producing absolute HTTPS/WSS URLs.
 *
 * VITE_API_BASE is a PUBLIC value (it is inlined into the bundle). It is a URL,
 * never a secret.
 */

/** Trim trailing slashes and default a scheme-less host to https, so a value
 *  like "talbotiq-api.onrender.com" still yields a usable absolute URL.
 *  Returns '' for blank input, which callers read as "use same-origin". */
function normalizeBase(apiBase: string | undefined): string {
  const raw = (apiBase ?? '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

/** Pure core of httpBase(). Exported for tests.
 *  `/api/web` because the common backend already uses `/api/templates` for
 *  EMAIL templates (the Flutter app's contract); this app's INTERVIEW templates
 *  live under the web prefix so neither has to rename. */
export function resolveHttpBase(apiBase: string | undefined): string {
  const base = normalizeBase(apiBase)
  return base ? `${base}/api/web` : '/api/web'
}

/**
 * Pure core of wsUrl(). Exported for tests.
 *
 * When a base is configured the ws scheme follows the TARGET's protocol, not
 * the page's: an https API base must yield wss, or the browser blocks the
 * connection as mixed content. Only when the base is blank (same-origin) does
 * the page protocol decide.
 */
export function resolveWsUrl(
  apiBase: string | undefined,
  pageProtocol: string,
  pageHost: string,
  path: string,
): string {
  const base = normalizeBase(apiBase)
  const p = path.startsWith('/') ? path : `/${path}`
  if (!base) {
    const proto = pageProtocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${pageHost}${p}`
  }
  return `${base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')}${p}`
}

/** Read VITE_API_BASE defensively: import.meta.env is undefined when this
 *  module is imported by a plain-Node (tsx) test, which is how tests run here. */
function envApiBase(): string | undefined {
  return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE
}

/** Base for HTTP calls, e.g. httpBase() + '/sessions'. */
export function httpBase(): string {
  return resolveHttpBase(envApiBase())
}

/** The shared mobile/web API. Used for the Gemini Live token routes and the Tavus proxy. */
export function commonBase(): string {
  const base = normalizeBase(envApiBase())
  return base ? `${base}/api` : '/api'
}

/** Absolute WebSocket URL for an /api path, e.g. wsUrl('/api/web/avatar/deepgram'). */
export function wsUrl(path: string): string {
  return resolveWsUrl(envApiBase(), location.protocol, location.host, path)
}
