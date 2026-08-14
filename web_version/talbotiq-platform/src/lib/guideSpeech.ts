/**
 * Speech routing for Mimic Guide — makes text-to-speech speak EVERY supported
 * language in that language, with a natural (non-robotic) voice.
 *
 * Two rules drive it:
 *   1. THE CONTENT PICKS THE LANGUAGE. The locale comes from the script of the
 *      text being spoken (shared detectSpeechLocale) — a Telugu answer speaks
 *      Telugu even if the selector shows English. The selector only breaks
 *      script ties (Hindi vs Marathi) and voices Latin-script text.
 *   2. NEURAL-FIRST. Gemini synthesis is the PRIMARY voice for every language —
 *      browsers either lack voices entirely (Telugu, Kannada, …) or default to
 *      robotic local ones. The backend mints a locked Live token
 *      (POST /help/tts-token) and the BROWSER speaks to Google directly; the
 *      Gemini key never reaches the client. Browser Web Speech is only the
 *      fallback when the server can't mint, and never lets an English voice
 *      mangle non-Latin text (silence + a notice beats reading stray English).
 *
 * Speech-to-text: `SPEECH_LOCALES` maps every one of the 55 guide languages to
 * a full BCP-47 locale so recognition works in each language.
 */

import { cancelSpeech, isSpeechSynthesisSupported, speak } from '@/lib/speechSynthesis'
import { httpBase } from '@/lib/apiOrigin'
import { speakViaGeminiLive, type LiveGrant } from '@/lib/geminiLive'
import {
  NON_LATIN_LANGS,
  SPEECH_LOCALES,
  detectSpeechLocale,
  stripForSpeech,
} from '@shared/speech'

export { SPEECH_LOCALES }

/** Strip markdown + the English <details> block so TTS reads only the answer.
 *  Delegates to the SHARED stripForSpeech standard (shared/speech.ts) — same
 *  rules as the Voice Interview and the Tavus avatar, so nothing formatted is
 *  ever read aloud on any surface. */
export function plainTextForSpeech(markdown: string): string {
  return stripForSpeech(
    markdown.replace(/<details>[\s\S]*?<\/details>/gi, ' '), // drop the English translation
  )
}

/** The TTS locale for a piece of text — the CONTENT's script decides the
 *  language; the selected voice language only breaks ties (see shared/speech). */
export function pickSpeechLocale(text: string, voiceLang: string): string {
  return detectSpeechLocale(text, voiceLang)
}

/* ─── Browser voice inventory ───────────────────────────────────────────── */

// getVoices() is often empty until the async `voiceschanged` event; resolve the
// list once and cache it (it doesn't change during a session in practice).
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!isSpeechSynthesisSupported()) return Promise.resolve([])
  if (voicesPromise) return voicesPromise
  voicesPromise = new Promise((resolve) => {
    const synth = window.speechSynthesis
    const now = synth.getVoices()
    if (now.length > 0) {
      resolve(now)
      return
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      const list = synth.getVoices()
      // Don't cache an empty inventory (slow engine start) — retry next call,
      // otherwise every language would be routed to server TTS forever.
      if (list.length === 0) voicesPromise = null
      resolve(list)
    }
    synth.addEventListener('voiceschanged', finish, { once: true })
    window.setTimeout(finish, 1500)
  })
  return voicesPromise
}

/** Does the browser have a real voice for this locale (exact or base lang)? */
function hasVoiceFor(locale: string, voices: SpeechSynthesisVoice[]): boolean {
  const target = locale.toLowerCase()
  const base = target.split('-')[0]
  return voices.some((v) => {
    const l = v.lang.toLowerCase().replace('_', '-')
    return l === target || l.split('-')[0] === base
  })
}

/* ─── Server-synthesized PCM playback (stoppable) ───────────────────────── */

function base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const view = new DataView(bytes.buffer)
  const out = new Float32Array(Math.floor(bytes.byteLength / 2))
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000
  return out
}

/** Play one-shot PCM16 (24 kHz) base64 audio. Returns a stop function; `onEnd`
 *  fires on natural completion only (the caller handles the stopped case). */
function playPcm(b64: string, rate: number, onEnd?: () => void): () => void {
  const ctx = new AudioContext()
  const samples = base64ToFloat32(b64)
  const buffer = ctx.createBuffer(1, Math.max(samples.length, 1), rate)
  buffer.getChannelData(0).set(samples)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  let stopped = false
  const close = () => void ctx.close().catch(() => {})
  src.onended = () => {
    if (!stopped) onEnd?.()
    close()
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  src.start()
  return () => {
    stopped = true
    try {
      src.stop()
    } catch {
      // already ended
    }
    close()
  }
}

/* ─── Streaming PCM playback (gapless, stoppable) ───────────────────────── */

function bytesToFloat32(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Float32Array(Math.floor(bytes.byteLength / 2))
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000
  return out
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return btoa(bin)
}

/**
 * Plays 24 kHz PCM16 fragments as they arrive, scheduling each buffer to start
 * exactly when the previous one ends — so a streamed answer plays continuously
 * with no gaps. `onEnd` fires once, after the last fragment finishes (or on stop).
 */
class PcmStreamPlayer {
  private ctx: AudioContext
  private nextTime: number
  private sources: AudioBufferSourceNode[] = []
  private stopped = false
  private ended = false
  private endCb?: () => void
  private endTimer: number | null = null

  constructor(private rate = 24000) {
    this.ctx = new AudioContext()
    this.nextTime = this.ctx.currentTime
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
  }

  enqueue(bytes: Uint8Array): void {
    if (this.stopped || bytes.byteLength < 2) return
    const f32 = bytesToFloat32(bytes)
    const buf = this.ctx.createBuffer(1, f32.length, this.rate)
    buf.getChannelData(0).set(f32)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.ctx.destination)
    const start = Math.max(this.nextTime, this.ctx.currentTime)
    src.start(start)
    this.nextTime = start + buf.duration
    this.sources.push(src)
  }

  /** No more fragments will arrive — end once the queued audio finishes. */
  markDone(): void {
    if (this.stopped || this.ended) return
    if (this.endTimer !== null) window.clearTimeout(this.endTimer)
    const wait = Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000) + 60
    this.endTimer = window.setTimeout(() => this.finish(), wait)
  }

  onEnd(cb: () => void): void {
    this.endCb = cb
  }

  private finish(): void {
    if (this.ended || this.stopped) return
    this.ended = true
    void this.ctx.close().catch(() => {})
    const cb = this.endCb
    this.endCb = undefined
    cb?.()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.endTimer !== null) window.clearTimeout(this.endTimer)
    this.sources.forEach((s) => {
      try {
        s.stop()
      } catch {
        /* already ended */
      }
    })
    void this.ctx.close().catch(() => {})
  }
}

/* ─── Client-side synthesized-audio cache (makes Listen/replay instant) ──── */

// base64 PCM per (locale, chunk). Bounded FIFO. Populated by playback AND by
// prewarmSpeech, so by the time the user clicks Listen the audio is already here
// and plays with no network round-trip.
const audioCache = new Map<string, string>() // full-answer base64 PCM per (locale, text)
const MAX_AUDIO_CACHE = 40
const prewarming = new Set<string>() // keys currently being pre-warmed (dedup)

function cacheKey(locale: string, text: string): string {
  return `${locale}|${text}`
}

/**
 * Synthesize an answer via a backend-minted Gemini Live token: POST
 * /help/tts-token returns a grant and the BROWSER collects the audio from
 * Google, emitting each fragment to `onChunk` as it arrives so playback can
 * start before the turn completes. The server never sees this audio (the old
 * route's 40-clip server cache went with it), so the finished clip is cached
 * HERE, keyed lang+text — without that, every Listen press would re-mint and
 * re-speak. Returns true if any audio was produced.
 */
async function streamAndCache(
  text: string,
  locale: string,
  onChunk?: (bytes: Uint8Array) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await fetch(`${httpBase()}/help/tts-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 2000), lang: locale }),
    signal,
  })
  if (!res.ok) throw new Error(`tts failed (${res.status})`)
  const grant = (await res.json()) as LiveGrant

  const pcm = await speakViaGeminiLive(grant, { onChunk, signal })
  if (pcm.byteLength === 0) return false

  // A clip salvaged from a dropped socket played fine just now, but caching it
  // would replay the truncation on every future Listen press — cache only what
  // Google actually finished.
  if (pcm.turnComplete) {
    audioCache.set(cacheKey(locale, text), bytesToBase64(pcm))
    while (audioCache.size > MAX_AUDIO_CACHE) {
      const oldest = audioCache.keys().next().value
      if (oldest === undefined) break
      audioCache.delete(oldest)
    }
  }
  return true
}

/**
 * Pre-synthesize an answer into the cache so a later Listen click plays instantly
 * with no round-trip. Fire-and-forget and deduped, so it never double-synthesizes.
 * Call this when auto-speak is OFF (when it's on, playback already caches the clip).
 */
export function prewarmSpeech(markdown: string, voiceLang: string): void {
  if (typeof fetch === 'undefined') return
  const text = plainTextForSpeech(markdown)
  if (!text) return
  const locale = pickSpeechLocale(text, voiceLang)
  const key = cacheKey(locale, text)
  if (audioCache.has(key) || prewarming.has(key)) return
  prewarming.add(key)
  void streamAndCache(text, locale)
    .catch(() => {}) // provider down / no key — Listen will surface it
    .finally(() => prewarming.delete(key))
}

/* ─── The unified speak entry point ─────────────────────────────────────── */

/**
 * Speak `text` for the selected guide voice language. Returns a stop function
 * immediately; the actual playback may start asynchronously (voice lookup /
 * server round-trip). `onEnd` fires exactly once — on natural completion, on
 * failure, or when stopped. `onUnavailable` fires (before `onEnd`) only when no
 * playback path exists at all, so the UI can tell the user instead of failing
 * silently.
 */
export function speakSmart(
  text: string,
  voiceLang: string,
  onEnd?: () => void,
  onUnavailable?: () => void,
): () => void {
  const locale = pickSpeechLocale(text, voiceLang)
  const base = locale.split('-')[0].toLowerCase()

  let cancelled = false
  let innerStop: (() => void) | null = null
  let ended = false
  const endOnce = () => {
    if (ended) return
    ended = true
    onEnd?.()
  }

  void (async () => {
    // 1) Instant replay: the whole answer is already cached this session.
    const key = cacheKey(locale, text)
    const cachedFull = audioCache.get(key)
    if (cachedFull) {
      innerStop = playPcm(cachedFull, 24000, endOnce)
      return
    }

    // 2) Voice policy for a cold play:
    //  • ENGLISH always uses the neural Voice-Interview voice (Aoede) — never the
    //    browser's own English voice, which sounds different.
    //  • Every OTHER language keeps its prior behavior: if the browser has a real
    //    voice for it, speak instantly with the browser.
    if (base !== 'en') {
      const voices = await loadVoices()
      if (cancelled) return
      if (hasVoiceFor(locale, voices)) {
        innerStop = speak(text, locale, endOnce)
        return
      }
    }

    // 3) Stream the neural voice and play it AS IT ARRIVES — first audio in ~1s
    //    (not after the whole clip). The clip is cached on completion so replay
    //    is instant.
    const controller = new AbortController()
    const player = new PcmStreamPlayer()
    player.onEnd(endOnce)
    innerStop = () => {
      controller.abort()
      player.stop()
    }
    try {
      const got = await streamAndCache(text, locale, (bytes) => player.enqueue(bytes), controller.signal)
      if (cancelled) return
      if (got) {
        player.markDone() // player fires endOnce once the queued audio finishes
        return
      }
      throw new Error('no audio')
    } catch (error) {
      if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
      player.stop()
      console.warn('[mimic-guide] server TTS unavailable:', error)
    }

    // 4) Fallback: a browser voice matching the CONTENT's language, if installed.
    const voices = await loadVoices()
    if (cancelled) return
    if (hasVoiceFor(locale, voices)) {
      innerStop = speak(text, locale, endOnce)
      return
    }

    // 5) Last resort: browser default voice — Latin-script content only. A
    //    wrong-language voice reading a non-Latin script reads stray English
    //    words, which is worse than staying silent.
    if (!NON_LATIN_LANGS.has(base)) {
      innerStop = speak(text, locale, endOnce)
    } else {
      onUnavailable?.()
      endOnce()
    }
  })()

  return () => {
    cancelled = true
    innerStop?.()
    cancelSpeech()
    endOnce()
  }
}
