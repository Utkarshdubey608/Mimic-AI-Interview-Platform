/**
 * MIMIC — a coding problem, as a candidate solves it.
 *
 * Mirrors McqStage: one screen, its own state, no interview engine behind it. A
 * coding assessment has no prep phase, no per-question server clock and no
 * adaptive generation, so it does not go anywhere near the timed engine.
 *
 * ── What a candidate can and cannot see ──────────────────────────────────
 * Everything on this screen comes from `GET /sessions/{id}/coding`, which projects
 * each problem through a server-side allow-list. There is no filtering here and
 * there must never be: hidden test cases and their expected outputs are absent
 * from the payload, not hidden by this component. A hidden case that fails reports
 * only that it failed — not why, not how long it took — because wrong-answer
 * versus time-limit is a hint about the input's size.
 *
 * ── Three things that matter more than they look ─────────────────────────
 *
 * 1. AUTOSAVE. Somebody is writing code under time pressure in a browser tab. A
 *    refresh, a flaky connection or an accidental back-navigation must not cost
 *    them the function they just wrote, so the editor is saved per problem,
 *    debounced, and restored on load. This is the single highest-value thing on
 *    the screen and it is invisible when it works.
 *
 * 2. RUN AND SUBMIT ARE DIFFERENT PROMISES. Run is the samples, inline, and it is
 *    free to press. Submit grades every case including the hidden ones, takes
 *    seconds, and is what counts. They are visually distinct and Submit says what
 *    it will do before it does it.
 *
 * 3. AN UNAVAILABLE JUDGE IS NOT THE CANDIDATE'S FAULT. If execution is not
 *    configured the routes answer 503, and this says so in a way that tells them
 *    what to do — contact the recruiter — rather than showing a failed test run
 *    that reads as their code being wrong.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2, Play, Send, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button, Select, cn } from '@/components/ui'
import { CodeEditor } from '@/features/coding/CodeEditor'
import { codingApi, codingRuntimeApi } from '@/lib/api'
import type { CodingResult, PublicCodingProblem } from '@shared/types'

/** How long after the last keystroke the draft is saved. Long enough not to post
 *  on every character, short enough that a refresh two seconds later is safe. */
const AUTOSAVE_MS = 1200

/** Poll interval for a submission. The server's own schedule is front-loaded; this
 *  is the client's, and 1s is well inside a candidate's patience. */
const POLL_MS = 1000

export function CodingStage({
  sessionId,
  onIntegrity,
}: {
  sessionId: string
  onIntegrity?: (kind: string) => void
}) {
  const state = useQuery({
    queryKey: ['coding-state', sessionId],
    queryFn: () => codingRuntimeApi.state(sessionId),
    refetchOnWindowFocus: false,
  })

  /* The language ids come from the JUDGE, never from a constant in this bundle.
     Judge0's ids are per-instance: a hard-coded id is either wrong on a rebuilt
     judge, or right and pointing at a 2019 interpreter. `id === null` means no
     judge is configured, and Run/Submit refuse rather than posting an id nothing
     can run. */
  const langs = useQuery({ queryKey: ['coding-languages'], queryFn: codingApi.languages })
  const judgeLanguages = useMemo(() => langs.data?.languages ?? [], [langs.data])
  const idFor = (key: string) => judgeLanguages.find((l) => l.key === key)?.id ?? null

  const problems = useMemo(() => state.data?.problems ?? [], [state.data])
  const [activeId, setActiveId] = useState<string | null>(null)
  const active: PublicCodingProblem | undefined =
    problems.find((p) => p.id === activeId) ?? problems[0]

  /* Source per problem, seeded from the saved draft, falling back to the starter
     code for the chosen language. The fallback only applies to a problem never
     opened — once there is a draft it wins, because a candidate who cleared the
     starter code meant to. */
  const [sources, setSources] = useState<Record<string, string>>({})
  const [language, setLanguage] = useState<string>('')
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current || !state.data) return
    seeded.current = true
    const initial = state.data.language || problems[0]?.allowedLanguages?.[0] || 'python'
    setLanguage(initial)
    const next: Record<string, string> = {}
    for (const problem of state.data.problems) {
      next[problem.id] =
        state.data.drafts?.[problem.id] ?? problem.starterCode?.[initial] ?? ''
    }
    setSources(next)
    setActiveId(state.data.problems[0]?.id ?? null)
  }, [state.data, problems])

  const source = active ? sources[active.id] ?? '' : ''

  const saveDraft = useMutation({
    mutationFn: (body: { problemId: string; source: string; language?: string }) =>
      codingRuntimeApi.saveDraft(sessionId, body),
  })

  /* Debounced autosave. The timer is per problem id, so switching problems flushes
     rather than discarding — losing the last edit because you clicked a tab would
     be the same bug as losing it to a refresh. */
  const timer = useRef<number | null>(null)
  const scheduleSave = useCallback(
    (problemId: string, next: string) => {
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        saveDraft.mutate({ problemId, source: next, language })
      }, AUTOSAVE_MS)
    },
    [language, saveDraft],
  )

  const flush = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (active) saveDraft.mutate({ problemId: active.id, source, language })
  }, [active, source, language, saveDraft])

  // A closing tab gets one last save attempt. Best-effort by nature.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [flush])

  /* Run answers one of two shapes: samples (per-case pass/fail) or custom input
     (raw streams, no verdict — there is nothing to compare against). */
  const [runResult, setRunResult] = useState<{
    result?: CodingResult
    streams?: Record<string, { stdout?: string; stderr?: string; compileOutput?: string }>
    custom?: { status: string; timeMs: number | null; memoryKb: number | null; stdout?: string; stderr?: string; compileOutput?: string }
  } | null>(null)
  /* "Run your own test" — a candidate debugging an edge case wants to try `0 0`
     without touching the problem's samples. Empty means "use the samples". */
  const [customInput, setCustomInput] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  const run = useMutation({
    mutationFn: () =>
      codingRuntimeApi.run(sessionId, {
        problemId: active!.id,
        source,
        languageId: idFor(language) as number,
        ...(showCustom && customInput.trim() ? { stdin: customInput } : {}),
      }),
    onSuccess: (data) => {
      setRunResult(data)
      setUnavailable(false)
    },
    onError: (e: Error) => {
      // 503 is "not set up", not "your code is wrong". Distinguished, because
      // showing a candidate a failure that is not theirs is the worst outcome here.
      if (/not available|not configured/i.test(e.message)) setUnavailable(true)
    },
  })

  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const submit = useMutation({
    mutationFn: () =>
      codingRuntimeApi.submit(sessionId, {
        problemId: active!.id,
        source,
        languageId: idFor(language) as number,
        language,
      }),
    onSuccess: (data) => setSubmissionId(data.submissionId),
    onError: (e: Error) => {
      if (/not available|not configured/i.test(e.message)) setUnavailable(true)
    },
  })

  const submission = useQuery({
    queryKey: ['coding-submission', sessionId, submissionId],
    queryFn: () => codingRuntimeApi.submission(sessionId, submissionId as string),
    enabled: !!submissionId,
    refetchInterval: (query) =>
      query.state.data?.status === 'IN_PROGRESS' ? POLL_MS : false,
  })

  const graded = submission.data?.status === 'COMPLETED' ? submission.data.result : undefined
  const grading = submission.data?.status === 'IN_PROGRESS' || submit.isPending

  /* What this problem allows, intersected with what the judge can actually run.
     A language the recruiter permitted but the judge lacks is not offered — better
     an absent option than one that fails on the candidate's first Run. */
  const languageOptions = useMemo(
    () =>
      judgeLanguages
        .filter((l) => (active?.allowedLanguages ?? []).includes(l.key) && l.id !== null)
        .map((l) => ({ value: l.key, label: l.version || l.label })),
    [active, judgeLanguages],
  )
  const canRun = !!language && idFor(language) !== null

  if (state.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-ground">
        <Loader2 className="animate-spin text-ink-muted" aria-label="Loading" />
      </div>
    )
  }

  if (!active) {
    return (
      <div className="grid min-h-screen place-items-center bg-ground px-6 text-center">
        <p className="text-sm text-ink-muted">This assessment has no problems set.</p>
      </div>
    )
  }

  return (
    <div data-ground="record" className="min-h-screen bg-ground">
      <header className="sticky top-0 z-sticky border-b border-rule bg-surface/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
          {/* Problem tabs. Only when there is more than one — a single-problem
              assessment does not need a tab strip telling it so. */}
          {problems.length > 1 && (
            <nav className="flex flex-wrap gap-1" aria-label="Problems">
              {problems.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    flush()
                    setActiveId(p.id)
                    setRunResult(null)
                    setSubmissionId(null)
                  }}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    p.id === active.id
                      ? 'bg-action text-action-ink'
                      : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
                  )}
                >
                  {i + 1}. {p.title}
                </button>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={language}
              onChange={(e) => {
                const next = e.target.value
                setLanguage(next)
                // Only reseed an untouched editor: replacing code somebody wrote
                // because they changed language would be unforgivable.
                setSources((s) =>
                  s[active.id]?.trim()
                    ? s
                    : { ...s, [active.id]: active.starterCode?.[next] ?? '' },
                )
              }}
              options={languageOptions.length ? languageOptions : [{ value: language, label: language }]}
              className="h-9 py-0 text-xs"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* ── the problem ── */}
        <section className="card space-y-4 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
              {active.difficulty} · {active.totalPoints} points
            </p>
            <h1 className="mt-1 font-display text-xl font-bold tracking-[-0.01em] text-ink">
              {active.title}
            </h1>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-body">
            {active.statementMd}
          </p>
          {active.ioFormat && (
            <div>
              <h2 className="field-label">Input / output</h2>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface-sunk p-3 font-mono text-xs text-ink-body">
                {active.ioFormat}
              </pre>
            </div>
          )}
          {active.constraints && (
            <div>
              <h2 className="field-label">Constraints</h2>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface-sunk p-3 font-mono text-xs text-ink-body">
                {active.constraints}
              </pre>
            </div>
          )}
          {active.examples.length > 0 && (
            <div>
              <h2 className="field-label">Examples</h2>
              <div className="mt-1 space-y-2">
                {active.examples.map((ex, i) => (
                  <div key={i} className="rounded-md bg-surface-sunk p-3 font-mono text-xs">
                    <p className="text-ink-muted">in</p>
                    <pre className="whitespace-pre-wrap text-ink">{ex.input}</pre>
                    <p className="mt-1.5 text-ink-muted">out</p>
                    <pre className="whitespace-pre-wrap text-ink">{ex.output}</pre>
                    {ex.explanation && (
                      <p className="mt-1.5 font-sans text-ink-muted">{ex.explanation}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="border-t border-rule pt-3 text-xs text-ink-muted">
            {active.sampleTests.length} sample test
            {active.sampleTests.length === 1 ? '' : 's'} you can run ·{' '}
            {active.hiddenTestCount} hidden test
            {active.hiddenTestCount === 1 ? '' : 's'} used for grading
          </p>
        </section>

        {/* ── the editor ── */}
        <section className="space-y-3">
          <CodeEditor
            value={source}
            language={language}
            onChange={(next) => {
              setSources((s) => ({ ...s, [active.id]: next }))
              scheduleSave(active.id, next)
            }}
            /* Paste detection, which the brief asks for and which has to be the
               right KIND of signal: recorded for a human to weigh, not blocked and
               not scored. A candidate pasting their own helper from the problem
               above is normal; a whole solution arriving at once is worth a
               recruiter knowing. The threshold and the reasoning live in
               CodeEditor. */
            onLargePaste={() => onIntegrity?.('code_pasted')}
            minRows={22}
            ariaLabel={`Your solution to ${active.title}`}
          />

          {!canRun && langs.data?.source === 'fallback' && (
            <div className="flex items-start gap-2 rounded-md border border-warn-rule bg-warn-bg p-3">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-warn" aria-hidden />
              <p className="text-sm text-ink-body">
                Code running is not available on this assessment. Your work is saved as you type —
                please tell the recruiter who invited you.
              </p>
            </div>
          )}
          {unavailable && (
            <div className="flex items-start gap-2 rounded-md border border-warn-rule bg-warn-bg p-3">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-warn" aria-hidden />
              <p className="text-sm text-ink-body">
                Code running is unavailable on this assessment. Your work is saved — please tell the
                recruiter who invited you.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon={<Play size={14} />}
              onClick={() => run.mutate()}
              disabled={run.isPending || !source.trim() || !canRun}
            >
              {run.isPending ? 'Running…' : 'Run samples'}
            </Button>
            <Button
              icon={<Send size={14} />}
              onClick={() => {
                flush()
                setRunResult(null)
                submit.mutate()
              }}
              disabled={grading || !source.trim() || !canRun}
            >
              {grading ? 'Grading…' : 'Submit'}
            </Button>
            <p className="text-xs text-ink-muted">
              Run checks the samples. Submit grades every test, including the hidden ones.
            </p>
          </div>

          {/* ── custom input ── */}
          <div>
            <button
              type="button"
              onClick={() => setShowCustom((v) => !v)}
              aria-expanded={showCustom}
              className="rounded-sm text-xs font-semibold text-ink-muted underline underline-offset-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {showCustom ? 'Use the sample tests' : 'Run your own input instead'}
            </button>
            {showCustom && (
              <div className="mt-2">
                <label className="block">
                  <span className="field-label">Your input (stdin)</span>
                  <textarea
                    rows={3}
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    spellCheck={false}
                    className="w-full rounded-md border border-rule bg-surface-sunk px-3 py-2 font-mono text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </label>
                <p className="mt-1 text-xs text-ink-muted">
                  Run uses this instead of the samples. There is no expected output to compare
                  against, so you get your program's output rather than a pass or fail.
                </p>
              </div>
            )}
          </div>

          {/* ── results ── */}
          {runResult?.custom && (
            <div className="card space-y-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-base font-bold text-ink">Your input</h2>
                <p className="text-xs text-ink-muted">
                  {runResult.custom.status.replace(/_/g, ' ')}
                  {runResult.custom.timeMs != null && ` · ${runResult.custom.timeMs}ms`}
                  {runResult.custom.memoryKb != null && ` · ${Math.round(runResult.custom.memoryKb / 1024)}MB`}
                </p>
              </div>
              {runResult.custom.compileOutput && (
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-risk-bg p-2 font-mono text-[11px] text-risk">
                  {runResult.custom.compileOutput}
                </pre>
              )}
              <div>
                <p className="field-label">Output</p>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-surface-sunk p-2 font-mono text-[11px] text-ink">
                  {runResult.custom.stdout || '(nothing printed)'}
                </pre>
              </div>
              {runResult.custom.stderr && (
                <div>
                  <p className="field-label">Errors</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-surface-sunk p-2 font-mono text-[11px] text-risk">
                    {runResult.custom.stderr}
                  </pre>
                </div>
              )}
            </div>
          )}
          {(graded || runResult?.result) && (
            <div className="card p-4">
              <ResultBlock
                result={(graded ?? runResult?.result) as CodingResult}
                streams={graded ? undefined : runResult?.streams}
                heading={graded ? 'Submitted' : 'Sample run'}
              />
            </div>
          )}
          {submission.data?.status === 'FAILED' && (
            <div className="flex items-start gap-2 rounded-md border border-warn-rule bg-warn-bg p-3">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-warn" aria-hidden />
              <p className="text-sm text-ink-body">
                {submission.data.error || 'That submission could not be graded.'} Your code is saved.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

/** One result, run or submitted. Hidden cases show pass/fail and nothing else. */
function ResultBlock({
  result,
  streams,
  heading,
}: {
  result: CodingResult
  streams?: Record<string, { stdout?: string; stderr?: string; compileOutput?: string }>
  heading: string
}) {
  const compileOutput = streams
    ? Object.values(streams).find((s) => s.compileOutput)?.compileOutput
    : undefined

  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-bold text-ink">{heading}</h2>
        <p className="text-sm text-ink-muted">
          {result.passed} of {result.total} passed
        </p>
      </div>

      {result.compileFailed && (
        <div className="mb-2 rounded-md border border-risk-rule bg-risk-bg p-3">
          <p className="text-sm font-semibold text-risk">It did not compile.</p>
          {compileOutput && (
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-ink-body">
              {compileOutput}
            </pre>
          )}
        </div>
      )}

      <ul className="space-y-1.5">
        {result.cases.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-xs">
            {c.passed ? (
              <Check size={13} className="mt-0.5 flex-shrink-0 text-ok" aria-hidden />
            ) : (
              <X size={13} className="mt-0.5 flex-shrink-0 text-risk" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <span className="text-ink">
                {c.hidden ? 'Hidden test' : `Sample ${c.id}`}
              </span>
              {/* Absent for a hidden case by design — the server does not send it. */}
              {c.status && !c.hidden && (
                <span className="ml-1.5 text-ink-muted">{c.status.replace(/_/g, ' ')}</span>
              )}
              {c.timeMs != null && <span className="ml-1.5 text-ink-faint">{c.timeMs}ms</span>}
              {streams?.[c.id]?.stdout !== undefined && !c.passed && !c.hidden && (
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-surface-sunk p-2 font-mono text-[11px] text-ink-body">
                  got: {JSON.stringify(streams[c.id].stdout)}
                </pre>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
