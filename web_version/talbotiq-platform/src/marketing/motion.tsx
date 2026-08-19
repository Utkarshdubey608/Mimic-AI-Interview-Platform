import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useScrollEngine, scrollToAnchor } from './scroll/ScrollProvider'

/** Reusable, accessible motion for the marketing site. All effects no-op under
 *  prefers-reduced-motion. Scoped to .mimic-site via CSS. */

const prefersReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Slide-up + fade a block in when it scrolls into view. `delay` staggers siblings. */
export function Reveal({ children, delay = 0, as: Tag = 'div', className = '' }: { children: ReactNode; delay?: number; as?: 'div' | 'section' | 'li'; className?: string }) {
  const ref = useRef<HTMLElement | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (prefersReduced()) { setInView(true); return }
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setInView(true); io.disconnect() } })
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <Tag ref={ref as never} className={`reveal ${inView ? 'in' : ''} ${className}`.trim()} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  )
}

/** Count a stat up from zero when it enters view. Parses a leading prefix, the
 *  number (commas/decimals/sign) and a trailing suffix, so a value keeps its
 *  unit while animating.
 *
 *  Currently unused. The marketing site displays no performance statistics,
 *  because none have been verified — see PRODUCT.md → Evidence on Hand. Keep
 *  this helper for when real, cleared figures exist; do not reintroduce it to
 *  animate a placeholder number. */
export function CountUp({ value, className, duration = 1200 }: { value: string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [text, setText] = useState(value)
  useEffect(() => {
    const m = /^(\D*)(-?[\d,]*\.?\d+)(.*)$/.exec(value)
    const el = ref.current
    if (!m || prefersReduced() || !el || typeof IntersectionObserver === 'undefined') { setText(value); return }
    const [, prefix, numStr, suffix] = m
    const hasComma = numStr.includes(',')
    const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0
    const target = parseFloat(numStr.replace(/,/g, ''))
    const fmt = (n: number) => {
      const base = hasComma
        ? n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : n.toFixed(decimals)
      return `${prefix}${base}${suffix}`
    }
    setText(fmt(0))
    let raf = 0
    let started = false
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting || started) return
        started = true
        io.disconnect()
        let t0 = 0
        const step = (t: number) => {
          if (!t0) t0 = t
          const p = Math.min(1, (t - t0) / duration)
          const eased = 1 - Math.pow(1 - p, 3)
          setText(fmt(target * eased))
          if (p < 1) raf = requestAnimationFrame(step)
          else setText(fmt(target))
        }
        raf = requestAnimationFrame(step)
      })
    }, { threshold: 0.5 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [value, duration])
  return <span ref={ref} className={className}>{text}</span>
}

/* ─── Scroll craft ──────────────────────────────────────────────────────────
   Added as a motion layer over a design that already worked. Every effect
   below is a no-op under prefers-reduced-motion, and none of them change
   layout — so if the JS never runs, the page is exactly the page. */

/**
 * Lenis smooth scroll, scoped to the marketing site.
 *
 * Smooth scroll is the one effect here that touches native browser behaviour,
 * so it is deliberately conservative: it is skipped entirely under reduced
 * motion, and in-page anchor links are handled explicitly, because a smooth-
 * scroll library that silently breaks `#process` and `#demo` would be a
 * regression dressed as polish.
 */
export function useSmoothScroll() {
  // The loop itself now lives in scroll/ScrollProvider, so there is exactly one
  // Lenis instance and one ticker on the site. This hook keeps its name and its
  // anchor handling, so every caller and every behaviour is unchanged.
  useScrollEngine()
  useEffect(() => {
    // Anchor links keep working, and keep their easing.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.('a[href^="#"], a[href*="/#"]') as HTMLAnchorElement | null
      if (!a) return
      const hash = a.getAttribute('href')?.split('#')[1]
      if (!hash) return
      const target = document.getElementById(hash)
      if (!target) return
      e.preventDefault()
      scrollToAnchor(target, -72)
      history.replaceState(null, '', `#${hash}`)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  // Deep links: /#scoring arriving cold.
  //
  // The browser tries to scroll to the fragment as soon as the document is
  // parsed — which, in a single-page app, is before React has rendered
  // anything, so the element does not exist and the visitor lands at the top.
  // Every shared or bookmarked section link was silently broken. Polls for the
  // element for about a second, then gives up rather than fighting a scroll the
  // reader has since started.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1))
    if (!hash) return
    let raf = 0
    let tries = 0
    let cancelled = false
    const onUserScroll = () => { cancelled = true }
    window.addEventListener('wheel', onUserScroll, { passive: true, once: true })
    window.addEventListener('touchstart', onUserScroll, { passive: true, once: true })

    // Two passes, deliberately. PinnedStage decides whether to pin after it
    // mounts, and pinning adds several viewport-heights to a section — so
    // anything below it moves. A single scroll lands on where the target used
    // to be. The second pass corrects once the layout has settled.
    let correct = 0
    const attempt = () => {
      if (cancelled) return
      const el = document.getElementById(hash)
      if (el) {
        scrollToAnchor(el, -72)
        correct = window.setTimeout(() => {
          if (cancelled) return
          const again = document.getElementById(hash)
          if (again) scrollToAnchor(again, -72)
        }, 700)
        return
      }
      if (tries++ < 60) raf = requestAnimationFrame(attempt)
    }
    raf = requestAnimationFrame(attempt)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.clearTimeout(correct)
      window.removeEventListener('wheel', onUserScroll)
      window.removeEventListener('touchstart', onUserScroll)
    }
  }, [])
}

/**
 * Section cues — one observer for the whole page.
 *
 * Marks each section `is-near` the first time it comes into view, which is what
 * draws the rule above its heading (see `.sec-head::before` in mimicSite.css).
 * A single observer over every section, not one per section: this runs on all 73
 * marketing routes and a per-block observer would mean dozens of live callbacks
 * on the longer inner pages for an effect that fires once each.
 *
 * PROGRESSIVE, in the direction that fails safe. The rule is drawn by default in
 * CSS; this hook adds `mm-cued` to the site root to say "JS is in charge now",
 * which is what allows the collapsed starting state to exist at all. If the hook
 * never runs, every rule is simply already drawn.
 *
 * Targets are unobserved as they fire, so the observer empties itself out as the
 * reader descends rather than staying subscribed to the whole document.
 */
export function useSectionCues(routeKey: string) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.mimic-site')
    if (!root) return
    // Reduced motion never opts in: without `mm-cued` the CSS leaves every rule
    // drawn, which is the finished state rather than a missing animation.
    if (prefersReduced() || typeof IntersectionObserver === 'undefined') return

    const targets = Array.from(root.querySelectorAll<HTMLElement>('main section, main .mk-hero'))
    if (!targets.length) return

    root.classList.add('mm-cued')
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        e.target.classList.add('is-near')
        io.unobserve(e.target)
      })
    }, {
      // Fires a little before the section's edge, so the rule is being drawn as
      // the heading arrives rather than after the reader has already read it.
      rootMargin: '0px 0px -8% 0px',
      threshold: 0.01,
    })
    targets.forEach((t) => io.observe(t))

    return () => {
      io.disconnect()
      root.classList.remove('mm-cued')
      // The next route mounts its own sections; leaving stale marks on shared
      // chrome would start the new page mid-animation.
      targets.forEach((t) => t.classList.remove('is-near'))
    }
  }, [routeKey])
}

/** Reading-progress rail across the top of the page. Brand gradient, 2px. */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (prefersReduced()) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const doc = document.documentElement
        const max = doc.scrollHeight - window.innerHeight
        const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
        // scaleX, not width — width animation forces layout every frame.
        if (ref.current) ref.current.style.transform = `scaleX(${p})`
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame) }
  }, [])
  return <div className="mm-progress" aria-hidden="true"><div ref={ref} className="mm-progress-bar" /></div>
}

/** Vertical parallax. `strength` is px of travel across the whole viewport pass. */
export function Parallax({ children, strength = 28, className = '' }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (prefersReduced()) return
    const el = ref.current
    if (!el) return
    let frame = 0
    let visible = false
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting }, { rootMargin: '120px' })
    io.observe(el)
    const onScroll = () => {
      if (frame || !visible) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const r = el.getBoundingClientRect()
        const centre = r.top + r.height / 2
        const p = (centre - window.innerHeight / 2) / window.innerHeight  // −1 … 1
        el.style.transform = `translate3d(0, ${(-p * strength).toFixed(2)}px, 0)`
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame) }
  }, [strength])
  return <div ref={ref} className={`mm-parallax ${className}`.trim()}>{children}</div>
}

/**
 * Magnetic hover — the control leans toward the cursor within its own bounds.
 * Pointer-based, so it never fires on touch, and the translation is small
 * enough (max ~6px) to read as responsiveness rather than as a toy.
 */
export function Magnetic({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (prefersReduced()) return
    const el = ref.current
    if (!el || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
      el.style.transform = `translate3d(${(dx * 6).toFixed(2)}px, ${(dy * 4).toFixed(2)}px, 0)`
    }
    const onLeave = () => { el.style.transform = 'translate3d(0,0,0)' }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave) }
  }, [])
  return <span ref={ref} className={`mm-magnetic ${className}`.trim()}>{children}</span>
}

/**
 * Fires once when the element scrolls into view. Returns a ref and a flag, so a
 * component can drive its own entrance without each one re-implementing the
 * observer. Resolves immediately under reduced motion, so the finished state is
 * what renders rather than the starting one.
 */
export function useInView<T extends HTMLElement>(threshold = 0.35) {
  const ref = useRef<T | null>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (prefersReduced()) { setSeen(true); return }
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])
  return [ref, seen] as const
}
