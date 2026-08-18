import { useState } from 'react'
import type { BrandingConfig } from '@shared/types'
import { IntegrityWarningModal } from '../components/IntegrityWarningModal'
import { InterviewFeedback } from '../screens/InterviewFeedback'

/**
 * DEV ONLY. Mounts the two pieces that otherwise need a live interview session
 * to reach: the tab-switch dialog and the completion feedback step. Registered
 * behind import.meta.env.DEV, like the System Check harness.
 */
const BRANDING: BrandingConfig = { companyName: 'TalbotIQ', accentColor: '#0E1420' }

export default function InterviewBitsHarness() {
  const [warned, setWarned] = useState(true)

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div className="rounded-3xl border border-border bg-white p-8">
        <h2 className="font-display text-xl font-extrabold text-neutral-900">Completion feedback</h2>
        <InterviewFeedback sessionId="harness-session" accentColor={BRANDING.accentColor} />
      </div>

      <button
        onClick={() => setWarned(true)}
        data-testid="harness-trigger-warning"
        className="rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold"
      >
        Raise the tab-switch warning
      </button>

      <IntegrityWarningModal
        warning={warned ? { message: 'Please stay on this tab. Switching away is recorded.', count: 1, max: 3 } : null}
        branding={BRANDING}
        onAcknowledge={() => setWarned(false)}
      />
    </div>
  )
}
