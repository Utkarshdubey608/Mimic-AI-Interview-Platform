import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionsApi } from '@/lib/api'
import { decideIntegrity, type IntegrityDecision, type IntegrityKind } from './integrityPolicy'
import type { IntegrityConfig, IntegrityEvent } from '@shared/types'

/**
 * Client-side integrity monitoring.
 *
 * ── What changed, and why ────────────────────────────────────────────────
 * This used to fire a react-hot-toast in the corner of the screen reading
 * "Please stay on this tab (1/3)", and then do nothing at all when the count
 * reached the limit. Two problems, both serious:
 *
 *   1. A corner toast during a timed answer is genuinely easy to miss. A
 *      candidate could be two strikes down without ever having registered one.
 *   2. The limit was never enforced. The server counted faithfully; the client
 *      ignored the total. A rule that is announced and never applied is worse
 *      than no rule, because the honest candidate obeys it and nobody else has
 *      any reason to.
 *
 * Now: every departure raises a BLOCKING notice that must be acknowledged, and
 * the final one ends the interview. The decision itself lives in
 * integrityPolicy.ts so it can be tested exhaustively, and this hook only does
 * the parts that need a browser: listening, posting, and holding the state.
 *
 * The counter is the SERVER's. A client-side tally would reset on refresh, and
 * refreshing is the first thing anyone gaming the limit would try.
 */

export interface PendingIntegrityNotice {
  kind: IntegrityKind
  decision: IntegrityDecision
}

export function useIntegrityMonitor(
  sessionId: string,
  integrity: IntegrityConfig | undefined,
  active: boolean,
) {
  const [warnings, setWarnings] = useState(0)
  const [notice, setNotice] = useState<PendingIntegrityNotice | null>(null)

  // `active` is false during pre-flight and after completion. Held in a ref so
  // the visibility listener reads the CURRENT value: a listener that closed over
  // a stale `true` would keep counting tab switches on the completion screen,
  // and a candidate who finished and opened their email would be "warned" for it.
  const activeRef = useRef(active)
  activeRef.current = active

  // One tab switch must count once. `visibilitychange` can fire more than once
  // per real switch (hidden, then again on some window-manager transitions), and
  // a candidate must never lose two of three strikes for a single Alt-Tab.
  const inFlightRef = useRef(false)

  const post = useCallback(
    (type: IntegrityEvent['type'], kind?: IntegrityKind) => {
      if (!integrity?.logEvents) return
      sessionsApi
        .integrityEvent(sessionId, { type })
        .then((r) => {
          if (typeof r.tabSwitchWarnings === 'number') setWarnings(r.tabSwitchWarnings)
          if (!kind) return
          const decision = decideIntegrity(r.tabSwitchWarnings, r.maxTabSwitchWarnings)
          if (decision.action === 'ignore') return
          // Never replace a termination with a later warning: once the interview
          // is over, that is the message that stands.
          setNotice((prev) => (prev?.decision.action === 'terminate' ? prev : { kind, decision }))
        })
        .catch(() => { /* integrity logging must never interrupt an interview */ })
        .finally(() => { inFlightRef.current = false })
    },
    [sessionId, integrity?.logEvents],
  )

  /* ── Tab and window switching ─────────────────────────────────────────── */
  useEffect(() => {
    if (!active || !integrity?.detectTabSwitch) return
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return
      if (!activeRef.current || inFlightRef.current) return
      inFlightRef.current = true
      post('tab_switch', 'tab_switch')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [active, integrity?.detectTabSwitch, post])

  /* ── Fullscreen enforcement ───────────────────────────────────────────── */
  useEffect(() => {
    if (!active || !integrity?.enforceFullscreen) return
    const onFsChange = () => {
      if (document.fullscreenElement) return
      if (!activeRef.current || inFlightRef.current) return
      inFlightRef.current = true
      post('fullscreen_exit', 'fullscreen_exit')
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [active, integrity?.enforceFullscreen, post])

  const enterFullscreen = useCallback(() => {
    if (integrity?.enforceFullscreen) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
  }, [integrity?.enforceFullscreen])

  /** Dismiss a warning. A termination is not dismissible; the caller ends the interview. */
  const acknowledge = useCallback(() => {
    setNotice((prev) => (prev?.decision.action === 'terminate' ? prev : null))
  }, [])

  return { warnings, notice, post, acknowledge, enterFullscreen }
}
