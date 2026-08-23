/**
 * The first-run appearance picker — two grounds, side by side, pick one.
 *
 * THE PREVIEWS ARE NOT SCREENSHOTS. Each one is wrapped in `data-ground`, so the
 * tokens inside it resolve to that ground's real palette and the miniature is
 * drawn in the same colours the workspace is. A pair of PNGs would have been less
 * work and would start rotting the first time either palette moved — and both
 * palettes are contrast-gated by scripts/contrast-audit.mjs, so a picture of them
 * would be the one representation of the design system nothing checks. This way
 * the preview cannot lie about what you are choosing.
 *
 * WHEN IT SHOWS. Only when nobody has chosen at this browser — `hasGroundChoice`,
 * which is stored apart from the value precisely so that "never asked" and
 * "chose dark" are distinguishable, since dark is also the default. Signing out
 * clears the fact of choosing but keeps the value, so the next person is asked
 * again and "Go to workspace" still has a previous mode to go with.
 *
 * It is a surface, not a modal. There is nothing behind it to see yet and nothing
 * to dismiss it back to — the sign-in form is what comes after.
 */
import { motion } from 'framer-motion'
import { ArrowRight, Check, Moon, Sun } from 'lucide-react'

import { Button, cn } from '@/components/ui'
import { pageVariants } from '@/design/motion'
import { getWorkspaceGround, setWorkspaceGround, type WorkspaceGround } from '@/lib/workspaceGround'
import { useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * A miniature of the workspace, in whichever ground it is given.
 *
 * The sessions record, because that is the screen a recruiter spends the day in
 * and the one whose two palettes differ most: a light table of rows against a
 * dark one. Everything is a token, nothing is a literal, so this follows the
 * palette wherever it goes.
 */
function Preview({ ground }: { ground: WorkspaceGround }) {
  return (
    <div data-ground={ground} className="overflow-hidden rounded-lg bg-background">
      <div className="flex h-[8.5rem]">
        {/* The spine */}
        <div className="flex w-[3.25rem] flex-col gap-1.5 border-r border-border bg-surface-sunk p-2">
          <div className="h-2 w-2 rounded-sm bg-ink" />
          <div className="mt-1 h-1 w-full rounded-full bg-ink-disabled" />
          <div className="h-1 w-4/5 rounded-full bg-ink-disabled" />
          <div className="h-1 w-3/5 rounded-full bg-ink-disabled" />
        </div>

        {/* The record */}
        <div className="flex-1 bg-background p-2.5">
          <div className="mb-2 h-2 w-16 rounded-full bg-ink" />
          <div className="overflow-hidden rounded-md border border-border bg-surface">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-1.5 px-1.5 py-[0.3rem]',
                  i > 0 && 'border-t border-border',
                )}
              >
                <div className="h-1 w-8 rounded-full bg-ink-muted" />
                <div className="h-1 flex-1 rounded-full bg-ink-disabled" />
                {/* One colour event per row, exactly as the real record has. */}
                <div className="h-[0.3rem] w-5 rounded-full bg-ok" />
                <div className="h-1 w-2.5 rounded-full bg-ink" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const CHOICES: {
  value: WorkspaceGround
  name: string
  blurb: string
  Icon: typeof Sun
}[] = [
  {
    value: 'record',
    name: 'Light',
    blurb: 'Ink on paper. The record as a printed document.',
    Icon: Sun,
  },
  {
    value: 'room',
    name: 'Dark',
    blurb: 'Light in a dark room. Easier for long sittings.',
    Icon: Moon,
  },
]

export function ThemeChoice({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion() ?? false
  /* Local until confirmed, so the page behind does not strobe between grounds
     while somebody is comparing the two. The commit happens once, on the way out. */
  const [picked, setPicked] = useState<WorkspaceGround>(() => getWorkspaceGround())

  /* Escape takes the existing preference and goes, same as the button. Nobody
     should be held on a screen whose entire purpose is a preference. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setWorkspaceGround(picked); onDone() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked, onDone])

  const go = () => { setWorkspaceGround(picked); onDone() }

  return (
    <motion.div
      variants={pageVariants(reduce)}
      initial="initial"
      animate="animate"
      className="w-full max-w-[42rem]"
      role="group"
      aria-labelledby="theme-choice-h"
    >
      <div className="mb-6 text-center">
        <h1 id="theme-choice-h" className="font-display text-2xl font-extrabold tracking-[-0.03em] text-ink">
          Choose your appearance
        </h1>
        <p className="mx-auto mt-2 max-w-[32rem] text-sm leading-relaxed text-ink-muted">
          Both are the same product, and you can change it any time from the header or
          from Settings.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CHOICES.map(({ value, name, blurb, Icon }) => {
          const on = picked === value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked(value)}
              onDoubleClick={go}
              className={cn(
                'group rounded-xl border p-3 text-left transition-all duration-150',
                on
                  ? 'border-action bg-surface shadow-md ring-2 ring-focus'
                  : 'border-border bg-surface hover:border-ink-disabled hover:shadow-sm',
              )}
            >
              <Preview ground={value} />
              <div className="mt-3 flex items-start gap-2 px-0.5">
                <span
                  className={cn(
                    'mt-[0.1rem] flex h-4 w-4 flex-none items-center justify-center rounded-full border',
                    on ? 'border-action bg-action text-action-ink' : 'border-border',
                  )}
                  aria-hidden
                >
                  {on && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-bold text-ink">
                    <Icon size={13} aria-hidden />
                    {name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{blurb}</span>
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* The words are the ones asked for. It does what it says: takes the mode
          selected here — which starts as whatever was selected last time — and
          continues. Nothing here blocks getting on with it. */}
      <div className="mt-6 flex justify-center">
        <Button onClick={go} iconRight={<ArrowRight size={15} />}>
          Go to workspace
        </Button>
      </div>
    </motion.div>
  )
}
