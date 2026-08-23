/**
 * The ink trail — a fluid, not a particle system.
 *
 * A trail of sprites following the cursor always reads cheap, because real ink
 * does two things sprites cannot: it advects (the tail keeps moving after the
 * cursor has gone, carried by the flow it created) and it diffuses (edges soften
 * and the mass thins rather than each dot fading in place). Both of those come
 * free from advecting a dye field.
 *
 * This is a deliberately reduced fluid: dye advection with a velocity field
 * derived from cursor motion plus curl noise, and NO pressure projection. Full
 * Navier–Stokes wants ~20 passes a frame for the incompressibility solve, and
 * the visible difference here — against a dark ground, at 25% opacity, behind
 * glass — does not survive the first screenshot. What is kept is what reads:
 * momentum, curl, decay.
 *
 * Two render targets, ping-ponged, one pass per frame at 256² (128² on the
 * lower tier). That is a fraction of the cost of the panels above it.
 *
 * The dye plane lives BETWEEN the core and the panels, so the glass in front
 * occludes and refracts the ink — which is what the brief means by the trail
 * bending around the scene. An HTML overlay could not do that at any price.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { HERO_COUNTS, type HeroTier } from './constants'
import type { HeroState } from './state'

/** Where the dye sits, in world z. In front of the core, behind the panels. */
const INK_Z = -0.05

export function InkFluid({ state, tier, color }: {
  state: HeroState
  tier: HeroTier
  color: THREE.Color
}) {
  const res = HERO_COUNTS[tier].inkRes
  const gl = useThree((s) => s.gl)
  const { refs } = state

  const plane = useRef<THREE.Mesh>(null)

  /* ── The simulation ─────────────────────────────────────────────────────
     Half-float so the dye can hold values below 1/255 and still decay
     smoothly; on an 8-bit target a slow fade banks into visible steps. */
  const sim = useMemo(() => {
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    } as const
    const a = new THREE.WebGLRenderTarget(res, res, opts)
    const b = new THREE.WebGLRenderTarget(res, res, opts)

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: null as THREE.Texture | null },
        uCursor: { value: new THREE.Vector2(0.5, 0.5) },
        uPrevCursor: { value: new THREE.Vector2(0.5, 0.5) },
        uForce: { value: 0 },
        uTime: { value: 0 },
        uDt: { value: 0 },
        uAspect: { value: 1 },
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      ].join('\n'),
      fragmentShader: [
        'precision highp float;',
        'uniform sampler2D uPrev;',
        'uniform vec2 uCursor, uPrevCursor;',
        'uniform float uForce, uTime, uDt, uAspect;',
        'varying vec2 vUv;',

        // Curl noise, cheap: two offset value-noise samples differentiated.
        // This is what stops the dye travelling in straight lines — real ink in
        // water curls because the flow around it is rotational.
        'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
        'float vnoise(vec2 p){',
        '  vec2 i = floor(p), f = fract(p);',
        '  f = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),',
        '             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);',
        '}',
        'vec2 curl(vec2 p){',
        '  float e = 0.06;',
        '  float n1 = vnoise(p + vec2(0.0, e));',
        '  float n2 = vnoise(p - vec2(0.0, e));',
        '  float n3 = vnoise(p + vec2(e, 0.0));',
        '  float n4 = vnoise(p - vec2(e, 0.0));',
        '  return vec2(n1 - n2, n4 - n3) / (2.0 * e);',
        '}',

        // Distance from a point to the cursor's travel segment this frame. A
        // segment, not a point: at speed, splatting only at the new position
        // leaves a dotted line.
        'float segDist(vec2 p, vec2 a, vec2 b){',
        '  vec2 pa = p - a, ba = b - a;',
        '  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);',
        '  return length(pa - ba * h);',
        '}',

        'void main() {',
        '  vec2 uv = vUv;',
        // Aspect-correct so a circular splat stays circular on a wide hero.
        '  vec2 asp = vec2(uAspect, 1.0);',

        // ── Velocity field.
        // Away from the cursor it is pure curl (ambient turbulence). Near the
        // cursor, the cursor's own motion dominates, falling off with distance —
        // so dragging pushes the ink and the ink keeps going afterwards.
        '  vec2 flow = curl(uv * 3.4 + uTime * 0.05) * 0.55;',
        '  vec2 drag = (uCursor - uPrevCursor) * asp;',
        '  float dSeg = segDist(uv * asp, uPrevCursor * asp, uCursor * asp);',
        '  float near = exp(-dSeg * 9.0);',
        '  vec2 vel = flow + drag * near * 42.0;',
        // A gentle upward bias, because ink in water rises. Small, but it is
        // the difference between a trail and a plume.
        '  vel.y += 0.16;',

        // ── Advect: sample the previous frame from where this fluid came from.
        '  vec2 src = uv - vel * uDt * 0.42;',
        '  vec4 prev = texture2D(uPrev, src);',

        // ── Diffuse, cheaply: a 4-tap blur toward the neighbours. This is what
        //    softens the edge into smoke instead of a hard-edged smear.
        '  float px = 1.0 / 256.0;',
        '  vec4 blur = (',
        '      texture2D(uPrev, src + vec2( px, 0.0))',
        '    + texture2D(uPrev, src + vec2(-px, 0.0))',
        '    + texture2D(uPrev, src + vec2(0.0,  px))',
        '    + texture2D(uPrev, src + vec2(0.0, -px))',
        '  ) * 0.25;',
        '  vec4 carried = mix(prev, blur, 0.16);',

        // ── Decay. Exponential and frame-rate independent, so the tail is the
        //    same length at 60fps and 144fps.
        '  carried *= exp(-uDt * 1.9);',

        // ── Splat along the segment the cursor travelled.
        '  float add = exp(-dSeg * 44.0) * uForce;',
        '  carried.r += add;',
        // Channel g carries AGE, advected with the dye: the display pass reads
        // it to shift older ink cooler and dimmer, which is what makes the tail
        // read as dissipating rather than merely thinning.
        '  carried.g = max(carried.g * exp(-uDt * 0.55), add);',

        '  gl_FragColor = clamp(carried, 0.0, 4.0);',
        '}',
      ].join('\n'),
    })

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    quad.frustumCulled = false
    scene.add(quad)

    return { a, b, material, scene, camera, quad, read: a, write: b }
  }, [res])

  /* ── The display material ───────────────────────────────────────────────
     Reads the dye and paints it as cyan ink: bright core, cooler halo, and a
     bloom that the post stack picks up because the values go above 1. */
  const display = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uDye: { value: null as THREE.Texture | null },
      uColor: { value: color.clone() },
      uRise: { value: 0 },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uDye;',
      'uniform vec3 uColor;',
      'uniform float uRise;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec4 d = texture2D(uDye, vUv);',
      '  float ink = d.r;',
      '  float age = d.g;',
      // Two-part response: a tight bright core and a wide soft bloom. The core
      // is what follows the cursor; the bloom is what makes it feel wet.
      '  float core = smoothstep(0.10, 0.75, ink);',
      '  float halo = smoothstep(0.02, 0.5, ink) * 0.20;',
      // Older ink desaturates toward the ground rather than turning grey, so
      // the tail dies into the room instead of onto it.
      '  float fresh = clamp(age * 2.2, 0.0, 1.0);',
      '  vec3 col = uColor * (0.55 + fresh * 0.85);',
      '  float a = (core * 0.34 + halo) * uRise;',
      '  gl_FragColor = vec4(col * a, a * 0.85);',
      '}',
    ].join('\n'),
  }), [color])

  /* Both targets start black, or the first advected frame samples uninitialised
     memory and the hero opens with a grey wash. */
  useEffect(() => {
    const prevTarget = gl.getRenderTarget()
    for (const t of [sim.a, sim.b]) {
      gl.setRenderTarget(t)
      gl.setClearColor(0x000000, 0)
      gl.clear(true, false, false)
    }
    gl.setRenderTarget(prevTarget)
  }, [gl, sim])

  useEffect(() => () => {
    sim.a.dispose()
    sim.b.dispose()
    sim.material.dispose()
    sim.quad.geometry.dispose()
    display.dispose()
  }, [sim, display])

  const prevCursor = useRef(new THREE.Vector2(0.5, 0.5))
  const swap = useRef(false)

  useFrame(({ camera, size }, delta) => {
    const dt = Math.min(delta, 1 / 30)

    /* Pointer arrives as -1..1 scene space; the dye works in 0..1 UV. */
    const cx = refs.pointer.x * 0.5 + 0.5
    const cy = refs.pointer.y * 0.5 + 0.5

    const u = sim.material.uniforms
    u.uPrev.value = (swap.current ? sim.b : sim.a).texture
    u.uPrevCursor.value.copy(prevCursor.current)
    u.uCursor.value.set(cx, cy)
    /* Force follows presence, so the ink stops being laid down the moment the
       pointer leaves and the existing dye advects away on its own. */
    u.uForce.value = refs.grav.value * 0.55
    u.uTime.value = refs.world.time.value
    u.uDt.value = dt
    u.uAspect.value = size.width / Math.max(size.height, 1)

    const target = swap.current ? sim.a : sim.b
    const prevTarget = gl.getRenderTarget()
    const prevAuto = gl.autoClear
    gl.autoClear = false
    gl.setRenderTarget(target)
    gl.render(sim.scene, sim.camera)
    gl.setRenderTarget(prevTarget)
    gl.autoClear = prevAuto

    display.uniforms.uDye.value = target.texture
    display.uniforms.uRise.value = refs.rise.value

    prevCursor.current.set(cx, cy)
    swap.current = !swap.current

    /* Keep the dye plane exactly filling the frustum at its depth, every frame,
       because the camera dollies during the opening sequence. Oversizing it
       instead would cost fill rate on the most-viewed page on the site. */
    const mesh = plane.current
    if (mesh) {
      const persp = camera as THREE.PerspectiveCamera
      const dist = Math.abs(camera.position.z - INK_Z)
      const h = 2 * dist * Math.tan(((persp.fov ?? 40) * Math.PI) / 360)
      mesh.scale.set(h * (size.width / Math.max(size.height, 1)), h, 1)
      mesh.position.set(camera.position.x, camera.position.y, INK_Z)
    }
  })

  return (
    <mesh ref={plane} material={display} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}
