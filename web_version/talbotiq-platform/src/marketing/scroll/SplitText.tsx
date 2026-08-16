import { Fragment } from 'react'
import { useInView } from '../motion'

/**
 * Heading entrance: each word rises out of its own overflow-hidden mask.
 *
 * Words, not lines — line masking needs a layout measurement on mount and a
 * re-measure on every resize and font swap, for a difference no reader notices
 * at heading size. Word wrappers also keep `text-wrap: balance` working, which
 * the display rule in mimicSite.css relies on.
 *
 * The full text stays in the accessibility tree as one string: the visible
 * spans are aria-hidden and a visually-hidden copy carries the real text, so a
 * screen reader hears a sentence rather than a list of words.
 *
 * Renders a span deliberately. The caller supplies the heading element, so
 * `id`, `aria-labelledby` and the site's display rules all keep working:
 *
 *   <h1 id="hero-h1"><SplitText>Screening intelligence, decided by humans.</SplitText></h1>
 */
export function SplitText({
  children, className = '', delay = 0, stagger = 34,
}: {
  children: string
  className?: string
  delay?: number
  stagger?: number
}) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.3)
  const words = children.split(' ')
  return (
    <span ref={ref} className={`mm-split ${seen ? 'in' : ''} ${className}`.trim()}>
      <span className="mm-split-sr">{children}</span>
      <span aria-hidden="true">
        {/* The space belongs BETWEEN the wrappers, never inside one. A wrapper
            is overflow:hidden, so whitespace placed inside it is clipped rather
            than separating the boxes, and the heading renders as one run-on
            word. Fragment keeps the space a real text node so line breaking and
            text-wrap:balance still work. */}
        {words.map((w, i) => (
          <Fragment key={`${w}-${i}`}>
            <span className="mm-split-w">
              <span className="mm-split-i" style={{ transitionDelay: `${delay + i * stagger}ms` }}>
                {w}
              </span>
            </span>
            {i < words.length - 1 ? ' ' : ''}
          </Fragment>
        ))}
      </span>
    </span>
  )
}
