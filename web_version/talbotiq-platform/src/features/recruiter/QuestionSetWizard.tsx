import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import {
  ArrowLeft, ArrowRight, AlertCircle, AlertTriangle, Camera, Check, ClipboardPaste, Copy,
  Download, FileSpreadsheet, GraduationCap, Info, Loader2, PenLine, Plus, Save, Sparkles,
  Trash2, UploadCloud, Wand2, X,
} from 'lucide-react'
import { Button, Input, Badge, cn } from '@/components/ui'
import { questionSetsApi, settingsApi, downloadCsv } from '@/lib/api'
import { WizardStepper, StepSection, SelectCard, StepFooter, type WizardStep } from './wizard-ui'
import { SortableQuestion } from './QuestionRow'
import { Walkthrough, type WalkthroughStep } from '@/features/guide/Walkthrough'
import { parseQuestionsFromText, llmPromptFor } from '@shared/questionParse'
import type { FixedQuestion, DifficultyChoice, ImportedQuestion, ImportedQuestionSource } from '@shared/types'

/**
 * Building a question set, as a guided flow.
 *
 * What this replaces: "New set" created an empty record called "New set" and
 * dropped the recruiter into an editor with one blank row. Everything the
 * product could do for them — read the list ChatGPT had just written for them,
 * import the spreadsheet their team already keeps, read a photo of a printed
 * sheet, write the questions they were short of — existed, but nothing on the
 * screen said so, so the usual path was typing forty questions by hand.
 *
 * So the flow now asks the three questions in the order a person thinks them:
 *
 *   1. What is this set, and how many questions do you want in it?
 *   2. What have you got? — a paste, a file, or nothing yet.
 *   3. (the interface for whichever they picked)
 *   4. Here they are: reorder, edit, fill the gap, save.
 *
 * Step 1's COUNT is the spine of the rest. It is not validation — a recruiter
 * may save eight questions when they asked for ten — it is the target the
 * progress bar reads against and the number "generate the remaining N" uses.
 *
 * The chrome is InviteWizard's, imported rather than copied (see wizard-ui),
 * because this is the second wizard a recruiter meets and it should feel like
 * the first one.
 *
 * Nothing is written to the server until Save on Step 4. Import and generation
 * both return rows into the draft, where they are edited like any other row.
 */

type Method = 'paste' | 'upload' | 'manual'

/** A row in the draft. `source` drives the provenance chip on the review step. */
interface DraftQuestion extends FixedQuestion {
  source: ImportedQuestionSource
}

const STEPS: readonly WizardStep[] = [
  { n: 1, title: 'Basics', hint: 'Name & how many' },
  { n: 2, title: 'Source', hint: 'Where they come from' },
  { n: 3, title: 'Questions', hint: 'Bring them in' },
  { n: 4, title: 'Review', hint: 'Edit & save' },
] as const

const DIFFICULTIES: DifficultyChoice[] = ['easy', 'medium', 'hard', 'mixed']
const MAX_MB = 10
const MAX_QUESTIONS = 100

const SOURCE_LABEL: Record<ImportedQuestionSource, string> = {
  paste: 'Pasted',
  spreadsheet: 'Spreadsheet',
  document: 'File',
  image: 'Read from image',
  ai: 'Written by AI',
  manual: 'Typed',
}

const newRow = (q: ImportedQuestion, source: ImportedQuestionSource): DraftQuestion => ({
  id: crypto.randomUUID(),
  text: q.text.trim(),
  category: q.category?.trim() || '',
  idealAnswerNotes: q.idealAnswerNotes?.trim() || '',
  source,
})

const emptyRow = (): DraftQuestion => ({ id: crypto.randomUUID(), text: '', category: '', idealAnswerNotes: '', source: 'manual' })

/* ── Small parts ─────────────────────────────────────────────────────────── */

/** Where the draft stands against the count asked for in Step 1. */
function CountMeter({ filled, target }: { filled: number; target: number }) {
  const pct = target > 0 ? Math.min(100, (filled / target) * 100) : 0
  const short = Math.max(0, target - filled)
  return (
    <div className="rounded-2xl border border-border bg-surface-sunk px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          <span className="tabular-nums">{filled}</span> of <span className="tabular-nums">{target}</span> question{target === 1 ? '' : 's'}
        </p>
        <p className="text-xs text-ink-muted">
          {short === 0
            ? filled > target ? `${filled - target} more than you asked for — that's fine.` : 'Target reached.'
            : `${short} still to go.`}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div className="h-full rounded-full bg-action transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function WarningList({ warnings, onDismiss }: { warnings: string[]; onDismiss: () => void }) {
  if (warnings.length === 0) return null
  return (
    <div className="rounded-2xl border border-warning-border bg-warning-bg p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-warning">Check these before you save</p>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-sm leading-relaxed text-warning/90">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss these warnings" className="rounded-lg p-1 text-warning/70 transition-colors duration-150 hover:bg-warning-bg hover:text-warning">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

/** "No Gemini key" — said once, in the two places that actually need one. */
function NeedsKeyNotice({ what }: { what: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-border bg-surface-sunk px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
      <Info size={13} className="mt-0.5 flex-shrink-0" />
      <span>
        {what} needs a Gemini API key.{' '}
        <Link to="/settings" className="font-semibold text-ink underline underline-offset-2">Add one in Settings</Link>
        {' '}— everything else on this page works without it.
      </span>
    </p>
  )
}

/* ── The wizard ──────────────────────────────────────────────────────────── */

export default function QuestionSetWizard() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [target, setTarget] = useState(10)
  const [role, setRole] = useState('')
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState<DifficultyChoice>('mixed')
  const [method, setMethod] = useState<Method | null>(null)

  const [questions, setQuestions] = useState<DraftQuestion[]>([])
  const [paste, setPaste] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  /** Where the recruiter was before the tour moved them around. */
  const beforeTour = useRef<{ step: number; method: Method | null }>({ step: 1, method: null })

  const settings = useQuery({ queryKey: ['settings-status'], queryFn: settingsApi.status })
  const hasKey = settings.data?.geminiKeySet ?? false

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const filled = questions.filter((q) => q.text.trim()).length
  const missing = Math.max(0, target - filled)
  const step1Valid = name.trim().length >= 2 && target >= 1 && target <= MAX_QUESTIONS
  const step3Valid = filled >= 1

  /* ── Draft edits ── */
  const addQuestions = useCallback((rows: ImportedQuestion[], source: ImportedQuestionSource) => {
    setQuestions((qs) => {
      // Never import a question the draft already holds — two passes over the
      // same spreadsheet, or a paste added twice, is a common way to get here.
      const seen = new Set(qs.map((q) => q.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()))
      const fresh: DraftQuestion[] = []
      for (const r of rows) {
        const key = r.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        if (!key || seen.has(key)) continue
        seen.add(key)
        fresh.push(newRow(r, source))
      }
      // Blank rows the recruiter never filled in would otherwise sit above the
      // import; imported questions replace them rather than queue behind them.
      const kept = qs.filter((q) => q.text.trim())
      return [...kept, ...fresh].slice(0, MAX_QUESTIONS)
    })
  }, [])

  const patch = (id: string, p: Partial<FixedQuestion>) =>
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...p } : q)))
  const removeRow = (id: string) => setQuestions((qs) => qs.filter((q) => q.id !== id))
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    setQuestions((qs) => {
      const from = qs.findIndex((q) => q.id === e.active.id)
      const to = qs.findIndex((q) => q.id === e.over!.id)
      return from < 0 || to < 0 ? qs : arrayMove(qs, from, to)
    })
  }

  /* ── Paste ── */
  // Parsed on every keystroke, in the browser: the recruiter sees the questions
  // the parser found while they are still looking at what they pasted, which is
  // the only moment a formatting problem is cheap to fix.
  const pasteParsed = useMemo(() => parseQuestionsFromText(paste), [paste])

  const copyPrompt = async () => {
    const prompt = llmPromptFor({ count: missing || target, role, topic, difficulty })
    try {
      await navigator.clipboard.writeText(prompt)
      toast.success('Prompt copied — paste it into ChatGPT, Claude or Gemini')
    } catch {
      toast.error('Clipboard blocked by the browser — select the prompt and copy it manually')
    }
  }

  /* ── Upload ── */
  const onFile = async (f: File | null) => {
    if (!f) return
    setFileError(null)
    if (f.size > MAX_MB * 1024 * 1024) { setFileError(`That file is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_MB} MB.`); return }
    setExtracting(true)
    try {
      const result = await questionSetsApi.extract(f)
      addQuestions(result.questions, result.source)
      setWarnings(result.warnings)
      if (result.questions.length === 0) {
        setFileError('No questions could be read out of that file.')
      } else {
        toast.success(`${result.questions.length} question${result.questions.length === 1 ? '' : 's'} imported from ${f.name}`)
        setStep(4)
      }
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'That file could not be read.')
    } finally {
      setExtracting(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const downloadTemplate = () => {
    downloadCsv(
      'question-set-template.csv',
      ['Question', 'Category', 'Ideal answer'],
      [
        ['Walk me through a system you designed end to end.', 'System design', 'Names the constraints, the trade-offs, and what they would change.'],
        ['Tell me about a time you disagreed with a decision.', 'Behavioural', 'A concrete example, their actual part in it, and the outcome.'],
      ],
    )
  }

  /* ── Generate the rest ── */
  const generateRest = async () => {
    if (missing < 1) return
    setGenerating(true)
    try {
      const result = await questionSetsApi.generateMore({
        count: Math.min(missing, 25),
        existing: questions.map((q) => q.text).filter(Boolean),
        role: role.trim() || undefined,
        setName: name.trim() || undefined,
        topic: topic.trim() || undefined,
        difficulty,
      })
      addQuestions(result.questions, 'ai')
      toast.success(`${result.questions.length} question${result.questions.length === 1 ? '' : 's'} written — edit anything that isn't right`)
      setStep(4)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  /* ── Save ── */
  const save = async () => {
    const rows = questions.filter((q) => q.text.trim())
    if (rows.length === 0) { toast.error('Add at least one question before saving'); return }
    setSaving(true)
    try {
      const set = await questionSetsApi.create({
        name: name.trim() || 'Untitled set',
        questions: rows.map(({ id, text, category, idealAnswerNotes }): FixedQuestion => ({
          id, text: text.trim(), category: category?.trim() || undefined, idealAnswerNotes: idealAnswerNotes?.trim() || undefined,
        })),
      })
      qc.invalidateQueries({ queryKey: ['question-sets'] })
      toast.success(`Saved “${set.name}” with ${set.questions.length} question${set.questions.length === 1 ? '' : 's'}`)
      navigate('/question-sets', { state: { selectId: set.id } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
      setSaving(false)
    }
  }

  const leave = () => {
    if (filled > 0 && !confirm('Leave without saving? The questions in this draft will be lost.')) return
    navigate('/question-sets')
  }

  /* ── The guided tour ─────────────────────────────────────────────────────
     Steps carry `place`, and entering one moves the wizard there, so the panel
     never describes a control that is not on screen. Where the recruiter was
     is restored when the tour closes — a tutorial that leaves you three steps
     from where you started has cost you something for reading it. */
  const TOUR: (WalkthroughStep & { place?: { step: number; method?: Method } })[] = [
    {
      id: 'welcome',
      title: 'Building a question set',
      place: { step: 1 },
      body: (
        <>
          <p>A question set is a fixed list of questions an interview asks, in the order you put them in. Build it once, then attach it to as many interviews as you like.</p>
          <p>Four steps: name it, say where the questions come from, bring them in, then check them over and save.</p>
          <p className="text-ink-muted">Use Next and Back below, or the ← → arrow keys. Everything stays clickable while this is open, so try things as you go.</p>
        </>
      ),
    },
    {
      id: 'name',
      title: 'Name the set',
      target: 'name',
      place: { step: 1 },
      body: <p>The name is what you’ll pick from when you set up an interview, so name it after the job rather than the day — “Backend Engineer — first round” beats “Questions v2”.</p>,
      action: 'Type a name you would recognise in a list six months from now.',
    },
    {
      id: 'count',
      title: 'How many questions',
      target: 'count',
      place: { step: 1 },
      body: (
        <>
          <p>This is your target, not a limit. It drives the progress bar on the review step and it is the number behind <strong>Write the remaining questions</strong>.</p>
          <p>A first-round screen is usually 8–12. You can save fewer, or more.</p>
        </>
      ),
    },
    {
      id: 'context',
      title: 'Role, subject and difficulty',
      target: 'context',
      place: { step: 1 },
      body: <p>All optional, and all only used when AI writes questions for you — either through the ready-made prompt on the paste step, or through “write the remaining questions” at the end. Leave them blank if you are bringing your own questions.</p>,
    },
    {
      id: 'methods',
      title: 'Three ways in',
      target: 'methods',
      place: { step: 2 },
      body: (
        <>
          <p>Pick whichever matches what you already have in front of you:</p>
          <ul className="list-disc space-y-1 pl-4">
            <li><strong>Paste</strong> — a list an LLM wrote, or any text.</li>
            <li><strong>Upload</strong> — a photo, PDF, Word file, or an Excel/CSV sheet.</li>
            <li><strong>Write them yourself</strong> — a blank list, ready to type.</li>
          </ul>
          <p>They are not exclusive. Import a spreadsheet, then add two of your own, then have AI fill the gap.</p>
        </>
      ),
    },
    {
      id: 'paste',
      title: 'Pasting from an LLM',
      target: 'paste-box',
      place: { step: 3, method: 'paste' },
      body: (
        <>
          <p>Paste the whole reply, preamble and all. Numbered lists, bullets, <code>Q:</code> lines and markdown are all understood, and the model’s “Here are 10 questions…” chatter is dropped.</p>
          <p>Two extra lines are read if they are there: <strong>Category:</strong> and <strong>Ideal answer:</strong>. Section headings like “Technical questions” become categories for everything under them.</p>
          <p>The count updates as you paste — nothing is added to your set until you press the button.</p>
        </>
      ),
    },
    {
      id: 'prompt',
      title: 'The ready-made prompt',
      target: 'copy-prompt',
      place: { step: 3, method: 'paste' },
      body: <p>Haven’t written the questions yet? This copies a prompt built from your role, subject and difficulty, and asks for exactly the layout this page reads best. Paste it into ChatGPT, Claude or Gemini, then paste the reply back here.</p>,
      action: 'Copy it, run it in your LLM of choice, bring the answer back.',
    },
    {
      id: 'upload',
      title: 'Photos, PDFs and Word files',
      target: 'dropzone',
      place: { step: 3, method: 'upload' },
      body: (
        <>
          <p>A PDF, Word file or text file is read locally and parsed like a paste — instant, and it works with no API key.</p>
          <p>A <strong>photo or a scan</strong> — a picture of a printed question sheet, a screenshot — is transcribed by AI instead, because there is no text in the file to read. That path needs a Gemini key, and everything it reads is marked so you know to check it.</p>
        </>
      ),
    },
    {
      id: 'excel',
      title: 'Excel and CSV imports',
      target: 'template',
      place: { step: 3, method: 'upload' },
      body: (
        <>
          <p>A spreadsheet is read column by column. Give it a header row with <strong>Question</strong>, and optionally <strong>Category</strong> and <strong>Ideal answer</strong> — the columns can be in any order, and the names are matched loosely (“Topic” and “Expected answer” work too).</p>
          <p>With no header row, the longest column is read as the questions and you get a warning saying so. Only the first sheet of a workbook is read.</p>
        </>
      ),
      action: 'Download the template to see the exact shape.',
    },
    {
      id: 'manual',
      title: 'Writing them yourself',
      target: 'method-manual',
      place: { step: 2 },
      body: <p>This starts you with as many blank rows as the count you asked for, so you can type straight down the list. Each row takes the question, an optional category, and optional ideal-answer notes.</p>,
    },
    {
      id: 'review',
      title: 'Review and reorder',
      target: 'review-list',
      place: { step: 4 },
      body: (
        <>
          <p>Everything you brought in lands here, whichever way it arrived. Drag by the handle to reorder — this is the order the interview asks them in.</p>
          <p><strong>Category</strong> groups a question in the report. <strong>Ideal answer</strong> is what AI scoring marks the candidate’s answer against, so a sentence here is worth more than a perfect question with nothing to mark it by.</p>
          <p>The chip on a row says where it came from, so a question AI wrote is never mistaken for one you did.</p>
        </>
      ),
    },
    {
      id: 'generate',
      title: 'Writing the rest for you',
      target: 'generate-more',
      place: { step: 4 },
      body: (
        <>
          <p>Short of your target? This writes exactly the number you are missing. Every question already in the draft is sent along, so it writes around them instead of repeating them, and it uses the role, subject and difficulty from Step 1.</p>
          <p>They arrive as ordinary rows marked “Written by AI” — edit or delete any of them. Needs a Gemini key.</p>
        </>
      ),
    },
    {
      id: 'save',
      title: 'Saving the set',
      target: 'save',
      place: { step: 4 },
      body: (
        <>
          <p>Save writes the set once, with the questions in the order shown. Nothing has touched the server before this point.</p>
          <p>You land back on Question Sets with this set open, where you can keep editing it, duplicate it for a similar role, or pick it when you invite candidates.</p>
        </>
      ),
    },
  ]

  const openTour = () => { beforeTour.current = { step, method }; setTourOpen(true) }
  const closeTour = () => { setTourOpen(false); setStep(beforeTour.current.step); setMethod(beforeTour.current.method) }
  const onTourStep = useCallback((s: WalkthroughStep) => {
    const place = (s as { place?: { step: number; method?: Method } }).place
    if (!place) return
    setStep(place.step)
    if (place.method) setMethod(place.method)
  }, [])

  /* ── Render ──────────────────────────────────────────────────────────── */

  const questionList = (
    <div data-walk="review-list" className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
          {questions.map((q, i) => (
            <SortableQuestion
              key={q.id}
              q={q}
              index={i}
              onChange={(p) => patch(q.id, p)}
              onRemove={() => removeRow(q.id)}
              badge={
                q.source !== 'manual'
                  ? <Badge variant={q.source === 'ai' || q.source === 'image' ? 'info' : 'neutral'}>{SOURCE_LABEL[q.source]}</Badge>
                  : undefined
              }
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        onClick={() => setQuestions((qs) => [...qs, emptyRow()])}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-rule-strong py-3 text-sm font-semibold text-ink-muted transition-colors duration-150 hover:bg-surface-hover/50 hover:text-ink"
      >
        <Plus size={15} /> Add question
      </button>
    </div>
  )

  return (
    /* While the tour is docked bottom-right, the page moves out from under it:
       the panel would otherwise sit on top of the step footer, covering the
       primary button of the step being explained. */
    <div
      className={cn(
        'mx-auto max-w-[900px] px-6 py-8 transition-[margin,padding] duration-200',
        tourOpen && 'pb-[24rem] sm:pb-[20rem] lg:mr-[420px] lg:pb-8',
      )}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <button onClick={leave} className="inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
          <ArrowLeft size={15} /> Back to question sets
        </button>
        <Button
          size="sm"
          variant={tourOpen ? 'secondary' : 'outline'}
          icon={<GraduationCap size={14} />}
          onClick={() => (tourOpen ? closeTour() : openTour())}
        >
          {tourOpen ? 'Close the tour' : 'Show me how'}
        </Button>
      </div>

      <div className="mb-6">
        <span className="pill mb-2.5 inline-flex">Question sets</span>
        <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-ink">Build a question set</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          A fixed list of questions an interview asks in order. Bring them from an LLM, a file or a photo — or write them here —
          and have the ones you’re missing written for you.
        </p>
      </div>

      <div className="mb-7">
        <WizardStepper steps={STEPS} step={step} />
      </div>

      {/* ── Step 1: basics ── */}
      {step === 1 && (
        <div className="space-y-8">
          <StepSection title="Name and size" hint="The two things every set needs. Everything else can change later.">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <div data-walk="name">
                <Input
                  label="Set name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Backend Engineer — first round"
                  hint="Shown when you pick a question set while setting up an interview."
                  autoFocus
                />
              </div>
              <div data-walk="count">
                <Input
                  label="How many questions"
                  type="number"
                  min={1}
                  max={MAX_QUESTIONS}
                  value={target}
                  onChange={(e) => setTarget(Math.min(MAX_QUESTIONS, Math.max(1, Number(e.target.value) || 1)))}
                  hint="A target, not a limit."
                />
              </div>
            </div>
          </StepSection>

          <StepSection
            title="Context for AI (optional)"
            hint="Used only when AI writes questions for you — the ready-made prompt on the paste step, and “write the remaining questions” at the end. Skip it if you’re bringing your own."
          >
            <div data-walk="context" className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior Backend Engineer" />
                <Input label="Subject areas" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Kafka, Postgres, on-call" />
              </div>
              <div>
                <label className="field-label">Difficulty</label>
                <div className="grid max-w-md grid-cols-4 gap-2">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDifficulty(d)}
                      aria-pressed={difficulty === d}
                      className={cn(
                        'rounded-full border-[1.5px] px-3 py-1.5 text-xs font-semibold capitalize transition-colors duration-150',
                        difficulty === d
                          ? 'border-action bg-surface-hover text-ink'
                          : 'border-border bg-surface text-ink-muted hover:border-rule hover:bg-surface-hover/50 hover:text-ink-body',
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </StepSection>

          <StepFooter
            left={<Button variant="ghost" onClick={leave}>Cancel</Button>}
            hint={step1Valid ? undefined : 'Name the set to continue.'}
            right={<Button disabled={!step1Valid} onClick={() => setStep(2)} iconRight={<ArrowRight size={15} />}>Next: Source</Button>}
          />
        </div>
      )}

      {/* ── Step 2: where the questions come from ── */}
      {step === 2 && (
        <div className="space-y-8">
          <StepSection title="Where do the questions come from?" hint="Pick the one that matches what you have right now. You can use the others afterwards too — nothing here locks you in.">
            <div data-walk="methods" className="grid gap-3 sm:grid-cols-3">
              <SelectCard
                walk="method-paste"
                selected={method === 'paste'}
                onClick={() => { setMethod('paste'); setStep(3) }}
                icon={<ClipboardPaste size={20} />}
                title="Paste from an LLM"
                blurb="Drop in a list ChatGPT, Claude or Gemini wrote — or any text. Numbering, bullets and headings are all read."
              />
              <SelectCard
                walk="method-upload"
                selected={method === 'upload'}
                onClick={() => { setMethod('upload'); setStep(3) }}
                icon={<UploadCloud size={20} />}
                title="Upload a file"
                blurb="A photo of a printed sheet, a PDF or Word file, or an Excel/CSV question bank."
              />
              <SelectCard
                walk="method-manual"
                selected={method === 'manual'}
                onClick={() => {
                  setMethod('manual')
                  // Start them with the number of rows they asked for, so the
                  // work is typing rather than pressing "add" forty times.
                  setQuestions((qs) => (qs.length > 0 ? qs : Array.from({ length: Math.min(target, 25) }, emptyRow)))
                  setStep(3)
                }}
                icon={<PenLine size={20} />}
                title="Write them myself"
                blurb="A blank list, one row per question, ready to type into."
              />
            </div>
          </StepSection>

          {questions.length > 0 && (
            <p className="flex items-start gap-2.5 rounded-2xl border border-rule bg-surface-hover/60 p-4 text-sm leading-relaxed text-ink-body">
              <Info size={15} className="mt-0.5 flex-shrink-0 text-ink-muted" />
              <span>
                This draft already holds <strong className="tabular-nums">{filled}</strong> question{filled === 1 ? '' : 's'}. Picking a source adds to them — it doesn’t start over.
              </span>
            </p>
          )}

          <StepFooter
            left={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(1)}>Back</Button>}
            hint={method ? undefined : 'Pick one to continue.'}
            right={
              <Button disabled={!method} onClick={() => setStep(3)} iconRight={<ArrowRight size={15} />}>
                Next: Questions
              </Button>
            }
          />
        </div>
      )}

      {/* ── Step 3: the interface for the chosen source ── */}
      {step === 3 && (
        <div className="space-y-8">
          {method === 'paste' && (
            <StepSection
              title="Paste your questions"
              hint="Paste the whole reply — preamble and sign-off are dropped. Numbered lists, bullets, Q: lines, markdown headings, and Category / Ideal answer lines are all understood."
              action={
                <div data-walk="copy-prompt">
                  <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={copyPrompt}>
                    Copy a prompt for your LLM
                  </Button>
                </div>
              }
            >
              <div data-walk="paste-box">
                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  aria-label="Paste questions here"
                  placeholder={'1. Walk me through how you would design a rate limiter.\nCategory: System design\nIdeal answer: names a token bucket, discusses distributed state.\n\n2. Tell me about a production incident you owned.'}
                  className="textarea-base min-h-[260px] font-mono text-xs leading-relaxed"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-muted">
                  {paste.trim().length === 0
                    ? 'Nothing pasted yet.'
                    : pasteParsed.length === 0
                      ? 'No questions found in that text — check each question sits on its own line.'
                      : <><strong className="tabular-nums text-ink">{pasteParsed.length}</strong> question{pasteParsed.length === 1 ? '' : 's'} found.</>}
                </p>
                <div className="flex items-center gap-2">
                  {paste.trim() && <Button size="sm" variant="ghost" onClick={() => setPaste('')}>Clear</Button>}
                  <Button
                    size="sm"
                    icon={<Plus size={14} />}
                    disabled={pasteParsed.length === 0}
                    onClick={() => {
                      addQuestions(pasteParsed, 'paste')
                      setPaste('')
                      setStep(4)
                    }}
                  >
                    Add {pasteParsed.length || ''} to the set
                  </Button>
                </div>
              </div>

              {pasteParsed.length > 0 && (
                <ol className="mt-4 max-h-[34vh] space-y-1.5 overflow-y-auto rounded-2xl border border-border bg-surface-sunk p-3">
                  {pasteParsed.map((q, i) => (
                    <li key={i} className="flex gap-2.5 rounded-lg bg-surface px-3 py-2 text-sm text-ink">
                      <span className="mt-0.5 text-xs font-bold tabular-nums text-ink-faint">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        {q.text}
                        {(q.category || q.idealAnswerNotes) && (
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            {q.category && <Badge variant="neutral">{q.category}</Badge>}
                            {q.idealAnswerNotes && <span className="truncate text-xs text-ink-muted">Ideal: {q.idealAnswerNotes}</span>}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </StepSection>
          )}

          {method === 'upload' && (
            <StepSection
              title="Upload a file"
              hint="Spreadsheets, PDFs, Word and text files are read on our server without AI. Photos and scans are transcribed by AI, and everything it reads is flagged for you to check."
              action={
                <div data-walk="template">
                  <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={downloadTemplate}>
                    Spreadsheet template
                  </Button>
                </div>
              }
            >
              <div
                data-walk="dropzone"
                onClick={() => !extracting && fileInput.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFile(e.dataTransfer.files?.[0] ?? null) }}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-150',
                  dragOver ? 'border-action bg-surface-hover' : 'border-border bg-surface-sunk hover:border-rule hover:bg-surface-hover/40',
                  extracting && 'pointer-events-none opacity-70',
                )}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface text-ink">
                  {extracting ? <Loader2 size={22} className="animate-spin" /> : <UploadCloud size={22} />}
                </span>
                <span className="text-sm font-semibold text-ink">
                  {extracting ? 'Reading your file…' : 'Drag a file here, or click to choose'}
                </span>
                <span className="text-xs text-ink-faint">Excel · CSV · PDF · Word · text · photo — max {MAX_MB} MB</span>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,.tsv,.xlsx,.xls,.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.heic,image/*,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className="hidden"
                  onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {fileError && (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-bg p-3 text-sm leading-relaxed text-danger">
                  <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                  <span>{fileError}</span>
                </p>
              )}

              {/* An import that found nothing stays on this step, so its
                  warnings — which say WHY, e.g. which column was read — have to
                  be here too and not only on the review step. */}
              {warnings.length > 0 && (
                <div className="mt-3">
                  <WarningList warnings={warnings} onDismiss={() => setWarnings([])} />
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <FileSpreadsheet size={15} className="text-ink-muted" /> Excel &amp; CSV
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                    A header row of <strong className="text-ink-body">Question</strong>, and optionally <strong className="text-ink-body">Category</strong> and{' '}
                    <strong className="text-ink-body">Ideal answer</strong> — in any order, matched loosely. No header row still works; you’ll get a warning
                    saying which column was read. Only the first sheet is imported.
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Camera size={15} className="text-ink-muted" /> Photos &amp; scans
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                    A picture of a printed sheet, a screenshot, or a PDF with no text in it is transcribed by AI and marked
                    “Read from image” so you know to check it against the original.
                  </p>
                  {!hasKey && <div className="mt-2.5"><NeedsKeyNotice what="Reading a photo or a scan" /></div>}
                </div>
              </div>
            </StepSection>
          )}

          {method === 'manual' && (
            <StepSection
              title="Write your questions"
              hint="One row per question. Category groups it in the report; ideal-answer notes are what AI scoring marks against."
              action={
                missing > 0 && hasKey
                  ? (
                    <Button size="sm" variant="intel" icon={<Sparkles size={14} />} loading={generating} onClick={generateRest}>
                      Write the last {missing}
                    </Button>
                  )
                  : undefined
              }
            >
              <CountMeter filled={filled} target={target} />
              <div className="mt-4">{questionList}</div>
            </StepSection>
          )}

          {!method && (
            <p className="rounded-2xl border border-dashed border-rule-strong bg-surface-sunk px-4 py-8 text-center text-sm text-ink-muted">
              Go back a step and pick where your questions are coming from.
            </p>
          )}

          <StepFooter
            left={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(2)}>Back</Button>}
            hint={step3Valid ? undefined : 'Bring in at least one question to continue.'}
            right={<Button disabled={!step3Valid} onClick={() => setStep(4)} iconRight={<ArrowRight size={15} />}>Next: Review</Button>}
          />
        </div>
      )}

      {/* ── Step 4: review and save ── */}
      {step === 4 && (
        <div className="space-y-6">
          <WarningList warnings={warnings} onDismiss={() => setWarnings([])} />

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Input label="Set name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled set" />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<ClipboardPaste size={14} />} onClick={() => { setMethod('paste'); setStep(3) }}>
                Paste more
              </Button>
              <Button variant="secondary" icon={<UploadCloud size={14} />} onClick={() => { setMethod('upload'); setStep(3) }}>
                Import a file
              </Button>
            </div>
          </div>

          <CountMeter filled={filled} target={target} />

          {missing > 0 && (
            <div data-walk="generate-more" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Wand2 size={15} className="text-ink-muted" />
                  {missing} question{missing === 1 ? '' : 's'} short of your target
                </p>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-muted">
                  Have them written for you, around the {filled} you already have{role.trim() ? `, for a ${role.trim()}` : ''} — no repeats. They arrive
                  as ordinary rows you can edit or delete.
                </p>
                {!hasKey && <div className="mt-2.5 max-w-xl"><NeedsKeyNotice what="Writing questions for you" /></div>}
              </div>
              <Button
                variant="intel"
                icon={<Sparkles size={15} />}
                loading={generating}
                disabled={!hasKey}
                onClick={generateRest}
              >
                Write the remaining {Math.min(missing, 25)}
              </Button>
            </div>
          )}

          <StepSection
            title="Your questions"
            hint="Drag the handle to reorder — this is the order the interview asks them in."
            action={
              questions.length > 0
                ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<Trash2 size={13} />}
                    onClick={() => { if (confirm('Remove every question from this draft?')) setQuestions([]) }}
                    className="hover:text-danger"
                  >
                    Clear all
                  </Button>
                )
                : undefined
            }
          >
            {questions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-rule-strong bg-surface-sunk px-4 py-10 text-center">
                <p className="text-sm font-semibold text-ink">Nothing in this set yet</p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-muted">
                  Go back to pick a source, or add a row and type one.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button size="sm" variant="secondary" icon={<ArrowLeft size={14} />} onClick={() => setStep(2)}>Pick a source</Button>
                  <Button size="sm" icon={<Plus size={14} />} onClick={() => setQuestions([emptyRow()])}>Add a question</Button>
                </div>
              </div>
            ) : questionList}
          </StepSection>

          <StepFooter
            left={
              <>
                <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(3)}>Back</Button>
                <Button variant="ghost" onClick={leave}>Cancel</Button>
              </>
            }
            hint={
              filled === 0
                ? 'Add at least one question to save.'
                : filled < target
                  ? `Saving ${filled} of the ${target} you planned — that's allowed.`
                  : undefined
            }
            right={
              <div data-walk="save">
                <Button icon={<Save size={15} />} loading={saving} disabled={filled === 0} onClick={save}>
                  Save question set
                </Button>
              </div>
            }
          />
        </div>
      )}

      <Walkthrough
        open={tourOpen}
        steps={TOUR}
        kicker="Question sets"
        onEnter={onTourStep}
        onClose={closeTour}
      />

      {/* A first-time hint that the tour exists. Shown only on Step 1 and only
          while the draft is untouched, so it never competes with real work. */}
      {!tourOpen && step === 1 && questions.length === 0 && (
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-faint">
          <Check size={12} /> First time here? “Show me how” walks through every option, including Excel imports.
        </p>
      )}
    </div>
  )
}
