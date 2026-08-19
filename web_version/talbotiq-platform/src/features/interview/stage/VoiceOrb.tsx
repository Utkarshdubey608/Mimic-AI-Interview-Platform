import { motion, useReducedMotion } from 'framer-motion'
import type { VoicePhase } from '@shared/types'

/**
 * MIMIC — the voice orb.
 *
 * The focal object of a voice interview: the only thing on screen during a
 * conversation that has no face and no text. It has one job, and it is not
 * decoration — it must answer, at a glance and without a label, *whose turn it
 * is*. In a spoken interview with no visual interlocutor, "am I supposed to be
 * talking right now" is the question that decides whether the format works.
 *
 * ── How the states read ───────────────────────────────────────────────────
 *   speaking   the interviewer is talking. Rings travel OUTWARD from the orb —
 *              sound leaving it. Ink: the product speaking, not an alert.
 *   listening  the candidate's turn. The orb opens into a ring and breathes
 *              slowly — an open aperture rather than a source. Mint, the
 *              product's live colour.
 *   thinking   neither. A slow rotating arc: something is happening, nobody is
 *              expected to speak.
 *   connecting not yet a conversation. Static, dim, with a spinner elsewhere.
 *
 * Direction of motion is the primary encoding — outward for output, inward
 * breathing for input — so the states are distinguishable without relying on
 * the colour difference. The phase is also stated in words beside the orb, so
 * nothing here is the sole carrier of the meaning.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 * SVG and CSS transforms, no canvas, no rAF loop, no audio analysis. A voice
 * interview is already carrying a WebSocket, an audio worklet and a decoder;
 * the orb must not be the thing that makes the call stutter. Every animation
 * here is on `transform`/`opacity` alone, so the compositor carries it without
 * layout or paint. Under reduced motion neither the rings nor the gyroscope are
 * rendered at all, and the orb becomes a still ring whose state is carried
 * entirely by the label.
 */

export function VoiceOrb({ phase, muted }: { phase: VoicePhase; muted?: boolean }) {
  const reduce = useReducedMotion() ?? false

  const speaking = phase === 'speaking' || phase === 'greeting'
  const listening = phase === 'listening' && !muted
  const thinking = phase === 'thinking'

  // Ground-following, so the orb is correct on paper and in a dark room without a
  // second set of values.
  //
  // The interviewer's own state is `--action`, not `--accent`. It was the accent —
  // signal blue — which made the single largest object on the screen the one loud
  // colour in a palette whose whole rule is that the primary action is ink and colour
  // is spent only on state. As ink it reads as the product speaking rather than as an
  // alert, and it still inverts correctly: near-black on paper, near-white in a room.
  // Listening keeps the live colour, because THAT is a state and is the one moment the
  // candidate must recognise instantly.
  const color = listening ? 'var(--live-fg)' : speaking ? 'var(--action)' : 'var(--ink-faint)'

  // The gyroscope runs from the moment there is a conversation until it ends —
  // through every phase, not just one — because its job is to say the session is
  // alive. A still orb during a long "thinking" pause is the moment a candidate
  // starts wondering whether the page has frozen.
  const live = phase !== 'connecting' && phase !== 'ended' && phase !== 'error'

  return (
    <div className="relative flex h-56 w-56 items-center justify-center" aria-hidden="true">
      {/* ── The gyroscope ────────────────────────────────────────────────────
          Three rings on different axes, turning at different speeds and in
          opposing directions. Each is a circle tipped away from the viewer by
          `rotateX`, so it projects as an ellipse; spinning it about Z then reads
          as an orbit rather than a wheel, and three of them at unequal tilts and
          periods never resolve into a single repeating figure.

          `transformPerspective` is what makes it depth rather than a squash: the
          near edge of each ring is drawn larger than the far edge.

          It is CSS transforms on three empty spans — no canvas, no rAF, no audio
          analysis — because a voice interview is already carrying a WebSocket, an
          audio worklet and a decoder, and the decoration must never be the thing
          that makes the call stutter. Compositor-only properties, so this costs
          no layout and no paint.

          Colour follows the phase with the orb, and opacity stays low: this is
          ambient life, and it must never compete with the state the orb itself
          is carrying. */}
      {!reduce && live && [
        { size: 172, tilt: 72, spin: 16, dir: 1, width: 1, opacity: 0.22 },
        { size: 208, tilt: 108, spin: 24, dir: -1, width: 1, opacity: 0.16 },
        { size: 240, tilt: 84, spin: 33, dir: 1, width: 2, opacity: 0.1 },
      ].map((ring, i) => (
        <motion.span
          key={`orbit${i}`}
          className="absolute rounded-full"
          style={{
            width: ring.size,
            height: ring.size,
            border: `${ring.width}px solid ${color}`,
            opacity: muted ? ring.opacity * 0.35 : ring.opacity,
            transformPerspective: 620,
            rotateX: ring.tilt,
          }}
          animate={{ rotateZ: 360 * ring.dir }}
          transition={{ duration: ring.spin, repeat: Infinity, ease: 'linear' }}
        />
      ))}

      {/* Outward rings — the interviewer's voice leaving the orb. */}
      {!reduce && speaking && [0, 1, 2].map((i) => (
        <motion.span
          key={`s${i}`}
          className="absolute rounded-full border"
          style={{ borderColor: color, width: 128, height: 128 }}
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.85, opacity: 0 }}
          transition={{ duration: 1.9, repeat: Infinity, delay: i * 0.63, ease: 'easeOut' }}
        />
      ))}

      {/* Inward breathing — the candidate's turn. The aperture, not the source. */}
      {!reduce && listening && (
        <motion.span
          className="absolute rounded-full border-2"
          style={{ borderColor: color, width: 168, height: 168 }}
          animate={{ scale: [1, 0.92, 1], opacity: [0.25, 0.6, 0.25] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: [0.65, 0, 0.35, 1] }}
        />
      )}

      {/* Thinking — a single arc rotating. Neither party should speak. */}
      {!reduce && thinking && (
        <motion.svg
          className="absolute h-40 w-40"
          viewBox="0 0 100 100"
          animate={{ rotate: 360 }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
        >
          <circle
            cx="50" cy="50" r="46" fill="none"
            stroke={color} strokeWidth="1.5" strokeLinecap="round"
            strokeDasharray="40 250" opacity="0.7"
          />
        </motion.svg>
      )}

      {/* The orb. A lit disc when speaking, an open ring when listening — the
          shape itself changes, so the two are told apart in a still frame. */}
      <motion.div
        className="relative flex h-32 w-32 items-center justify-center rounded-full"
        style={{
          background: listening
            ? 'transparent'
            : `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${color} 85%, white), ${color})`,
          border: listening ? `2px solid ${color}` : '1px solid rgb(255 255 255 / 0.22)',
          boxShadow: muted
            ? 'none'
            : `0 0 42px -12px ${color}, inset 0 1px 0 0 rgb(255 255 255 / 0.25)`,
          opacity: muted ? 0.4 : 1,
        }}
        animate={
          reduce || muted ? undefined
            : speaking ? { scale: [1, 1.045, 1] }
            : listening ? { scale: [1, 1.02, 1] }
            : { scale: 1 }
        }
        transition={{ duration: speaking ? 1.0 : 2.6, repeat: Infinity, ease: [0.65, 0, 0.35, 1] }}
      >
        {/* A static waveform glyph inside the disc — reads as "audio" without
            an icon that implies a control. */}
        <svg viewBox="0 0 44 24" className="h-6 w-11" fill="none">
          {[4, 10, 16, 22, 28, 34, 40].map((x, i) => {
            const h = [8, 16, 22, 12, 20, 14, 7][i]
            return (
              <rect
                key={x}
                x={x - 1.25} y={12 - h / 2} width="2.5" height={h} rx="1.25"
                fill={listening ? color : 'var(--on-action)'}
              />
            )
          })}
        </svg>
      </motion.div>
    </div>
  )
}
