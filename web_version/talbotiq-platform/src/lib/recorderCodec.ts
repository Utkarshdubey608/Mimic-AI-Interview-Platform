/**
 * Picking a MediaRecorder container the current browser can actually write.
 *
 * This is the single most common way a "works on my machine" interview app
 * fails in the field. Chrome records WebM; **Safari cannot write WebM at all**
 * and produces MP4. Passing `mimeType: 'video/webm'` to a Safari MediaRecorder
 * throws NotSupportedError, so recording dies at the moment the candidate
 * starts answering — the worst possible time to discover it.
 *
 * Both helpers return `undefined` when nothing in the list is supported, which
 * is the correct value to pass as `mimeType`: MediaRecorder then chooses its own
 * default, which is always something that browser can write. Never hardcode.
 */

/** Ordered by preference: best quality/compatibility first, Safari's MP4 last. */
const VIDEO_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1',   // Safari
  'video/mp4',               // Safari fallback
]

const AUDIO_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2', // Safari
  'audio/mp4',                  // Safari fallback
  'audio/ogg;codecs=opus',      // older Firefox
]

function firstSupported(candidates: string[]): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  // isTypeSupported is itself missing on some older WebKit builds.
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return candidates.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type)
    } catch {
      return false
    }
  })
}

export function pickVideoMimeType(): string | undefined {
  return firstSupported(VIDEO_CANDIDATES)
}

export function pickAudioMimeType(): string | undefined {
  return firstSupported(AUDIO_CANDIDATES)
}

/**
 * MediaRecorder options, or `{}`. Spread into the constructor:
 *   new MediaRecorder(stream, recorderOptions('video'))
 */
export function recorderOptions(kind: 'audio' | 'video'): MediaRecorderOptions {
  const mimeType = kind === 'video' ? pickVideoMimeType() : pickAudioMimeType()
  return mimeType ? { mimeType } : {}
}

/** The file extension matching a chosen container, for uploads. */
export function extensionFor(mimeType: string | undefined): string {
  if (!mimeType) return 'webm'
  if (mimeType.startsWith('audio/mp4') || mimeType.startsWith('video/mp4')) return 'mp4'
  if (mimeType.startsWith('audio/ogg')) return 'ogg'
  return 'webm'
}
