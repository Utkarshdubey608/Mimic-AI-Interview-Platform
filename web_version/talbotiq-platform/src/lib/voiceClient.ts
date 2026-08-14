import type { VoicePhase, TimeOfDay } from '@shared/types'
import {
  liveSocketUrl, parseLiveMessage, bytesToBase64,
  type LiveServerMessage,
} from './geminiLive'
import { sessionsApi, type VoiceTokenGrant } from './api'

/**
 * Low-latency browser transport for the Voice Track.
 *
 * The backend mints a short-lived Gemini Live token
 * (POST /sessions/{id}/voice/token) whose setup — system instruction, question
 * script, voice, model — was LOCKED at mint time, and the browser talks to
 * Google directly. There is no server relay anymore. The LLM credential never
 * touches the client; a tampered browser cannot rewrite the locked setup
 * (Google discards the client's copy).
 *
 * Mic audio is downsampled to 16 kHz PCM16 INSIDE the audio worklet (off the
 * main thread), batched into ~20 ms chunks, and sent as realtimeInput JSON.
 * The agent's 24 kHz PCM comes back base64-encoded inside serverContent
 * messages and is played gaplessly.
 *
 * Because the audio no longer passes through the backend, every FINALISED
 * utterance — both roles — is POSTed to /sessions/{id}/voice/transcript, in
 * order. That POST is the only way the transcript reaches the record the
 * interview is scored from; the server fuzzy-matches interviewer turns to the
 * planned questions and returns the running coverage count, which also drives
 * the end-of-interview decision here.
 */

const AGENT_RATE = 24000
const MIC_RATE = 16000
const CHUNK_MS = 20

// AudioWorklet: resample→PCM16→batch on the worklet thread, transfer buffers out.
const CAPTURE_WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.target = ${MIC_RATE}
    this.ratio = sampleRate / this.target      // sampleRate = context rate (ideally 16000)
    this.chunk = Math.round(this.target * ${CHUNK_MS} / 1000)
    this.buf = new Int16Array(this.chunk)
    this.n = 0
    this.readPos = 0
  }
  push(f) {
    const s = f < -1 ? -1 : f > 1 ? 1 : f
    this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
    if (this.n >= this.chunk) {
      const out = this.buf
      this.port.postMessage(out.buffer, [out.buffer])   // zero-copy transfer
      this.buf = new Int16Array(this.chunk)
      this.n = 0
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    if (this.ratio === 1) {
      for (let i = 0; i < ch.length; i++) this.push(ch[i])
    } else {
      for (; this.readPos < ch.length; this.readPos += this.ratio) this.push(ch[Math.floor(this.readPos)])
      this.readPos -= ch.length
    }
    return true
  }
}
registerProcessor('capture-processor', CaptureProcessor)
`

/** base64 PCM16 → Float32. Google delivers audio as base64-in-JSON, decoded per part. */
function base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return int16BytesToFloat32(bytes.buffer)
}
function int16BytesToFloat32(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf)
  const out = new Float32Array(Math.floor(buf.byteLength / 2))
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000
  return out
}

export interface VoiceClientCallbacks {
  onPhase?: (phase: VoicePhase) => void
  onCaption?: (role: 'interviewer' | 'candidate', text: string, final: boolean) => void
  /** Agent audio became audible / drained. Phases lead local playback by the
   *  buffered duration, so the UI should trust THIS for "speaking". */
  onAudioPlaying?: (playing: boolean) => void
  /** The socket dropped and we're transparently reconnecting (mic stays open).
   *  active=false once reconnected or after we give up. */
  onReconnecting?: (active: boolean) => void
  onEnded?: (reason?: string, graceful?: boolean) => void
  onError?: (message: string) => void
}

// Backoff between reconnect attempts (ms), capped at the last value and repeated.
const RECONNECT_DELAYS = [500, 1000, 2000, 3000, 5000, 8000]
// In the closing exchange, end after this much candidate silence.
const CLOSING_SILENCE_MS = 15_000
// At most two "keep asking" nudges, as the Express relay allowed.
const MAX_NUDGES = 2

export class VoiceClient {
  private ws?: WebSocket
  private stream?: MediaStream
  private captureCtx?: AudioContext
  private worklet?: AudioWorkletNode
  private source?: MediaStreamAudioSourceNode
  private playbackCtx?: AudioContext
  private nextStartAt = 0
  private sources: AudioBufferSourceNode[] = []
  private drainTimer?: ReturnType<typeof setTimeout>
  private playing = false
  private muted = false
  private closed = false
  private finished = false                    // interview over → do not reconnect
  private reconnectAttempts = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private capTimer?: ReturnType<typeof setTimeout>

  // The minted grant + Google's session-resumption handle (kept fresh from
  // sessionResumptionUpdate messages; resuming does not consume the token).
  private grant?: VoiceTokenGrant
  private resumeHandle?: string

  // Transcript state. Captions accumulate per role and flush on turnComplete.
  private pendingInterviewer = ''
  private pendingCandidate = ''
  private postChain: Promise<void> = Promise.resolve()  // keeps POSTs in order
  private asked = 0
  private total = 0

  // End-of-interview state (see "Deciding when the interview is over", §3.4).
  private closing = false
  private closingTimer?: ReturnType<typeof setTimeout>
  private nudges = 0

  constructor(private sessionId: string, private cbs: VoiceClientCallbacks) {}

  /** `timeOfDay` is accepted for interface stability but unused: the greeting
   *  is part of the token's locked setup now. */
  async start(timeOfDay?: TimeOfDay): Promise<void> {
    void timeOfDay
    this.cbs.onPhase?.('connecting')
    // 1) Mic capture at 16 kHz (the worklet resamples if the browser ignores the hint).
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    })
    this.captureCtx = new AudioContext({ sampleRate: MIC_RATE })
    await this.captureCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' })))
    this.source = this.captureCtx.createMediaStreamSource(this.stream)
    this.worklet = new AudioWorkletNode(this.captureCtx, 'capture-processor')
    this.worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.muted || this.ws?.readyState !== WebSocket.OPEN) return
      // 16 kHz PCM16 mic chunk, base64 inside Google's realtimeInput envelope.
      this.ws.send(JSON.stringify({
        realtimeInput: { audio: { data: bytesToBase64(new Uint8Array(e.data)), mimeType: 'audio/pcm;rate=16000' } },
      }))
    }
    this.source.connect(this.worklet)
    const sink = this.captureCtx.createGain()
    sink.gain.value = 0
    this.worklet.connect(sink).connect(this.captureCtx.destination)

    // 2) Playback context (agent audio is 24 kHz).
    this.playbackCtx = new AudioContext()

    // 3) Mint the locked grant, then connect straight to Google. The mint also
    //    resolves the session and generates questions for adaptive templates.
    this.grant = await sessionsApi.voiceToken(this.sessionId)
    this.total = this.grant.totalQuestions ?? 0

    // Hard cap: end at expiresAt regardless, graceful iff coverage completed.
    const msLeft = Date.parse(this.grant.expiresAt) - Date.now()
    if (Number.isFinite(msLeft) && msLeft > 0) {
      this.capTimer = setTimeout(() => this.finishInterview(this.covered, 'expired'), msLeft)
    }

    this.openWs()
  }

  private get covered(): boolean {
    return this.total > 0 && this.asked >= this.total
  }

  /** Open (or re-open) the Google Live socket. The mic + playback contexts stay
   *  alive across reconnects — only this socket is recreated on a drop. */
  private openWs(): void {
    if (this.closed || this.finished || !this.grant) return
    const ws = new WebSocket(liveSocketUrl(this.grant))
    this.ws = ws
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      this.reconnectAttempts = 0
      this.cbs.onReconnecting?.(false)
      // The token carries the real setup (locked at mint, no fieldMask); this
      // message just opens the session. Reconnects add the resumption handle so
      // Google restores the SAME conversation without consuming the token.
      ws.send(JSON.stringify({
        setup: {
          model: this.grant!.model,
          ...(this.resumeHandle ? { sessionResumption: { handle: this.resumeHandle } } : {}),
        },
      }))
      this.cbs.onPhase?.('greeting')
    }
    ws.onmessage = (ev) => { void this.onLiveMessage(ev.data) }
    ws.onerror = () => { /* a 'close' event always follows; reconnect is handled there */ }
    ws.onclose = () => {
      if (this.ws !== ws) return                // superseded by a newer socket
      if (this.closed || this.finished) return  // intentional teardown / real finish
      this.scheduleReconnect()
    }
  }

  /** The adapter: Google's protocol → the same VoiceClientCallbacks the old
   *  relay drove, so nothing above this file changes. */
  private async onLiveMessage(data: unknown): Promise<void> {
    const msg: LiveServerMessage | null = await parseLiveMessage(data)
    if (!msg || this.closed || this.finished) return

    const handle = msg.sessionResumptionUpdate?.newHandle
    if (handle) this.resumeHandle = handle

    const server = msg.serverContent
    if (!server) return

    // Barge-in: drop queued playback and the caption of the cut-off turn.
    if (server.interrupted) {
      this.flushPlayback()
      this.pendingInterviewer = ''
      return
    }

    // Agent audio: base64 PCM16 (24 kHz) per part — never concatenate the
    // base64 strings (each part is independently padded).
    let spoke = false
    for (const part of server.modelTurn?.parts ?? []) {
      const b64 = part.inlineData?.data
      if (b64) { this.enqueuePcm(b64); spoke = true }
    }
    if (spoke) this.cbs.onPhase?.('speaking')

    // Transcripts accumulate per role; emit the running buffer as non-final.
    const out = server.outputTranscription?.text
    if (out) {
      this.pendingInterviewer += out
      this.cbs.onCaption?.('interviewer', this.pendingInterviewer, false)
    }
    const inp = server.inputTranscription?.text
    if (inp) {
      this.pendingCandidate += inp
      this.cbs.onCaption?.('candidate', this.pendingCandidate, false)
      this.cbs.onPhase?.('listening')   // input transcription ⇒ the candidate is speaking
    }

    if (server.turnComplete) this.handleTurnComplete()
  }

  /** Flush both pending buffers as final captions, forward them to the
   *  transcript record (in order), and run the end-of-interview decision. */
  private handleTurnComplete(): void {
    const cand = this.pendingCandidate.trim()
    const intv = this.pendingInterviewer.trim()
    this.pendingCandidate = ''
    this.pendingInterviewer = ''
    if (cand) this.cbs.onCaption?.('candidate', cand, true)
    if (intv) this.cbs.onCaption?.('interviewer', intv, true)
    if (!this.finished) this.cbs.onPhase?.('listening')

    // The POSTs ride one promise chain so utterances reach the server in the
    // order they finalised — the server matches them against the plan.
    this.postChain = this.postChain.then(async () => {
      if (this.closed || this.finished) return
      if (cand) {
        await this.postTranscript('candidate', cand)
        // In the closing exchange, the candidate's next turn ends the interview.
        if (this.closing && !this.finished) { this.finishInterview(true); return }
      }
      if (intv) {
        await this.postTranscript('interviewer', intv)
        if (this.finished) return
        const isQuestion = intv.includes('?')
        if (this.covered && !isQuestion && !this.closing) {
          // Coverage complete and the first non-question turn arrived — that is
          // the wrap-up. End after the candidate replies or after ~15 s of silence.
          this.closing = true
          this.closingTimer = setTimeout(() => this.finishInterview(true), CLOSING_SILENCE_MS)
        } else if (!this.covered && !isQuestion && this.asked >= 1 && this.nudges < MAX_NUDGES) {
          // Belt-and-braces: the locked instruction already carries the strict
          // script, but nudge a model that tries to wrap up early (max 2×).
          this.nudges++
          this.ws?.send(JSON.stringify({ clientContent: {
            turns: [{ role: 'user', parts: [{ text: 'You still have more questions to cover. Do not wrap up yet — ask the next planned question now.' }] }],
            turnComplete: true,
          } }))
        }
      }
    })
  }

  /** POST one finalised utterance; the response carries the running coverage. */
  private async postTranscript(role: 'interviewer' | 'candidate', text: string): Promise<void> {
    try {
      const r = await sessionsApi.voiceTranscript(this.sessionId, { role, text })
      if (typeof r?.asked === 'number') this.asked = r.asked
      if (typeof r?.total === 'number' && r.total > 0) this.total = r.total
    } catch {
      // Non-fatal: the next finalised turn refreshes the counts. The interview
      // must not die because one transcript POST hiccuped.
    }
  }

  /** The interview is over — by coverage, candidate end, or the hard cap. */
  private finishInterview(graceful: boolean, reason = 'completed'): void {
    if (this.finished || this.closed) return
    this.finished = true
    this.cbs.onEnded?.(reason, graceful)
    // The audio never touched the backend, so completion is the client's call.
    void sessionsApi.complete(this.sessionId).catch(() => { /* already completed / offline */ })
    this.dispose()
  }

  /** Retry the socket with backoff using Google's resumption handle. The old
   *  55 s window matched a relay grace period that no longer exists — the only
   *  deadline now is the token's own expiresAt. */
  private scheduleReconnect(): void {
    if (this.closed || this.finished) return
    this.flushPlayback() // drop stale audio buffered from the turn that was cut off
    const expired = !this.grant || Date.parse(this.grant.expiresAt) <= Date.now()
    if (expired) {
      this.cbs.onReconnecting?.(false)
      this.finishInterview(this.covered, 'disconnected')
      return
    }
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)]
    this.reconnectAttempts++
    this.cbs.onReconnecting?.(true)
    this.cbs.onPhase?.('connecting')
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.openWs(), delay)
  }

  private enqueuePcm(b64: string) {
    const ctx = this.playbackCtx
    if (!ctx) return
    const samples = base64ToFloat32(b64)
    if (samples.length === 0) return
    if (ctx.state === 'suspended') void ctx.resume()
    const buffer = ctx.createBuffer(1, samples.length, AGENT_RATE)
    buffer.getChannelData(0).set(samples)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    const startAt = Math.max(ctx.currentTime, this.nextStartAt)
    src.start(startAt)
    this.nextStartAt = startAt + buffer.duration
    this.sources.push(src)
    src.onended = () => { this.sources = this.sources.filter((s) => s !== src) }
    this.setPlaying(true)
    this.armDrainCheck()
  }

  private setPlaying(p: boolean) {
    if (this.playing === p) return
    this.playing = p
    this.cbs.onAudioPlaying?.(p)
  }

  /** Fire onAudioPlaying(false) the moment the scheduled queue actually drains. */
  private armDrainCheck() {
    if (this.drainTimer) clearTimeout(this.drainTimer)
    const ctx = this.playbackCtx
    if (!ctx) return
    const remaining = this.nextStartAt - ctx.currentTime
    if (remaining <= 0.05) { this.setPlaying(false); return }
    this.drainTimer = setTimeout(() => this.armDrainCheck(), remaining * 1000 + 60)
  }

  /** Barge-in: stop and drop everything queued for playback. */
  private flushPlayback() {
    for (const s of this.sources) { try { s.stop() } catch { /* noop */ } }
    this.sources = []
    this.nextStartAt = 0
    if (this.drainTimer) clearTimeout(this.drainTimer)
    this.setPlaying(false)
  }

  /** Mute is local now: the worklet simply stops sending mic chunks. */
  setMuted(muted: boolean) {
    this.muted = muted
  }

  /** Candidate-initiated end: finalize the session, then tear down. */
  end() {
    this.finishInterview(true, 'ended')
  }

  /** Tear down mic + sockets WITHOUT finalizing (safe on unmount / remount). */
  dispose() {
    if (this.closed) return
    this.closed = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined }
    if (this.closingTimer) { clearTimeout(this.closingTimer); this.closingTimer = undefined }
    if (this.capTimer) { clearTimeout(this.capTimer); this.capTimer = undefined }
    this.flushPlayback()
    try { this.worklet?.disconnect() } catch { /* noop */ }
    try { this.source?.disconnect() } catch { /* noop */ }
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.captureCtx?.close()
    void this.playbackCtx?.close()
    try { this.ws?.close() } catch { /* noop */ }
  }
}

/** Play a one-shot PCM16 (24 kHz) base64 sample — used by the voice preview button. */
export async function playPcmSample(b64: string, rate = AGENT_RATE): Promise<void> {
  const ctx = new AudioContext()
  const samples = base64ToFloat32(b64)
  const buffer = ctx.createBuffer(1, samples.length, rate)
  buffer.getChannelData(0).set(samples)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  await new Promise<void>((resolve) => { src.onended = () => resolve(); src.start() })
  void ctx.close()
}
