/* ══════════════════════════════════════════════════════════════════════════
   DIRECTION CONTRACT — /mimic marketing site (Persuade)

   THESIS: This page proves the scoring mechanism instead of asserting outcomes.
   It refuses the category default — a hero metric band of borrowed customer
   statistics — because none of ours are real, and shows the rubric marking a
   real answer instead.
   OWN-WORLD: Inherited from the parent brand, Eightfold AI, as shipped. Pale
   lavender ground, a violet→magenta gradient owning whole fields, mint-green
   primary actions on dark ink, fully-rounded pill controls, eyebrow pills above
   headings, Figtree throughout, drawn icons only. (An earlier pass rebased this
   on blue from a text description of the parent site; that was wrong.)
   STORY: A mid-market recruiter understands within one viewport that every
   applicant gets interviewed and scored on one rubric, sees the scoring shown
   rather than claimed, and books a demo.
   FIRST VIEWPORT: Headline left at 68px with sub and two actions; right, a real
   Sessions frame with scored candidates, labelled sample data. Primary action
   sits above the fold on the left.
   FORM: Parent-brand inheritance — pinned by the user, so no concept roll ran.
   FINISH: unreviewed and undocumented is unfinished; this build ends with the
   finish review, the verdict, and DESIGN.md.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
// The application's own API-origin helper. It resolves to exactly the same
// `/api/web` prefix the standalone site's apiBase() produced, so the lead POST
// is unchanged on the wire — one helper now rather than two identical ones.
import { httpBase } from '@/lib/apiOrigin'
import './mimicSite.css'
import { MarketingLayout } from './MarketingLayout'
import { CursorLight, Magnetic, Parallax, Reveal, Tilt, useInView } from './motion'
import { PinnedStage, SplitText } from './scroll'
import { Field } from './Field'
import { HeroIntelligence } from './HeroIntelligence'
import { HeroStage } from './hero3d/HeroStage'
import { DemoVideo } from './DemoVideo'
import { DEMO_COPY, demoPosterSrc, demoVideoSrc, hasDemo } from './demoAssets'
import { HOME_SEO } from './content'
import { Ico } from './icons'

/* ── Interview formats. Five advertised tracks; the sixth card states the rule
      the other five obey, so it spans the row rather than repeating the pattern.

      The product also has a one-way `video` track, which the site deliberately
      does not advertise — it has no nav entry and no platform page, so listing
      it here sent buyers looking for a page that was never written. Adding it
      back means writing that page and restoring the count in scripts/
      audit-marketing-claims.ts, which pins the advertised number to five. */
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
const TRACKS = [
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
]

/* Five cards do not divide into the 3-column grid, so the last one widens to
   close the row instead of leaving a hole above the statement card. Derived
   from the count rather than hard-coded, so adding or removing a track keeps
   the grid whole: a trailing remainder of 2 widens the last card, a remainder
   of 1 leaves it alone (a lone card on its own row reads as intentional). */
const WIDEN_LAST = TRACKS.length % 3 === 2

/* ── The five steps of the real workflow, with the actual route each lives on. */
const STEPS = [
  { t: 'Configure once', r: 'Templates',
    b: 'Pick the format, where questions come from, the rubric weights and the timing. Save it as a template your whole team reuses.',
    d: ['Five interview formats on one configuration', 'Weighted criteria you define, rescaled automatically', 'Branding and integrity rules per template'] },
  { t: 'Invite in bulk', r: 'Sessions → Invite candidates',
    b: 'Drop in a spreadsheet or an ATS export. Mimic reads every address, personalises each email and sends a link bound to that candidate.',
    d: ['CSV, Excel, PDF, DOCX or plain text', 'Each link opens only for the address it was sent to', 'Test the exact email on yourself before sending'] },
  { t: 'Interview on their schedule', r: 'The candidate’s link',
    b: 'Candidates interview at eleven at night on a phone if that is what works. Adaptive interviews read their resume and ask about what it claims.',
    d: ['No scheduling, no app to install', 'Progress survives a refresh or a dropped connection', 'Timing is measured on the server, so it cannot be extended'] },
  { t: 'Score every answer', r: 'Report',
    b: 'One rubric, applied identically. Each criterion carries the answer it came from, alongside the transcript and delivery metrics.',
    d: ['A breakdown for every question, with written feedback', 'Speech metrics computed from the real transcript', 'Marked plainly when scoring ran without AI'] },
  { t: 'Decide with a shortlist', r: 'Pipelines',
    b: 'Drag candidates through rounds, or advance everyone above a threshold at once. Every move is written to an audit history.',
    d: ['Drag to advance, or take everyone above a score or the top N', 'Rejection emails are off by default', 'Export the selected list as CSV'] },
]

/* ── The rubric, dramatised. These are the product's six real default criteria
      with their real default weights; the answer and scores are synthetic. */
const RUBRIC = [
  { k: 'Communication Clarity',      v: 88 },
  { k: 'Relevance to Question',      v: 91 },
  { k: 'Technical / Domain Depth',   v: 79 },
  { k: 'Structure & Conciseness',    v: 84 },
  { k: 'Problem-Solving',            v: 86 },
  { k: 'Professionalism / Confidence', v: 90 },
]

/* ── Real client logos only. Three is what we have; three is what we show.
      `h` is the height of the MARK, and `crop` is what makes that true: a logo
      file delivered with baked-in padding renders smaller than its box, so
      matching box heights across a row does not match what the eye sees. */
type ClientLogo = { name: string; srcs: string[]; h?: number; crop?: string }
/* The extension that actually exists goes FIRST; the rest stay as a safety net
   for a logo dropped in later with a different one.
   `aisling` ships as .webp, so a png-first list 404'd on png, svg, jpg AND jpeg
   before reaching it — and the row renders twice for the marquee, so the home
   page paid up to 48 failed requests on every load to fetch two images. A
   fallback chain is insurance, not the happy path. */
const withExts = (base: string, real = 'webp') =>
  [real, ...['webp', 'png', 'svg', 'jpg', 'jpeg'].filter((e) => e !== real)].map((e) => `${base}.${e}`)
/* Sized by AREA, not by height.

   Measured ink boxes, meaning the mark itself with the padding in the file
   ignored:
     Total IT Global  747x411  ratio 1.82   a stacked lockup
     Aisling          180x43   ratio 4.19   a wide wordmark
     TalbotIQ         738x335  ratio 2.20   a stacked lockup

   All three shared one 30px box height, which is the obvious way to line logos
   up and the wrong one. At equal height the 4.19 wordmark covers more than
   twice the area of the two lockups, so Aisling read as the big logo and the
   other two as small ones. Equal height is not equal size.

   Each height below is solved from Aisling's area instead, h = sqrt(A / ratio)
   with A = 30 squared times 4.19, so all three marks occupy about 3,770 square
   pixels and carry the same weight in the row. The lockups come out taller
   because they are squarer, which is the point rather than a mistake.

   Aisling still needs its crop: 76% of that file is empty padding, so without
   it `h` sizes the padding instead of the mark. */
const CLIENTS: ClientLogo[] = [
  { name: 'Total IT Global', srcs: withExts('/mimic-logos/total-it-global', 'png'), h: 45 },
  { name: 'Aisling', srcs: withExts('/mimic-logos/aisling', 'webp'), h: 30, crop: '180 / 43' },
  { name: 'TalbotIQ', srcs: ['/talbotiq-logo.png'], h: 41 },
]
function LogoSlot({ name, srcs, h, crop }: ClientLogo) {
  const [i, setI] = useState(0)
  // `--logo-h` rather than an inline height on the <img>: the stylesheet caps
  // the image with max-height, which silently won over an inline height and
  // flattened every per-logo size back to the default.
  const sized = h ? ({ '--logo-h': `${h}px` } as React.CSSProperties) : undefined
  // Same mechanism as the letterboxed demo footage — trim the padding baked
  // into the asset at display time rather than shipping a re-cut file.
  const cropped = crop ? ({ aspectRatio: crop, objectFit: 'cover' } as React.CSSProperties) : undefined
  if (i >= srcs.length) return <span className="logo-slot" style={sized}>{name.toUpperCase()}</span>
  return (
    <span className="logo-slot" style={sized}>
      <img src={srcs[i]} alt={name} loading="lazy" onError={() => setI(i + 1)} style={cropped} />
    </span>
  )
}

/* ── Structural commitments. Every one of these is true of the product and
      verifiable inside it — which is why they replaced the certification row. */
const TRUST = [
  { icon: 'shield' as const, t: 'Mimic never rejects anyone',
    d: 'A score is a recommendation with its evidence attached. Advancing, rejecting and overriding are recruiter actions, and the product has no path that removes a candidate on its own.' },
  { icon: 'scale' as const, t: 'One rubric, applied identically',
    d: 'You define the criteria and their weights once. Every candidate for that role is measured against the same set, which is what makes two scores comparable at all.' },
  { icon: 'history' as const, t: 'Every decision is written down',
    d: 'Who advanced or rejected whom, when, on what basis, and whether the email sent, recorded per candidate and readable on the board.' },
]

const FAQS = [
  { q: 'Does Mimic reject candidates automatically?',
    a: 'No. Every score is a recommendation with the evidence behind it. Advancing, rejecting and overriding are recruiter actions, and each one is written to that candidate’s history. There is no automatic rejection anywhere in the product.' },
  { q: 'How do you keep scoring fair?',
    a: 'Every candidate for a role is measured against one rubric that you define, and each criterion carries the answer it was derived from. The overall score is calculated by the platform from your weights, not written by the language model, so the same answers always produce the same number.' },
  { q: 'How long does it take to go live?',
    a: 'You can build a reusable interview template and send your first invitations in the same sitting. There is nothing to install on your side and nothing for candidates to download.' },
  { q: 'Does Mimic work with our ATS?',
    a: 'You can start today with no integration at all: invite from a CSV, an ATS export, or a single shareable link. Tell us which ATS you run during the demo and we will confirm exactly what an integration would look like for you.' },
  { q: 'What do candidates actually experience?',
    a: 'They open a link, confirm they are ready, and interview in the browser, on a phone if that is what they have. They are told when AI is involved and consent before a recorded round. Their progress survives a refresh, and they never see scores.' },
  { q: 'How is candidate data handled?',
    a: 'Ask us directly, and we will walk your security and legal reviewers through where candidate data sits, who can reach it and how long it is kept, before you commit to anything. We do not publish certification badges we cannot evidence.' },
  { q: 'What does Mimic cost?',
    a: 'Pricing follows interview volume rather than seats. Tell us your monthly applicant load in the demo and we will scope it to that.' },
]

type FormState = { firstName: string; lastName: string; email: string; hiresPerYear: string }
const EMPTY: FormState = { firstName: '', lastName: '', email: '', hiresPerYear: '' }

/**
 * A format card that plays that format's own recording while it is hovered.
 *
 * Four things this has to get right:
 *
 *  · Lazy. The source attaches on the FIRST hover, never on load — five videos
 *    pulled eagerly would undo the payload work the rest of this page does.
 *  · Pointer only. A touch device has no hover, and a card that starts playing
 *    on the same tap that navigates is a bug, not a flourish.
 *  · Reduced motion gets nothing moving at all, matching DemoVideo.
 *  · The <article> stays the same element in the same position, because
 *    mimicSite.css seats each card's colour by :nth-of-type. The video layer
 *    goes INSIDE it rather than wrapping it.
 *
 * The video is aria-hidden: it carries no information the card's own heading
 * and copy do not already give in text, and announcing an unlabelled decorative
 * video on focus would be noise.
 */
function TrackCard({ t, wide }: { t: (typeof TRACKS)[number]; wide: boolean }) {
  const [seen, setSeen] = useState(false)   // source attached
  const [on, setOn] = useState(false)       // playing
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const canPlay = () =>
    hasDemo(t.track) &&                       // no footage for this format yet
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const enter = () => {
    if (!canPlay()) return
    setSeen(true)
    setOn(true)
    void videoRef.current?.play().catch(() => { /* autoplay refused; the copy stays */ })
  }
  const leave = () => {
    setOn(false)
    videoRef.current?.pause()
  }

  return (
    <article
      className={`track${wide ? ' wide' : ''}${on ? ' is-playing' : ''}`}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      tabIndex={0}
    >
      <div className="top">
        <span className="ic"><Ico n={t.icon} /></span>
        <span className="tag">{t.tag}</span>
      </div>
      <h3>{t.name}</h3>
      <p>{t.desc}</p>
      <div className="meta">{t.meta.map((m) => <span key={m}>{m}</span>)}</div>
      {seen && (
        <video
          ref={videoRef}
          className="track-vid"
          src={demoVideoSrc(t.track)}
          poster={demoPosterSrc(t.track)}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
    </article>
  )
}

export default function MimicSite() {
  // Drives the scoring sequence on the rubric card once it reaches the viewport.
  const [scoreRef, scored] = useInView<HTMLDivElement>(0.3)
  const heroRoomRef = useRef<HTMLDivElement | null>(null)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, boolean>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState('')

  // Per-route SEO head. A single-page app shares one <head>, so set this page's
  // title/meta/OG/canonical + JSON-LD on mount and restore on unmount.
  useEffect(() => {
    const prevTitle = document.title
    // Both strings come from HOME_SEO, because the build prerenders the same
    // two into dist/index.html and a second copy here is how they drift apart.
    document.title = HOME_SEO.metaTitle
    const desc = HOME_SEO.metaDesc
    const added: HTMLElement[] = []
    const meta = (sel: string, attr: string, key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(sel)
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); added.push(el) }
      el.setAttribute('content', content)
    }
    meta('meta[name="description"]', 'name', 'description', desc)
    meta('meta[property="og:title"]', 'property', 'og:title', 'Mimic, AI interviews for every candidate')
    meta('meta[property="og:description"]', 'property', 'og:description', desc)
    meta('meta[property="og:type"]', 'property', 'og:type', 'website')
    meta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image')
    // Reuse the prerendered canonical rather than appending a second one — the
    // build writes a real <head> per marketing route.
    //
    // The href was `https://mimic.talbotiq.com/`, the site root, while this page
    // is served at /mimic. A canonical that names a different URL than the page
    // asks search engines to index something else. It now points at the URL that
    // actually serves this content, consistent with every other marketing page
    // and with MarketingLayout.
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link'); canonical.rel = 'canonical'
      document.head.appendChild(canonical); added.push(canonical)
    }
    canonical.href = 'https://mimic.talbotiq.com/'
    const ld = document.createElement('script'); ld.type = 'application/ld+json'
    ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'Organization', name: 'TalbotIQ', brand: { '@type': 'Brand', name: 'Mimic' }, url: 'https://mimic.talbotiq.com/' },
      { '@type': 'WebSite', name: 'Mimic by TalbotIQ', url: 'https://mimic.talbotiq.com/' },
      { '@type': 'Service', name: 'Mimic AI interview platform', serviceType: 'AI candidate screening and interviewing', description: desc },
      { '@type': 'FAQPage', mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ] })
    document.head.appendChild(ld); added.push(ld)
    return () => { document.title = prevTitle; added.forEach((el) => el.remove()) }
  }, [])

  const valid = (k: keyof FormState, v: string) =>
    k === 'email' ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) : v.trim().length > 0
  const setField = (k: keyof FormState, v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: !valid(k, v) }))
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next: Partial<Record<keyof FormState, boolean>> = {}
    ;(Object.keys(EMPTY) as (keyof FormState)[]).forEach((k) => { if (!valid(k, form[k])) next[k] = true })
    setErrors(next)
    if (Object.keys(next).length) return
    setSubmitting(true); setFormError('')
    try {
      const res = await fetch(`${httpBase()}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, source: 'mimic-site' }),
      })
      if (!res.ok) throw new Error('bad status')
      setSubmitted(true)
    } catch {
      setFormError('Something went wrong sending that. Please try again, or email sales@talbotiq.com.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <MarketingLayout>
      <main id="top">

        {/* ── HERO — THE ROOM ──
            The first viewport is the interview room itself: a dark panel set
            into the light record, the way the product's own two grounds work.
            Inside it, the page's one permitted proof — the real avatar round,
            running — with the intelligence rail underneath annotating what the
            machine is doing with it (listening → thinking → scoring). Nothing
            here is a fabricated interface: the footage is real, the states are
            the product's real states, and the rail's numbers are the same
            disclosed dramatisation the scoring section uses. */}
        <section className="hero room" aria-labelledby="hero-h1">
          <div className="wrap">
            <div className="hero-room" ref={heroRoomRef}>
              {/* The ink field built for the site's dark surfaces — layered
                  light, WebGL when the device can afford it, CSS when not. */}
              <Field seed={7} />
              {/* The room answers the visitor's hand: a faint light tracks the
                  cursor across the panel. Atmosphere, not information. */}
              <CursorLight />
              {/* The cinematic layer: a 3D signal structure, an advected ink
                  trail under the cursor, and lighting driven by the SAME three
                  machine states the rail below the footage is showing.

                  It is an enhancement in the strict sense — it arms on an idle
                  callback after first paint, only on a wide viewport, only when
                  WebGL and the device tier allow, and never under reduced
                  motion. Everything above and below it renders identically
                  without it. */}
              <HeroStage hostRef={heroRoomRef} />
              <div className="hero-room-in">
                <div className="hero-copy">
                  <span className="eyebrow">AI native interview screening</span>
                  <h1 id="hero-h1"><SplitText delay={90}>Screening intelligence, decided by humans.</SplitText></h1>
                  <p className="sub">
                    Mimic interviews every applicant the day they apply (across chat, voice, AI video
                    and a live round), and scores every answer against one rubric you define, with the
                    evidence attached.
                  </p>
                  <div className="hero-cta">
                    {/* Magnetic is pointer-gated and capped at ~6px — enough to feel
                        responsive under the cursor, not enough to become a toy. */}
                    <Magnetic><a className="btn btn-light btn-lg" href="#demo">Book a demo</a></Magnetic>
                    <Magnetic><a className="btn btn-ghost-dark btn-lg" href="#scoring">See how scoring works</a></Magnetic>
                  </div>
                  <p className="hero-note">
                    <Ico n="check" />
                    Candidates interview in the browser. No scheduling, no app to install.
                  </p>
                </div>

                {/* The recording is the real product: a real Tavus replica
                    asking a real question over the live pipeline. `priority`,
                    because this is above the fold — the lazy arming that is
                    right for the demos further down would paint an empty box on
                    first load. Parallax is kept, gentler than before: inside a
                    panel a large lean reads as the panel failing, not depth. */}
                <div className="hero-stage">
                  {/* Parallax owns scroll travel; Tilt owns pointer depth — two
                      transforms on two elements, no conflict. The tilt is what
                      makes the footage an object IN the room. */}
                  <Parallax strength={12}>
                    <Reveal>
                      <Tilt>
                      <div className="hero-shot">
                        <DemoVideo
                          priority
                          src={demoVideoSrc('video_avatar')}
                          poster={demoPosterSrc('video_avatar')}
                          still={demoPosterSrc('video_avatar')}
                          caption={DEMO_COPY.video_avatar.caption}
                          alt={DEMO_COPY.video_avatar.alt}
                          disclosure={DEMO_COPY.video_avatar.disclosure}
                          contentAspect={DEMO_COPY.video_avatar.contentAspect}
                        />
                      </div>
                      </Tilt>
                    </Reveal>
                  </Parallax>
                  <HeroIntelligence />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── CLIENTS ── */}
        <section className="logos" aria-label="Customers">
          <div className="wrap">
            <p className="lead">Teams already screening with Mimic</p>
            {/* Three logos, shown three times each, moving continuously — that
                was the previous design, and its own comment gave the reason it
                could not work: the gap had to be tuned until "roughly two
                cycles are visible", which is another way of saying the row was
                padded until the repetition stopped being the first thing you
                noticed.

                Three is what we have, so three is what we show. A perpetual
                loop is the kind of motion this surface is meant not to have —
                it never ends, it says nothing, and it is the one animation a
                reader cannot dismiss. It also cost 36 <img> elements and 12
                duplicate DOM subtrees to display three files.

                The static row was already the reduced-motion fallback here. It
                is simply the design now, so everyone sees the same page. */}
            <div className="logo-row">
              {CLIENTS.map((l) => <LogoSlot key={l.name} {...l} />)}
            </div>
          </div>
        </section>

        {/* ── THE PROBLEM ──
            The narrative beat the page was missing. It went straight from "here
            are our customers" to "here is how our scoring works", which answers
            a question the reader has not been given a reason to ask yet.

            The composition is deliberately NOT three cards. It is the argument
            itself, drawn: on the left, the same role screened five times by
            five people — ragged, each line a different length, each asking
            something different. On the right, the same five candidates against
            one set of criteria. Nothing here depicts a product interface, so it
            cannot be mistaken for one; it is a diagram of the difference. */}
        <section className="section problem" id="problem" aria-labelledby="problem-h">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">The problem</span>
              <h2 className="h2" id="problem-h">Five interviewers, five interviews.</h2>
              <p className="lede">
                Screening at volume means different people asking different questions on different
                days, writing notes in their own shorthand. The scores that come out the other end
                were never measuring the same thing, so comparing them is guesswork with a number
                attached.
              </p>
            </div>

            <Reveal>
              <div className="noise" aria-hidden="true">
                <div className="noise-side">
                  <span className="noise-label">Unstructured screening</span>
                  <div className="noise-rows">
                    {[92, 46, 74, 58, 84, 38, 66, 51].map((w, i) => (
                      <span
                        key={i}
                        className="noise-row"
                        style={{ '--w': `${w}%`, '--i': i } as React.CSSProperties}
                      />
                    ))}
                  </div>
                  <span className="noise-foot">No two candidates asked the same thing</span>
                </div>

                <span className="noise-arrow">
                  <Ico n="arrow" />
                </span>

                <div className="noise-side is-ordered">
                  <span className="noise-label">One rubric, applied identically</span>
                  <div className="noise-rows">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <span key={i} className="noise-row" style={{ '--i': i } as React.CSSProperties} />
                    ))}
                  </div>
                  <span className="noise-foot">Every answer measured against the same criteria</span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── THE MECHANISM — proof by demonstration, not by borrowed statistic ── */}
        <section className="section" id="scoring" aria-labelledby="mech-h">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">How scoring works</span>
              <h2 className="h2" id="mech-h">A score you can check, line by line.</h2>
              <p className="lede">
                Most screening tools hand you a number. Mimic hands you the number, the criteria it
                came from, and the sentence in the candidate’s own answer that earned it.
              </p>
            </div>

            <div className="mech">
              <Reveal>
                {/* The page's thesis, animated: the rubric marking a real answer.
                    Bars grow, evidence highlights sweep in, and the weighted total
                    counts up — the scoring SHOWN rather than asserted. Driven by
                    scaleX and a CSS custom property, never by animating width,
                    which would relayout the card on every frame. */}
                <div ref={scoreRef} className={`mech-card${scored ? ' is-scored' : ''}`}>
                  <div className="mech-q">
                    <span className="lbl">Question 3 of 6</span>
                    <p>Tell me about a time you had to de-escalate a situation on a night shift with no senior nurse on the floor.</p>
                  </div>
                  <div className="mech-a">
                    <span className="lbl">Candidate answer</span>
                    <p>
                      “We had a patient just out of surgery becoming agitated around 2am and the on-call was forty
                      minutes out. <mark>I moved him to the quiet bay first so the ward settled</mark>, then
                      checked his chart for the analgesia timing — he was overdue.{' '}
                      <mark>I called the on-call with the drug chart already in front of me</mark> so we
                      could agree a dose in one conversation instead of three, and I stayed with him
                      until it took. <mark>Afterwards I wrote it up and flagged the gap in the handover</mark>{' '}
                      so the day team knew to watch the timing.”
                    </p>
                  </div>
                  <div className="mech-scores">
                    <span className="lbl">Scored against your rubric</span>
                    {RUBRIC.map((k, i) => (
                      <div className="kpi" key={k.k} style={{ '--i': i } as React.CSSProperties}>
                        <div>
                          <div className="kn">{k.k}</div>
                          <div className="track">
                            <div className="fill" style={{ '--v': k.v / 100 } as React.CSSProperties} />
                          </div>
                        </div>
                        <div className="kv" style={{ color: k.v >= 85 ? '#15803D' : k.v >= 70 ? '#8A4308' : '#B3261E' }}>{k.v}</div>
                      </div>
                    ))}
                    <div className="mech-total">
                      <span className="lab">Overall, weighted</span>
                      <span className="val">
                        <span className="num">86</span>
                        <span className="rec">Strong Yes</span>
                      </span>
                    </div>
                  </div>
                </div>
              </Reveal>

              <div>
                <ul className="mech-points">
                  <li>
                    <span className="ico"><Ico n="quote" /></span>
                    <div>
                      <h3>The evidence is part of the score</h3>
                      <p>
                        Each criterion links back to the passage it was drawn from. A hiring manager
                        who disagrees with a number can read the sentence behind it in a few seconds
                        rather than taking the score on trust.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span className="ico"><Ico n="scale" /></span>
                    <div>
                      <h3>You set the criteria and the weights</h3>
                      <p>
                        Six criteria ship as a starting point. Rename them, switch them off, add your
                        own, and set what each one is worth. The weights rescale to 100% as you type,
                        so the arithmetic is always honest.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span className="ico"><Ico n="calc" /></span>
                    <div>
                      <h3>The platform does the arithmetic, not the model</h3>
                      <p>
                        The language model judges individual answers. The overall score is computed
                        from your weights in ordinary code, which is why the same answers always
                        produce the same number.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span className="ico"><Ico n="alert" /></span>
                    <div>
                      <h3>It tells you when it is unsure</h3>
                      <p>
                        If an interview captured no answers, the report says <em>not evaluated</em>{' '}
                        rather than showing zeros. If it ran without AI, it says so on the report. A
                        degraded result is never dressed up as a real one.
                      </p>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── FORMATS ── */}
        <section className="section tinted" id="platform" aria-labelledby="tr-h">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Interview formats</span>
              <h2 className="h2" id="tr-h">Five ways to meet a candidate.</h2>
              <p className="lede">
                Pick the format that fits the role. Every one of them reads the candidate’s resume
                first and scores against the same rubric, so results compare directly across formats.
              </p>
            </div>
            <div className="tracks">
              {TRACKS.map((t, i) => (
                <TrackCard key={t.name} t={t} wide={WIDEN_LAST && i === TRACKS.length - 1} />
              ))}
              <article className="track statement">
                <div>
                  <h3>Adapted to the resume, on every track</h3>
                  <p>
                    Each interview reads the candidate’s own resume before it starts and rewrites its
                    follow-ups around what that resume actually claims, then scores the result on the
                    same rubric as everyone else applying for the role.
                  </p>
                </div>
                <div className="meta">
                  <span>Tailored to each candidate</span>
                  <span>One rubric</span>
                </div>
              </article>
            </div>

            {/* The single combined reel (candidate.webm) that stood here is
                superseded: each card above now plays its OWN format on hover,
                so a buyer who wants to see voice screening no longer has to sit
                through the avatar format first. The file is left on disk rather
                than deleted, so this is reversible without a re-record. */}
          </div>
        </section>

        {/* ── PROCESS ──
            Scroll-driven above 1081px: the section pins and each screen of
            scrolling advances one step, so the audit trail is read in the order
            it happens rather than clicked through. The tablist is unchanged and
            still keyboard-operable — a tab click calls goToStep, which scrolls,
            and the scroll position is what selects the step. One source of
            truth, so a click and a scroll cannot disagree.

            Under reduced motion and below 1081px nothing pins and the buttons
            behave exactly as they did before. */}
        {/* `on-dark` turns this into a full-bleed ink field, and it is the page's
            structural turn: paper → ink → paper → ink, an act structure rather
            than a stack of bands. Every child colour rule the modifier needs
            already existed in mimicSite.css, and this section's own label was
            already written `eyebrow on-dark` — it was built for this and never
            switched on.

            It earns the ink rather than borrowing it: this is the audit trail,
            and the audit trail is the cover of the bundle, not a page inside it.

            Deliberately NOT also `section`. That class carries vertical padding,
            and padding inside a pinned host shortens the distance the sticky box
            actually travels without shortening the travel PinnedStage computes
            from the host's own height — so the fifth step would be "reached"
            after the stage had already scrolled away. The ink ground and the
            unpinned section rhythm are supplied directly instead; see the
            `.process.on-dark` block in mimicSite.css.

            The ambient field goes through `backdrop`, not `children` — the note
            on that prop explains why the difference decides whether this section
            can pin at all. */}
        <PinnedStage
          steps={STEPS.length} onStep={setStep} id="process"
          className="process on-dark" labelledBy="pr-h"
          backdrop={<Field seed={0} />}
        >
          {({ goToStep }) => (
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow on-dark">How it works</span>
              <h2 className="h2" id="pr-h">Invite. Interview. Score. Shortlist.</h2>
              <p className="lede">Four things happen without you. The fifth is the decision, which stays yours.</p>
            </div>
            <div className="proc-grid">
              <div className="steps" role="tablist" aria-label="How Mimic works">
                {/* `on` carries the selected state visually; aria-selected carries it
                    for assistive tech. Both are required — with only the ARIA, a
                    sighted reader could not tell which of the five steps was open. */}
                {STEPS.map((s, i) => (
                  <button className={i === step ? 'step on' : 'step'} role="tab" aria-selected={i === step} key={s.t}
                    id={`step-tab-${i}`} aria-controls="step-panel" onClick={() => goToStep(i)}>
                    <span className="num">{i + 1}</span>
                    <span>
                      <h3>{s.t}</h3>
                      <p>{s.b}</p>
                    </span>
                  </button>
                ))}
              </div>
              <div className="proc-panel" role="tabpanel" id="step-panel" aria-labelledby={`step-tab-${step}`}>
                <span className="where"><Ico n="pin" />{STEPS[step].r}</span>
                <h3>{STEPS[step].t}</h3>
                <p>{STEPS[step].b}</p>
                <div className="detail">
                  {STEPS[step].d.map((d) => (
                    <div key={d}><Ico n="check" />{d}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          )}
        </PinnedStage>

        {/* ── WORKSPACE ── */}
        {/* The two frames below are PHOTOGRAPHS OF THE RUNNING PRODUCT, not
            drawings of it. What stood here before was a hand-built `.app-mock`
            — invented chrome, invented tabs, four fabricated rows — which is
            the exact thing this site's thesis argues against: a depiction
            standing in for evidence.

            They are captured by scripts/capture-product-shots.mjs against a
            synthetic store (scripts/seed-demo-store.ts), so every candidate in
            them is invented and every address is under example.com. The screens
            themselves are real. See docs/PRODUCT-SHOTS.md.

            Full width, not beside the copy: at ~570px in a two-column grid the
            interface type renders around 5px and the screenshot becomes a
            texture rather than evidence. Evidence has to be legible. */}
        <section className="section showcase" id="workspace" aria-labelledby="sh-h">
          <div className="wrap">
            {/* The list sits OUTSIDE .sec-head. Inside it, sec-head's 52px
                margin-bottom lands after the list rather than between the
                heading and it, and the bullets crowd the h2. */}
            <div className="sec-head">
              <span className="eyebrow">The product</span>
              <h2 className="h2" id="sh-h">The workspace your team lives in.</h2>
            </div>
            <ul className="featlist">
              <li><Ico n="check" />Bulk invitations from a spreadsheet, an ATS export, or one shareable link.</li>
              <li><Ico n="check" />Interview pipelines across several rounds, with drag to advance and score threshold rules.</li>
              <li><Ico n="check" />One rubric across every format, so scores compare directly.</li>
              <li><Ico n="check" />Analytics by role, template, format and recruiter.</li>
              <li><Ico n="check" />An assistant that answers questions and, with your confirmation, operates the product for you.</li>
            </ul>
            <a className="btn btn-primary" href="#demo" style={{ marginTop: 30 }}>See the workspace in a demo</a>

            <Reveal>
            <div className="shots">
              <DemoVideo
                src="/mimic-shots/demo.webm"
                startAt={2}
                poster="/mimic-shots/sessions.webp"
                still="/mimic-shots/report.webp"
                caption="The product running: the record, a scored report, the pipeline."
                alt="A recording of Mimic in use: the Sessions list showing eight candidates across every interview format, then a candidate report scoring 92 with a Strong Yes recommendation and a score for each criterion, then the pipeline across several rounds."
              />
            </div>
            </Reveal>
          </div>
        </section>

        {/* ── TRUST ── */}
        <section className="section tinted" id="trust" aria-labelledby="trust-h">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Responsible AI</span>
              <h2 className="h2" id="trust-h">Built so a person always decides.</h2>
              <p className="lede">
                Three commitments that are structural rather than editorial. You can verify each one
                inside the product on your first day.
              </p>
            </div>
            <div className="trust-grid">
              {TRUST.map((t) => (
                <div className="tcard" key={t.t}>
                  <span className="ico"><Ico n={t.icon} /></span>
                  <h3>{t.t}</h3>
                  <p>{t.d}</p>
                </div>
              ))}
            </div>
            <div className="tnote">
              <Ico n="info" />
              <p>
                We do not display certification badges we cannot evidence. If your security or legal
                review needs documentation, ask during the demo and we will tell you plainly what
                exists today and what does not.
              </p>
            </div>
          </div>
        </section>

        {/* ── RESOURCES ── */}
        <section className="section" id="resources" aria-labelledby="res-h">
          <div className="wrap">
            <div className="sec-head">
              <h2 className="h2" id="res-h">Start from something that works.</h2>
            </div>
            <div className="hub-cols" style={{ paddingTop: 36 }}>
              <div className="hub-col">
                <h2>Build your first round</h2>
                <ul>
                  <li><Link to="/resources/question-library">Interview question library<Ico n="arrow" /></Link></li>
                  <li><Link to="/resources/rubric-templates">Rubric templates<Ico n="arrow" /></Link></li>
                  <li><Link to="/platform/interview-templates">Interview templates<Ico n="arrow" /></Link></li>
                </ul>
              </div>
              <div className="hub-col">
                <h2>Understand the scoring</h2>
                <ul>
                  <li><Link to="/trust/how-mimic-scores">How Mimic scores<Ico n="arrow" /></Link></li>
                  <li><Link to="/trust/human-in-the-loop">Human-in-the-loop review<Ico n="arrow" /></Link></li>
                  <li><Link to="/platform/rubrics-scoring">Rubrics &amp; scoring<Ico n="arrow" /></Link></li>
                </ul>
              </div>
              <div className="hub-col">
                <h2>Fit it to your stack</h2>
                <ul>
                  <li><Link to="/resources/ats-integrations">ATS integrations<Ico n="arrow" /></Link></li>
                  <li><Link to="/resources/roi-calculator">First round ROI calculator<Ico n="arrow" /></Link></li>
                  <li><Link to="/solutions">Solutions by use case<Ico n="arrow" /></Link></li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="section tinted" id="faq" aria-labelledby="faq-h">
          <div className="wrap">
            <div className="sec-head center">
              <span className="eyebrow">Questions, answered</span>
              <h2 className="h2" id="faq-h">The things buyers ask us first.</h2>
            </div>
            <div className="faq">
              {FAQS.map((f, i) => (
                <details key={f.q} open={i === 0}>
                  <summary>
                    {f.q}
                    <Ico n="chevron" className="chev" />
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="cta" id="demo" aria-labelledby="cta-h">
          {/* A different seed from the process stage, so the two ink fields are
              two surfaces catching the same light rather than one mechanism
              driving both in lockstep. */}
          <Field seed={11} />
          <div className="wrap cta-in">
            <div>
              <h2 id="cta-h">Give the first round back to your recruiters.</h2>
              <p className="sub">
                Thirty minutes, on your own open roles. We will interview a candidate, score the
                answers against a rubric you choose, and show you the shortlist that comes out.
              </p>
              <div className="assure">
                <span><Ico n="check" />30-minute walkthrough</span>
                <span><Ico n="check" />Your roles, your rubric</span>
                <span><Ico n="check" />No card required</span>
              </div>
            </div>

            {submitted ? (
              <div className="thanks" role="status" aria-live="polite">
                <div className="tick"><Ico n="check" /></div>
                <h3>Thanks, you’re on the list.</h3>
                <p>We’ll be in touch within one business day to set up your walkthrough.</p>
              </div>
            ) : (
              <form className="demo" onSubmit={submit} noValidate>
                <h3>Book a demo</h3>
                <p className="fnote">Tell us where you are and we’ll tailor the session to your roles.</p>
                <div className={`field${errors.firstName ? ' bad' : ''}`}>
                  <label htmlFor="fn">First name</label>
                  <input id="fn" autoComplete="given-name" value={form.firstName} aria-invalid={!!errors.firstName}
                    onChange={(e) => setField('firstName', e.target.value)}
                    onBlur={(e) => setErrors((x) => ({ ...x, firstName: !valid('firstName', e.target.value) }))} />
                  <span className="err">Enter your first name.</span>
                </div>
                <div className={`field${errors.lastName ? ' bad' : ''}`}>
                  <label htmlFor="ln">Last name</label>
                  <input id="ln" autoComplete="family-name" value={form.lastName} aria-invalid={!!errors.lastName}
                    onChange={(e) => setField('lastName', e.target.value)}
                    onBlur={(e) => setErrors((x) => ({ ...x, lastName: !valid('lastName', e.target.value) }))} />
                  <span className="err">Enter your last name.</span>
                </div>
                <div className={`field full${errors.email ? ' bad' : ''}`}>
                  <label htmlFor="em">Work email</label>
                  <input id="em" type="email" autoComplete="email" value={form.email} aria-invalid={!!errors.email}
                    onChange={(e) => setField('email', e.target.value)}
                    onBlur={(e) => setErrors((x) => ({ ...x, email: !valid('email', e.target.value) }))} />
                  <span className="err">Enter a valid work email.</span>
                </div>
                <div className={`field full${errors.hiresPerYear ? ' bad' : ''}`}>
                  <label htmlFor="hy">Hires per year</label>
                  <input id="hy" inputMode="numeric" placeholder="e.g. 200–800" value={form.hiresPerYear}
                    aria-invalid={!!errors.hiresPerYear}
                    onChange={(e) => setField('hiresPerYear', e.target.value)}
                    onBlur={(e) => setErrors((x) => ({ ...x, hiresPerYear: !valid('hiresPerYear', e.target.value) }))} />
                  <span className="err">Roughly how many people do you hire a year?</span>
                </div>
                <div className="submit">
                  <button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Book a demo'}</button>
                </div>
                {formError && <p className="err" style={{ display: 'block', gridColumn: '1 / -1', textAlign: 'center' }}>{formError}</p>}
                <p className="form-note">By submitting you agree to be contacted about Mimic.</p>
              </form>
            )}
          </div>
        </section>
      </main>
    </MarketingLayout>
  )
}
