/** @type {import('tailwindcss').Config} */
//
// MIMIC — Tailwind binding for the token layer.
//
// The values live in `src/design/tokens.css`. This file only BINDS them to
// utility names, and it does so through `var(--…)` wherever a value should
// follow the ground.
//
// ── Why var() and not literals ────────────────────────────────────────────
// The product has two grounds — the light record surface and the dark room —
// and a subtree opts in with `data-ground="room"`. Because the semantic colours
// below resolve through custom properties, that one attribute re-skins every
// descendant: `bg-surface` becomes a lit panel, `text-ink` becomes near-white,
// `border-rule` darkens. No component needs a dark: variant, no screen needs a
// second set of classes, and the two worlds cannot drift apart.
//
// ── Why the legacy names survive ──────────────────────────────────────────
// `primary`, `neutral`, `brand`, `mint`, `magenta`, `accent`, `hume` and the
// exhibit ramp are consumed by ~39 files. They are kept, and re-pointed at the
// new values, so the migration is incremental instead of a big bang. The names
// are historical; the values are current. New code should prefer the semantic
// tokens (`ink`, `surface`, `ground`, `rule`, `signal`, `intel`, `live`).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ── SEMANTIC — these follow the ground ──────────────────────────
           Prefer these in all new code. On the record ground they resolve to
           exactly the values the product ships today, so adopting them is not a
           visual change; in a room they resolve to the dark palette. */
        ground: {
          DEFAULT: 'var(--ground)',
          sunk: 'var(--ground-sunk)',
        },
        surface: {
          DEFAULT: 'var(--surface)',
          raised: 'var(--surface-raised)',
          sunk: 'var(--surface-sunk)',
          hover: 'var(--surface-hover)',
        },
        rule: {
          DEFAULT: 'var(--rule)',
          strong: 'var(--rule-strong)',
          input: 'var(--rule-input)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          body: 'var(--ink-body)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
          disabled: 'var(--ink-disabled)',
          inverse: 'var(--ink-inverse)',
        },

        /* The primary action. INK, not a colour — this is the marketing site's
           .btn-primary, and it inverts to near-white inside a dark room exactly
           as that site's own dark sections do. */
        action: {
          DEFAULT: 'var(--action)',
          hover: 'var(--action-hover)',
          ink: 'var(--on-action)',
          /* The control's own boundary. Equal to the fill for the default
             scheme, so the border is present and invisible; a chosen pastel
             gives it the deep tone of that hue, because a pastel fill cannot
             reach 3:1 against a white page and WCAG 1.4.11 asks for the
             boundary, not the fill. Gated in src/design/schemes.test.ts. */
          edge: 'var(--action-edge, var(--action))',
        },

        /* Registrar blue. Links, the focus ring, the progress rail. Never a
           large fill — that is what `action` is for. */
        signal: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
          ink: 'var(--accent-ink)',
        },
        /* Machine output. Deliberately neutral: the marketing site has no
           violet, so AI provenance is carried by a glyph and a word instead of
           by a hue that exists nowhere else in the brand. */
        intel: {
          DEFAULT: 'var(--intel-fg)',
          bg: 'var(--intel-bg)',
        },
        live: {
          DEFAULT: 'var(--live-fg)',
          bg: 'var(--live-bg)',
        },

        /* Status. Every one of these has a glyph and a word alongside it in the
           UI — see `status` in src/design/tokens.ts. Colour is never alone. */
        ok:   { DEFAULT: 'var(--ok)',   bg: 'var(--ok-bg)',   rule: 'var(--ok-rule)' },
        warn: { DEFAULT: 'var(--warn)', bg: 'var(--warn-bg)', rule: 'var(--warn-rule)' },
        risk: { DEFAULT: 'var(--risk)', bg: 'var(--risk-bg)', rule: 'var(--risk-rule)' },

        /* Machine presence — the AI accent. Functional state coding only:
           AI speaking/listening/thinking, AI-written content, the intelligence
           signal. Never a large fill. Gated by scripts/contrast-audit.mjs. */
        ai: { DEFAULT: 'var(--ai-fg)', bg: 'var(--ai-bg)', rule: 'var(--ai-rule)' },

        /* ── EXHIBIT RAMP — the six interview formats ────────────────────
           Index-tab coding: the colour IS the format. The only place saturation
           is permitted, and never decorative. Both grounds are contrast-verified
           by scripts/contrast-audit.mjs. */
        exhibit: {
          chat:    '#B45309',  'chat-room':    '#E9A23B',
          chatbot: '#0F766E',  'chatbot-room': '#45C7B8',
          voice:   '#4338CA',  'voice-room':   '#9B8CFF',
          avatar:  '#BE185D',  'avatar-room':  '#F97BB0',
          video:   '#15803D',  'video-room':   '#5CC98A',
          twoway:  '#0369A1',  'twoway-room':  '#5BB3E8',
        },

        /* ── LEGACY ALIASES ──────────────────────────────────────────────
           Kept so existing consumers re-skin without edits. Do not use in new
           code; the semantic tokens above say what they mean. */

        // The primary action ramp — INK, and neutral all the way down.
        //
        // This was the registrar blue (#1D3FA0). It is the single most widely
        // consumed legacy alias in the recruiter app — the wizard's step markers,
        // its selected cards, segmented controls, chips and the résumé notice all
        // read `primary-*` — so its value alone decides whether that half of the
        // product looks like the marketing site or like the palette that left with
        // the registrar system.
        //
        // It went back to blue by accident: the candidate-stage rebuild was authored
        // against the Aug-16 tree and carried the old config with it, so merging that
        // branch reverted a decision taken deliberately in `ade62e24` ("ink primary
        // actions"). Same values as the semantic `--action` above; kept as a scale
        // because the callers want tints (`primary-50`, `primary-100`) a single token
        // cannot give them.
        primary: { DEFAULT: '#0E1420', 50: '#F5F5F7', 100: '#ECECEF', 200: '#DFDFE3', 300: '#C7C8CD', 400: '#8A8F98', 500: '#61666E', 600: '#3B4046', 700: '#0E1420', 800: '#23272E', 900: '#0E1420' },

        // Cool neutral ramp — paper under daylight. Static by design: a fixed
        // ramp is what a chart axis or a skeleton needs. Ground-following text
        // should use `ink`/`ink-body`/`ink-muted` instead.
        //
        // 400 is #626B79, not a lighter grey: an audit measured the previous
        // #6E7889 at 4.46:1 on white and 3.91:1 on the page ground across 173
        // `text-neutral-400` usages — below AA on both. 300 and below are
        // decorative only (hairlines, tracks, skeletons), never text.
        neutral: { 50: '#F8F9FB', 100: '#F1F3F7', 200: '#E3E6ED', 300: '#CBD1DC', 400: '#626B79', 500: '#5C6879', 600: '#4A5566', 700: '#3A4454', 800: '#232C3A', 900: '#0E1420' },

        background: 'var(--ground)',
        border:     'var(--rule)',

        success: { DEFAULT: '#15803D', bg: '#EFF7F1', border: '#C9E5D2' },
        warning: { DEFAULT: '#8A4308', bg: '#FDF5EA', border: '#F0DBBC' },
        danger:  { DEFAULT: '#B3261E', bg: '#FCF0EF', border: '#F0CFCC' },
        seal:    { DEFAULT: '#B3261E', bg: '#FCF0EF', border: '#F0CFCC' },

        magenta: { DEFAULT: '#BE185D', light: '#DB2777', bg: '#FCF0F5', border: '#F3CFE0' },
        mint:    { DEFAULT: '#0F766E', hover: '#0B5F58', ink: '#0F766E', bg: '#EDF6F5', border: '#C4E3E0' },
        accent:  { DEFAULT: '#B45309', light: '#FDF5EA', pale: '#FEFAF4' },

        // The dark room. `brand.*` names are legacy; the values are now the room
        // ground from tokens.css, so every existing dark screen — the spine, the
        // avatar room, the live call — deepens and unifies without an edit.
        brand: {
          black:         '#0B0F18', // room ground
          card:          '#131A27', // lit panel
          border:        '#232D3F', // room hairline
          gold:          '#8AA6F0', // accent on dark
          'gold-light':  '#EDF1F8', // primary text on dark
          gray:          '#93A0B4', // secondary text on dark — 6.6:1 on a panel
          green:         '#0F766E',
          'green-light': '#4FD1B0',
          void:          '#070A11', // behind a video canvas
          raised:        '#1A2333', // a panel above a panel
        },

        // Analysis panels — light, cool, coded from the exhibit ramp.
        hume: {
          base: '#EEF0F4', surface: '#FFFFFF', card: '#F8F9FB', border: '#E3E6ED',
          gold: '#B45309', teal: '#0F766E', coral: '#B3261E', indigo: '#4338CA',
          amber: '#B45309', muted: '#5C6879', text: '#0E1420', live: '#15803D',
        },
      },

      fontFamily: {
        // One family, two voices. The display voice is the SAME face with its
        // width axis widened (see index.css) — not a second font, so nothing
        // extra is downloaded to get an editorial heading.
        sans:    ['Archivo', 'system-ui', 'sans-serif'],
        display: ['Archivo', 'system-ui', 'sans-serif'],
        head:    ['Archivo', 'system-ui', 'sans-serif'],
        // Machine values only: scores, timers, IDs, timestamps, line numbers.
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

      spacing: {
        '4.5': '1.125rem', '13': '3.25rem', '15': '3.75rem', '18': '4.5rem',
        spine: 'var(--spine-w)',
        'spine-collapsed': 'var(--spine-w-collapsed)',
        commandbar: 'var(--commandbar-h)',
      },

      maxWidth: {
        page: 'var(--page-max)',
        reading: 'var(--page-max-reading)',
      },

      // Documents and tabs, not pills. The largest radius is 12px and belongs to
      // the video canvas; `rounded-full` is legal ONLY on avatars, status dots
      // and the voice orb.
      borderRadius: {
        sm: '2px', DEFAULT: '3px', md: '4px', lg: '6px', xl: '8px', '2xl': '10px', '3xl': '12px',
      },

      boxShadow: {
        // Elevation follows the ground: on paper it is an offset drop shadow, in
        // a room it is a light-catching top hairline, because a drop shadow on
        // near-black is invisible. Both are declared in tokens.css.
        xs:   'var(--elev-1)',
        sm:   'var(--elev-2)',
        DEFAULT: 'var(--elev-2)',
        md:   'var(--elev-3)',
        lg:   'var(--elev-4)',
        xl:   'var(--elev-5)',
        record: 'var(--elev-3)',
        accent: 'var(--elev-accent)',
        inner: 'inset 0 1px 2px 0 rgb(14 20 32 / 0.06)',
        'primary-sm': 'var(--elev-accent)',
        'primary-md': 'var(--elev-accent-strong)',
        'mint-sm':    '0 2px 8px -2px rgb(15 118 110 / 0.30)',
      },

      backgroundImage: {
        'brand-field': 'linear-gradient(168deg,#0B0F18 0%,#131A27 58%,#1B2842 100%)',
        'brand-band':  'linear-gradient(90deg,#0E1420 0%,#1D3FA0 55%,#3D5CB4 100%)',
        'rule-gutter': 'repeating-linear-gradient(to bottom,transparent 0,transparent 27px,var(--rule) 27px,var(--rule) 28px)',
      },

      ringColor:   { DEFAULT: 'var(--focus-ring)', primary: 'var(--focus-ring)' },
      ringOffsetColor: { DEFAULT: 'var(--surface)' },
      borderColor: { DEFAULT: 'var(--rule)' },

      // A named scale. Nothing may write a bare z-index number.
      zIndex: {
        5: '5',
        raised: 'var(--z-raised)', sticky: 'var(--z-sticky)', spine: 'var(--z-spine)',
        overlay: 'var(--z-overlay)', modal: 'var(--z-modal)', drawer: 'var(--z-drawer)',
        palette: 'var(--z-palette)', toast: 'var(--z-toast)', hud: 'var(--z-stage-hud)',
      },

      transitionTimingFunction: {
        record: 'var(--ease-out)',
        out:    'var(--ease-out)',
        turn:   'var(--ease-turn)',
        'in-out': 'var(--ease-in-out)',
      },
      transitionDuration: {
        instant: 'var(--dur-instant)',
        fast:    'var(--dur-fast)',
        base:    'var(--dur-base)',
        slow:    'var(--dur-slow)',
      },

      // Motion is a state change, not a performance. Every keyframe below is
      // transform or opacity only, so none of them can trigger layout.
      animation: {
        'fade-in':        'fadeIn var(--dur-base) var(--ease-out)',
        'slide-up':       'slideUp var(--dur-base) var(--ease-out)',
        'pulse-soft':     'pulse 3s var(--ease-in-out) infinite',
        'spin-slow':      'spin 2s linear infinite',
        'pulse-live':     'pulseLive 1.6s var(--ease-in-out) infinite',
        'radar-expand':   'radarExpand var(--dur-slow) var(--ease-out) forwards',
        'count-up':       'countUp 0.35s var(--ease-out) forwards',
        'slide-in-right': 'slideInRight var(--dur-base) var(--ease-out) forwards',
        'typing-dot':     'typingDot 1.4s var(--ease-in-out) infinite',
        // The signature: evidence is EXPOSED, not faded in.
        'cite-open':      'citeOpen var(--dur-slow) var(--ease-turn) forwards',
        'tab-seat':       'tabSeat var(--dur-base) var(--ease-out) forwards',
        // Ambient. Slow enough to read as atmosphere rather than as animation.
        'drift':          'drift 28s var(--ease-in-out) infinite',
        'drift-slow':     'drift 44s var(--ease-in-out) infinite reverse',
        'breathe':        'breathe 6s var(--ease-in-out) infinite',
        'sheen':          'sheen 2.4s var(--ease-in-out) infinite',
      },
      keyframes: {
        fadeIn:       { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:      { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulseLive:    { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
        radarExpand:  { from: { transform: 'scale(0.7)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        countUp:      { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideInRight: { from: { opacity: '0', transform: 'translateX(14px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        typingDot:    { '0%, 60%, 100%': { opacity: '0.3' }, '30%': { opacity: '1' } },
        citeOpen:     { from: { opacity: '0', clipPath: 'inset(0 0 100% 0)' }, to: { opacity: '1', clipPath: 'inset(0 0 0 0)' } },
        tabSeat:      { from: { transform: 'translateY(3px)' }, to: { transform: 'translateY(0)' } },
        drift: {
          '0%':   { transform: 'translate3d(0,0,0) scale(1)' },
          '50%':  { transform: 'translate3d(2%,-3%,0) scale(1.06)' },
          '100%': { transform: 'translate3d(0,0,0) scale(1)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.55' },
          '50%':      { transform: 'scale(1.05)', opacity: '0.8' },
        },
        sheen: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
  plugins: [],
}
