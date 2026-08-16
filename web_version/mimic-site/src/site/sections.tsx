import { Link } from 'react-router-dom'
import type { Block, NavLink } from './content'
import { Ico } from './icons'

/**
 * The section kit every marketing page composes from. Seventy-two pages read as
 * one product because they are all built from these seven blocks — not because
 * anyone re-styled them page by page.
 *
 * Diagrams are inline SVG/CSS, never images: they stay crisp, cost no request,
 * inherit the brand tokens, and carry real text for screen readers and search.
 */

/* ── Numbered how-it-works sequence ───────────────────────────────────────── */
function Steps({ items }: { items: { t: string; d: string }[] }) {
  return (
    <ol className="mk-steps">
      {items.map((s, i) => (
        <li key={s.t}>
          <span className="mk-step-n" aria-hidden="true">{i + 1}</span>
          <div>
            <strong>{s.t}</strong>
            <p>{s.d}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ── Horizontal flow diagram ──────────────────────────────────────────────────
 * A real diagram, not a decoration: it is an <ol>, so it reads correctly when
 * the chevrons are invisible to assistive tech. Wraps on narrow screens. */
function Flow({ steps, caption }: { steps: string[]; caption?: string }) {
  return (
    <figure className="mk-flow">
      <ol>
        {steps.map((s, i) => (
          <li key={s}>
            <span className="mk-flow-node">{s}</span>
            {i < steps.length - 1 && (
              <svg className="mk-flow-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 12h15m0 0-5.5-5.5M19 12l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </li>
        ))}
      </ol>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

/* ── Settings / limits table ──────────────────────────────────────────────── */
function Spec({ rows, caption }: { rows: { k: string; v: string }[]; caption?: string }) {
  return (
    <div className="mk-spec-wrap">
      <table className="mk-spec">
        {caption && <caption>{caption}</caption>}
        <tbody>
          {rows.map((r) => (
            <tr key={r.k}>
              <th scope="row">{r.k}</th>
              <td>{r.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Two-column feature grid ──────────────────────────────────────────────── */
function Split({ items }: { items: { t: string; d: string }[] }) {
  return (
    <div className="mk-split">
      {items.map((s) => (
        <div key={s.t}>
          <strong>{s.t}</strong>
          <p>{s.d}</p>
        </div>
      ))}
    </div>
  )
}

/* ── Callout ──────────────────────────────────────────────────────────────────
 * `limit` publishes a real cap; `placeholder` marks something the team must
 * confirm before it ships. Both are deliberately visible rather than quietly
 * omitted — an unverified claim never silently becomes a verified one. */
function Note({ tone, title, text }: { tone: 'info' | 'limit' | 'placeholder'; title?: string; text: string }) {
  const label = title ?? (tone === 'limit' ? 'Limits' : tone === 'placeholder' ? 'To be confirmed' : 'Note')
  return (
    <aside className={`mk-note mk-note-${tone}`}>
      <strong>{label}</strong>
      <p>{text}</p>
    </aside>
  )
}

/* ── Dispatcher ───────────────────────────────────────────────────────────── */
export function Blocks({ blocks }: { blocks?: Block[] }) {
  if (!blocks?.length) return null
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'p':       return <p key={i}>{b.text}</p>
          case 'bullets': return <ul key={i} className="mk-bullets">{b.items.map((x) => <li key={x}>{x}</li>)}</ul>
          case 'steps':   return <Steps key={i} items={b.items} />
          case 'flow':    return <Flow key={i} steps={b.steps} caption={b.caption} />
          case 'spec':    return <Spec key={i} rows={b.rows} caption={b.caption} />
          case 'split':   return <Split key={i} items={b.items} />
          case 'note':    return <Note key={i} tone={b.tone} title={b.title} text={b.text} />
          default:        return null
        }
      })}
    </>
  )
}

/* ── Related pages ────────────────────────────────────────────────────────── */
export function Related({ links }: { links?: NavLink[] }) {
  if (!links?.length) return null
  return (
    <section className="mk-related" aria-label="Related pages">
      <h2>Keep reading</h2>
      <div>
        {links.map((l) => (
          <Link key={l.to} to={l.to}>
            <span>{l.label}</span>
            <Ico n="arrow" />
          </Link>
        ))}
      </div>
    </section>
  )
}
