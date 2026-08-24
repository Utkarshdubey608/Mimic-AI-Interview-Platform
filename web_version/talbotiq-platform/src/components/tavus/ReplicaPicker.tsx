import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Check, ChevronDown, ScanFace } from 'lucide-react'
import { cn } from '@/components/ui'
import { cachedFaceUrl, warmFaceCache } from '@/lib/faceCache'
import { getIdTokenOrNull } from '@/lib/firebase'
import type { TavusReplica } from '@/types/tavus.types'

/**
 * ReplicaPicker — a visual avatar/face selector.
 *
 * Replaces the plain text `<Select>` of replica names with a picker that shows
 * the actual Tavus replica *face*. Each row pairs a live face thumbnail with the
 * replica name and its id, and plays its preview video when the cursor hovers
 * the row (desktop), so recruiters pick a face by looking at it rather than
 * reading an ID. On touch devices — where there is no hover — the visible faces
 * auto-play instead.
 */

interface ReplicaPickerProps {
  replicas: TavusReplica[]
  /** Selected replica_id ('' = none). */
  value: string
  onChange: (replicaId: string) => void
  label?: string
  hint?: string
  /** Show a "None" row (e.g. demo mode / inherit defaults). */
  includeNone?: boolean
  noneLabel?: string
  loading?: boolean
}

/* ── Bearer token for media URLs (video tags can't send auth headers) ────────── */
function useMediaToken() {
  const [token, setToken] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    getIdTokenOrNull().then((t) => { if (alive) setToken(t) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return token
}

/* ── Does this device have a real hovering pointer (mouse) vs. touch? ────────── */
function useCanHover() {
  const [canHover, setCanHover] = useState(true)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    const sync = () => setCanHover(mq.matches)
    sync()
    mq.addEventListener?.('change', sync)
    return () => mq.removeEventListener?.('change', sync)
  }, [])
  return canHover
}

/* ── Placeholder shown when a replica has no preview video ──────────────────── */
function PlaceholderFace() {
  return (
    <div className="w-full h-full bg-neutral-100 flex items-center justify-center text-neutral-300">
      <svg
        width="46%" height="46%" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    </div>
  )
}

/**
 * The face media itself — a still frame that plays when `play` is true.
 * - Serves from the SERVER's local preview cache (warmed in the background when
 *   the replica list loads), so painting and playback are instant instead of
 *   buffering from the Tavus CDN. If the cache route ever fails, the tile falls
 *   back to the original CDN URL.
 * - Attaches its video source ONLY while near the viewport and RELEASES it when
 *   scrolled away. Without this, a long face list latched every tile's <video>
 *   on permanently, piling up dozens of buffering videos until the tab crashed
 *   (out of memory). Now the number of live videos is capped to what's visible —
 *   and re-attaching on scroll-back is free because the media is local.
 * - Plays after a short hover-intent delay so quickly sweeping the list never
 *   kicks off a storm of playbacks.
 */
function FaceMedia({ replica, play, token }: { replica: TavusReplica; play: boolean; token: string | null }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [inView, setInView] = useState(false) // currently within (or near) the viewport
  const [failed, setFailed] = useState(false) // cache route failed → use the CDN directly

  // Observe visibility: attach the source when in view, release it when it
  // leaves so off-screen tiles hold no media.
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver(
      ([e]) => setInView(!!e?.isIntersecting),
      { rootMargin: '300px' }, // generous pre-attach margin — local media is cheap
    )
    io.observe(v)
    return () => io.disconnect()
  }, [])

  // Play / pause. Deferred by 120ms so a mere sweep-over never triggers playback.
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (play && inView) {
      const t = setTimeout(() => { v.play().catch(() => {}) }, 120)
      return () => clearTimeout(t)
    }
    v.pause()
    try { v.currentTime = 0.1 } catch { /* noop */ }
  }, [play, inView, replica.thumbnail_video_url])

  const raw = replica.thumbnail_video_url
  if (!raw) return <PlaceholderFace />
  const src = failed ? raw : cachedFaceUrl(raw, token)

  return (
    <video
      ref={ref}
      // Only near the viewport → keeps the live-video count bounded.
      src={inView ? src : undefined}
      muted
      loop
      playsInline
      // Local cache makes full preload cheap — buffered before the first hover.
      preload="auto"
      // Seek a hair past 0 so a real face frame paints while the video is paused.
      onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = 0.1 } catch { /* noop */ } }}
      onError={() => { if (!failed) setFailed(true) }}
      className="w-full h-full object-cover"
    />
  )
}

/* ── One selectable face row ────────────────────────────────────────────────── */
function FaceRow({
  replica,
  selected,
  canHover,
  onSelect,
  token,
}: {
  replica: TavusReplica
  selected: boolean
  canHover: boolean
  onSelect: (id: string) => void
  token: string | null
}) {
  const [hover, setHover] = useState(false)
  // Only surface a status chip for states that AREN'T usable yet. A trained
  // replica ('ready'/'completed') gets no badge — the old code stamped every
  // completed face with a "COMPLETED" chip.
  const showStatus = replica.status === 'training' || replica.status === 'error'
  const isStock = replica.replica_type === 'stock'
  // Desktop: play on hover. Touch (no hover): auto-play the faces in view.
  const play = canHover ? hover : true

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      title={`${replica.replica_name} · ${replica.replica_id}`}
      onClick={() => onSelect(replica.replica_id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className={cn(
        'w-full flex items-center gap-3 rounded-xl border px-2 py-2 text-left',
        'transition-colors duration-150 focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        selected
          ? 'border-action-edge bg-action-soft'
          : 'border-transparent hover:border-rule-strong hover:bg-neutral-50',
      )}
    >
      <span
        className={cn(
          'relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg border bg-neutral-100',
          selected ? 'border-action-edge' : 'border-border',
        )}
      >
        <FaceMedia replica={replica} play={play} token={token} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-sm font-semibold leading-tight', selected ? 'text-action-edge' : 'text-neutral-800')}>
            {replica.replica_name}
          </span>
          {showStatus ? (
            <span className={cn('badge flex-shrink-0 capitalize', replica.status === 'error' ? 'badge-danger' : 'badge-warning')}>
              {replica.status}
            </span>
          ) : isStock ? (
            <span className="badge badge-neutral flex-shrink-0">Stock</span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-neutral-400">{replica.replica_id}</span>
      </span>

      <span
        aria-hidden="true"
        className={cn(
          'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-150',
          selected ? 'bg-action text-action-ink' : 'bg-transparent text-transparent',
        )}
      >
        <Check size={12} strokeWidth={3} />
      </span>
    </button>
  )
}

/* ── Grouped section within the popover ─────────────────────────────────────── */
function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center gap-2 px-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{title}</span>
        <span className="text-[11px] tabular-nums text-neutral-400">{count}</span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

/* ── Skeleton row — matches the shape of a real face row ────────────────────── */
function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-2 py-2">
      <div className="h-11 w-11 flex-shrink-0 animate-pulse rounded-lg bg-neutral-100" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-2/5 animate-pulse rounded bg-neutral-100" />
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-neutral-100" />
      </div>
    </div>
  )
}

export function ReplicaPicker({
  replicas,
  value,
  onChange,
  label,
  hint,
  includeNone = false,
  noneLabel = 'None',
  loading = false,
}: ReplicaPickerProps) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const canHover = useCanHover()
  const mediaToken = useMediaToken()

  // Pre-download every preview into the server's local cache the moment the
  // replica list is known — the first picker open then plays instantly.
  useEffect(() => {
    if (replicas.length) warmFaceCache(replicas.map((r) => r.thumbnail_video_url))
  }, [replicas])

  // Track the trigger's viewport rect so the (portalled) popover can be
  // positioned with `fixed` — this escapes any `overflow` ancestor (e.g. the
  // Personas modal's scroll column) that would otherwise clip it.
  useEffect(() => {
    if (!open) return
    const update = () => setRect(triggerRef.current?.getBoundingClientRect() ?? null)
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true) // capture: catch inner scroll containers too
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  // Dismiss on outside click / Escape (the popover lives in a portal, so check both).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = replicas.find((r) => r.replica_id === value)
  const custom = replicas.filter((r) => r.replica_type !== 'stock')
  const stock = replicas.filter((r) => r.replica_type === 'stock')
  const isCustomId = !!value && !selected // a manually-typed ID not in the list

  const pick = (id: string) => { onChange(id); setOpen(false) }

  return (
    <div className="flex flex-col gap-1.5" ref={rootRef}>
      {label && <label className="field-label">{label}</label>}

      <div className="relative">
        {/* ── Trigger ── */}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'w-full flex items-center gap-3 text-left rounded-xl border-[1.5px] bg-white px-2.5 py-1.5 min-h-[48px] cursor-pointer',
            'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15',
            open ? 'border-action-edge' : 'border-neutral-300 hover:border-action-edge',
          )}
        >
          <span className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-neutral-100">
            {selected ? <FaceMedia replica={selected} play={false} token={mediaToken} /> : <PlaceholderFace />}
          </span>

          <span className="min-w-0 flex-1">
            {selected ? (
              <>
                <span className="block truncate text-sm font-semibold leading-tight text-neutral-800">{selected.replica_name}</span>
                <span className="block truncate font-mono text-[11px] text-neutral-400">{selected.replica_id}</span>
              </>
            ) : isCustomId ? (
              <>
                <span className="block truncate text-sm font-semibold leading-tight text-neutral-800">Custom replica ID</span>
                <span className="block truncate font-mono text-[11px] text-neutral-400">{value}</span>
              </>
            ) : (
              <span className="block truncate text-sm text-neutral-400">{includeNone ? noneLabel : 'Select a face…'}</span>
            )}
          </span>

          <ChevronDown
            aria-hidden="true"
            size={14}
            strokeWidth={2.5}
            className={cn('flex-shrink-0 text-neutral-400 transition-transform duration-150', open && 'rotate-180')}
          />
        </button>

        {/* ── Popover (portalled + fixed so it never gets clipped by a scroll ancestor) ── */}
        {open && rect && createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: rect.bottom + 8,
              left: rect.left,
              width: rect.width,
              maxHeight: `calc(100vh - ${rect.bottom + 24}px)`,
            }}
            className="z-[60] min-w-[300px] rounded-2xl border border-border bg-white shadow-xl animate-slide-up overflow-hidden flex flex-col"
          >
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Choose a face</span>
              <span className="text-[11px] text-neutral-400">{canHover ? 'Hover a row to preview' : 'Tap to select'}</span>
            </div>

            <div role="listbox" aria-label="Replicas" className="overflow-y-auto p-2 space-y-3">
              {loading ? (
                <div className="space-y-1">
                  {[...Array(4)].map((_, i) => <RowSkeleton key={i} />)}
                </div>
              ) : custom.length + stock.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-rule bg-action-soft text-action-edge">
                    <ScanFace size={20} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-neutral-800">No replicas found</p>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                      Add your Tavus API key in Settings, then your faces appear here.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {includeNone && (
                    <button
                      type="button"
                      role="option"
                      aria-selected={!value}
                      onClick={() => pick('')}
                      className={cn(
                        'w-full flex items-center gap-3 rounded-xl border px-2 py-2 text-left',
                        'transition-colors duration-150 focus-visible:outline-none',
                        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                        !value
                          ? 'border-action-edge bg-action-soft'
                          : 'border-transparent hover:border-rule-strong hover:bg-neutral-50',
                      )}
                    >
                      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-neutral-50 text-neutral-400">
                        <Ban size={17} strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', !value ? 'text-action-edge' : 'text-neutral-700')}>
                        {noneLabel}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-150',
                          !value ? 'bg-action text-action-ink' : 'bg-transparent text-transparent',
                        )}
                      >
                        <Check size={12} strokeWidth={3} />
                      </span>
                    </button>
                  )}

                  {custom.length > 0 && (
                    <Section title="Your replicas" count={custom.length}>
                      {custom.map((r) => (
                        <FaceRow key={r.replica_id} replica={r} selected={r.replica_id === value} canHover={canHover} onSelect={pick} token={mediaToken} />
                      ))}
                    </Section>
                  )}

                  {stock.length > 0 && (
                    <Section title="Stock replicas" count={stock.length}>
                      {stock.map((r) => (
                        <FaceRow key={r.replica_id} replica={r} selected={r.replica_id === value} canHover={canHover} onSelect={pick} token={mediaToken} />
                      ))}
                    </Section>
                  )}
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
      </div>

      {hint && <p className="text-xs text-neutral-400">{hint}</p>}
    </div>
  )
}

export default ReplicaPicker
