import { McqStage } from './McqStage'
import type { BrandingConfig } from '@shared/types'

/**
 * Browser-test harness for the candidate's MCQ paper.
 *
 * Mounted only in development (see App.tsx), because it renders a candidate
 * screen with no invite and no identity. The spec supplies the API by
 * intercepting the network, so this file holds nothing but the props.
 *
 * It exists separately from the authoring harness for one reason: this is the
 * IRREVERSIBLE path. A recruiter who mis-edits a paper opens it again; a
 * candidate sits the assessment once and is scored on what happened in this
 * component. Losing their answers on a reload, or dropping the last one at
 * submit, is not a defect they can work around.
 */
const BRANDING: BrandingConfig = { companyName: 'Mimic', accentColor: '#0E1420' }

export default function McqStageHarness() {
  return <McqStage sessionId="e2e-session" branding={BRANDING} />
}
