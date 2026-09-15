/**
 * The ground switch — paper or room.
 *
 * Two states, both named, both visible at once. Not a single icon that toggles:
 * a lone moon has to be read as "you are in light, press for dark" or "you are in
 * dark" depending on a convention nobody agreed on, and the answer changes per
 * app. Showing both options with one selected removes the guess.
 *
 * It writes through `setWorkspaceGround`, which is the same call the first-run
 * picker makes and the same store `RecruiterShell` reads — so a switch here, a
 * pick on the entry screen and the recruiter shell's own ground can never
 * disagree. The value survives a reload; the FACT of having chosen is what a
 * sign-out clears.
 */
import { Moon, Sun } from 'lucide-react'

import { cn } from '@/components/ui'
import { DARK_GROUND_ENABLED, setWorkspaceGround, useWorkspaceGround, type WorkspaceGround } from '@/lib/workspaceGround'

const OPTIONS: { value: WorkspaceGround; label: string; Icon: typeof Sun }[] = [
  { value: 'record', label: 'Light', Icon: Sun },
  { value: 'room', label: 'Dark', Icon: Moon },
]

export function ThemeToggle({ className, compact = false }: {
  className?: string
  /** Icons only. For a dense header where the words do not fit. */
  compact?: boolean
}) {
  const ground = useWorkspaceGround()
  /* DARK-OFF: with only one ground reachable there is nothing to toggle, and a
     switch that cannot change anything is worse than no switch. This is the
     single hiding place for the login screen, the candidate header and the
     scheme picker — all three render this component.

     After the hook, not before it: an early return above a hook is a
     rules-of-hooks violation even when the condition is a module constant. */
  if (!DARK_GROUND_ENABLED) return null

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-sunk p-0.5',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const on = ground === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            /* The accessible name carries the word even when the visible label is
               hidden, so the compact form is not two unlabelled buttons. */
            aria-label={compact ? label : undefined}
            onClick={() => setWorkspaceGround(value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
              'transition-colors duration-150',
              on
                ? 'bg-surface text-ink shadow-sm'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <Icon size={13} aria-hidden />
            {!compact && label}
          </button>
        )
      })}
    </div>
  )
}
