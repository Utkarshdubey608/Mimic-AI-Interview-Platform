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
      return true
    }
    // Downsampling. Taking the nearest sample and discarding the rest folds everything
    // above the new Nyquist limit back into the speech band as aliasing noise — audible
    // as a metallic edge, and worse for a recogniser being asked to tell "Redis" from
    // "reduce" through it.
    //
    // Chrome honours the 16 kHz AudioContext, so ratio is 1 and this never runs there.
    // Safari and Firefox commonly hand back 44.1/48 kHz, so for those candidates this
    // WAS the path, decimating 3:1 with no filter. Averaging the samples each output
    // sample spans is a cheap box filter: not a windowed-sinc, but it attenuates the
    // folded band instead of passing it through, for a few adds on the audio thread.
    for (; this.readPos < ch.length; this.readPos += this.ratio) {
      const start = Math.floor(this.readPos)
      const end = Math.min(ch.length, Math.floor(this.readPos + this.ratio))
      let sum = 0
      let n = 0
      for (let i = start; i < end; i++) { sum += ch[i]; n++ }
      this.push(n ? sum / n : ch[start])
    }
    this.readPos -= ch.length
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
// Every question is asked but nothing has come back yet. Long enough for a real final
// answer including a thinking pause, short enough that a dead microphone does not leave
// the candidate on a frozen screen with the session still in progress.
const FINAL_ANSWER_GRACE_MS = 120_000
// At most two "keep asking" nudges, as the Express relay allowed.
const MAX_NUDGES = 2
// Shortest cut-off interviewer fragment still worth recording. Above the server's own
// MIN_MATCHABLE_CHARS (8), because a fragment that short could sit inside more than one
// planned question and filing an answer under the wrong one is worse than not counting it.
const MIN_SALVAGEABLE_CHARS = 12

// Question detection, ported from server/services/voiceFlow.ts: spoken questions
// are often imperative ("Describe your deployment pipeline.") and carry no '?'.
const QUESTION_LEAD = /^(tell me|walk me|describe|explain|how |what |why |where |when |which |who |can you|could you|would you|do you|did you|have you|are you|were you|give me|share|let'?s (talk|dive|start)|talk to me)/i
function isQuestionShaped(text: string): boolean {
  const t = (text ?? '').trim()
  return t.includes('?') || QUESTION_LEAD.test(t)
}
/** Unambiguous, end-anchored closing phrases (used only to nudge early wrap-ups) —
 *  the same guard the Express flow used, so an ordinary acknowledgment never
 *  triggers a disruptive "keep asking" director note. */
const HARD_CLOSING_RE = /\b(this concludes|the interview is (now )?(over|complete|done)|thank you (so much )?for your time|that concludes (the|our) interview|we'?ve reached the end|wrap(ping)? (this )?up|goodbye|take care)\b/i

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
  /** The candidate has spoken since the plan was fully asked — i.e. the final question
   *  actually got an answer. Guards the wrap-up so the interview cannot close on the
   *  question it just finished asking. */
  private answeredSinceCovered = false
  /** Backstop for the case above: covered, but no answer heard. Bounds the wait so a
   *  dead microphone cannot leave the session open indefinitely. */
  private finalAnswerTimer?: ReturnType<typeof setTimeout>

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
    //    A failed mint (no résumé yet, already finished, rate limit, offline)
    //    must not leave the microphone we just opened recording behind the
    //    error screen — release everything before surfacing the error.
    try {
      this.grant = await sessionsApi.voiceToken(this.sessionId)
    } catch (e) {
      this.dispose()
      throw e
    }
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
      const resuming = !!this.resumeHandle
      ws.send(JSON.stringify({
        setup: {
          model: this.grant!.model,
          ...(resuming ? { sessionResumption: { handle: this.resumeHandle } } : {}),
        },
      }))
      // Native-audio models generate nothing until a turn arrives — the locked
      // instruction says WHAT to do, this turn starts it (the Express relay sent
      // exactly this line). A resumed session is mid-conversation: no kickoff.
      if (!resuming) {
        ws.send(JSON.stringify({ clientContent: {
          turns: [{ role: 'user', parts: [{ text: 'Begin the interview now: greet me and ask if I am ready to begin.' }] }],
          turnComplete: true,
        } }))
      }
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

    // Barge-in: drop queued playback, but KEEP what the interviewer already said.
    //
    // Discarding it lost the question from the record entirely: a candidate who so much
    // as coughed over the start of a question meant that question was never captioned,
    // never POSTed and so never counted as asked. Coverage then stalled below the plan,
    // and the nudge below fired to make the model "ask the next planned question",
    // which it satisfied by asking one again — the reported "asks 8 and repeats the
    // last question".
    //
    // A partial question still matches: the server scores containment either way
    // (avatar_transcript.match_question_index), so a prefix of a planned question
    // resolves to that question. Very short fragments are dropped rather than risk
    // matching the wrong one.
    if (server.interrupted) {
      this.flushPlayback()
      const cut = this.pendingInterviewer.trim()
      this.pendingInterviewer = ''
      if (cut.length >= MIN_SALVAGEABLE_CHARS) {
        this.cbs.onCaption?.('interviewer', cut, true)
        this.postChain = this.postChain
          .then(() => this.postTranscript('interviewer', cut))
          .catch(() => { /* keep the chain alive */ })
      }
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
    // order they finalised — the server matches them against the plan. The
    // POSTs themselves run even after finish/teardown (they were legitimately
    // finalised and the scoring record needs them); only the DECISIONS are
    // gated. The trailing catch keeps one failed step from wedging the chain.
    const wasClosing = this.closing
    this.postChain = this.postChain.then(async () => {
      if (cand) await this.postTranscript('candidate', cand)
      if (intv) await this.postTranscript('interviewer', intv)

      if (this.finished || this.closed) return

      // The last question is not "covered" until it has been ANSWERED. `asked` counts
      // questions the interviewer has PUT, so coverage flips the moment the final
      // question leaves its mouth — before the candidate has said a word.
      if (cand && this.covered) {
        this.answeredSinceCovered = true
        this.clearFinalAnswerGrace()   // they are answering; the safety valve is not needed
      }

      if (intv) {
        if (this.covered && !this.closing && !isQuestionShaped(intv)) {
          if (this.answeredSinceCovered || HARD_CLOSING_RE.test(intv)) {
            // Either the final answer is in, or the interviewer has said goodbye in so
            // many words. Both are unambiguous. End after the candidate replies or
            // ~15 s of silence.
            this.closing = true
            this.clearFinalAnswerGrace()
            this.closingTimer = setTimeout(() => this.finishInterview(true), CLOSING_SILENCE_MS)
          } else if (!this.finalAnswerTimer) {
            // Covered, but nothing has been heard back yet. Do NOT close: this is most
            // often the candidate gathering their thoughts on the last question, and
            // closing here is the bug this guard exists for.
            //
            // It must not hang either. A candidate whose microphone died, or who simply
            // walked away, would otherwise sit on a dead screen with the session left
            // in_progress until the credential expired — which can be twenty minutes.
            // So: a generous window for a real final answer, then end cleanly.
            this.finalAnswerTimer = setTimeout(
              () => this.finishInterview(true), FINAL_ANSWER_GRACE_MS,
            )
          }
        } else if (!this.covered && HARD_CLOSING_RE.test(intv) && this.nudges < MAX_NUDGES) {
          // Belt-and-braces: the locked instruction already carries the strict
          // script, but nudge a model that UNAMBIGUOUSLY wraps up early (max 2×,
          // hard-closing phrases only — the Express flow's exact guard).
          this.nudges++
          try {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ clientContent: {
                turns: [{ role: 'user', parts: [{ text: 'You still have more questions to cover. Do not wrap up yet — ask the next planned question now.' }] }],
                turnComplete: true,
              } }))
            }
          } catch { /* socket raced shut — the locked script recovers on its own */ }
        }
      }
      // In the closing exchange, the candidate's reply (their farewell) ends the
      // interview — AFTER both transcripts above have reached the record.
      if (wasClosing && cand) this.finishInterview(true)
    }).catch(() => { /* keep the chain alive — the next turn still posts */ })
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
    this.dispose()
    // The audio never touched the backend, so completion is the client's call —
    // but only after the transcript chain drains, or the server would score a
    // record that is still missing the final answer.
    this.postChain = this.postChain
      .catch(() => { /* a failed POST must not block completion */ })
      .finally(() => { void sessionsApi.complete(this.sessionId).catch(() => { /* already completed / offline */ }) })
  }

  /** Give up WITHOUT finalizing: the session stays in progress server-side, so
   *  the candidate can reopen their link and start a fresh Live session. */
  private abandon(reason: string): void {
    if (this.finished || this.closed) return
    this.finished = true
    this.cbs.onEnded?.(reason, false)
    this.dispose()
  }

  /** Retry the socket with backoff using Google's resumption handle. The old
   *  55 s window matched a relay grace period that no longer exists — the only
   *  deadline now is the token's own expiresAt. */
  private scheduleReconnect(): void {
    if (this.closed || this.finished) return
    this.flushPlayback() // drop stale audio buffered from the turn that was cut off
    // Without a resumption handle a reconnect asks Google for a NEW session —
    // the single-use token is already spent and connectBy has passed, so every
    // attempt is guaranteed to fail. Don't show a doomed "Reconnecting…" loop:
    // covered ⇒ finish for real; not covered ⇒ leave the session in progress
    // so reopening the link mints a fresh token and starts over.
    const expired = !this.grant || Date.parse(this.grant.expiresAt) <= Date.now()
    if (expired || !this.resumeHandle) {
      this.cbs.onReconnecting?.(false)
      if (this.covered) this.finishInterview(true, 'disconnected')
      else this.abandon('disconnected')
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

  /** Candidate-initiated end: finalize the session, then tear down. Graceful
   *  only if the plan was covered — quitting three questions in must show the
   *  interrupted screen, not "All done, thank you!" (Express behaved the same). */
  end() {
    this.finishInterview(this.covered, 'ended')
  }

  private clearFinalAnswerGrace(): void {
    if (this.finalAnswerTimer) {
      clearTimeout(this.finalAnswerTimer)
      this.finalAnswerTimer = undefined
    }
  }

  /** Tear down mic + sockets WITHOUT finalizing (safe on unmount / remount). */
  dispose() {
    if (this.closed) return
    this.closed = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined }
    if (this.closingTimer) { clearTimeout(this.closingTimer); this.closingTimer = undefined }
    this.clearFinalAnswerGrace()
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
