/**
 * Browser client for Gemini Live sessions minted by the backend.
 *
 * The backend mints a short-lived token whose BidiGenerateContentSetup was
 * locked at mint time (no fieldMask) — Google uses the token's copy of the
 * system instruction, voice and model and DISCARDS whatever setup the client
 * sends. That is what makes it safe to hand a candidate a token: a tampered
 * browser cannot rewrite the interviewer's instructions. The client still
 * sends a setup message because the protocol requires one to open the session.
 *
 * Used by the voice preview (§3.2), the guide TTS (§3.3) and the voice
 * interview transport in voiceClient.ts (§3.4).
 */

/** A minted Live session grant. `token` is a bearer credential — never log it. */
export interface LiveGrant {
  token: string
  wsUrl: string       // wss://generativelanguage.googleapis.com/ws/…BidiGenerateContentConstrained
  model: string
  expiresAt: string   // ISO — when the session is cut off
  connectBy: string   // ISO — the socket must be OPEN before this
}

/** The socket URL with the token in the query string — a browser cannot set
 *  headers on a WebSocket handshake. */
export function liveSocketUrl(grant: LiveGrant): string {
  return `${grant.wsUrl}?access_token=${encodeURIComponent(grant.token)}`
}

/* ─── Google's message shapes (the subset this app consumes) ─────────────── */

export interface LiveServerContent {
  modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> }
  /** Candidate speech transcript (mic in). */
  inputTranscription?: { text?: string }
  /** Interviewer speech transcript (model out). */
  outputTranscription?: { text?: string }
  turnComplete?: boolean
  interrupted?: boolean
  generationComplete?: boolean
}

export interface LiveServerMessage {
  setupComplete?: object
  serverContent?: LiveServerContent
  /** Keep the latest handle; reconnecting with it resumes the SAME session
   *  without consuming another use of the token. */
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean }
  goAway?: { timeLeft?: string }
}

/** Live messages arrive as text OR as binary frames carrying JSON — normalize
 *  both. Returns null for anything unparseable (never throws mid-stream). */
export async function parseLiveMessage(data: unknown): Promise<LiveServerMessage | null> {
  try {
    let raw: string
    if (typeof data === 'string') raw = data
    else if (data instanceof ArrayBuffer) raw = new TextDecoder().decode(data)
    else if (typeof Blob !== 'undefined' && data instanceof Blob) raw = await data.text()
    else return null
    return JSON.parse(raw) as LiveServerMessage
  } catch {
    return null
  }
}

/* ─── PCM byte utilities ─────────────────────────────────────────────────── */

/** Decode ONE base64 part. Each inlineData part is independently padded, so
 *  parts must be decoded separately and the BYTES concatenated — joining the
 *  base64 strings truncates at the first padding character. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let len = 0
  for (const p of parts) len += p.byteLength
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.byteLength }
  return out
}

/** Encode bytes to base64 in chunks (String.fromCharCode has an argument cap). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return btoa(bin)
}

/* ─── One-shot synthesis (voice preview, guide TTS) ──────────────────────── */

export interface SpeakOptions {
  /** INACTIVITY window: rejects only after this long with no message from
   *  Google. Long clips stream parts continuously, so a multi-minute synthesis
   *  survives while a dead connection still fails fast. */
  timeoutMs?: number
  /** Fires per decoded audio part as it arrives, so playback can start before
   *  the turn completes (the guide streams these into its gapless player). */
  onChunk?: (bytes: Uint8Array) => void
  /** Aborting closes the socket and rejects with an AbortError. */
  signal?: AbortSignal
}

/** The collected clip. `turnComplete` is false when the socket closed before
 *  Google finished the turn — still playable, but not cacheable as complete. */
export interface SpokenClip extends Uint8Array {
  turnComplete: boolean
}

/**
 * Connect with the grant, collect the model's audio until the turn completes,
 * and return the whole clip as 24 kHz PCM16 bytes. The token's locked system
 * instruction decides WHAT is spoken — the 'go' turn only starts it.
 */
export function speakViaGeminiLive(grant: LiveGrant, opts: SpeakOptions = {}): Promise<SpokenClip> {
  const { timeoutMs = 30_000, onChunk, signal } = opts
  const socket = new WebSocket(liveSocketUrl(grant))
  socket.binaryType = 'arraybuffer'
  const chunks: Uint8Array[] = []

  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try { socket.close() } catch { /* already closed */ }
      fn()
    }
    const fail = (m: string) => finish(() => reject(new Error(m)))
    const done = (turnComplete: boolean) =>
      finish(() => resolve(Object.assign(concatBytes(chunks), { turnComplete }) as SpokenClip))
    // Re-armed on every message — an idle deadline, not a whole-turn cap.
    const arm = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => fail('Voice timed out'), timeoutMs)
    }
    arm()
    const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')))
    if (signal?.aborted) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, { once: true })

    socket.onopen = () => {
      arm()
      socket.send(JSON.stringify({ setup: { model: grant.model } }))
      // The locked instruction says what to speak; this just starts the turn.
      socket.send(JSON.stringify({
        clientContent: { turns: [{ role: 'user', parts: [{ text: 'go' }] }], turnComplete: true },
      }))
    }

    socket.onmessage = async (ev) => {
      arm()
      const msg = await parseLiveMessage(ev.data)
      if (!msg || settled) return
      const server = msg.serverContent ?? {}
      for (const part of server.modelTurn?.parts ?? []) {
        const b64 = part.inlineData?.data
        if (!b64) continue
        const bytes = base64ToBytes(b64)           // decode PER PART
        chunks.push(bytes)
        onChunk?.(bytes)
      }
      if (server.turnComplete) done(true)
    }

    socket.onerror = () => fail('Could not reach the voice service')
    socket.onclose = () => {
      // Closed without a turnComplete: salvage what arrived (marked partial),
      // else report.
      if (chunks.length) done(false)
      else fail('Voice ended with no audio')
    }
  })
}
