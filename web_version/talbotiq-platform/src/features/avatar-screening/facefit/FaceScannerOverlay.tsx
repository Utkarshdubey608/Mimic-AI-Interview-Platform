/**
 * FaceScannerOverlay — the "face scanner" canvas drawn over the live camera
 * feed: a glowing wireframe mesh tracking the face, a target reticle with
 * animated corner brackets, a scanning sweep line, colour-state feedback, and a
 * lock-in progress ring that ends in a success glow pulse.
 *
 * Colour states follow the Mimic ramp: lavender-neutral while searching → soft
 * violet while locking in → the caller's accent (mint) once locked.
 *
 * It owns its own requestAnimationFrame render loop and reads the latest
 * landmarks + visual state from refs, so the ~18fps detection rate never forces
 * React re-renders. Landmarks are normalized (0–1) in the RAW camera frame; we
 * map them through the same object-cover + mirror transform the <video> uses.
 */
import { useEffect, useRef } from 'react'
import type { Landmark } from './framing'
import type { FaceMesh } from './useFaceLandmarker'

export type ScannerPhase = 'searching' | 'adjusting' | 'holding' | 'locked' | 'success'

export interface ScannerVisualState {
  phase: ScannerPhase
  /** Lock-in progress, 0–1. */
  progress: number
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
  facesRef: React.MutableRefObject<Landmark[][]>
  stateRef: React.MutableRefObject<ScannerVisualState>
  mesh: FaceMesh | null
  /** Brand accent (hex) used for the locked/good state. */
  accent: string
  mirror?: boolean
  reducedMotion?: boolean
  /** Draw the full face tesselation (heavier) rather than contours + points. */
  dense?: boolean
}

/** Searching — lavender-neutral, calm and unalarming. */
const SEARCHING = '#93A0B4'
/** Locking in — soft violet (brand-gold token value), clearly "something's happening". */
const LOCKING = '#8AA6F0'

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const int = parseInt(n, 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
function mixTuple(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ]
}
function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`
}

export function FaceScannerOverlay({
  videoRef,
  facesRef,
  stateRef,
  mesh,
  accent,
  mirror = true,
  reducedMotion = false,
  dense = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const successAtRef = useRef<number | null>(null)
  const prevPhaseRef = useRef<ScannerPhase>('searching')

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const searchingRgb = hexToRgb(SEARCHING)
    const lockingRgb = hexToRgb(LOCKING)
    const accentRgb = hexToRgb(accent)

    // Keep the backing store sized to the element's CSS box × DPR.
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      return { w, h, dpr }
    }

    /** object-cover mapping from normalized camera coords → CSS px of the canvas box. */
    const makeMapper = (w: number, h: number) => {
      const vw = video?.videoWidth || w
      const vh = video?.videoHeight || h
      const scale = Math.max(w / vw, h / vh)
      const dispW = vw * scale
      const dispH = vh * scale
      const offX = (w - dispW) / 2
      const offY = (h - dispH) / 2
      return (nx: number, ny: number): [number, number] => {
        let x = offX + nx * vw * scale
        const y = offY + ny * vh * scale
        if (mirror) x = w - x
        return [x, y]
      }
    }

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      const { w, h, dpr } = resize()
      if (!w || !h) return

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const vis = stateRef.current
      const faces = facesRef.current
      const t = performance.now()

      // Track success transition for the pulse.
      if (vis.phase === 'success' && prevPhaseRef.current !== 'success') successAtRef.current = t
      prevPhaseRef.current = vis.phase

      // Colour ramp: lavender-neutral while searching, warming to soft violet as
      // a face is found, then blending into the accent (mint) as the lock fills.
      const good = vis.phase === 'holding' || vis.phase === 'locked' || vis.phase === 'success'
      const blend = vis.phase === 'holding' ? Math.min(1, vis.progress) : good ? 1 : 0
      const rgb: [number, number, number] = good
        ? mixTuple(lockingRgb, accentRgb, blend)
        : mixTuple(searchingRgb, lockingRgb, vis.phase === 'adjusting' ? 0.5 : 0)
      const color = rgbCss(rgb)

      const cx = w / 2
      const cy = h * 0.47
      const ry = h * 0.4
      const rx = Math.min(ry * 0.74, w * 0.42)

      // ── Reticle oval ──────────────────────────────────────────────────
      ctx.save()
      ctx.lineWidth = 2
      ctx.strokeStyle = color
      // The lavender/violet ramp sits lower-contrast than the old amber, so the
      // reticle carries a touch more alpha to stay readable over a bright frame.
      ctx.globalAlpha = 0.62
      ctx.shadowBlur = reducedMotion ? 0 : 14
      ctx.shadowColor = color
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      // ── Corner brackets (frame a square around the reticle) ────────────
      const bx = rx * 1.12
      const by = ry * 0.92
      const len = Math.min(bx, by) * 0.34
      const pulse = reducedMotion ? 0 : Math.sin(t / 400) * 3
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.globalAlpha = 0.9
      ctx.shadowBlur = reducedMotion ? 0 : 8
      ctx.shadowColor = color
      const corners: Array<[number, number, number, number]> = [
        [cx - bx - pulse, cy - by - pulse, 1, 1],
        [cx + bx + pulse, cy - by - pulse, -1, 1],
        [cx - bx - pulse, cy + by + pulse, 1, -1],
        [cx + bx + pulse, cy + by + pulse, -1, -1],
      ]
      for (const [x, y, sx, sy] of corners) {
        ctx.beginPath()
        ctx.moveTo(x + sx * len, y)
        ctx.lineTo(x, y)
        ctx.lineTo(x, y + sy * len)
        ctx.stroke()
      }
      ctx.restore()

      // ── Scanning sweep line (skipped for reduced motion) ───────────────
      if (!reducedMotion && vis.phase !== 'success') {
        const period = 2600
        const p = (t % period) / period
        const sweepY = cy - by + p * (by * 2)
        const grad = ctx.createLinearGradient(0, sweepY - 26, 0, sweepY + 26)
        grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`)
        grad.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.5)`)
        grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`)
        ctx.save()
        // Clip the sweep to the reticle oval so it reads as an in-frame scan.
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        ctx.clip()
        ctx.fillStyle = grad
        ctx.fillRect(cx - rx, sweepY - 26, rx * 2, 52)
        ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.7)`
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(cx - rx, sweepY)
        ctx.lineTo(cx + rx, sweepY)
        ctx.stroke()
        ctx.restore()
      }

      // ── Face mesh (glowing) ────────────────────────────────────────────
      if (mesh && faces.length) {
        const map = makeMapper(w, h)
        for (const face of faces) {
          if (!face.length) continue
          // Point cloud — cheap dots for all landmarks.
          ctx.save()
          ctx.fillStyle = color
          ctx.globalAlpha = 0.5
          for (const pt of face) {
            const [x, y] = map(pt.x, pt.y)
            ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5)
          }
          ctx.restore()

          // Wireframe lines — contours (default) or full tesselation (dense).
          const conns = dense ? mesh.tesselation : mesh.contours
          ctx.save()
          ctx.strokeStyle = color
          ctx.lineWidth = dense ? 0.5 : 1
          ctx.globalAlpha = dense ? 0.28 : 0.7
          ctx.shadowBlur = reducedMotion ? 0 : dense ? 0 : 6
          ctx.shadowColor = color
          ctx.beginPath()
          for (const c of conns) {
            const a = face[c.start]
            const b = face[c.end]
            if (!a || !b) continue
            const [ax, ay] = map(a.x, a.y)
            const [bx2, by2] = map(b.x, b.y)
            ctx.moveTo(ax, ay)
            ctx.lineTo(bx2, by2)
          }
          ctx.stroke()
          ctx.restore()
        }
      }

      // ── Lock-in progress ring (hugs the reticle, fills from top) ───────
      if (vis.progress > 0 && vis.phase !== 'success') {
        ctx.save()
        ctx.strokeStyle = rgbCss(mixTuple(lockingRgb, accentRgb, blend))
        ctx.lineWidth = 4
        ctx.lineCap = 'round'
        ctx.shadowBlur = reducedMotion ? 0 : 12
        ctx.shadowColor = accent
        const start = -Math.PI / 2
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx + 6, ry + 6, 0, start, start + vis.progress * Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // ── Success glow pulse (expanding rings) ───────────────────────────
      if (successAtRef.current !== null) {
        const dt = t - successAtRef.current
        const dur = 900
        if (dt < dur) {
          const k = dt / dur
          const rings = reducedMotion ? 1 : 2
          for (let i = 0; i < rings; i++) {
            const rk = Math.max(0, k - i * 0.18)
            if (rk <= 0) continue
            ctx.save()
            ctx.globalAlpha = (1 - rk) * 0.6
            ctx.strokeStyle = accent
            ctx.lineWidth = 3
            ctx.shadowBlur = reducedMotion ? 0 : 16
            ctx.shadowColor = accent
            ctx.beginPath()
            ctx.ellipse(cx, cy, (rx + 6) * (1 + rk * 0.35), (ry + 6) * (1 + rk * 0.35), 0, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
          }
        } else {
          successAtRef.current = null
        }
        // Steady locked ring once success settles.
        ctx.save()
        ctx.globalAlpha = 0.9
        ctx.strokeStyle = accent
        ctx.lineWidth = 4
        ctx.shadowBlur = reducedMotion ? 0 : 14
        ctx.shadowColor = accent
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx + 6, ry + 6, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [videoRef, facesRef, stateRef, mesh, accent, mirror, reducedMotion, dense])

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
}
