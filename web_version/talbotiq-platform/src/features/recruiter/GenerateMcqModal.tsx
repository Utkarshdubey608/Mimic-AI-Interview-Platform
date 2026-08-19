import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Sparkles, X, Plus, Loader2, ArrowLeft, Check } from 'lucide-react'
import { Button, cn } from '@/components/ui'
import { mcqSetsApi } from '@/lib/api'
import type { McqQuestion } from '@shared/types'

/**
 * Mode A — a paper from a role.
 *
 * Three steps, and the middle one is the point. A model asked to "write 20
 * questions for a Backend Engineer" produces a paper nobody chose the shape of;
 * asked to cover topics a recruiter has just read, edited and approved, it
 * produces one they can defend. So the topics are surfaced for editing rather
 * than used silently, and the recruiter can delete what does not apply and add
 * what the model missed.
 *
 * ── The generated paper is a DRAFT, never a fait accompli ─────────────────
 * Generation returns questions for review; saving is a separate act, and the
 * recruiter lands in the normal editor afterwards with everything editable —
 * including which option is correct. A generated answer key that nobody checked
 * is the worst possible thing to score people against, so nothing here writes a
 * set on its own.
 */

const DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed'] as const
type Difficulty = (typeof DIFFICULTIES)[number]

export function GenerateMcqModal({
  open, onClose, onGenerated,
}: {
  open: boolean
  onClose: () => void
  /** The reviewed paper, handed to the editor. Saving happens there. */
  onGenerated: (name: string, questions: McqQuestion[]) => void
}) {
  const [role, setRole] = useState('')
  const [topics, setTopics] = useState<string[] | null>(null)
  const [newTopic, setNewTopic] = useState('')
  const [count, setCount] = useState(10)
  const [difficulty, setDifficulty] = useState<Difficulty>('mixed')
  const [allowMulti, setAllowMulti] = useState(false)

  const reset = () => {
    setRole(''); setTopics(null); setNewTopic(''); setCount(10)
    setDifficulty('mixed'); setAllowMulti(false)
  }
  const close = () => { reset(); onClose() }

  const suggest = useMutation({
    mutationFn: () => mcqSetsApi.suggestTopics(role.trim()),
    onSuccess: (r) => setTopics(r.topics),
    onError: (e: Error) => toast.error(e.message),
  })

  const generate = useMutation({
    mutationFn: () =>
      mcqSetsApi.generate({
        role: role.trim(), topics: topics ?? [], count, difficulty, allowMulti,
      }),
    onSuccess: (r) => {
      // Reported, not hidden: asking for 20 and receiving 17 deserves the reason.
      if (r.dropped > 0) {
        toast(`${r.dropped} generated question${r.dropped === 1 ? '' : 's'} were unusable and dropped.`)
      }
      onGenerated(`${r.role} — MCQ`, r.questions)
      reset()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!open) return null

  const addTopic = () => {
    const t = newTopic.trim()
    if (!t || !topics) return
    if (!topics.some((x) => x.toLowerCase() === t.toLowerCase())) setTopics([...topics, t])
    setNewTopic('')
  }

  const busy = suggest.isPending || generate.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5" role="dialog" aria-modal="true" aria-labelledby="gen-mcq-title">
      <button className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={close} aria-label="Close" />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="gen-mcq-title" className="font-display text-lg font-bold text-neutral-900">
              Generate an MCQ paper
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-500">
              {topics === null
                ? 'Name the role. We’ll suggest the skill areas worth testing, and you decide which ones make the paper.'
                : 'Edit the topics, then set the shape of the paper. You’ll review every question before anything is saved.'}
            </p>
          </div>
          <button onClick={close} className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* ── Step 1: the role ───────────────────────────────────────────── */}
        {topics === null ? (
          <div className="mt-5">
            <label htmlFor="gen-role" className="field-label">Role</label>
            <input
              id="gen-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && role.trim()) suggest.mutate() }}
              placeholder="e.g. Senior Backend Engineer"
              className="input-base"
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button
                icon={suggest.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                disabled={!role.trim() || busy}
                onClick={() => suggest.mutate()}
              >
                Suggest topics
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Step 2: the topics, edited ──────────────────────────────── */}
            <div className="mt-5">
              <span className="field-label">Topics</span>
              <p className="mb-2 text-xs text-neutral-500">
                Remove what doesn’t apply, add what’s missing. The paper is spread across these.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {topics.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-primary-50 py-1 pl-3 pr-2 text-xs font-medium text-primary-700">
                    {t}
                    <button
                      onClick={() => setTopics(topics.filter((x) => x !== t))}
                      aria-label={`Remove ${t}`}
                      className="rounded-full p-0.5 text-primary-400 transition-colors hover:bg-primary-100 hover:text-primary-700"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {topics.length === 0 && (
                  <span className="text-xs text-warn">Add at least one topic — a paper spread across nothing isn’t a paper.</span>
                )}
              </div>
              <div className="mt-2.5 flex gap-2">
                <input
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic() } }}
                  placeholder="Add a topic"
                  aria-label="Add a topic"
                  className="input-base h-9 flex-1 text-sm"
                />
                <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={addTopic} disabled={!newTopic.trim()}>
                  Add
                </Button>
              </div>
            </div>

            {/* ── Step 3: the shape of the paper ──────────────────────────── */}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="gen-count" className="field-label">Number of questions</label>
                <input
                  id="gen-count"
                  type="number"
                  min={1}
                  max={40}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
                  className="input-base h-9 text-sm tabular-nums"
                />
              </div>
              <div>
                <span className="field-label">Difficulty</span>
                <div className="inline-flex rounded-lg border border-border p-0.5">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors',
                        difficulty === d ? 'bg-primary-700 text-white' : 'text-neutral-500 hover:text-neutral-900',
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={allowMulti}
                onChange={(e) => setAllowMulti(e.target.checked)}
                className="h-4 w-4 rounded border-rule-input"
              />
              Allow multi-answer questions where the subject genuinely has more than one right answer
            </label>

            <div className="mt-6 flex items-center justify-between gap-2">
              <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => setTopics(null)}>
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={close}>Cancel</Button>
                <Button
                  icon={generate.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  disabled={topics.length === 0 || busy}
                  onClick={() => generate.mutate()}
                >
                  {generate.isPending ? 'Writing the paper…' : `Generate ${count} questions`}
                </Button>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-neutral-500">
              You’ll review and edit every question — including which option is correct — before anything is saved.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
