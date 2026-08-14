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

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { httpBase } from '@/lib/apiOrigin'
import './mimicSite.css'
import { MarketingLayout } from './MarketingLayout'
import { Magnetic, Parallax, Reveal } from './motion'
import { Ico } from './icons'

/* ── Interview formats. Six real tracks; the sixth card states the rule the
      other five obey, so it spans the row rather than repeating the pattern. */
const TRACKS = [
  { name: 'Conversational chat', tag: 'Async', icon: 'chat' as const,
    desc: 'A text interview candidates finish on a phone in minutes. Best for hourly and high-volume roles.',
    meta: ['No scheduling', 'Mobile-first'], bg: '#F3EDFD', fg: '#6B2BE0' },
  { name: 'Voice screening', tag: 'Async', icon: 'mic' as const,
    desc: 'A spoken conversation with an AI interviewer. Answers are transcribed, then scored on content and delivery together.',
    meta: ['Live transcript', 'Barge-in'], bg: '#FCEBF6', fg: '#C42C93' },
  { name: 'AI video avatar', tag: 'Async', icon: 'video' as const,
    desc: 'A configured presenter asks each question on camera, reacts to the answer, and follows up when one is thin.',
    meta: ['Personas', 'Replicas'], bg: '#EDF0FD', fg: '#5B6FE8' },
  { name: 'Live two-way call', tag: 'Live', icon: 'users' as const,
    desc: 'Your interviewer leads a real video call. Mimic records it with consent, transcribes it and scores the same rubric.',
    meta: ['Host room', 'Star rating'], bg: '#E4F6F0', fg: '#0F7A5F' },
  { name: 'Timed Q&A', tag: 'Async', icon: 'clock' as const,
    desc: 'Preparation and answer timers on every question, identical for every candidate. For work that happens under a clock.',
    meta: ['Per-question timer', 'Integrity checks'], bg: '#E9E2FB', fg: '#4A1BA8' },
]

/* ── The five steps of the real workflow, with the actual route each lives on. */
const STEPS = [
  { t: 'Configure once', r: 'Templates',
    b: 'Pick the format, where questions come from, the rubric weights and the timing. Save it as a template your whole team reuses.',
    d: ['Six interview formats on one configuration', 'Weighted criteria you define, rescaled automatically', 'Branding and integrity rules per template'] },
  { t: 'Invite in bulk', r: 'Sessions → Invite candidates',
    b: 'Drop in a spreadsheet or an ATS export. Mimic reads every address, personalises each email and sends a link bound to that candidate.',
    d: ['CSV, Excel, PDF, DOCX or plain text', 'Each link opens only for the address it was sent to', 'Test the exact email on yourself before sending'] },
  { t: 'Interview on their schedule', r: 'The candidate’s link',
    b: 'Candidates interview at eleven at night on a phone if that is what works. Adaptive interviews read their résumé and ask about what it claims.',
    d: ['No scheduling, no app to install', 'Progress survives a refresh or a dropped connection', 'Timing is measured server-side, so it cannot be extended'] },
  { t: 'Score every answer', r: 'Report',
    b: 'One rubric, applied identically. Each criterion carries the answer it came from, alongside the transcript and delivery metrics.',
    d: ['Per-question breakdown with written feedback', 'Speech metrics computed from the real transcript', 'Marked plainly when scoring ran without AI'] },
  { t: 'Decide with a shortlist', r: 'Pipelines',
    b: 'Drag candidates through rounds, or advance everyone above a threshold at once. Every move is written to an audit history.',
    d: ['Drag-to-advance, or score-threshold and top-N rules', 'Rejection emails are off by default', 'Export the selected list as CSV'] },
]

/* ── Sample rows for the hero frame. Synthetic, and labelled as such on screen. */
const HERO_ROWS = [
  { in: 'AR', name: 'Amara Reyes',  tag: 'AI avatar · Scored',  sc: '92', bg: '#F3EDFD', fg: '#6B2BE0', pc: '#0F7A5F', pb: '#E4F6F0', scC: '#0F7A5F' },
  { in: 'JT', name: 'Jonas Thiel',  tag: 'Two-way · Scored',    sc: '88', bg: '#E4F6F0', fg: '#0F7A5F', pc: '#0F7A5F', pb: '#E4F6F0', scC: '#0F7A5F' },
  { in: 'PK', name: 'Priya Kaur',   tag: 'Voice · In progress', sc: '—',  bg: '#FCEBF6', fg: '#C42C93', pc: '#6B2BE0', pb: '#F3EDFD', scC: '#A79ABF' },
  { in: 'MO', name: 'Michael Osei', tag: 'Chatbot · Invited',   sc: '—',  bg: '#EDF0FD', fg: '#5B6FE8', pc: '#645C7E', pb: '#FAF7FE', scC: '#A79ABF' },
  { in: 'LN', name: 'Lena Novák',   tag: 'Timed Q&A · Scored',  sc: '71', bg: '#E9E2FB', fg: '#4A1BA8', pc: '#8F5A00', pb: '#FDF3E2', scC: '#8F5A00' },
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

/* ── Real client logos only. Three is what we have; three is what we show. */
type ClientLogo = { name: string; srcs: string[]; h?: number }
const withExts = (base: string) => ['png', 'svg', 'jpg', 'jpeg', 'webp'].map((e) => `${base}.${e}`)
const CLIENTS: ClientLogo[] = [
  { name: 'Total IT Global', srcs: withExts('/mimic-logos/total-it-global') },
  { name: 'Aisling', srcs: withExts('/mimic-logos/aisling'), h: 46 },
  { name: 'TalbotIQ', srcs: ['/talbotiq-logo.png'] },
]
function LogoSlot({ name, srcs, h }: ClientLogo) {
  const [i, setI] = useState(0)
  if (i >= srcs.length) return <span className="logo-slot">{name.toUpperCase()}</span>
  return (
    <span className="logo-slot">
      <img src={srcs[i]} alt={name} loading="lazy" onError={() => setI(i + 1)}
        style={h ? { height: `${h}px`, maxWidth: 'none' } : undefined} />
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
    d: 'Who advanced or rejected whom, when, on what basis, and whether the email sent — recorded per candidate and readable on the board.' },
]

const FAQS = [
  { q: 'Does Mimic reject candidates automatically?',
    a: 'No. Every score is a recommendation with the evidence behind it. Advancing, rejecting and overriding are recruiter actions, and each one is written to that candidate’s history. There is no automatic rejection anywhere in the product.' },
  { q: 'How do you keep scoring fair?',
    a: 'Every candidate for a role is measured against one rubric that you define, and each criterion carries the answer it was derived from. The overall score is calculated by the platform from your weights — not written by the language model — so the same answers always produce the same number.' },
  { q: 'How long does it take to go live?',
    a: 'You can build a reusable interview template and send your first invitations in the same sitting. There is nothing to install on your side and nothing for candidates to download.' },
  { q: 'Does Mimic work with our ATS?',
    a: 'You can start today with no integration at all: invite from a CSV, an ATS export, or a single shareable link. Tell us which ATS you run during the demo and we will confirm exactly what an integration would look like for you.' },
  { q: 'What do candidates actually experience?',
    a: 'They open a link, confirm they are ready, and interview in the browser — on a phone if that is what they have. They are told when AI is involved and consent before a recorded round. Their progress survives a refresh, and they never see scores.' },
  { q: 'How is candidate data handled?',
    a: 'Ask us directly, and we will walk your security and legal reviewers through where candidate data sits, who can reach it and how long it is kept — before you commit to anything. We do not publish certification badges we cannot evidence.' },
  { q: 'What does Mimic cost?',
    a: 'Pricing follows interview volume rather than seats. Tell us your monthly applicant load in the demo and we will scope it to that.' },
]

type FormState = { firstName: string; lastName: string; email: string; hiresPerYear: string }
const EMPTY: FormState = { firstName: '', lastName: '', email: '', hiresPerYear: '' }

export default function MimicSite() {
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
    document.title = 'Mimic by TalbotIQ — AI Interviews for Every Candidate'
    const desc = 'Mimic interviews and scores every applicant the day they apply — across chat, voice, AI video and live rounds — on one rubric, with the evidence attached. Book a demo.'
    const added: HTMLElement[] = []
    const meta = (sel: string, attr: string, key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(sel)
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); added.push(el) }
      el.setAttribute('content', content)
    }
    meta('meta[name="description"]', 'name', 'description', desc)
    meta('meta[property="og:title"]', 'property', 'og:title', 'Mimic — AI interviews for every candidate')
    meta('meta[property="og:description"]', 'property', 'og:description', desc)
    meta('meta[property="og:type"]', 'property', 'og:type', 'website')
    meta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image')
    const canonical = document.createElement('link'); canonical.rel = 'canonical'
    canonical.href = 'https://mimic.talbotiq.com/'; document.head.appendChild(canonical); added.push(canonical)
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

        {/* ── HERO ── */}
        <section className="hero" aria-labelledby="hero-h1">
          {/* WebGL layer intentionally NOT mounted here — see three/HeroCanvas.tsx.
              This hero's composition is already resolved (type left, product frame
              right) and has no negative space for a scene; three attempts at one
              all competed with the headline instead of supporting it. The scene
              needs a section of its own, or a hero rebuilt to make room for it.
              Pending that decision the canvas stays unmounted. */}
          <div className="wrap hero-in">
            <div>
              <span className="eyebrow">AI native interview screening</span>
              <h1 id="hero-h1">Screening intelligence, human-decided.</h1>
              <p className="sub">
                Mimic interviews every applicant the day they apply — across chat, voice, AI video
                and a live round — and scores every answer against one rubric you define, with the
                evidence attached.
              </p>
              <div className="hero-cta">
                {/* Magnetic is pointer-gated and capped at ~6px — enough to feel
                    responsive under the cursor, not enough to become a toy. */}
                <Magnetic><a className="btn btn-primary btn-lg" href="#demo">Book a demo</a></Magnetic>
                <Magnetic><a className="btn btn-ghost btn-lg" href="#scoring">See how scoring works</a></Magnetic>
              </div>
              <p className="hero-note">
                <Ico n="check" />
                Candidates interview in the browser. No scheduling, no app to install.
              </p>
            </div>

            {/* Gentle parallax on the product frame — the hero's only depth
                cue now that the WebGL layer is unmounted. The wrapper becomes
                the grid cell; .frame fills it, so the layout is unchanged. */}
            <Parallax strength={22}>
            <div className="frame" role="img" aria-label="The Mimic sessions screen, showing five candidates with their interview format, status and score. Sample data.">
              <div className="fr-top">
                <span className="t">Sessions · Senior RN · Nights</span>
                <span className="ph">Sample data</span>
              </div>
              {HERO_ROWS.map((r) => (
                <div className="strow" key={r.name}>
                  <span className="cand">
                    <span className="ci" style={{ background: r.bg, color: r.fg }}>{r.in}</span>
                    <span className="nm">{r.name}</span>
                  </span>
                  <span className="pill-s" style={{ color: r.pc, background: r.pb }}>{r.tag}</span>
                  <span className="sc" style={{ color: r.scC }}>{r.sc}</span>
                </div>
              ))}
            </div>
            </Parallax>
          </div>
        </section>

        {/* ── CLIENTS ── */}
        <section className="logos" aria-label="Customers">
          <div className="wrap">
            <p className="lead">Teams already screening with Mimic</p>
            <div className="logo-row">
              {CLIENTS.map((l) => <LogoSlot key={l.name} name={l.name} srcs={l.srcs} h={l.h} />)}
            </div>
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
                <div className="mech-card">
                  <div className="mech-q">
                    <span className="lbl">Question 3 of 6</span>
                    <p>Tell me about a time you had to de-escalate a situation on a night shift with no senior nurse on the floor.</p>
                  </div>
                  <div className="mech-a">
                    <span className="lbl">Candidate answer</span>
                    <p>
                      “We had a post-op patient becoming agitated around 2am and the on-call was forty
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
                    {RUBRIC.map((k) => (
                      <div className="kpi" key={k.k}>
                        <div>
                          <div className="kn">{k.k}</div>
                          <div className="track"><div className="fill" style={{ width: `${k.v}%` }} /></div>
                        </div>
                        <div className="kv" style={{ color: k.v >= 85 ? '#0F7A5F' : k.v >= 70 ? '#8F5A00' : '#C1332B' }}>{k.v}</div>
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
                        own, and set what each one is worth — the weights rescale to 100% as you type,
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
              <h2 className="h2" id="tr-h">Six ways to meet a candidate.</h2>
              <p className="lede">
                Pick the format that fits the role. Every one of them reads the candidate’s résumé
                first and scores against the same rubric, so results compare directly across formats.
              </p>
            </div>
            <div className="tracks">
              {TRACKS.map((t) => (
                <article className="track" key={t.name}>
                  <div className="top">
                    <span className="ic" style={{ background: t.bg, color: t.fg }}><Ico n={t.icon} /></span>
                    <span className="tag">{t.tag}</span>
                  </div>
                  <h3>{t.name}</h3>
                  <p>{t.desc}</p>
                  <div className="meta">{t.meta.map((m) => <span key={m}>{m}</span>)}</div>
                </article>
              ))}
              <article className="track wide">
                <div>
                  <h3>Résumé-adaptive, on every track</h3>
                  <p>
                    Each interview reads the candidate’s own résumé before it starts and rewrites its
                    follow-ups around what that résumé actually claims — then scores the result on the
                    same rubric as everyone else applying for the role.
                  </p>
                </div>
                <div className="meta">
                  <span>Auto-tailored per candidate</span>
                  <span>One rubric</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ── PROCESS ── */}
        <section className="process" id="process" aria-labelledby="pr-h">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow on-dark">How it works</span>
              <h2 className="h2" id="pr-h">Invite. Interview. Score. Shortlist.</h2>
              <p className="lede">Four things happen without you. The fifth is the decision, which stays yours.</p>
            </div>
            <div className="proc-grid">
              <div className="steps" role="tablist" aria-label="How Mimic works">
                {STEPS.map((s, i) => (
                  <button className="step" role="tab" aria-selected={i === step} key={s.t}
                    id={`step-tab-${i}`} aria-controls="step-panel" onClick={() => setStep(i)}>
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
        </section>

        {/* ── WORKSPACE ── */}
        <section className="section showcase" aria-labelledby="sh-h">
          <div className="wrap">
            <div className="two">
              <div>
                <span className="eyebrow">The product</span>
                <h2 className="h2" id="sh-h">The workspace your team lives in.</h2>
                <ul className="featlist">
                  <li><Ico n="check" />Bulk invitations from a spreadsheet, an ATS export, or one shareable link.</li>
                  <li><Ico n="check" />Multi-round pipelines with drag-to-advance and score-threshold rules.</li>
                  <li><Ico n="check" />One rubric across every format, so scores compare directly.</li>
                  <li><Ico n="check" />Analytics by role, template, format and recruiter.</li>
                  <li><Ico n="check" />An assistant that answers questions and — with your confirmation — operates the product for you.</li>
                </ul>
                <a className="btn btn-primary" href="#demo" style={{ marginTop: 30 }}>See the workspace in a demo</a>
              </div>
              <div className="app-mock" role="img" aria-label="The Mimic recruiter workspace showing the Sessions screen. Sample data.">
                <div className="am-top">
                  <span className="brand" style={{ fontSize: 15 }}>
                    <span className="mk"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 21V11l5 6 4-6 4 6 5-6v10" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                    Mimic
                  </span>
                  <div className="am-tabs"><span className="on">Sessions</span><span>Pipelines</span><span>Analytics</span><span>Studio</span></div>
                  <span className="ph" style={{ marginLeft: 'auto' }}>Sample data</span>
                </div>
                <div className="am-body">
                  {HERO_ROWS.slice(0, 4).map((r) => (
                    <div className="strow" key={r.name}>
                      <span className="cand">
                        <span className="ci" style={{ background: r.bg, color: r.fg }}>{r.in}</span>
                        <span className="nm">{r.name}</span>
                      </span>
                      <span className="pill-s" style={{ color: r.pc, background: r.pb }}>{r.tag}</span>
                      <span className="sc" style={{ color: r.scC }}>{r.sc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── TRUST ── */}
        <section className="section tinted" id="trust" aria-labelledby="trust-h">
          <div className="wrap">
            <div className="sec-head">
              <span className="eyebrow">Responsible AI</span>
              <h2 className="h2" id="trust-h">Built so a person always decides.</h2>
              <p className="lede">
                Three commitments that are structural rather than editorial — you can verify each one
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
                  <li><Link to="/mimic/resources/question-library">Interview question library<Ico n="arrow" /></Link></li>
                  <li><Link to="/mimic/resources/rubric-templates">Rubric templates<Ico n="arrow" /></Link></li>
                  <li><Link to="/mimic/platform/interview-templates">Interview templates<Ico n="arrow" /></Link></li>
                </ul>
              </div>
              <div className="hub-col">
                <h2>Understand the scoring</h2>
                <ul>
                  <li><Link to="/mimic/trust/how-mimic-scores">How Mimic scores<Ico n="arrow" /></Link></li>
                  <li><Link to="/mimic/trust/human-in-the-loop">Human-in-the-loop review<Ico n="arrow" /></Link></li>
                  <li><Link to="/mimic/platform/rubrics-scoring">Rubrics &amp; scoring<Ico n="arrow" /></Link></li>
                </ul>
              </div>
              <div className="hub-col">
                <h2>Fit it to your stack</h2>
                <ul>
                  <li><Link to="/mimic/resources/ats-integrations">ATS integrations<Ico n="arrow" /></Link></li>
                  <li><Link to="/mimic/resources/roi-calculator">First-round ROI calculator<Ico n="arrow" /></Link></li>
                  <li><Link to="/mimic/solutions">Solutions by use case<Ico n="arrow" /></Link></li>
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
                <h3>Thanks — you’re on the list.</h3>
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
