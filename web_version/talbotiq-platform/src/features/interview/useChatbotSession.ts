import { useCallback, useEffect, useRef, useState } from 'react'
import { chatbotApi, ApiError } from '@/lib/api'
import type { ChatbotSessionState, TimeOfDay } from '@shared/types'

/**
 * There is no minimum thinking time any more.
 *
 * A `MIN_THINKING_MS = 3000` floor used to hold every interviewer message back
 * so the model would seem considered: a reply that arrived in 400ms sat behind
 * the indicator for another 2.6 seconds. It was defended as "a floor, not a
 * delay stacked on latency", which is true and beside the point — the interface
 * was still misreporting how long the interviewer took, to a candidate who is
 * being assessed and has no way to know.
 *
 * AgentStatus now reports the real state instead, so a fast answer feels fast.
 */

/** Candidate's local part-of-day, for a time-aware opening greeting (§3). */
const localTimeOfDay = (): TimeOfDay => {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
}

/**
 * Drives the conversational chatbot interview. Turns advance on submit; in
 * TIMED mode the server is authoritative for thinking/answer windows and we
 * poll + interpolate a local countdown, re-syncing at each boundary.
 *
 * Every interviewer message is held behind a ≥3s "Thinking…" indicator before
 * it is revealed. In TIMED mode the server's clock is armed only once we reveal
 * (via chatbotApi.reveal), so the indicator never counts against a timer.
 */
export function useChatbotSession(sessionId: string) {
  const [state, setState] = useState<ChatbotSessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)   // a begin/answer request is in flight or being revealed
  const [thinking, setThinking] = useState(false) // the "Thinking…" indicator is visible
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null) // optimistic candidate bubble

  const base = useRef<{ remaining: number; at: number } | null>(null)
  const phaseRef = useRef<ChatbotSessionState['phase']>(null) // latest phase, for the countdown tick
  const [remaining, setRemaining] = useState(0)
  const started = useRef(false)
  const revealed = useRef<Set<string>>(new Set()) // interviewer turn ids already revealed
  const busyRef = useRef(false)                    // true while a turn is mid-reveal (guards the poll)
  const [, setRevealVersion] = useState(0)         // bump to re-render when `revealed` (a ref) changes
  const bump = useCallback(() => setRevealVersion((v) => v + 1), [])

  const apply = useCallback((s: ChatbotSessionState) => {
    setState(s)
    setError(null)
    setLoading(false)
    if (s.status === 'in_progress' && s.phase) {
      base.current = { remaining: s.remainingSeconds, at: performance.now() }
      setRemaining(s.remainingSeconds)
      phaseRef.current = s.phase
    } else {
      base.current = null
      setRemaining(0)
      phaseRef.current = null
    }
  }, [])

  const load = useCallback(async () => {
    if (busyRef.current) return // don't clobber a turn mid-reveal
    try {
      let s = await chatbotApi.state(sessionId)
      // A plain refresh/poll shows the whole transcript immediately (no replay):
      // treat every interviewer turn already in the state as revealed.
      s.transcript.forEach((t) => { if (t.role === 'interviewer') revealed.current.add(t.id) })
      apply(s)
      // Arm the clock for a TIMED question that arrived via poll / auto-advance /
      // refresh but hasn't been presented yet (phase still null). Without this the
      // countdown only ever started for the FIRST question; every later question
      // (reached after an auto-submit) never got its timer armed.
      if (s.status === 'in_progress' && s.timing.enabled && s.currentTurnTimed && s.phase === null && s.currentTurnId) {
        try { s = await chatbotApi.questionPresented(sessionId); apply(s) } catch { /* keep polled state */ }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the interview')
      setLoading(false)
    }
  }, [sessionId, apply])

  /**
   * Run a begin/answer request and reveal the resulting interviewer turn(s).
   *
   * The server may append MORE than one interviewer turn per answer — a positive
   * acknowledgment bubble, then the next question bubble. In `progressive` mode
   * (an answer submit) we reveal each new interviewer turn one at a time, each
   * behind its own ≥3s "Thinking…" beat, so the candidate sees:
   *   thinking → motivation box → thinking → next question.
   * `optimistic` (if given) is shown as the candidate's bubble immediately so
   * their answer doesn't vanish while the interviewer "thinks".
   *
   * Non-progressive (begin / refresh) shows any existing history at once and
   * reveals only the awaiting turn behind a single floor — no replay of history.
   */
  const revealTurn = useCallback(
    async (
      run: () => Promise<ChatbotSessionState>,
      opts: { optimistic?: string; progressive?: boolean } = {},
    ) => {
      const { optimistic, progressive = false } = opts
      busyRef.current = true
      setSending(true)
      setThinking(true)
      if (optimistic != null) setPendingAnswer(optimistic)

      let s: ChatbotSessionState
      try {
        s = await run()
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Something went wrong')
        setSending(false)
        setThinking(false)
        setPendingAnswer(null)
        busyRef.current = false
        load()
        return
      }

      // Arm the server clock only once a timed question is actually presented.
      const present = async (st: ChatbotSessionState) => {
        if (st.timing.enabled && st.currentTurnTimed && st.phase === null && st.currentTurnId) {
          try { return await chatbotApi.questionPresented(sessionId) } catch { return st }
        }
        return st
      }

      // Interview finished (e.g. the final answer): reveal everything and let the
      // completion screen take over — no per-turn replay.
      if (s.finished) {
        s.transcript.forEach((t) => revealed.current.add(t.id))
        setPendingAnswer(null); setThinking(false); setSending(false)
        busyRef.current = false
        apply(s); bump()
        return
      }

      const newInterviewer = s.transcript.filter(
        (t) => t.role === 'interviewer' && !revealed.current.has(t.id),
      )

      if (!progressive) {
        // begin / refresh: existing history appears at once; reveal only the
        // awaiting turn behind the ≥3s floor (the original single-turn feel).
        newInterviewer.forEach((t) => { if (t.id !== s.currentTurnId) revealed.current.add(t.id) })
        setPendingAnswer(null); apply(s); bump()
        const awaiting = newInterviewer.find((t) => t.id === s.currentTurnId)
        if (awaiting) {
          s = await present(s)
          revealed.current.add(awaiting.id)
        } else {
          newInterviewer.forEach((t) => revealed.current.add(t.id))
        }
        setThinking(false); setSending(false)
        busyRef.current = false
        apply(s); bump()
        return
      }

      // progressive (answer submit): show the real candidate bubble now (drop the
      // optimistic one), then reveal each new interviewer turn behind its own floor.
      setPendingAnswer(null); apply(s); bump()
      for (let i = 0; i < newInterviewer.length; i++) {
        const turn = newInterviewer[i]
        setThinking(true)
        if (turn.id === s.currentTurnId) s = await present(s)
        revealed.current.add(turn.id)
        setThinking(false)
        apply(s); bump()
      }
      setSending(false)
      busyRef.current = false
    },
    [sessionId, apply, load, bump],
  )

  // Begin the conversation once (idempotent server-side), then reveal turn 1.
  useEffect(() => {
    if (started.current) return
    started.current = true
    revealTurn(() => chatbotApi.begin(sessionId, { timeOfDay: localTimeOfDay() }))
  }, [sessionId, revealTurn])

  // Timer enabled: periodic drift-correcting poll.
  useEffect(() => {
    if (!state?.timing.enabled) return
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [state?.timing.enabled, load])

  // Timer enabled: local 200ms countdown; re-sync at the boundary (server advances).
  useEffect(() => {
    if (!state?.timing.enabled) return
    const id = setInterval(() => {
      const b = base.current
      if (!b) return
      const rem = Math.max(0, b.remaining - (performance.now() - b.at) / 1000)
      setRemaining(rem)
      if (rem <= 0) {
        base.current = null
        // Thinking sub-timer expiry → let the server flip to the answer phase.
        // Answer expiry is handled by the composer auto-submitting the CURRENT
        // typed text (see ChatbotStage); the 5s poll stays as a server backstop.
        if (phaseRef.current === 'thinking') load()
      }
    }, 200)
    return () => clearInterval(id)
  }, [state?.timing.enabled, load])

  const send = (text: string) => {
    const turnId = state?.currentTurnId
    if (!turnId) return Promise.resolve()
    return revealTurn(
      () => chatbotApi.answer(sessionId, { turnId, answerText: text }),
      { optimistic: text, progressive: true },
    )
  }

  // Ending thinking early is a candidate action, not an interviewer message — no floor.
  const skipThinking = async () => {
    setSending(true)
    try {
      apply(await chatbotApi.skipThinking(sessionId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong')
      load()
    } finally {
      setSending(false)
    }
  }

  const saveDraft = useCallback(
    async (draft: string) => {
      const turnId = state?.currentTurnId
      if (!turnId) return
      try {
        await chatbotApi.saveDraft(sessionId, { turnId, draft })
      } catch {
        /* best-effort */
      }
    },
    [sessionId, state?.currentTurnId],
  )

  // Only turns that have been revealed are shown; not-yet-revealed interviewer
  // turns (an acknowledgment or the next question mid-reveal) stay hidden until
  // their "Thinking…" beat completes. Candidate turns are always visible.
  const visibleTranscript = (state?.transcript ?? []).filter(
    (t) => t.role !== 'interviewer' || revealed.current.has(t.id),
  )

  return {
    state,
    visibleTranscript,
    loading,
    error,
    sending,
    thinking,
    pendingAnswer,
    remaining,
    secondsLeft: Math.ceil(remaining),
    send,
    skipThinking,
    saveDraft,
    refresh: load,
  }
}
