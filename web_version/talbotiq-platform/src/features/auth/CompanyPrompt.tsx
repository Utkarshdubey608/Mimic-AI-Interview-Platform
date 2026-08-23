import { useState } from 'react'
import { Building2 } from 'lucide-react'
import { Button, Modal } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'

/**
 * Asks an existing recruiter which company they belong to, once.
 *
 * Sign-up collects this on both clients now, but every account created before that
 * has no `companyKey` — and templates and question sets are scoped by it. Without a
 * key a recruiter keeps everything they authored and shares none of it, which is safe
 * but not what they had yesterday: colleagues used to see each other's work.
 *
 * **Not dismissible, and that is the uncomfortable part of the decision.** A "later"
 * button reads as optional, and the cost of choosing later is invisible from here —
 * their colleagues' templates simply stay missing, which nobody attributes to a
 * dialog they closed weeks ago. It asks for one field a recruiter knows the answer to
 * without looking anything up, so it is a worse trade to make it skippable than to
 * make it brief.
 *
 * Candidates are never asked: they belong to no company here, they are invited by one.
 */
export function CompanyPrompt() {
  const { role, accountCompanyKey, loading, recordCompany } = useAuth()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* `loading` matters: the role and company arrive in the same snapshot, so acting
     before it resolves would flash this at every recruiter on every page load. */
  const needed = !loading && role === 'recruiter' && !accountCompanyKey

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await recordCompany(value)
      /* No close call — the provider streams `users/{uid}`, so `accountCompanyKey`
         becomes non-null when the write lands and this unmounts itself. */
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that. Try again.')
      setBusy(false)
    }
  }

  return (
    <Modal
      open={needed}
      /* Deliberately a no-op: there is no dismiss. See the note above. */
      onClose={() => {}}
      title="Which company are you hiring for?"
    >
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">
          Interview templates and question sets are shared with your colleagues, and we
          need your company name to know who they are. Recruiters elsewhere never see
          your work.
        </p>

        <label className="block">
          <span className="field-label mb-1.5 block">Company</span>
          <div className="flex items-center gap-2">
            <Building2 size={16} className="flex-shrink-0 text-neutral-400" aria-hidden="true" />
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value.trim() && !busy) void submit()
              }}
              placeholder="e.g. TalbotIQ"
              aria-label="Company"
              className="input-base flex-1"
              autoFocus
            />
          </div>
        </label>

        {/* Capitalisation is kept for display and ignored for matching, so it is worth
            saying — otherwise somebody agonises over it, or worse, types it differently
            from a colleague and assumes that is why sharing is not working. */}
        <p className="text-xs text-neutral-500">
          Spelling has to match your colleagues; capitalisation does not.
        </p>

        {error ? <p className="text-xs text-danger">{error}</p> : null}

        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={() => void submit()} loading={busy} disabled={busy || !value.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
