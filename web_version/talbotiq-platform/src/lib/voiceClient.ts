import type { VoicePhase, TimeOfDay } from '@shared/types'
import {
  liveSocketUrl, parseLiveMessage, bytesToBase64,
  type LiveServerMessage,
} from './geminiLive'
import { ApiError, sessionsApi, type VoiceTokenGrant } from './api'
import { isSpeechRecognitionSupported, startSpeechRecognition } from './speechRecognition'

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
// How many times a dropped call may be rescued with a freshly minted grant. Each mint is
// a billable credential and POST /voice/token is rate-limited, so this is deliberately
// small: enough to ride out a tunnel or a wifi handover, not enough to loop.
const MAX_REMINTS = 3
// Waits between mint attempts WITHIN one rescue (~30s of outage tolerance). The first
// attempt fires while the network is usually still down; without these, the rescue only
// ever worked for outages shorter than the reconnect backoff.
const REMINT_RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000]
// Quick recognition deaths (started-to-ended under 3s) before the local captioner gives
// up for the session. Natural silence timeouts do not count.
const MAX_LOCAL_FAILURES = 5
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
  /** Replacement grants minted after a drop that could not be resumed. Bounded by
   *  MAX_REMINTS — each one is a billable credential. */
  private remints = 0

  // Local display-only captioner (Web Speech API). Google's authoritative transcription
  // arrives only around the END of a turn — measured ~2.7s after the candidate stops,
  // and under the old setup 10s+ — so with nothing else on screen a candidate cannot
  // tell they are being heard WHILE speaking. This shows their words as they say them.
  // Display only: nothing from it is POSTed, scored, or sent to Google.
  private localWanted = false
  private localStop?: () => void
  private localLine = ''
  private localRestartTimer?: ReturnType<typeof setTimeout>
  /** Identity of the CURRENT recognition instance. recognition.stop() resolves
   *  asynchronously, so a stopped instance's onend can fire after its replacement is
   *  already running — every callback checks this before touching shared state, or a
   *  stale onend clobbers the live instance's stop handle and two recognizers end up
   *  captioning concurrently (every answer displayed twice). */
  private localGen = 0
  /** Ends with no result since the last successful one. Recognition that keeps dying is
   *  not coming back — stop burning a 4 Hz restart loop for the rest of the interview. */
  private localFailures = 0

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

    // Instant "you are being heard" feedback, in the locale the grant names.
    this.startLocalCaptions()

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
      //
      // A RE-MINTED session is the awkward middle case: brand new to Google, so it needs
      // a kickoff, but not a new interview, so it must not be told to greet. Its locked
      // instruction already carries the RESUME clause and the list of questions on
      // record, so the kickoff only has to hand it the floor.
      // "Continue" only makes sense when there is something on record to continue FROM.
      // The server gates its RESUME clause on the same fact (question turns in the
      // transcript), so the two must agree: a drop during the greeting re-mints a setup
      // with no RESUME clause, and telling that session "do not greet" would contradict
      // its own locked FLOW. Nothing was lost — greet again.
      const continuing = this.remints > 0 && this.asked > 0
      if (!resuming) {
        ws.send(JSON.stringify({ clientContent: {
          turns: [{ role: 'user', parts: [{ text: continuing
            ? 'We are reconnected. Continue the interview from where it left off — do not greet me again and do not repeat a question you have already asked.'
            : 'Begin the interview now: greet me and ask if I am ready to begin.' }] }],
          turnComplete: true,
        } }))
      }
      this.cbs.onPhase?.(continuing ? 'listening' : 'greeting')
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
    const local = this.localLine.trim()
    this.pendingCandidate = ''
    this.pendingInterviewer = ''
    this.localLine = ''  // the local captioner's running line belongs to the closed turn
    // Google's transcription is authoritative for the record; the local line only
    // finalises the DISPLAY when Google produced nothing, so a captioned answer never
    // dangles as a half-open line. It is still never POSTed.
    if (cand) this.cbs.onCaption?.('candidate', cand, true)
    else if (local) this.cbs.onCaption?.('candidate', local, true)
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
    // The token is single-use and connectBy has passed, so without a resumption handle
    // the existing grant cannot open another session. That used to end the interview:
    // covered ⇒ finish, otherwise abandon and make the candidate reopen the link and
    // start over. Losing a part-finished interview to a few seconds of bad wifi is not
    // an acceptable outcome for someone who has already answered four questions.
    //
    // A fresh grant fixes it. POST /voice/token is idempotent for a session already in
    // progress — it only generates questions when there are none — and the setup it
    // mints now carries a RESUME clause built from the transcript, so the replacement
    // session does not greet again or re-ask what is already on record.
    const expired = !this.grant || Date.parse(this.grant.expiresAt) <= Date.now()
    if (expired || !this.resumeHandle) {
      if (this.covered && this.answeredSinceCovered) {
        // Everything was asked AND answered; there is nothing left worth re-minting for.
        // Coverage alone is not enough — `asked` counts questions put, so a drop right
        // after the final question was spoken must still re-mint, or the candidate
        // loses their last answer to the disconnect.
        this.cbs.onReconnecting?.(false)
        this.finishInterview(true, 'disconnected')
        return
      }
      if (this.remints >= MAX_REMINTS) {
        // Bounded: each mint is a billable credential and the route is rate-limited.
        // Past this the connection is not coming back, and a doomed retry loop is worse
        // than a clear ending.
        this.cbs.onReconnecting?.(false)
        if (this.covered) this.finishInterview(true, 'disconnected')
        else this.abandon('disconnected')
        return
      }
      this.remints++
      this.cbs.onReconnecting?.(true)
      this.cbs.onPhase?.('connecting')
      // The old grant is dead, so its cap must not fire mid-rescue: a stale 'expired'
      // during the mint would complete the session server-side and orphan the new grant.
      if (this.capTimer) { clearTimeout(this.capTimer); this.capTimer = undefined }
      const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)]
      this.reconnectAttempts++
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
      this.reconnectTimer = setTimeout(() => void this.remintAndReopen(), delay)
      return
    }
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1)]
    this.reconnectAttempts++
    this.cbs.onReconnecting?.(true)
    this.cbs.onPhase?.('connecting')
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.openWs(), delay)
  }

  /** Mint a replacement grant and reopen. Used when the old one cannot be resumed. */
  private async remintAndReopen(): Promise<void> {
    if (this.closed || this.finished) return
    if (this.covered && this.answeredSinceCovered) {
      // Coverage completed during the backoff — nothing left to mint a credential for.
      this.cbs.onReconnecting?.(false)
      this.finishInterview(true, 'disconnected')
      return
    }

    // The drop cut a turn off mid-stream. Whatever transcript text had already arrived
    // is real speech Google transcribed — salvage it to the record BEFORE minting, so
    // the fresh setup's RESUME clause can count a mostly-delivered question as asked and
    // the replacement session does not re-ask it. Then clear all three buffers: the new
    // session is a new stream, and appending across it would merge the cut-off text into
    // the reconnect apology ("…describe your deploySorry about that—").
    const cutIntv = this.pendingInterviewer.trim()
    const cutCand = this.pendingCandidate.trim()
    this.pendingInterviewer = ''
    this.pendingCandidate = ''
    this.localLine = ''
    if (cutCand) this.cbs.onCaption?.('candidate', cutCand, true)
    if (cutIntv) this.cbs.onCaption?.('interviewer', cutIntv, true)
    this.postChain = this.postChain.then(async () => {
      if (cutCand) await this.postTranscript('candidate', cutCand)
      if (cutIntv && cutIntv.length >= MIN_SALVAGEABLE_CHARS) {
        await this.postTranscript('interviewer', cutIntv)
      }
    }).catch(() => { /* keep the chain alive */ })
    await this.postChain

    // Mint with retries. The first attempt fires ~500ms after the drop — almost always
    // while the network is still down — and a single try would abandon the interview in
    // exactly the outage this rescue exists for. Retry on network errors, 429 and 5xx;
    // give up immediately on any other 4xx (the session is finished or gone server-side,
    // and no amount of waiting changes that).
    let grant: VoiceTokenGrant | undefined
    for (let attempt = 0; attempt <= REMINT_RETRY_DELAYS.length; attempt++) {
      if (this.closed || this.finished) return
      try {
        grant = await sessionsApi.voiceToken(this.sessionId)
        break
      } catch (e) {
        const status = e instanceof ApiError ? e.status : undefined
        const fatal = typeof status === 'number' && status >= 400 && status < 500 && status !== 429
        if (fatal || attempt === REMINT_RETRY_DELAYS.length) break
        await new Promise((r) => setTimeout(r, REMINT_RETRY_DELAYS[attempt]))
      }
    }
    if (this.closed || this.finished) return
    if (!grant) {
      this.cbs.onReconnecting?.(false)
      if (this.covered) this.finishInterview(true, 'disconnected')
      else this.abandon('disconnected')
      return
    }
    this.grant = grant

    // The new grant carries its own lifetime; the old cap was already cleared.
    const msLeft = Date.parse(this.grant.expiresAt) - Date.now()
    if (Number.isFinite(msLeft) && msLeft > 0) {
      if (this.capTimer) clearTimeout(this.capTimer)
      this.capTimer = setTimeout(() => this.finishInterview(this.covered, 'expired'), msLeft)
    }

    // A new session has no resumption handle — the RESUME clause in the freshly minted
    // setup is what carries continuity instead.
    this.resumeHandle = undefined
    this.openWs()
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
    // The local captioner hears the speakers as well as the microphone, so while the
    // interviewer talks it would caption the interviewer's words as "YOU". Suspend it
    // for the duration and resume the moment the audio drains.
    if (p) this.pauseLocalCaptions()
    else this.resumeLocalCaptions()
  }

  /* ── Local display-only captions ─────────────────────────────────────────── */

  private startLocalCaptions(): void {
    if (this.localWanted || !isSpeechRecognitionSupported()) return
    this.localWanted = true
    this.resumeLocalCaptions()
  }

  private resumeLocalCaptions(): void {
    if (!this.localWanted || this.localStop || this.playing || this.muted) return
    if (this.closed || this.finished) return
    if (this.localFailures >= MAX_LOCAL_FAILURES) return
    const lang = this.grant?.language || 'en-US'
    const gen = ++this.localGen
    const startedAt = Date.now()
    this.localStop = startSpeechRecognition(
      lang,
      (result) => {
        if (gen !== this.localGen) return  // a stale instance still winding down
        if (this.playing || this.muted || this.closed || this.finished) return
        const text = result.transcript.trim()
        if (!text) return
        this.localFailures = 0
        if (result.isFinal) this.localLine = `${this.localLine} ${text}`.trim()
        // Interim: show the running line plus what is still forming. Google's own
        // transcription writes the same non-final caption slot when it arrives, so the
        // authoritative text simply replaces this — and the final flush closes the line.
        const shown = result.isFinal ? this.localLine : `${this.localLine} ${text}`.trim()
        this.cbs.onCaption?.('candidate', shown, false)
      },
      () => { /* soft failure (no-speech, network): onEnd below restarts if still wanted */ },
      () => {
        // Chrome ends continuous recognition on its own after silence or a hiccup —
        // but ONLY the current instance's end may release the handle and restart.
        if (gen !== this.localGen) return
        this.localStop = undefined
        // A natural silence timeout takes many seconds and is fine to restart forever;
        // an instance that dies within moments of starting is an error loop. Only the
        // quick deaths count toward giving up.
        if (Date.now() - startedAt < 3_000) this.localFailures++
        if (this.localRestartTimer) clearTimeout(this.localRestartTimer)
        this.localRestartTimer = setTimeout(() => this.resumeLocalCaptions(), 250)
      },
    )
  }

  private pauseLocalCaptions(): void {
    if (this.localRestartTimer) { clearTimeout(this.localRestartTimer); this.localRestartTimer = undefined }
    // Bump the generation FIRST: the instance being stopped will still fire its onend
    // asynchronously, and that stale event must find itself outdated.
    this.localGen++
    this.localStop?.()
    this.localStop = undefined
  }

  private stopLocalCaptions(): void {
    this.localWanted = false
    this.pauseLocalCaptions()
    this.localLine = ''
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
    // The local captioner listens through its own capture path, not the worklet, so it
    // must be gated separately or a muted candidate would still see themselves captioned.
    if (muted) this.pauseLocalCaptions()
    else this.resumeLocalCaptions()
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
    this.stopLocalCaptions()
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
