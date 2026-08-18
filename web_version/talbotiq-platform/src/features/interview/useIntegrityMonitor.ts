import { useCallback, useEffect, useState } from 'react'
import { sessionsApi } from '@/lib/api'
import type { IntegrityConfig, IntegrityEvent } from '@shared/types'

/**
 * Client-side integrity monitoring. Detects tab/window switches and fullscreen
 * exits, posts them to the server, and raises a warning the candidate must
 * acknowledge. Paste/copy blocking is enforced at the input; this exposes `post`
 * so those attempts can be logged too.
 *
 * The warning used to be a react-hot-toast in the corner of the screen, which a
 * candidate could miss entirely — and a warning nobody reads is not a warning,
 * it is a log entry with a colour. It is now state, rendered by
 * IntegrityWarningModal as a blocking centred dialog. The logging path is
 * unchanged, so integrity records and the server's warning count keep working
 * exactly as before.
 */
export interface IntegrityWarning {
  message: string
  /** Server-side count; undefined until the event round-trips. */
  count?: number
  max?: number
}

export function useIntegrityMonitor(
  sessionId: string,
  integrity: IntegrityConfig | undefined,
  active: boolean,
) {
  const [warnings, setWarnings] = useState(0)
  const [warning, setWarning] = useState<IntegrityWarning | null>(null)

  const post = useCallback(
    (type: IntegrityEvent['type'], notify?: string) => {
      // The warning is raised from the signal, not from the response. A candidate
      // who switches away on a flaky connection must still be told; the count
      // fills in when (and if) the round-trip completes.
      if (notify) setWarning((current) => current ?? { message: notify })
      if (!integrity?.logEvents) return
      sessionsApi
        .integrityEvent(sessionId, { type })
        .then((r) => {
          if (typeof r.tabSwitchWarnings === 'number') setWarnings(r.tabSwitchWarnings)
          if (notify) {
            setWarning({
              message: notify,
              count: r.tabSwitchWarnings,
              max: r.maxTabSwitchWarnings,
            })
          }
        })
        .catch(() => {})
    },
    [sessionId, integrity?.logEvents],
  )

  const acknowledge = useCallback(() => setWarning(null), [])

  // Tab / window switching
  useEffect(() => {
    if (!active || !integrity?.detectTabSwitch) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        post('tab_switch', 'Please stay on this tab. Switching away is recorded.')
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [active, integrity?.detectTabSwitch, post])

  // Fullscreen enforcement (best-effort; entered via user gesture in enterFullscreen)
  useEffect(() => {
    if (!active || !integrity?.enforceFullscreen) return
    const onFsChange = () => {
      if (!document.fullscreenElement) post('fullscreen_exit', 'Please return to fullscreen for the interview.')
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [active, integrity?.enforceFullscreen, post])

  const enterFullscreen = useCallback(() => {
    if (integrity?.enforceFullscreen) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
  }, [integrity?.enforceFullscreen])

  return { warnings, warning, acknowledge, post, enterFullscreen }
}
