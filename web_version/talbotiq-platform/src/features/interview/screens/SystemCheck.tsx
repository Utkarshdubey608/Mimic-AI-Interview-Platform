import { useState } from 'react'
import { Wifi, Volume2, ShieldCheck, Clock, ArrowRight } from 'lucide-react'
import { Button, Checkbox } from '@/components/ui'
import { PreflightCard, ExpectationRow, type PreflightStep } from '../stage/Preflight'
import type { BrandingConfig, TrackType } from '@shared/types'
import { VideoSystemCheck } from './VideoSystemCheck'
import { VideoIntro } from './VideoIntro'

interface Props {
  branding: BrandingConfig
  track: TrackType
  steps: PreflightStep[]
  onBegin: () => void
  busy?: boolean
}

/**
 * The last screen before the clock starts.
 *
 * Formats that need hardware hand off to their own check — a camera preview is
 * the only honest way to confirm a camera works, and a checklist that asks
 * someone to confirm their microphone is fine without letting them hear it is
 * theatre. The checklist below is for the formats where the only real
 * prerequisites are environmental.
 */
export function SystemCheck({ branding, track, steps, onBegin, busy }: Props) {
  const [ready, setReady] = useState(false)

  if (track === 'video') return <VideoIntro branding={branding} onBegin={onBegin} busy={busy} />
  if (track === 'video_avatar' || track === 'two_way') {
    return <VideoSystemCheck branding={branding} track={track} onBegin={onBegin} busy={busy} />
  }

  return (
    <PreflightCard
      step="systemcheck"
      steps={steps}
      title="Quick ready check"
      description="Confirm you are set up. The timer starts with the first question, not with this screen."
      footer={
        <>
          <Button size="lg" block onClick={onBegin} disabled={!ready} loading={busy} iconRight={!busy ? <ArrowRight size={18} /> : undefined}>
            {busy ? 'Starting…' : 'Start the interview'}
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-muted">
            <Clock size={13} strokeWidth={1.75} className="flex-shrink-0" aria-hidden="true" />
            Your timer starts with the first question.
          </p>
        </>
      }
    >
      <ul className="space-y-5">
        <ExpectationRow icon={<Wifi size={17} strokeWidth={1.75} />} title="A stable connection">
          A dropped connection will not lose your progress, but a steady one means
          you will not have to think about it.
        </ExpectationRow>
        <ExpectationRow icon={<Volume2 size={17} strokeWidth={1.75} />} title="A quiet space">
          You will not be able to pause once a question begins.
        </ExpectationRow>
        <ExpectationRow icon={<ShieldCheck size={17} strokeWidth={1.75} />} title="Uninterrupted time">
          Set aside enough time to finish in one sitting.
        </ExpectationRow>
      </ul>

      <div className="mt-7 rounded-lg border border-rule bg-surface-sunk p-4">
        <Checkbox
          checked={ready}
          onChange={(e) => setReady(e.target.checked)}
          label={<span className="font-medium text-ink">I understand the rules and I am ready to begin.</span>}
        />
      </div>
    </PreflightCard>
  )
}
