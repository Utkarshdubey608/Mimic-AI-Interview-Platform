import { useEffect } from 'react'

/**
 * The marketing site's one and only scroll loop.
 *
 * Bridges Lenis (smoothing) to GSAP ScrollTrigger (pinning and scrub) through
 * GSAP's ticker, so exactly one clock drives both. Running Lenis on its own
 * requestAnimationFrame while GSAP runs its internal ticker gives two
 * independent clocks, and that is the classic source of the stutter this
 * engine exists to eliminate.
 *
 * Both libraries are dynamically imported: a visitor who has asked for reduced
 * motion never downloads either.
 */

const prefersReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

type LenisLike = {
  raf: (t: number) => void
  scrollTo: (t: HTMLElement | number, o?: object) => void
  destroy: () => void
}

let lenisInstance: LenisLike | null = null
const listeners = new Set<() => void>()

/**
 * Subscribe to scroll ticks. Returns an unsubscribe function.
 *
 * Subscribers are called from the Lenis scroll event, which is already inside
 * GSAP's ticker — so a subscriber runs at most once per frame and must not do
 * layout-thrashing work.
 */
export function onScrollTick(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * Smooth-scroll to an element. Falls back to native smooth behaviour when the
 * engine is not running (reduced motion, or before the chunk resolves), so
 * in-page anchors never break.
 */
export function scrollToAnchor(el: HTMLElement, offset = -72): void {
  if (lenisInstance) lenisInstance.scrollTo(el, { offset })
  else el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * Smooth-scroll to an absolute document offset. Used by PinnedStage to move to
 * a step when its control is clicked, so scroll position stays the single
 * source of truth for which step is showing.
 */
export function scrollToY(y: number): void {
  if (lenisInstance) lenisInstance.scrollTo(y)
  else window.scrollTo({ top: y, behavior: 'smooth' })
}

/** Mount the engine. Call exactly once, from MarketingLayout. */
export function useScrollEngine(): void {
  useEffect(() => {
    if (prefersReduced()) return
    let cancelled = false
    let teardown: (() => void) | null = null

    Promise.all([import('lenis'), import('gsap'), import('gsap/ScrollTrigger')])
      .then(([lenisMod, gsapMod, stMod]) => {
        if (cancelled) return
        const Lenis = lenisMod.default
        const gsap = gsapMod.gsap
        const { ScrollTrigger } = stMod
        gsap.registerPlugin(ScrollTrigger)

        const lenis = new Lenis({
          duration: 1.05, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.6,
        })
        lenisInstance = lenis as unknown as LenisLike

        const onScroll = () => {
          ScrollTrigger.update()
          listeners.forEach((fn) => fn())
        }
        lenis.on('scroll', onScroll)

        // GSAP owns the clock; Lenis is driven from it. GSAP ticks in seconds,
        // Lenis expects milliseconds. lagSmoothing(0) stops GSAP from skipping
        // frames mid-scrub, which would desynchronise a pinned section.
        const tick = (time: number) => lenis.raf(time * 1000)
        gsap.ticker.add(tick)
        gsap.ticker.lagSmoothing(0)
        ScrollTrigger.refresh()

        teardown = () => {
          gsap.ticker.remove(tick)
          ScrollTrigger.getAll().forEach((t) => t.kill())
          lenis.destroy()
          lenisInstance = null
        }
      })
      .catch(() => {
        // The engine is an enhancement. If the chunk fails to load the page is
        // still the page — native scrolling, no pinning, all content present.
      })

    return () => { cancelled = true; teardown?.(); lenisInstance = null }
  }, [])
}
