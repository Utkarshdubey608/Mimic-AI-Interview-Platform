/**
 * Appearance, reachable from a header rather than only from Settings.
 *
 * WHY THIS EXISTS. The palette lived on the recruiter Settings page and nowhere
 * else, so a candidate — who has no settings page, and on an invite link has no
 * account to hang one off — could switch light and dark but could not choose a
 * colour at all. This is that control, in the one place a candidate reliably
 * passes through.
 *
 * WHY IT RENDERS `SchemePicker` VERBATIM rather than a compact variant of it.
 * There is now one appearance UI in the product and both entry points show it, so
 * the two cannot drift — a swatch added to the palette, or a row of copy reworded,
 * lands in both places by construction. A "compact" second implementation is how
 * you end up with a settings page offering seven colours and a header offering
 * five.
 *
 * WHY A MODAL and not a popover. There is no popover primitive here, and a modal
 * is not the lazy choice — `Modal` already traps focus, closes on Escape, restores
 * focus to its trigger and works at 390px, all of which a hand-rolled popover in a
 * 60px header would have had to reimplement to be usable at all. The cost is a
 * scrim, which for a deliberate visit to a preference is honest: nothing else is
 * being done at that moment.
 *
 * WHERE IT IS NOT. Not on an interview stage. A candidate mid-interview is on a
 * clock, and a colour picker is the last thing that should be able to take their
 * attention or their focus ring — so this sits in the lobby, before anything has
 * started, and the stages are untouched.
 */
import { Palette } from 'lucide-react'
import { useState } from 'react'

import { Modal } from '@/components/ui'
import { SchemePicker } from './SchemePicker'

export function AppearanceButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        /* The accessible name carries the word; the icon carries it visually. The
           header is 60px and already holds an address, a switch and a button, so
           there is no room for a fifth label. */
        aria-label="Appearance"
        title="Appearance"
        className={[
          'inline-flex h-7 w-7 items-center justify-center rounded-full',
          'border border-border bg-surface-sunk text-ink-muted',
          'transition-colors duration-150 hover:text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
          className ?? '',
        ].join(' ')}
      >
        <Palette size={13} aria-hidden />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Appearance"
        description="Only affects this browser. It does not change your interview."
        width="max-w-lg"
      >
        <SchemePicker />
      </Modal>
    </>
  )
}
