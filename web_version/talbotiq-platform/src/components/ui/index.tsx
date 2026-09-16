/**
 * MIMIC — the primitive barrel.
 *
 * This file used to BE the component library: 490 lines holding every primitive
 * in the product. It is now a re-export surface, which matters for one specific
 * reason — 39 files import from `@/components/ui`, and none of them should have
 * to change for the library to be reorganised. The migration is incremental
 * rather than a big bang, and no import path in the codebase moves.
 *
 *   primitives.tsx  Button, Input, Textarea, Select, Checkbox, Toggle, Slider
 *   feedback.tsx    Badge, StatusMark, Progress, Skeleton, Empty/NoResults/Error
 *                   states, InlineNotice, ProvenanceMark
 *   layout.tsx      Page, PageHeader, Breadcrumbs, RecordSection, Card,
 *                   ExhibitTab, Citation, StatFigure, InfoRow
 *   overlay.tsx     Modal, Drawer, ConfirmDialog
 *   data.tsx        Table, Toolbar, FilterBar, SearchField, Pagination,
 *                   ScoreValue
 *
 * Every export the previous file had is still exported from here with the same
 * name and a compatible signature. `JsonPreview` is the only one whose
 * implementation stayed in this file, because it has exactly one consumer and
 * belongs to no category.
 */
import React from 'react'

export { cn } from './cn'

export { Button, Input, Textarea, Select, Checkbox, Toggle, Slider } from './primitives'

export {
  Badge, StatusMark, Progress, Skeleton, RecordRows, RecordCards,
  EmptyState, NoResultsState, ErrorState, InlineNotice, ProvenanceMark,
} from './feedback'

export {
  Page, PageHeader, Breadcrumbs, SectionTitle, RecordSection, Card, Divider,
  ExhibitTab, Citation, StatFigure, StatCard, InfoRow,
} from './layout'
export type { TrackKey } from './layout'

export { Modal, Drawer, ConfirmDialog } from './overlay'

export {
  Table, Toolbar, ToolbarSpacer, FilterBar, FilterSelect, SearchField,
  Pagination, ScoreValue,
} from './data'
export type { Column } from './data'

/* ═══ JsonPreview ══════════════════════════════════════════════════════════
   A request body, shown as a request body. One consumer (Avatar Studio), and it
   is deliberately the one place in the product that looks like a terminal —
   because the thing it is showing IS a terminal artefact. */
export function JsonPreview({
  data, title = 'Request Preview', method = 'POST', endpoint = '/v2/conversations',
}: {
  data: unknown
  title?: string
  method?: string
  endpoint?: string
}) {
  return (
    // Sunk, not black. This used a fixed near-black ground with mint-green
    // monospace — the 1990s terminal costume, and a hue that appears nowhere
    // else in the system. What makes a request body read as a request body is
    // the MONO and the method chip, not the colour of a phosphor screen. So it
    // is now a recessed well on whichever ground it sits on, and the payload
    // sets in the same ink as the rest of the page.
    <div className="overflow-hidden rounded-lg border border-rule font-mono text-xs">
      <div className="flex items-center justify-between gap-3 border-b border-rule bg-surface-sunk px-4 py-2.5">
        {/* nowrap: the label is two words and the endpoint beside it is the
            flexible one — without this the label wrapped and the header grew a
            line taller than the chip next to it. */}
        <span className="section-label whitespace-nowrap">{title}</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-sm border border-ai-rule bg-ai-bg px-2 py-0.5 text-[10px] font-bold text-ai">{method}</span>
          <span className="truncate text-[10px] text-ink-muted">tavusapi.com{endpoint}</span>
        </div>
      </div>
      <pre className="max-h-80 overflow-x-auto bg-ground-sunk p-4 leading-relaxed text-ink-body">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

/* ═══ Compatibility shims ══════════════════════════════════════════════════
   Kept so nothing has to change in the same pass that reorganises the library.
   Each is a thin wrapper, and each notes what to use instead. */

/** @deprecated Use `Page` — it also fixes the page's width and edge padding. */
export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`page py-7 pb-20 ${className ?? ''}`}>{children}</div>
}
