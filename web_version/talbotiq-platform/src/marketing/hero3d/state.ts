/**
 * The hero scene's animation contract.
 *
 * Same performance model as features/intro: GSAP mutates plain objects, one
 * `useFrame` per node reads them and writes to materials, and nothing here is
 * React state or an R3F-owned object — so the whole sequence plays at zero
 * re-renders. `ScalarRef` is reused from the intro's contract rather than
 * redeclared, because two definitions of the same idea is how they drift.
 *
 * This module touches three, so it must only ever be reached through the
 * dynamic import in HeroStage.
 */
import * as THREE from 'three'

import { scalar, type ScalarRef } from '@/features/intro/contract'

export type HeroCamProxy = {
  position: THREE.Vector3
  lookAt: THREE.Vector3
  fov: ScalarRef
  /** 0..1 handheld float. Small here — the hero is a composition, not a shot. */
  float: ScalarRef
  /** Dutch roll. Held at 0 throughout; present so the intro's CameraRig, which
   *  is reused verbatim rather than reimplemented, accepts this proxy. */
  dutch: ScalarRef
}

export type HeroFxProxy = {
  bloom: ScalarRef
  focusDistance: ScalarRef
  bokeh: ScalarRef
  /** Unused by the hero's post stack; present for structural parity with the
   *  intro's fx proxy so the two can share types and reviewers can read one
   *  shape. Chromatic aberration fringed the footage panel and was dropped. */
  aberration: ScalarRef
}

export type HeroRefs = {
  world: { time: ScalarRef }
  /** 0..1 master fade from near-black. Gates every emissive in the scene. */
  rise: ScalarRef
  /** 0..1 assemble progress — panels/ribbons travel from scatter to place. */
  assemble: ScalarRef
  /** 0..1 how locked the signal structure is. Drives its own emissive. */
  resolve: ScalarRef

  /* ── The live signal, shared with HeroIntelligence ───────────────────────
     `speak` rises while the machine is listening (the waveform has energy),
     `think` rises while it is thinking (the structure contracts and pulses),
     `score` rises while it is scoring (panels light and hold their value).
     Three scalars rather than an enum so transitions can cross-fade instead of
     cutting — a hard switch between states reads as a state machine, and the
     point is that it should read as attention moving. */
  speak: ScalarRef
  think: ScalarRef
  score: ScalarRef

  /* ── Cursor ──────────────────────────────────────────────────────────────
     Pointer in normalised scene space (-1..1), plus how present it is. `grav`
     falls to zero when the pointer leaves, so the gravitational response
     releases rather than freezing mid-pull. */
  pointer: THREE.Vector2
  grav: ScalarRef
}

export type HeroState = {
  cam: HeroCamProxy
  fx: HeroFxProxy
  refs: HeroRefs
}

export function createHeroState(): HeroState {
  return {
    cam: {
      position: new THREE.Vector3(),
      lookAt: new THREE.Vector3(),
      fov: scalar(46),
      float: scalar(0),
      dutch: scalar(0),
    },
    fx: {
      bloom: scalar(0),
      focusDistance: scalar(8.6),
      bokeh: scalar(5.2),
      aberration: scalar(0),
    },
    refs: {
      world: { time: scalar(0) },
      rise: scalar(0),
      assemble: scalar(0),
      resolve: scalar(0),
      speak: scalar(0),
      think: scalar(0),
      score: scalar(0),
      pointer: new THREE.Vector2(0, 0),
      grav: scalar(0),
    },
  }
}
