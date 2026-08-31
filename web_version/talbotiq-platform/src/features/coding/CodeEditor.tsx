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
 * It DOES now get syntax highlighting, without either of them: `highlight.ts`
 * tokenises the buffer and the result is painted on a layer BEHIND a
 * transparent-text textarea. The reason that is safe rather than a hack is one
 * property the tokenizer is tested for — joining its tokens reproduces the input
 * exactly — so the two layers are the same string laid out by the same rules, and
 * cannot drift. Everything above this file still passes a string and a language,
 * which is the whole interface, so swapping in CodeMirror later remains a change
 * to these two files and nothing else.
 *
 * THE ALIGNMENT RULES, which is where this technique is normally got wrong: the
 * textarea and the layer must share font, size, line-height, padding, whitespace
 * handling and width EXACTLY, and only the textarea may own a scrollbar. Both are
 * driven from the same class string below for that reason, and the layer is
 * scrolled from the textarea's scroll handler, the same mechanism the gutter has
 * always used. `resize-y` is gone from the textarea: a user-dragged height would
 * move one layer and not the other.
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
import { canHighlight, tokenize, type TokenKind } from './highlight'

/** Two spaces. Not configurable, because a shared convention beats a preference
 *  nobody will find, and every language offered here tolerates two. */
const INDENT = '  '

/* The geometry both layers must agree on, to the pixel. One string, used twice,
   because two copies of this that drift by a padding value is exactly the bug
   this technique is famous for. */
const LAYER = 'px-3 py-3 font-mono text-[12.5px] leading-[1.55]'

/* Four token classes, and only existing design tokens — no new palette invented
   for this. Comments recede to the quietest permissible TEXT tier, keywords take
   the accent as ink, strings take the teal, and numbers stay body ink so digits
   do not compete with control flow. Every one of these is already contrast-gated
   for text use, which is why they were chosen over nicer-looking hexes. */
const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: 'text-ink-faint italic',
  keyword: 'text-accent-ink font-semibold',
  string: 'text-ai',
  number: 'text-ink-body',
  plain: '',
}

/** A paste at or above this is reported. Chosen so a variable name, a URL or a
 *  single expression passes unremarked while a pasted function does not. */
const LARGE_PASTE_CHARS = 120

export function CodeEditor({
  value,
  onChange,
  language = '',
  readOnly = false,
  minRows = 18,
  className,
  ariaLabel = 'Code editor',
  onLargePaste,
}: {
  value: string
  onChange: (next: string) => void
  /** Canonical language key, e.g. `python`. An unknown or absent one renders
   *  plain — a wrong highlight is worse than none. */
  language?: string
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
  const layerRef = useRef<HTMLPreElement | null>(null)

  /* Re-tokenised on every keystroke, which is affordable: the scanner is one pass
     over a buffer bounded at 100 KB by the server's own draft limit, and the
     result is a flat array. Memoised on the pair so a re-render that changes
     neither does not redo it. */
  const tokens = useMemo(
    () => (canHighlight(language) ? tokenize(value, language) : null),
    [value, language],
  )

  const lines = useMemo(() => {
    const count = value.split('\n').length
    return Array.from({ length: Math.max(count, minRows) }, (_, i) => i + 1)
  }, [value, minRows])

  /* The gutter follows the textarea's scroll. Not a shared scroll container: the
     textarea owns the scrollbar (it has to, it is the focusable thing), so the
     gutter is driven from its scrollTop. */
  const syncScroll = useCallback(() => {
    const area = areaRef.current
    if (!area) return
    if (gutterRef.current) gutterRef.current.scrollTop = area.scrollTop
    if (layerRef.current) {
      layerRef.current.scrollTop = area.scrollTop
      // Horizontally as well: a long line scrolls the textarea sideways, and a
      // layer that only followed vertically would slide out from under the caret.
      layerRef.current.scrollLeft = area.scrollLeft
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
      <div className="relative flex-1">
        {tokens && (
          <pre
            ref={layerRef}
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-ink',
              LAYER,
            )}
          >
            {tokens.map((t, i) =>
              t.kind === 'plain'
                ? t.text
                : (
                  <span key={i} className={TOKEN_CLASS[t.kind]}>
                    {t.text}
                  </span>
                ),
            )}
            {/* A trailing newline has no glyph, so without this the layer is one
                line shorter than the textarea and the last line's scroll extent
                disagrees. */}
            {'\n'}
          </pre>
        )}
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
        /* No soft wrap. A wrapped line takes two rows and gets one number, so the
           gutter starts lying about which line a compiler error is on — and the
           gutter is the reason it exists. Long lines scroll sideways instead, which
           is what every code editor does. */
        wrap="off"
        className={cn(
          'relative w-full resize-none overflow-auto whitespace-pre bg-transparent outline-none',
          // Transparent TEXT, not a transparent element: the caret and the
          // selection must still be the textarea's, because those are the things
          // a painted layer cannot do.
          tokens ? 'text-transparent caret-ink selection:bg-accent-soft' : 'text-ink',
          LAYER,
        )}
      />
      </div>
    </div>
  )
}
