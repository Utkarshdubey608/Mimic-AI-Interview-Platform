/**
 * Essay prompts — authoring.
 *
 * Saving is permissive and using is strict, the same line the coding and MCQ
 * authoring pages draw: a half-written prompt saves without complaint, and the
 * faults panel is what says why it cannot yet be sent to anybody. A recruiter
 * mid-thought should not be told their work is invalid.
 *
 * `guidanceMd` is the one field on this page a candidate never sees. It is the
 * recruiter's note about what a strong answer contains — shown to a candidate it
 * would stop being guidance and become a list of the words that score.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileText, Plus, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'

import {
  Button,
  Input,
  PageContainer,
  Select,
  Skeleton,
  Textarea,
  cn,
} from '@/components/ui'
import { essayPromptsApi, type EssayPromptSummary } from '@/lib/api'

const PROMPT_TYPES = [
  { value: 'argumentative', label: 'Argumentative — take a position and defend it' },
  { value: 'discursive', label: 'Discursive — weigh competing views' },
  { value: 'analytical', label: 'Analytical — break something down' },
  { value: 'opinion', label: 'Opinion — a reasoned personal view' },
  { value: 'source_based', label: 'Source-based — respond to a passage' },
  { value: 'report', label: 'Report — factual summary for a stated reader' },
  { value: 'descriptive', label: 'Descriptive — describe precisely' },
]

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

export function EssayPromptsPage() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [faults, setFaults] = useState<string[]>([])
  const [topic, setTopic] = useState('')

  const list = useQuery({ queryKey: ['essay-prompts'], queryFn: essayPromptsApi.list })

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const refresh = (result: { faults: string[]; prompt: Record<string, unknown> }) => {
    setFaults(result.faults)
    setDraft((d) => ({ ...d, id: String(result.prompt.id ?? '') }))
    void qc.invalidateQueries({ queryKey: ['essay-prompts'] })
  }

  const save = useMutation({
    mutationFn: () => {
      const body = { ...draft } as Record<string, unknown>
      return draft.id ? essayPromptsApi.update(draft.id, body) : essayPromptsApi.create(body)
    },
    onSuccess: (result) => {
      refresh(result)
      toast.success(result.faults.length ? 'Saved — some things are still missing' : 'Saved')
    },
    onError: () => toast.error('That could not be saved'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => essayPromptsApi.remove(id),
    onSuccess: () => {
      setDraft(EMPTY)
      setFaults([])
      void qc.invalidateQueries({ queryKey: ['essay-prompts'] })
      toast.success('Deleted')
    },
  })

  const generate = useMutation({
    mutationFn: () => essayPromptsApi.generate({ topic, count: 1, promptType: draft.promptType }),
    onSuccess: (result) => {
      const first = result.prompts?.[0]
      if (!first) return toast.error('Nothing usable came back — try a more specific topic')
      // Loaded into the editor rather than saved: a model's first attempt at a
      // question is a suggestion, and an ambiguous essay prompt does not fail
      // loudly — it produces forty minutes answering a different question.
      setDraft((d) => ({
        ...d,
        title: String(first.title ?? d.title),
        promptMd: String(first.promptMd ?? ''),
        guidanceMd: String(first.guidanceMd ?? ''),
      }))
      toast.success('Drafted — read it before you use it')
    },
    onError: () => toast.error('Drafting failed'),
  })

  const open = async (id: string) => {
    const { prompt, faults: f } = await essayPromptsApi.get(id)
    setDraft({ ...(prompt as unknown as Draft), id })
    setFaults(f)
  }

  return (
    <PageContainer>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Essay prompts</h1>
          <p className="mt-1 text-sm text-ink-muted">
            One long written answer, marked against your rubric.
          </p>
        </div>
        <Button variant="outline" onClick={() => { setDraft(EMPTY); setFaults([]) }}>
          <Plus size={15} /> New prompt
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]">
        {/* the list */}
        <aside className="space-y-2">
          {list.isLoading ? (
            <>
              <Skeleton className="h-[68px]" />
              <Skeleton className="h-[68px]" />
            </>
          ) : (list.data ?? []).length === 0 ? (
            <p className="rounded-2xl border border-dashed border-rule-strong bg-surface-sunk px-4 py-6 text-center text-sm text-ink-muted">
              No prompts yet. Write one on the right.
            </p>
          ) : (
            (list.data ?? []).map((p: EssayPromptSummary) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void open(p.id)}
                className={cn(
                  'w-full rounded-2xl border px-4 py-3 text-left transition-colors duration-150',
                  draft.id === p.id
                    ? 'border-action bg-surface-hover/40 ring-1 ring-signal'
                    : 'border-border bg-surface hover:border-rule-strong',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-bold text-ink">
                  <FileText size={14} /> {p.title || 'Untitled prompt'}
                </span>
                <span className="mt-1 block text-xs text-ink-muted">
                  {p.promptType} · {p.minWords || 0}–{p.maxWords || '∞'} words ·{' '}
                  {Math.round((p.timeLimitSeconds || 0) / 60)} min
                </span>
                {p.faults.length ? (
                  <span className="mt-1 flex items-center gap-1 text-xs text-risk">
                    <AlertTriangle size={11} /> draft
                  </span>
                ) : null}
              </button>
            ))
          )}
        </aside>

        {/* the editor */}
        <section className="space-y-4 rounded-2xl border border-border bg-surface p-5">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Title</span>
              <Input
                value={draft.title}
                placeholder="Automation and employment"
                onChange={(e) => set('title', e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Type</span>
              <Select
                value={draft.promptType}
                options={PROMPT_TYPES}
                onChange={(e) => set('promptType', e.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink">
              The question the candidate answers
            </span>
            <Textarea
              rows={5}
              value={draft.promptMd}
              placeholder="Discuss the effect of automation on employment. Take a position and support it."
              onChange={(e) => set('promptMd', e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink">
              Source passage <span className="font-normal text-ink-faint">— optional, shown beside the editor</span>
            </span>
            <Textarea
              rows={3}
              value={draft.sourcePassageMd}
              onChange={(e) => set('sourcePassageMd', e.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink">
              Marking notes <span className="font-normal text-risk">— never shown to the candidate</span>
            </span>
            <Textarea
              rows={3}
              value={draft.guidanceMd}
              placeholder="What a strong answer would contain."
              onChange={(e) => set('guidanceMd', e.target.value)}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Min words</span>
              <Input type="number" value={draft.minWords} onChange={(e) => set('minWords', Number(e.target.value) || 0)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Max words</span>
              <Input type="number" value={draft.maxWords} onChange={(e) => set('maxWords', Number(e.target.value) || 0)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Minutes</span>
              <Input
                type="number"
                value={Math.round(draft.timeLimitSeconds / 60)}
                onChange={(e) => set('timeLimitSeconds', (Number(e.target.value) || 0) * 60)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">Language</span>
              <Input value={draft.language} placeholder="en" onChange={(e) => set('language', e.target.value)} />
            </label>
          </div>

          {faults.length ? (
            <ul className="ml-5 list-disc space-y-0.5 text-xs text-risk">
              {faults.map((f) => <li key={f}>{f}</li>)}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!draft.promptMd.trim() && !draft.title.trim()}>
              Save changes
            </Button>
            <div className="flex flex-1 items-center gap-2">
              <Input
                value={topic}
                placeholder="Draft one from a topic…"
                onChange={(e) => setTopic(e.target.value)}
              />
              <Button variant="outline" onClick={() => generate.mutate()} loading={generate.isPending} disabled={!topic.trim()}>
                <Sparkles size={14} /> Draft
              </Button>
            </div>
            {draft.id ? (
              <Button variant="ghost" onClick={() => remove.mutate(draft.id as string)} loading={remove.isPending}>
                <Trash2 size={14} /> Delete
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </PageContainer>
  )
}
