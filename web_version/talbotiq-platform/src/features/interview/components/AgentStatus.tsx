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

/**
 * Words per stage. They cycle while the stage lasts, so a long wait reads as a
 * mind at work rather than a frozen label.
 *
 * The honesty rule still holds and is worth being precise about: the STAGE is
 * derived from a real signal, and every word in a stage's list is a synonym for
 * that same state. Nothing here ever claims a state the system is not in — the
 * `reading` list never says "writing". The variety is in the vocabulary, not in
 * the claim.
 *
 * The first word is the plain one. A candidate who gets a fast answer sees only
 * "Thinking" and never meets the rest.
 */
const WORDS: Record<AgentStage, string[]> = {
  thinking: ['Thinking', 'Pondering', 'Musing', 'Considering', 'Mulling', 'Deliberating', 'Reflecting'],
  reading: ['Reading your résumé', 'Taking it in', 'Absorbing', 'Poring over it', 'Digesting', 'Studying'],
  cooking: ['Writing', 'Composing', 'Drafting', 'Assembling', 'Putting it together', 'Wording it'],
  // The tail settles rather than roams: two words, so it reads as arriving.
  almost: ['Almost there', 'Nearly done'],
}

/** How long each word holds. Slow enough to read, quick enough to feel alive. */
const WORD_HOLD_MS = 2200

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
  const [wordIndex, setWordIndex] = useState(0)
  const dotsRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef<number | null>(null)

  // The vocabulary restarts with each stage, so the plain word is always the
  // one a candidate sees first and a fast answer never shows a fancy one.
  useEffect(() => {
    setWordIndex(0)
    if (!stage) return
    const words = WORDS[stage]
    if (words.length < 2) return
    const id = window.setInterval(
      // Stops at the end rather than looping back to the start: cycling forever
      // reads as a stuck spinner, and running out of words is itself a signal
      // that this is taking a while.
      () => setWordIndex((i) => Math.min(i + 1, words.length - 1)),
      WORD_HOLD_MS,
    )
    return () => window.clearInterval(id)
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

  const label = stage ? WORDS[stage][Math.min(wordIndex, WORDS[stage].length - 1)] : ''

  return (
    // The row is always present at its full height, so nothing below it moves
    // when the status appears or goes. Zero layout shift, by construction.
    <div className={`flex h-6 items-center ${className ?? ''}`} data-testid="agent-status" data-stage={stage ?? 'idle'}>
      {/* One announcement per stage change, never per frame. The visual dots are
          hidden from assistive tech; the words carry the meaning. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {stage ? WORDS[stage][0] : ''}
      </span>

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
          <span data-testid="agent-dot" className="block h-[5px] w-[5px] rounded-full bg-current" />
          <span data-testid="agent-dot" className="block h-[5px] w-[5px] rounded-full bg-current" />
          <span data-testid="agent-dot" className="block h-[5px] w-[5px] rounded-full bg-current" />
        </span>
        <motion.span
          key={label}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        >
          {label}
        </motion.span>
      </motion.span>
    </div>
  )
}
