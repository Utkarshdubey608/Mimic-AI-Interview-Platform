import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import DailyIframe from '@daily-co/daily-js'
import { useConversation, useEndConversation } from '@/hooks/useTavus'
import { useAppStore } from '@/store/useAppStore'
import { useAudioAnalysis } from '@/hooks/useAudioAnalysis'
import { useFacialCapture } from '@/hooks/useFacialCapture'
import { useHumePoll } from '@/hooks/useHumeBatch'
import { humeService } from '@/services/hume'
import { facialDataStore } from '@/services/facialDataStore'
import { cn } from '@/components/ui'

export default function InterviewPage() {
  const navigate = useNavigate()
  // Narrow selectors ONLY — this component owns the live call iframe, and a
  // whole-store subscription re-rendered it on every transcript chunk / metric
  // update (several times per second while the candidate speaks). Actions are
  // read via useAppStore.getState() inside handlers (stable, non-subscribing).
  const conv = useAppStore((s) => s.currentConversation)
  const interviewActive = useAppStore((s) => s.interviewActive)
  const storeQuestions = useAppStore((s) => s.questions)
  const currentQ = useAppStore((s) => s.currentQuestionIdx)
  const transcriptLen = useAppStore((s) => s.sessionTranscript.length)
  // Slow fallback poll — the Daily 'left-meeting' event (below) is the primary
  // end signal; 3s REST polling next to a live WebRTC call was pure contention.
  const { data: liveConv } = useConversation(conv?.conversation_id ?? '', 15000)
  const endConv = useEndConversation()

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [revealedIdx, setRevealedIdx] = useState(-1)   // which question index is currently revealed
  const [avatarSpeaking, setAvatarSpeaking] = useState(false)
  const [autoAdvance] = useState(true)
  const [callJoined, setCallJoined] = useState(false)  // gates the SECOND camera open
  const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Turn tracking — drives auto-advance based on who is speaking
  const avatarTurnsRef = useRef(0)
  const candidateSpokeRef = useRef(false)
  const autoAdvanceRef = useRef(true)
  const lastAvatarTurnTimeRef = useRef(0)
  const localIdRef = useRef<string | undefined>(undefined)
  const avatarPeerIdRef = useRef<string | undefined>(undefined)

  // Unified audio capture — one mic stream: live Deepgram transcription (server
  // relay) + a sealed WebM recording for post-interview voice-emotion analysis.
  const { dgConnected, sealAndGetBlob } = useAudioAnalysis(interviewActive)
  // Optional facial analysis (AWS Rekognition) — separate video-only capture, additive
  const facialCapture = useFacialCapture()
  // ResultsPage polls for completion; keep the hook here too so it fires if user navigates back
  useHumePoll()

  const questions = storeQuestions.filter(Boolean)

  useEffect(() => { autoAdvanceRef.current = autoAdvance }, [autoAdvance])

  // Track when each question starts for per-question emotion analysis. Guarded so
  // a page remount mid-interview doesn't push a duplicate timestamp for the same
  // question (which would shift every later per-question emotion window).
  useEffect(() => {
    if (interviewActive && useAppStore.getState().questionTimestamps.length <= currentQ) {
      useAppStore.getState().pushQuestionTimestamp(Date.now())
    }
  }, [currentQ]) // eslint-disable-line react-hooks/exhaustive-deps

  // Optional facial capture: start once the interview is active AND the Daily
  // call has actually joined (SEQUENCED camera acquisition — opening our second
  // 640x480 camera while the prebuilt iframe is still acquiring its own device
  // races exclusive-access webcams and steals bandwidth from the join). Demo
  // mode (no conversation URL) starts immediately; a live call that never
  // reports 'joined-meeting' (wrap unavailable) falls back after 15s.
  useEffect(() => {
    if (!interviewActive || callJoined || !conv?.conversation_url) return
    const t = setTimeout(() => setCallJoined(true), 15_000)
    return () => clearTimeout(t)
  }, [interviewActive, callJoined, conv?.conversation_url])
  useEffect(() => {
    const ready = interviewActive && (callJoined || !conv?.conversation_url)
    if (ready) {
      // Fresh session — never let a previous candidate's frames leak into this report.
      facialDataStore.clear()
      facialCapture.startCapture()
      return () => { facialCapture.stopCapture() }
    }
    return undefined
  }, [interviewActive, callJoined]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the facial capture's "current question" in sync for per-question aggregation
  useEffect(() => {
    facialCapture.updateQuestion(currentQ)
  }, [currentQ]) // eslint-disable-line react-hooks/exhaustive-deps

  // After any question change (manual or auto), wait for the candidate to answer
  // again before the next avatar turn is treated as "move to next question".
  useEffect(() => { candidateSpokeRef.current = false }, [currentQ])

  // Mark a speaking turn for the current question (reveals it + flags the pulse)
  function markAvatarSpeaking() {
    setAvatarSpeaking(true)
    setRevealedIdx(useAppStore.getState().currentQuestionIdx)
    if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current)
    speakingTimeoutRef.current = setTimeout(() => setAvatarSpeaking(false), 3000)
  }

  // Avatar moved on to the next question → advance the index and reveal it
  function advanceToNext() {
    const s = useAppStore.getState()
    const total = s.questions.filter(Boolean).length
    const next = s.currentQuestionIdx + 1
    if (next >= total) return                 // stay on the last question; don't auto-end
    s.setCurrentQuestionIdx(next)
    setRevealedIdx(next)
    setAvatarSpeaking(true)
    if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current)
    speakingTimeoutRef.current = setTimeout(() => setAvatarSpeaking(false), 3000)
  }

  // Wrap the Tavus (Daily.co) iframe and follow the turn-taking conversation.
  // Tavus runs on Daily.co prebuilt, so the embedded call exposes active-speaker-change.
  // Pattern: avatar asks Q → candidate answers → avatar asks next Q (auto-advance).
  useEffect(() => {
    if (!conv?.conversation_url) return
    const iframe = iframeRef.current
    if (!iframe) return

    let call: any = null

    const handleAvatarTurn = () => {
      const now = Date.now()
      // Advance ONLY when the candidate actually spoke since the last question.
      // (The old "gap > 5000" clause double-fired after the 90s fallback timer:
      // timer advanced once, then the avatar's next utterance advanced again —
      // permanently desyncing the index from the avatar. Silent candidates are
      // handled by the 90s fallback timer alone.)
      const shouldAdvance = avatarTurnsRef.current > 0 && autoAdvanceRef.current &&
        candidateSpokeRef.current
      if (shouldAdvance) {
        candidateSpokeRef.current = false
        advanceToNext()
      } else {
        markAvatarSpeaking()
      }
      lastAvatarTurnTimeRef.current = now
      avatarTurnsRef.current += 1
    }

    const onActiveSpeaker = (ev: any) => {
      const peerId = ev?.activeSpeaker?.peerId
      if (!peerId) return
      // Cache local + avatar IDs on first opportunity
      if (!localIdRef.current) {
        try { localIdRef.current = call?.participants?.()?.local?.session_id } catch {}
      }
      // Accurate avatar identification: use tracked avatar peer ID when available
      let isAvatar: boolean
      if (avatarPeerIdRef.current) {
        isAvatar = peerId === avatarPeerIdRef.current
      } else {
        isAvatar = peerId !== 'local' && (!localIdRef.current || peerId !== localIdRef.current)
      }
      if (isAvatar) handleAvatarTurn()
      else candidateSpokeRef.current = true
    }

    const onAppMessage = (ev: any) => {
      const d = ev?.data ?? {}
      const t = String(d.event_type ?? d.message_type ?? d.type ?? '')
      if (/replica|agent|assistant/i.test(t) && /speak|utter|start/i.test(t)) handleAvatarTurn()
      else if (/user|candidate|listening/i.test(t)) candidateSpokeRef.current = true
    }

    let cleanup = () => {}
    const timer = setTimeout(() => {
      try {
        call = (DailyIframe as any).getCallInstance?.() ?? null
        if (!call) call = DailyIframe.wrap(iframe)
        call.on('joined-meeting', (ev: any) => {
          // Call is up → NOW the secondary (Rekognition) camera may open.
          setCallJoined(true)
          localIdRef.current = ev?.participants?.local?.session_id ??
            call?.participants?.()?.local?.session_id
          // Identify avatar from any remote participants already in the room
          const parts = ev?.participants ?? {}
          for (const key of Object.keys(parts)) {
            if (key !== 'local' && !parts[key]?.local) {
              avatarPeerIdRef.current = parts[key]?.session_id ?? key
              break
            }
          }
        })
        // PRIMARY end signal: the room closed (avatar wrapped up / user left via
        // the prebuilt UI). Instant — replaces waiting up to 15s for the poll.
        const onLeft = () => { void handleConversationEnded() }
        call.on('left-meeting', onLeft)
        call.on('participant-joined', (ev: any) => {
          // First remote participant to join is the avatar
          if (!ev?.participant?.local && !avatarPeerIdRef.current) {
            avatarPeerIdRef.current = ev?.participant?.session_id
          }
        })
        call.on('active-speaker-change', onActiveSpeaker)
        call.on('app-message', onAppMessage)
        cleanup = () => {
          try {
            call.off('left-meeting', onLeft)
            call.off('active-speaker-change', onActiveSpeaker)
            call.off('app-message', onAppMessage)
          } catch {}
        }
      } catch (e) {
        console.warn('[interview] Daily wrap unavailable — using fallback reveal timer', e)
      }
    }, 1500)

    return () => { clearTimeout(timer); cleanup() }
  }, [conv?.conversation_url])

  // Safety net: never leave a question stuck on "waiting". If no speaking event
  // arrives, reveal after a delay (live: 9s gives the avatar time to greet+ask; demo: 4s).
  useEffect(() => {
    if (!interviewActive) return
    if (revealedIdx === currentQ) return
    const delay = conv?.conversation_url ? 9000 : 4000
    const t = setTimeout(() => setRevealedIdx(currentQ), delay)
    return () => clearTimeout(t)
  }, [currentQ, revealedIdx, conv?.conversation_url, interviewActive])

  // Timer-based auto-advance fallback: only for a SILENT stall. The timer restarts
  // on every committed transcript utterance (sessionTranscript.length dep), so it
  // can never fire mid-answer — the old fixed 90s window advanced during any long
  // answer and then the avatar's own next turn advanced AGAIN, desyncing the
  // index, question timestamps, and transcript attribution.
  useEffect(() => {
    if (!interviewActive || !autoAdvance || revealedIdx !== currentQ) return
    const t = setTimeout(() => {
      if (!autoAdvanceRef.current) return
      const s = useAppStore.getState()
      const next = s.currentQuestionIdx + 1
      if (next < s.questions.filter(Boolean).length) {
        s.setCurrentQuestionIdx(next)
        setRevealedIdx(next)
      }
    }, 90_000)
    return () => clearTimeout(t)
  }, [currentQ, revealedIdx, interviewActive, autoAdvance, transcriptLen])

  // NOTE: the old "jitter simulation" (random confidence/wpm/filler metrics) was
  // deliberately removed — it overwrote REAL Deepgram-derived metrics with fake
  // numbers. Metrics now come only from actual speech (useAudioAnalysis).

  // Seal the mic recording and submit it for voice-emotion analysis — used by BOTH
  // end paths (End button + natural conversation end). The server tries Hume's
  // batch API first and falls back to Gemini audio prosody analysis; either way
  // the Results page polls the same job. Idempotent per session.
  const voiceSubmittedRef = useRef(false)
  async function submitVoiceAnalysis() {
    if (voiceSubmittedRef.current) return
    voiceSubmittedRef.current = true
    try {
      const blob = await sealAndGetBlob()
      if (blob && blob.size > 20_000) {
        const jobId = await humeService.submitBatchJob(blob)
        useAppStore.getState().setHumeJobId(jobId)
        useAppStore.getState().setHumeJobStatus('QUEUED')
        toast.success('Interview audio submitted for voice analysis', { duration: 2500 })
      }
    } catch (err) {
      console.warn('[interview] voice-analysis submit failed:', err)
      useAppStore.getState().setHumeJobStatus('FAILED')
    }
  }

  // Shared, idempotent natural-end sequence — fired INSTANTLY by the Daily
  // 'left-meeting' event and (fallback) by the slow status poll below.
  const endHandledRef = useRef(false)
  async function handleConversationEnded() {
    if (endHandledRef.current) return
    if (!useAppStore.getState().interviewActive) return
    endHandledRef.current = true
    toast.success('Interview ended — generating scorecard')
    await submitVoiceAnalysis()
    useAppStore.getState().setInterviewActive(false)
    setTimeout(() => navigate('/results'), 800)
  }

  // Fallback: detect conversation ended via the (slow) poll — e.g. the wrap was
  // unavailable so no left-meeting event ever fires.
  useEffect(() => {
    if (liveConv?.status === 'ended' && interviewActive) void handleConversationEnded()
  }, [liveConv?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect if no conversation
  useEffect(() => {
    if (!conv) { toast('No active interview — go to Setup'); navigate('/setup') }
  }, [])

  async function handleEndInterview() {
    if (!confirm('End the interview now?')) return

    endHandledRef.current = true // manual end owns the sequence from here
    await submitVoiceAnalysis()
    useAppStore.getState().setInterviewActive(false)

    if (conv) {
      endConv.mutate(conv.conversation_id, {
        onSuccess: () => navigate('/results'),
        onError:   () => navigate('/results'),
      })
    } else {
      navigate('/results')
    }
  }

  function enterFs() { panelRef.current?.classList.add('fs-active') as any; setIsFullscreen(true) }
  function exitFs() { panelRef.current?.classList.remove('fs-active') as any; setIsFullscreen(false) }
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') exitFs() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [])

  if (!conv) return null

  return (
    <div className="flex h-[calc(100vh-100px)]">
      {/* Avatar / video panel */}
      <div ref={panelRef} className={cn('relative flex-1 bg-brand-black flex flex-col items-center justify-center overflow-hidden', isFullscreen && 'fixed inset-0 z-[9999]')}>
        {/* Exit fullscreen button — SOLID white chip so it never blends into the
            live video underneath (the old bg-white/10 ghost was invisible over
            bright frames). */}
        {isFullscreen && (
          <button onClick={exitFs} className="fixed top-4 right-4 z-[10000] flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-brand-black text-sm font-semibold shadow-xl hover:bg-neutral-100 transition-colors duration-150">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
            Exit Full Screen
          </button>
        )}

        {/* Progress bar — violet→magenta fill over the questions asked so far */}
        <div
          className="absolute top-0 left-0 right-0 h-[3px] bg-white/10 z-10"
          role="progressbar"
          aria-label="Interview progress"
          aria-valuemin={0}
          aria-valuemax={questions.length || 1}
          aria-valuenow={Math.min(currentQ + 1, questions.length)}
        >
          <div className="h-full bg-brand-field transition-all duration-500" style={{ width: `${((currentQ + 1) / Math.max(questions.length, 1)) * 100}%` }} />
        </div>

        {/* Full Screen button — SOLID white chip on the dark stage; a tinted fill
            reads as part of the brand-black panel and disappears.
            Hidden while fullscreen: the fixed Exit chip above replaces it. */}
        {!isFullscreen && (
          <button onClick={enterFs} className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-4 py-2 bg-white rounded-full text-brand-black text-xs font-semibold shadow-lg hover:bg-neutral-100 transition-colors duration-150">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
            Full Screen
          </button>
        )}

        {/* Tavus iframe or placeholder */}
        <div className={cn('overflow-hidden shadow-xl transition-all', isFullscreen ? 'fixed inset-0 rounded-none border-none bottom-[88px]' : 'w-[90%] max-w-[960px] h-[calc(100vh-320px)] min-h-[400px] mb-0 rounded-3xl border border-brand-border')}>
          {conv.conversation_url ? (
            <iframe
              ref={iframeRef}
              src={conv.conversation_url}
              width="100%" height="100%"
              style={{ border: 'none' }}
              allow="camera;microphone;autoplay;display-capture;fullscreen"
              allowFullScreen
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-brand-card to-brand-black">
              <div className="w-20 h-20 rounded-full bg-brand-field flex items-center justify-center border-2 border-white/15 shadow-lg animate-pulse-soft">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <div className="text-center px-8">
                <p className="font-display font-extrabold tracking-[-0.03em] text-white text-lg">Demo mode</p>
                <p className="text-sm text-brand-gray mt-1.5 max-w-xs leading-relaxed">
                  The live avatar appears here once a Tavus conversation is connected. Transcription and analysis still run.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Candidate control strip — no question text, no recruiter controls. The
            avatar speaks each question; only status + End Interview are shown. */}
        <div className={cn('w-full flex items-center justify-between gap-4 px-8 z-10 bg-brand-card border-t border-brand-border', isFullscreen ? 'fixed bottom-0 left-0 right-0 h-[76px]' : 'h-[76px] flex-shrink-0')}>
          <div className="flex items-center gap-4 min-w-0">
            {/* Turn status — mint while the candidate has the floor, soft violet
                while the interviewer is speaking. */}
            <span className="flex items-center gap-2.5 text-sm font-semibold text-white" role="status" aria-live="polite">
              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse-live', avatarSpeaking ? 'bg-brand-gold' : 'bg-mint')} />
              {avatarSpeaking ? 'Interviewer is speaking' : 'Listening — please answer'}
            </span>
            <span className="hidden sm:block w-px h-5 bg-brand-border flex-shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline text-xs font-medium text-brand-gray whitespace-nowrap">
              Question <span className="text-white font-semibold tabular-nums">{Math.min(currentQ + 1, questions.length)}</span> of <span className="tabular-nums">{questions.length}</span>
            </span>
            {dgConnected && (
              <>
                <span className="hidden md:block w-px h-5 bg-brand-border flex-shrink-0" aria-hidden="true" />
                <span className="hidden md:flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-green-light whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-green-light flex-shrink-0" />
                  Transcribing
                </span>
              </>
            )}
          </div>
          <button onClick={handleEndInterview}
            className="flex items-center gap-2 px-5 h-11 rounded-full bg-danger text-white text-sm font-semibold shadow-lg shadow-danger/25 hover:bg-red-700 transition-colors duration-150 flex-shrink-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            End Interview
          </button>
        </div>
      </div>

      {/* Candidate view: recruiter panels (question list / Live AI / transcript)
          are intentionally NOT shown to the candidate. Transcript + facial +
          emotion capture still run in the background and surface on the recruiter
          Results page. */}
    </div>
  )
}
