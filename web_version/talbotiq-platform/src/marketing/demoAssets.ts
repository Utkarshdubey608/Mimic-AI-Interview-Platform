/**
 * Mirrors TrackType in the web application's shared/types.ts.
 *
 * Declared locally rather than imported: this site is a separate app with no
 * path into the product's source, and one string union is a smaller price
 * than a build-time dependency on a package it does not otherwise need. If a
 * track is ever added there, add it here too.
 */
type TrackType = 'chat' | 'chatbot' | 'video_avatar' | 'voice' | 'video' | 'two_way' | 'mcq'

/**
 * Which format each demo video shows, and where it lives.
 *
 * One naming contract, consumed by three call sites — the hero, the format
 * cards on /mimic, and the Platform track pages — plus the recorder that
 * produces the files. Keys are the product's own TrackType values, so a format
 * is named the same thing in the seed data, the recorder and the site.
 *
 * `video` (one-way recorded video) is still absent on purpose: it has no nav
 * entry and no platform page, so advertising it would send buyers looking for a
 * page nobody has written.
 *
 * `mcq` was in the same position and is not any more. It is a first-class track
 * in the product — shared/types.ts lists it in TrackType, McqStage.tsx is its
 * candidate screen, and /mcq-sets is where a recruiter authors one under the
 * name "Assessments" — so it is advertised here, with the platform page written
 * to match (see plat('assessments', …) in content.ts).
 *
 * The note this replaces said adding a track meant "restoring the count in
 * scripts/audit-marketing-claims.ts". That file does not exist. The count that
 * actually holds this honest is the assertion in demoAssets.test.ts, which is
 * run by `npm test`.
 */
export type DemoTrack = Extract<TrackType, 'chatbot' | 'voice' | 'video_avatar' | 'two_way' | 'chat' | 'mcq'>

export const DEMO_TRACKS: readonly DemoTrack[] = ['chatbot', 'voice', 'video_avatar', 'two_way', 'chat', 'mcq']

/**
 * Which formats actually have footage on disk right now.
 *
 * Separate from DEMO_TRACKS on purpose. All five are advertised formats and all
 * five have copy written; only these four have footage. A format missing from
 * this list renders exactly as it did before there were any videos — a static
 * card, a page with no demo block — rather than a broken player.
 *
 * video_avatar was captured by hand rather than by the recorder (the Tavus
 * account had no conversational credits when the automated pass ran), so it has
 * no screenshot-derived poster; its still came from scripts/poster-from-video.mjs.
 *
 * Still not recorded, for an external reason rather than a product one:
 *  · two_way — the host room reports "Failed to join the call" when the Daily
 *    room is joined by an automated browser, headless or headed. The candidate
 *    side works and reaches the waiting room; it is the recruiter's join that
 *    fails. Needs a look at the Daily configuration.
 *
 * Add the track here once its file lands in public/mimic-shots/, and nothing
 * else needs to change — the hero, the cards and the platform pages all read
 * this.
 */
export const RECORDED_TRACKS: readonly DemoTrack[] = ['chatbot', 'voice', 'video_avatar', 'chat', 'mcq']

/** Does this format have footage to play? */
export const hasDemo = (t: DemoTrack): boolean => RECORDED_TRACKS.includes(t)

export const demoVideoSrc = (t: DemoTrack): string => `/mimic-shots/mode-${t}.webm`
export const demoPosterSrc = (t: DemoTrack): string => `/mimic-shots/mode-${t}-poster.webp`

/**
 * Caption, alt text and disclosure per format.
 *
 * The alt text describes what is ON SCREEN, because for a reader who cannot see
 * the video it IS the video. "A demo of voice screening" tells them nothing.
 *
 * `disclosure` is the chip beside the caption. It defaults to "Synthetic
 * candidates" in DemoVideo, which is true of every recording the automated pass
 * produced — those interview a fabricated candidate against the synthetic store.
 * It is NOT true of footage of a real person, and a site that ships
 * scripts/audit-marketing-claims.ts cannot caption a real face with a claim that
 * it is synthetic. Set this whenever the footage does not match the default.
 */
export const DEMO_COPY: Record<DemoTrack, {
  caption: string
  alt: string
  disclosure?: string
  /**
   * The aspect ratio of the REAL CONTENT inside the file, set only when the
   * footage has letterbox bars baked into it.
   *
   * The recorder produces clean 1280x800 frames, but hand-captured footage
   * carries whatever the capture tool framed — `video_avatar` is a 16:9 file
   * whose picture is 2.19:1, so 18.9% of every frame is black. That is
   * invisible in a thumbnail and impossible to ignore once the footage runs at
   * full width, which is exactly where this site now puts it.
   *
   * Applied as `aspect-ratio` + `object-fit: cover`, so the player crops the
   * bars at DISPLAY time. Re-encoding would be the real fix, but it needs an
   * ffmpeg that can decode VP9 and the one bundled with Playwright cannot —
   * see the note in scripts/poster-from-video.mjs. The poster still is cut
   * from the same frames, so it carries the same bars and the same crop.
   */
  contentAspect?: string
}> = {
  chatbot: {
    caption: 'A typed answer, and the interviewer’s follow-up written from what the candidate actually said.',
    alt: 'A Mimic conversational chat interview: the candidate types an answer about moving an agitated patient just out of surgery to a quiet bay, sends it, and the AI interviewer replies with a follow-up question drawn from that specific answer rather than moving to the next scripted question.',
  },
  voice: {
    caption: 'A spoken answer, transcribed as it is said, with the interviewer replying to it.',
    alt: 'A Mimic voice interview in progress: a reactive orb showing the listening state, and a live captions panel filling with the candidate’s spoken answer transcribed in real time, followed by the AI interviewer’s spoken reply to it.',
  },
  video_avatar: {
    caption: 'A configured presenter asking the question on camera.',
    alt: 'A Mimic AI video avatar interview: a presenter on camera asks the candidate a behavioural question, with the candidate’s own camera tile alongside and the interview controls beneath.',
    // This footage was captured by hand, and the candidate in the corner tile is
    // a real person who agreed to appear — not the synthetic candidate the
    // recorder drives. The presenter is still a Tavus replica; the disclosure
    // covers the human, which is the part a viewer could be misled about.
    disclosure: 'Real interview, used with permission',
    // 3840x2160 file, 3840x1752 picture — measured, not guessed: the bars are
    // 9.44% top and bottom, symmetric, so an even cover-crop lands exactly.
    contentAspect: '3840 / 1752',
  },
  two_way: {
    caption: 'A live call with a real interviewer, recorded with consent and scored on the same rubric.',
    alt: 'A Mimic live two-way interview from the candidate’s side: the recruiter’s video tile, the candidate’s own tile, and the live call controls showing the call is being recorded.',
  },
  mcq: {
    caption: 'A four-question paper, answered one question at a time and marked the moment it is submitted.',
    alt: 'A Mimic assessment paper being sat: one multiple-choice question at a time with lettered options, a progress rail and an answers-saved tick above it, the candidate choosing an answer and moving on, a warning on the last question that one is still unanswered, and a confirmation once the paper is submitted.',
  },
  chat: {
    caption: 'The preparation timer, the STAR prompt, and the answer box that unlocks when the clock starts.',
    alt: 'A Mimic timed Q&A interview: the question about de-escalating a situation on a night shift, a preparation countdown running down, a STAR structure tip, and an answer box that stays locked until the answer timer begins.',
  },
}
