/**
 * THE RAKING LIGHT — the ambient layer on the ink fields.
 *
 * A low, slow light passing across a dark filed page: the lamp on the desk of
 * someone reading the record at night. It runs ONLY on the near-black fields
 * (the CTA, the process stage, the footer), because those are the only places on
 * this site with the negative space to hold it.
 *
 * That constraint is not arbitrary. A WebGL card field was built for the hero
 * once and deleted — see the note in MimicSite.tsx — because the hero
 * composition had nowhere to put it. The lesson recorded there was to decide
 * WHERE a scene goes before deciding what it looks like, and this module is the
 * answer to that: it goes where the page is already empty and already dark.
 *
 * Framework-free on purpose. The product ships Three.js, React Three Fiber,
 * drei and postprocessing for the intro film, and reaching for them here would
 * put ~600 kB of scene graph on the marketing critical path to draw what is
 * ultimately one full-screen gradient in motion. This is one program, one quad,
 * no textures, no render targets, no scene graph — a few kB, dynamically
 * imported, and the CSS field underneath it is already a finished design.
 *
 * INVENTS NO COLOUR. Both ends of the ramp are read from the stylesheet's own
 * tokens by the caller and passed in as uniforms, so this file cannot drift from
 * the palette even if the palette changes.
 */

import type { Rgb } from './tokens'

/** Vertex shader: a full-screen quad. WebGL1, so the corners come from a buffer. */
const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/**
 * Fragment shader.
 *
 * Three things are layered, in falling order of contribution:
 *
 *  1. The rake — one broad, soft, angled band drifting across the field. This is
 *     the motif; it carries most of the light and all of the direction.
 *  2. Two slow noise lobes on different axes, which stop the band from reading
 *     as a mechanical wipe and give the surface the unevenness of a real lit
 *     plane.
 *  3. A dither, because the whole image lives in the top ~7% of luminance above
 *     a near-black ground and 8-bit output bands visibly across a gradient that
 *     shallow. This is the difference between "lit" and "striped".
 *
 * `uAmp` caps the total. At the default the peak sits a few percent above the
 * ink ground, which is the whole design intent: the field must never compete
 * with the type sitting on it.
 */
const FRAG = `
precision mediump float;

varying vec2 vUv;

uniform float uTime;      // seconds
uniform vec2  uRes;       // drawing-buffer size, px
uniform vec3  uInk;       // the ground; the field never goes below this
uniform vec3  uLight;     // the lit end of the ramp
uniform float uAmp;       // peak lift above the ground, 0..1
uniform float uSeed;      // per-instance offset, so two fields never march in step

/* Cheap 2D value noise. A hash rather than a texture: one less request, one
   less asset to keep in sync, and at these frequencies the quality difference
   is invisible. */
float hash(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Smoothstep interpolation — a linear blend leaves visible grid creases.
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/* Two octaves, not five. The field is meant to read as one soft mass of light,
   and every extra octave adds detail that only makes it look like fog. */
float fbm(vec2 p){
  return noise(p) * 0.65 + noise(p * 2.03 + 7.1) * 0.35;
}

/* Ordered-ish dither from a hash. Breaks the 8-bit banding without reading as
   grain of its own. */
float dither(vec2 frag){
  return (hash(frag) - 0.5) * (1.5 / 255.0);
}

void main(){
  // Aspect-corrected coordinates, so the band keeps its angle and the noise
  // keeps its scale when the field is short and wide (which it always is).
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = vec2(vUv.x * aspect, vUv.y);

  float t = uTime + uSeed;

  // ── 1. The rake ────────────────────────────────────────────────────────
  // A shallow diagonal, travelling slowly. The period is long enough (~40s)
  // that a reader passing through the section sees a moving light rather than a
  // repeating sweep.
  float axis = p.x * 0.62 + p.y * 0.78;
  float travel = fract(t * 0.025);
  float d = abs(fract(axis - travel + 0.5) - 0.5);
  // Wide and very soft: this is a lamp, not a scanline.
  float rake = smoothstep(0.42, 0.0, d);
  rake *= rake;

  // ── 2. The plane it falls on ────────────────────────────────────────────
  // Different frequencies AND different drift directions, so the two never
  // resolve into a single moving shape.
  float lobeA = fbm(p * 1.15 + vec2(t * 0.018, t * -0.011));
  float lobeB = fbm(p * 0.62 + vec2(t * -0.009, t * 0.014));

  float lum = rake * 0.58 + lobeA * 0.26 + lobeB * 0.16;

  // ── 3. Falloff ──────────────────────────────────────────────────────────
  // Brightest low and to one side, fading out at the edges, so the field has a
  // light SOURCE rather than an even glow — and so it never brightens the
  // corners where headings and buttons sit.
  float vign = smoothstep(1.25, 0.05, length((vUv - vec2(0.32, 0.18)) * vec2(1.0, 1.35)));
  lum *= vign;

  vec3 col = mix(uInk, uLight, clamp(lum * uAmp, 0.0, 1.0));
  col += dither(gl_FragCoord.xy);

  gl_FragColor = vec4(col, 1.0);
}
`

/**
 * Device-pixel ratio to render at.
 *
 * Capped, and then deliberately UNDERSAMPLED. The field is a soft gradient with
 * no edges in it, so rendering at roughly half resolution and letting the
 * browser upscale is free quality: nothing in the image has detail fine enough
 * for the difference to be visible, and the fragment count drops to about a
 * quarter. On a 3× phone this is the difference between a warm device and a
 * cool one.
 */
export function renderScale(dpr: number): number {
  const capped = Math.min(Math.max(dpr, 1), 1.5)
  return capped * 0.5
}

export type AmbientOptions = {
  ink: Rgb
  light: Rgb
  /** Peak lift above the ground. Small by design; see the shader header. */
  amp?: number
  /** Distinguishes two fields on one page so they do not pulse together. */
  seed?: number
}

export type AmbientField = {
  /** Advance and draw one frame. `seconds` is elapsed time, not a delta. */
  render: (seconds: number) => void
  /** Re-read the canvas size. Cheap; call from a ResizeObserver. */
  resize: () => void
  /** Release the context and its buffers. */
  dispose: () => void
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh)
    return null
  }
  return sh
}

/**
 * Build the field on a canvas. Returns null if anything at all goes wrong —
 * no context, a driver that refuses to compile, a lost program. The caller's
 * CSS field is already painted underneath, so null is a complete outcome and
 * not an error to report.
 *
 * `antialias` and `depth` are off because there is no geometry to alias and
 * nothing to depth-test; `alpha` is off so the compositor never has to blend
 * this layer against what is behind it.
 */
export function createAmbientField(
  canvas: HTMLCanvasElement,
  opts: AmbientOptions & {
    /**
     * The GL context went away. Remove this layer.
     *
     * THIS IS THE ONE THAT MATTERS MOST IN THIS FILE, because of `alpha: false`
     * below. An opaque canvas whose context has been lost is painted by the
     * browser as a flat light rectangle — and this canvas sits over the section's
     * dark ground with the section's own content above it. So a lost context does
     * not degrade the effect, it turns the whole section WHITE with its light
     * type still light on it: a ghost headline on paper. Reproduced exactly by
     * forcing the loss.
     *
     * And it happens for an ordinary reason. Every field and every ink trail is
     * its own context; the marketing home page was creating about a dozen, and a
     * renderer that runs out evicts the OLDEST. So moving the pointer — which
     * starts an ink trail, which allocates another context — could evict a
     * field's, and the section it belonged to went white and stayed white. That
     * is why it presented as "the hero goes light when I hover".
     *
     * Nothing tries to rebuild. The layer goes, and the CSS field underneath —
     * which is a real gradient in the same tokens — is what the section was
     * always designed to fall back to.
     */
    onLost?: () => void
  },
): AmbientField | null {
  const gl = (canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: 'low-power', preserveDrawingBuffer: false,
  }) ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
  if (!gl) return null

  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  const prog = gl.createProgram()
  if (!vs || !fs || !prog) return null

  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  // The shaders are attached to the program, which holds its own copy — they can
  // go as soon as the link succeeds or fails.
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog)
    return null
  }
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1,
  ]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  const uTime = gl.getUniformLocation(prog, 'uTime')
  const uRes = gl.getUniformLocation(prog, 'uRes')

  gl.uniform3fv(gl.getUniformLocation(prog, 'uInk'), opts.ink as unknown as number[])
  gl.uniform3fv(gl.getUniformLocation(prog, 'uLight'), opts.light as unknown as number[])
  gl.uniform1f(gl.getUniformLocation(prog, 'uAmp'), opts.amp ?? 0.5)
  gl.uniform1f(gl.getUniformLocation(prog, 'uSeed'), opts.seed ?? 0)

  let disposed = false

  /* `preventDefault` so the browser will consider restoring the context at all,
     and the listener is dropped here rather than in `dispose`, which returns early
     once `disposed` is set. A dead context cannot be lost twice. */
  const onContextLost = (e: Event) => {
    e.preventDefault()
    disposed = true
    canvas.removeEventListener('webglcontextlost', onContextLost)
    opts.onLost?.()
  }
  canvas.addEventListener('webglcontextlost', onContextLost)

  const resize = () => {
    if (disposed) return
    const scale = renderScale(window.devicePixelRatio || 1)
    // The CSS box is the source of truth for size; the buffer is a fraction of
    // it. Rounded up to at least 1 so a display:none ancestor cannot produce a
    // zero-sized buffer and a GL error.
    const w = Math.max(1, Math.round(canvas.clientWidth * scale))
    const h = Math.max(1, Math.round(canvas.clientHeight * scale))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    gl.viewport(0, 0, w, h)
    gl.uniform2f(uRes, w, h)
  }

  resize()

  return {
    render(seconds: number) {
      if (disposed) return
      gl.uniform1f(uTime, seconds)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    },
    resize,
    dispose() {
      canvas.removeEventListener('webglcontextlost', onContextLost)
      if (disposed) return
      disposed = true
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
      // Hand the context back rather than waiting for GC. A page with several
      // fields mounted and unmounted over a session can otherwise sit on more
      // live contexts than the browser's limit (typically 16) allows.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
