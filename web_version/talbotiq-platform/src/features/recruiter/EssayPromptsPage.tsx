/**
 * Essay questions — authoring.
 *
 * Saving is permissive and using is strict, the same line the coding and MCQ
 * authoring pages draw: a half-written essay saves without complaint, and the
 * checklist is what says why it cannot yet be sent to anybody. A recruiter
 * mid-thought should not be told their work is invalid.
 *
 * ── Why the wording here is deliberately plain ───────────────────────────────
 * This page used to speak in exam-board language — "prompt", "rubric",
 * "discursive", "source-based" — and the people who use it are recruiters, not
 * examiners. Every label is now the sentence a person would say out loud. The
 * stored VALUES are untouched (`promptType: 'source_based'` still goes to the
 * server); only what a human reads has changed.
 *
 * ── The checklist is computed here as well as on the server ──────────────────
 * `essay_faults` in the backend is the authority on whether an essay can be
 * SENT. It is mirrored below so the recruiter sees the same list while typing
 * rather than after pressing Save — finding out that your word limits are
 * inverted only once you save is finding out too late. The two must stay in
 * step; anything the server reports that the mirror did not is still shown, so a
 * drift is visible rather than silent.
 *
 * `guidanceMd` is the one field on this page a candidate never sees. It is the
 * recruiter's note about what a strong answer contains — shown to a candidate it
 * would stop being guidance and become a list of the words that score.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, BookOpen, Check, Clock, FileText, Lock, Plus, Save, Sparkles, Trash2, X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'

import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  InlineNotice,
  Input,
  Page,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  cn,
} from '@/components/ui'
import { essayPromptsApi, type EssayPromptSummary } from '@/lib/api'

/* ── Plain names for the styles ───────────────────────────────────────────────
   The `value` is the contract with the server and does not move. The `label` is
   what somebody who has never marked an exam would call the same thing, and
   `short` is the version that fits on a list row. */
const PROMPT_TYPES = [
  { value: 'argumentative', label: 'Argue a case — pick a side and back it up', short: 'Argue a case' },
  { value: 'discursive', label: 'Weigh both sides — compare the arguments', short: 'Weigh both sides' },
  { value: 'analytical', label: 'Break it down — explain how something works', short: 'Break it down' },
  { value: 'opinion', label: 'Their own view — a reasoned personal answer', short: 'Their own view' },
  { value: 'source_based', label: 'Read and respond — answer about a passage', short: 'Read and respond' },
  { value: 'report', label: 'Write a report — the facts, for a named reader', short: 'Write a report' },
  { value: 'descriptive', label: 'Describe it — paint a clear picture in words', short: 'Describe it' },
]

const typeName = (value: string) =>
  PROMPT_TYPES.find((t) => t.value === value)?.short ?? value

/* The languages a candidate is likely to be asked to write in. Not a closed
   list — an essay stored with anything else keeps it, and it is added to the
   menu below so opening an old essay never silently rewrites its language. */
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
]

/** Ready-made lengths, because "how many words is an essay" is not obvious. */
const LENGTH_PRESETS = [
  { label: 'Short', min: 150, max: 300 },
  { label: 'Standard', min: 250, max: 500 },
  { label: 'Long', min: 500, max: 900 },
]

const TIME_PRESETS = [20, 30, 40, 60]

type Draft = {
  id?: string
  title: string
  promptMd: string
  promptType: string
  language: string
  sourcePassageMd: string
  guidanceMd: string
  minWords: number
  maxWords: number
  timeLimitSeconds: number
}

const EMPTY: Draft = {
  title: '',
  promptMd: '',
  promptType: 'argumentative',
  language: 'en',
  sourcePassageMd: '',
  guidanceMd: '',
  minWords: 250,
  maxWords: 500,
  timeLimitSeconds: 2_400,
}

/**
 * What still has to be done before this essay can be sent to anybody.
 *
 * A mirror of `essay_faults` in the backend, in the words a recruiter would
 * use. Shown while typing, not on save.
 */
function whatIsMissing(d: Draft): string[] {
  const missing: string[] = []
  if (!d.title.trim()) missing.push('Give it a name.')
  if (!d.promptMd.trim()) missing.push('Write the question the candidate answers.')
  if (d.minWords && d.maxWords && d.minWords > d.maxWords) {
    missing.push(
      `The shortest length (${d.minWords} words) is longer than the longest (${d.maxWords}) — nobody could hit both.`,
    )
  }
  if (!d.timeLimitSeconds) missing.push('Set how long they get.')
  return missing
}

/* ── One group of fields ─────────────────────────────────────────────────────
   Four small panels rather than one long column of inputs: a recruiter looking
   for the word limit should be able to find it by shape, not by reading every
   label on the way down. */
function Group({
  title, hint, children, className,
}: {
  title: string
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-surface-sunk/50 p-4', className)}>
      <h2 className="font-display text-sm font-bold text-ink">{title}</h2>
      {hint && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{hint}</p>}
      <div className="mt-3.5 space-y-4">{children}</div>
    </section>
  )
}

export function EssayPromptsPage() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  /* The last state the server acknowledged, so "you have unsaved edits" is a
     fact rather than a guess, and clicking away from half an hour of typing can
     be caught before it is lost. */
  const [saved, setSaved] = useState<string>(JSON.stringify(EMPTY))
  const [serverFaults, setServerFaults] = useState<string[]>([])
  const [topic, setTopic] = useState('')
  const [showDrafter, setShowDrafter] = useState(false)
  const [showPassage, setShowPassage] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** A pending navigation held back because the open essay has unsaved edits. */
  const [pendingOpen, setPendingOpen] = useState<null | { id: string | null }>(null)

  const list = useQuery({ queryKey: ['essay-prompts'], queryFn: essayPromptsApi.list })

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const dirty = JSON.stringify(draft) !== saved
  const missing = useMemo(() => whatIsMissing(draft), [draft])
  /* Anything the server refused that the mirror above did not predict. Normally
     empty; when it is not, the two rule sets have drifted and the recruiter is
     still told, rather than the page quietly disagreeing with the save. */
  const unexpected = missing.length === 0 ? serverFaults : []

  const settle = (result: { faults: string[]; prompt: Record<string, unknown> }) => {
    setServerFaults(result.faults)
    const next = { ...draft, id: String(result.prompt.id ?? '') }
    setDraft(next)
    setSaved(JSON.stringify(next))
    void qc.invalidateQueries({ queryKey: ['essay-prompts'] })
  }

  const save = useMutation({
    mutationFn: () => {
      const body = { ...draft } as Record<string, unknown>
      return draft.id ? essayPromptsApi.update(draft.id, body) : essayPromptsApi.create(body)
    },
    onSuccess: (result) => {
      settle(result)
      toast.success(result.faults.length ? 'Saved — a few things are still missing' : 'Saved')
    },
    onError: () => toast.error('That could not be saved'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => essayPromptsApi.remove(id),
    onSuccess: () => {
      startFresh()
      setConfirmDelete(false)
      void qc.invalidateQueries({ queryKey: ['essay-prompts'] })
      toast.success('Deleted')
    },
    onError: () => toast.error('That could not be deleted'),
  })

  const generate = useMutation({
    mutationFn: () => essayPromptsApi.generate({ topic, count: 1, promptType: draft.promptType }),
    onSuccess: (result) => {
      const first = result.prompts?.[0]
      if (!first) return toast.error('Nothing usable came back — try a more specific topic')
      // Loaded into the editor rather than saved: a model's first attempt at a
      // question is a suggestion, and an ambiguous essay question does not fail
      // loudly — it produces forty minutes answering a different question.
      setDraft((d) => ({
        ...d,
        title: String(first.title ?? d.title),
        promptMd: String(first.promptMd ?? ''),
        guidanceMd: String(first.guidanceMd ?? ''),
      }))
      setShowDrafter(false)
      toast.success('Drafted — read it before you use it')
    },
    onError: () => toast.error('Drafting failed'),
  })

  function startFresh() {
    setDraft(EMPTY)
    setSaved(JSON.stringify(EMPTY))
    setServerFaults([])
    setShowPassage(false)
  }

  const load = async (id: string) => {
    const { prompt, faults } = await essayPromptsApi.get(id)
    const next = { ...(prompt as unknown as Draft), id }
    setDraft(next)
    setSaved(JSON.stringify(next))
    setServerFaults(faults)
    setShowPassage(Boolean(next.sourcePassageMd?.trim()))
  }

  /** Every route out of the open essay goes through here, so nothing is lost silently. */
  const leaveFor = (id: string | null) => {
    if (dirty) return setPendingOpen({ id })
    return id ? void load(id) : startFresh()
  }

  const minutes = Math.round(draft.timeLimitSeconds / 60)
  const languageOptions = LANGUAGES.some((l) => l.value === draft.language)
    ? LANGUAGES
    : [...LANGUAGES, { value: draft.language, label: draft.language || 'Not set' }]

  return (
    <Page>
      <PageHeader
        title="Essay questions"
        description="One long written answer. You set the question, how long it can be and how long they get — then write a note to yourself about what a good answer looks like, and it is marked against that."
        action={
          <>
            <Button variant="outline" icon={<Sparkles size={15} />} onClick={() => setShowDrafter((v) => !v)}>
              Draft one with AI
            </Button>
            <Button icon={<Plus size={15} />} onClick={() => leaveFor(null)}>
              New essay
            </Button>
          </>
        }
      />

      {/* Drafting is a way IN to the editor, so it belongs at the top beside
          "New essay" — it used to sit in the footer next to Save, where it read
          as something you did to an essay you had already written. */}
      {showDrafter && (
        <Card className="mb-5 border-ai-rule bg-ai-bg/40 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <Input
                label="What should the essay be about?"
                hint="A topic is enough — you get a first draft to edit, never something sent as-is."
                value={topic}
                placeholder="Remote work and team culture"
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && topic.trim()) generate.mutate() }}
              />
            </div>
            <Button
              icon={<Sparkles size={14} />}
              loading={generate.isPending}
              disabled={!topic.trim()}
              onClick={() => generate.mutate()}
            >
              Write a draft
            </Button>
            <Button variant="ghost" iconOnly icon={<X size={15} />} aria-label="Close the AI drafter" onClick={() => setShowDrafter(false)} />
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ── the rail ─────────────────────────────────────────────────────── */}
        <aside className="lg:sticky lg:top-[88px] lg:self-start">
          <div className="flex items-baseline justify-between px-1">
            <span className="section-label">Your essays</span>
            <span className="text-xs font-semibold tabular-nums text-ink-faint">{(list.data ?? []).length}</span>
          </div>

          {list.isLoading ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-[72px]" />
              <Skeleton className="h-[72px]" />
            </div>
          ) : (list.data ?? []).length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-rule-strong bg-surface-sunk px-4 py-5 text-center text-xs leading-relaxed text-ink-muted">
              Nothing here yet. Fill in the form beside this, or let AI draft you a first one.
            </p>
          ) : (
            <div className="-mx-1 mt-3 space-y-1.5 px-1 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto">
              {(list.data ?? []).map((p: EssayPromptSummary) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => leaveFor(p.id)}
                  className={cn(
                    'w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors duration-150',
                    draft.id === p.id
                      ? 'border-action bg-surface-hover/40 ring-1 ring-signal'
                      : 'border-border bg-surface hover:border-rule-strong',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <FileText size={14} className="flex-shrink-0 text-ink-faint" />
                    <span className="truncate">{p.title || 'Untitled essay'}</span>
                  </span>
                  <span className="mt-1 block text-xs text-ink-muted">
                    {typeName(p.promptType)} · {p.minWords || 0}–{p.maxWords || '∞'} words ·{' '}
                    {Math.round((p.timeLimitSeconds || 0) / 60)} min
                  </span>
                  {p.faults.length ? (
                    <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-warn">
                      <AlertTriangle size={11} /> Not finished
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* ── the editor ───────────────────────────────────────────────────── */}
        <Card className="p-0">
          {/* Sticky, because an essay is a long form and Save used to scroll off
              the bottom of it. The name lives up here too, so the thing you are
              editing is always named on screen. */}
          <div className="sticky top-14 z-20 flex flex-wrap lg:top-4 items-center gap-2 rounded-t-[inherit] border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
            <Input
              value={draft.title}
              aria-label="Essay name"
              placeholder="Name this essay"
              onChange={(e) => set('title', e.target.value)}
              fieldClassName="min-w-[12rem] flex-1 sm:max-w-xs"
              className="h-9 text-sm font-semibold"
            />
            {missing.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
                <Check size={13} /> Ready to send
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warn">
                <AlertTriangle size={13} /> {missing.length} thing{missing.length === 1 ? '' : 's'} to finish
              </span>
            )}
            {dirty && <Badge variant="warning">Unsaved</Badge>}

            <div className="ml-auto flex items-center gap-2">
              {draft.id && (
                <Button size="sm" variant="outline" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
              {/* Always enabled once there is anything at all to store. Half an
                  essay is a legitimate state; what is unfinished is listed
                  below and refused at SEND, not here. */}
              <Button
                size="sm"
                icon={<Save size={14} />}
                loading={save.isPending}
                disabled={!draft.promptMd.trim() && !draft.title.trim()}
                onClick={() => save.mutate()}
              >
                {draft.id ? 'Save' : 'Create essay'}
              </Button>
            </div>
          </div>

          <div className="space-y-4 p-4">
            {(missing.length > 0 || unexpected.length > 0) && (
              <InlineNotice tone="warn" title="Before you can send this out">
                <ul className="mt-1 ml-4 list-disc space-y-0.5">
                  {missing.map((m) => <li key={m}>{m}</li>)}
                  {unexpected.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </InlineNotice>
            )}

            <Group
              title="What they write about"
              hint="This is the only part of the page the candidate reads."
            >
              <Select
                label="What kind of answer do you want?"
                value={draft.promptType}
                options={PROMPT_TYPES.map(({ value, label }) => ({ value, label }))}
                onChange={(e) => set('promptType', e.target.value)}
              />
              <Textarea
                label="The question"
                hint="Write it the way you would say it out loud. One clear ask beats three vague ones."
                rows={5}
                value={draft.promptMd}
                placeholder="Automation is changing the kind of work people do. Should companies retrain the staff it replaces, or is that the state's job? Take a side and back it up."
                onChange={(e) => set('promptMd', e.target.value)}
              />

              {showPassage || draft.sourcePassageMd.trim() ? (
                <Textarea
                  label="Something for them to read first"
                  hint="Optional. Shown next to the writing box the whole time."
                  rows={4}
                  value={draft.sourcePassageMd}
                  placeholder="Paste an article, a case study, or a short extract."
                  onChange={(e) => set('sourcePassageMd', e.target.value)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPassage(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink hover:underline"
                >
                  <BookOpen size={13} /> Add something for them to read first
                </button>
              )}
            </Group>

            <Group
              title="How it gets marked"
              hint={
                <span className="inline-flex items-center gap-1.5 font-semibold text-risk">
                  <Lock size={11} /> The candidate never sees anything in this box.
                </span>
              }
            >
              <Textarea
                label="What a good answer looks like"
                hint="Plain notes are fine — the points you would expect, the traps, what would impress you. This is what the answer is marked against."
                rows={4}
                value={draft.guidanceMd}
                placeholder="Should name at least two costs of retraining and who carries them. A strong answer admits the weakness in its own side. Listing examples without an argument is not enough."
                onChange={(e) => set('guidanceMd', e.target.value)}
              />
            </Group>

            <Group title="How long it can be, and how long they get">
              <div>
                <span className="field-label">Length</span>
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  {LENGTH_PRESETS.map((p) => {
                    const on = draft.minWords === p.min && draft.maxWords === p.max
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, minWords: p.min, maxWords: p.max }))}
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                          on
                            ? 'border-action bg-action text-action-ink'
                            : 'border-rule bg-surface-hover text-ink hover:border-rule-strong',
                        )}
                      >
                        {p.label} · {p.min}–{p.max}
                      </button>
                    )
                  })}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="At least"
                    suffix={<span className="text-xs">words</span>}
                    type="number"
                    min={0}
                    value={draft.minWords}
                    onChange={(e) => set('minWords', Number(e.target.value) || 0)}
                  />
                  <Input
                    label="At most"
                    suffix={<span className="text-xs">words</span>}
                    type="number"
                    min={0}
                    value={draft.maxWords}
                    onChange={(e) => set('maxWords', Number(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div>
                <span className="field-label">Time on the clock</span>
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  {TIME_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => set('timeLimitSeconds', m * 60)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        minutes === m
                          ? 'border-action bg-action text-action-ink'
                          : 'border-rule bg-surface-hover text-ink hover:border-rule-strong',
                      )}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Or set your own"
                    prefix={<Clock size={13} />}
                    suffix={<span className="text-xs">min</span>}
                    type="number"
                    min={0}
                    value={minutes}
                    onChange={(e) => set('timeLimitSeconds', (Number(e.target.value) || 0) * 60)}
                  />
                  <Select
                    label="Language they write in"
                    value={draft.language}
                    options={languageOptions}
                    onChange={(e) => set('language', e.target.value)}
                  />
                </div>
              </div>
            </Group>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => draft.id && remove.mutate(draft.id)}
        busy={remove.isPending}
        title="Delete this essay?"
        confirmLabel="Delete it"
        body={
          <>
            <strong className="text-ink">{draft.title || 'This essay'}</strong> will be gone for good.
            Anyone already sitting it keeps the copy they were sent.
          </>
        }
      />

      {/* Deleting is not the only way to lose work: clicking another essay used
          to discard whatever was typed into the open one without a word. */}
      <ConfirmDialog
        open={pendingOpen !== null}
        onClose={() => setPendingOpen(null)}
        onConfirm={() => {
          const target = pendingOpen?.id ?? null
          setPendingOpen(null)
          if (target) void load(target)
          else startFresh()
        }}
        tone="danger"
        title="Leave without saving?"
        confirmLabel="Discard my changes"
        body="You have edits here that have not been saved yet. Leaving now loses them."
      />
    </Page>
  )
}
