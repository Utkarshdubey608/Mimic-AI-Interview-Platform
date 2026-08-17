/** @type {import('tailwindcss').Config} */
//
// THE RECORD — token layer.
//
// The world is the legal evidence bundle: numbered transcript lines, exhibit
// tabs, citations back to the record, a reasoned finding, and a human who
// decides. It replaces the inherited Eightfold violet system wholesale.
//
// Two rules govern every value below:
//   1. The reading surface is light and cool, because the scene is a recruiter
//      at a desk in daylight reading transcripts for hours. The navigational
//      spine is ink-dark, because a bundle has a cover and the pages do not.
//   2. Colour is FUNCTIONAL. The exhibit ramp encodes the six interview
//      formats; it is index-tab coding, not decoration. Nothing else is
//      allowed to be colourful.
//
// Legacy key names (primary/neutral/brand/hume/mint/magenta/accent) are kept so
// every existing consumer re-skins without edits — the same technique the
// previous system used. The names are historical; the values are The Record.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Registrar ink — the authority colour. Primary actions, active spine
        // item, focus ring, citation links.
        primary: { DEFAULT: '#0B7A45', 50: '#F2FAF5', 100: '#E1F3E9', 200: '#C2E5D1', 300: '#8CCBA8', 400: '#4FAE7C', 500: '#1F9059', 600: '#128A4E', 700: '#0B7A45', 800: '#085F36', 900: '#064428' },

        // ── Exhibit tabs — the six interview formats ────────────────────
        // Index-tab colour coding. Each is AA as ink on white and legible as a
        // 3px tab edge. This is the only place saturation is permitted.
        exhibit: {
          chat:    '#B45309', // Timed Q&A
          chatbot: '#0F766E', // Conversational
          voice:   '#4338CA', // Live voice
          avatar:  '#BE185D', // AI video avatar
          video:   '#15803D', // Recorded video
          twoway:  '#0369A1', // Live two-way
        },

        // The seal. Reserved for the stamped mark: flagged integrity events,
        // rejected outcomes, destructive confirmation. Never a surface fill.
        seal: { DEFAULT: '#B3261E', bg: '#FCF0EF', border: '#F0CFCC' },

        // Cool neutral ramp — paper under daylight, never warm, never lavender.
        //
        // MEASURED, not asserted. An earlier revision of this comment claimed
        // 400 and 500 both cleared 4.5:1; a contrast audit proved 400 did not
        // (#6E7889 = 4.46:1 on white, 3.91:1 on the #EEF0F4 ground) across 173
        // `text-neutral-400` usages. 400 is now #626B79 — 5.39:1 on white,
        // 4.72:1 on the ground — so it clears AA as text on BOTH surfaces, which
        // is the binding constraint since secondary text sits on each.
        // 300 and below stay decorative (hairlines, tracks, skeletons) only.
        neutral: { 50: '#F7F7F8', 100: '#F1F1F3', 200: '#E6E6E9', 300: '#D2D3D7', 400: '#61666E', 500: '#5B6067', 600: '#4A4F57', 700: '#3B4046', 800: '#24272C', 900: '#0E1420' },

        surface:    '#FFFFFF',   // the record page
        background: '#F5F5F7',   // the desk the bundle sits on
        border:     '#E7E7EA',   // hairline rules

        success: { DEFAULT: '#15803D', bg: '#EFF7F1', border: '#C9E5D2' },
        warning: { DEFAULT: '#B45309', bg: '#FDF5EA', border: '#F0DBBC' },
        danger:  { DEFAULT: '#B3261E', bg: '#FCF0EF', border: '#F0CFCC' },

        // Legacy aliases, remapped so old consumers inherit the new world.
        magenta: { DEFAULT: '#BE185D', light: '#DB2777', bg: '#FCF0F5', border: '#F3CFE0' },
        mint:    { DEFAULT: '#0F766E', hover: '#0B5F58', ink: '#0F766E', bg: '#EDF6F5', border: '#C4E3E0' },
        accent:  { DEFAULT: '#B45309', light: '#FDF5EA', pale: '#FEFAF4' },

        // ── The spine and the dark rooms (live call, avatar, guide) ─────
        // A bundle's cover and slipcase. Key names are legacy.
        brand: {
          black:         '#0E1420', // spine ground
          card:          '#1A1E24', // raised spine surface
          border:        '#2C3036', // spine hairline
          gold:          '#7FDCA8', // accent ON dark (brand green, lifted for contrast)
          'gold-light':  '#E8E8ED', // primary text on dark
          gray:          '#9BA0A6', // secondary text on dark — ≥4.6:1 on #0E1420
          green:         '#34A574',
          'green-light': '#7FD4AE',
        },

        // Analysis panels. Light, cool, and coded from the exhibit ramp.
        hume: {
          base:    '#F5F5F7',
          surface: '#FFFFFF',
          card:    '#F8F9FB',
          border:  '#E3E6ED',
          gold:    '#B45309',
          teal:    '#0F766E',
          coral:   '#B3261E',
          indigo:  '#4338CA',
          amber:   '#B45309',
          muted:   '#5C6879',
          text:    '#0E1420',
          live:    '#15803D',
        },
      },

      fontFamily: {
        // Archivo — an institutional grotesque with real character, sourced and
        // self-hostable. Not a system face, not a training-data default.
        // One family, two voices. The display voice is the SAME face with its
        // width axis widened (see index.css) — not a second font.
        sans:    ['Archivo', 'system-ui', 'sans-serif'],
        display: ['Archivo', 'system-ui', 'sans-serif'],
        head:    ['Archivo', 'system-ui', 'sans-serif'],
        // Machine values only: line numbers, citations, scores, IDs, timers.
        // Measurement, never a costume for "technical".
        mono:    ['Chivo Mono', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
        xs:    ['0.75rem',   { lineHeight: '1.125rem' }],
        sm:    ['0.8125rem', { lineHeight: '1.25rem' }],
        base:  ['0.9375rem', { lineHeight: '1.5rem' }],
        lg:    ['1.0625rem', { lineHeight: '1.625rem' }],
        xl:    ['1.25rem',   { lineHeight: '1.75rem',  letterSpacing: '-0.015em' }],
        '2xl': ['1.5rem',    { lineHeight: '1.9rem',   letterSpacing: '-0.02em' }],
        '3xl': ['1.875rem',  { lineHeight: '2.25rem',  letterSpacing: '-0.025em' }],
        '4xl': ['2.375rem',  { lineHeight: '2.65rem',  letterSpacing: '-0.03em' }],
        '5xl': ['3.25rem',   { lineHeight: '1.08',     letterSpacing: '-0.035em' }],
        '6xl': ['4.25rem',   { lineHeight: '1.02',     letterSpacing: '-0.04em' }],
      },

      spacing: { '4.5': '1.125rem', '13': '3.25rem', '15': '3.75rem', '18': '4.5rem', 'spine': '15rem' },

      // Documents and tabs, not pills. The pill grammar was the inherited
      // brand's signature and leaves with it.
      borderRadius: {
        sm: '6px', DEFAULT: '8px', md: '10px', lg: '12px', xl: '16px', '2xl': '20px', '3xl': '24px',
      },

      boxShadow: {
        // Paper stacking on paper: real offset, soft blur, cool ink tone.
        xs:   '0 1px 1px 0 rgb(14 20 32 / 0.04)',
        sm:   '0 1px 2px 0 rgb(14 20 32 / 0.06), 0 1px 3px -1px rgb(14 20 32 / 0.05)',
        DEFAULT: '0 2px 4px -1px rgb(14 20 32 / 0.07), 0 1px 2px -1px rgb(14 20 32 / 0.05)',
        md:   '0 4px 10px -2px rgb(14 20 32 / 0.09), 0 2px 4px -2px rgb(14 20 32 / 0.05)',
        lg:   '0 12px 32px -8px rgb(14 20 32 / 0.11), 0 4px 10px -4px rgb(14 20 32 / 0.05)',
        xl:   '0 32px 64px -16px rgb(14 20 32 / 0.15), 0 12px 24px -12px rgb(14 20 32 / 0.07)',
        inner:'inset 0 1px 2px 0 rgb(14 20 32 / 0.06)',
        // The lift under a raised record while it is being read.
        'record':    '0 1px 0 0 #E7E7EA, 0 6px 16px -6px rgb(14 20 32 / 0.08)',
        'primary-sm':'0 2px 6px -2px rgb(11 122 69 / 0.28)',
        'primary-md':'0 4px 12px -4px rgb(11 122 69 / 0.32)',
        'mint-sm':   '0 2px 8px -2px rgb(15 118 110 / 0.30)',
      },

      backgroundImage: {
        // Fields, never text. The spine's slipcase and the ruled gutter.
        'brand-field': 'linear-gradient(168deg,#0E1420 0%,#171B20 58%,#1E2328 100%)',
        'brand-band':  'linear-gradient(90deg,#085F36 0%,#0B7A45 50%,#1F9059 100%)',
        'rule-gutter': 'repeating-linear-gradient(to bottom,transparent 0,transparent 27px,#E7E7EA 27px,#E7E7EA 28px)',
      },

      ringColor: { primary: '#0B7A45' },
      zIndex: { '5': '5' },

      // Motion: one authored moment — the record turning to a cited line.
      // Everything else is a state change, not a performance.
      transitionTimingFunction: {
        'record': 'cubic-bezier(0.16, 1, 0.3, 1)',   // exponential ease-out
        'turn':   'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      animation: {
        'fade-in':        'fadeIn 0.2s cubic-bezier(0.16,1,0.3,1)',
        'slide-up':       'slideUp 0.28s cubic-bezier(0.16,1,0.3,1)',
        'pulse-soft':     'pulse 3s ease-in-out infinite',
        'spin-slow':      'spin 2s linear infinite',
        'pulse-live':     'pulseLive 1.6s ease-in-out infinite',
        'radar-expand':   'radarExpand 0.5s cubic-bezier(0.16,1,0.3,1) forwards',
        'count-up':       'countUp 0.35s cubic-bezier(0.16,1,0.3,1) forwards',
        'slide-in-right': 'slideInRight 0.3s cubic-bezier(0.16,1,0.3,1) forwards',
        'typing-dot':     'typingDot 1.4s ease-in-out infinite',
        // The signature: a cited line is exposed, not faded in.
        'cite-open':      'citeOpen 0.42s cubic-bezier(0.32,0.72,0,1) forwards',
        'tab-seat':       'tabSeat 0.3s cubic-bezier(0.16,1,0.3,1) forwards',
      },
      keyframes: {
        fadeIn:       { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:      { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulseLive:    { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
        radarExpand:  { from: { transform: 'scale(0.7)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        countUp:      { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideInRight: { from: { opacity: '0', transform: 'translateX(14px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        typingDot:    { '0%, 60%, 100%': { opacity: '0.3' }, '30%': { opacity: '1' } },
        // clip-path, not height: the record opens to the cited line.
        citeOpen:     { from: { opacity: '0', clipPath: 'inset(0 0 100% 0)' }, to: { opacity: '1', clipPath: 'inset(0 0 0 0)' } },
        tabSeat:      { from: { transform: 'translateY(3px)' }, to: { transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
