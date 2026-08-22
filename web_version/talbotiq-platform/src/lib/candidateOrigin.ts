/**
 * The origin a candidate-facing link (invite email, "copy link", etc.)
 * should be built from.
 *
 * A normal browser tab is already served from the real public origin, so
 * `window.location.origin` is correct there — this preserves that exactly.
 * The Electron desktop shell serves the same built app from a custom
 * `app://` scheme (see desktop_app/main.js) so it can run offline; that
 * scheme is meaningless to an external candidate. Electron's preload script
 * injects the real public web origin onto this one explicit, non-secret
 * global — see desktop_app/preload.js — and this helper prefers it when
 * present. In a browser the global is simply absent, so behavior there is
 * unchanged.
 */
declare global {
  interface Window {
    __TALBOTIQ_DESKTOP__?: { publicWebOrigin?: string }
  }
}

export function getCandidateLinkOrigin(): string {
  const injected = window.__TALBOTIQ_DESKTOP__?.publicWebOrigin?.trim().replace(/\/+$/, '')
  return injected || window.location.origin
}
