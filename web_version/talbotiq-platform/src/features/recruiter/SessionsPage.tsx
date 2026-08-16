import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, Copy, ExternalLink, FileStack, Plus, Sparkles } from 'lucide-react'
import {
  PageHeader, Card, Button, Input, Select, Badge, EmptyState, ErrorState, RecordRows,
  ExhibitTab, Citation, Modal, Toggle, cn,
} from '@/components/ui'
import { templatesApi, sessionsApi, settingsApi, describeFetchError } from '@/lib/api'
import { GenerateFromResumeModal } from './GenerateFromResumeModal'
import type { SessionListItem, TrackType } from '@shared/types'

const statusVariant: Record<string, 'success' | 'warning' | 'neutral' | 'info' | 'danger'> = {
  completed: 'success',
  in_progress: 'info',
  system_check: 'warning',
  created: 'neutral',
  expired: 'danger',
}

/**
 * The filing reference. A bundle's pages are numbered, not portrait-chipped —
 * and unlike an initials avatar this is something a recruiter can actually
 * quote back to a colleague or paste into a ticket. Derived from the session id
 * so it is stable and needs no extra field.
 */
const filingRef = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase().padStart(6, '0')

/** Score ink by band: strong / borderline / low. */
const scoreTone = (score: number) =>
  score >= 80 ? 'text-success' : score >= 65 ? 'text-warning' : 'text-neutral-900'

export default function SessionsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [createdLink, setCreatedLink] = useState<string | null>(null)

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: sessionsApi.list })
  const templates = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list })
  // Whether a Video Avatar config has been applied (Setup page) — gates the
  // Conversational AI mode: without it, candidate avatar interviews can't start.
  const avatarApplied = useQuery({ queryKey: ['avatar-settings'], queryFn: settingsApi.avatarStatus })

  const [templateId, setTemplateId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [track, setTrack] = useState<TrackType | ''>('')
  const [timerOn, setTimerOn] = useState(true)
  const [timerSeconds, setTimerSeconds] = useState(120)

  // Reflect the selected template's effective timer state (chat templates
  // inherit their answer limit on the chatbot track, so they default ON).
  useEffect(() => {
    const tpl = templates.data?.find((t) => t.id === templateId)
    if (!tpl) return
    setTimerOn(tpl.chatbotTimer ? !!tpl.chatbotTimer.enabled : tpl.track === 'chat' || tpl.mode === 'timed')
    setTimerSeconds(tpl.chatbotTimer?.perQuestionSeconds ?? tpl.timing?.answerSeconds ?? 120)
  }, [templateId, templates.data])

  const create = useMutation({
    mutationFn: async () => {
      // Persist the timer choice on the template FIRST so the session (and any
      // future one from this template) runs with exactly what's shown here.
      const tpl = templates.data?.find((t) => t.id === templateId)
      if (tpl) {
        const chatbotTimer = {
          timeFollowUps: true, includeThinkingPhase: false, warningThresholdSeconds: 15,
          allowEarlySubmit: true, autoSubmitOnExpiry: true,
          ...(tpl.chatbotTimer ?? {}),
          enabled: timerOn,
          perQuestionSeconds: timerSeconds,
        }
        await templatesApi.update(templateId, timerOn
          ? { chatbotTimer, timing: { ...tpl.timing, answerSeconds: timerSeconds } } // keep Timed Q&A in sync
          : { chatbotTimer })
        qc.invalidateQueries({ queryKey: ['templates'] })
      }
      return sessionsApi.create({
        templateId,
        candidate: { name: name || 'Candidate', email },
        track: track || undefined,
      })
    },
    onSuccess: ({ id }) => {
      const link = `${window.location.origin}/take/${id}`
      setCreatedLink(link)
      qc.invalidateQueries({ queryKey: ['sessions'] })
      toast.success('Session created')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openCreate = () => {
    setCreatedLink(null)
    setTemplateId(templates.data?.[0]?.id ?? '')
    setName('')
    setEmail('')
    setTrack('')
    setOpen(true)
  }

  return (
    // overflow-x-clip enforces the system's binding rule at the page level: a
    // wide child scrolls in its own container, and the body never scrolls
    // sideways no matter what a descendant does.
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-8 pb-28 overflow-x-clip">
      <PageHeader
        title="Sessions"
        description="Every interview on the record. Each row is one candidate, tabbed by the format they were interviewed in, scored against its template's rubric."
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={openCreate}>Single link</Button>
            <Button variant="mint" onClick={() => navigate('/sessions/new')}>Invite candidates</Button>
          </div>
        }
      />

      {sessions.isLoading ? (
        <Card className="overflow-hidden p-0">
          <div className="record-head px-4 py-2.5">
            <span className="section-label">Loading the record…</span>
          </div>
          <RecordRows rows={6} />
        </Card>
      ) : sessions.isError ? (
        /* An error is never rendered as an empty state: a failed fetch used to
           tell a recruiter their sessions don't exist when the server was simply
           unreachable. Name the failure, and say the data is safe. */
        <Card className="p-0">
          <ErrorState
            title="Couldn't load the record"
            detail={describeFetchError(
              sessions.error,
              "Nothing has been lost — this view just couldn't reach the server. Check your connection and try again.",
            )}
            onRetry={() => void sessions.refetch()}
          />
        </Card>
      ) : !sessions.data?.length ? (
        <Card className="p-0">
          <EmptyState
            icon={<FileStack strokeWidth={1.75} />}
            title="The record is empty"
            description="Invite candidates, or create a single link to test a template yourself. Completed interviews are filed here with their scores and evidence."
            action={<Button onClick={openCreate} icon={<Plus size={15} />}>Create a single link</Button>}
          />
        </Card>
      ) : (
        /* THE BUNDLE INDEX.
           One row per filed record. The reference is quotable, the exhibit tab
           encodes the interview format so a recruiter reads format before words,
           and scores sit in one tabular-mono column so a scan compares digits
           rather than hunting across differently-shaped chips. */
        <Card className="overflow-hidden p-0">
          <div className="record-head flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <span className="section-label">Bundle index</span>
            <span className="font-mono nums text-[11px] text-neutral-500">
              {sessions.data.length} record{sessions.data.length === 1 ? '' : 's'}
              {' · '}
              {sessions.data.filter((s) => s.status === 'completed').length} filed
            </span>
          </div>

          {/* The index scrolls inside its own container and the page body never
              scrolls sideways. `min-w` is load-bearing: without it the columns
              squeezed to fit a phone, wrapping "Software Engineer — invite" onto
              three lines and inflating rows to 84px. A wide table should keep
              its natural column widths and scroll, not compress and wrap. */}
          <div className="hidden w-full overflow-x-auto md:block">
            <table className="w-full min-w-[880px] text-sm">
              <caption className="sr-only">Interview records, newest first</caption>
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500">
                  <th scope="col" className="px-4 py-2.5 font-bold">Ref</th>
                  <th scope="col" className="px-4 py-2.5 font-bold">Candidate</th>
                  <th scope="col" className="px-4 py-2.5 font-bold">Standard applied</th>
                  <th scope="col" className="px-4 py-2.5 font-bold">Format</th>
                  <th scope="col" className="px-4 py-2.5 font-bold">Status</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-bold">Score</th>
                  <th scope="col" className="px-4 py-2.5 font-bold">Evidence</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-bold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sessions.data.map((s: SessionListItem) => (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0 transition-colors duration-150 hover:bg-neutral-50"
                  >
                    <td className="px-4 py-3 align-middle">
                      <span className="font-mono nums text-[11px] text-neutral-500">{filingRef(s.id)}</span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-neutral-900">{s.candidate.name}</div>
                        {/* Unnamed candidates fall back to their email in the
                            line above; repeating it here reads as a bug. */}
                        {s.candidate.email && s.candidate.email !== s.candidate.name && (
                          <div className="truncate text-xs text-neutral-500">{s.candidate.email}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-neutral-600">{s.templateName}</td>
                    <td className="px-4 py-3 align-middle">
                      <ExhibitTab track={s.track} />
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <Badge variant={statusVariant[s.status] ?? 'neutral'}>{s.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3 align-middle text-right">
                      {typeof s.overallScore === 'number' ? (
                        <span className={cn('font-mono nums text-[17px] font-medium', scoreTone(s.overallScore))}>
                          {s.overallScore}
                        </span>
                      ) : (
                        <span className="font-mono text-neutral-400" aria-label="Not yet scored">—</span>
                      )}
                    </td>
                    {/* The thesis, made operable: a score never stands alone —
                        it carries the route to the record that produced it. */}
                    <td className="px-4 py-3 align-middle">
                      {/* A real count, derived server-side from the report's
                          scored answers — the score never appears without the
                          weight of evidence behind it. */}
                      {s.status === 'completed' ? (
                        <Citation count={s.citedAnswers} label="see record" onOpen={() => navigate(`/sessions/${s.id}/report`)} />
                      ) : (
                        <Citation />
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/take/${s.id}`)
                            toast.success('Candidate link copied')
                          }}
                          className="text-xs font-medium text-neutral-500 transition-colors duration-150 hover:text-primary-700"
                        >
                          Copy link
                        </button>
                        {s.track === 'two_way' && s.status !== 'completed' && s.status !== 'expired' && (
                          <Link to={`/live/${s.id}`} className="text-xs font-semibold text-primary-700 hover:underline">
                            Join call
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MOBILE — a stacked record per candidate, not the desktop table
              turned sideways. An 880px table in a horizontal scroller clipped
              "Standard applied" mid-word and pushed format, status and score —
              the three columns this concept is built on — entirely off the
              first view. A bundle page is portrait anyway. */}
          <ul className="divide-y divide-border md:hidden">
            {sessions.data.map((s: SessionListItem) => (
              <li key={s.id} className="px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono nums text-[11px] text-neutral-500">{filingRef(s.id)}</span>
                  {typeof s.overallScore === 'number' ? (
                    <span className={cn('font-mono nums text-[19px] font-medium leading-none', scoreTone(s.overallScore))}>
                      {s.overallScore}
                    </span>
                  ) : (
                    <span className="font-mono text-neutral-400 leading-none" aria-label="Not yet scored">—</span>
                  )}
                </div>

                <p className="mt-1.5 font-semibold text-neutral-900">{s.candidate.name}</p>
                {s.candidate.email && s.candidate.email !== s.candidate.name && (
                  <p className="truncate text-xs text-neutral-500">{s.candidate.email}</p>
                )}
                <p className="mt-1 text-xs text-neutral-600">{s.templateName}</p>

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <ExhibitTab track={s.track} />
                  <Badge variant={statusVariant[s.status] ?? 'neutral'}>{s.status.replace('_', ' ')}</Badge>
                </div>

                {/* One baseline, one type size. Previously `Open record` rendered
                    larger and bolder than its neighbours, so three actions read
                    as a fault rather than a set. */}
                <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2 text-xs">
                  {s.status === 'completed'
                    ? <Citation count={s.citedAnswers} label="see record" onOpen={() => navigate(`/sessions/${s.id}/report`)} />
                    : <Citation />}
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/take/${s.id}`)
                      toast.success('Candidate link copied')
                    }}
                    className="font-medium text-neutral-500 hover:text-primary-700"
                  >
                    Copy link
                  </button>
                  {s.track === 'two_way' && s.status !== 'completed' && s.status !== 'expired' && (
                    <Link to={`/live/${s.id}`} className="font-medium text-primary-700 hover:underline">
                      Join call
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New interview session" description="Generates a shareable candidate link.">
        {createdLink ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-md border border-success-border bg-success-bg p-4">
              <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm bg-success text-white">
                <Check size={13} strokeWidth={2.5} />
              </span>
              <div>
                <p className="text-sm font-semibold text-neutral-900">Interview link ready</p>
                <p className="mt-0.5 text-xs leading-relaxed text-neutral-600">
                  Share it with the candidate — the link opens their interview directly.
                </p>
              </div>
            </div>
            <div>
              <span className="field-label">Candidate link</span>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={createdLink}
                  aria-label="Candidate interview link"
                  className="input-base flex-1 font-mono text-xs"
                />
                <Button
                  variant="secondary"
                  icon={<Copy size={14} />}
                  onClick={() => { navigator.clipboard.writeText(createdLink); toast.success('Link copied') }}
                >
                  Copy
                </Button>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
              <a href={createdLink} target="_blank" rel="noreferrer">
                <Button icon={<ExternalLink size={14} />}>Open as candidate</Button>
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <Select
                label="Template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                options={(templates.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.questionSource})` }))}
              />
              <button
                type="button"
                onClick={() => { setOpen(false); setGenOpen(true) }}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 hover:underline"
              >
                <Sparkles size={13} /> Generate questions from a résumé instead
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Candidate name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
              <Input label="Candidate email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
            </div>
            <div>
              <Select
                label="Interview mode (optional override)"
                value={track}
                onChange={(e) => {
                  const v = e.target.value as TrackType | ''
                  // Conversational AI needs an APPLIED avatar setup (replica,
                  // persona, greeting — configured once on the Setup page and
                  // applied to all candidates). Not applied yet → take the
                  // recruiter there; applied → the mode is ready to use.
                  if (v === 'video_avatar' && !avatarApplied.data?.configured) {
                    setOpen(false)
                    toast('Configure your AI avatar once — it then applies to all Conversational AI candidates.')
                    navigate('/setup', { state: { candidateName: name.trim() || undefined, returnTo: '/sessions' } })
                    return
                  }
                  setTrack(v)
                }}
                hint="Best set on the template. Conversational AI uses the avatar applied on the Setup page."
                options={[
                  { value: '', label: 'Use template default' },
                  { value: 'chatbot', label: 'Chatbot — conversational, typed (ChatGPT-style)' },
                  { value: 'voice', label: 'Voice — live spoken AI interviewer (Gemini Live)' },
                  { value: 'chat', label: 'Timed Q&A — 30s prep + 2 min answer (HireVue-style)' },
                  { value: 'video_avatar', label: 'Conversational AI — Video Avatar (Tavus)' },
                ]}
              />
              {track === 'video_avatar' && avatarApplied.data?.configured && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-success">
                  <Check size={13} strokeWidth={2.5} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Uses your applied avatar{avatarApplied.data.replicaId ? <> (<span className="font-mono">{avatarApplied.data.replicaId}</span>)</> : null} —{' '}
                    <button type="button" className="font-semibold text-primary-700 underline underline-offset-2" onClick={() => { setOpen(false); navigate('/setup', { state: { returnTo: '/sessions' } }) }}>
                      edit avatar setup
                    </button>
                  </span>
                </p>
              )}
            </div>
            <div className="space-y-3 rounded-md border border-border bg-neutral-50 p-4">
              <Toggle
                label="Per-question timer"
                description="Each question gets its own answer countdown (greetings, “are you ready?” and wrap-up are never timed). Applies to the Chatbot and Timed Q&A tracks."
                checked={timerOn}
                onChange={setTimerOn}
              />
              {timerOn && (
                <Input
                  label="Answer time per question (seconds)"
                  type="number"
                  min={10}
                  value={timerSeconds}
                  onChange={(e) => setTimerSeconds(Math.max(10, Number(e.target.value) || 120))}
                  hint={`Candidates get ${Math.floor(timerSeconds / 60)}:${String(timerSeconds % 60).padStart(2, '0')} per question; auto-submits at 0.`}
                />
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button loading={create.isPending} disabled={!templateId} onClick={() => create.mutate()}>
                Create session
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <GenerateFromResumeModal
        open={genOpen}
        onClose={() => { setGenOpen(false); setOpen(true) }}
        onSaved={async (set) => {
          try {
            const tpl = await templatesApi.create({
              name: set.name,
              role: '',
              track: 'chat',
              questionSource: 'fixed',
              fixedQuestionSetId: set.id,
            })
            await qc.invalidateQueries({ queryKey: ['templates'] })
            setTemplateId(tpl.id)
            toast.success(`Template “${tpl.name}” created and selected`)
          } catch {
            toast.error('Set saved, but creating a template from it failed')
          }
        }}
      />
    </div>
  )
}
