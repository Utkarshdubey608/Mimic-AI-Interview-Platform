/**
 * The signal — the hero's 3D centrepiece.
 *
 * What this is NOT: a particle field with a logo in it. Every element here is
 * driven by one of three scalars that mirror the product's real machine states,
 * the same three the rail under the footage already shows. So when the structure
 * contracts and pulses, the model is thinking; when the ring has energy, it is
 * listening; when the panels light and hold, it is scoring. The cinematic layer
 * describes the mechanism, which is the only thing this site is allowed to claim.
 *
 * Composition, back to front:
 *   spill     soft light behind the DOM footage panel, so the footage in front
 *             of this canvas reads as lit by this room
 *   motes     ambient drift — the depth cue that makes everything else read 3D
 *   ribbons   flowing tubes carrying light toward the structure
 *   core      the signal itself; noise-displaced, breathing on `think`
 *   waveform  instanced bars round the core, energy from `speak`
 *   panels    translucent interface surfaces, orbiting, refracting
 *
 * Nothing spins freely. Every rotation is bounded and slow, and the cursor's
 * gravitational pull is capped and falls off with distance, because a scene that
 * reacts hugely to the mouse is a toy.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { HERO_COUNTS, type HeroTier } from './constants'
import type { HeroState } from './state'

type SceneProps = {
  state: HeroState
  tier: HeroTier
  /** Read off the stylesheet at arm time, never hardcoded here. */
  colors: { ink: THREE.Color; ai: THREE.Color; accent: THREE.Color }
}

const TMP = new THREE.Vector3()
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3)

/* ── Ambient motes ─────────────────────────────────────────────────────────
   Additive points on a slow drift. They exist for depth: without something
   sparse and unfocused between the camera and the structure, the panels read as
   stickers on glass rather than objects in a room. */
function Motes({ state, tier, colors }: SceneProps) {
  const count = HERO_COUNTS[tier].motes
  const { refs } = state

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      // A shallow slab, wider than tall, biased behind the structure so the
      // drift reads as atmosphere rather than confetti in front of the copy.
      pos[i * 3] = (Math.random() - 0.5) * 13
      pos[i * 3 + 1] = (Math.random() - 0.5) * 6.5
      pos[i * 3 + 2] = -Math.random() * 7 - 0.2
      seed[i] = Math.random()
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    return g
  }, [count])

  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uRise: { value: 0 },
      uColor: { value: colors.ai.clone() },
      uPointer: { value: new THREE.Vector2() },
      uGrav: { value: 0 },
      uPix: { value: 1 },
    },
    vertexShader: [
      'attribute float aSeed;',
      'uniform float uTime, uGrav, uPix;',
      'uniform vec2 uPointer;',
      'varying float vFade;',
      'void main() {',
      '  vec3 p = position;',
      // Independent per-axis drift, so the field never reads as one sheet
      // translating. Slow: this is dust, not snow.
      '  p.x += sin(uTime * 0.11 + aSeed * 24.0) * 0.34;',
      '  p.y += cos(uTime * 0.09 + aSeed * 17.0) * 0.26;',
      '  p.z += sin(uTime * 0.07 + aSeed * 31.0) * 0.20;',
      // Gravitational response: motes near the cursor drift toward it, and the
      // pull decays with distance so the field bends locally instead of the
      // whole cloud lurching.
      '  vec2 toCursor = uPointer * 3.6 - p.xy;',
      '  float d = length(toCursor);',
      '  p.xy += normalize(toCursor + 1e-5) * uGrav * 0.42 * exp(-d * 0.55);',
      '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
      '  gl_Position = projectionMatrix * mv;',
      // Nearer motes are larger and brighter — the only honest way to read
      // depth from unlit points.
      '  float depth = clamp(1.0 - (-mv.z) / 9.0, 0.0, 1.0);',
      '  gl_PointSize = (0.9 + aSeed * 1.5) * depth * uPix * 2.2;',
      '  vFade = depth * (0.22 + aSeed * 0.5);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor;',
      'uniform float uRise;',
      'varying float vFade;',
      'void main() {',
      // Round, soft-edged, no texture fetch.
      '  vec2 c = gl_PointCoord - 0.5;',
      '  float a = smoothstep(0.5, 0.06, length(c));',
      '  gl_FragColor = vec4(uColor, a * vFade * uRise);',
      '}',
    ].join('\n'),
  }), [colors.ai])

  useFrame(({ size }) => {
    mat.uniforms.uTime.value = refs.world.time.value
    mat.uniforms.uRise.value = refs.rise.value
    mat.uniforms.uGrav.value = refs.grav.value
    mat.uniforms.uPointer.value.copy(refs.pointer)
    mat.uniforms.uPix.value = Math.min(size.height / 900, 1.6)
  })

  return <points geometry={geom} material={mat} frustumCulled={false} />
}

/* ── Glass panels ──────────────────────────────────────────────────────────
   Translucent interface surfaces. `meshPhysicalMaterial` with transmission
   rather than drei's MeshTransmissionMaterial: the latter renders its own buffer
   per material, which at seven panels is seven extra passes in the first
   viewport of the most-visited page on the site. Physical transmission is one
   pass and, against this dark ground under a rim light, indistinguishable. */
function Panels({ state, tier, colors }: SceneProps) {
  const count = HERO_COUNTS[tier].panels
  const { refs } = state
  const group = useRef<THREE.Group>(null)

  const layout = useMemo(() => (
    Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + 0.6
      const radius = 1.62 + (i % 3) * 0.42
      return {
        // Resting place: a loose ring, tilted — never a tidy carousel.
        rest: new THREE.Vector3(
          Math.cos(a) * radius,
          Math.sin(a * 1.7) * 0.62 + (i % 2 ? 0.16 : -0.2),
          Math.sin(a) * radius * 0.55 - 0.35,
        ),
        // Where it starts: further out and further back, so assembling reads as
        // travel through depth rather than as a scale-up.
        from: new THREE.Vector3(Math.cos(a) * radius * 2.4, Math.sin(a * 1.7) * 1.9, -5.2 - i * 0.5),
        tilt: new THREE.Euler(-0.22 + (i % 3) * 0.1, a + Math.PI / 2, (i % 2 ? 1 : -1) * 0.06),
        w: 0.92 + (i % 3) * 0.3,
        h: 0.6 + (i % 2) * 0.22,
        phase: i * 0.7,
        delay: (i / count) * 0.32,
      }
    })
  ), [count])

  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: colors.ink.clone().lerp(colors.accent, 0.18),
    transparent: true,
    opacity: 0,
    transmission: 0.55,
    thickness: 0.3,
    roughness: 0.16,
    metalness: 0,
    ior: 1.38,
    // A cool sheen so edges catch the rim light — this sells glass against a
    // near-black ground more than transmission does.
    sheen: 0.6,
    sheenColor: colors.accent.clone(),
    sheenRoughness: 0.5,
    emissive: colors.ai.clone(),
    emissiveIntensity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  }), [colors])

  useFrame(() => {
    const g = group.current
    if (!g) return
    const t = refs.world.time.value
    const asm = refs.assemble.value
    const res = refs.resolve.value

    for (let i = 0; i < g.children.length; i++) {
      const child = g.children[i]
      const L = layout[i]
      if (!L) continue
      // Staggered arrival: each panel runs its own eased sub-window of the
      // master assemble, so they land in sequence rather than in formation.
      const local = easeOut((asm - L.delay) / (1 - L.delay))
      TMP.copy(L.from).lerp(L.rest, local)

      // Idle breathing, and the cursor's local pull. Both deliberately tiny.
      TMP.y += Math.sin(t * 0.5 + L.phase) * 0.045 * local
      const dx = refs.pointer.x * 3.4 - TMP.x
      const dy = refs.pointer.y * 2.1 - TMP.y
      const d = Math.hypot(dx, dy)
      const pull = refs.grav.value * 0.2 * Math.exp(-d * 0.7)
      TMP.x += dx * pull
      TMP.y += dy * pull

      child.position.copy(TMP)
      child.rotation.set(L.tilt.x, L.tilt.y + Math.sin(t * 0.16 + L.phase) * 0.06, L.tilt.z)
      child.scale.setScalar(0.6 + local * 0.4)
    }

    // One material for every panel, so this is a single write per frame. Panels
    // are faintest while assembling and settle to a readable sheen; `score`
    // lifts their emissive, which is the moment they mean something.
    /* Much lower than the first pass, which put a milky mass across the body
       copy and made it unreadable. Glass on a near-black ground needs almost no
       opacity to read as glass — what sells it is the sheen on the edge, and the
       edge is unaffected by this number. */
    mat.opacity = 0.05 + asm * 0.11 + res * 0.035
    mat.emissiveIntensity = res * (0.05 + refs.score.value * 0.18)
    // A whole-group counter-rotation, slow enough to be felt and not watched.
    g.rotation.y = Math.sin(t * 0.045) * 0.12
  })

  return (
    <group ref={group}>
      {layout.map((L, i) => (
        <mesh key={i} material={mat}>
          <planeGeometry args={[L.w, L.h, 1, 1]} />
        </mesh>
      ))}
    </group>
  )
}

/* ── The core ──────────────────────────────────────────────────────────────
   The signal itself: an icosahedron displaced by noise, so it reads as
   something with internal activity rather than a lit ball. It contracts and
   brightens on `think` — the machine working is the one moment this scene is
   allowed to be dramatic about. */
function Core({ state, colors }: SceneProps) {
  const { refs } = state
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uRise: { value: 0 },
      uResolve: { value: 0 },
      uThink: { value: 0 },
      uScore: { value: 0 },
      uAi: { value: colors.ai.clone() },
      uAccent: { value: colors.accent.clone() },
    },
    vertexShader: [
      'uniform float uTime, uThink, uResolve;',
      'varying float vRim;',
      'varying float vNoise;',
      // Cheap 3D value noise — enough for a living surface, no texture fetch.
      'float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }',
      'float noise(vec3 p){',
      '  vec3 i = floor(p), f = fract(p);',
      '  f = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),',
      '                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),',
      '             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),',
      '                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);',
      '}',
      'void main() {',
      '  vec3 n = normalize(normal);',
      '  float wob = noise(n * 2.3 + uTime * 0.22) - 0.5;',
      '  vNoise = wob;',
      // Thinking pulls the surface IN and beats faster — effort reads as
      // compression, not expansion.
      '  float beat = sin(uTime * (1.6 + uThink * 4.2)) * (0.02 + uThink * 0.05);',
      '  float r = 1.0 + wob * (0.1 + uThink * 0.1) + beat - uThink * 0.1;',
      '  vec3 p = n * r * mix(0.55, 1.0, uResolve);',
      '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
      // Fresnel-ish rim from the view vector; the core is mostly edge.
      '  vRim = 1.0 - abs(dot(n, normalize(-mv.xyz)));',
      '  gl_Position = projectionMatrix * mv;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uRise, uResolve, uThink, uScore;',
      'uniform vec3 uAi, uAccent;',
      'varying float vRim;',
      'varying float vNoise;',
      'void main() {',
      '  float rim = pow(clamp(vRim, 0.0, 1.0), 2.1);',
      // Cyan is the machine; the cool accent is the brand. Scoring shifts the
      // mix toward the accent, so the moment it produces a judgement it stops
      // looking like a machine and starts looking like the product.
      '  vec3 col = mix(uAi, uAccent, uScore * 0.55);',
      '  float body = rim * (0.55 + uThink * 0.5) + max(vNoise, 0.0) * 0.16;',
      '  gl_FragColor = vec4(col, body * uRise * (0.16 + uResolve * 0.5));',
      '}',
    ].join('\n'),
  }), [colors])

  useFrame(() => {
    mat.uniforms.uTime.value = refs.world.time.value
    mat.uniforms.uRise.value = refs.rise.value
    mat.uniforms.uResolve.value = refs.resolve.value
    mat.uniforms.uThink.value = refs.think.value
    mat.uniforms.uScore.value = refs.score.value
  })

  return (
    <mesh material={mat} position={[0, -0.02, -0.15]}>
      <icosahedronGeometry args={[0.78, 24]} />
    </mesh>
  )
}

/* ── Waveform ring ─────────────────────────────────────────────────────────
   Instanced bars on a circle round the core, driven by `speak`. This is the
   listening state made visible, and it uses the SAME irregular profile the DOM
   rail uses, so the two read as one instrument at two scales. */
const BAR_PROFILE = [0.34, 0.62, 0.45, 0.82, 0.55, 0.95, 0.48, 0.7, 0.38, 0.88, 0.58, 0.75, 0.42, 0.66, 0.5, 0.9, 0.36, 0.6]

function Waveform({ state, tier, colors }: SceneProps) {
  const count = HERO_COUNTS[tier].bars
  const { refs } = state
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: colors.ai.clone(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), [colors.ai])

  useFrame(() => {
    const m = ref.current
    if (!m) return
    const t = refs.world.time.value
    const speak = refs.speak.value
    const asm = refs.assemble.value

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      const prof = BAR_PROFILE[i % BAR_PROFILE.length]
      // Energy travels round the ring rather than every bar pulsing together —
      // a ring that breathes in unison reads as a loading spinner.
      const travel = Math.sin(t * 2.4 - a * 3.1) * 0.5 + 0.5
      const h = 0.05 + prof * (0.04 + speak * travel * 0.3)
      const r = 1.12 + Math.sin(a * 4.0) * 0.03
      dummy.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.62, -0.2)
      dummy.rotation.set(0, 0, a + Math.PI / 2)
      dummy.scale.set(0.014, Math.max(h * asm, 0.0001), 0.014)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
    mat.opacity = refs.rise.value * (0.12 + speak * 0.3) * asm
  })

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} material={mat} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  )
}

/* ── Data ribbons ──────────────────────────────────────────────────────────
   Tubes on fixed curves with light flowing ALONG them, animated by a uniform
   rather than by rebuilding geometry. They carry the answer toward the
   structure, which is the actual data path in the product. */
function Ribbons({ state, tier, colors }: SceneProps) {
  const count = HERO_COUNTS[tier].ribbons
  const { refs } = state

  const tubes = useMemo(() => (
    Array.from({ length: count }, (_, i) => {
      const sign = i % 2 ? 1 : -1
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-3.4 * sign, -0.9 + i * 0.35, -2.6),
        new THREE.Vector3(-1.5 * sign, 0.5 - i * 0.3, -1.1),
        new THREE.Vector3(0.2 * sign, -0.15 + i * 0.16, -0.3),
        new THREE.Vector3(1.9 * sign, 0.62 - i * 0.22, -1.5),
        new THREE.Vector3(3.6 * sign, -0.5 + i * 0.3, -3.1),
      ])
      return new THREE.TubeGeometry(curve, 90, 0.0075 + i * 0.002, 6, false)
    })
  ), [count])

  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uRise: { value: 0 },
      uAssemble: { value: 0 },
      uSpeak: { value: 0 },
      uColor: { value: colors.ai.clone() },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime, uRise, uAssemble, uSpeak;',
      'uniform vec3 uColor;',
      'varying vec2 vUv;',
      'void main() {',
      // Two packets per ribbon, offset, travelling at a steady rate. Narrow
      // gaussians rather than a sawtooth, so they read as light moving through
      // a fibre and not as a marquee.
      '  float x = vUv.x;',
      '  float head = fract(uTime * 0.19);',
      '  float a = exp(-pow((x - head) * 7.0, 2.0));',
      '  float b = exp(-pow((x - fract(head + 0.5)) * 9.0, 2.0)) * 0.6;',
      // The ribbon only exists as far as the assemble has drawn it.
      '  float drawn = step(x, uAssemble * 1.05);',
      '  float glow = (a + b) * (0.5 + uSpeak * 0.7) + 0.05;',
      '  gl_FragColor = vec4(uColor, glow * drawn * uRise * 0.5);',
      '}',
    ].join('\n'),
  }), [colors.ai])

  useFrame(() => {
    mat.uniforms.uTime.value = refs.world.time.value
    mat.uniforms.uRise.value = refs.rise.value
    mat.uniforms.uAssemble.value = refs.assemble.value
    mat.uniforms.uSpeak.value = refs.speak.value
  })

  return <>{tubes.map((g, i) => <mesh key={i} geometry={g} material={mat} />)}</>
}

/* ── Light spill ───────────────────────────────────────────────────────────
   A soft cyan wash behind where the DOM footage panel sits. The footage is a
   real <video> in front of this canvas, not a texture in it — duplicating a
   5.4 MB file to win a reflection is a poor trade — so this plane is what makes
   the two layers read as one space: the room appears to light the panel sitting
   in it. */
function Spill({ state, colors }: SceneProps) {
  const { refs } = state
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uRise: { value: 0 },
      uScore: { value: 0 },
      uColor: { value: colors.ai.clone() },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    ].join('\n'),
    fragmentShader: [
      'uniform float uRise, uScore;',
      'uniform vec3 uColor;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec2 c = vUv - 0.5;',
      // Elliptical falloff, wider than tall, matching the footage panel.
      '  float d = length(vec2(c.x * 0.8, c.y * 1.5));',
      '  float a = smoothstep(0.5, 0.02, d);',
      '  gl_FragColor = vec4(uColor, a * uRise * (0.07 + uScore * 0.07));',
      '}',
    ].join('\n'),
  }), [colors.ai])

  useFrame(() => {
    mat.uniforms.uRise.value = refs.rise.value
    mat.uniforms.uScore.value = refs.score.value
  })

  return (
    <mesh material={mat} position={[1.75, 0.34, -2.4]}>
      <planeGeometry args={[3.6, 2.5]} />
    </mesh>
  )
}

/** The scene graph, plus its lighting. */
export function SignalScene(props: SceneProps) {
  const { state, colors } = props
  const { refs } = state

  // Rim + key, both cool. No warm light anywhere: the marketing dark ground is
  // a near-black indigo, and a warm key on it reads as a different brand.
  const rim = useMemo(() => {
    const l = new THREE.DirectionalLight(colors.accent.clone(), 0)
    l.position.set(-3.2, 2.1, 2.4)
    return l
  }, [colors.accent])
  const key = useMemo(() => {
    const l = new THREE.PointLight(colors.ai.clone(), 0, 9, 2)
    l.position.set(1.6, 0.9, 1.7)
    return l
  }, [colors.ai])

  useFrame(() => {
    rim.intensity = refs.rise.value * 1.4
    key.intensity = refs.rise.value * (1.5 + refs.score.value * 1.6)
  })

  return (
    <>
      <ambientLight intensity={0.2} />
      <primitive object={rim} />
      <primitive object={key} />
      {/* Motes stay full-frame: they are the room, and a room that stops
          halfway across the panel is a box. */}
      <Motes {...props} />
      <Spill {...props} />
      {/* Everything structural sits to the RIGHT and further back, scaled down.
          The first pass centred it, which put the signal directly behind the
          headline and the body copy — the two things on this panel a reader
          actually needs. The structure belongs around the footage, which is what
          it is describing. */}
      {/* Three positions were tried and all three crossed live text: centred it
          sat behind the headline, right it sat behind the footage caption, low
          and right it sat behind the caption again. The conclusion is not a
          fourth position — it is that this panel has no empty quarter. The copy
          column, the footage, its progress bar, its caption, its provenance chip
          and the intelligence rail already occupy it.

          So the structure stops competing and becomes depth: pushed back, at
          atmosphere opacity, reading as something present in the room behind the
          evidence rather than as a diagram next to it. The interactive moment is
          the ink; the structure is the room it moves through. That is also what
          "restrained enough to support conversion" actually costs. */}
      <group position={[1.7, -0.5, -2.1]} scale={0.72}>
        <Ribbons {...props} />
        <Core {...props} />
        <Waveform {...props} />
        <Panels {...props} />
      </group>
    </>
  )
}
