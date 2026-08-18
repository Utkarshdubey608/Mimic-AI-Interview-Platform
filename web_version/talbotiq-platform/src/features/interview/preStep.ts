/**
 * The candidate's pre-interview step machine, as pure values and predicates.
 *
 * Extracted from TakeInterviewPage so the routing decision is testable without a
 * DOM — see preStep.test.ts. The bug that forced the extraction is worth stating,
 * because the shape of the old code is what hid it:
 *
 *   const conversational = track === 'chatbot' || track === 'video_avatar'
 *                       || track === 'voice'   || track === 'two_way'
 *   const fixedFormat    = conversational || track === 'video'
 *   const step = fixedFormat && preStep === 'track' ? 'welcome' : preStep
 *
 * That predicate enumerated five of the six tracks. The sixth — 'chat', the
 * recruiter-facing "Timed Q&A" — fell through to a "Choose your format" screen,
 * so the format recruiters pick most often was the one the candidate got asked
 * about again, and could silently override into a voice or avatar interview the
 * recruiter never configured, on a template with no config for it.
 *
 * The format is ALWAYS the recruiter's, chosen in the invite wizard (see
 * InviteWizard's MODES, which lists all six tracks). No flag anywhere in the
 * codebase lets a candidate choose. So the chooser is not a step that can be
 * skipped — it is not a step at all, and `PreStep` below cannot express it.
 */
import type { TrackType } from '@shared/types'

/** Pre-interview screens, in the order a candidate meets them. */
export type PreStep = 'welcome' | 'resume' | 'systemcheck'

/** Where every candidate starts, whatever the invite's track. */
export const INITIAL_PRE_STEP: PreStep = 'welcome'

/**
 * Tracks that run their own full-screen, engine-driven experience rather than
 * the timed question engine. These skip QuestionStage entirely and start
 * client-side (setChatbotStarted) instead of through the server's /begin.
 *
 * Kept as a list rather than a chain of `||` comparisons: the chain is exactly
 * what went wrong above, and a list is the thing preStep.test.ts can walk.
 */
const CONVERSATIONAL_TRACKS = ['chatbot', 'video_avatar', 'voice', 'two_way'] as const

export function isConversational(track: TrackType): boolean {
  return (CONVERSATIONAL_TRACKS as readonly string[]).includes(track)
}
