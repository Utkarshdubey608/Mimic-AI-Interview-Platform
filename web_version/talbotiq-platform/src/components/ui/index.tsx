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
 *   feedback.tsx    Badge, StatusMark, Skeleton, Empty/NoResults/Error states,
 *                   InlineNotice, ProvenanceMark
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
  Badge, StatusMark, Skeleton, RecordRows, RecordCards,
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
    <div className="overflow-hidden rounded-lg border border-rule font-mono text-xs">
      <div className="flex items-center justify-between border-b border-brand-border bg-brand-black px-4 py-2.5">
        <span className="text-brand-gray">{title}</span>
        <div className="flex items-center gap-2">
          <span className="rounded-sm bg-brand-card px-2 py-0.5 text-[10px] font-bold text-brand-gold">{method}</span>
          <span className="text-[10px] text-brand-gray">tavusapi.com{endpoint}</span>
        </div>
      </div>
      <pre className="max-h-80 overflow-x-auto bg-brand-void p-4 leading-relaxed text-brand-green-light">
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
