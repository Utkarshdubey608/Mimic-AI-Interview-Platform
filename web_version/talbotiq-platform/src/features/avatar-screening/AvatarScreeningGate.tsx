/**
 * AvatarScreeningGate — inserts the on-device "fit your face to frame" pre-flight
 * step in front of the AI Avatar Screening, WITHOUT touching the migrated
 * Tavus / Rekognition / Hume / Deepgram screen.
 *
 * The trick: the Tavus iframe and every analysis pipeline live INSIDE
 * <InterviewPage>. By not mounting InterviewPage until the candidate has locked
 * in their framing, nothing starts (no camera capture, no Tavus join) until
 * they're ready — so this is purely additive and hands off to the existing
 * start logic exactly as it already works.
 */
import { useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import InterviewPage from '@/pages/InterviewPage'
import { FaceFitCheck } from './facefit/FaceFitCheck'

/** Best-effort candidate first-name from the "TalbotIQ — {name}" convention. */
function candidateNameFrom(conversationName?: string): string | undefined {
  if (!conversationName) return undefined
  const parts = conversationName.split('—')
  const tail = parts.length > 1 ? parts[parts.length - 1].trim() : ''
  return tail && tail.toLowerCase() !== 'talbotiq' ? tail.split(' ')[0] : undefined
}

export default function AvatarScreeningGate() {
  const conv = useAppStore((s) => s.currentConversation)
  const [framed, setFramed] = useState(false)

  // No active session, or the candidate is already framed → hand off to the
  // real (frozen) screen. InterviewPage handles the no-conversation redirect.
  if (!conv || framed) return <InterviewPage />

  return (
    <FaceFitCheck
      onReady={() => setFramed(true)}
      accentColor="#0B7A45"
      candidateName={candidateNameFrom(conv.conversation_name)}
    />
  )
}
