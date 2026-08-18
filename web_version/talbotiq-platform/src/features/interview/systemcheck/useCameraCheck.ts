/**
 * Camera verification: pass only when live frames are genuinely arriving.
 *
 * Liveness is measured as CHANGE BETWEEN FRAMES, never brightness. A candidate
 * in a dim room is fine and must pass; a bright frozen frame is broken and must
 * fail. A real sensor always produces noise, so successive frames never match
 * exactly — a frozen, disconnected or synthetic-black feed produces identical
 * bytes. See signal.ts for the thresholds.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { CheckState } from './guidance'
import { CAMERA, cameraVerdict, lumaDelta } from './signal'

export interface CameraCheck {
  state: CheckState
  videoRef: RefObject<HTMLVideoElement>
  devices: MediaDeviceInfo[]
  deviceId: string | null
  retest: () => void
  selectDevice: (id: string) => void
  stop: () => void
}

export function useCameraCheck(enabled: boolean): CameraCheck {
  const [state, setState] = useState<CheckState>('not-asked')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const start = useCallback(async () => {
    stop()
    setState('requesting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
    } catch {
      setState('denied')
      return
    }
    streamRef.current = stream

    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === 'videoinput'))
      if (!deviceId) setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? null)
    } catch { /* picker optional */ }

    const video = videoRef.current
    if (!video) { setState('granted-no-signal'); return }
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play().catch(() => {})

    const canvas = document.createElement('canvas')
    canvas.width = CAMERA.canvasSize
    canvas.height = CAMERA.canvasSize
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) { setState('granted-no-signal'); return }

    const startedAt = performance.now()
    const deltas: number[] = []
    let previous: Uint8ClampedArray | null = null
    setState('listening')

    timerRef.current = setInterval(() => {
      const el = videoRef.current
      const ready = !!el && el.videoWidth > 0 && el.readyState >= 2 // HAVE_CURRENT_DATA
      if (ready && el) {
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        if (previous) deltas.push(lumaDelta(previous, frame))
        previous = new Uint8ClampedArray(frame)
      }

      const verdict = cameraVerdict(deltas, startedAt, performance.now())
      if (verdict === 'passed') {
        setState('passed')
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
      } else if (verdict === 'frozen') {
        setState('granted-no-signal')
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
      }
    }, CAMERA.sampleEveryMs)
  }, [deviceId, stop])

  const retest = useCallback(() => { void start() }, [start])
  const selectDevice = useCallback((id: string) => setDeviceId(id), [])

  useEffect(() => {
    if (enabled) void start()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, deviceId])

  return { state, videoRef, devices, deviceId, retest, selectDevice, stop }
}
