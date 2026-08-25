/**
 * The code editor.
 *
 * WHY THIS IS A TEXTAREA AND NOT MONACO OR CODEMIRROR, stated plainly because it
 * is the most obvious thing to ask about this file.
 *
 * Neither is in the project's dependencies, and adding one is a real decision:
 * Monaco is around 2 MB, CodeMirror 6 is five packages, and both land on a page a
 * candidate loads once — possibly on a phone tether, possibly under exam
 * pressure, with a clock running. A textarea gets the things that actually matter
 * for writing forty lines of code under time pressure: a monospace grid, tab
 * indentation that does not escape the field, auto-indent that keeps a block
 * aligned, and line numbers to read a compiler error against. What it does not
 * get is syntax highlighting.
 *
 * That is a real gap and it is the right one to accept first, because the
 * alternative was shipping the dependency decision unsupervised. Swapping in
 * CodeMirror later is a change to this file alone — everything above it passes a
 * string and a language, which is the whole interface.
 *
 * THE PARTS THAT ARE NOT OPTIONAL, and each is here because a plain textarea gets
 * it wrong in a way that would be noticed within a minute:
 *
 *   Tab must indent, not move focus. In a form, Tab leaves the field; in an
 *   editor, leaving the field mid-function is infuriating. So Tab is captured —
 *   and Escape-then-Tab is deliberately left alone, so a keyboard-only candidate
 *   still has a documented way out of the editor. Shift+Tab outdents.
 *
 *   Enter must keep the indentation of the line it left, because Python is one of
 *   the languages offered and losing indentation there is losing the program.
 *
 *   The line numbers scroll WITH the text. A gutter that stays put while the code
 *   moves is worse than no gutter, and this is the bug every hand-rolled editor
 *   ships first: the gutter is scrolled from the textarea's own scroll handler
 *   rather than sharing a scroll container, because the two elements must line up
 *   to the pixel and only one of them can own the scrollbar.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { cn } from '@/components/ui'

/** Two spaces. Not configurable, because a shared convention beats a preference
 *  nobody will find, and every language offered here tolerates two. */
const INDENT = '  '

/** A paste at or above this is reported. Chosen so a variable name, a URL or a
 *  single expression passes unremarked while a pasted function does not. */
const LARGE_PASTE_CHARS = 120

export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  minRows = 18,
  className,
  ariaLabel = 'Code editor',
  onLargePaste,
}: {
  value: string
  onChange: (next: string) => void
  readOnly?: boolean
  minRows?: number
  className?: string
  ariaLabel?: string
  /** A paste large enough to be a solution rather than a variable name.
   *  Reported, never blocked — see the note where it is wired up. */
  onLargePaste?: (chars: number) => void
}) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)

  const lines = useMemo(() => {
    const count = value.split('\n').length
    return Array.from({ length: Math.max(count, minRows) }, (_, i) => i + 1)
  }, [value, minRows])

  /* The gutter follows the textarea's scroll. Not a shared scroll container: the
     textarea owns the scrollbar (it has to, it is the focusable thing), so the
     gutter is driven from its scrollTop. */
  const syncScroll = useCallback(() => {
    if (gutterRef.current && areaRef.current) {
      gutterRef.current.scrollTop = areaRef.current.scrollTop
    }
  }, [])

  useEffect(syncScroll, [value, syncScroll])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const area = event.currentTarget
    const { selectionStart, selectionEnd } = area

    if (event.key === 'Tab') {
      event.preventDefault()
      if (event.shiftKey) {
        // Outdent: remove up to INDENT.length spaces from the start of the line.
        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
        const head = value.slice(lineStart, selectionStart)
        const trimmed = head.startsWith(INDENT) ? head.slice(INDENT.length) : head.replace(/^ /, '')
        const removed = head.length - trimmed.length
        if (!removed) return
        const next = value.slice(0, lineStart) + trimmed + value.slice(selectionStart)
        onChange(next)
        queueMicrotask(() => {
          area.selectionStart = area.selectionEnd = selectionStart - removed
        })
        return
      }
      const next = value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd)
      onChange(next)
      queueMicrotask(() => {
        area.selectionStart = area.selectionEnd = selectionStart + INDENT.length
      })
      return
    }

    if (event.key === 'Enter') {
      // Carry the current line's indentation onto the new one. Losing this in
      // Python is losing the program.
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
      const indent = (value.slice(lineStart, selectionStart).match(/^[ \t]*/) || [''])[0]
      if (!indent) return
      event.preventDefault()
      const insert = '\n' + indent
      const next = value.slice(0, selectionStart) + insert + value.slice(selectionEnd)
      onChange(next)
      queueMicrotask(() => {
        area.selectionStart = area.selectionEnd = selectionStart + insert.length
      })
    }
  }

  return (
    <div
      className={cn(
        'relative flex overflow-hidden rounded-md border border-rule bg-surface-sunk',
        'focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1',
        className,
      )}
    >
      <div
        ref={gutterRef}
        aria-hidden
        className="select-none overflow-hidden border-r border-rule bg-surface px-2.5 py-3 text-right font-mono text-[12.5px] leading-[1.55] text-ink-faint"
      >
        {lines.map((n) => (
          <div key={n}>{n}</div>
        ))}
      </div>
      <textarea
        ref={areaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={syncScroll}
        onPaste={(e) => {
          /* NOT prevented. Blocking paste in a code editor is hostile and
             counter-productive: a candidate legitimately pastes a helper they
             just wrote, or their own scratch work from the problem above. What is
             worth RECORDING is a paste large enough to be a whole solution, which
             is a signal a human can weigh — not a verdict this screen should
             reach on its own. */
          const pasted = e.clipboardData?.getData('text') ?? ''
          if (pasted.length >= LARGE_PASTE_CHARS) onLargePaste?.(pasted.length)
        }}
        readOnly={readOnly}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        rows={minRows}
        className="flex-1 resize-y bg-transparent px-3 py-3 font-mono text-[12.5px] leading-[1.55] text-ink outline-none"
      />
    </div>
  )
}
