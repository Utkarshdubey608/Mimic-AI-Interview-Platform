import { useState } from 'react'
import type { BrandingConfig } from '@shared/types'
import { IntegrityWarningModal } from '../components/IntegrityWarningModal'
import { useIntegrityMonitor } from '../useIntegrityMonitor'
import { InterviewFeedback } from '../screens/InterviewFeedback'

/**
 * DEV ONLY. Mounts the two pieces that otherwise need a live interview session
 * to reach: the tab-switch dialog and the completion feedback step. Registered
 * behind import.meta.env.DEV, like the System Check harness.
 */
const BRANDING: BrandingConfig = { companyName: 'TalbotIQ', accentColor: '#0E1420' }

/**
 * The REAL detector, wired to the real listeners, with logging off so it needs
 * no session. This is what lets the Playwright matrix prove the Safari/macOS
 * bug is fixed on WebKit and Firefox rather than only in the unit test.
 */
function LiveDetector() {
  const m = useIntegrityMonitor('harness', { logEvents: false, detectTabSwitch: true } as never, true)
  return (
    <>
      <p data-testid="detector-state" data-away={m.warning ? 'yes' : 'no'} className="text-sm text-neutral-500">
        Detector: {m.warning ? 'switch detected' : 'watching'}
      </p>
      <IntegrityWarningModal warning={m.warning} branding={BRANDING} onAcknowledge={m.acknowledge} />
    </>
  )
}

export default function InterviewBitsHarness() {
  const [warned, setWarned] = useState(true)

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div className="rounded-3xl border border-border bg-white p-8">
        <h2 className="font-display text-xl font-extrabold text-neutral-900">Completion feedback</h2>
        <InterviewFeedback sessionId="harness-session" accentColor={BRANDING.accentColor} />
      </div>

      <div className="rounded-3xl border border-border bg-white p-6" data-testid="live-detector">
        <h2 className="font-display text-lg font-extrabold text-neutral-900">Live tab-switch detector</h2>
        <LiveDetector />
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
