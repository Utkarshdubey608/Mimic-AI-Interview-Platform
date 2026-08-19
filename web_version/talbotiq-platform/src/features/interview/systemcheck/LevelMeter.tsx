/** The mic's evidence: a bar that moves when the candidate speaks. */
interface Props {
  level: number
  accent: string
  active: boolean
}

export function LevelMeter({ level, accent, active }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100)
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Microphone level"
      data-testid="mic-level"
      data-level={pct}
    >
      <div
        className="h-full rounded-full transition-[width] duration-75"
        style={{ width: `${pct}%`, background: active ? accent : '#d4d4d4' }}
      />
    </div>
  )
}
