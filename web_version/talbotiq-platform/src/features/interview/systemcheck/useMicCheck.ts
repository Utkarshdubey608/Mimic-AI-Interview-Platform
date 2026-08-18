/**
 * Microphone verification: open a stream, measure it, and only pass when real
 * audio energy arrives. A resolved getUserMedia is NOT a working microphone —
 * muted hardware and wrong default inputs both resolve happily.
 *
 * All decision-making is delegated to signal.ts. This hook owns the stream, the
 * AnalyserNode and the animation frame, and nothing else.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CheckState } from './guidance'
import { MIC, micVerdict, rmsOf, toDbfs } from './signal'

export interface MicCheck {
  state: CheckState
  /** 0..1, for the meter. */
  level: number
  devices: MediaDeviceInfo[]
  deviceId: string | null
  retest: () => void
  selectDevice: (id: string) => void
  stop: () => void
}

export function useMicCheck(enabled: boolean): MicCheck {
  const [state, setState] = useState<CheckState>('not-asked')
  const [level, setLevel] = useState(0)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const qualifyingRef = useRef<number[]>([])

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    setLevel(0)
  }, [])

  const start = useCallback(async () => {
    stop()
    qualifyingRef.current = []
    setState('requesting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
    } catch {
      // Every failure mode here — dismissed prompt, policy block, no device — is
      // actionable the same way, and the candidate cannot tell them apart.
      setState('denied')
      return
    }
    streamRef.current = stream

    // Labels are empty until a grant exists, so enumerate only now.
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === 'audioinput'))
      if (!deviceId) setDeviceId(stream.getAudioTracks()[0]?.getSettings().deviceId ?? null)
    } catch { /* a picker is a nicety; its absence must not fail the check */ }

    const Ctor: typeof AudioContext =
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? AudioContext
    const ctx = new Ctor()
    ctxRef.current = ctx
    // Safari and Chrome both start suspended without a gesture; the candidate
    // pressed a button to reach this screen, so this resolves.
    await ctx.resume().catch(() => {})

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buffer = new Float32Array(analyser.fftSize)
    const startedAt = performance.now()
    setState('listening')

    const tick = () => {
      analyser.getFloatTimeDomainData(buffer)
      const rms = rmsOf(buffer)
      setLevel(Math.min(1, rms * 8)) // headroom so normal speech fills the meter
      const now = performance.now()
      if (toDbfs(rms) > MIC.floorDbfs) qualifyingRef.current.push(now)

      const verdict = micVerdict(qualifyingRef.current, startedAt, now)
      if (verdict === 'passed') { setState('passed'); return }
      // Keep polling even after 'no-signal': the candidate may unmute and speak,
      // and the check must clear itself when they do rather than stay accusing.
      setState(verdict === 'no-signal' ? 'granted-no-signal' : 'listening')
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [deviceId, stop])

  const retest = useCallback(() => { void start() }, [start])

  const selectDevice = useCallback((id: string) => {
    setDeviceId(id)
    qualifyingRef.current = []
  }, [])

  // Re-open whenever the chosen device changes, and tear down on unmount so no
  // microphone stays live behind the interview.
  useEffect(() => {
    if (enabled) void start()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, deviceId])

  return { state, level, devices, deviceId, retest, selectDevice, stop }
}
