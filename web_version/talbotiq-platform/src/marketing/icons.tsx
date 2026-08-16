/**
 * Marketing icon set — one drawn family, one stroke weight.
 *
 * Every glyph is a 24×24 outline at 1.75 stroke with round caps and joins, so
 * the whole site reads as a single hand. Nothing here is an emoji or a unicode
 * character standing in for a mark. Size and colour come from the CSS rule that
 * owns the slot (`width`/`height`/`color`), never from props, so an icon always
 * matches the text it sits beside.
 */

export type IconName =
  | 'check' | 'chat' | 'mic' | 'video' | 'users' | 'clock'
  | 'quote' | 'scale' | 'calc' | 'alert' | 'pin' | 'info'
  | 'shield' | 'history' | 'arrow' | 'chevron' | 'close' | 'menu'

const PATHS: Record<IconName, JSX.Element> = {
  check: <path d="M20 6 9 17l-5-5" />,

  chat: <><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.7-5a8.2 8.2 0 0 1-.7-3.5 8.4 8.4 0 0 1 8.4-8.4h.6a8.4 8.4 0 0 1 8 8Z" /></>,

  mic: <>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M19 10.5a7 7 0 0 1-14 0M12 17.5V22M8.5 22h7" />
  </>,

  video: <>
    <rect x="2" y="5" width="14" height="14" rx="3" />
    <path d="m16 10.5 5.2-3v9l-5.2-3z" />
  </>,

  users: <>
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.5 20.5a6.5 6.5 0 0 1 13 0" />
    <path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6M18 14.6a6.5 6.5 0 0 1 3.5 5.9" />
  </>,

  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.4 2" /></>,

  quote: <>
    <path d="M9.5 6.5C6.9 7.7 5.5 10 5.5 13v4.5h5.2V12H8.1c0-2 .6-3.4 2.2-4.2z" />
    <path d="M19 6.5c-2.6 1.2-4 3.5-4 6.5v4.5h5.2V12h-2.6c0-2 .6-3.4 2.2-4.2z" />
  </>,

  scale: <>
    <path d="M12 4v16M6.5 20h11" />
    <path d="M5 8h14M5 8 2.5 14h5L5 8ZM19 8l-2.5 6h5L19 8Z" />
  </>,

  calc: <>
    <rect x="4" y="2.5" width="16" height="19" rx="2.6" />
    <path d="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" />
  </>,

  alert: <>
    <path d="M12 3.5 2.8 19.2A1.4 1.4 0 0 0 4 21.3h16a1.4 1.4 0 0 0 1.2-2.1L12 3.5Z" />
    <path d="M12 9.6v4.2M12 17.6h.01" />
  </>,

  pin: <>
    <path d="M12 21.5s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
    <circle cx="12" cy="10.2" r="2.6" />
  </>,

  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11.2v5M12 7.8h.01" /></>,

  shield: <>
    <path d="M12 2.8 4.5 6v6c0 4.6 3.2 8.3 7.5 9.4 4.3-1.1 7.5-4.8 7.5-9.4V6L12 2.8Z" />
    <path d="m9 12 2.2 2.2L15.4 10" />
  </>,

  history: <>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3 8.8" />
    <path d="M3 4.5v4.3h4.3M12 7.6V12l3.2 1.9" />
  </>,

  arrow: <path d="M4.5 12h15m-6-6.2 6 6.2-6 6.2" />,

  chevron: <path d="m6 9.5 6 6 6-6" />,

  close: <path d="M18 6 6 18M6 6l12 12" />,

  menu: <path d="M3.5 7h17M3.5 12h17M3.5 17h17" />,
}

export function Ico({ n, className }: { n: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[n]}
    </svg>
  )
}
