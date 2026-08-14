export interface TranscriptEntry {
  role: 'candidate' | 'ai'
  text: string
  timestamp: number
  questionIdx: number
}

export const FILLER_WORDS = new Set([
  'um', 'uh', 'hmm', 'er', 'erm', 'ah', 'like', 'basically', 'literally',
  'actually', 'right', 'okay', 'so', 'you know', 'i mean', 'kind of', 'sort of',
])

export function countFillers(text: string): number {
  const words = text.toLowerCase().replace(/[.,!?;:]/g, '').split(/\s+/)
  return words.filter(w => FILLER_WORDS.has(w)).length
}

export function countWords(entries: TranscriptEntry[]): number {
  return entries
    .filter(e => e.role === 'candidate')
    .reduce((acc, e) => acc + e.text.split(/\s+/).filter(Boolean).length, 0)
}

export function calcWpm(entries: TranscriptEntry[]): number {
  const candidate = entries.filter(e => e.role === 'candidate')
  if (candidate.length < 2) return 0
  const durationMs = candidate[candidate.length - 1].timestamp - candidate[0].timestamp
  // Timestamps are ARRIVAL times of finalized segments: two finals landing close
  // together yield absurd figures (thousands of WPM) that cascade into dimension
  // scores and the ATS input. Require a meaningful span and cap at human range.
  if (durationMs < 10_000) return 0
  const words = countWords(entries)
  return Math.min(350, Math.round((words / durationMs) * 60_000))
}

// The DeepgramService class (client-held key, direct wss://api.deepgram.com
// URLs, a browser-side key test against /v1/projects) is gone: the client
// holds no vendor keys. Live transcription runs through the backend's
// authenticated relays at /api/web/{avatar,interview}/deepgram, and "is
// Deepgram configured?" comes from GET {httpBase()}/avatar/status, which
// reports { deepgram, hume, gemini, rekognition } as booleans (see
// refreshServiceStatus in src/store/useAppStore.ts). Only the pure transcript
// helpers above remain.
