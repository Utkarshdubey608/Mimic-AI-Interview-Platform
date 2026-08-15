import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { UploadCloud, FileText, X, Trash2, Plus, Sparkles, AlertTriangle, ArrowLeft, Save } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Modal, Button, Input, Badge, cn } from '@/components/ui'
import { questionSetsApi, settingsApi } from '@/lib/api'
import type {
  QuestionSet, QuestionStyle, DifficultyChoice, GeminiModel,
  GeneratedInterviewQuestion, FixedQuestion,
} from '@shared/types'

type Editable = GeneratedInterviewQuestion & { _id: string }

const STYLES: { value: QuestionStyle; label: string }[] = [
  { value: 'technical', label: 'Technical' },
  { value: 'non_technical', label: 'Non-technical' },
  { value: 'mix', label: 'Mix' },
]
const DIFFICULTIES: DifficultyChoice[] = ['easy', 'medium', 'hard', 'mixed']
const MAX_MB = 10

/** Map a reviewed question onto the EXISTING FixedQuestion shape for persistence. */
const toFixed = (q: Editable): FixedQuestion => ({
  id: crypto.randomUUID(),
  text: q.text.trim(),
  category: q.category || undefined,
  idealAnswerNotes: [q.rationale, q.skillTag && `Skill: ${q.skillTag}`, `Type: ${q.type}`, `Difficulty: ${q.difficulty}`]
    .filter(Boolean)
    .join(' · '),
})

/** Pill-shaped single-select chip used by the style and difficulty pickers. */
function ChoiceChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'rounded-full border-[1.5px] px-3 py-1.5 text-xs font-semibold transition-colors duration-150',
        selected
          ? 'border-primary-700 bg-primary-50 text-primary-800'
          : 'border-border bg-white text-neutral-500 hover:border-primary-200 hover:bg-primary-50/50 hover:text-neutral-700',
      )}
    >
      {children}
    </button>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  defaultRole?: string
  onSaved: (set: QuestionSet) => void
}

export function GenerateFromResumeModal({ open, onClose, defaultRole, onSaved }: Props) {
  const [step, setStep] = useState<'form' | 'review'>('form')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [style, setStyle] = useState<QuestionStyle>('mix')
  const [techCount, setTechCount] = useState(5)
  const [nonTechCount, setNonTechCount] = useState(3)
  const [difficulty, setDifficulty] = useState<DifficultyChoice>('mixed')
  const [model, setModel] = useState<GeminiModel>('gemini-2.5-flash')
  const [name, setName] = useState('')
  const [role, setRole] = useState(defaultRole ?? '')
  const [apiKey, setApiKey] = useState('')
  const [keySet, setKeySet] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Editable[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    // Reset + check whether a server key already exists.
    setStep('form'); setFile(null); setError(null); setQuestions([])
    setStyle('mix'); setTechCount(5); setNonTechCount(3); setDifficulty('mixed')
    setName(''); setRole(defaultRole ?? ''); setApiKey('')
    settingsApi.status().then((s) => setKeySet(s.geminiKeySet)).catch(() => setKeySet(false))
  }, [open, defaultRole])

  const pickFile = (f: File | null) => {
    setError(null)
    if (!f) return
    if (f.type !== 'application/pdf') { setError('Please choose a PDF file.'); return }
    if (f.size > MAX_MB * 1024 * 1024) { setError(`File is too large (max ${MAX_MB} MB).`); return }
    setFile(f)
  }

  const total = style === 'mix' ? techCount + nonTechCount : style === 'technical' ? techCount : nonTechCount
  const needsKey = keySet === false
  const canGenerate = !!file && total >= 1 && total <= 25 && (!needsKey || apiKey.trim().length > 0)

  const generate = async () => {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('resume', file)
      fd.append('style', style)
      fd.append('technicalCount', String(techCount))
      fd.append('nonTechnicalCount', String(nonTechCount))
      fd.append('difficulty', difficulty)
      fd.append('model', model)
      if (role.trim()) fd.append('role', role.trim())
      if (name.trim()) fd.append('name', name.trim())
      if (needsKey && apiKey.trim()) fd.append('apiKey', apiKey.trim())

      const result = await questionSetsApi.generateFromResume(fd)
      setQuestions(result.questions.map((q) => ({ ...q, _id: crypto.randomUUID() })))
      if (!name.trim()) setName(result.suggestedName)
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const valid = questions.filter((q) => q.text.trim())
    if (!valid.length) { toast.error('Add at least one question'); return }
    setBusy(true)
    try {
      const set = await questionSetsApi.create({ name: name.trim() || 'Résumé Screen', questions: valid.map(toFixed) })
      toast.success(`Saved “${set.name}” (${set.questions.length} questions)`)
      onSaved(set)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const patch = (id: string, p: Partial<Editable>) =>
    setQuestions((qs) => qs.map((q) => (q._id === id ? { ...q, ...p } : q)))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate question set from résumé"
      description={step === 'form' ? 'Upload a PDF résumé — Gemini tailors questions to the candidate.' : 'Review and edit, then save as a new question set.'}
      width="max-w-2xl"
    >
      {step === 'form' ? (
        <div className="space-y-5">
          {/* dropzone */}
          <div>
            <label className="field-label">Résumé (PDF)</label>
            {file ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-neutral-50 p-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                  <FileText size={18} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-900">{file.name}</p>
                  <p className="text-xs text-neutral-500">PDF · <span className="tabular-nums">{(file.size / 1024 / 1024).toFixed(2)} MB</span></p>
                </div>
                <button
                  onClick={() => setFile(null)}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors duration-150 hover:bg-neutral-200 hover:text-neutral-700"
                  aria-label="Remove résumé"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0] ?? null) }}
                  className={cn(
                    'flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed p-8 text-center transition-colors duration-150',
                    dragOver
                      ? 'border-primary-700 bg-primary-50'
                      : 'border-neutral-300 bg-neutral-50 hover:border-primary-300 hover:bg-primary-50/50',
                  )}
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-white text-primary-700 shadow-xs">
                    <UploadCloud size={20} strokeWidth={1.75} />
                  </span>
                  <span className="text-sm font-semibold text-neutral-800">Drop a PDF résumé here, or click to browse</span>
                  <span className="text-xs text-neutral-500">PDF only · up to {MAX_MB} MB</span>
                </button>
                <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
              </>
            )}
          </div>

          {/* style */}
          <div>
            <label className="field-label">Question style</label>
            <div className="grid grid-cols-3 gap-2">
              {STYLES.map((s) => (
                <ChoiceChip key={s.value} selected={style === s.value} onClick={() => setStyle(s.value)}>
                  {s.label}
                </ChoiceChip>
              ))}
            </div>
          </div>

          {/* counts */}
          {style === 'mix' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Technical questions" type="number" min={0} max={25} value={techCount} onChange={(e) => setTechCount(Math.max(0, Number(e.target.value)))} />
              <Input label="Non-technical questions" type="number" min={0} max={25} value={nonTechCount} onChange={(e) => setNonTechCount(Math.max(0, Number(e.target.value)))} />
            </div>
          ) : (
            <Input
              label="Number of questions" type="number" min={1} max={25}
              value={style === 'technical' ? techCount : nonTechCount}
              onChange={(e) => { const v = Math.max(1, Number(e.target.value)); style === 'technical' ? setTechCount(v) : setNonTechCount(v) }}
            />
          )}
          {(total < 1 || total > 25) && (
            <p className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-xs font-medium leading-relaxed text-warning">
              <AlertTriangle size={14} strokeWidth={2} className="mt-px flex-shrink-0" />
              <span>Ask for between 1 and 25 questions — currently <span className="font-bold tabular-nums">{total}</span>.</span>
            </p>
          )}

          {/* difficulty */}
          <div>
            <label className="field-label">Difficulty</label>
            <div className="grid grid-cols-4 gap-2">
              {DIFFICULTIES.map((d) => (
                <ChoiceChip key={d} selected={difficulty === d} onClick={() => setDifficulty(d)}>
                  <span className="capitalize">{d}</span>
                </ChoiceChip>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Role (optional)" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior Backend Engineer" />
            <Input label="Question set name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto from role" />
          </div>

          {/* model + key */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-neutral-50 px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-800">Model</p>
              <p className="text-xs text-neutral-500">Flash is quicker; Pro reasons more deeply.</p>
            </div>
            <div className="flex flex-shrink-0 gap-1 rounded-full border border-border bg-white p-1">
              {(['gemini-2.5-flash', 'gemini-2.5-pro'] as GeminiModel[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModel(m)}
                  aria-pressed={model === m}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors duration-150',
                    model === m ? 'bg-primary-700 text-white' : 'text-neutral-500 hover:text-neutral-800',
                  )}
                >
                  {m.replace('gemini-2.5-', '')}
                </button>
              ))}
            </div>
          </div>

          {needsKey && (
            <div>
              <label className="field-label" htmlFor="gemini-api-key">Gemini API key</label>
              <input id="gemini-api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza…" className="input-base font-mono text-xs" />
              <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">
                No key saved yet — enter one here, or{' '}
                <Link to="/settings" className="font-semibold text-primary-700 underline underline-offset-2 hover:text-primary-800" onClick={onClose}>save it in Settings</Link>.
              </p>
            </div>
          )}

          {error && (
            <p className="flex items-start gap-2.5 rounded-xl border border-danger-border bg-danger-bg p-3 text-sm leading-relaxed text-danger">
              <AlertTriangle size={16} strokeWidth={2} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button icon={busy ? undefined : <Sparkles size={16} />} loading={busy} disabled={!canGenerate} onClick={generate}>
              {busy ? 'Generating…' : 'Generate questions'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Input label="Question set name" value={name} onChange={(e) => setName(e.target.value)} />

          <div className="flex items-center justify-between gap-3 border-b border-border pb-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Questions <span className="ml-1 font-bold tabular-nums text-neutral-700">{questions.length}</span>
            </p>
            <button
              onClick={() => setQuestions((qs) => [...qs, { _id: crypto.randomUUID(), text: '', type: 'technical', category: '', difficulty: 'medium', skillTag: '', rationale: '' }])}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-primary-700 transition-colors duration-150 hover:bg-primary-50"
            >
              <Plus size={13} /> Add question
            </button>
          </div>

          {questions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 text-center">
              <p className="text-sm font-semibold text-neutral-800">No questions left</p>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">
                Add one manually, or go back and generate a fresh set from the résumé.
              </p>
            </div>
          ) : (
            <div className="max-h-[42vh] space-y-2.5 overflow-y-auto pr-1">
              {questions.map((q, i) => (
                <div key={q._id} className="rounded-xl border border-border bg-white p-3 shadow-xs transition-colors duration-150 hover:border-neutral-300">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold tabular-nums text-primary-800">
                      {i + 1}
                    </span>
                    <textarea
                      value={q.text}
                      onChange={(e) => patch(q._id, { text: e.target.value })}
                      className="textarea-base h-16 min-h-[64px] flex-1 text-sm"
                      placeholder="Question text…"
                      aria-label={`Question ${i + 1} text`}
                    />
                    <button
                      onClick={() => setQuestions((qs) => qs.filter((x) => x._id !== q._id))}
                      className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors duration-150 hover:bg-danger-bg hover:text-danger"
                      aria-label={`Remove question ${i + 1}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[34px]">
                    <select
                      value={q.type}
                      onChange={(e) => patch(q._id, { type: e.target.value as Editable['type'] })}
                      className="input-base h-8 w-auto cursor-pointer px-2 text-xs font-medium"
                      aria-label={`Question ${i + 1} type`}
                    >
                      <option value="technical">Technical</option>
                      <option value="non_technical">Non-technical</option>
                    </select>
                    <select
                      value={q.difficulty}
                      onChange={(e) => patch(q._id, { difficulty: e.target.value as Editable['difficulty'] })}
                      className="input-base h-8 w-auto cursor-pointer px-2 text-xs font-medium"
                      aria-label={`Question ${i + 1} difficulty`}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                    {q.category && <Badge variant="neutral">{q.category}</Badge>}
                    {q.skillTag && <Badge variant="info">{q.skillTag}</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between gap-2 pt-1">
            <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep('form')}>Back</Button>
            <Button icon={busy ? undefined : <Save size={16} />} loading={busy} onClick={save}>Save question set</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
