import { useReducedMotion } from 'framer-motion'
import { cn } from '@/components/ui'

/**
 * MIMIC — the ambient background system.
 *
 * One component, four contexts. It is what keeps a login screen, an interview
 * room, Avatar Studio and a data page feeling like one product without any of
 * them looking like the others.
 *
 * ── Why this is CSS and SVG, not WebGL ────────────────────────────────────
 * A background is the single worst place to spend a frame budget. On the
 * interview stage the main thread is already carrying a WebRTC connection, an
 * audio worklet and a transcript stream; on a recruiter page it is carrying a
 * 40-row table and a chart library. So every layer below is a radial gradient or
 * an inline SVG on its own composited layer, animated only on `transform` and
 * `opacity`. Nothing here reads a pixel, allocates a texture or ticks a rAF loop.
 *
 * WebGL remains available and is used deliberately in exactly one place — the
 * Avatar Studio preview, where the 3D content IS the subject rather than the
 * backdrop.
 *
 * ── Reduced motion ────────────────────────────────────────────────────────
 * The drift is not slowed down, it is not rendered. An element animating to no
 * visible effect still costs a composited layer every frame, and on the
 * interview stage that budget belongs to the video encoder. The static field
 * remains, so the surface keeps its depth and only the movement goes.
 */

type Variant =
  /** Sign-in and other full-screen entry surfaces. The most present of the four. */
  | 'entry'
  /** A live interview room. Deliberately the quietest — nothing may compete with
      a face, an avatar or a candidate's own thinking. */
  | 'room'
  /** Avatar Studio. A production environment: a lit stage, felt rather than seen. */
  | 'studio'
  /** Light data pages. Almost nothing — a whisper of depth at the top edge. */
  | 'record'

export function AmbientField({
  variant = 'record',
  className,
}: {
  variant?: Variant
  className?: string
}) {
  const reduce = useReducedMotion() ?? false

  return (
    <div
      // `data-ambient` is the hook the global reduced-motion rule uses to stop
      // any animation here, belt and braces with the `reduce` checks below.
      data-ambient=""
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        // contain: paint — the field can never invalidate the layout of the
        // content sitting above it.
        'isolate-paint',
        className,
      )}
    >
      {variant === 'entry' && <EntryField reduce={reduce} />}
      {variant === 'room' && <RoomField reduce={reduce} />}
      {variant === 'studio' && <StudioField reduce={reduce} />}
      {variant === 'record' && <RecordField />}
    </div>
  )
}

/* ═══ entry ═══════════════════════════════════════════════════════════════
   Sign-in and the other full-screen entry surfaces.

   This is the marketing site's hero ground, ported verbatim from
   mimicSite.css so that someone who clicks "Go to workspace" from the public
   site lands on the same surface they just left:

     radial-gradient(80% 55% at 8% -12%, registrar-blue 7%, transparent 60%),
     linear-gradient(180deg, #F4F6F9, #FFFFFF 62%)

   Paper and ink, with one 7% wash of registrar blue from the top-left. An
   earlier pass built this as a near-black room with two blue light fields — a
   handsome screen, and the wrong one: it made the front door of the product
   look like a different company from its own home page.

   The mesh is NOT kept. On ink a faint diagonal field reads as structure
   catching light; on paper the same lines read as a rendering artefact — they
   were plainly visible as grey streaks across the top-left of the sign-in
   screen. The marketing hero has no mesh either: two gradients and a closing
   hairline is the whole recipe, and copying it faithfully means copying what it
   leaves out. */

function EntryField({ reduce }: { reduce: boolean }) {
  return (
    <>
      {/* The ground — the marketing hero's own two-layer recipe. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(80% 55% at 8% -12%, rgba(29,63,160,0.07), transparent 60%),' +
            'linear-gradient(180deg, #F4F6F9 0%, #FFFFFF 62%)',
        }}
      />

      {/* One slow, very pale wash. On paper this has to be far quieter than the
          same gesture on ink — anything stronger reads as a stain rather than
          as light. */}
      <div
        className={cn('gpu absolute -left-[10%] -top-[25%] h-[65vmax] w-[65vmax] rounded-full', !reduce && 'animate-drift')}
        style={{
          background: 'radial-gradient(circle, rgba(29,63,160,0.05) 0%, transparent 62%)',
          filter: 'blur(40px)',
        }}
      />

      {/* The hairline that closes the field at the bottom, as the marketing
          site's sections do — it is what keeps a pale ground from dissolving
          into the browser chrome. */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-rule" />
    </>
  )
}

/* ═══ room ═════════════════════════════════════════════════════════════════
   The interview room. One very slow, very dim wash from above, and grain.

   This is the most restrained variant in the system, and that restraint is the
   design: a candidate is being assessed, and a background that moves in their
   peripheral vision while they think is not atmosphere, it is a distraction with
   a cost they pay. */

function RoomField({ reduce }: { reduce: boolean }) {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(100% 70% at 50% -20%, #131A27 0%, transparent 60%),' +
            'linear-gradient(180deg, #0B0F18 0%, #070A11 100%)',
        }}
      />
      <div
        className={cn('gpu absolute left-1/2 top-[-30%] h-[80vmax] w-[80vmax] -translate-x-1/2 rounded-full', !reduce && 'animate-breathe')}
        style={{
          background: 'radial-gradient(circle, rgba(29,63,160,0.08) 0%, transparent 60%)',
          filter: 'blur(60px)',
        }}
      />
      <div className="grain absolute inset-0" style={{ opacity: 0.03 }} />
    </>
  )
}

/* ═══ studio ═══════════════════════════════════════════════════════════════
   Avatar Studio. A lit production stage: a warm-cool key from one side, a floor
   falloff, and a visible grid that reads as a stage floor rather than as
   graph paper — it is in perspective and it fades out, which is the difference. */

function StudioField({ reduce }: { reduce: boolean }) {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(80% 60% at 20% 0%, #1B2842 0%, transparent 55%),' +
            'linear-gradient(180deg, #0B0F18 0%, #070A11 70%)',
        }}
      />
      <div
        className={cn('gpu absolute -left-[5%] -top-[15%] h-[55vmax] w-[55vmax] rounded-full', !reduce && 'animate-drift')}
        style={{
          background: 'radial-gradient(circle, rgba(29,63,160,0.20) 0%, transparent 60%)',
          filter: 'blur(45px)',
        }}
      />
      {/* The stage floor. Perspective grid, fading upward into the dark. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[45%]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(138,166,240,0.10) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(138,166,240,0.10) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          transform: 'perspective(340px) rotateX(62deg)',
          transformOrigin: 'bottom',
          maskImage: 'linear-gradient(to top, black 0%, transparent 85%)',
          WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 85%)',
        }}
      />
      <div className="grain absolute inset-0" />
    </>
  )
}

/* ═══ record ═══════════════════════════════════════════════════════════════
   The light data surface. Static, and almost nothing: a single soft wash at the
   top edge so a long table does not sit on a flat field of one colour.

   No animation at all. A recruiter reads this screen for hours, and anything
   that moves in the background of a reading surface is a defect. */

function RecordField() {
  return (
    <div
      className="absolute inset-x-0 top-0 h-[420px]"
      style={{
        background:
          'radial-gradient(70% 100% at 50% 0%, rgba(29,63,160,0.05) 0%, transparent 70%)',
      }}
    />
  )
}

/* ═══ Mesh ═════════════════════════════════════════════════════════════════
   A faint structural field. Deliberately NOT a tiled dot or square grid — that
   pattern reads as graph paper and is the most recognisable generated-UI tell
   there is. This is a set of long, irregularly spaced diagonals with a radial
   mask, so it reads as structure catching light rather than as a texture swatch. */

function MeshLines({ opacity = 0.06, ground = 'room' }: { opacity?: number; ground?: 'room' | 'record' }) {
  // On paper the structural field is drawn in the hairline colour, not in the
  // accent: a blue mesh on white reads as a decorative graphic, while a grey one
  // reads as the ruling of a page.
  const stroke = ground === 'record' ? '#E3E6ED' : '#8AA6F0'
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      style={{ opacity }}
      preserveAspectRatio="none"
      viewBox="0 0 1200 800"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mimic-mesh-stroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0" />
          <stop offset="45%" stopColor={stroke} stopOpacity="1" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
        <radialGradient id="mimic-mesh-mask" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="mimic-mesh-fade">
          <rect width="1200" height="800" fill="url(#mimic-mesh-mask)" />
        </mask>
      </defs>
      <g mask="url(#mimic-mesh-fade)" stroke="url(#mimic-mesh-stroke)" strokeWidth="1" fill="none">
        {/* Irregular spacing — 0, 137, 291, 468, 664, 881 — so the eye never
            resolves a repeat. An even interval is what makes a pattern read as
            wallpaper. */}
        {[0, 137, 291, 468, 664, 881, 1119].map((x) => (
          <line key={`d-${x}`} x1={x} y1="-100" x2={x + 420} y2="900" />
        ))}
        {[96, 233, 407, 598].map((y) => (
          <line key={`h-${y}`} x1="-100" y1={y} x2="1300" y2={y + 60} />
        ))}
      </g>
    </svg>
  )
}
