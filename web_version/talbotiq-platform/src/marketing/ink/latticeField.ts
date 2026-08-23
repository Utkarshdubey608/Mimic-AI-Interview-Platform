/**
 * THE CONVERGENCE — the problem section's field.
 *
 * The section either side of this canvas makes one argument: five interviewers
 * produce five different interviews, and one rubric produces one comparable
 * set. The left card is ragged, the right card is aligned, and the arrow between
 * them is the claim.
 *
 * This is that argument as a field. A 3D lattice of cells recedes into depth;
 * on the LEFT every cell is displaced, rotated and out of phase, and the
 * displacement falls to zero as the field crosses to the RIGHT, where the
 * lattice resolves into a rank. Chaos and order are the same structure at two
 * settings, which is precisely the claim the cards are making — and it is why
 * this is not decoration: a reader who never reads the cards has already been
 * shown the point.
 *
 * NO GEOMETRY. It is one full-screen quad and one fragment shader that marches a
 * few slices of a procedural grid. That buys real perspective, real parallax and
 * real depth fade for about 6 kB, where an instanced-mesh version would want a
 * scene graph, a camera and a renderer. field/ambient.ts states the rule this
 * follows: the marketing surface does not load a 3D framework to draw a field.
 *
 * SCROLL DRIVES IT. `resolve` comes from the section's own scroll progress, so
 * the lattice orders itself as the reader arrives at the argument and holds once
 * they are looking at it. Nothing loops.
 *
 * INVENTS NO COLOUR. Both ends of the ramp are read from the stylesheet by the
 * caller and passed in.
 */

import type { Rgb } from '../field/tokens'

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uResolve;   // 0 = scattered, 1 = ranked. From scroll.
uniform float uFade;      // master fade-in
uniform vec2  uPointer;   // 0..1, for the parallax lean
uniform float uGrav;      // pointer presence
uniform vec3  uCool;      // the ordered end  (--mm-on-ink-accent)
uniform vec3  uAi;        // the machine end  (--mm-ai)

float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

/* One slice of the lattice, sampled in the plane at depth z.
   'chaos' is how disordered this slice is: it is high on the left of the field
   and falls to nothing on the right, and 'uResolve' pulls the whole field
   toward order as the reader arrives. */
float slice(vec2 p, float z, float chaos){
  /* Cell size grows with depth, which is what reads as perspective. */
  float cell = 0.30 + z * 0.10;
  vec2 g = p / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;

  float h = hash(vec3(id, floor(z * 4.0)));

  /* Displacement, rotation and phase all scale with chaos. At chaos 0 every
     cell sits exactly on the lattice; at chaos 1 none of them do. */
  vec2 jitter = (vec2(h, fract(h * 7.3)) - 0.5) * chaos * 0.85;
  float ang = (h - 0.5) * chaos * 2.4;
  float ca = cos(ang), sa = sin(ang);
  vec2 q = mat2(ca, -sa, sa, ca) * (f - jitter);

  /* A bar, not a dot: the cards either side are bars, and the field should be
     speaking the same language. Length varies with chaos, so the left reads
     ragged and the right reads uniform — exactly the two cards. */
  float len = mix(0.42, 0.2 + h * 0.34, chaos);
  vec2 d = abs(q) - vec2(len, 0.022);
  float bar = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);

  /* Soft edge, and a slow breathing so the field is alive without moving. */
  float pulse = 0.85 + 0.15 * sin(uTime * 0.5 + h * 6.28);
  /* Two-tone: a soft body plus a tight bright edge. A flat mark reads as a
     sticker; an edge that catches light reads as a surface turned toward it. */
  float body = smoothstep(0.045, 0.0, bar);
  float edge = smoothstep(0.012, 0.0, abs(bar + 0.008)) * 1.6;
  return (body * 0.55 + edge) * pulse;
}

void main(){
  /* Aspect-correct, origin centred. */
  vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);

  /* A gentle lean toward the pointer. Capped: this is a field, not a toy. */
  vec2 lean = (uPointer - 0.5) * uGrav * 0.12;

  float acc = 0.0;
  vec3 col = vec3(0.0);

  /* Six slices. Four was the right answer while the cards were translucent and
     the field showed through them; now they have an opaque, blurred backing, so
     depth here costs the content nothing and depth is the whole reason this
     reads as three-dimensional rather than as a pattern. */
  const int N = 6;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float z = fi / float(N);

    /* Perspective: nearer slices are magnified. Slices also drift sideways at
       different rates, which is the parallax. */
    float persp = 1.0 / (0.42 + z * 2.1);
    vec2 p = (uv + lean * (1.0 - z)) * persp;
    p.x += uTime * (0.010 + z * 0.055);
    p.y += sin(uTime * 0.09 + fi * 1.7) * 0.05;

    /* THE ARGUMENT. Chaos is a function of horizontal position: high on the
       left, gone on the right. 'uResolve' slides the whole gradient toward
       order, so as the reader arrives the field ranks itself. */
    float acrossField = clamp(vUv.x * 1.25 - 0.1, 0.0, 1.0);
    float chaos = (1.0 - acrossField) * (1.0 - uResolve * 0.55);

    float s = slice(p, z, chaos);

    /* Depth fade, so the back slices sit behind rather than stacking. */
    float depth = 1.0 - z * 0.78;
    /* Colour: the machine cyan where the field is ordered, the cool accent
       where it is not. Order is the thing being sold, so order is the brighter
       end. */
    vec3 tint = mix(uCool, uAi, acrossField * 0.75);
    col += tint * s * depth;
    acc += s * depth;
  }

  /* Normalise, then hold it well below the type that sits on top of this. */
  float a = clamp(acc * 0.115, 0.0, 1.0) * uFade;
  col = col * 0.15;

  /* Vignette, so the field dies into the section's own ground at the edges
     instead of ending at the canvas. */
  vec2 c = vUv - 0.5;
  float vig = smoothstep(0.78, 0.18, length(vec2(c.x * 0.85, c.y)));
  a *= vig;

  outColor = vec4(col * vig, a);
}
`

export type LatticeField = {
  /** dt seconds; resolve 0..1 from scroll; pointer 0..1; grav 0..1; fade 0..1. */
  render: (dt: number, resolve: number, px: number, py: number, grav: number, fade: number) => void
  resize: () => void
  dispose: () => void
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null }
  return sh
}

/** null on any failure — the section's own ground is already a finished design. */
export function createLatticeField(
  canvas: HTMLCanvasElement,
  opts: { cool: Rgb; ai: Rgb },
): LatticeField | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: true, powerPreference: 'low-power',
  })
  if (!gl) return null

  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  const prog = gl.createProgram()
  if (!vs || !fs || !prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl.deleteProgram(prog); return null }

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  const u = {
    res: gl.getUniformLocation(prog, 'uRes'),
    time: gl.getUniformLocation(prog, 'uTime'),
    resolve: gl.getUniformLocation(prog, 'uResolve'),
    fade: gl.getUniformLocation(prog, 'uFade'),
    pointer: gl.getUniformLocation(prog, 'uPointer'),
    grav: gl.getUniformLocation(prog, 'uGrav'),
    cool: gl.getUniformLocation(prog, 'uCool'),
    ai: gl.getUniformLocation(prog, 'uAi'),
  }

  let disposed = false
  let t = 0

  const resize = () => {
    if (disposed) return
    /* Capped hard. This is a soft field behind text; there is nothing in it that
       rewards a retina buffer, and this section is tall. */
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25)
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  }
  resize()

  return {
    render(dt, resolve, px, py, grav, fade) {
      if (disposed) return
      t += dt
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(prog)
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      gl.uniform2f(u.res, canvas.width, canvas.height)
      gl.uniform1f(u.time, t)
      gl.uniform1f(u.resolve, resolve)
      gl.uniform1f(u.fade, fade)
      gl.uniform2f(u.pointer, px, py)
      gl.uniform1f(u.grav, grav)
      gl.uniform3f(u.cool, opts.cool[0], opts.cool[1], opts.cool[2])
      gl.uniform3f(u.ai, opts.ai[0], opts.ai[1], opts.ai[2])
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    resize,
    dispose() {
      if (disposed) return
      disposed = true
      gl.deleteBuffer(quad)
      gl.deleteProgram(prog)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
