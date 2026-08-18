import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * What the interviewer is doing, right now, honestly.
 *
 * Shared by chatbot, voice and avatar. Every stage is derived from a REAL
 * signal by the caller — a request in flight, context being consumed, tokens
 * arriving, the stream tailing off. There is no timer that invents progress and
 * no label chosen at random, because on a screening surface a system that
 * pretends to be busy is lying to someone who is being assessed (§16.3).
 *
 * That rule has teeth: this component replaced a three-second artificial floor
 * in useChatbotSession that held every reply back so the interviewer would seem
 * thoughtful. A fast answer should feel fast.
 *
 * Tone: playful, not cute. Small, low-contrast, on the message rail. The test
 * is whether a candidate on their second interview can ignore it completely.
 * Whimsy that reads as the system not taking them seriously is a bug here.
 */

export type AgentStage = 'thinking' | 'reading' | 'cooking' | 'almost'

interface Props {
  /** null hides the row's content but never its height. */
  stage: AgentStage | null
  /**
   * Tokens per second, when the caller knows it. Drives the simmer rate during
   * `cooking` so the motion reports the real stream rather than a stock loop.
   */
  streamRate?: number
  className?: string
}

/** Copy per stage. The second line only appears once a wait is genuinely long. */
const COPY: Record<AgentStage, { first: string; later: string }> = {
  thinking: { first: 'Thinking', later: 'Still thinking' },
  reading: { first: 'Reading your résumé', later: 'Still reading' },
  cooking: { first: 'Writing', later: 'Still writing' },
  almost: { first: 'Almost there', later: 'Almost there' },
}

/** Past this, and only past this, the copy is allowed to acknowledge the wait. */
const LONG_WAIT_MS = 2500

/** Three dots, drifting. Amplitude and rate differ per stage — that is the tell. */
const RHYTHM: Record<AgentStage, { amp: number; period: number; stagger: number }> = {
  // Slow, even, unhurried. damping 1.0 in feel: no overshoot anywhere.
  thinking: { amp: 3, period: 1400, stagger: 160 },
  // A nibble: quick bite, longer pause. Reads as consuming something.
  reading: { amp: 4, period: 900, stagger: 90 },
  // A simmer. Overridden by the real stream rate when the caller supplies it.
  cooking: { amp: 2.5, period: 700, stagger: 70 },
  // Settling toward rest. No bounce at the end (§4).
  almost: { amp: 1.2, period: 1800, stagger: 220 },
}

export function AgentStatus({ stage, streamRate, className }: Props) {
  const reduce = useReducedMotion()
  const [longWait, setLongWait] = useState(false)
  const dotsRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef<number | null>(null)

  // The wait clock restarts with each stage, so "still thinking" means still
  // thinking about THIS, not a total elapsed since the turn began.
  useEffect(() => {
    setLongWait(false)
    if (!stage) return
    const id = window.setTimeout(() => setLongWait(true), LONG_WAIT_MS)
    return () => window.clearTimeout(id)
  }, [stage])

  /**
   * The dots are driven by rAF on transform only (§11) — never a CSS keyframe,
   * because the rate has to follow the real stream and a keyframe cannot.
   */
  useEffect(() => {
    if (!stage || reduce) return
    const host = dotsRef.current
    if (!host) return
    const dots = Array.from(host.children) as HTMLElement[]
    const { amp, period, stagger } = RHYTHM[stage]
    // A faster stream simmers faster, bounded so it never becomes a strobe (§11).
    const rate = stage === 'cooking' && streamRate
      ? Math.min(2.2, Math.max(0.6, streamRate / 18))
      : 1
    const start = performance.now()

    const frame = (now: number) => {
      const t = now - start
      for (let i = 0; i < dots.length; i++) {
        const phase = ((t * rate) - i * stagger) / period
        const y = -Math.sin(phase * Math.PI * 2) * amp
        // Below the perception threshold per frame, so it reads smooth not strobed.
        dots[i].style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`
        dots[i].style.opacity = String(0.45 + 0.35 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2)))
      }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      dots.forEach((d) => { d.style.transform = ''; d.style.opacity = '' })
    }
  }, [stage, streamRate, reduce])

  const label = stage ? (longWait ? COPY[stage].later : COPY[stage].first) : ''

  return (
    // The row is always present at its full height, so nothing below it moves
    // when the status appears or goes. Zero layout shift, by construction.
    <div className={`flex h-6 items-center ${className ?? ''}`} data-testid="agent-status" data-stage={stage ?? 'idle'}>
      {/* One announcement per stage change, never per frame. The visual dots are
          hidden from assistive tech; the words carry the meaning. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">{label}</span>

      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ opacity: stage ? 1 : 0 }}
        // A cross-fade, not a slide — and the only transition here, so reduced
        // motion needs no special case for it (§14).
        transition={{ duration: reduce ? 0.2 : 0.25, ease: 'easeOut' }}
        className="ap-caption flex items-center gap-2 text-[var(--ap-label-tertiary)]"
      >
        <span ref={dotsRef} className="flex items-end gap-[3px]" style={{ willChange: 'transform' }}>
          <span className="block h-[5px] w-[5px] rounded-full bg-current" />
          <span className="block h-[5px] w-[5px] rounded-full bg-current" />
          <span className="block h-[5px] w-[5px] rounded-full bg-current" />
        </span>
        <span>{label}</span>
      </motion.span>
    </div>
  )
}
