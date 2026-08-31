/**
 * Coding problems — authoring.
 *
 * Mirrors McqSetsPage deliberately: the same rail on the left, the same
 * New/Save/Delete, the same inline faults. A recruiter who can author an
 * assessment paper should not have to learn a second editor to author a coding
 * problem.
 *
 * ── The two things this editor must get right ────────────────────────────
 *
 * 1. THE DIFFERENCE BETWEEN A SAMPLE AND A HIDDEN CASE HAS TO BE OBVIOUS, because
 *    it is the only decision here with a security consequence. A sample publishes
 *    its expected output to the candidate; a hidden case publishes nothing. Get it
 *    backwards and you have handed out the answer. So the toggle is a labelled
 *    control with the consequence written next to it, not a bare checkbox — and a
 *    new case defaults to HIDDEN, matching the server, because the failure mode of
 *    the other default is publishing an answer.
 *
 * 2. A PROBLEM WHOSE OWN SOLUTION FAILS ITS TESTS IS THE COMMONEST AUTHORING BUG
 *    in this category of product — usually a trailing newline, or an expected
 *    output written by hand that the program never produces. Without a way to try
 *    it, a recruiter discovers it from a candidate's complaint. So there is a
 *    "Check against samples" panel: paste a reference solution, run it, see the
 *    diff. It uses the same judge the candidate will.
 *
 * Faults are shown as the recruiter types rather than raised on save, because a
 * problem that fails on its ninth test case is a bad way to find out. Saving stays
 * permissive — the server stores a draft and reports what still stops it being
 * SENT, which is the same line McqSetsPage draws.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Eye, Play, Plus, Trash2, Upload, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'

import {
  Button,
  Input,
  Modal,
  PageContainer,
  Select,
  Textarea,
  cn,
} from '@/components/ui'
import { CodeEditor } from '@/features/coding/CodeEditor'
import { codingApi } from '@/lib/api'
import type { CodingLanguage, CodingProblem, CodingTestCase } from '@shared/types'

const EMPTY: Partial<CodingProblem> = {
  title: '',
  statementMd: '',
  constraints: '',
  ioFormat: '',
  examples: [],
  starterCode: {},
  testCases: [],
  timeLimitMs: 2000,
  memoryMb: 128,
  difficulty: 'medium',
  tags: [],
  allowedLanguages: ['python'],
}

function newCase(index: number): CodingTestCase {
  return {
    id: `tc${index + 1}`,
    input: '',
    expectedOutput: '',
    // HIDDEN by default, matching the server. See the header.
    hidden: true,
    points: 1,
  }
}

export default function CodingProblemsPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<CodingProblem>>(EMPTY)
  const [checkOpen, setCheckOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const list = useQuery({ queryKey: ['coding-problems'], queryFn: codingApi.list })

  /* The languages come from the JUDGE, not from a constant here. Judge0's ids are
     per-instance, and the documented ones are the legacy set — a hard-coded list
     gave every candidate Python 3.8 and Node 12 while the same judge offered 3.14
     and 22. `version` is shown beside each chip so a recruiter can see exactly
     which interpreter they are committing their candidates to. */
  const langs = useQuery({ queryKey: ['coding-languages'], queryFn: codingApi.languages })
  const languages = langs.data?.languages ?? []

  const loaded = useQuery({
    queryKey: ['coding-problem', selectedId],
    queryFn: () => codingApi.get(selectedId as string),
    enabled: !!selectedId,
  })

  // The loaded problem becomes the draft once, when it arrives. Keyed on the id so
  // switching problems replaces the draft rather than merging into it.
  const loadedId = loaded.data?.problem?.id
  const [syncedId, setSyncedId] = useState<string | null>(null)
  if (loadedId && loadedId !== syncedId) {
    setSyncedId(loadedId)
    setDraft(loaded.data!.problem)
  }

  const save = useMutation({
    mutationFn: async () => {
      if (selectedId) return codingApi.update(selectedId, draft)
      return codingApi.create(draft)
    },
    onSuccess: (data) => {
      setSelectedId(data.problem.id)
      setSyncedId(data.problem.id)
      setDraft(data.problem)
      void queryClient.invalidateQueries({ queryKey: ['coding-problems'] })
      toast.success(data.faults.length ? 'Saved as a draft' : 'Saved')
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => codingApi.remove(id),
    onSuccess: () => {
      setSelectedId(null)
      setSyncedId(null)
      setDraft(EMPTY)
      void queryClient.invalidateQueries({ queryKey: ['coding-problems'] })
      toast.success('Deleted')
    },
  })

  /* Faults computed here as well as on the server. Not duplication for its own
     sake: the server decides, and this shows the same thing WHILE TYPING so a
     nine-case problem does not fail on save. The list of rules is short and
     stable, and the server remains the one that refuses. */
  const faults = useMemo(() => {
    const out: string[] = []
    const cases = draft.testCases || []
    if (!draft.title?.trim()) out.push('The problem needs a title.')
    if (!draft.statementMd?.trim()) out.push('The problem needs a statement.')
    if (!(draft.allowedLanguages || []).length) out.push('Choose at least one language.')
    if (!cases.length) out.push('The problem needs at least one test case.')
    else {
      if (!cases.some((c) => !c.hidden)) out.push('At least one test case must be a visible sample.')
      if (cases.reduce((n, c) => n + (Number(c.points) || 0), 0) <= 0)
        out.push('The test cases carry no points, so the problem cannot be scored.')
    }
    return out
  }, [draft])

  const setCase = (index: number, patch: Partial<CodingTestCase>) =>
    setDraft((d) => ({
      ...d,
      testCases: (d.testCases || []).map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }))

  const sampleCount = (draft.testCases || []).filter((c) => !c.hidden).length
  const hiddenCount = (draft.testCases || []).length - sampleCount
  const totalPoints = (draft.testCases || []).reduce((n, c) => n + (Number(c.points) || 0), 0)

  return (
    <PageContainer>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink">
            Coding problems
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Problems a candidate solves in an editor, graded against test cases by a sandboxed judge.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<Upload size={14} />} onClick={() => setImportOpen(true)}>
            Import
          </Button>
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => {
              setSelectedId(null)
              setSyncedId(null)
              setDraft(EMPTY)
            }}
          >
            New problem
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        {/* ── the rail ── */}
        <aside className="card p-2">
          {list.isLoading ? (
            <p className="p-3 text-sm text-ink-muted">Loading…</p>
          ) : !list.data?.length ? (
            <p className="p-3 text-sm text-ink-muted">
              No problems yet. A problem needs a statement, at least one visible sample and one
              hidden case to be worth setting.
            </p>
          ) : (
            <ul className="space-y-1">
              {list.data.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={[
                      'w-full rounded-md px-3 py-2 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      selectedId === p.id ? 'bg-action-soft text-ink' : 'hover:bg-surface-hover',
                    ].join(' ')}
                  >
                    <span className="block truncate text-sm font-semibold text-ink">
                      {p.title || 'Untitled problem'}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                      <span className="capitalize">{p.difficulty}</span>
                      <span aria-hidden>·</span>
                      <span>{p.testCount} tests</span>
                      {p.faults.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-warn">
                          <AlertTriangle size={11} aria-hidden /> draft
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── the editor ── */}
        <section className="space-y-5">
          <div className="card space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]">
              <label className="block">
                <span className="field-label">Title</span>
                <Input
                  value={draft.title || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Two Sum"
                />
              </label>
              <label className="block">
                <span className="field-label">Difficulty</span>
                <Select
                  value={draft.difficulty || 'medium'}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, difficulty: e.target.value as CodingProblem['difficulty'] }))
                  }
                  options={[
                    { value: 'easy', label: 'Easy' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'hard', label: 'Hard' },
                  ]}
                />
              </label>
              <label className="block">
                <span className="field-label">Time limit</span>
                <Select
                  value={String(draft.timeLimitMs || 2000)}
                  onChange={(e) => setDraft((d) => ({ ...d, timeLimitMs: Number(e.target.value) }))}
                  options={[1000, 2000, 3000, 5000, 10000].map((ms) => ({
                    value: String(ms),
                    label: `${ms / 1000}s per case`,
                  }))}
                />
              </label>
            </div>

            <label className="block">
              <span className="field-label">Statement</span>
              <Textarea
                rows={6}
                value={draft.statementMd || ''}
                onChange={(e) => setDraft((d) => ({ ...d, statementMd: e.target.value }))}
                placeholder="Given an array of integers and a target, return the indices of the two numbers that add up to the target."
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Constraints</span>
                <Textarea
                  rows={3}
                  value={draft.constraints || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, constraints: e.target.value }))}
                  placeholder={'2 <= n <= 100000\n-10^9 <= a[i] <= 10^9'}
                />
              </label>
              <label className="block">
                <span className="field-label">Input / output format</span>
                <Textarea
                  rows={3}
                  value={draft.ioFormat || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, ioFormat: e.target.value }))}
                  placeholder={'Line 1: n and target\nLine 2: n integers'}
                />
              </label>
            </div>

            <fieldset>
              <legend className="field-label">Languages a candidate may answer in</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {languages.map((lang) => {
                  const on = (draft.allowedLanguages || []).includes(lang.key)
                  return (
                    <button
                      key={lang.key}
                      type="button"
                      aria-pressed={on}
                      title={lang.version ?? undefined}
                      onClick={() =>
                        setDraft((d) => {
                          const current = d.allowedLanguages || []
                          return {
                            ...d,
                            allowedLanguages: on
                              ? current.filter((k) => k !== lang.key)
                              : [...current, lang.key],
                            /* Turning a language ON prefills its skeleton, unless
                               the recruiter has already written one. Nobody should
                               hand-write nine stdin readers, and a candidate should
                               not spend their first minutes remembering how to
                               read stdin in C#. */
                            starterCode: on
                              ? d.starterCode
                              : { ...(d.starterCode || {}), [lang.key]: (d.starterCode || {})[lang.key] || lang.starter },
                          }
                        })
                      }
                      className={[
                        'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        on
                          ? 'border-action-edge bg-action text-action-ink'
                          : 'border-rule text-ink-muted hover:border-rule-strong hover:text-ink',
                      ].join(' ')}
                    >
                      {on && <Check size={11} className="mr-1 inline" aria-hidden />}
                      {lang.label}
                    </button>
                  )
                })}
              </div>
              {langs.data && langs.data.source !== 'judge' && (
                <p className="mt-2 text-xs leading-relaxed text-warn">
                  {langs.data.source === 'fallback'
                    ? 'Code execution is not configured on this deployment, so these are names only — a problem can be authored now and run once a judge is connected.'
                    : 'The judge is configured but did not answer, so this list may be out of date.'}
                </p>
              )}
              {languages.length > 0 && langs.data?.source === 'judge' && (
                <p className="mt-2 text-xs text-ink-muted">
                  Versions come from the judge itself:{' '}
                  {languages.map((l) => l.version).filter(Boolean).join(' · ')}
                </p>
              )}
            </fieldset>
          </div>

          {/* ── test cases ── */}
          <div className="card p-5">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-ink">Test cases</h2>
              <p className="text-xs text-ink-muted">
                {sampleCount} sample · {hiddenCount} hidden · {totalPoints} points
              </p>
            </div>
            {/* The consequence, in words, next to the control that decides it. */}
            <p className="mb-4 max-w-[46rem] text-xs leading-relaxed text-ink-muted">
              A <strong className="text-ink">sample</strong> is shown to the candidate with its
              expected output — that is what lets them diff a failure. A{' '}
              <strong className="text-ink">hidden</strong> case is never sent to their browser at
              all. New cases start hidden.
            </p>

            <div className="space-y-3">
              {(draft.testCases || []).map((c, i) => (
                <div key={i} className="rounded-md border border-rule p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs text-ink-faint">{c.id || `tc${i + 1}`}</span>
                    <label className="inline-flex items-center gap-1.5 text-xs">
                      <span className="text-ink-muted">Visibility</span>
                      <Select
                        value={c.hidden ? 'hidden' : 'sample'}
                        onChange={(e) => setCase(i, { hidden: e.target.value === 'hidden' })}
                        className="h-8 py-0 text-xs"
                        options={[
                          { value: 'hidden', label: 'Hidden' },
                          { value: 'sample', label: 'Sample (shown)' },
                        ]}
                      />
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-xs">
                      <span className="text-ink-muted">Points</span>
                      <Input
                        type="number"
                        min={0}
                        value={String(c.points ?? 1)}
                        onChange={(e) => setCase(i, { points: Number(e.target.value) })}
                        className="h-8 w-16 py-0 text-xs"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          testCases: (d.testCases || []).filter((_, j) => j !== i),
                        }))
                      }
                      aria-label={`Remove test case ${i + 1}`}
                      className="ml-auto rounded-md p-1.5 text-ink-faint transition-colors hover:bg-risk-bg hover:text-risk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="field-label">Input (stdin)</span>
                      <Textarea
                        rows={3}
                        className="font-mono text-xs"
                        value={c.input}
                        onChange={(e) => setCase(i, { input: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Expected output</span>
                      <Textarea
                        rows={3}
                        className="font-mono text-xs"
                        value={c.expectedOutput}
                        onChange={(e) => setCase(i, { expectedOutput: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              icon={<Plus size={14} />}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  testCases: [...(d.testCases || []), newCase((d.testCases || []).length)],
                }))
              }
            >
              Add test case
            </Button>
          </div>

          {/* ── faults, then save ── */}
          {faults.length > 0 && (
            <div className="rounded-md border border-warn-rule bg-warn-bg p-4">
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-warn">
                <AlertTriangle size={14} aria-hidden /> Not ready to set
              </p>
              <ul className="ml-5 list-disc space-y-0.5 text-sm text-ink-body">
                {faults.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-muted">
                You can still save it as a draft.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : selectedId ? 'Save changes' : 'Create problem'}
            </Button>
            {selectedId && (
              <>
                <Button variant="secondary" icon={<Play size={14} />} onClick={() => setCheckOpen(true)}>
                  Check against samples
                </Button>
                <Button
                  variant="secondary"
                  icon={<Eye size={14} />}
                  onClick={async () => {
                    try {
                      const { problem } = await codingApi.preview(selectedId)
                      toast.success(
                        `A candidate sees ${problem.sampleTests.length} sample${
                          problem.sampleTests.length === 1 ? '' : 's'
                        } and is told there are ${problem.hiddenTestCount} hidden.`,
                      )
                    } catch (e) {
                      toast.error((e as Error).message)
                    }
                  }}
                >
                  What a candidate sees
                </Button>
                <Button
                  variant="ghost"
                  className="ml-auto text-risk"
                  icon={<Trash2 size={14} />}
                  onClick={() => remove.mutate(selectedId)}
                >
                  Delete
                </Button>
              </>
            )}
          </div>
        </section>
      </div>

      {selectedId && (
        <CheckModal
          open={checkOpen}
          onClose={() => setCheckOpen(false)}
          problemId={selectedId}
          languages={languages}
        />
      )}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => void queryClient.invalidateQueries({ queryKey: ['coding-problems'] })}
      />
    </PageContainer>
  )
}

/**
 * "Check against samples" — paste a reference solution and run it.
 *
 * The point of this panel is one specific bug: an expected output written by hand
 * that the program never produces, usually differing by a trailing newline. It is
 * invisible on the page and obvious the moment something runs.
 */
function CheckModal({
  open,
  onClose,
  problemId,
  languages,
}: {
  open: boolean
  onClose: () => void
  problemId: string
  languages: CodingLanguage[]
}) {
  const [source, setSource] = useState('')
  /* Seeded from the judge's own list rather than a constant. 0 means "no judge",
     which the Run button below refuses rather than sending an id nothing can run. */
  const runnable = languages.filter((l) => l.id !== null)
  const [languageId, setLanguageId] = useState<number>(runnable[0]?.id ?? 0)

  const run = useMutation({
    mutationFn: () => codingApi.run(problemId, { source, languageId }),
    onError: (e: Error) => toast.error(e.message || 'Could not run'),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Check against samples"
      description="Runs on the same sandboxed judge a candidate uses. Only the visible samples."
      width="max-w-3xl"
    >
      <div className="space-y-3">
        <label className="block">
          <span className="field-label">Language</span>
          <Select
            value={String(languageId)}
            onChange={(e) => setLanguageId(Number(e.target.value))}
            options={runnable.map((l) => ({ value: String(l.id), label: l.version || l.label }))}
          />
        </label>
        {/* The key, not the id: highlighting is keyed by canonical language, and
            the id is per-judge. */}
        <CodeEditor
          value={source}
          onChange={setSource}
          language={runnable.find((l) => l.id === languageId)?.key ?? ''}
          minRows={12}
          ariaLabel="Reference solution"
        />
        <Button
          onClick={() => run.mutate()}
          disabled={run.isPending || !source.trim() || !languageId}
          icon={<Play size={14} />}
        >
          {run.isPending ? 'Running…' : 'Run'}
        </Button>
        {!runnable.length && (
          <p className="text-xs text-warn">
            Code execution is not configured on this deployment, so there is nothing to run against yet.
          </p>
        )}

        {run.data && (
          <div className="rounded-md border border-rule p-3">
            <p className="mb-2 text-sm font-semibold text-ink">
              {run.data.result.passed} of {run.data.result.total} samples passed
            </p>
            <ul className="space-y-2 text-xs">
              {run.data.result.cases.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  {c.passed ? (
                    <Check size={13} className="mt-0.5 flex-shrink-0 text-ok" aria-hidden />
                  ) : (
                    <X size={13} className="mt-0.5 flex-shrink-0 text-risk" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <span className="font-mono text-ink">{c.id}</span>{' '}
                    <span className="text-ink-muted">{c.status?.replace(/_/g, ' ')}</span>
                    {run.data.streams?.[c.id!]?.compileOutput && (
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-surface-sunk p-2 font-mono text-[11px] text-risk">
                        {run.data.streams[c.id!].compileOutput}
                      </pre>
                    )}
                    {!c.passed && run.data.streams?.[c.id!]?.stdout !== undefined && (
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-surface-sunk p-2 font-mono text-[11px] text-ink-body">
                        got: {JSON.stringify(run.data.streams[c.id!].stdout)}
                      </pre>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * Structured import — the lawful way to bring a bank in.
 *
 * There is no URL field here on purpose. Problems on LeetCode and HackerEarth are
 * somebody else's copyright and their terms prohibit scraping, so this takes a
 * bundle the recruiter owns instead. Rejections are reported per entry, because
 * one malformed problem in forty should not discard the rest.
 */
function ImportModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [text, setText] = useState('')

  const run = useMutation({
    mutationFn: () => {
      const parsed = JSON.parse(text)
      const problems = Array.isArray(parsed) ? parsed : parsed.problems
      if (!Array.isArray(problems)) throw new Error('Expected a JSON array, or { "problems": [...] }')
      return codingApi.importBundle(problems)
    },
    onSuccess: (data) => {
      toast.success(`Imported ${data.imported.length}${data.rejected.length ? `, ${data.rejected.length} rejected` : ''}`)
      onDone()
      /* Only close on a CLEAN import. A bundle that imported but dropped keys or
         landed with faults is the case this dialog exists to report: closing on it
         is what let `expected` instead of `expectedOutput` look like a success. */
      const worthSaying =
        data.rejected.length ||
        data.imported.some((p) => p.ignored.length || p.faults.length || p.renamed.length)
      if (!worthSaying) onClose()
    },
    onError: (e: Error) => toast.error(e.message || 'Could not import'),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import problems"
      description="A JSON bundle of problems you own or are licensed to use."
      width="max-w-2xl"
    >
      <div className="space-y-3">
        <Textarea
          rows={12}
          className="font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'[{ "title": "Two Sum", "statementMd": "…", "testCases": [ … ] }]'}
        />
        <p className="text-xs leading-relaxed text-ink-muted">
          Problems from public judges are copyrighted and their terms prohibit copying them, so
          there is no import-by-URL here. Bring your own problems, or a bank your organisation
          owns.
        </p>
        <Button onClick={() => run.mutate()} disabled={run.isPending || !text.trim()}>
          {run.isPending ? 'Importing…' : 'Import'}
        </Button>
        {run.data?.rejected.length ? (
          <ul className="ml-5 list-disc space-y-0.5 text-xs text-risk">
            {run.data.rejected.map((r) => (
              <li key={r.index}>
                Entry {r.index + 1}: {r.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {run.data?.imported
          .filter((p) => p.ignored.length || p.faults.length || p.renamed.length)
          .map((p) => {
            const broken = p.ignored.length > 0 || p.faults.length > 0
            return (
              <div
                key={p.id}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-xs',
                  broken ? 'border-risk/40 bg-risk-bg/40' : 'border-border bg-surface-sunk',
                )}
              >
                <p className="font-semibold text-ink">
                  {p.title || 'Untitled problem'}
                  {broken ? ' imported, but needs attention' : ' imported'}
                </p>
                {p.renamed.length ? (
                  <p className="mt-1 leading-relaxed text-ink-muted">
                    Understood and stored under our field names. Use these spellings to avoid the
                    round trip: <span className="font-mono text-ink">{p.renamed.join(', ')}</span>
                  </p>
                ) : null}
                {p.ignored.length ? (
                  <p className="mt-1 leading-relaxed text-ink-muted">
                    Nothing could be made of {p.ignored.length === 1 ? 'this key' : 'these keys'}, so
                    the {p.ignored.length === 1 ? 'value was' : 'values were'} not stored:{' '}
                    <span className="font-mono text-risk">{p.ignored.join(', ')}</span>
                  </p>
                ) : null}
                {p.faults.length ? (
                  <ul className="ml-4 mt-1 list-disc space-y-0.5 text-risk">
                    {p.faults.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                ) : null}
              </div>
            )
          })}
      </div>
    </Modal>
  )
}
