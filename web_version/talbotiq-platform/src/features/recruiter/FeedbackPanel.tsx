import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Star } from 'lucide-react'
import { Card, EmptyState, SectionTitle, Select, Skeleton } from '@/components/ui'
import { feedbackApi, type FeedbackItem } from '@/lib/api'
import type { TrackType } from '@shared/types'

const TRACK_LABEL: Record<string, string> = {
  chat: 'Timed Q&A', chatbot: 'Chatbot', voice: 'Voice',
  video_avatar: 'Video Avatar', video: 'Video Interview', two_way: 'Two-way Interview',
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={13}
          strokeWidth={2}
          className={n <= value ? 'text-ink' : 'text-ink-disabled'}
          style={n <= value ? { fill: 'currentColor' } : undefined}
        />
      ))}
    </span>
  )
}

/**
 * What candidates said about the experience, across this recruiter's interviews.
 *
 * Two things make it worth a panel rather than a raw list. The average is the
 * headline, but the *technical issue* count is the one that earns its place: it
 * is a bug feed written by the people actually hitting the bugs, and it is how a
 * broken microphone path or a slow region shows up before anyone files a ticket.
 *
 * Filtering is client-side. The dataset is one recruiter's completed interviews,
 * the whole set already arrives in a single tenant-scoped request, and adding
 * query parameters to the API to re-filter it would be a round trip for nothing.
 */
export function FeedbackPanel() {
  const [track, setTrack] = useState<string>('')
  const [role, setRole] = useState<string>('')
  const q = useQuery({ queryKey: ['feedback'], queryFn: feedbackApi.list })

  const roles = useMemo(() => {
    const s = new Set<string>()
    for (const i of q.data?.items ?? []) if (i.role?.trim()) s.add(i.role.trim())
    return [...s].sort()
  }, [q.data])

  const items = useMemo(() => {
    return (q.data?.items ?? []).filter(
      (i) => (!track || i.track === track) && (!role || i.role === role),
    )
  }, [q.data, track, role])

  const shown = useMemo(() => {
    // Ratings only, and narrowed to numbers — a candidate may now leave a comment
    // without a star, and an unrated row must not be counted as a zero.
    const rated = items
      .map((i) => i.rating)
      .filter((r): r is number => typeof r === 'number')
    return {
      count: items.length,
      // null, not 0 — "nobody has answered" and "everyone rated us zero" are
      // different facts, and a zero here would libel the interview.
      average: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null,
      issues: items.filter((i) => i.hadTechnicalIssues).length,
    }
  }, [items])

  if (q.isLoading) {
    return (
      <Card className="p-5">
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="mt-4 h-24 w-full rounded-xl" />
      </Card>
    )
  }

  return (
    <Card className="p-5" data-testid="feedback-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionTitle className="mb-1.5">Candidate feedback</SectionTitle>
          <p className="text-xs leading-relaxed text-ink-muted">
            What candidates said about the experience. Never part of their assessment.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={track}
            onChange={(e) => setTrack(e.target.value)}
            aria-label="Filter by interview type"
            options={[
              { value: '', label: 'All types' },
              ...Object.entries(TRACK_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Filter by role"
            options={[{ value: '', label: 'All roles' }, ...roles.map((r) => ({ value: r, label: r }))]}
          />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-surface-sunk p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Average</p>
          <p className="font-display text-2xl font-extrabold tabular-nums text-ink" data-testid="feedback-average">
            {shown.average === null ? '—' : shown.average.toFixed(1)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-sunk p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Responses</p>
          <p className="font-display text-2xl font-extrabold tabular-nums text-ink">{shown.count}</p>
        </div>
        <div className={`rounded-xl border p-4 ${shown.issues ? 'border-warning-border bg-warning-bg' : 'border-border bg-surface-sunk'}`}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Technical issues</p>
          <p className="font-display text-2xl font-extrabold tabular-nums text-ink" data-testid="feedback-issues-count">
            {shown.issues}
          </p>
        </div>
      </div>

      {shown.issues > 0 && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-warning">
          <AlertTriangle size={13} strokeWidth={2} className="mt-0.5 flex-shrink-0" />
          <span>
            {shown.issues} candidate{shown.issues === 1 ? '' : 's'} reported a problem with audio, video or the page.
            Worth reading before the next batch of invites goes out.
          </span>
        </p>
      )}

      <div className="mt-5">
        {items.length === 0 ? (
          <EmptyState title="No feedback yet" description="It appears here as candidates finish their interviews." />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((i: FeedbackItem) => (
              <li key={i.sessionId} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 py-3">
                {/* An unrated row is comment-only feedback, not a zero-star one.
                    Empty stars would read as the harshest possible verdict from a
                    candidate who never gave one. */}
                {typeof i.rating === 'number' ? (
                  <Stars value={i.rating} />
                ) : (
                  <span className="text-xs font-medium text-ink-faint">No rating</span>
                )}
                <span className="text-sm font-semibold text-ink">{i.candidateName || 'Candidate'}</span>
                <span className="text-xs text-ink-faint">
                  {TRACK_LABEL[i.track as TrackType] ?? i.track}
                  {i.role ? ` · ${i.role}` : ''}
                  {i.createdAt ? ` · ${new Date(i.createdAt).toLocaleDateString()}` : ''}
                </span>
                {i.hadTechnicalIssues && (
                  <span className="rounded-md border border-warning-border bg-warning-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
                    Technical issue
                  </span>
                )}
                {i.comment && (
                  <p className="w-full text-sm leading-relaxed text-ink-muted">“{i.comment}”</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
