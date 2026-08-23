/**
 * The format deck, verified.
 *
 *   node scripts/formats-verify.mjs                  # against the dev server
 *   BASE=http://localhost:5000 node scripts/formats-verify.mjs
 *
 * This section was rebuilt after three rounds of "it renders fine until Six ways
 * to meet a candidate, then it goes crazy". The failure was never in one place —
 * a stylesheet collision, a promoted compositor layer escaping its clip, and CSS
 * and JavaScript disagreeing about which mode was in force. What they had in
 * common is that all three broke the SAME small set of invariants, so those are
 * what this asserts, at four laptop sizes and one phone:
 *
 *  1. STRUCTURE. The deck contains its own paint (`contain:paint`) and cannot
 *     scroll (`overflow:clip`). With paint containment, geometry implies paint:
 *     if the deck's box is off screen, nothing inside it can be on screen. Every
 *     check below relies on that, so it is checked first.
 *  2. ONE AT A TIME. At a settled step exactly one panel overlaps the deck's box.
 *     This is the invariant the doubled-panel bug broke — the reader saw two
 *     panels stacked on the same ground. Overlap, not opacity: the panels off
 *     stage are translated a full deck width clear and clipped, so what they
 *     happen to be worth in opacity says nothing about what is on screen.
 *  3. AT MOST TWO IN FLIGHT. Mid-transition, never more than two panels overlap
 *     the deck. A third means one has been left behind: a ghost.
 *  4. NOTHING ESCAPES VERTICALLY, AND THE DECK HOLDS STILL. Sideways is the
 *     mechanism; the vertical is the axis the neighbouring sections live on. So
 *     no panel may reach past the deck's top or bottom, the pinned deck's box may
 *     not move or grow, and once the section is above the viewport the deck is
 *     too. That is the "clashing with the next section" symptom, as geometry.
 *  5. THE RAIL AGREES WITH THE PICTURE. The marked rail entry names the panel
 *     actually centre stage. `deckHead` and `stepProgress` divide the same
 *     travel differently, and the rail followed the wrong one for half a scroll.
 *  6. TWO FILMS AT MOST, AND NONE ONCE THE SECTION IS GONE. The panel being read
 *     and the one after it hold sources — the second is what makes a switch
 *     instant instead of a second of grey. Four did make the scroll stall, and a
 *     third here would mean the release has stopped working.
 *  7. THE PHONE GETS A LIST. Below the breakpoint all six panels are visible, in
 *     order, untransformed, with no rail — the content, not a broken effect.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3001'
const LAPTOPS = [
  { w: 1280, h: 720 },
  { w: 1366, h: 768 },
  { w: 1440, h: 900 },
  { w: 1536, h: 864 },
]
const PHONE = { w: 390, h: 844 }
const PANELS = 6
/** Painted at all. Below this a panel contributes nothing the eye can see. */
const LIT = 0.03

let failures = 0
const pass = (label) => console.log(`  [32mPASS[0m  ${label}`)
const fail = (label, detail) => { failures++; console.log(`  [31mFAIL[0m  ${label}${detail ? ` — ${detail}` : ''}`) }
const check = (label, ok, detail) => (ok ? pass(label) : fail(label, detail))

/** Where each panel is and how much of it is painted, right now. */
const readDeck = () => ({
  deck: (() => {
    const d = document.querySelector('.fmt-deck')
    if (!d) return null
    const r = d.getBoundingClientRect()
    const cs = getComputedStyle(d)
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, contain: cs.contain, overflow: cs.overflowX }
  })(),
  host: (() => {
    const h = document.querySelector('.mm-formats')
    if (!h) return null
    const r = h.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, height: r.height, background: getComputedStyle(h).backgroundColor }
  })(),
  /* Every transform inside a panel, so the harness can police WHAT KIND each one
     is. A fractional scale on text is the specific fault that made a white
     heading occupy its space and paint nothing on the reporter's machine, so
     "does any copy line carry a scale" is now a first-class check. */
  copyScales: Array.from(document.querySelectorAll('.fmt-copy')).flatMap((c) =>
    Array.from(c.children).map((el) => {
      const t = getComputedStyle(el).transform
      if (t === 'none') return 1
      const m = t.match(/matrix\(([^)]+)\)/)
      if (!m) return 1
      const n = m[1].split(',').map(Number)
      // a and d of the 2D matrix are the x and y scale.
      return Math.max(Math.abs(n[0] - 1), Math.abs(n[3] - 1))
    })),
  panels: Array.from(document.querySelectorAll('.fmt-slide')).map((el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      name: el.getAttribute('aria-label'),
      live: el.hasAttribute('data-live'),
      inert: el.inert === true,
      visibility: cs.visibility,
      opacity: Number(cs.opacity),
      transform: cs.transform,
      top: r.top, bottom: r.bottom, left: r.left, right: r.right,
    }
  }),
  rail: {
    shown: (() => {
      const n = document.querySelector('.fmt-nav')
      return n ? getComputedStyle(n).display !== 'none' : false
    })(),
    on: Array.from(document.querySelectorAll('.fmt-nav button')).findIndex((b) => b.hasAttribute('data-on')),
    count: document.querySelectorAll('.fmt-nav button').length,
  },
  srShown: (() => {
    const p = document.querySelector('.fmt-sr')
    return p ? getComputedStyle(p).display !== 'none' : false
  })(),
  armed: Array.from(document.querySelectorAll('.fmt-stage video')).filter((v) => !!v.getAttribute('src')).length,
})

/**
 * Which panels the reader can actually see.
 *
 * A geometric question, not an opacity one — and getting that wrong is what made
 * the first run of this harness report three panels on stage when the picture was
 * correct. Off-stage panels are translated a full deck width clear and CLIPPED by
 * the deck, so whatever opacity they carry, none of them is on screen. What
 * counts is how much of a panel overlaps the deck's box.
 */
const onStage = (s) => s.panels.filter((p) => {
  if (p.visibility === 'hidden' || p.opacity <= LIT) return false
  return Math.min(p.right, s.deck.right) - Math.max(p.left, s.deck.left) > 1
})

/**
 * Scroll there and wait for the page to actually be still.
 *
 * Two frames used to be enough. It stopped being enough when the deck learned to
 * settle onto a panel: the settle hands a target to the scroll engine, the engine
 * EASES to it, and an eased scroll overrides a later `scrollTo` — so the harness
 * would set a position, read 90ms later, and be looking at wherever the previous
 * settle was still travelling to. Every step reported the same wrong panel.
 *
 * Waiting for stillness rather than for a fixed delay is also the honest test: it
 * is the state a reader is in when they stop.
 */
const quiet = (page) => page.evaluate(() => new Promise((done) => {
  let last = -1, still = 0, frames = 0
  const look = () => {
    if (Math.abs(window.scrollY - last) < 0.5) still++; else still = 0
    last = window.scrollY
    // 10 quiet frames, or give up at 4 seconds rather than hang the run.
    if (still >= 10 || ++frames > 240) done()
    else requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
}))

/**
 * Put the page at `y` and keep it there.
 *
 * Two frames used to be enough. It stopped being enough when the deck learned to
 * settle onto a panel, and it took two goes to get this right, so both are worth
 * recording:
 *
 *  · A settle hands a target to the scroll engine and the engine EASES to it, and
 *    an eased scroll overrides a later `scrollTo`. Waiting a fixed 90ms read the
 *    page mid-journey.
 *  · Waiting for stillness alone is not enough either. The settle only fires once
 *    the velocity has decayed, which takes longer than the stillness check needs
 *    to pass — so the wait would return, the harness would scroll somewhere else,
 *    and THEN the previous position's settle would fire and drag the page to a
 *    panel the harness was no longer asking about. Every step reported the panel
 *    the section had been parked on before the loop started.
 *
 * So: scroll, wait past the decay, wait for stillness, and if something moved the
 * page anyway, do it again. Two rounds is enough because the second scroll happens
 * with nothing pending.
 */
const settle = async (page, y) => {
  /* Five attempts, not three, and 650ms of patience rather than 420.
     The section's travel grew from 280vh to 388vh when a step was lengthened to
     match one scroll gesture, which made every eased scroll in it correspondingly
     longer — and a settle that gives up too early reads the page mid-journey and
     reports the wrong panel. It failed at one step per viewport, at a different
     step each time, which is the signature of a race rather than an off-by-one. */
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.evaluate((to) => window.scrollTo(0, to), y)
    await page.waitForTimeout(650)   // longer than the velocity decay AND the settle
    await quiet(page)
    const at = await page.evaluate(() => window.scrollY)
    if (Math.abs(at - y) < 4) return
  }
}

async function laptop(browser, size) {
  console.log(`\n[1m${size.w}×${size.h}[0m`)
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.fmt-deck')

  const geom = await page.evaluate(() => {
    const h = document.querySelector('.mm-formats')
    return { top: h.offsetTop, height: h.offsetHeight, pinned: h.classList.contains('mm-stage') }
  })
  check('the stage pins', geom.pinned, 'the host never got mm-stage, so the deck is a list here')
  if (!geom.pinned) { await page.close(); return }

  const travel = geom.height - size.h

  // 1. Structure, first, because every other check leans on it.
  await settle(page, geom.top + travel * 0.5)
  const mid = await page.evaluate(readDeck)
  check('the deck contains its own paint', /paint|strict|content/.test(mid.deck.contain), `contain: ${mid.deck.contain}`)
  check('the deck cannot scroll', mid.deck.overflow === 'clip', `overflow-x: ${mid.deck.overflow}`)
  check('the host is the ink ground', mid.host.background === 'rgb(14, 20, 32)', mid.host.background)
  check('the rail is shown and complete', mid.rail.shown && mid.rail.count === PANELS, `${mid.rail.count} entries, shown=${mid.rail.shown}`)
  check('the hidden format list is present for a screen reader', mid.srShown)

  // 2 + 5 + 6. Every settled step: one panel, named by the rail, one film.
  for (let i = 0; i < PANELS; i++) {
    await settle(page, geom.top + travel * ((i + 0.5) / PANELS))
    const s = await page.evaluate(readDeck)
    const lit = onStage(s)
    check(`step ${i}: exactly one panel is on stage`, lit.length === 1,
      `${lit.length} on stage: ${lit.map((p) => `${p.name} @${p.opacity}`).join(', ')}`)
    check(`step ${i}: it is panel ${i}`, lit.length === 1 && lit[0].name === s.panels[i].name,
      lit.length === 1 ? `painted ${lit[0].name}, expected ${s.panels[i].name}` : '')
    check(`step ${i}: it is fully opaque`, lit.length === 1 && lit[0].opacity > 0.98, lit[0] && String(lit[0].opacity))
    check(`step ${i}: the rail marks panel ${i}`, s.rail.on === i, `rail on ${s.rail.on}`)
    check(`step ${i}: data-live is on panel ${i}`, s.panels.filter((p) => p.live).length === 1 && s.panels[i].live)
    check(`step ${i}: the other five are inert`, s.panels.filter((p) => p.inert).length === PANELS - 1,
      `${s.panels.filter((p) => p.inert).length} inert`)
    /* TWO, not one. The deck deliberately buffers the panel after the one being
       read, because it is the one a gesture is about to ask for — that is what
       took a switch from about a second of grey down to single-digit
       milliseconds. Two buffers, still one decoder: the play observer only starts
       a film that is actually on screen. Three would mean the release is not
       working. */
    check(`step ${i}: at most two films hold a source`, s.armed <= 2, `${s.armed} armed`)
  }

  // 3 + 4. The whole travel, in 41 samples: never a third panel, never a panel
  //        outside the deck, and the rail always names the panel on stage.
  /* A CONTINUOUS scroll, sampled while it is happening.
     This used to jump to 41 fixed positions and read the state at rest. That
     stopped being a test of anything the moment the deck learned to settle onto
     the nearest panel: a jump lands, the velocity decays, the deck snaps to a
     panel centre, and the sample reads a settled panel every time — mid-travel,
     the state this is supposed to police, was never observed. Wheeling through it
     and sampling on the way is both harder to pass and the thing readers do. */
  let maxLit = 0, tall = 0, moved = 0, samples = 0
  const deck0 = mid.deck
  await settle(page, geom.top + 40)
  await page.mouse.move(Math.round(size.w / 2), Math.round(size.h / 2))
  /* One notch per panel, sampled all the way ACROSS each transition.
     Two earlier versions of this loop tested nothing, each for its own reason, and
     both are worth recording. Jumping to fixed positions and reading at rest
     stopped working when the deck learned to settle onto a panel — the sample
     always landed on a settled panel and mid-travel was never observed. Then
     wheeling 120 notches back to back stopped working when the deck learned to
     take one gesture at a time: a burst with no gaps in it IS one gesture, so the
     whole loop advanced a single panel.
     A notch, a gap long enough to count as a gesture of its own, then a dozen
     reads through the eased travel it starts. That is where the invariants have to
     hold, and it is what a reader actually does. */
  for (let step = 0; step < PANELS - 1; step++) {
    await page.mouse.wheel(0, 120)
    for (let k = 0; k < 12; k++) {
      const s = await page.evaluate(readDeck)
      samples++
      const lit = onStage(s)
      if (lit.length > maxLit) maxLit = lit.length
      for (const x of lit) if (x.top < s.deck.top - 1 || x.bottom > s.deck.bottom + 1) tall++
      if (Math.abs((s.deck.bottom - s.deck.top) - (deck0.bottom - deck0.top)) > 1
        || Math.abs(s.deck.left - deck0.left) > 1) moved++
      await page.waitForTimeout(25)
    }
    await page.waitForTimeout(900)   // the gap that makes the next notch its own gesture
  }
  check(`never more than two panels on stage across ${samples} live samples`, maxLit <= 2, `${maxLit} at once`)
  check('no panel reaches past the deck vertically', tall === 0, `${tall} of ${samples} samples`)
  check('the pinned deck box never moves or grows', moved === 0, `${moved} of ${samples} samples`)

  /* The settle. Stop the deck deliberately between two panels and it has to come
     to rest on one — this is what makes a scroll advance a panel rather than
     leaving the reader parked across a join. */
  await settle(page, geom.top + travel * 0.5)
  await page.waitForTimeout(1600)
  const rested = await page.evaluate(readDeck)
  const restLit = onStage(rested)
  check('stopped between two panels, the deck settles onto one', restLit.length === 1,
    `${restLit.length} on stage: ${restLit.map((x) => x.name).join(', ')}`)

  /* And the fault the reporter actually saw. */
  const worstScale = Math.max(...rested.copyScales)
  check('no copy line carries a scale', worstScale < 1e-6, `worst deviation from 1 was ${worstScale}`)


  // 4, the part that was actually reported: once the section is above the
  // viewport, so is the deck — and with paint containment that is the end of it.
  await settle(page, geom.top + geom.height + 400)
  const after = await page.evaluate(readDeck)
  check('the deck is gone once the section is', after.deck.bottom <= 0, `deck bottom at ${Math.round(after.deck.bottom)}px`)
  check('no panel is left in the viewport', after.panels.every((p) => p.bottom <= 0),
    after.panels.filter((p) => p.bottom > 0).map((p) => p.name).join(', '))
  check('no film is left holding a source', after.armed === 0, `${after.armed} armed`)

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  // One screenshot per panel, for the eye.
  for (let i = 0; i < PANELS; i++) {
    await settle(page, geom.top + travel * ((i + 0.5) / PANELS))
    await page.screenshot({ path: `.artifacts/formats/${size.w}x${size.h}-panel-${i}.png` })
  }
  // And the join, which is where the damage showed.
  await settle(page, geom.top + geom.height - size.h * 0.4)
  await page.screenshot({ path: `.artifacts/formats/${size.w}x${size.h}-join.png` })

  await page.close()
}

async function phone(browser) {
  console.log(`\n[1m${PHONE.w}×${PHONE.h} — list mode[0m`)
  const page = await browser.newPage({ viewport: { width: PHONE.w, height: PHONE.h }, deviceScaleFactor: 2 })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.fmt-deck')
  await page.evaluate(() => document.querySelector('.fmt-deck').scrollIntoView())
  await page.waitForTimeout(400)

  const s = await page.evaluate(readDeck)
  check('the stage does not pin', !(await page.evaluate(() => document.querySelector('.mm-formats').classList.contains('mm-stage'))))
  check('all six panels are visible', s.panels.every((p) => p.visibility === 'visible'), s.panels.map((p) => p.visibility).join(','))
  check('none is transformed', s.panels.every((p) => p.transform === 'none'), s.panels.map((p) => p.transform).join(' | '))
  check('none is inert', s.panels.every((p) => !p.inert))
  check('they stack in order', s.panels.every((p, i) => i === 0 || p.top > s.panels[i - 1].top))
  check('the rail is hidden', !s.rail.shown)
  check('the duplicate format list is hidden', !s.srShown)
  // The DECK, not the viewport: a viewport shot lands wherever scrollIntoView put
  // it, which on a phone is usually the middle of one film and tells you nothing.
  await page.locator('.formats-head').screenshot({ path: '.artifacts/formats/390-head.png' })
  for (const i of [0, 3, 5]) {
    await page.locator('.fmt-slide').nth(i).screenshot({ path: `.artifacts/formats/390-panel-${i}.png` })
  }
  await page.close()
}

const browser = await chromium.launch()
try {
  for (const size of LAPTOPS) await laptop(browser, size)
  await phone(browser)
} finally {
  await browser.close()
}

console.log(failures === 0
  ? '\n[32m✅ THE FORMAT DECK HOLDS — every invariant, every size[0m'
  : `\n[31m❌ ${failures} CHECK(S) FAILED[0m`)
process.exit(failures === 0 ? 0 : 1)
