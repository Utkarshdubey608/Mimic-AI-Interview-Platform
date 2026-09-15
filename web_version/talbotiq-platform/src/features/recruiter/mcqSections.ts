import type { McqQuestionSet, McqSection } from '@shared/types'

/**
 * ONE section is reserved by default: Diagram Questions, for image-based
 * reasoning (aptitude/directions with a generated diagram) — a fixed place for
 * a fixed feature. Every other section is entirely the recruiter's: their own
 * names, their own count, none forced.
 *
 * An earlier version of this also force-added a "General" section for every
 * ordinary question. That was wrong: it showed up as a mandatory section a
 * recruiter never asked for (and, worse, could render as "Untitled section" —
 * one more thing masquerading as theirs to name). A question with no section
 * is simply unsectioned, exactly as it always was before Diagram existed.
 */
export const DIAGRAM_SECTION_ID = 'diagram-questions'

export const PROTECTED_SECTION_IDS = new Set([DIAGRAM_SECTION_ID])

const DEFAULT_DIAGRAM_SECTION: McqSection = {
  id: DIAGRAM_SECTION_ID,
  name: 'Diagram Questions',
  instructions: 'Image-based reasoning — aptitude or directions questions with a diagram to read before answering.',
}

/** Sections normalised so Diagram Questions always exists, in whatever order
 *  the recruiter's own sections are already in. Pure — safe to call on load,
 *  on create, and after generation/template/append. Questions are returned
 *  untouched: an unsectioned question stays unsectioned. */
export function withDefaultSections(set: {
  sections?: McqSection[]
  questions: McqQuestionSet['questions']
}): { sections: McqSection[]; questions: McqQuestionSet['questions'] } {
  const existing = set.sections ?? []
  const hasDiagram = existing.some((s) => s.id === DIAGRAM_SECTION_ID)
  const sections = hasDiagram ? existing : [...existing, DEFAULT_DIAGRAM_SECTION]
  return { sections, questions: set.questions }
}
