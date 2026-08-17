import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import DailyIframe from '@daily-co/daily-js'
import { Loader2, AlertTriangle, CheckCircle2, PhoneOff, UserRound, RefreshCw } from 'lucide-react'
import type { BrandingConfig } from '@shared/types'
import { localTimeOfDay } from '@shared/speech'
import { sessionsApi } from '@/lib/api'
import { startCallStats, type CallStatsHandle } from '@/lib/callStats'
import { FaceFitCheck } from '@/features/avatar-screening/facefit/FaceFitCheck'

interface Props {
  sessionId: string
  branding: BrandingConfig
  onIntegrity?: (type: string) => void
  /** Run the on-device face-framing pre-flight before showing the room.
   *  While the candidate frames their face, avatar/start (question generation +
   *  Tavus conversation create) runs in PARALLEL below, so the room is
   *  typically ready the moment they lock in — instead of them staring at
   *  "Connecting your interviewer…" for those seconds. */
  preflight?: boolean
}

type Stage = 'connecting' | 'live' | 'ending' | 'ended' | 'error'

/**
 * Video-avatar interview — STRICTLY the same experience as the recruiter's
 * "Launch Session" room (src/pages/InterviewPage.tsx): the Tavus-hosted
 * conversation page loads in a plain full-bleed iframe (its own join flow,
 * device controls, and fullscreen), created SERVER-side from the recruiter's
 * applied Setup config + this session's questions + the candidate's name.
 *
 * Like InterviewPage, we additionally WRAP the existing iframe with daily-js
 * (never creating our own UI) purely to listen for utterance app-messages —
 * both sides' speech streams to the server, bucketed per question, so the
 * conversational scoring and the recruiter report work unchanged. If the wrap
 * isn't available the call still works; transcripts are best-effort.
 */
export function AvatarStage({ sessionId, branding, preflight = false }: Props) {
  const reduce = useReducedMotion()
  const accent = branding.accentColor || '#F2F3F5'

  const [stage, setStage] = useState<Stage>('connecting')
  // Face-fit gate (first entry only — mount-time value; later prop changes are
  // intentionally ignored so a status poll can't yank the screen away mid-scan).
  const [framed, setFramed] = useState(!preflight)
  const [conversationUrl, setConversationUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ asked: number; total: number }>({ asked: 0, total: 0 })
  const [attempt, setAttempt] = useState(0) // bump to retry after an error

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const callRef = useRef<any>(null)
  const leavingRef = useRef(false) // we initiated the end (End button)
  const lastSentRef = useRef<{ role: string; text: string }>({ role: '', text: '' })

  /** Forward one utterance to the server (per-question bucketing happens there). */
  const sendUtterance = useCallback((role: 'interviewer' | 'candidate', text: string) => {
    const t = text.trim()
    if (!t) return
    if (lastSentRef.current.role === role && lastSentRef.current.text === t) return // partial/final duplicate
    lastSentRef.current = { role, text: t }
    sessionsApi.avatarTranscript(sessionId, { role, text: t })
      .then((r) => {
        const rr = r as { ok: boolean; asked?: number; total?: number }
        if (typeof rr.asked === 'number' && typeof rr.total === 'number') {
          // Only re-render the header when the counter actually moved — partial
          // utterances echo the same asked/total many times per turn.
          setProgress((p) => (p.asked === rr.asked && p.total === rr.total ? p : { asked: rr.asked!, total: rr.total! }))
        }
      })
      .catch(() => { /* transcript is best-effort — never interrupt the call */ })
  }, [sessionId])

  const finish = useCallback(async () => {
    if (leavingRef.current) return
    leavingRef.current = true
    setStage('ending')
    try { callRef.current?.leave?.() } catch { /* best-effort */ }
    try { await sessionsApi.avatarComplete(sessionId) } catch { /* server completes on its own timers as fallback */ }
    setStage('ended')
  }, [sessionId])

  // 1) Ask the server to create the Tavus conversation (applied Setup config +
  //    this session's questions + candidate name) and load its URL.
  useEffect(() => {
    let cancelled = false
    setStage('connecting')
    setError(null)
    setConversationUrl(null)
    ;(async () => {
      try {
        const { conversationUrl: url, totalQuestions } = await sessionsApi.avatarStart(sessionId, localTimeOfDay())
        if (cancelled) return
        setProgress({ asked: 0, total: totalQuestions })
        setConversationUrl(url)
        setStage('live')
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Could not start your interview')
        setStage('error')
      }
    })()
    return () => { cancelled = true }
  }, [sessionId, attempt])

  // 2) Wrap the (already rendering) Tavus iframe for transcript events — the
  //    exact pattern InterviewPage uses. Never replaces the room UI.
  //    `framed` is a dep: during the face-fit pre-flight the iframe isn't
  //    mounted yet, so the wrap must (re)run once the room actually renders.
  useEffect(() => {
    if (!conversationUrl || !framed) return
    const iframe = iframeRef.current
    if (!iframe) return

    let cleanup = () => {}
    let stats: CallStatsHandle | null = null
    const timer = setTimeout(() => {
      try {
        let call: any = (DailyIframe as any).getCallInstance?.() ?? null
        if (!call) call = DailyIframe.wrap(iframe)
        callRef.current = call
        // Dev-only (`?callstats=1`): transport health + turn-gap timing.
        stats = startCallStats(call, 'avatar')

        // Tavus emits utterances as app-messages; shapes vary → match defensively.
        const onAppMessage = (ev: any) => {
          const d = (ev?.data ?? {}) as Record<string, unknown>
          const et = String(d.event_type ?? d.type ?? '')
          if (!/transcription|utterance/i.test(et)) return
          const p = (d.properties ?? d) as Record<string, unknown>
          const role = String(p.role ?? p.speaker ?? '')
          const text = (p.text ?? p.speech ?? p.transcript ?? p.utterance) as string | undefined
          if (!text) return
          if (/replica|assistant|agent|interviewer/i.test(role)) {
            stats?.markUtterance('interviewer')
            sendUtterance('interviewer', String(text))
          } else if (!role || /user|participant|candidate/i.test(role)) {
            stats?.markUtterance('candidate')
            sendUtterance('candidate', String(text))
          }
        }
        // The avatar wrapped up / the room ended / the candidate left via the
        // room's own controls → complete + score.
        const onLeft = () => { if (!leavingRef.current) void finish() }

        call.on('app-message', onAppMessage)
        call.on('left-meeting', onLeft)
        cleanup = () => {
          try {
            call.off('app-message', onAppMessage)
            call.off('left-meeting', onLeft)
          } catch { /* noop */ }
        }
      } catch (e) {
        console.warn('[avatar] Daily wrap unavailable — interview continues without live transcript', e)
      }
    }, 1500)

    return () => { clearTimeout(timer); stats?.stop(); cleanup(); callRef.current = null }
  }, [conversationUrl, framed, sendUtterance, finish])

  /* ── finished ── */
  if (stage === 'ended') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="w-full max-w-md rounded-3xl border border-border bg-white p-10 text-center shadow-lg"
        >
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: `${accent}14`, color: accent }}>
            <CheckCircle2 size={30} />
          </div>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">All done, thank you!</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-neutral-500">
            Your interview with {branding.companyName} is complete. You can close this window.
          </p>
        </motion.div>
      </div>
    )
  }

  /* ── error (couldn't start) ── */
  if (stage === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-md rounded-3xl border border-border bg-white p-10 text-center shadow-lg">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-danger-border bg-danger-bg text-danger">
            <AlertTriangle size={28} />
          </span>
          <h1 className="mt-5 font-display text-xl font-extrabold tracking-[-0.03em] text-neutral-900">
            We couldn’t start your interview
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-neutral-500">{error}</p>
          <button
            onClick={() => { setError(null); setAttempt((a) => a + 1) }}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-md px-6 text-sm font-semibold text-white shadow-md transition-all duration-150 hover:-translate-y-px hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
            style={{ background: accent }}
          >
            <RefreshCw size={15} /> Try again
          </button>
          <p className="mt-4 text-xs text-neutral-400">If this keeps happening, contact your recruiter.</p>
        </div>
      </div>
    )
  }

  /* ── face-framing pre-flight — the Tavus conversation is being created in
        the background (effect 1) while the candidate lines up their face, so
        locking in usually lands straight in a ready room. FaceFitCheck releases
        the camera (plus a buffer) before onReady, so the room's own device
        acquisition never races it. ── */
  if (!framed) {
    return <FaceFitCheck onReady={() => setFramed(true)} accentColor={accent} />
  }

  const asked = Math.min(progress.asked, progress.total)

  /* ── the live room — full-viewport, no page scroll, Tavus UI untouched ── */
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-brand-black">
      <header className="flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-brand-card px-4">
        <span className="flex min-w-0 items-center gap-2.5 font-display font-bold tracking-[-0.02em] text-white">
          <span className="truncate">{branding.companyName}</span>
          {stage === 'live' && (
            <span className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-brand-border bg-white/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-green-light">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-green-light" /> Live
            </span>
          )}
        </span>

        <div className="flex flex-shrink-0 items-center gap-3">
          {progress.total > 0 && progress.asked > 0 && (
            <span
              className="hidden items-center gap-2.5 rounded-md border border-brand-border bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-brand-gold-light sm:inline-flex"
              aria-live="polite"
            >
              <span className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
                <span
                  className="block h-full rounded-full bg-brand-gold transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.round((asked / progress.total) * 100)}%` }}
                />
              </span>
              <span className="tabular-nums">Question {asked} of {progress.total}</span>
            </span>
          )}
          <button
            onClick={() => { if (window.confirm('End the interview now? You can’t rejoin afterwards.')) void finish() }}
            disabled={stage === 'ending'}
            className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/15 px-4 py-1.5 text-sm font-semibold text-red-300 transition-colors duration-150 hover:bg-danger/25 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-card"
          >
            {stage === 'ending' ? <Loader2 size={15} className="animate-spin" /> : <PhoneOff size={15} />}
            End interview
          </button>
        </div>
      </header>

      <div className="relative flex-1">
        {conversationUrl ? (
          // EXACTLY the InterviewPage embed: the Tavus-hosted room, full-bleed,
          // with its own join screen, device controls, and fullscreen.
          <iframe
            ref={iframeRef}
            src={conversationUrl}
            className="absolute inset-0 h-full w-full border-0"
            allow="camera;microphone;autoplay;display-capture;fullscreen"
            allowFullScreen
            title="AI Interviewer"
          />
        ) : (
          // The room's frame, held open while Tavus spins it up.
          <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
            <div className="flex h-full w-full max-w-4xl flex-col items-center justify-center gap-6 rounded-3xl border border-brand-border bg-brand-card/60 px-6 text-center">
              <div className="relative flex h-28 w-28 items-center justify-center">
                {!reduce && [0, 1].map((i) => (
                  <motion.span
                    key={i}
                    className="absolute h-24 w-24 rounded-full"
                    style={{ background: `${accent}2E` }}
                    animate={{ scale: [1, 1.7], opacity: [0.5, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, delay: i * 1.1, ease: 'easeOut' }}
                  />
                ))}
                <span className="relative flex h-20 w-20 items-center justify-center rounded-full border border-brand-border bg-brand-card text-brand-gold">
                  <UserRound size={32} />
                </span>
              </div>

              <div className="flex flex-col items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-md border border-brand-border bg-white/5 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-gold-light">
                  <Loader2 size={11} className="animate-spin" />
                  {stage === 'ending' ? 'Finishing' : 'Preparing'}
                </span>
                <p className="font-display text-lg font-bold tracking-[-0.02em] text-white" aria-live="polite">
                  {stage === 'ending' ? 'Wrapping up your interview' : 'Connecting your interviewer'}
                </p>
                <p className="max-w-sm text-sm leading-relaxed text-brand-gray">
                  {stage === 'ending'
                    ? 'Saving your session — this only takes a moment.'
                    : 'Setting up the room and your questions. This usually takes just a few seconds.'}
                </p>
              </div>

              <div className="flex w-full max-w-[220px] flex-col items-center gap-2">
                <span className="h-1.5 w-full animate-pulse rounded-full bg-white/10" />
                <span className="h-1.5 w-2/3 animate-pulse rounded-full bg-white/5" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
