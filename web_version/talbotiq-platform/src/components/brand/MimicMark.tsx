import { cn } from '@/components/ui'

/**
 * MIMIC — the brand mark.
 *
 * One definition, used by the sign-in lockup, the candidate home, the recruiter
 * spine, the interview stage header and the interviewer's avatar in a
 * conversational interview. It was previously hand-drawn in four places with
 * four different plate sizes and stroke weights.
 *
 * The mark is the chevron run — a continuous stroke that rises, dips, rises,
 * dips and rises again. It reads as a waveform, which is what an interview
 * actually is: turns of speech. It is drawn rather than shipped as an image so
 * it inherits the ground's ink and stays crisp at 16px and at 96px.
 */

type Size = 'sm' | 'md' | 'lg'

const PLATE: Record<Size, string> = {
  sm: 'h-7 w-7 rounded-md',
  md: 'h-8 w-8 rounded-md',
  lg: 'h-11 w-11 rounded-lg',
}
const GLYPH: Record<Size, string> = {
  sm: 'h-[15px] w-[15px]',
  md: 'h-[17px] w-[17px]',
  lg: 'h-6 w-6',
}

export function MimicMark({
  size = 'md', tone = 'ink', className,
}: {
  size?: Size
  /**
   * `ink`   an ink plate with a paper chevron — the default lockup.
   * `plain` no plate; the chevron takes the current text colour. For use inside
   *         something that already provides its own ground.
   */
  tone?: 'ink' | 'plain'
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid flex-shrink-0 place-items-center',
        tone === 'ink' ? cn(PLATE[size], 'bg-ink ring-1 ring-inset ring-rule') : PLATE[size],
        className,
      )}
    >
      <svg viewBox="0 0 32 32" className={GLYPH[size]}>
        <path
          d="M7 21V11l5 6 4-6 4 6 5-6v10"
          fill="none"
          stroke={tone === 'ink' ? 'var(--ink-inverse)' : 'currentColor'}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

/**
 * The full lockup: mark plus wordmark.
 *
 * `Mimic` is the product a candidate is using, and it is what the header says.
 * The employer they are interviewing FOR is named where it carries weight — in
 * the welcome copy, in the completion screen, and in the help sheet's statement
 * of who can see their answers — rather than as a logo in the corner competing
 * with the product's own identity.
 */
export function MimicLockup({
  size = 'md', className,
}: {
  size?: Size
  className?: string
}) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <MimicMark size={size} />
      <span
        className={cn(
          'font-display font-bold tracking-[-0.03em] text-ink',
          size === 'lg' ? 'text-xl' : size === 'md' ? 'text-[17px]' : 'text-sm',
        )}
      >
        Mimic
      </span>
    </span>
  )
}
