interface Props {
  score: number // 0-100
  label?: string
  size?: number
}

// Brand score bands — green for strong, amber for mid, red for low.
// Mirrors the dimension bands used on the Results page so one score reads the
// same wherever it appears.
const TRACK = '#E7E7EA'
function bandColor(score: number) {
  if (score >= 70) return '#15803D'
  if (score >= 45) return '#B45309'
  return '#B3261E'
}

export function SentimentArc({ score, label = 'Sentiment Score', size = 140 }: Props) {
  const radius = size / 2 - 14
  const circumference = Math.PI * radius // semicircle
  const offset = circumference * (1 - score / 100)

  const color = bandColor(score)

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
          stroke={TRACK}
          strokeWidth={10}
          strokeLinecap="round"
        />
        {/* Progress */}
        <path
          d={`M ${14} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - 14} ${size / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease, stroke 0.5s ease' }}
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
          fill="#61666E"
          fontSize={11}
          fontWeight="600"
          fontFamily="Archivo, system-ui, sans-serif"
        >
          / 100
        </text>
      </svg>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
    </div>
  )
}
