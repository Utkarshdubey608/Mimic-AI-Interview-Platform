import type { BrandingConfig } from '@shared/types'
import { CandidateSurface, CandidateSignOff } from './CandidateSurface'

/**
 * The shared sign-off. Four stages used to draw their own version of this with
 * different disc geometry and copy; they now all route through
 * `CandidateSignOff`, so a candidate sees the same ending whichever mode they
 * were interviewed in.
 */
export function Completion({ branding, sessionId }: { branding: BrandingConfig; sessionId?: string }) {
  return (
    <CandidateSurface wide className="text-center">
      <CandidateSignOff
        companyName={branding.companyName}
        sessionId={sessionId}
        accentColor={branding.accentColor}
      />
    </CandidateSurface>
  )
}
