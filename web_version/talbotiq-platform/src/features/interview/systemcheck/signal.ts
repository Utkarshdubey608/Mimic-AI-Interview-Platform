/**
 * The rules that decide whether we actually heard and saw the candidate.
 *
 * Pure on purpose. These thresholds are the whole feature — a permission grant
 * proves nothing, and getting these numbers wrong either lets a broken device
 * through or blocks a working one. Both failures are expensive on a hiring
 * surface, so they are pinned by tests rather than tuned inside a component.
 */

export const MIC = {
  /** Below this is room tone, not a voice. */
  floorDbfs: -50,
  /** Several frames, so a chair creak or a single click cannot pass the check. */
  framesToPass: 5,
  /** Qualifying frames only count if they are recent. */
  windowMs: 10_000,
  /** Total silence for this long is a real failure, not impatience. */
  silenceFailMs: 8_000,
} as const

export const CAMERA = {
  /**
   * Just above zero, deliberately. The question is "did these two frames differ
   * at all", not "is the picture bright". A real sensor always produces noise;
   * a frozen, disconnected or synthetic-black feed produces identical bytes.
   * A brightness threshold would fail a candidate sitting in a dim room.
   */
  deltaFloor: 0.6,
  samplePairs: 3,
  timeoutMs: 8_000,
  sampleEveryMs: 250,
  canvasSize: 32,
} as const

export function rmsOf(buffer: Float32Array): number {
  if (buffer.length === 0) return 0
  let sum = 0
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
  return Math.sqrt(sum / buffer.length)
}

export function toDbfs(rms: number): number {
  return rms <= 0 ? -Infinity : 20 * Math.log10(rms)
}

export type MicVerdict = 'listening' | 'passed' | 'no-signal'

/**
 * `qualifyingAt` holds the timestamps of frames whose level cleared the floor.
 * Note the failure rule: a candidate who has produced ANY signal is never failed
 * on the timeout — they are mid-sentence, not broken.
 */
export function micVerdict(qualifyingAt: number[], startedAt: number, now: number): MicVerdict {
  const recent = qualifyingAt.filter((t) => now - t <= MIC.windowMs)
  if (recent.length >= MIC.framesToPass) return 'passed'
  if (qualifyingAt.length === 0 && now - startedAt >= MIC.silenceFailMs) return 'no-signal'
  return 'listening'
}

/** Mean absolute luma difference between two RGBA frames of equal size. */
export function lumaDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let sum = 0
  let pixels = 0
  for (let i = 0; i < n; i += 4) {
    const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]
    const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]
    sum += Math.abs(la - lb)
    pixels++
  }
  return pixels === 0 ? 0 : sum / pixels
}

export type CameraVerdict = 'sampling' | 'passed' | 'frozen'

export function cameraVerdict(deltas: number[], startedAt: number, now: number): CameraVerdict {
  const live = deltas.filter((d) => d > CAMERA.deltaFloor).length
  if (live >= CAMERA.samplePairs) return 'passed'
  if (now - startedAt >= CAMERA.timeoutMs) return 'frozen'
  return 'sampling'
}
