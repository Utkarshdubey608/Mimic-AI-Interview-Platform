/**
 * Reading the stylesheet's own colours into shader-ready floats.
 *
 * Deliberately its OWN module, separate from ambient.ts, for a bundling reason
 * rather than a tidiness one. Field.tsx needs this synchronously — it reads the
 * tokens off the element before deciding whether to load the WebGL program at
 * all — and a single static import from ambient.ts is enough to pull the whole
 * program into the parent chunk and undo the dynamic import that keeps it out of
 * the marketing payload. Verified: with `parseColor` living in ambient.ts, the
 * shader landed in the 306 kB marketing chunk instead of a chunk of its own.
 *
 * So: everything the caller needs eagerly lives here, and ambient.ts is reachable
 * only through `import()`.
 */

/** A colour as 0‥1 per channel, in the order a vec3 uniform wants it. */
export type Rgb = readonly [number, number, number]

/**
 * Parse the colour strings the stylesheet actually produces.
 *
 * `getComputedStyle` on a custom property hands back whatever the author wrote,
 * so this has to cope with both `#0E1420` (how the tokens are declared) and
 * `rgb(14, 20, 32)` (what a resolved colour comes back as in some engines).
 *
 * Anything unrecognised returns null, and the caller treats that as "no WebGL
 * field" rather than guessing. A wrong ground colour would not degrade quietly —
 * it would paint a visible rectangle of the wrong shade over a section that has
 * real content in it.
 */
export function parseColor(input: string): Rgb | null {
  const s = input.trim()
  if (!s) return null

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    const n = parseInt(full, 16)
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }

  // rgb(14 20 32), rgb(14, 20, 32), rgba(…) — the separators are interchangeable
  // in modern CSS, so split on anything that is not part of a number.
  const fn = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number)
    if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
      return [parts[0] / 255, parts[1] / 255, parts[2] / 255]
    }
  }
  return null
}
