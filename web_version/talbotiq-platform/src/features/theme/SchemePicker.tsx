/**
 * Appearance, in Settings: the ground, then the two colour roles.
 *
 * The swatches show the colour AS IT WILL BE ON THE CURRENT GROUND, not a fixed
 * pastel. Each scheme carries a value per ground, so a swatch that always showed
 * the paper value would be showing the wrong colour half the time — and it costs
 * nothing to show the right one, since the data is already per-ground.
 *
 * Each swatch is also drawn with its own edge, which is the same boundary the
 * real control gets. That is not decoration: a pastel cannot reach 3:1 against a
 * white page — peach on white is 1.57:1 by arithmetic — so what makes a pastel
 * control findable is its border, and a preview without one would be promising an
 * appearance the product does not ship. See schemes.ts, and schemes.test.ts for
 * what gates it.
 */
import { Check } from 'lucide-react'

import { cn } from '@/components/ui'
import { SCHEMES, schemeByKey, type SchemeKey } from '@/design/schemes'
import { setScheme, useScheme, type SchemePair } from '@/lib/colourScheme'
import { useWorkspaceGround } from '@/lib/workspaceGround'
import { ThemeToggle } from './ThemeToggle'

function Row({ role, label, help }: { role: keyof SchemePair; label: string; help: string }) {
  const chosen = useScheme()[role]
  const ground = useWorkspaceGround()

  return (
    <div>
      <h3 className="field-label mb-1">{label}</h3>
      <p className="mb-3 max-w-[38rem] text-xs leading-relaxed text-ink-muted">{help}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-x-4 gap-y-3">
        {SCHEMES.map((s) => {
          const on = chosen === s.key
          const edge = s.key === 'slate' ? s.fill[ground] : s.text[ground]
          return (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setScheme(role, s.key as SchemeKey)}
              className="group flex w-[4.5rem] flex-col items-center gap-1.5 rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span
                className={cn(
                  'grid h-11 w-11 place-items-center rounded-xl border transition-transform duration-150',
                  on ? 'scale-100 ring-2 ring-offset-2 ring-offset-surface ring-ink' : 'group-hover:scale-[1.06]',
                )}
                style={{ background: s.fill[ground], borderColor: edge }}
              >
                {on && (
                  /* The tick is drawn in the scheme's own `on` colour — the same
                     value a label on that fill would use, and the one thing here
                     that is contrast-gated against this exact background. */
                  <Check size={16} strokeWidth={3} style={{ color: s.on[ground] }} aria-hidden />
                )}
              </span>
              <span className={cn('text-[11px] leading-none', on ? 'font-bold text-ink' : 'text-ink-muted')}>
                {s.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function SchemePicker() {
  const { primary, secondary } = useScheme()
  const same = primary === secondary && primary !== 'slate'

  return (
    <div className="space-y-7">
      <div>
        <h3 className="field-label mb-1">Theme</h3>
        <p className="mb-3 text-xs leading-relaxed text-ink-muted">
          The same choice as the switch in the header, and the one made on the way in.
        </p>
        <ThemeToggle />
      </div>

      <Row
        role="primary"
        label="Primary colour"
        help="The featured card, the primary button and the selected tab."
      />

      <Row
        role="secondary"
        label="Secondary colour"
        help="Charts, meters and progress bars. Pick something distinct from the primary so the two read apart."
      />

      {/* Said once, where it matters, rather than pre-empted by disabling the
          swatch. Choosing the same colour twice is legible and someone may want
          it — it just stops the two roles telling each other apart, which is the
          only thing the secondary is for. */}
      {same && (
        <p className="text-xs leading-relaxed text-warn">
          Primary and secondary are both {schemeByKey(primary).label}. A meter will read as the
          same colour as the button beside it.
        </p>
      )}
    </div>
  )
}
