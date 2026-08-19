import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useFaceLandmarker } from '@/features/avatar-screening/facefit/useFaceLandmarker'
import type { FramingResult } from '@/features/avatar-screening/facefit/framing'
import type { CheckState } from './guidance'
import { FACE, faceVerdict } from './signal'

export interface FaceCheck {
  state: CheckState
  /** 'absent' | 'crowded' when it failed, so the copy can differ. */
  reason: 'absent' | 'crowded' | null
  retest: () => void
}

/**
 * Presence verification: is a person actually sitting there right now.
 *
 * Reuses the avatar interview's MediaPipe face landmarker, which already runs
 * **entirely on the candidate's device** from `public/mediapipe`. That is the
 * whole privacy story and it is deliberate:
 *
 *  * No face data of any kind leaves the browser. No frames, no landmarks, no
 *    embeddings, no template.
 *  * Nothing is persisted. The only thing this produces is a boolean the gate
 *    reads, and it dies with the page.
 *  * It cannot recognise anyone. It counts faces. "Is someone there" is a
 *    different question from "is this the right person", and only the first is
 *    answered here — the second is biometric identification, with consent,
 *    retention and DPIA obligations attached, and it is not built.
 *
 * **Failure never blocks.** If the model will not load, the runtime is
 * unsupported, or the device is too slow, the check passes rather than trapping
 * a candidate behind a computer-vision model they did not ask for. A screening
 * interview that refuses to start is a worse outcome than one that starts
 * without confirming a face, and the recruiter still has the recording.
 */
export function useFaceCheck(enabled: boolean, videoRef: RefObject<HTMLVideoElement>): FaceCheck {
  const [state, setState] = useState<CheckState>('not-asked')
  const [reason, setReason] = useState<'absent' | 'crowded' | null>(null)
  const countsRef = useRef<number[]>([])
  const startedAtRef = useRef<number>(0)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    countsRef.current = []
    startedAtRef.current = performance.now()
    setReason(null)
    setState('listening')
  }, [enabled, attempt])

  const onResult = useCallback((result: FramingResult) => {
    if (!enabled) return
    countsRef.current.push(result.faceCount)
    // Bounded: only the tail matters, and this runs for the life of the screen.
    if (countsRef.current.length > 200) countsRef.current = countsRef.current.slice(-100)

    const verdict = faceVerdict(countsRef.current, startedAtRef.current, performance.now())
    if (verdict === 'passed') { setState('passed'); setReason(null) }
    else if (verdict === 'absent') { setState('granted-no-signal'); setReason('absent') }
    else if (verdict === 'crowded') { setState('granted-no-signal'); setReason('crowded') }
  }, [enabled])

  const { status } = useFaceLandmarker({ videoRef, enabled, onResult })

  // The model could not run. Do not hold the interview hostage to it.
  useEffect(() => {
    if (enabled && (status === 'error' || status === 'unsupported')) {
      setState('passed')
      setReason(null)
    }
  }, [enabled, status])

  const retest = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, reason, retest }
}

export { FACE }
