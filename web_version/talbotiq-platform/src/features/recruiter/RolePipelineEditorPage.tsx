import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { Button, Input, Select, Card, PageHeader, Skeleton, EmptyState, ErrorState } from '@/components/ui'
import { roleConfigsApi, describeFetchError } from '@/lib/api'
import {
  RoleRoundEditor, defaultRoleRounds, toRoleRoundDrafts, toRoleRoundSpecs, roundConfigValid,
  type RoleRoundDraft,
} from './RoleRoundEditor'

/**
 * Create/edit ONE `RoleConfig` — a reusable, ordered interview pipeline for a
 * role category. Deliberately separate from the older `web_pipelines` system
 * (PipelinesPage / RoundBuilder / pipelinesApi): this reads and writes the
 * shared `roleConfigs` collection via `roleConfigsApi`.
 *
 * `roleCategory` is identity, not content — the backend's `UpdateRoleConfigRequest`
 * has no `roleCategory` field, so it is only settable at creation and shown
 * read-only afterward.
 */
export default function RolePipelineEditorPage() {
  const { id } = useParams()
  const isEdit = !!id && id !== 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()

  const categories = useQuery({ queryKey: ['role-categories'], queryFn: roleConfigsApi.categories })
  const existing = useQuery({
    queryKey: ['role-configs', id],
    queryFn: () => roleConfigsApi.get(id as string),
    enabled: isEdit,
  })

  const [roleCategory, setRoleCategory] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [rounds, setRounds] = useState<RoleRoundDraft[]>(defaultRoleRounds())
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Populate the form from the loaded RoleConfig exactly once — a later
  // refetch (e.g. after some unrelated invalidation) must not clobber
  // in-progress edits.
  useEffect(() => {
    if (isEdit && existing.data && !loaded) {
      setRoleCategory(existing.data.roleCategory)
      setDisplayName(existing.data.displayName)
      setRounds(toRoleRoundDrafts(existing.data.rounds))
      setLoaded(true)
    }
  }, [isEdit, existing.data, loaded])

  const categoryLabel = categories.data?.find((c) => c.slug === roleCategory)?.displayName ?? roleCategory

  const roundsValid = rounds.length >= 1 && rounds.every((r) => r.title.trim().length > 0 && roundConfigValid(r))
  const canSave = !!roleCategory && roundsValid && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const payload = { displayName: displayName.trim() || undefined, rounds: toRoleRoundSpecs(rounds) }
      if (isEdit) {
        await roleConfigsApi.update(id as string, payload)
        toast.success('Pipeline updated')
      } else {
        await roleConfigsApi.create({ roleCategory, ...payload })
        toast.success('Pipeline created')
      }
      qc.invalidateQueries({ queryKey: ['role-configs'] })
      navigate('/candidates/role-pipelines')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the pipeline')
    } finally {
      setSaving(false)
    }
  }

  if (isEdit && existing.isLoading) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-8">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-5 h-8 w-64" />
        <Skeleton className="mt-6 h-32 w-full rounded-2xl" />
        <Skeleton className="mt-4 h-40 w-full rounded-2xl" />
      </div>
    )
  }

  if (isEdit && (existing.isError || !existing.data)) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-8">
        <Card className="p-0">
          <ErrorState
            title="Couldn't load this pipeline"
            detail={describeFetchError(existing.error, "This view couldn't reach the server. Check your connection and try again.")}
            onRetry={() => void existing.refetch()}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-8">
      <button
        onClick={() => navigate('/candidates/role-pipelines')}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <ArrowLeft size={15} /> All role pipelines
      </button>

      <PageHeader
        title={isEdit ? 'Edit role pipeline' : 'New role pipeline'}
        description="A reusable, ordered interview template for a role category. Applying it to a batch of candidates materialises a real multi-round timeline and invites round 1."
      />

      <div className="space-y-6">
        <Card className="space-y-4 p-5">
          {!categories.isLoading && !categories.data?.length && !isEdit ? (
            <EmptyState
              icon={<AlertTriangle />}
              title="No role categories available"
              description="The role classifier has no categories configured yet — check with an administrator."
            />
          ) : isEdit ? (
            <div>
              <label className="field-label mb-1.5 block">Role category</label>
              <div className="flex h-11 items-center rounded-xl border border-border bg-surface-sunk px-3.5 text-sm text-ink-body">
                <span className="truncate">{categoryLabel}</span>
                <span className="ml-2 flex-shrink-0 text-xs text-ink-faint">(set at creation)</span>
              </div>
            </div>
          ) : (
            <Select
              label="Role category"
              value={roleCategory}
              onChange={(e) => setRoleCategory(e.target.value)}
              placeholder={categories.isLoading ? 'Loading…' : 'Choose a role category'}
              options={(categories.data ?? []).map((c) => ({ value: c.slug, label: c.displayName }))}
            />
          )}
          <Input
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={categoryLabel || 'Defaults to the category name'}
            hint="Leave blank to use the category's own name."
          />
        </Card>

        <div>
          <h2 className="mb-3 font-display text-base font-extrabold tracking-[-0.02em] text-ink">Rounds</h2>
          <RoleRoundEditor rounds={rounds} onChange={setRounds} />
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
          <Button variant="ghost" onClick={() => navigate('/candidates/role-pipelines')}>Cancel</Button>
          <Button loading={saving} disabled={!canSave} onClick={() => void save()}>
            {isEdit ? 'Save changes' : 'Create pipeline'}
          </Button>
        </div>
      </div>
    </div>
  )
}
