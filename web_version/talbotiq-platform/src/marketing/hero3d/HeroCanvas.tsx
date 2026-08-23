/**
 * The hero's WebGL surface.
 *
 * Mirrors IntroCanvas: `flat` so the renderer's own tone mapping is off and HDR
 * emissive survives into Bloom, ACES applied explicitly in the post stack, and
 * every per-frame value written through the mutable proxies so the whole
 * sequence plays at zero React re-renders.
 *
 * `alpha: true` — unlike the intro film, this canvas sits INSIDE a styled panel
 * that already has the ink field and its CSS gradients behind it. Painting an
 * opaque background here would cover the design the scene is supposed to be
 * lighting.
 *
 * This module is only ever reached through the dynamic import in HeroStage. It
 * pulls three, R3F and the post stack, none of which may enter the marketing
 * entry chunk.
 */
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, DepthOfField, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, type BloomEffect, type DepthOfFieldEffect, ToneMappingMode } from 'postprocessing'
import { gsap } from 'gsap'
import * as THREE from 'three'

import { CameraRig } from '@/features/intro/scene/CameraRig'
import {
  HERO_CAMERA, HERO_DOF, HERO_POST, HERO_COUNTS,
  SIGNAL_DWELL, SIGNAL_ORDER, type HeroTier, type SignalState,
} from './constants'
import { InkFluid } from './InkFluid'
import { SignalScene } from './SignalScene'
import { createHeroState } from './state'
import { buildHeroTimeline } from './timeline'

const MAX_DELTA = 1 / 30

export type HeroCanvasProps = {
  tier: HeroTier
  /** The hero panel. Pointer listeners bind HERE, not to the canvas: the canvas
   *  is `pointer-events: none` so it can never swallow a click meant for a CTA,
   *  and an element that receives no pointer events also fires no pointermove. */
  hostRef: React.RefObject<HTMLElement | null>
  colors: { ink: THREE.Color; ai: THREE.Color; accent: THREE.Color }
  /** Called on the first drawn frame, so the shell can cross-fade the canvas in. */
  onFirstFrame?: () => void
  /** Called as each beat lands, so the DOM copy staggers with the scene. */
  onBeat?: (beat: string) => void
  /** 'never' parks the loop when the hero is off screen or the tab is behind. */
  frameloop?: 'always' | 'never'
}

/**
 * The hero's post stack. Deliberately NOT the intro's Effects component: that
 * one runs SSAO and a normal pass at the high tier, which buys contact shadows
 * this scene has no use for — everything in it is transparent or additive — at
 * the cost of an extra full-screen pass in the first viewport of the most-read
 * page on the site. Bloom, DOF, ACES, vignette, grain. Nothing else.
 */
function HeroEffects({ fx, tier }: { fx: ReturnType<typeof createHeroState>['fx']; tier: HeroTier }) {
  const bloomRef = useRef<BloomEffect>(null)
  const dofRef = useRef<DepthOfFieldEffect>(null)

  useFrame(() => {
    const bloom = bloomRef.current
    if (bloom) bloom.intensity = fx.bloom.value
    const dof = dofRef.current
    if (dof) {
      dof.bokehScale = fx.bokeh.value
      dof.cocMaterial.worldFocusDistance = fx.focusDistance.value
    }
  })

  return (
    <EffectComposer multisampling={tier === 'high' ? 2 : 0} enableNormalPass={false}>
      <DepthOfField
        ref={dofRef}
        worldFocusDistance={HERO_DOF.openFocus}
        worldFocusRange={tier === 'high' ? 6 : 9}
        bokehScale={HERO_DOF.openBokeh}
      />
      <Bloom
        ref={bloomRef as never}
        mipmapBlur
        intensity={0}
        luminanceThreshold={0.62}
        luminanceSmoothing={0.28}
        levels={tier === 'high' ? 6 : 4}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={HERO_POST.vignette.offset} darkness={HERO_POST.vignette.darkness} eskil={false} />
      <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={HERO_POST.grain} />
    </EffectComposer>
  )
}

/**
 * Drives everything that is not a GSAP tween: the film clock, the pointer, and
 * the live signal.
 *
 * The signal is the part worth reading. HeroIntelligence, the DOM rail under the
 * footage, already cycles the product's three real machine states on a fixed
 * dwell. This runs the SAME order on the SAME dwells and cross-fades three
 * scalars, so the scene and the rail are one instrument — the structure is
 * thinking at the moment the rail says "Thinking". Cross-fades rather than an
 * enum because a hard switch reads as a state machine, and what this should read
 * as is attention moving.
 */
function Driver({ state, hostRef, onFirstFrame }: {
  state: ReturnType<typeof createHeroState>
  hostRef: React.RefObject<HTMLElement | null>
  onFirstFrame?: () => void
}) {
  const { refs } = state
  const drawn = useRef(false)
  const phase = useRef({ index: 0, t: 0 })

  /* Pointer is read off the hero PANEL rather than R3F's own pointer state:
     R3F only updates that on raycast-relevant events and the ink needs every
     move, and the canvas itself is pointer-events:none so it receives none.
     Bound to the panel, so it costs nothing while the reader is anywhere else
     on the page. */
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    let raf = 0
    let pending: { x: number; y: number } | null = null

    const flush = () => {
      raf = 0
      if (!pending) return
      refs.pointer.set(pending.x, pending.y)
      pending = null
    }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      pending = {
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: -(((e.clientY - r.top) / r.height) * 2 - 1),
      }
      // Coalesce to one write per frame: a high-polling-rate mouse fires far
      // more often than the renderer draws.
      if (!raf) raf = requestAnimationFrame(flush)
    }
    const onEnter = () => gsap.to(refs.grav, { value: 1, duration: 0.5, ease: 'sine.out' })
    const onLeave = () => gsap.to(refs.grav, { value: 0, duration: 0.9, ease: 'sine.inOut' })

    el.addEventListener('pointermove', onMove, { passive: true })
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointerleave', onLeave)
      gsap.killTweensOf(refs.grav)
    }
  }, [hostRef, refs])

  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_DELTA)
    refs.world.time.value += dt

    /* The signal state machine, advanced on the render clock so it pauses with
       the loop instead of running on in a hidden tab. */
    const p = phase.current
    const current: SignalState = SIGNAL_ORDER[p.index]
    p.t += dt * 1000
    if (p.t >= SIGNAL_DWELL[current]) {
      p.t = 0
      p.index = (p.index + 1) % SIGNAL_ORDER.length
    }
    const next: SignalState = SIGNAL_ORDER[p.index]
    /* Ease each scalar toward its target rather than setting it: the approach IS
       the cross-fade, and one lerp is cheaper than three tweens. */
    const k = 1 - Math.exp(-dt * 3.2)
    refs.speak.value += ((next === 'listening' ? 1 : 0) - refs.speak.value) * k
    refs.think.value += ((next === 'thinking' ? 1 : 0) - refs.think.value) * k
    refs.score.value += ((next === 'scoring' ? 1 : 0) - refs.score.value) * k

    if (!drawn.current) {
      drawn.current = true
      onFirstFrame?.()
    }
  })

  return null
}

export function HeroCanvas({ tier, hostRef, colors, onFirstFrame, onBeat, frameloop = 'always' }: HeroCanvasProps) {
  const state = useMemo(() => createHeroState(), [])

  /* The timeline is built and played here rather than in the shell, so it cannot
     start before a GL context exists. Killed on unmount — a live GSAP timeline
     mutating a disposed scene's proxies is a leak that only shows up as a
     mysterious frame after navigation. */
  useEffect(() => {
    const tl = buildHeroTimeline({ state, onBeat: (b) => onBeat?.(b) })
    tl.play()
    return () => { tl.kill() }
  }, [state, onBeat])

  return (
    <Canvas
      flat
      frameloop={frameloop}
      dpr={[1, HERO_COUNTS[tier].dpr]}
      gl={{
        antialias: false,        // the composer multisamples; doing both is waste
        alpha: true,             // the CSS field behind must show through
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
      }}
      camera={{
        position: [...HERO_CAMERA.open.position],
        fov: HERO_CAMERA.open.fov,
        near: 0.1,
        far: 40,
      }}
      style={{ pointerEvents: 'none' }}
      /* Nothing in this scene is clickable and the copy and CTAs sit above it;
         the canvas must never eat a pointer event meant for a button. The
         pointer listeners in Driver are attached directly and are passive, so
         they still fire. */
      onCreated={({ gl }) => { gl.domElement.style.pointerEvents = 'none' }}
    >
      <Suspense fallback={null}>
        <SignalScene state={state} tier={tier} colors={colors} />
        <InkFluid state={state} tier={tier} color={colors.ai} />
      </Suspense>
      <CameraRig cam={state.cam} time={state.refs.world.time} />
      <HeroEffects fx={state.fx} tier={tier} />
      <Driver state={state} hostRef={hostRef} onFirstFrame={onFirstFrame} />
    </Canvas>
  )
}
