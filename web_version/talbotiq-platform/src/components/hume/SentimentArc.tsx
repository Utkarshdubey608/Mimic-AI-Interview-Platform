import { palette } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'

interface Props {
  score: number // 0-100
  label?: string
  size?: number
}

type Pal = ReturnType<typeof palette>

// Score bands — pass / review / flagged. The same three status tokens the
// dimension bars on the Results page use, so one score reads the same wherever
// it appears, on either ground.
function bandColor(score: number, pal: Pal) {
  if (score >= 70) return pal.ok
  if (score >= 45) return pal.warn
  return pal.risk
}

export function SentimentArc({ score, label = 'Sentiment Score', size = 140 }: Props) {
  // An SVG stroke can't read a CSS variable, so the arc resolves its colours
  // from the typed token mirror for the current workspace ground.
  const pal = palette(useWorkspaceGround())

  const radius = size / 2 - 14
  const circumference = Math.PI * radius // semicircle
  const offset = circumference * (1 - score / 100)

  const color = bandColor(score, pal)

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        width={size}
        height={size / 2 + 16}
        style={{ overflow: 'visible' }}
        role="img"
        aria-label={`${label}: ${score} out of 100`}
      >
        {/* Track */}
        <path
          d={`M ${14} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - 14} ${size / 2}`}
          fill="none"
          stroke={pal.rule}
          strokeWidth={10}
          strokeLinecap="round"
        />
        {/* Progress. 700ms matches the score bars on the scorecard — this is a
            value settling, not an interaction, and the global reduced-motion
            policy drops stroke-dashoffset from the allowed transition set, so
            it lands instantly for anyone who asked for that. */}
        <path
          d={`M ${14} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - 14} ${size / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 700ms var(--ease-out), stroke var(--dur-base) ease' }}
        />
        {/* Score text */}
        <text
          x={size / 2}
          y={size / 2 - 4}
          textAnchor="middle"
          fill={color}
          fontSize={size / 4}
          fontWeight="800"
          fontFamily="Archivo, system-ui, sans-serif"
          letterSpacing="-0.03em"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {score}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 14}
          textAnchor="middle"
          fill={pal.inkMuted}
          fontSize={11}
          fontWeight="600"
          fontFamily="Archivo, system-ui, sans-serif"
        >
          / 100
        </text>
      </svg>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
    </div>
  )
}
