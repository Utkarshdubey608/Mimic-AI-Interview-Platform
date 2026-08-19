/**
 * Two-way connectivity probe.
 *
 * A live call fails in ways device access never predicts: UDP blocked by a
 * corporate network, no NAT traversal, an unreachable API. Gathering a
 * server-reflexive ICE candidate proves the path a real call needs, and it needs
 * no LiveKit credential — which matters, because those are not currently set on
 * the deployed backend.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { httpBase } from '@/lib/apiOrigin'
import type { CheckState } from './guidance'

export interface ConnectivityCheck {
  state: CheckState
  retest: () => void
}

const ICE_TIMEOUT_MS = 5_000
const STUN = 'stun:stun.l.google.com:19302'

export function useConnectivityCheck(enabled: boolean): ConnectivityCheck {
  const [state, setState] = useState<CheckState>('not-asked')
  const pcRef = useRef<RTCPeerConnection | null>(null)

  const run = useCallback(async () => {
    pcRef.current?.close()
    pcRef.current = null
    setState('requesting')

    if (typeof RTCPeerConnection === 'undefined') { setState('unsupported'); return }

    // `/health` sits outside the /api/web prefix and needs no credential.
    const reachable = fetch(`${httpBase().replace(/\/api\/web$/, '')}/health`, { method: 'GET' })
      .then((r) => r.ok)
      .catch(() => false)

    const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }] })
    pcRef.current = pc
    const gotReflexive = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), ICE_TIMEOUT_MS)
      pc.onicecandidate = (e) => {
        if (e.candidate && e.candidate.candidate.includes('typ srflx')) {
          window.clearTimeout(timer)
          resolve(true)
        }
      }
    })
    // A data channel is required or no candidates are gathered at all.
    pc.createDataChannel('probe')
    await pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {})

    const [srflx, ok] = await Promise.all([gotReflexive, reachable])
    pc.close()
    pcRef.current = null
    setState(srflx && ok ? 'passed' : 'granted-no-signal')
  }, [])

  useEffect(() => {
    if (enabled) void run()
    return () => { pcRef.current?.close(); pcRef.current = null }
  }, [enabled, run])

  return { state, retest: () => void run() }
}
