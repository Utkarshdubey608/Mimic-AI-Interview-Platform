/**
 * The ink trail on the light sections — one canvas that follows the reader from
 * section to section.
 *
 * The trail already existed, but only on the ink-dark sections: the hero, the
 * problem beat, the format deck, the process stage, the CTA and the footer. Every
 * light section between them had none, so the effect switched on and off down the
 * page. This is the other half.
 *
 * WHY IT ROAMS INSTEAD OF BEING MOUNTED PER SECTION. Seven light sections would
 * be seven WebGL2 contexts, on top of the six the dark sections already hold.
 * Browsers cap live contexts somewhere around sixteen and start discarding the
 * oldest, which would silently kill the hero's trail to pay for the FAQ's. One
 * context, moved into whichever section the pointer is actually over, costs what
 * one section costs — and nobody can look at two sections at once, so there is
 * nothing to be gained by rendering into both. Moving a canvas in the DOM keeps
 * its GL context; only the size changes, which is what `resize()` is for.
 *
 * WHY MULTIPLY AND NOT SCREEN. The dark trail is `screen`: light added to a dark
 * ground. On paper, screen with a pale dye is arithmetically nothing — it is why
 * the light sections looked untouched when the same layer was dropped into them.
 * The draw pass writes premultiplied alpha, transparent everywhere the dye is
 * not, so the same canvas under `multiply` darkens instead: the ink lands on paper
 * as ink rather than as light. No shader change; a different blend and a different
 * dye, which is the registrar blue rather than the machine cyan, because blue on
 * paper is what the rest of the light page already uses.
 *
 * The canvas sits at z-index 0 inside the section and the section's own content
 * sits above it, so the blend reaches the section's background and never the
 * type on top of it. That is deliberate: multiply under text would tint the text
 * and quietly undo the contrast the audit checks.
 *
 * Same enhancement contract as the rest of the ink: the page is finished without
 * this file, and it arms only when reduced motion, reduced transparency and
 * more-contrast are all unset, a real pointer exists, the device is not a software
 * renderer, the token resolves and the program compiles.
 */
import { useEffect, useRef, useState } from 'react'

import { parseColor } from '../field/tokens'
import { readGate, watchGate } from './gate'
import type { InkFluid } from './inkFluid'

/**
 * What counts as a surface the trail can live on.
 *
 * Every section, plus the footer, on every marketing route — not an opt-in list.
 * An opt-in attribute was the first version and it does not scale to the answer
 * this needs to give: there are 74 routes, most of them white, and marking each
 * band by hand would have meant the trail working on the home page and nowhere
 * else. A section that already owns a `.mm-ink` is skipped, so the six ink-dark
 * surfaces keep the trail they already had and this one covers the rest.
 */
const HOSTS = 'section, .foot'

/**
 * Relative luminance of the first real background at or above `el`.
 *
 * Backgrounds are painted on section elements and most sections declare none, so
 * the ground has to be found by walking up rather than read off the host. This is
 * what decides the blend: added as light on ink, laid down as dye on paper.
 */
function groundLuma(el: HTMLElement): number {
  let n: HTMLElement | null = el
  while (n && n !== document.documentElement) {
    const parts = getComputedStyle(n).backgroundColor.match(/[\d.]+/g)
    // Transparent, or as good as: keep walking. Alpha is the fourth value.
    if (parts && parts.length >= 3 && (parts.length < 4 || Number(parts[3]) > 0.05)) {
      const [r, g, b] = parts.slice(0, 3).map(Number).map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    n = n.parentElement
  }
  return 1   // nothing declared anywhere: the page ground is paper
}

export function RoamingInk() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [enhance, setEnhance] = useState(false)

  /* ── Gate ───────────────────────────────────────────────────────────────
     The shared one, plus `wide`. A cursor trail needs a cursor, and a phone is
     where this page's worst number already lives. */
  useEffect(() => {
    let cancelled = false
    let idle = 0

    const sync = () => {
      const g = readGate()
      if (!g.allowed || !g.finePointer || !g.wide) { setEnhance(false); return }
      const ric = (window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
      }).requestIdleCallback
      const arm = () => {
        if (cancelled) return
        const g2 = readGate()
        if (!g2.allowed || !g2.finePointer || !g2.wide) return
        void import('@/features/intro/tier')
          .then(({ detectTier }) => {
            if (cancelled || !readGate().allowed) return
            setEnhance(detectTier() !== 'low')
          })
          .catch(() => { /* the page stands as it is */ })
      }
      if (ric) idle = ric(arm, { timeout: 2600 })
      else idle = window.setTimeout(arm, 1300)
    }

    sync()
    const stop = watchGate(sync)
    return () => {
      cancelled = true
      stop()
      const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
      if (idle) { if (cic) cic(idle); else window.clearTimeout(idle) }
    }
  }, [])

  /* ── The loop ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!enhance) return
    const canvas = canvasRef.current
    if (!canvas) return

    /* LIGHT BLUE, and the third colour tried here, so the reasoning is worth
       keeping. Registrar blue was a near-navy meant for rules and links and came
       out under multiply as a heavy indigo stain. `--mm-ai` was the ink's own cyan
       and looked right on the dark grounds — but multiply pulls red down about
       twice as hard as green and blue, so on paper it landed as saturated
       turquoise. Measured: white went to rgb(152,192,198), which is teal, not the
       light blue it was asked to be.

       `--mm-on-ink-accent` is the accent that already exists for light-on-dark,
       and its hue survives both blends: under multiply on white it lays down a
       periwinkle blue, and under screen on ink it lifts to the same blue. One
       colour for the whole site, which was the point.

       Read off the CANVAS, not off the document root. The palette is declared on
       `.mimic-site`, so `documentElement` resolves it to an empty string — and
       because a missing colour makes this effect bail before it binds a listener,
       the symptom was a layer that existed and never once appeared. */
    const color = parseColor(getComputedStyle(canvas).getPropertyValue('--mm-on-ink-accent'))
    if (!color) return

    let fluid: InkFluid | null = null
    let raf = 0
    let disposed = false
    let host: HTMLElement | null = null
    let ro: ResizeObserver | null = null

    let cx = 0.5, cy = 0.5
    let force = 0, targetForce = 0
    let fade = 0
    let last = 0
    let energy = 0
    let tabVisible = document.visibilityState !== 'hidden'

    const frame = (now: number) => {
      if (disposed || !fluid) return
      const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60
      last = now
      force += (targetForce - force) * (1 - Math.exp(-dt * 5))
      fade += (1 - fade) * (1 - Math.exp(-dt * 2.2))
      energy = Math.max(force, energy - dt * 0.55)
      fluid.render(dt, cx, cy, force, fade)
      if (targetForce <= 0.001 && energy <= 0.001) { raf = 0; last = 0; return }
      raf = requestAnimationFrame(frame)
    }

    const kick = () => {
      if (disposed || raf || !fluid || !host || !tabVisible) return
      last = 0
      raf = requestAnimationFrame(frame)
    }

    /**
     * Move into a section, or out of every section.
     *
     * The fade restarts on arrival, which is the point: the trail should read as
     * being drawn on THIS sheet of paper, not as a layer that was already running
     * and happened to slide underneath.
     */
    const attach = (next: HTMLElement | null) => {
      if (next === host) return
      host = next
      if (!next) {
        canvas.remove()
        targetForce = 0
        return
      }
      /* The host has to be a stacking context, or a canvas at z-index -1 escapes
         it and paints behind the section's own background — which is to say,
         invisibly. `isolation` is what creates one; `position:relative` alone with
         an auto z-index does not. Both are set only when they are missing, so a
         section that already had them is left as it was. */
      const cs = getComputedStyle(next)
      if (cs.position === 'static') next.style.position = 'relative'
      if (cs.isolation !== 'isolate') next.style.isolation = 'isolate'
      /* Light or dark decides the blend, not the call site. On paper the dye is
         laid down (multiply); on ink it is added as light (screen), which is what
         the dark sections' own trails already do — this only matters for a dark
         band that has no trail of its own.

         IT ALSO DECIDES THE DEPTH, and getting that wrong is why the trail was
         missing from the scoring section entirely. A dark band carries a `Field`:
         an opaque canvas at z-index 0, created with `alpha:false`, which owns the
         whole ground once it lights. At -1 the trail was painting BEHIND it and
         could not be seen at all. The sections' own trails sit at 0 and come after
         the field in document order, which is how they land on top of it.

         So: paper gets -1, which needs nothing lifted above it and is what makes
         this work on 74 routes without markup. Ink gets 0, above the field — but
         only when the section's content is already lifted clear, which
         `.section.on-dark .wrap` guarantees and a stray dark band might not. When
         it is not liftable, -1 is the fallback: hidden behind a field is a missing
         effect, and painting over the type is a broken page. */
      const light = groundLuma(next) > 0.35
      canvas.style.mixBlendMode = light ? 'multiply' : 'screen'
      /* ABOVE the content, and this is a reversal. It used to sit at -1, below
         every descendant, which is what let it work with no markup — but a layer
         below the content is hidden by every opaque thing in front of it, and
         these sections are mostly opaque things. Measured: sweeping the pointer
         inside the walkthrough film panel changed ZERO pixels, and the same in the
         workspace video. Seventy per cent of the hero, forty-five of the film
         band, thirty-seven of the workspace could not be painted at all. What the
         reader saw was ink in the margins and none of it where the cursor was.

         Painting over the content is safe here for a reason particular to these
         two blends, not by luck. `multiply` can only ever darken and `screen` can
         only ever lighten, so on paper the type gets darker along with its ground
         and on ink it gets lighter along with its. Neither blend can move text
         toward its background. Measured at the strongest point: dark type on the
         darkest ink the trail makes still reads about 8:1. */
      canvas.style.zIndex = '4'
      /* And because it is over the type now, it is held back. At full strength the
         wash competes with body copy for attention; a little over half reads as
         the paper being marked rather than as something laid on top of it.
         `opacity` scales the layer before it blends, so this is one declaration
         rather than a shader uniform. */
      canvas.style.opacity = light ? '0.5' : '0.85'
      next.appendChild(canvas)
      fade = 0
      fluid?.resize()
      ro?.disconnect()
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => fluid?.resize())
        ro.observe(next)
      }
    }

    /* One listener on the document rather than one per section: the pointer is a
       single thing, and this way a section added or removed later needs no
       bookkeeping — the lookup below simply finds it or does not. */
    let pending = 0
    let px = 0, py = 0
    const onMove = (e: PointerEvent) => {
      px = e.clientX; py = e.clientY
      if (pending) return
      pending = requestAnimationFrame(() => {
        pending = 0
        if (disposed) return
        /* `elementFromPoint` rather than a rect walk: it respects what is actually
           on top, so the trail does not follow the pointer through a section it is
           only geometrically inside — an open nav menu, say. */
        const under = document.elementFromPoint(px, py)
        let section = under ? (under.closest(HOSTS) as HTMLElement | null) : null
        /* A surface with its own trail keeps it, and the search is for ANY
           descendant — not a direct child, which is what this used to check and
           what made it wrong on half its targets. Three sections keep their trail
           nested: the hero's is inside its dark card, two levels down, and the
           format and process stages keep theirs inside the sticky box. All three
           read as "no trail of its own", so a second live fluid field was attached
           on top of the first — the exact thing this line exists to prevent. On the
           hero it was worse than redundant: the roaming canvas sat behind the
           opaque card and could only show in the white gutter beside it, reading as
           a stray smudge while still paying for a resize observer and a loop. */
        if (section && section.querySelector('.mm-ink')) section = null
        attach(section)
        if (!section) return
        const r = section.getBoundingClientRect()
        cx = (px - r.left) / Math.max(r.width, 1)
        cy = 1 - (py - r.top) / Math.max(r.height, 1)
        targetForce = 1
        energy = 1
        kick()
      })
    }

    const onLeaveWindow = () => { targetForce = 0 }
    const onVisibility = () => {
      tabVisible = document.visibilityState !== 'hidden'
      if (!tabVisible && raf) { cancelAnimationFrame(raf); raf = 0; last = 0 }
      else kick()
    }

    void import('./inkFluid')
      .then(({ createInkFluid }) => {
        if (disposed) return
        fluid = createInkFluid(canvas, { color })
        if (!fluid) return   // no WebGL2 / no float target; the page stands as-is
        document.addEventListener('pointermove', onMove, { passive: true })
        document.addEventListener('pointerleave', onLeaveWindow)
        document.addEventListener('visibilitychange', onVisibility)
      })
      .catch(() => { /* the page stands as it is */ })

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      if (pending) cancelAnimationFrame(pending)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeaveWindow)
      document.removeEventListener('visibilitychange', onVisibility)
      ro?.disconnect()
      fluid?.dispose()
      fluid = null
      canvas.remove()
    }
  }, [enhance])

  if (!enhance) return null

  /* Rendered detached and parked by React; the loop above is what puts it into a
     section. React never sees it move, which is fine — it owns the element, not
     its position, and it removes it on unmount either way. */
  return <canvas ref={canvasRef} className="mm-ink-light" aria-hidden="true" tabIndex={-1} role="presentation" />
}
