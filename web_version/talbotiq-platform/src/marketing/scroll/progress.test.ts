/**
 * Unit tests for the marketing scroll math. Run with:
 *   npx tsx src/features/marketing/scroll/progress.test.ts
 * Pure — no DOM, no React.
 */
import { clamp01, deckHead, easeInOutCubic, stepProgress, sectionProgress, canPinStage } from './progress'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

// clamp01
assert('clamp01 below range', clamp01(-3) === 0)
assert('clamp01 above range', clamp01(4.2) === 1)
assert('clamp01 inside range', clamp01(0.37) === 0.37)

// easeInOutCubic — endpoints and midpoint must be exact
assert('ease at 0', easeInOutCubic(0) === 0)
assert('ease at 1', easeInOutCubic(1) === 1)
assert('ease at 0.5', Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-9)
assert('ease is monotonic', easeInOutCubic(0.3) < easeInOutCubic(0.6))

// stepProgress — the boundary behaviour the pinned stage depends on
assert('start is step 0 t 0', JSON.stringify(stepProgress(0, 4)) === JSON.stringify({ step: 0, t: 0, steps: 4 }))
assert('end clamps to last step', JSON.stringify(stepProgress(1, 4)) === JSON.stringify({ step: 3, t: 1, steps: 4 }))
assert('mid of step 2 of 4', JSON.stringify(stepProgress(0.625, 4)) === JSON.stringify({ step: 2, t: 0.5, steps: 4 }))
assert('overshoot clamps', stepProgress(1.8, 4).step === 3)
assert('undershoot clamps', stepProgress(-0.5, 4).step === 0)
assert('single step degenerates safely', JSON.stringify(stepProgress(0.42, 1)) === JSON.stringify({ step: 0, t: 0.42, steps: 1 }))
assert('zero steps does not divide by zero', Number.isFinite(stepProgress(0.5, 0).t))

// sectionProgress — 0 as the section enters the bottom, 1 as it clears the top
assert('below viewport is 0', sectionProgress({ top: 900, height: 600 }, 900) === 0)
assert('fully passed is 1', sectionProgress({ top: -600, height: 600 }, 900) === 1)
assert('halfway is ~0.5', Math.abs(sectionProgress({ top: 150, height: 600 }, 900) - 0.5) < 1e-9)

// canPinStage — a stage may only pin if its content fits the viewport it is
// being pinned to. The process section is 697px tall; on a 1536×640 laptop
// viewport it was pinned anyway and the sticky box, being 100vh with
// overflow:hidden and its content centred, cut ~29px off the top of the
// heading and the same off the bottom of the step list.
const fits = { reduced: false, wide: true, contentH: 500, viewportH: 900 }
assert('fitting content pins', canPinStage(fits))
assert('content taller than viewport does not pin', !canPinStage({ ...fits, contentH: 697, viewportH: 640 }))
assert('the same content pins on a taller viewport', canPinStage({ ...fits, contentH: 697, viewportH: 900 }))
assert('content exactly as tall as the viewport does not pin',
  !canPinStage({ ...fits, contentH: 640, viewportH: 640 }))
assert('reduced motion never pins', !canPinStage({ ...fits, reduced: true }))
assert('narrow never pins', !canPinStage({ ...fits, wide: false }))
assert('unmeasured content does not pin', !canPinStage({ ...fits, contentH: 0 }))
assert('viewportless environment does not pin', !canPinStage({ ...fits, viewportH: 0 }))

// deckHead — the format deck's travel. Six panels, five transitions between them.
assert('deck starts held on the first panel', deckHead(0, 6) === 0)
assert('deck stays held through the opening half-band', deckHead(0.5 / 6, 6) === 0)
assert('deck ends held on the last panel', deckHead(1, 6) === 5)
assert('deck is still held at the closing half-band', deckHead(5.5 / 6, 6) === 5)
// Every rail click has to land on a whole panel: goToStep scrolls to (i + .5) / steps.
for (let i = 0; i < 6; i++) {
  assert(`rail click ${i} centres panel ${i}`, Math.abs(deckHead((i + 0.5) / 6, 6) - i) < 1e-9)
}
assert('the middle of the travel sits between two panels', Math.abs(deckHead(0.5, 6) - 2.5) < 1e-9)
assert('deck never overshoots the last panel', deckHead(1.9, 6) === 5)
assert('deck never undershoots the first', deckHead(-0.9, 6) === 0)
assert('a one-panel deck degenerates safely', deckHead(0.42, 1) === 0)
assert('a zero-panel deck does not divide by zero', Number.isFinite(deckHead(0.42, 0)))

console.log(`\n${failures === 0 ? '✅ ALL SCROLL-MATH TESTS PASSED' : `❌ ${failures} ASSERTION(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
