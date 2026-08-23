/**
 * MIMIC — THE INTELLIGENCE SIGNAL.
 *
 * The product's one visual signature, and the answer to a real problem: the
 * thing that makes Mimic different from an ATS is that a machine conducts the
 * interview, understands it and evaluates it — and none of that was visible
 * anywhere in the interface. A logo cannot say it. A gradient certainly cannot.
 *
 * So the signal is a DRAWING OF THE MACHINE'S ATTENTION, and it has exactly
 * four states, which are the four the product genuinely has:
 *
 *   listening  concentric arcs breathe INWARD — an aperture taking something in.
 *   speaking   arcs travel OUTWARD — energy leaving the core.
 *   thinking   a sweep rotates around the core — work in progress, nobody's turn.
 *   idle       the composed still frame. Present, not working.
 *
 * Direction of motion is the primary encoding, so the states are distinguishable
 * without relying on colour or on a label — but a label is always available and
 * is announced, because a state a person cannot perceive is not a state.
 *
 * ── Why SVG and not WebGL ─────────────────────────────────────────────────
 * This mark appears in interview rooms next to a live WebRTC call, in report
 * panels, and inline in tables. A GL context per instance would be absurd; this
 * is four circles and a mask, animated on the compositor with transform and
 * opacity only. It costs nothing, it scales to any size, and it survives being
 * rendered thirty times on one page.
 *
 * Reduced motion renders the composed still frame — the arcs stay, the travel
 * stops. Never a blank box.
 */
import { cn } from '@/components/ui/cn'

export type AIState = 'idle' | 'listening' | 'speaking' | 'thinking'

const STATE_LABEL: Record<AIState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  speaking: 'Speaking',
  thinking: 'Thinking',
}

/**
 * The signal itself. `size` is the box in px; the geometry is proportional, so
 * it reads correctly at 16px in a table cell and at 240px on an interview stage.
 */
export function AISignal({
  state = 'idle',
  size = 40,
  className,
  label,
}: {
  state?: AIState
  size?: number
  className?: string
  /** Overrides the announced label. The visual state is unchanged. */
  label?: string
}) {
  const announced = label ?? STATE_LABEL[state]
  return (
    <span
      className={cn('mimic-signal relative inline-block flex-none align-middle', className)}
      data-state={state}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`AI ${announced.toLowerCase()}`}
    >
      <svg viewBox="0 0 48 48" className="h-full w-full overflow-visible" aria-hidden="true">
        {/* Three arcs. Each is a full circle with a dash pattern that leaves a
            gap, so the ring reads as an arc of attention rather than a target.
            The rotations are unequal, so the three never resolve into one
            repeating figure. */}
        <g className="signal-arcs" fill="none" strokeLinecap="round">
          <circle className="signal-arc signal-arc-1" cx="24" cy="24" r="21" strokeWidth="1.25" strokeDasharray="42 90" transform="rotate(-24 24 24)" />
          <circle className="signal-arc signal-arc-2" cx="24" cy="24" r="16" strokeWidth="1.5" strokeDasharray="30 70" transform="rotate(118 24 24)" />
          <circle className="signal-arc signal-arc-3" cx="24" cy="24" r="11" strokeWidth="1.75" strokeDasharray="22 48" transform="rotate(212 24 24)" />
        </g>

        {/* The sweep — only visible while thinking. A short bright arc rotating
            around the core: the machine reading back over what it heard. */}
        <circle
          className="signal-sweep"
          cx="24" cy="24" r="16"
          fill="none" strokeWidth="1.75" strokeLinecap="round"
          strokeDasharray="14 86"
        />

        {/* The core. Its scale carries the breath; its opacity carries presence. */}
        <circle className="signal-core" cx="24" cy="24" r="5" />
      </svg>
    </span>
  )
}

/**
 * The signal with its state in words beside it — for interview stages, where a
 * candidate must be able to read whose turn it is without decoding a graphic.
 * The live region is what makes a phase change perceivable to a screen reader.
 */
export function AIStateBadge({
  state,
  size = 22,
  className,
}: {
  state: AIState
  size?: number
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-ai-rule bg-ai-bg px-2.5 py-1',
        className,
      )}
    >
      <AISignal state={state} size={size} />
      <span
        aria-live="polite"
        className="text-2xs font-bold uppercase tracking-[0.09em] text-ai"
      >
        {STATE_LABEL[state]}
      </span>
    </span>
  )
}
