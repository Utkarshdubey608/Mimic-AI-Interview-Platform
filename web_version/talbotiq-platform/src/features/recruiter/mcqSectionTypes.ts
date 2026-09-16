import type { McqSectionType } from '@shared/types'

/**
 * The predefined section types offered by "Add Section" — mirrors the
 * backend's `mcq_authoring.SECTION_TYPES` exactly (same ids, same order).
 * Purely a picker convenience: a section's `sectionType` never constrains
 * what it may be named or hold, and an id the server doesn't recognise
 * backfills to "custom" rather than being refused.
 */
export const SECTION_TYPES: Array<{ id: McqSectionType; label: string; description: string }> = [
  { id: 'aptitude', label: 'Aptitude', description: 'Numerical and logical aptitude' },
  { id: 'quantitative', label: 'Quantitative Ability', description: 'Mathematical reasoning and problem solving' },
  {
    id: 'reading_comprehension',
    label: 'Reading Comprehension',
    description: 'Passage-based comprehension questions',
  },
  { id: 'verbal_reasoning', label: 'Verbal Reasoning', description: 'Language and verbal logic' },
  { id: 'diagram', label: 'Diagram / Visual Reasoning', description: 'Image and diagram-based reasoning' },
]

const BY_ID = new Map(SECTION_TYPES.map((t) => [t.id, t]))

/** A predefined type's label, or the section's own name for "custom"/unknown. */
export function sectionTypeLabel(type: McqSectionType | undefined, fallbackName: string): string {
  if (!type || type === 'custom') return fallbackName || 'Custom section'
  return BY_ID.get(type)?.label ?? fallbackName
}

/** Preset question-count chips offered next to a custom number field. */
export const TARGET_COUNT_PRESETS = [5, 10, 15, 20, 50]
