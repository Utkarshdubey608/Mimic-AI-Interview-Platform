/**
 * The hero's opening sequence: one GSAP timeline, created paused, played once
 * when the scene has drawn its first frame.
 *
 * It ENDS. There is no repeat, no yoyo and no idle camera loop — the only thing
 * still moving after `rest` is the ambient drift and whatever the live signal is
 * doing, both of which are describing something. A hero that keeps performing
 * after it has arrived is asking for attention it has already been given.
 */
import { gsap } from 'gsap'

import { HERO_BEATS, HERO_CAMERA, HERO_DOF, HERO_POST } from './constants'
import type { HeroState } from './state'

export type HeroTimelineCtx = {
  state: HeroState
  /** Fired as each beat lands, so the DOM copy can stagger in with the scene. */
  onBeat: (beat: keyof typeof HERO_BEATS) => void
}

export function buildHeroTimeline({ state, onBeat }: HeroTimelineCtx): gsap.core.Timeline {
  const { cam, fx, refs } = state

  /* Frame zero, set explicitly so a StrictMode double-mount rebuilds cleanly
     rather than resuming from wherever the previous timeline stopped. */
  cam.position.set(...HERO_CAMERA.open.position)
  cam.lookAt.set(...HERO_CAMERA.open.lookAt)
  cam.fov.value = HERO_CAMERA.open.fov
  cam.float.value = 0
  fx.bloom.value = 0
  fx.focusDistance.value = HERO_DOF.openFocus
  fx.bokeh.value = HERO_DOF.openBokeh
  refs.rise.value = 0
  refs.assemble.value = 0
  refs.resolve.value = 0

  const tl = gsap.timeline({ paused: true })

  for (const label of ['rise', 'assemble', 'resolve', 'copy', 'rest'] as const) {
    tl.addLabel(label, HERO_BEATS[label])
    tl.call(() => onBeat(label), undefined, HERO_BEATS[label])
  }

  /* ── rise ── Ambient light and the drift field come up out of near-black.
     Nothing structural is visible yet; this beat exists so the scene has a
     floor to arrive onto, and it is short because it is not interesting. */
  tl.to(refs.rise, { value: 1, duration: 0.9, ease: 'sine.out' }, HERO_BEATS.rise)
  tl.to(fx.bloom, { value: HERO_POST.bloomRest, duration: 0.9, ease: 'sine.out' }, HERO_BEATS.rise)

  /* ── assemble ── Panels, ribbons and orbs travel from a shallow scatter into
     their places while the camera eases forward and the lens racks from a wide
     soft field onto the footage plane. One continuous move, `power2.out`, so it
     decelerates into the composition instead of stopping at it. */
  tl.to(refs.assemble, { value: 1, duration: 1.35, ease: 'power2.out' }, HERO_BEATS.assemble)
  tl.to(cam.position, {
    x: HERO_CAMERA.resolved.position[0],
    y: HERO_CAMERA.resolved.position[1],
    z: HERO_CAMERA.resolved.position[2],
    duration: 1.65, ease: 'power2.out',
  }, HERO_BEATS.assemble)
  tl.to(cam.lookAt, {
    x: HERO_CAMERA.resolved.lookAt[0],
    y: HERO_CAMERA.resolved.lookAt[1],
    z: HERO_CAMERA.resolved.lookAt[2],
    duration: 1.65, ease: 'power2.out',
  }, HERO_BEATS.assemble)
  tl.to(cam.fov, { value: HERO_CAMERA.resolved.fov, duration: 1.65, ease: 'power2.out' }, HERO_BEATS.assemble)
  tl.to(fx.focusDistance, { value: HERO_DOF.restFocus, duration: 1.4, ease: 'power2.inOut' }, HERO_BEATS.assemble + 0.15)
  tl.to(fx.bokeh, { value: HERO_DOF.restBokeh, duration: 1.4, ease: 'power2.inOut' }, HERO_BEATS.assemble + 0.15)

  /* ── resolve ── The structure locks. Bloom lifts once and comes back down:
     a single breath, not a flash. `back.out` on the resolve gives it the tiny
     overshoot that makes a mechanism feel like it seated rather than faded. */
  tl.to(refs.resolve, { value: 1, duration: 0.85, ease: 'back.out(1.2)' }, HERO_BEATS.resolve)
  tl.to(fx.bloom, { value: HERO_POST.bloomResolve, duration: 0.28, ease: 'power2.out' }, HERO_BEATS.resolve + 0.1)
  tl.to(fx.bloom, { value: HERO_POST.bloomRest, duration: 0.95, ease: 'power2.inOut' }, HERO_BEATS.resolve + 0.38)

  /* ── rest ── The float settles to a value it keeps. Small: 0.1 is a room
     breathing, 0.4 is a handheld camera, and this is a product page. */
  tl.to(cam.float, { value: 0.1, duration: 1.1, ease: 'sine.inOut' }, HERO_BEATS.resolve)

  return tl
}
