/**
 * The interview formats the site advertises.
 *
 * Its own module, and free of React and CSS on purpose. This list is data that
 * two very different consumers need — the format cards in MimicSite.tsx and the
 * scroll showcase in showcase/modes.ts — and `npm test` runs plain tsx in Node
 * with no DOM, so anything that reaches this through a component module drags a
 * CSS import in with it and cannot be tested at all. That is exactly how it
 * failed the first time.
 */
/* ── Interview formats. Six advertised tracks; the statement card states the
      rule they obey, so it spans the row rather than repeating the pattern.

      The product also has a one-way `video` track, which the site deliberately
      does not advertise — it has no nav entry and no platform page, so listing
      it here sent buyers looking for a page that was never written.

      `mcq` was in that same position until today and is not any more: it has a
      page now (/platform/assessments), so it is advertised as Assessments, the
      name the product's own nav uses. The advertised count is pinned by the
      assertion in demoAssets.test.ts — NOT by scripts/audit-marketing-claims.ts,
      which this comment used to cite and which does not exist. */
/* No per-track colour here any more.
   These five entries used to carry a `bg`/`fg` pair each — teal, indigo, pink,
   sky and amber — applied as an inline style to the icon chip. That is the same
   five-hue palette the token file just retired, living a second life in a data
   array where a grep for `--mm-ex-` could not find it, and it put five
   saturated chips in a row on the most-read section of the site.

   The chips are neutral now and the glyph does the work: chat, mic, video,
   users, clock already say which format each card is, and a glyph is
   information where a hue with no legend is decoration. The one colour event
   per card is the accent arriving under the pointer. */
export const TRACKS = [
  { name: 'Conversational chat', tag: 'Async', icon: 'chat' as const, track: 'chatbot' as const,
    desc: 'A text interview candidates finish on a phone in minutes. Best for hourly and high volume roles.',
    meta: ['No scheduling', 'Mobile first'] },
  { name: 'Voice screening', tag: 'Async', icon: 'mic' as const, track: 'voice' as const,
    desc: 'A spoken conversation with an AI interviewer. Answers are transcribed, then scored on content and delivery together.',
    meta: ['Live transcript', 'Interruptible'] },
  { name: 'AI video avatar', tag: 'Async', icon: 'video' as const, track: 'video_avatar' as const,
    desc: 'A configured presenter asks each question on camera, reacts to the answer, and follows up when one is thin.',
    meta: ['Personas', 'Replicas'] },
  { name: 'Live two-way call', tag: 'Live', icon: 'users' as const, track: 'two_way' as const,
    desc: 'Your interviewer leads a real video call. Mimic records it with consent, transcribes it and scores the same rubric.',
    meta: ['Host room', 'Star rating'] },
  { name: 'Timed Q&A', tag: 'Async', icon: 'clock' as const, track: 'chat' as const,
    desc: 'Preparation and answer timers on every question, identical for every candidate. For work that happens under a clock.',
    meta: ['Timer on every question', 'Integrity checks'] },
  /* `calc` rather than a clipboard glyph: icons.tsx has no clipboard, and
     arithmetic is the honest metaphor for a paper that is marked rather than
     judged. Do not invent an icon key — Ico renders nothing for an unknown one
     and the card would ship with an empty chip. */
  { name: 'Assessments', tag: 'Async', icon: 'calc' as const, track: 'mcq' as const,
    desc: 'A timed multiple-choice paper, marked the moment it is submitted. For knowledge you can check rather than discuss.',
    meta: ['Marked on submission', 'Server-side timing'] },
]
