/**
 * THE INK — a fluid trail under the cursor, on the hero's ink field.
 *
 * Framework-free, for the reason ambient.ts states and this file re-learns: the
 * product ships Three.js, R3F, drei and postprocessing for the intro film, and
 * a full 3D scene was built for this hero once and deleted, because the hero
 * composition had nowhere to put it. A cursor trail needs no scene graph, no
 * camera and no post stack — it is one 2D field, two render targets and two
 * programs. So it is those things and nothing else.
 *
 * WHY A FLUID AND NOT A PARTICLE TRAIL. Sprites following a cursor always read
 * cheap, because real ink does two things sprites cannot: it advects (the tail
 * keeps travelling after the cursor has gone, carried by the flow that the
 * cursor created) and it diffuses (edges soften and the mass thins, rather than
 * each dot fading in place). Both fall out of advecting a dye field for free.
 *
 * Deliberately a REDUCED fluid: dye advection with a velocity field made of
 * cursor motion plus curl noise, and no pressure projection. A full
 * Navier–Stokes solve wants ~20 passes a frame for incompressibility, and at
 * this opacity on a near-black ground the difference is not visible. What is
 * kept is what reads: momentum, curl, decay.
 *
 * WebGL2 only. Half-float render targets are native there; getting them in
 * WebGL1 needs two extensions that the devices most likely to lack WebGL2 also
 * most likely lack. No context, no ink — and the CSS field underneath is
 * already a finished design.
 *
 * INVENTS NO COLOUR. The cyan is read from `--mm-ai` by the caller and passed
 * in, so this file cannot drift from the palette.
 */

import type { Rgb } from '../field/tokens'

/** Simulation grid, per side. 256 is plenty: the dye is soft by definition. */
const SIM = 256

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/**
 * The simulation pass. Reads the previous dye, advects it along the velocity
 * field, diffuses and decays it, then adds the cursor's contribution.
 *
 * Channel r is dye. Channel g is age, advected with the dye — the draw pass
 * reads it so that older ink dims and cools instead of merely thinning, which is
 * the difference between dissipating and disappearing.
 */
const SIM_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uPrev;
uniform vec2 uCursor;      // 0..1, this frame
uniform vec2 uPrevCursor;  // 0..1, last frame
uniform float uForce;      // 0 when the pointer is away
uniform float uTime;
uniform float uDt;
uniform float uAspect;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
/* Curl of a noise field. This is what stops the dye travelling in straight
   lines: real ink in water curls, because the flow around it is rotational. */
vec2 curl(vec2 p){
  float e = 0.06;
  float n1 = vnoise(p + vec2(0.0, e));
  float n2 = vnoise(p - vec2(0.0, e));
  float n3 = vnoise(p + vec2(e, 0.0));
  float n4 = vnoise(p - vec2(e, 0.0));
  return vec2(n1 - n2, n4 - n3) / (2.0 * e);
}
/* Distance to the segment the cursor travelled this frame. A segment and not a
   point, because at speed a per-frame point splat leaves a dotted line. */
float segDist(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main(){
  vec2 uv = vUv;
  vec2 asp = vec2(uAspect, 1.0);

  /* Velocity: ambient curl everywhere, plus the cursor's own motion near it,
     falling off with distance — so a drag pushes the ink and the ink keeps
     going once the drag stops. */
  vec2 flow = curl(uv * 3.2 + uTime * 0.05) * 0.5;
  vec2 drag = (uCursor - uPrevCursor) * asp;
  float dSeg = segDist(uv * asp, uPrevCursor * asp, uCursor * asp);
  vec2 vel = flow + drag * exp(-dSeg * 9.0) * 40.0;
  /* Ink in water rises. Small, but it is the difference between a trail and a
     plume. */
  vel.y += 0.15;

  /* Advect: read from where this parcel of fluid came from. */
  vec2 src = uv - vel * uDt * 0.42;
  vec4 prev = texture(uPrev, src);

  /* Diffuse, four taps. This softens the edge into smoke rather than a smear. */
  float px = 1.0 / float(${SIM});
  vec4 blur = (
      texture(uPrev, src + vec2( px, 0.0))
    + texture(uPrev, src + vec2(-px, 0.0))
    + texture(uPrev, src + vec2(0.0,  px))
    + texture(uPrev, src + vec2(0.0, -px))
  ) * 0.25;
  vec4 carried = mix(prev, blur, 0.17);

  /* Decay, exponential and frame-rate independent, so the tail is the same
     length at 60 and at 144 fps. */
  carried *= exp(-uDt * 1.75);

  /* Splat. */
  float add = exp(-dSeg * 42.0) * uForce;
  carried.r += add;
  carried.g = max(carried.g * exp(-uDt * 0.6), add);

  outColor = clamp(carried, 0.0, 4.0);
}
`

/** The draw pass: dye field to screen, as ink. */
const DRAW_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uDye;
uniform vec3 uColor;
uniform float uFade;   // master fade-in, so the first frame is not a pop

void main(){
  vec4 d = texture(uDye, vUv);
  float ink = d.r;
  float age = d.g;

  /* Two responses: a tight wet core, and a wide soft bloom. The core follows
     the cursor; the bloom is what makes it read as liquid rather than as a line. */
  float core = smoothstep(0.10, 0.72, ink);
  float halo = smoothstep(0.02, 0.48, ink) * 0.34;
  /* Fresh ink is brighter; old ink falls back toward the ground rather than
     turning grey, so the tail dies into the room instead of onto it. */
  float fresh = clamp(age * 2.2, 0.0, 1.0);
  vec3 col = uColor * (0.5 + fresh * 0.9);
  float a = (core * 0.42 + halo) * uFade;
  outColor = vec4(col * a, a);
}
`

export type InkFluid = {
  /** dt in seconds; cursor in 0..1 canvas space; force 0..1 (0 = pointer away). */
  render: (dt: number, cx: number, cy: number, force: number, fade: number) => void
  resize: () => void
  dispose: () => void
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
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

function program(gl: WebGL2RenderingContext, frag: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
  const p = gl.createProgram()
  if (!vs || !fs || !p) return null
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.linkProgram(p)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p)
    return null
  }
  return p
}

/**
 * Returns null on any failure — no WebGL2, a driver that will not compile, no
 * float colour buffer. The caller treats null as "no ink", which is the design
 * with one layer missing rather than an error state.
 */
export function createInkFluid(
  canvas: HTMLCanvasElement,
  opts: { color: Rgb },
): InkFluid | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'low-power',
  })
  if (!gl) return null

  /* Rendering to a half-float target needs this in WebGL2 too. Without it the
     framebuffer is incomplete and the dye never accumulates. */
  if (!gl.getExtension('EXT_color_buffer_half_float') && !gl.getExtension('EXT_color_buffer_float')) {
    return null
  }

  const simProg = program(gl, SIM_FRAG)
  const drawProg = program(gl, DRAW_FRAG)
  if (!simProg || !drawProg) return null

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

  const bindQuad = (prog: WebGLProgram) => {
    const loc = gl.getAttribLocation(prog, 'aPos')
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  }

  /** One half-float target plus its framebuffer. */
  const makeTarget = () => {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SIM, SIM, 0, gl.RGBA, gl.HALF_FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    /* Start black, or the first advected frame samples uninitialised memory and
       the hero opens with a grey wash. */
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { tex, fbo }
  }

  let a = makeTarget()
  let b = makeTarget()
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  const uSim = {
    prev: gl.getUniformLocation(simProg, 'uPrev'),
    cursor: gl.getUniformLocation(simProg, 'uCursor'),
    prevCursor: gl.getUniformLocation(simProg, 'uPrevCursor'),
    force: gl.getUniformLocation(simProg, 'uForce'),
    time: gl.getUniformLocation(simProg, 'uTime'),
    dt: gl.getUniformLocation(simProg, 'uDt'),
    aspect: gl.getUniformLocation(simProg, 'uAspect'),
  }
  const uDraw = {
    dye: gl.getUniformLocation(drawProg, 'uDye'),
    color: gl.getUniformLocation(drawProg, 'uColor'),
    fade: gl.getUniformLocation(drawProg, 'uFade'),
  }

  let disposed = false
  let t = 0
  let px = 0.5
  let py = 0.5

  const resize = () => {
    if (disposed) return
    /* Capped device pixel ratio: this is a soft glow, and there is nothing in it
       that rewards more than 1.5x. */
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }
  resize()

  return {
    render(dt, cx, cy, force, fade) {
      if (disposed) return
      t += dt

      /* ── Simulate, into the free target. */
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo)
      gl.viewport(0, 0, SIM, SIM)
      gl.disable(gl.BLEND)
      gl.useProgram(simProg)
      bindQuad(simProg)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, a.tex)
      gl.uniform1i(uSim.prev, 0)
      gl.uniform2f(uSim.cursor, cx, cy)
      gl.uniform2f(uSim.prevCursor, px, py)
      gl.uniform1f(uSim.force, force)
      gl.uniform1f(uSim.time, t)
      gl.uniform1f(uSim.dt, dt)
      gl.uniform1f(uSim.aspect, canvas.clientWidth / Math.max(canvas.clientHeight, 1))
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      /* ── Draw the result to the canvas. */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      /* Premultiplied source over: the shader already multiplies colour by
         alpha, which keeps the soft edges from fringing dark. */
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(drawProg)
      bindQuad(drawProg)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, b.tex)
      gl.uniform1i(uDraw.dye, 0)
      gl.uniform3f(uDraw.color, opts.color[0], opts.color[1], opts.color[2])
      gl.uniform1f(uDraw.fade, fade)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      /* Swap, and remember where the cursor was. */
      const tmp = a
      a = b
      b = tmp
      px = cx
      py = cy
    },
    resize,
    dispose() {
      if (disposed) return
      disposed = true
      gl.deleteBuffer(quad)
      gl.deleteProgram(simProg)
      gl.deleteProgram(drawProg)
      for (const tgt of [a, b]) {
        gl.deleteTexture(tgt.tex)
        gl.deleteFramebuffer(tgt.fbo)
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
