/**
 * The candidate writing one essay.
 *
 * THE CLOCK IS THE SERVER'S. `remainingSeconds` arrives from the backend and is
 * ticked down locally only so the number moves; every save re-synchronises it. A
 * countdown owned by the browser is a countdown a candidate can change, and the
 * deadline is really the session's start time plus the configured limit.
 *
 * NOTHING IS LOST. The draft saves on a debounce and again on unload, and when
 * the clock reaches zero the essay is SUBMITTED rather than discarded — whatever
 * exists at that moment is the answer. A blank page at the end of forty minutes
 * because a timer expired is the worst possible outcome of an assessment.
 *
 * THE COUNTER MUST AGREE WITH THE SERVER, or a candidate watching it read 249 is
 * rejected for "under 250" by two implementations disagreeing rather than by
 * their writing. It counts runs of non-whitespace containing a word character,
 * which is `essay.count_words` in Python, deliberately.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Clock, Loader2, Send } from 'lucide-react'

import { Button, cn } from '@/components/ui'
import { essayApi, type EssaySessionState, type EssayTimelineEvent } from '@/lib/api'
import { toast } from 'react-hot-toast'

/** How long after the last keystroke the draft is saved. Long enough not to post
 *  on every letter, short enough that a crash costs a sentence and not a page. */
const AUTOSAVE_MS = 1_500
/** Below this the countdown turns urgent. */
const WARN_SECONDS = 120

/** The same rule as `essay.count_words` on the server. Two counters that disagree
 *  fail candidates for limits they believed they had met. */
const countWords = (text: string) =>
  (text.match(/\S+/g) ?? []).filter((t) => /\w/u.test(t)).length
const countChars = (text: string) => text.replace(/\r\n/g, '\n').length

const clock = (total: number) => {
  const s = Math.max(0, total)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function EssayStage({
  sessionId,
  onIntegrity,
}: {
  sessionId: string
  onIntegrity?: (kind: string) => void
}) {
  const [state, setState] = useState<EssaySessionState | null>(null)
  const [text, setText] = useState('')
  const [left, setLeft] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timeline = useRef<EssayTimelineEvent[]>([])
  const latest = useRef('')
  const submitted = useRef(false)
  const started = useRef(Date.now())

  latest.current = text

  /* ── load ── */
  useEffect(() => {
    let alive = true
    essayApi
      .state(sessionId)
      .then((s) => {
        if (!alive) return
        setState(s)
        setText(s.draft)
        setLeft(s.remainingSeconds)
        setDone(s.submitted)
      })
      .catch(() => alive && setError('This essay could not be loaded. Please refresh.'))
    return () => {
      alive = false
    }
  }, [sessionId])

  /* ── the local tick. Cosmetic: every save re-syncs from the server. ── */
  useEffect(() => {
    if (done || !state) return
    const id = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1_000)
    return () => clearInterval(id)
  }, [done, state])

  const save = useCallback(
    async (body: string) => {
      setSaving(true)
      try {
        const ack = await essayApi.saveDraft(sessionId, body, timeline.current.splice(0))
        setSavedAt(Date.now())
        // The server's clock wins over the local tick, every time.
        setLeft(ack.remainingSeconds)
      } catch {
        /* A failed autosave is not worth interrupting someone mid-sentence: the
           next one carries the same text, and unload saves again. */
      } finally {
        setSaving(false)
      }
    },
    [sessionId],
  )

  const submit = useCallback(
    async (auto: boolean) => {
      if (submitted.current || !latest.current.trim()) {
        if (!auto) toast.error('There is nothing written to submit yet.')
        return
      }
      submitted.current = true
      setSubmitting(true)
      try {
        const res = await essayApi.submit(sessionId, latest.current)
        setDone(true)
        toast.success(
          res.late ? 'Submitted. The time had run out, and your work was kept.' : 'Essay submitted.',
        )
      } catch {
        submitted.current = false
        setError('That could not be submitted. Your work is saved — please try again.')
      } finally {
        setSubmitting(false)
      }
    },
    [sessionId],
  )

  /* ── auto-submit at zero. Send what exists rather than lose it. ── */
  useEffect(() => {
    if (!state || done || submitted.current) return
    if (left <= 0 && state.remainingSeconds > 0) void submit(true)
  }, [left, state, done, submit])

  /* ── save on the way out ── */
  useEffect(() => {
    const flush = () => {
      if (!submitted.current && latest.current) void save(latest.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [save])

  const onChange = (next: string) => {
    setText(next)
    // Behavioural evidence of composition: when this was typed and how much
    // changed. Not content, and no keystrokes — enough to tell writing from
    // pasting, and nothing that reads like surveillance.
    timeline.current.push({
      t: Math.round((Date.now() - started.current) / 1000),
      a: next.length,
      d: next.length - latest.current.length,
    })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(next), AUTOSAVE_MS)
  }

  const words = useMemo(() => countWords(text), [text])
  const chars = useMemo(() => countChars(text), [text])
  const min = state?.prompt.minWords ?? 0
  const max = state?.prompt.maxWords ?? 0
  const under = min > 0 && words < min
  const over = max > 0 && words > max
  const urgent = left <= WARN_SECONDS && left > 0

  if (error && !state) {
    return <p className="mx-auto max-w-md p-8 text-center text-sm text-risk">{error}</p>
  }
  if (!state) {
    return (
      <div className="flex h-64 items-center justify-center text-ink-muted">
        <Loader2 className="animate-spin" size={18} />
      </div>
    )
  }
  if (done) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <Check className="mx-auto mb-3 text-ok" size={30} />
        <h2 className="text-lg font-bold text-ink">Your essay is submitted</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {words.toLocaleString()} words. Nothing further is needed from you.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto grid h-full w-full max-w-[1400px] gap-4 p-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,9fr)]">
      {/* the task */}
      <aside className="min-h-0 overflow-y-auto rounded-2xl border border-border bg-surface p-5">
        <h1 className="text-lg font-bold text-ink">{state.prompt.title || 'Essay'}</h1>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {state.prompt.promptMd}
        </p>
        {state.prompt.sourcePassageMd ? (
          <div className="mt-5 rounded-xl border border-rule bg-surface-sunk p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Source material
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {state.prompt.sourcePassageMd}
            </p>
          </div>
        ) : null}
        {min > 0 || max > 0 ? (
          <p className="mt-5 text-xs text-ink-muted">
            {min > 0 && max > 0
              ? `Write between ${min} and ${max} words.`
              : min > 0
                ? `Write at least ${min} words.`
                : `Write no more than ${max} words.`}
          </p>
        ) : null}
      </aside>

      {/* the writing */}
      <section className="flex min-h-0 flex-col rounded-2xl border border-border bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-2.5">
          <div className="flex items-center gap-4 text-xs">
            <span
              className={cn(
                'font-mono tabular-nums',
                under || over ? 'font-bold text-risk' : 'text-ink-muted',
              )}
            >
              {words.toLocaleString()}
              {max > 0 ? ` / ${max.toLocaleString()}` : ''} words
            </span>
            <span className="font-mono tabular-nums text-ink-faint">
              {chars.toLocaleString()} characters
            </span>
            <span className="flex items-center gap-1 text-ink-faint" aria-live="polite">
              {saving ? (
                <>
                  <Loader2 className="animate-spin" size={12} /> Saving
                </>
              ) : savedAt ? (
                <>
                  <Check size={12} /> Saved
                </>
              ) : null}
            </span>
          </div>
          <span
            className={cn(
              'flex items-center gap-1.5 font-mono text-sm tabular-nums',
              urgent ? 'font-bold text-risk' : 'text-ink',
            )}
            aria-live={urgent ? 'assertive' : 'off'}
          >
            <Clock size={14} /> {clock(left)}
          </span>
        </header>

        {under || over ? (
          <p className="flex items-center gap-2 border-b border-rule bg-risk-bg/40 px-4 py-2 text-xs text-risk">
            <AlertTriangle size={13} />
            {under
              ? `${min - words} more words to reach the minimum.`
              : `${words - max} words over the maximum.`}
          </p>
        ) : null}

        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            // Reported, not silently swallowed: the recruiter configured whether
            // paste is allowed, and a candidate who pastes should know it was seen
            // rather than wonder why nothing appeared.
            if ((e.clipboardData?.getData('text').length ?? 0) > 0) onIntegrity?.('answer_pasted')
          }}
          spellCheck={false}
          aria-label="Your essay"
          placeholder="Begin writing here. Your work saves automatically."
          className="min-h-0 flex-1 resize-none bg-transparent px-5 py-4 text-[15px] leading-[1.75] text-ink outline-none placeholder:text-ink-faint"
        />

        <footer className="flex items-center justify-between gap-3 border-t border-rule px-4 py-3">
          <p className="text-xs text-ink-faint">
            Saves automatically. At zero, whatever you have written is submitted.
          </p>
          <Button onClick={() => void submit(false)} loading={submitting} disabled={!text.trim()}>
            <Send size={14} /> Submit essay
          </Button>
        </footer>
      </section>
    </div>
  )
}
