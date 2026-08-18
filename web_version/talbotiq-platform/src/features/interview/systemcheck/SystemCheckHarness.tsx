/**
 * DEV ONLY. Renders the System Check for one track with no session behind it, so
 * Playwright can drive every mode and failure state without minting invites.
 *
 * Registered in App.tsx behind `import.meta.env.DEV`, so it is absent from the
 * production bundle — a route that skips straight to a check screen must never
 * be reachable on a candidate-facing deployment.
 */
import { useSearchParams } from 'react-router-dom'
import type { TrackType } from '@shared/types'
import { SystemCheckScreen } from './SystemCheckScreen'

const TRACKS: TrackType[] = ['chat', 'chatbot', 'voice', 'video_avatar', 'video', 'two_way']

/** Default-exported so App.tsx can lazy() it like every other route. */
export default function SystemCheckHarness() {
  const [params] = useSearchParams()
  const asked = params.get('track') as TrackType | null
  const track: TrackType = asked && TRACKS.includes(asked) ? asked : 'voice'

  return (
    <div className="mx-auto max-w-2xl p-6">
      <SystemCheckScreen
        branding={{ companyName: 'TalbotIQ', accentColor: '#0E1420' }}
        track={track}
        onBegin={() => { /* harness: what "start" means belongs to TakeInterviewPage */ }}
      />
    </div>
  )
}
