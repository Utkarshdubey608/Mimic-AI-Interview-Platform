/**
 * The hero's intelligence rail — the strip under the real interview footage
 * that shows what the machine is doing with it: listening, thinking, scoring.
 *
 * This is annotation, not depiction. The page's rule is that nothing fabricated
 * may stand in for the product, so the rail does not invent an interface — it
 * dramatises the three machine states the product actually has (the candidate
 * stage shows the same three) and scores the three real default criteria from
 * the rubric section below, with the same synthetic values that section
 * discloses. The footage above it is the evidence; this is the caption.
 *
 * All motion is transform/opacity. Under reduced motion the rail renders its
 * composed final frame: state word "Scored", every criterion filled. The whole
 * strip is aria-hidden — it repeats what the hero copy already says.
 */
import { useEffect, useRef, useState } from 'react'

type MachineState = 'listening' | 'thinking' | 'scoring'

const STATE_COPY: Record<MachineState, string> = {
  listening: 'Listening',
  thinking: 'Thinking',
  scoring: 'Scoring',
}

/* Dwell per state, ms. The loop reads listening → thinking → scoring, which is
   the product's real order of operations. */
const DWELL: Record<MachineState, number> = {
  listening: 3200,
  thinking: 1700,
  scoring: 2600,
}

const ORDER: MachineState[] = ['listening', 'thinking', 'scoring']

/* The three criteria shown are the rubric's first three real defaults; the
   values match the scoring section's dramatisation so the page tells one
   story with one set of numbers. */
const CRITERIA = [
  { k: 'Communication', v: 88 },
  { k: 'Relevance', v: 91 },
  { k: 'Depth', v: 79 },
]

/* One irregular bar profile, so the waveform reads as speech rather than as a
   metronome. Heights are fractions of the rail height. */
const BARS = [0.34, 0.62, 0.45, 0.82, 0.55, 0.95, 0.48, 0.7, 0.38, 0.88, 0.58, 0.75, 0.42, 0.66, 0.5, 0.9, 0.36, 0.6]

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

export function HeroIntelligence() {
  const reduced = useReducedMotion()
  const [state, setState] = useState<MachineState>('listening')
  /* Criteria fill one per completed loop, then hold. */
  const [scored, setScored] = useState(0)
  const cycles = useRef(0)

  useEffect(() => {
    if (reduced) return
    const t = window.setTimeout(() => {
      const next = ORDER[(ORDER.indexOf(state) + 1) % ORDER.length]
      setState(next)
      if (next === 'scoring') {
        cycles.current += 1
        setScored((s) => Math.min(CRITERIA.length, s + 1))
      }
    }, DWELL[state])
    return () => window.clearTimeout(t)
  }, [state, reduced])

  const shownState: MachineState | 'scored' = reduced ? 'scored' : state
  const filled = reduced ? CRITERIA.length : scored

  return (
    <div className="airail" data-state={shownState} aria-hidden="true">
      <div className="airail-live">
        <span className="airail-dot" />
        <span className="airail-word">
          {reduced ? 'Scored' : STATE_COPY[state]}
        </span>
      </div>

      <div className="airail-wave">
        {BARS.map((h, i) => (
          <span
            key={i}
            className="airail-bar"
            style={{ '--h': h, '--i': i } as React.CSSProperties}
          />
        ))}
        {/* The thinking sweep — one element, visible only in that state. */}
        <span className="airail-sweep" />
      </div>

      <div className="airail-marks">
        {CRITERIA.map((c, i) => (
          <span key={c.k} className="airail-mark" data-on={i < filled || undefined}>
            <span className="airail-k">{c.k}</span>
            <span className="airail-v">{c.v}</span>
            <span className="airail-fill" style={{ '--v': c.v / 100 } as React.CSSProperties} />
          </span>
        ))}
      </div>
    </div>
  )
}
