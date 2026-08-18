/**
 * Composes the individual checks against the mode's requirements and derives the
 * one value that matters: whether the candidate may start.
 *
 * `canStart` is computed from the requirement table, never hand-maintained per
 * mode — that is what stops an ungated path from shipping for one track.
 */
import { useEffect, useMemo } from 'react'
import type { TrackType } from '@shared/types'
import { detect, missingFor, readEnvironment, type Capabilities } from './capabilities'
import { guidanceFor, type CheckState, type Guidance } from './guidance'
import { requirementsFor, type CheckId } from './requirements'
import { useCameraCheck, type CameraCheck } from './useCameraCheck'
import { useConnectivityCheck, type ConnectivityCheck } from './useConnectivityCheck'
import { useMicCheck, type MicCheck } from './useMicCheck'
import { useSpeakerCheck, type SpeakerCheck } from './useSpeakerCheck'

export interface CheckView {
  id: CheckId
  state: CheckState
  guidance: Guidance
}

export interface SystemCheck {
  checks: CheckView[]
  canStart: boolean
  outstanding: CheckId[]
  caps: Capabilities
  mic: MicCheck
  camera: CameraCheck
  speaker: SpeakerCheck
  connectivity: ConnectivityCheck
}

export function useSystemCheck(track: TrackType): SystemCheck {
  const caps = useMemo(() => detect(readEnvironment()), [])
  const required = useMemo(() => requirementsFor(track), [track])
  const blocked = useMemo(() => missingFor(caps, required), [caps, required])

  // Hooks must run unconditionally; `enabled` decides whether they open hardware.
  const wants = (id: CheckId) => required.includes(id) && !blocked.includes(id)
  const mic = useMicCheck(wants('mic'))
  const camera = useCameraCheck(wants('camera'))
  const speaker = useSpeakerCheck()
  const connectivity = useConnectivityCheck(wants('connectivity'))

  // A webview only matters when the mode needs hardware. Blocking a typed
  // interview because the candidate opened the link in Gmail would reject
  // someone whose setup is genuinely fine — a false block is worse here than
  // the failure it would prevent.
  const needsMedia = required.includes('mic') || required.includes('camera')

  const stateOf = (id: CheckId): CheckState => {
    if (blocked.includes(id)) return 'unsupported'
    switch (id) {
      case 'browser':
        if (!caps.secureContext) return 'unsupported'
        return caps.isWebview && needsMedia ? 'unsupported' : 'passed'
      case 'mic': return mic.state
      case 'camera': return camera.state
      case 'speaker': return speaker.state
      case 'connectivity': return connectivity.state
    }
  }

  const checks: CheckView[] = required.map((id) => {
    const state = stateOf(id)
    return { id, state, guidance: guidanceFor(id, state, caps.family, caps.isWebview) }
  })

  const outstanding = checks.filter((c) => c.state !== 'passed').map((c) => c.id)

  // Mid-check recovery: a candidate who un-blocks a permission in browser
  // settings should see the check clear without reloading the page.
  useEffect(() => {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions
    if (!perms?.query) return
    const handles: PermissionStatus[] = []
    const watch = (name: string, retest: () => void) =>
      perms
        .query({ name: name as PermissionName })
        .then((status) => {
          status.onchange = () => { if (status.state === 'granted') retest() }
          handles.push(status)
        })
        .catch(() => { /* Firefox rejects unknown names; the Re-test button covers it */ })

    void Promise.all([watch('microphone', mic.retest), watch('camera', camera.retest)])
    return () => { handles.forEach((h) => { h.onchange = null }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    checks,
    canStart: outstanding.length === 0,
    outstanding,
    caps,
    mic,
    camera,
    speaker,
    connectivity,
  }
}
